/**
 * FirestoreUsageStore (durable-server-stores D2, D3; specs/server-storage-backends "Admission is
 * atomic on every backend", "Retention purges run identically on every backend").
 *
 * Three collections under the store's root:
 * - `usage/{deviceId}`: a device's lifetime token totals and the UTC day it was last credited.
 *   `credit` is a merge write of `FieldValue.increment`s, atomic without a transaction.
 * - `requests/{requestId}`: one content-free ledger row per admitted request, every `LedgerRow`
 *   field but the id (the document id), `generationIds` as a native array, plus the
 *   `admissionId` of the `admit` call that created it (absent on an imported row).
 * - `admission/{counterId}`: the daily counts admission checks, kept beside the ledger so a check is
 *   a document read rather than a query. `{utcDay}:{kind}:{deviceId}` counts one device's
 *   non-refunded rows of one kind on one day, `{utcDay}:global:{kind}` every device's. A limit
 *   across several kinds sums their global counters, exactly as the SQLite store counts
 *   `kind IN (...)`. A counter changes only in the transaction that changes the rows it counts
 *   (admit, refund, device delete) and is deleted with its ledger day.
 *
 * Every document id built from a caller's key goes through `firestoreKey`, which leaves UUIDs as
 * they are and percent-encodes anything a document id cannot hold.
 */
import { randomUUID } from 'node:crypto';
import {
  FieldValue,
  type CollectionReference,
  type DocumentReference,
  type DocumentSnapshot,
  type Firestore,
  type Query,
  type Transaction,
} from '@google-cloud/firestore';
import type { Usage } from '@whim/contract';
import { deleteInBatches, type FirestoreRoot } from './client';
import { byUtf8Bytes } from '../text-order';
import { settle } from '../settle';
import {
  assertFailureReason,
  computeSummary,
  costWriteLands,
  effectiveGlobalKinds,
  secondsUntilNextUtcMidnight,
  utcDayString,
  type AdmitParams,
  type AdmitResult,
  type CostState,
  type CostSweepCandidate,
  type CostSweepQuery,
  type DeviceUsageDeleted,
  type DeviceUsageRecords,
  type FailureReason,
  type LedgerRow,
  type RecordCostParams,
  type RequestKind,
  type RequestOutcome,
  type SettleParams,
  type SummaryParams,
  type UnitAvailability,
  type UnitQuery,
  type UsageRecordKeeping,
  type UsageStore,
  type UsageSummary,
} from '../usage-store';

export const USAGE_COLLECTION = 'usage';
export const REQUESTS_COLLECTION = 'requests';
export const ADMISSION_COLLECTION = 'admission';

/** Ledger rows one device-delete transaction removes. Each also writes at most two counters per
 *  (day, kind) it touches, which keeps a transaction far below Firestore's write limit. */
const DEVICE_DELETE_CHUNK = 100;

/** Concurrent admissions for one counter abort each other's transactions; the client retries them.
 *  The default of 5 attempts lets a burst on one device's last unit fail with "too much contention"
 *  instead of answering. */
const ADMISSION_MAX_ATTEMPTS = 25;

/** One ledger row's document: `LedgerRow` without its id. */
export interface RequestDoc {
  deviceId: string;
  kind: RequestKind;
  utcDay: string;
  startedAt: number;
  endedAt: number | null;
  outcome: RequestOutcome | null;
  failureReason: FailureReason | null;
  promptTokens: number;
  completionTokens: number;
  costUsd: number | null;
  costState: CostState;
  generationIds: string[] | null;
  refunded: boolean;
  /** Set by the `admit` call that created the row, one value per call; absent on an imported row. */
  admissionId?: string;
}

/** A device's lifetime totals document. */
interface UsageDoc extends Usage {
  lastCreditedDay: string;
}

/** The document id of the empty key. An encoded key holds `%` only before two hex digits, so no
 *  other key maps here. */
const EMPTY_KEY = '%';

