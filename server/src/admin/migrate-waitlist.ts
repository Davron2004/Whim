/**
 * `whim-admin migrate-waitlist [--apply]` (waitlist-hardening D5; specs/beta-waitlist "Existing rows
 * move to the opt-in model without loss").
 *
 * Rewrites every waitlist row still stored in the opt-out model into the opt-in model, on the backend
 * `WHIM_STORE_BACKEND` selects, through the one legacy mapping every store read already applies
 * (`waitlistRowFromLegacy`). A migration therefore never changes how a row reads, only how it is
 * stored, and the verification read checks exactly that: after `--apply`, every row reads back as it
 * read before, and none is left in the opt-out model.
 *
 * Without `--apply` it only reads: Firestore through plain reads, SQLite through a read-only
 * connection (opening the SQLite store would convert the file). With `--apply`:
 * - **Firestore:** each legacy document is rewritten in its own transaction that re-reads it and
 *   skips it unless it is still legacy. The update writes only the consent fields and the rollback
 *   shadow, so email, platform, notice id and both timestamps are never written at all.
 * - **SQLite:** the store's own open-time conversion runs: one write transaction that selects the
 *   rows still legacy and converts them (`NodeSqliteWaitlistStore`). The store is opened only when
 *   the read found a legacy row, so an apply with nothing to migrate leaves the file untouched.
 *
 * Nothing is written when any row cannot be read (a field missing or of the wrong type). The output
 * names rows by the first 12 hex characters of their removal fingerprint (keyed, so a guessed address
 * cannot be checked against it) and never prints an address. Exit codes: 0 done (and, with
 * `--apply`, verified), 1 usage or refusal before any read, 2 a row could not be read or the
 * verification read disagrees.
 */
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { isDeepStrictEqual } from 'node:util';
import type { Firestore } from '@google-cloud/firestore';
import type { ServerConfig } from '../config';
import { openFirestoreClient, type FirestoreRoot } from '../firestore/client';
import { WAITLIST_COLLECTION, waitlistDocOf } from '../firestore/waitlist-store';
import {
  NodeSqliteWaitlistStore,
  byCreated,
  isWaitlistPlatform,
  waitlistFingerprinter,
  waitlistRowFromLegacy,
  type WaitlistRow,
} from '../waitlist/store';
import type { AdminCliResult } from './cli';

/** The configuration the migration reads. */
export type MigrateConfig = Pick<ServerConfig, 'storeBackend' | 'firestoreDatabase' | 'dataDir' | 'waitlistFingerprintKey'>;

export interface MigrateDeps {
  /** Opens the Firestore client. Defaults to `openFirestoreClient` (one probe read). */
  readonly openFirestore?: (database: string) => Promise<Firestore>;
  /** Where the collections live. Defaults to the database root. */
  readonly root?: (db: Firestore) => FirestoreRoot;
}

const USAGE = 'Usage: migrate-waitlist [--apply]\n';

/** Characters of the fingerprint a row is named by in the output. */
const PRINT_LENGTH = 12;

/** One stored row as the migration read it. `key` is the store's own key (Firestore document id,
 *  SQLite primary key) and is never printed; `print` is the fingerprint prefix. A readable row's
 *  `row` is what every store read returns for it, mapped when it is `legacy`. */
type StoredRow =
  | { readonly key: string; readonly print: string; readonly row: WaitlistRow; readonly legacy: boolean }
  | { readonly key: string; readonly print: string; readonly unreadable: string };

type ReadableRow = Extract<StoredRow, { row: WaitlistRow }>;

/** What `--apply` did to one row that was legacy at the read. `already-migrated`: rewritten by
 *  someone else between the read and its own transaction. `gone`: removed in between. */
type ApplyOutcome = 'migrated' | 'already-migrated' | 'gone' | 'not-migrated';

interface MigrationTarget {
  /** Where the rows live, for the header line. */
  readonly label: string;
  /** Every stored row, without writing anything. */
  read(): Promise<StoredRow[]>;
  /** Rewrites `rows`, each legacy at the read, into the opt-in model. */
  migrate(rows: readonly ReadableRow[]): Promise<Map<string, ApplyOutcome>>;
}