/**
 * `key` as a document id: ASCII letters, digits and `-` stay, every other character becomes the
 * `%XX` escapes of its UTF-8 bytes, and the empty key, which no document id can be, is `%`. So a
 * UUID is its own id, while `''`, `/`, `.`, `..` and `__x__` can never reach Firestore's path rules.
 * `fromFirestoreKey` reverses it.
 */
export function firestoreKey(key: string): string {
  if (key === '') return EMPTY_KEY;
  return encodeURIComponent(key).replace(/[_.!~*'()]/g, (ch) => `%${ch.codePointAt(0)!.toString(16).toUpperCase()}`);
}

/** The key `firestoreKey` encoded as `id`. */
function fromFirestoreKey(id: string): string {
  return id === EMPTY_KEY ? '' : decodeURIComponent(id);
}

/** The id of the counter of `deviceId`'s non-refunded `kind` rows on `utcDay`. */
export function deviceCounterId(utcDay: string, kind: RequestKind, deviceId: string): string {
  return `${utcDay}:${kind}:${firestoreKey(deviceId)}`;
}

/** The id of the counter of every device's non-refunded `kind` rows on `utcDay`. */
export function globalCounterId(utcDay: string, kind: RequestKind): string {
  return `${utcDay}:global:${kind}`;
}

function countOf(snapshot: DocumentSnapshot): number {
  const count: unknown = snapshot.get('count');
  return typeof count === 'number' ? count : 0;
}

function idsOf(raw: unknown): readonly string[] {
  return Array.isArray(raw) ? raw.filter((id): id is string => typeof id === 'string') : [];
}

function toLedgerRow(snapshot: DocumentSnapshot): LedgerRow {
  const doc = snapshot.data() as RequestDoc;
  return {
    id: fromFirestoreKey(snapshot.id),
    deviceId: doc.deviceId,
    kind: doc.kind,
    utcDay: doc.utcDay,
    startedAt: doc.startedAt,
    endedAt: doc.endedAt,
    outcome: doc.outcome,
    failureReason: doc.failureReason,
    promptTokens: doc.promptTokens,
    completionTokens: doc.completionTokens,
    costUsd: doc.costUsd,
    costState: doc.costState,
    generationIds: doc.generationIds === null ? null : idsOf(doc.generationIds),
    refunded: doc.refunded,
  };
}

/** Ledger order as the SQLite store's `ORDER BY started_at, id`. */
function byStart(a: LedgerRow, b: LedgerRow): number {
  return a.startedAt - b.startedAt || byUtf8Bytes(a.id, b.id);
}

export interface FirestoreUsageStoreOptions {
  /** The clock `credit` stamps `lastCreditedDay` from. Defaults to `Date.now`. */
  readonly now?: () => number;
}

export class FirestoreUsageStore implements UsageStore, UsageRecordKeeping {
  private readonly now: () => number;

  constructor(
    private readonly db: Firestore,
    private readonly root: FirestoreRoot = db,
    options: FirestoreUsageStoreOptions = {},
  ) {
    this.now = options.now ?? Date.now;
  }

  private usage(): CollectionReference {
    return this.root.collection(USAGE_COLLECTION);
  }

  private requests(): CollectionReference {
    return this.root.collection(REQUESTS_COLLECTION);
  }

  private admission(): CollectionReference {
    return this.root.collection(ADMISSION_COLLECTION);
  }

  private request(requestId: string): DocumentReference {
    return this.requests().doc(firestoreKey(requestId));
  }

  private deviceCounter(utcDay: string, kind: RequestKind, deviceId: string): DocumentReference {
    return this.admission().doc(deviceCounterId(utcDay, kind, deviceId));
  }

  private globalCounter(utcDay: string, kind: RequestKind): DocumentReference {
    return this.admission().doc(globalCounterId(utcDay, kind));
  }

  /** Adds `delta` to both counters `row` counts toward, inside `tx`. The fields beside `count` are
   *  written too, so a counter this creates is still found by its day's purge and its device's delete. */
  private shiftCounters(tx: Transaction, row: Pick<RequestDoc, 'utcDay' | 'kind' | 'deviceId'>, delta: number): void {
    const { utcDay, kind, deviceId } = row;
    tx.set(this.deviceCounter(utcDay, kind, deviceId), { utcDay, kind, deviceId, count: FieldValue.increment(delta) }, { merge: true });
    tx.set(this.globalCounter(utcDay, kind), { utcDay, kind, count: FieldValue.increment(delta) }, { merge: true });
  }

  async credit(deviceId: string, usage: Usage): Promise<void> {
    await this.usage()
      .doc(firestoreKey(deviceId))
      .set(
        {
          promptTokens: FieldValue.increment(usage.promptTokens),
          completionTokens: FieldValue.increment(usage.completionTokens),
          totalTokens: FieldValue.increment(usage.totalTokens),
          lastCreditedDay: utcDayString(this.now()),
        },
        { merge: true },
      );
  }

  async read(deviceId: string): Promise<Usage> {
    const snapshot = await this.usage().doc(firestoreKey(deviceId)).get();
    if (!snapshot.exists) return { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
    const doc = snapshot.data() as UsageDoc;
    return { promptTokens: doc.promptTokens, completionTokens: doc.completionTokens, totalTokens: doc.totalTokens };
  }

  /** The counters `query`'s limit checks read: the device's, then (when a global limit applies) the
   *  global counter of every kind the limit spans. */
  private limitCounters(query: UnitQuery): DocumentReference[] {
    const utcDay = utcDayString(query.now);
    const globals = query.globalLimit === undefined ? [] : effectiveGlobalKinds(query.kind, query.globalKinds).map((kind) => this.globalCounter(utcDay, kind));
    return [this.deviceCounter(utcDay, query.kind, query.deviceId), ...globals];
  }

  /** The device limit first, then the global one, over the snapshots `limitCounters` named. */
  private static refusal(query: UnitQuery, [device, ...globals]: readonly DocumentSnapshot[]): Extract<AdmitResult, { ok: false }> | undefined {
    if (countOf(device) >= query.deviceLimit) {
      return { ok: false, reason: 'device', retryAfterSec: secondsUntilNextUtcMidnight(query.now) };
    }
    if (query.globalLimit !== undefined && globals.reduce((sum, snapshot) => sum + countOf(snapshot), 0) >= query.globalLimit) {
      return { ok: false, reason: 'global', retryAfterSec: secondsUntilNextUtcMidnight(query.now) };
    }
    return undefined;
  }

  admit(params: AdmitParams): Promise<AdmitResult> {
    const { requestId, deviceId, kind, now } = params;
    // Naming the documents throws for a malformed clock reading; `settle` keeps that a rejection.
    return settle(() => {
      const counters = this.limitCounters(params);
      const ref = this.request(requestId);
      // Identifies the row this call writes across the client's retries of its transaction; a second
      // call with the same parameters is a reuse, not a retry.
      const admissionId = randomUUID();
      return this.db.runTransaction(
        async (tx): Promise<AdmitResult> => {
          const [existing, ...snapshots] = await tx.getAll(ref, ...counters);
          // The client retries a commit whose reply was lost (DEADLINE_EXCEEDED, UNAVAILABLE, ...) even
          // when it landed. That retry finds this call's own row, already counted: it is the same
          // admission, so it answers as the first attempt did, before the limits its own unit now fills.
          if (existing.exists && existing.get('admissionId') === admissionId) return { ok: true, requestId };
          const refused = FirestoreUsageStore.refusal(params, snapshots);
          if (refused) return refused;
          // As in the SQLite store, a reused id is rejected after the limit checks; nothing is written.
          if (existing.exists) throw new Error(`request id ${requestId} is already in the ledger`);
          const row: RequestDoc = {
            deviceId,
            kind,
            utcDay: utcDayString(now),
            startedAt: now,
            endedAt: null,
            outcome: null,
            failureReason: null,
            promptTokens: 0,
            completionTokens: 0,
            costUsd: null,
            costState: 'pending',
            generationIds: null,
            refunded: false,
            admissionId,
          };
          tx.create(ref, row);
          this.shiftCounters(tx, row, 1);
          return { ok: true, requestId };
        },
        { maxAttempts: ADMISSION_MAX_ATTEMPTS },
      );
    });
  }

  async unitAvailable(params: UnitQuery): Promise<UnitAvailability> {
    const snapshots = await this.db.getAll(...this.limitCounters(params));
    return FirestoreUsageStore.refusal(params, snapshots) ?? { ok: true };
  }

  async refund(requestId: string): Promise<void> {
    const ref = this.request(requestId);
    await this.db.runTransaction(
      async (tx) => {
        const snapshot = await tx.get(ref);
        if (!snapshot.exists) return;
        const row = snapshot.data() as RequestDoc;
        if (row.refunded) return;
        tx.update(ref, { refunded: true });
        this.shiftCounters(tx, row, -1);
      },
      { maxAttempts: ADMISSION_MAX_ATTEMPTS },
    );
  }

  async settle(requestId: string, params: SettleParams): Promise<void> {
    assertFailureReason(params);
    const ref = this.request(requestId);
    await this.db.runTransaction(async (tx) => {
      const snapshot = await tx.get(ref);
      if (!snapshot.exists || snapshot.get('endedAt') !== null) return;
      tx.update(ref, {
        endedAt: params.now ?? Date.now(),
        outcome: params.outcome,
        failureReason: params.failureReason ?? null,
        promptTokens: params.usage?.promptTokens ?? 0,
        completionTokens: params.usage?.completionTokens ?? 0,
      });
    });
  }

  async recordCost(requestId: string, params: RecordCostParams): Promise<void> {
    const ref = this.request(requestId);
    const ids = params.generationIds && params.generationIds.length > 0 ? [...params.generationIds] : null;
    await this.db.runTransaction(async (tx) => {
      const snapshot = await tx.get(ref);
      if (!snapshot.exists || !costWriteLands(snapshot.get('costState') as CostState, params.state)) return;
      tx.update(ref, {
        costState: params.state,
        costUsd: params.costUsd ?? null,
        generationIds: params.state === 'resolved' ? null : (ids ?? (snapshot.get('generationIds') as string[] | null)),
      });
    });
  }

  async listUnresolvedCostRows(query: CostSweepQuery): Promise<CostSweepCandidate[]> {
    const maxAgeBefore = query.now - query.maxAgeMs;
    const staleBefore = query.now - query.stalePendingAfterMs;
    const [unresolved, stalePending] = await Promise.all([
      this.requests().where('costState', '==', 'unresolved').where('endedAt', '>', maxAgeBefore).get(),
      this.requests().where('costState', '==', 'pending').where('endedAt', '>', maxAgeBefore).where('endedAt', '<=', staleBefore).get(),
    ]);
    return [...unresolved.docs, ...stalePending.docs]
      .map(toLedgerRow)
      .filter((row) => row.generationIds !== null && row.generationIds.length > 0)
      .sort(byStart)
      .slice(0, query.limit)
      .map((row) => ({ requestId: row.id, generationIds: row.generationIds ?? [] }));
  }

  async summary(params: SummaryParams): Promise<UsageSummary> {
    const first = utcDayString(params.now - (params.days - 1) * 86_400_000);
    const last = utcDayString(params.now);
    const snapshot = await this.requests().where('utcDay', '>=', first).where('utcDay', '<=', last).get();
    return computeSummary(snapshot.docs.map(toLedgerRow), params);
  }

  async purgeLedger(beforeUtcDay: string): Promise<number> {
    const deleted = await deleteInBatches(this.db, this.requests().where('utcDay', '<', beforeUtcDay));
    // The counters go after their rows: an interruption leaves a purged day counted, never a day
    // whose rows remain uncounted.
    await deleteInBatches(this.db, this.admission().where('utcDay', '<', beforeUtcDay));
    return deleted;
  }

  purgeIdleUsage(beforeUtcDay: string): Promise<number> {
    return settle(() => deleteInBatches(this.db, this.usage().where('lastCreditedDay', '<', beforeUtcDay)));
  }

  async deviceRecords(deviceId: string): Promise<DeviceUsageRecords> {
    const [ledger, usage] = await Promise.all([this.requests().where('deviceId', '==', deviceId).get(), this.usage().doc(firestoreKey(deviceId)).get()]);
    const totals = usage.exists ? (usage.data() as UsageDoc) : undefined;
    return {
      ledger: ledger.docs.map(toLedgerRow).sort(byStart),
      usage: totals
        ? {
            deviceId,
            promptTokens: totals.promptTokens,
            completionTokens: totals.completionTokens,
            totalTokens: totals.totalTokens,
            lastCreditedDay: totals.lastCreditedDay,
          }
        : null,
    };
  }

  /**
   * Deletes the device's ledger rows, its admission counters and its usage document. Each chunk of
   * rows goes in one transaction that also takes their non-refunded units off the counters, so the
   * global counts afterwards are what the remaining rows add up to (as the SQLite store, which
   * counts rows, sees them). A device counter left at zero is deleted with the rows.
   */
  async deleteDeviceRecords(deviceId: string): Promise<DeviceUsageDeleted> {
    let ledger = 0;
    const chunk = this.requests().where('deviceId', '==', deviceId).limit(DEVICE_DELETE_CHUNK);
    for (;;) {
      const deleted = await this.db.runTransaction((tx) => this.deleteLedgerChunk(tx, chunk), { maxAttempts: ADMISSION_MAX_ATTEMPTS });
      ledger += deleted;
      if (deleted < DEVICE_DELETE_CHUNK) break;
    }
    const counters = this.admission().where('deviceId', '==', deviceId);
    await this.db.runTransaction(async (tx) => {
      const snapshot = await tx.get(counters);
      for (const counter of snapshot.docs) if (countOf(counter) <= 0) tx.delete(counter.ref);
    });
    const usageRef = this.usage().doc(firestoreKey(deviceId));
    const usage = await this.db.runTransaction(async (tx) => {
      const snapshot = await tx.get(usageRef);
      if (snapshot.exists) tx.delete(usageRef);
      return snapshot.exists ? 1 : 0;
    });
    return { ledger, usage };
  }

  private async deleteLedgerChunk(tx: Transaction, chunk: Query): Promise<number> {
    const snapshot = await tx.get(chunk);
    const units = new Map<string, { row: RequestDoc; units: number }>();
    for (const doc of snapshot.docs) {
      const row = doc.data() as RequestDoc;
      if (row.refunded) continue;
      const id = deviceCounterId(row.utcDay, row.kind, row.deviceId);
      const entry = units.get(id) ?? { row, units: 0 };
      entry.units++;
      units.set(id, entry);
    }
    const entries = [...units.values()];
    const counters = entries.length > 0 ? await tx.getAll(...entries.map(({ row }) => this.deviceCounter(row.utcDay, row.kind, row.deviceId))) : [];
    for (const doc of snapshot.docs) tx.delete(doc.ref);
    entries.forEach(({ row, units: released }, i) => {
      const { utcDay, kind } = row;
      const remaining = countOf(counters[i]) - released;
      if (remaining <= 0) tx.delete(counters[i].ref);
      else tx.update(counters[i].ref, { count: remaining });
      tx.set(this.globalCounter(utcDay, kind), { utcDay, kind, count: FieldValue.increment(-released) }, { merge: true });
    });
    return snapshot.size;
  }

  /** The client belongs to whoever opened it (`OpenedStores.close` terminates it). */
  close(): Promise<void> {
    return Promise.resolve();
  }
}