function isNullable<T>(value: unknown, guard: (value: unknown) => value is T): value is T | null {
  return value === null || guard(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

/** A stored record of either model, as a row; unreadable when any field the model needs is missing
 *  or of the wrong type. A record without a boolean `updatesOptIn` is legacy. */
function parseStored(key: string, data: Record<string, unknown>, fingerprint: (email: string) => string): StoredRow {
  const print = isString(data.email) ? fingerprint(data.email).slice(0, PRINT_LENGTH) : '-'.repeat(PRINT_LENGTH);
  const { email, platform, noticeId, createdAt, updatedAt } = data;
  if (!isString(email)) return { key, print, unreadable: 'email' };
  if (!isString(platform) || !isWaitlistPlatform(platform)) return { key, print, unreadable: 'platform' };
  if (!isString(noticeId)) return { key, print, unreadable: 'noticeId' };
  if (!isFiniteNumber(createdAt)) return { key, print, unreadable: 'createdAt' };
  if (!isFiniteNumber(updatedAt)) return { key, print, unreadable: 'updatedAt' };
  const kept = { email, platform, noticeId, createdAt, updatedAt };
  if (typeof data.updatesOptIn !== 'boolean') {
    if (typeof data.updatesOptOut !== 'boolean') return { key, print, unreadable: 'updatesOptOut' };
    return { key, print, legacy: true, row: waitlistRowFromLegacy({ ...kept, updatesOptOut: data.updatesOptOut }) };
  }
  const { updatesConsentAt, updatesConsentNoticeId, updatesWithdrawnAt } = data;
  if (!isNullable(updatesConsentAt, isFiniteNumber)) return { key, print, unreadable: 'updatesConsentAt' };
  if (!isNullable(updatesConsentNoticeId, isString)) return { key, print, unreadable: 'updatesConsentNoticeId' };
  if (!isNullable(updatesWithdrawnAt, isFiniteNumber)) return { key, print, unreadable: 'updatesWithdrawnAt' };
  return { key, print, legacy: false, row: { ...kept, updatesOptIn: data.updatesOptIn, updatesConsentAt, updatesConsentNoticeId, updatesWithdrawnAt } };
}

function isReadable(stored: StoredRow): stored is ReadableRow {
  return 'row' in stored;
}

/** The consent columns of a `waitlist.db` written by the opt-in-model store. */
const SQLITE_CONSENT_COLUMNS = 'updates_opt_in, updates_consent_at, updates_consent_notice_id, updates_withdrawn_at';
const SQLITE_NO_CONSENT_COLUMNS = 'NULL AS updates_opt_in, NULL AS updates_consent_at, NULL AS updates_consent_notice_id, NULL AS updates_withdrawn_at';

interface SqliteRaw {
  email: unknown;
  platform: unknown;
  updates_opt_out: unknown;
  notice_id: unknown;
  created_at: unknown;
  updated_at: unknown;
  updates_opt_in: unknown;
  updates_consent_at: unknown;
  updates_consent_notice_id: unknown;
  updates_withdrawn_at: unknown;
}

function sqliteFlag(value: unknown): unknown {
  if (value === 1) return true;
  if (value === 0) return false;
  return value;
}

/** A SQLite row in the field names a Firestore document uses; NULL `updates_opt_in` is legacy. */
function sqliteRecord(raw: SqliteRaw): Record<string, unknown> {
  const record: Record<string, unknown> = {
    email: raw.email,
    platform: raw.platform,
    updatesOptOut: sqliteFlag(raw.updates_opt_out),
    noticeId: raw.notice_id,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
  };
  if (raw.updates_opt_in === null) return record;
  return {
    ...record,
    updatesOptIn: sqliteFlag(raw.updates_opt_in),
    updatesConsentAt: raw.updates_consent_at,
    updatesConsentNoticeId: raw.updates_consent_notice_id,
    updatesWithdrawnAt: raw.updates_withdrawn_at,
  };
}

function sqliteTarget(dbPath: string, fingerprintKey: string): MigrationTarget {
  const fingerprint = waitlistFingerprinter(fingerprintKey);
  const read = (): Promise<StoredRow[]> => {
    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
      const columns = new Set((db.prepare('PRAGMA table_info(waitlist)').all() as unknown as { name: string }[]).map((column) => column.name));
      const consent = columns.has('updates_opt_in') ? SQLITE_CONSENT_COLUMNS : SQLITE_NO_CONSENT_COLUMNS;
      const raws = db.prepare(`SELECT email, platform, updates_opt_out, notice_id, created_at, updated_at, ${consent} FROM waitlist`).all() as unknown as SqliteRaw[];
      return Promise.resolve(raws.map((raw) => parseStored(String(raw.email), sqliteRecord(raw), fingerprint)));
    } finally {
      db.close();
    }
  };
  return {
    label: `sqlite ${dbPath}`,
    read,
    async migrate(rows) {
      await new NodeSqliteWaitlistStore(dbPath, { fingerprintKey }).close();
      const after = new Map((await read()).map((stored) => [stored.key, stored]));
      return new Map(
        rows.map(({ key }): [string, ApplyOutcome] => {
          const now = after.get(key);
          if (now === undefined) return [key, 'gone'];
          return [key, isReadable(now) && !now.legacy ? 'migrated' : 'not-migrated'];
        }),
      );
    },
  };
}

/** The fields a migration writes on a legacy document: the consent fields and the rollback shadow. */
function consentFieldsOf(row: WaitlistRow): Record<string, unknown> {
  const doc = waitlistDocOf(row);
  return {
    updatesOptIn: doc.updatesOptIn,
    updatesConsentAt: doc.updatesConsentAt,
    updatesConsentNoticeId: doc.updatesConsentNoticeId,
    updatesWithdrawnAt: doc.updatesWithdrawnAt,
    updatesOptOut: doc.updatesOptOut,
  };
}

function firestoreTarget(db: Firestore, root: FirestoreRoot, database: string, fingerprintKey: string): MigrationTarget {
  const fingerprint = waitlistFingerprinter(fingerprintKey);
  const collection = root.collection(WAITLIST_COLLECTION);
  return {
    label: `firestore database ${database}`,
    async read() {
      return (await collection.get()).docs.map((doc) => parseStored(doc.id, doc.data(), fingerprint));
    },
    async migrate(rows) {
      const outcomes = new Map<string, ApplyOutcome>();
      for (const { key } of rows) {
        const ref = collection.doc(key);
        const outcome = await db.runTransaction(async (tx): Promise<ApplyOutcome> => {
          const snapshot = await tx.get(ref);
          if (!snapshot.exists) return 'gone';
          const current = parseStored(key, snapshot.data() ?? {}, fingerprint);
          if (!isReadable(current)) return 'not-migrated';
          if (!current.legacy) return 'already-migrated';
          tx.update(ref, consentFieldsOf(current.row));
          return 'migrated';
        });
        outcomes.set(key, outcome);
      }
      return outcomes;
    },
  };
}

function rowLine(outcome: string, print: string, row: WaitlistRow): string {
  return [
    outcome,
    print,
    `platform=${row.platform}`,
    `noticeId=${row.noticeId}`,
    `createdAt=${row.createdAt}`,
    `updatedAt=${row.updatedAt}`,
    `updatesOptIn=${row.updatesOptIn}`,
    `updatesConsentAt=${row.updatesConsentAt}`,
    `updatesConsentNoticeId=${row.updatesConsentNoticeId}`,
    `updatesWithdrawnAt=${row.updatesWithdrawnAt}`,
  ].join(' ');
}

/** Rows oldest signup first (unreadable ones last), as the export orders them. */
function ordered(rows: readonly StoredRow[]): StoredRow[] {
  return [...rows].sort((a, b) => {
    if (isReadable(a) && isReadable(b)) return byCreated(a.row, b.row);
    return Number(!isReadable(a)) - Number(!isReadable(b));
  });
}

/** The verification read: every row of the first read that was not removed meanwhile reads back
 *  exactly as it read before, and no row is left in the opt-out model. One problem per line. */
function verify(before: readonly ReadableRow[], after: readonly StoredRow[], gone: ReadonlySet<string>): string[] {
  const problems: string[] = [];
  const byKey = new Map(after.map((stored) => [stored.key, stored]));
  for (const { key, print, row } of before) {
    if (gone.has(key)) continue;
    const now = byKey.get(key);
    if (now === undefined) {
      problems.push(`VERIFY FAILED ${print}: the row is missing after the run`);
    } else if (isReadable(now) && !isDeepStrictEqual(now.row, row)) {
      const fields = (Object.keys(row) as (keyof WaitlistRow)[]).filter((field) => now.row[field] !== row[field]);
      problems.push(`VERIFY FAILED ${print}: ${fields.join(', ')} differ from the first read`);
    }
  }
  for (const stored of after) {
    if (!isReadable(stored)) problems.push(`VERIFY FAILED ${stored.print}: unreadable (${stored.unreadable})`);
    else if (stored.legacy) problems.push(`VERIFY FAILED ${stored.print}: still in the opt-out model`);
  }
  return problems;
}

function storedLine(outcome: string, stored: StoredRow): string {
  return isReadable(stored) ? rowLine(outcome, stored.print, stored.row) : `${outcome} ${stored.print} unreadable (${stored.unreadable})`;
}

function result(exitCode: number, lines: readonly string[]): AdminCliResult {
  return { exitCode, output: lines.join('\n') + '\n' };
}

/** Lists every row of a read that holds an unreadable one, and refuses to write. */
function refuseUnreadable(lines: string[], first: readonly StoredRow[]): AdminCliResult {
  for (const stored of first) {
    if (!isReadable(stored)) lines.push(`unreadable ${stored.print} (${stored.unreadable})`);
    else lines.push(rowLine(stored.legacy ? 'legacy' : 'already-migrated', stored.print, stored.row));
  }
  lines.push(`refused: ${first.filter((stored) => !isReadable(stored)).length} row(s) cannot be read; nothing was written`);
  return result(2, lines);
}

function dryRun(lines: string[], readable: readonly ReadableRow[]): AdminCliResult {
  for (const { print, row, legacy } of readable) lines.push(rowLine(legacy ? 'planned' : 'already-migrated', print, row));
  const planned = readable.filter((stored) => stored.legacy).length;
  lines.push(`totals: ${planned} planned, ${readable.length - planned} already migrated, ${readable.length} total`);
  return result(0, lines);
}

async function applyRun(target: MigrationTarget, lines: string[], readable: readonly ReadableRow[]): Promise<AdminCliResult> {
  const legacy = readable.filter((stored) => stored.legacy);
  const outcomes = legacy.length === 0 ? new Map<string, ApplyOutcome>() : await target.migrate(legacy);
  const outcomeOf = (stored: ReadableRow): ApplyOutcome => {
    if (!stored.legacy) return 'already-migrated';
    return outcomes.get(stored.key) ?? 'not-migrated';
  };
  for (const stored of readable) lines.push(rowLine(outcomeOf(stored), stored.print, stored.row));
  const withOutcome = (outcome: ApplyOutcome): ReadableRow[] => readable.filter((stored) => outcomeOf(stored) === outcome);
  const gone = withOutcome('gone');
  lines.push(`totals: ${withOutcome('migrated').length} migrated, ${withOutcome('already-migrated').length} already migrated, ${readable.length} total`);
  if (gone.length > 0) lines.push(`gone: ${gone.length} row(s) removed between the read and their rewrite`);
  if (legacy.length === 0) lines.push('nothing to migrate: every row is already in the opt-in model; nothing was written');

  const after = ordered(await target.read());
  for (const stored of after) lines.push(storedLine('read-back', stored));
  const problems = verify(readable, after, new Set(gone.map((stored) => stored.key)));
  lines.push(...problems);
  if (problems.length > 0) return result(2, lines);
  lines.push(`verified: ${after.length} row(s) read back, none in the opt-out model, every earlier row unchanged`);
  return result(0, lines);
}

async function run(target: MigrationTarget, apply: boolean): Promise<AdminCliResult> {
  const lines = [apply ? `migrate-waitlist --apply on ${target.label}` : `migrate-waitlist dry run on ${target.label}: nothing is written (--apply writes)`];
  const first = ordered(await target.read());
  const readable = first.filter(isReadable);
  if (readable.length < first.length) return refuseUnreadable(lines, first);
  return apply ? applyRun(target, lines, readable) : dryRun(lines, readable);
}

/** Runs `migrate-waitlist <argv>` against the configured backend. Rejects when a read or write fails. */
export async function runMigrateWaitlist(argv: readonly string[], config: MigrateConfig, deps: MigrateDeps = {}): Promise<AdminCliResult> {
  const apply = argv.length === 1 && argv[0] === '--apply';
  if (argv.length > 0 && !apply) return { exitCode: 1, output: USAGE };
  if (config.storeBackend !== 'firestore') {
    const dbPath = path.join(config.dataDir, 'waitlist.db');
    if (!fs.existsSync(dbPath)) return { exitCode: 1, output: `no waitlist at ${dbPath}; nothing was read or written\n` };
    return run(sqliteTarget(dbPath, config.waitlistFingerprintKey), apply);
  }
  const db = await (deps.openFirestore ?? openFirestoreClient)(config.firestoreDatabase);
  try {
    return await run(firestoreTarget(db, deps.root?.(db) ?? db, config.firestoreDatabase, config.waitlistFingerprintKey), apply);
  } finally {
    await db.terminate();
  }
}
