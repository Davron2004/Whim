/**
 * UsageStore interface + in-memory implementation (chain-C seam).
 * NodeSqliteUsageStore (durable, chain-D) appended below.
 *
 * Extended by chain-2 (design D7, specs/server-admission-control "The usage store keeps a
 * content-free request ledger with resolved cost") with the `requests` ledger table: one row per
 * admitted request, holding NO prompt/source/app content — only ids, a kind, a UTC day, timing,
 * an outcome, token counts, a resolved (or explicitly unresolved) USD cost, and the provider
 * generation ids that cost is summed from, kept until it resolves so a sweep can retry. `admit` is the
 * ONLY place a daily unit is consumed, and it counts + inserts in one immediate transaction so two
 * concurrent admits for the last unit can never both succeed.
 *
 * Extended by legal-surface-v2 chain-2 (design D9, specs/device-records): the lifetime `usage` row
 * records the UTC day it was last credited, rows idle past `WHIM_USAGE_IDLE_DAYS` are purged beside
 * the ledger's retention purge (`scheduleUsagePurge`), and `UsageRecordKeeping` gives the operator
 * command every record keyed by one device id, to export or delete.
 */
import { DatabaseSync } from 'node:sqlite';
import type { Usage } from '@whim/contract';
import { MANIFESTS, keepLimit } from '../../contract/src/disclosure-manifest';

export interface UsageStore {
  /** Add usage to the running total for a device. */
  credit(deviceId: string, usage: Usage): Promise<void>;
  /** Return accumulated totals; zeros for unknown device IDs (never an error). */
  read(deviceId: string): Promise<Usage>;

  /**
   * Atomically counts today's non-refunded rows for `deviceId` (and, when `globalLimit` is given,
   * for every device across `globalKinds`) and inserts a new `pending` ledger row, keyed by
   * `params.requestId`, when under both limits. The device limit is checked first, so a request
   * over BOTH limits refuses as `'device'` (spec: "the device limit's daily_limit refusal SHALL
   * win"). `now` drives the UTC-day bucket and the
   * `retryAfterSec` computation — never `Date.now()` read internally — so callers control day
   * rollover in tests. Implementations MUST perform the count-then-insert with no `await` between
   * them, so two overlapping calls (`Promise.all`) can never both observe room for the last unit.
   * A `requestId` already in the ledger rejects rather than replacing its row.
   */
  admit(params: AdmitParams): Promise<AdmitResult>;
  /** Marks a previously admitted request as not counting toward its daily unit. Idempotent: a
   *  repeated refund of the same request id is a no-op. */
  refund(requestId: string): Promise<void>;
  /** Records how a request ended. Idempotent: a request already settled (an `ended_at` already
   *  set) is left untouched by a later call — the row keeps its FIRST outcome. Never changes the
   *  row's `utc_day`, so a request admitted before midnight settles against its admission day even
   *  if `settle` runs after the rollover. `params.now` stamps `ended_at`; callers holding an
   *  injected clock pass it, so a test's ledger timing is its own. It falls back to `Date.now()`
   *  only for a caller with no clock to offer. */
  settle(requestId: string, params: SettleParams): Promise<void>;
  /** Records the resolver's cost verdict for a request, and (when `params.generationIds` is given)
   *  the provider generation ids a later sweep needs to re-resolve it. A `'resolved'` cost is
   *  final: it is never overwritten. An `'unresolved'` one is NOT — it may be upgraded to
   *  `'resolved'` by a later call, because the provider's stats endpoint often answers minutes
   *  after the bounded in-request attempts gave up, and a terminal `'unresolved'` would throw that
   *  cost away for good (it also biases the operator's per-generation stats low). Downgrades never
   *  happen: `'resolved'` → anything and `'unresolved'` → `'unresolved'` leave the state alone. */
  recordCost(requestId: string, params: RecordCostParams): Promise<void>;
  /** The cost-resolution sweep's candidates (`usage/resolve.ts`): rows that still carry provider
   *  generation ids to re-resolve — `'unresolved'` ones, plus `'pending'` ones whose request ended
   *  more than `stalePendingAfterMs` ago (the resolver registered its ids and then died before
   *  recording a verdict). A row whose request ended more than `maxAgeMs` ago is EXCLUDED
   *  regardless of state: without a cut-off a permanently unresolvable row (an id the provider will
   *  never index) is always the oldest and starves every newer, genuinely resolvable row — it is
   *  left in its current state and never offered again. Oldest-started first, at most `limit` rows.
   *  A row with no ids can never be re-resolved and is never returned. */
  listUnresolvedCostRows(query: CostSweepQuery): Promise<CostSweepCandidate[]>;
  /** Reads back an operator-facing summary over the trailing `params.days` UTC days ending on
   *  `params.now`'s day (inclusive). */
  summary(params: SummaryParams): Promise<UsageSummary>;
  /** Deletes ledger rows whose `utc_day` is strictly before `beforeUtcDay` (an `'YYYY-MM-DD'`
   *  string, lexicographically comparable). Returns the number of rows deleted. */
  purgeLedger(beforeUtcDay: string): Promise<number>;
}

/** A device's lifetime totals row, as the operator's device export prints it. `lastCreditedDay` is
 *  `null` only on a row a pre-change build wrote since the last open (the next open backfills it). */
export interface UsageRecord extends Usage {
  deviceId: string;
  lastCreditedDay: string | null;
}

/** Every usage-database record keyed by one device id: its ledger rows, oldest first, and its
 *  lifetime row. */
export interface DeviceUsageRecords {
  ledger: LedgerRow[];
  usage: UsageRecord | null;
}

export interface DeviceUsageDeleted {
  ledger: number;
  usage: number;
}

/** What the store keeps keyed by one device id, and for how long (specs/device-records). Separate
 *  from `UsageStore` because only the purge schedule and the operator command use it; the request
 *  path never does. */
export interface UsageRecordKeeping {
  /** Deletes lifetime `usage` rows last credited strictly before `beforeUtcDay` (`'YYYY-MM-DD'`).
   *  Returns the number of rows deleted. */
  purgeIdleUsage(beforeUtcDay: string): Promise<number>;
  /** Every record keyed by `deviceId`; empty (no ledger rows, no usage row) for an unknown id. */
  deviceRecords(deviceId: string): Promise<DeviceUsageRecords>;
  /** Deletes exactly the records `deviceRecords` returns and counts them; zeros for an unknown id. */
  deleteDeviceRecords(deviceId: string): Promise<DeviceUsageDeleted>;
}

export interface UsageStoreOptions {
  /** Injected clock (ms since epoch) for the UTC day `credit` stamps on the lifetime row and the day
   *  the `last_credited_day` migration backfills. Defaults to `Date.now`. */
  now?: () => number;
  /** The idle period the purge applies (`WHIM_USAGE_IDLE_DAYS`), which the `last_credited_day`
   *  migration dates pre-existing rows against. Opening a file that still holds such rows without
   *  it throws, so no caller can backfill a day that keeps them past their published rule. */
  usageIdleDays?: number;
}

/** The four request kinds the ledger and daily-unit accounting distinguish. */
export type RequestKind = 'generate' | 'clarify' | 'rewrite' | 'report';

/** How a ledger row's request ended. Mirrors `RunTrace.outcome` (`'delivered' | 'failed' |
 *  'expired' | 'aborted'`) plus the unary/report-specific terminal states (design D7). */
export type RequestOutcome =
  | 'delivered'
  | 'failed'
  | 'aborted'
  | 'expired'
  | 'refused'
  | 'unavailable'
  | 'ok'
  | 'error';

/** `'pending'` until the resolver runs; `'resolved'` once a cost is known; `'unresolved'` when the
 *  resolver's bounded attempts were exhausted without a provider answer. */
export type CostState = 'pending' | 'resolved' | 'unresolved';

export interface AdmitParams {
  /** The row's id: the request's own id (`x-whim-request-id`), minted at the `/v1` edge — the
   *  store never mints one, so the response header, the log lines and the ledger row agree. */
  requestId: string;
  deviceId: string;
  kind: RequestKind;
  /** Injected clock reading (ms since epoch) — drives the UTC-day bucket and `retryAfterSec`. */
  now: number;
  deviceLimit: number;
  /** Omit for kinds with no global daily ceiling. */
  globalLimit?: number;
  /** The kinds `globalLimit` is counted across; defaults to `[kind]`. `/v1/clarify` and
   *  `/v1/rewrite` share ONE ceiling, so both pass `['clarify', 'rewrite']`. */
  globalKinds?: readonly RequestKind[];
}

export interface SettleParams {
  outcome: RequestOutcome;
  usage?: Usage;
  /** Injected clock reading (ms since epoch) for `ended_at`; defaults to `Date.now()`. */
  now?: number;
}

export interface RecordCostParams {
  state: CostState;
  costUsd?: number;
  /** The provider generation ids this request's cost is summed from. Persisted so a later sweep
   *  can re-resolve the row; cleared when the cost resolves, since nothing reads them again. */
  generationIds?: readonly string[];
}

export interface CostSweepQuery {
  /** Injected clock reading (ms since epoch) — the `'pending'` staleness and `maxAgeMs` cut-offs
   *  are both measured from it. */
  now: number;
  /** How long after a request ENDED a still-`'pending'` row counts as stale. Measured from
   *  `ended_at`, never from `started_at`: a generation legitimately runs for minutes, and a row
   *  whose request is still in flight has a resolver on the way. */
  stalePendingAfterMs: number;
  /** How long after a request ENDED its row remains a candidate at all, measured from `ended_at`.
   *  A row older than this is excluded regardless of state and never re-attempted again. */
  maxAgeMs: number;
  limit: number;
}

export interface CostSweepCandidate {
  requestId: string;
  generationIds: readonly string[];
}

export type AdmitResult =
  | { ok: true; requestId: string }
  | { ok: false; reason: 'device' | 'global'; retryAfterSec: number };

export interface SummaryParams {
  /** Number of trailing UTC days to include, counting the day `now` falls in. */
  days: number;
  /** How many top-spending devices to report. Defaults to 10. */
  top?: number;
  now: number;
}

export interface UsageSummaryDay {
  utcDay: string;
  countByKind: Partial<Record<RequestKind, number>>;
  costUsdByKind: Partial<Record<RequestKind, number>>;
}

export interface UsageSummaryDevice {
  deviceId: string;
  costUsd: number;
}

export interface UsageSummaryGenerationStats {
  count: number;
  meanCostUsd: number;
  medianCostUsd: number;
  p95CostUsd: number;
  maxCostUsd: number;
  unresolvedCount: number;
}

export interface UsageSummary {
  days: UsageSummaryDay[];
  topDevicesByCost: UsageSummaryDevice[];
  generationStats: UsageSummaryGenerationStats;
}

/** Reads back the JSON array `recordCost` persisted. A value that is not an array of strings (a
 *  hand-edited row, a future format) yields no ids rather than throwing: the sweep then simply has
 *  nothing to re-resolve for that row, which is the safe direction. */
function parseGenerationIds(raw: string | null): readonly string[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  // eslint-disable-next-line no-restricted-syntax -- intentional: an unparseable persisted value means "no ids to re-resolve", never a store-level failure
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((id): id is string => typeof id === 'string');
}

const DAY_MS = 86_400_000;

/** How long version 1's disclosure keeps usage records (days after collection): the rule the
 *  totals a pre-`last_credited_day` build wrote were made under. */
const PRE_LAST_CREDITED_KEEP_DAYS = keepLimit(MANIFESTS[1], 'usage-records')?.days ?? 0;

/** Returns the request's UTC calendar day as `'YYYY-MM-DD'`. */
function utcDayString(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Whole seconds from `nowMs` to the next UTC midnight, never less than 1 (spec: "Retry-After
 *  SHALL be the whole number of seconds until the next 00:00 UTC, and at least 1"). */
function secondsUntilNextUtcMidnight(nowMs: number): number {
  const d = new Date(nowMs);
  const nextMidnight = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1, 0, 0, 0, 0);
  return Math.max(1, Math.round((nextMidnight - nowMs) / 1000));
}

/** Trailing `days` UTC-day strings ending on `utcDayString(now)`, oldest first. */
function trailingUtcDays(now: number, days: number): string[] {
  const out: string[] = [];
  for (let i = days - 1; i >= 0; i--) {
    out.push(utcDayString(now - i * 86_400_000));
  }
  return out;
}

function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

/** Shared summary computation over a flat list of rows — used by both implementations so their
 *  `summary()` semantics can never drift apart. */
function computeSummary(
  rows: readonly {
    deviceId: string;
    kind: RequestKind;
    utcDay: string;
    costUsd: number | null;
    costState: CostState;
    refunded: boolean;
  }[],
  params: SummaryParams,
): UsageSummary {
  const wantedDays = trailingUtcDays(params.now, params.days);
  const wantedSet = new Set(wantedDays);
  const inWindow = rows.filter((r) => wantedSet.has(r.utcDay));

  const days: UsageSummaryDay[] = wantedDays.map((utcDay) => {
    const dayRows = inWindow.filter((r) => r.utcDay === utcDay && !r.refunded);
    const countByKind: Partial<Record<RequestKind, number>> = {};
    const costUsdByKind: Partial<Record<RequestKind, number>> = {};
    for (const r of dayRows) {
      countByKind[r.kind] = (countByKind[r.kind] ?? 0) + 1;
      if (r.costState === 'resolved' && r.costUsd !== null) {
        costUsdByKind[r.kind] = (costUsdByKind[r.kind] ?? 0) + r.costUsd;
      }
    }
    return { utcDay, countByKind, costUsdByKind };
  });

  const costByDevice = new Map<string, number>();
  for (const r of inWindow) {
    if (r.costState === 'resolved' && r.costUsd !== null) {
      costByDevice.set(r.deviceId, (costByDevice.get(r.deviceId) ?? 0) + r.costUsd);
    }
  }
  const topDevicesByCost = [...costByDevice.entries()]
    .map(([deviceId, costUsd]) => ({ deviceId, costUsd }))
    .sort((a, b) => b.costUsd - a.costUsd)
    .slice(0, params.top ?? 10);

  const generationRows = inWindow.filter((r) => r.kind === 'generate');
  const resolvedCosts = generationRows
    .filter((r) => r.costState === 'resolved' && r.costUsd !== null)
    .map((r) => r.costUsd as number)
    .sort((a, b) => a - b);
  const unresolvedCount = generationRows.filter((r) => r.costState === 'unresolved').length;
  const sum = resolvedCosts.reduce((a, b) => a + b, 0);
  const generationStats: UsageSummaryGenerationStats = {
    count: generationRows.length,
    meanCostUsd: resolvedCosts.length > 0 ? sum / resolvedCosts.length : 0,
    medianCostUsd: percentile(resolvedCosts, 50),
    p95CostUsd: percentile(resolvedCosts, 95),
    maxCostUsd: resolvedCosts.length > 0 ? resolvedCosts[resolvedCosts.length - 1] : 0,
    unresolvedCount,
  };

  return { days, topDevicesByCost, generationStats };
}

/** Whether a `recordCost` write in state `next` may land on a row currently in `current` — the ONE
 *  definition of the cost state machine, shared by both stores so they cannot drift (the SQLite
 *  implementation mirrors it in a single `WHERE` clause). `'pending'` accepts anything (including
 *  another `'pending'` write, which is how the resolver registers its generation ids before it has
 *  a verdict); `'unresolved'` accepts only the upgrade to `'resolved'`; `'resolved'` is final. */
function costWriteLands(current: CostState, next: CostState): boolean {
  if (current === 'pending') return true;
  return current === 'unresolved' && next === 'resolved';
}

/** `globalKinds` defaults to the admitted kind — and an EMPTY array means the same thing, never
 *  "count across nothing" (which SQLite would render as `kind IN ()`, a syntax error). */
function effectiveGlobalKinds(kind: RequestKind, globalKinds: readonly RequestKind[] | undefined): readonly RequestKind[] {
  return globalKinds && globalKinds.length > 0 ? globalKinds : [kind];
}

/** One `requests` ledger row, every column. */
export interface LedgerRow {
  id: string;
  deviceId: string;
  kind: RequestKind;
  utcDay: string;
  startedAt: number;
  endedAt: number | null;
  outcome: RequestOutcome | null;
  promptTokens: number;
  completionTokens: number;
  costUsd: number | null;
  costState: CostState;
  generationIds: readonly string[] | null;
  refunded: boolean;
}

/** In-memory implementation for tests and dev (non-durable; resets when the process exits). */
export class InMemoryUsageStore implements UsageStore, UsageRecordKeeping {
  private readonly store = new Map<string, Usage>();
  private readonly lastCreditedDay = new Map<string, string>();
  private readonly ledger = new Map<string, LedgerRow>();
  private readonly now: () => number;

  constructor(options: UsageStoreOptions = {}) {
    this.now = options.now ?? Date.now;
  }

  async credit(deviceId: string, usage: Usage): Promise<void> {
    const prev = this.store.get(deviceId) ?? {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
    };
    this.store.set(deviceId, {
      promptTokens: prev.promptTokens + usage.promptTokens,
      completionTokens: prev.completionTokens + usage.completionTokens,
      totalTokens: prev.totalTokens + usage.totalTokens,
    });
    this.lastCreditedDay.set(deviceId, utcDayString(this.now()));
  }

  async read(deviceId: string): Promise<Usage> {
    return (
      this.store.get(deviceId) ?? {
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
      }
    );
  }

  async admit(params: AdmitParams): Promise<AdmitResult> {
    const { requestId, deviceId, kind, now, deviceLimit, globalLimit } = params;
    const globalKinds = effectiveGlobalKinds(kind, params.globalKinds);
    const utcDay = utcDayString(now);
    let deviceCount = 0;
    let globalCount = 0;
    for (const row of this.ledger.values()) {
      if (row.utcDay !== utcDay || row.refunded) continue;
      if (globalKinds.includes(row.kind)) globalCount++;
      if (row.kind === kind && row.deviceId === deviceId) deviceCount++;
    }
    if (deviceCount >= deviceLimit) {
      return { ok: false, reason: 'device', retryAfterSec: secondsUntilNextUtcMidnight(now) };
    }
    if (globalLimit !== undefined && globalCount >= globalLimit) {
      return { ok: false, reason: 'global', retryAfterSec: secondsUntilNextUtcMidnight(now) };
    }
    // The SQLite store's primary key refuses a reused id at this same point, after the limits.
    if (this.ledger.has(requestId)) throw new Error('UNIQUE constraint failed: requests.id');
    this.ledger.set(requestId, {
      id: requestId,
      deviceId,
      kind,
      utcDay,
      startedAt: now,
      endedAt: null,
      outcome: null,
      promptTokens: 0,
      completionTokens: 0,
      costUsd: null,
      costState: 'pending',
      generationIds: null,
      refunded: false,
    });
    return { ok: true, requestId };
  }

  async refund(requestId: string): Promise<void> {
    const row = this.ledger.get(requestId);
    if (row && !row.refunded) row.refunded = true;
  }

  async settle(requestId: string, params: SettleParams): Promise<void> {
    const row = this.ledger.get(requestId);
    if (!row || row.endedAt !== null) return;
    row.endedAt = params.now ?? Date.now();
    row.outcome = params.outcome;
    row.promptTokens = params.usage?.promptTokens ?? 0;
    row.completionTokens = params.usage?.completionTokens ?? 0;
  }

  async recordCost(requestId: string, params: RecordCostParams): Promise<void> {
    const row = this.ledger.get(requestId);
    if (!row || !costWriteLands(row.costState, params.state)) return;
    row.costState = params.state;
    row.costUsd = params.costUsd ?? null;
    row.generationIds = params.state === 'resolved' ? null : (params.generationIds ?? row.generationIds);
  }

  async listUnresolvedCostRows(query: CostSweepQuery): Promise<CostSweepCandidate[]> {
    const staleBefore = query.now - query.stalePendingAfterMs;
    const maxAgeBefore = query.now - query.maxAgeMs;
    return [...this.ledger.values()]
      .filter((row) => {
        if (!row.generationIds || row.generationIds.length === 0) return false;
        if (row.endedAt === null || row.endedAt <= maxAgeBefore) return false;
        if (row.costState === 'unresolved') return true;
        return row.costState === 'pending' && row.endedAt <= staleBefore;
      })
      .sort((a, b) => a.startedAt - b.startedAt)
      .slice(0, query.limit)
      .map((row) => ({ requestId: row.id, generationIds: row.generationIds ?? [] }));
  }

  async summary(params: SummaryParams): Promise<UsageSummary> {
    return computeSummary([...this.ledger.values()], params);
  }

  async purgeLedger(beforeUtcDay: string): Promise<number> {
    let deleted = 0;
    for (const [id, row] of this.ledger) {
      if (row.utcDay < beforeUtcDay) {
        this.ledger.delete(id);
        deleted++;
      }
    }
    return deleted;
  }

  async purgeIdleUsage(beforeUtcDay: string): Promise<number> {
    let deleted = 0;
    for (const [deviceId, day] of this.lastCreditedDay) {
      if (day < beforeUtcDay) {
        this.lastCreditedDay.delete(deviceId);
        this.store.delete(deviceId);
        deleted++;
      }
    }
    return deleted;
  }

  async deviceRecords(deviceId: string): Promise<DeviceUsageRecords> {
    const ledger = [...this.ledger.values()]
      .filter((row) => row.deviceId === deviceId)
      .sort((a, b) => a.startedAt - b.startedAt || a.id.localeCompare(b.id))
      .map((row) => ({ ...row }));
    const totals = this.store.get(deviceId);
    const usage = totals ? { deviceId, ...totals, lastCreditedDay: this.lastCreditedDay.get(deviceId) ?? null } : null;
    return { ledger, usage };
  }

  async deleteDeviceRecords(deviceId: string): Promise<DeviceUsageDeleted> {
    let ledger = 0;
    for (const [id, row] of this.ledger) {
      if (row.deviceId === deviceId) {
        this.ledger.delete(id);
        ledger++;
      }
    }
    const usage = this.store.delete(deviceId) ? 1 : 0;
    this.lastCreditedDay.delete(deviceId);
    return { ledger, usage };
  }
}

/**
 * Durable UsageStore backed by node:sqlite (built-in, Node 22+). Stores only a
 * per-device-id token counter — no prompt, source, bundle, or app content — plus the
 * content-free `requests` ledger (design D7).
 *
 * Pass `:memory:` for a transient store (tests); pass a file path for a durable
 * store under WHIM_DATA_DIR (production). Calling `close()` releases the database
 * handle (required for restart-durability tests that open the same file twice).
 */
export class NodeSqliteUsageStore implements UsageStore, UsageRecordKeeping {
  private readonly db: DatabaseSync;
  private readonly now: () => number;

  constructor(dbPath: string, options: UsageStoreOptions = {}) {
    this.now = options.now ?? Date.now;
    this.db = new DatabaseSync(dbPath);
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec('PRAGMA busy_timeout = 5000');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS usage (
        device_id TEXT PRIMARY KEY,
        prompt_tokens INTEGER NOT NULL DEFAULT 0,
        completion_tokens INTEGER NOT NULL DEFAULT 0,
        total_tokens INTEGER NOT NULL DEFAULT 0,
        last_credited_day TEXT
      )
    `);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS requests (
        id TEXT PRIMARY KEY,
        device_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        utc_day TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        ended_at INTEGER,
        outcome TEXT,
        prompt_tokens INTEGER NOT NULL DEFAULT 0,
        completion_tokens INTEGER NOT NULL DEFAULT 0,
        cost_usd REAL,
        cost_state TEXT NOT NULL CHECK(cost_state IN ('pending','resolved','unresolved')),
        generation_ids TEXT,
        refunded INTEGER NOT NULL DEFAULT 0
      )
    `);
    // Additive migration for a database written before `generation_ids` existed. `ALTER TABLE ADD
    // COLUMN` has no `IF NOT EXISTS` in SQLite, so the column list decides — re-opening an
    // already-migrated file adds nothing and re-opening a fresh one finds it in the CREATE above.
    const columns = (this.db.prepare('PRAGMA table_info(requests)').all() as { name: string }[]).map((c) => c.name);
    if (!columns.includes('generation_ids')) {
      this.db.exec('ALTER TABLE requests ADD COLUMN generation_ids TEXT');
    }
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_requests_day_kind_device
      ON requests (utc_day, kind, device_id)
    `);
    this.migrateLastCreditedDay(options.usageIdleDays);
  }

  /**
   * Additive, idempotent migration for a database written before `usage.last_credited_day` existed
   * (legal-surface-v2 D9), run on every open. Only rows with no day are touched. Their totals were
   * made under version 1's rule, which deletes them within 90 days, so they get the day that makes
   * the idle purge delete them 90 days after this run: `usageIdleDays - 90` days back (never a
   * future day). A phone that comes back is credited again and keeps them; one that never does
   * loses them within 90 days. A row a pre-change build credited since (a rollback) is caught by
   * the same backfill.
   *
   * With nothing to do (an already-migrated file) it only reads, so reopening never waits on a
   * writer and changes nothing. Otherwise the column check and the `ALTER` are repeated inside one
   * immediate transaction, so the server and a `whim-admin` opening the same file at once can't
   * both add the column.
   */
  private migrateLastCreditedDay(usageIdleDays: number | undefined): void {
    if (this.hasLastCreditedDayColumn() && this.db.prepare('SELECT 1 FROM usage WHERE last_credited_day IS NULL LIMIT 1').get() === undefined) {
      return;
    }
    this.db.exec('BEGIN IMMEDIATE');
    try {
      if (!this.hasLastCreditedDayColumn()) {
        this.db.exec('ALTER TABLE usage ADD COLUMN last_credited_day TEXT');
      }
      if (this.db.prepare('SELECT 1 FROM usage WHERE last_credited_day IS NULL LIMIT 1').get() !== undefined) {
        if (usageIdleDays === undefined) {
          throw new Error('usage.db holds lifetime rows with no last_credited_day; open it with usageIdleDays so the migration can date them');
        }
        const backdate = Math.max(0, usageIdleDays - PRE_LAST_CREDITED_KEEP_DAYS);
        this.db.prepare('UPDATE usage SET last_credited_day = ? WHERE last_credited_day IS NULL').run(utcDayString(this.now() - backdate * DAY_MS));
      }
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  private hasLastCreditedDayColumn(): boolean {
    return (this.db.prepare('PRAGMA table_info(usage)').all() as { name: string }[]).some((c) => c.name === 'last_credited_day');
  }

  async credit(deviceId: string, usage: Usage): Promise<void> {
    this.db.prepare(`
      INSERT INTO usage (device_id, prompt_tokens, completion_tokens, total_tokens, last_credited_day)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(device_id) DO UPDATE SET
        prompt_tokens = prompt_tokens + excluded.prompt_tokens,
        completion_tokens = completion_tokens + excluded.completion_tokens,
        total_tokens = total_tokens + excluded.total_tokens,
        last_credited_day = excluded.last_credited_day
    `).run(deviceId, usage.promptTokens, usage.completionTokens, usage.totalTokens, utcDayString(this.now()));
  }

  async read(deviceId: string): Promise<Usage> {
    const row = this.db.prepare(
      'SELECT prompt_tokens, completion_tokens, total_tokens FROM usage WHERE device_id = ?'
    ).get(deviceId) as { prompt_tokens: number; completion_tokens: number; total_tokens: number } | undefined;

    if (!row) {
      return { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
    }
    return {
      promptTokens: row.prompt_tokens,
      completionTokens: row.completion_tokens,
      totalTokens: row.total_tokens,
    };
  }

  async admit(params: AdmitParams): Promise<AdmitResult> {
    const { requestId, deviceId, kind, now, deviceLimit, globalLimit } = params;
    const globalKinds = effectiveGlobalKinds(kind, params.globalKinds);
    const utcDay = utcDayString(now);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const deviceRow = this.db.prepare(
        'SELECT COUNT(*) as c FROM requests WHERE kind = ? AND utc_day = ? AND device_id = ? AND refunded = 0'
      ).get(kind, utcDay, deviceId) as { c: number };
      if (deviceRow.c >= deviceLimit) {
        this.db.exec('COMMIT');
        return { ok: false, reason: 'device', retryAfterSec: secondsUntilNextUtcMidnight(now) };
      }
      if (globalLimit !== undefined) {
        const placeholders = globalKinds.map(() => '?').join(', ');
        const globalRow = this.db.prepare(
          `SELECT COUNT(*) as c FROM requests WHERE kind IN (${placeholders}) AND utc_day = ? AND refunded = 0`
        ).get(...globalKinds, utcDay) as { c: number };
        if (globalRow.c >= globalLimit) {
          this.db.exec('COMMIT');
          return { ok: false, reason: 'global', retryAfterSec: secondsUntilNextUtcMidnight(now) };
        }
      }
      this.db.prepare(`
        INSERT INTO requests
          (id, device_id, kind, utc_day, started_at, ended_at, outcome, prompt_tokens, completion_tokens, cost_usd, cost_state, generation_ids, refunded)
        VALUES (?, ?, ?, ?, ?, NULL, NULL, 0, 0, NULL, 'pending', NULL, 0)
      `).run(requestId, deviceId, kind, utcDay, now);
      this.db.exec('COMMIT');
      return { ok: true, requestId };
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  async refund(requestId: string): Promise<void> {
    this.db.prepare('UPDATE requests SET refunded = 1 WHERE id = ? AND refunded = 0').run(requestId);
  }

  async settle(requestId: string, params: SettleParams): Promise<void> {
    this.db.prepare(`
      UPDATE requests
      SET ended_at = ?, outcome = ?, prompt_tokens = ?, completion_tokens = ?
      WHERE id = ? AND ended_at IS NULL
    `).run(
      params.now ?? Date.now(),
      params.outcome,
      params.usage?.promptTokens ?? 0,
      params.usage?.completionTokens ?? 0,
      requestId,
    );
  }

  async recordCost(requestId: string, params: RecordCostParams): Promise<void> {
    // The `WHERE` is `costWriteLands` in SQL: writable while pending, and one upgrade out of
    // 'unresolved' into 'resolved'. Narrow it back to `cost_state = 'pending'` and every row the
    // in-request attempts gave up on becomes terminal, which is the bug this widening fixes.
    const ids = params.generationIds && params.generationIds.length > 0 ? JSON.stringify(params.generationIds) : null;
    this.db.prepare(`
      UPDATE requests
      SET cost_state = ?,
          cost_usd = ?,
          generation_ids = CASE WHEN ? = 'resolved' THEN NULL ELSE COALESCE(?, generation_ids) END
      WHERE id = ? AND (cost_state = 'pending' OR (cost_state = 'unresolved' AND ? = 'resolved'))
    `).run(params.state, params.costUsd ?? null, params.state, ids, requestId, params.state);
  }

  async listUnresolvedCostRows(query: CostSweepQuery): Promise<CostSweepCandidate[]> {
    // `generation_ids != '[]'` keeps a planted-empty-array row from consuming a `LIMIT` slot ahead
    // of the JS-side length filter below, which otherwise runs too late to help (defense in depth:
    // normal writes never persist '[]', see recordCost's `ids` computation).
    const rows = this.db.prepare(`
      SELECT id, generation_ids FROM requests
      WHERE generation_ids IS NOT NULL
        AND generation_ids != '[]'
        AND ended_at IS NOT NULL
        AND ended_at > ?
        AND (cost_state = 'unresolved' OR (cost_state = 'pending' AND ended_at <= ?))
      ORDER BY started_at ASC
      LIMIT ?
    `).all(query.now - query.maxAgeMs, query.now - query.stalePendingAfterMs, query.limit) as {
      id: string;
      generation_ids: string;
    }[];
    return rows
      .map((row) => ({ requestId: row.id, generationIds: parseGenerationIds(row.generation_ids) }))
      .filter((candidate) => candidate.generationIds.length > 0);
  }

  async summary(params: SummaryParams): Promise<UsageSummary> {
    const rows = this.db.prepare(
      'SELECT device_id, kind, utc_day, cost_usd, cost_state, refunded FROM requests'
    ).all() as {
      device_id: string;
      kind: RequestKind;
      utc_day: string;
      cost_usd: number | null;
      cost_state: CostState;
      refunded: number;
    }[];
    return computeSummary(
      rows.map((r) => ({
        deviceId: r.device_id,
        kind: r.kind,
        utcDay: r.utc_day,
        costUsd: r.cost_usd,
        costState: r.cost_state,
        refunded: r.refunded !== 0,
      })),
      params,
    );
  }

  async purgeLedger(beforeUtcDay: string): Promise<number> {
    const result = this.db.prepare('DELETE FROM requests WHERE utc_day < ?').run(beforeUtcDay);
    return Number(result.changes);
  }

  async purgeIdleUsage(beforeUtcDay: string): Promise<number> {
    const result = this.db.prepare('DELETE FROM usage WHERE last_credited_day < ?').run(beforeUtcDay);
    return Number(result.changes);
  }

  async deviceRecords(deviceId: string): Promise<DeviceUsageRecords> {
    const ledger = this.db.prepare(`
      SELECT id, device_id, kind, utc_day, started_at, ended_at, outcome, prompt_tokens, completion_tokens,
             cost_usd, cost_state, generation_ids, refunded
      FROM requests WHERE device_id = ? ORDER BY started_at, id
    `).all(deviceId) as unknown as RawLedgerRow[];
    const usage = this.db.prepare(
      'SELECT prompt_tokens, completion_tokens, total_tokens, last_credited_day FROM usage WHERE device_id = ?'
    ).get(deviceId) as { prompt_tokens: number; completion_tokens: number; total_tokens: number; last_credited_day: string | null } | undefined;
    return {
      ledger: ledger.map(fromRawLedgerRow),
      usage: usage
        ? {
            deviceId,
            promptTokens: usage.prompt_tokens,
            completionTokens: usage.completion_tokens,
            totalTokens: usage.total_tokens,
            lastCreditedDay: usage.last_credited_day,
          }
        : null,
    };
  }

  async deleteDeviceRecords(deviceId: string): Promise<DeviceUsageDeleted> {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const ledger = Number(this.db.prepare('DELETE FROM requests WHERE device_id = ?').run(deviceId).changes);
      const usage = Number(this.db.prepare('DELETE FROM usage WHERE device_id = ?').run(deviceId).changes);
      this.db.exec('COMMIT');
      return { ledger, usage };
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  /** Release the database handle. Required before re-opening the same file path. */
  close(): void {
    this.db.close();
  }
}

interface RawLedgerRow {
  id: string;
  device_id: string;
  kind: RequestKind;
  utc_day: string;
  started_at: number;
  ended_at: number | null;
  outcome: RequestOutcome | null;
  prompt_tokens: number;
  completion_tokens: number;
  cost_usd: number | null;
  cost_state: CostState;
  generation_ids: string | null;
  refunded: number;
}

function fromRawLedgerRow(row: RawLedgerRow): LedgerRow {
  return {
    id: row.id,
    deviceId: row.device_id,
    kind: row.kind,
    utcDay: row.utc_day,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    outcome: row.outcome,
    promptTokens: row.prompt_tokens,
    completionTokens: row.completion_tokens,
    costUsd: row.cost_usd,
    costState: row.cost_state,
    generationIds: row.generation_ids === null ? null : parseGenerationIds(row.generation_ids),
    refunded: row.refunded !== 0,
  };
}

export interface UsagePurgeOptions {
  /** WHIM_LEDGER_RETENTION_DAYS: ledger rows from a UTC day more than this many days back go. */
  ledgerRetentionDays: number;
  /** WHIM_USAGE_IDLE_DAYS: a lifetime row last credited more than this many days back goes. */
  usageIdleDays: number;
  /** Injected clock (ms since epoch) both cut-offs are measured from. */
  now: () => number;
  /** Defaults to one hour: the purge runs at boot and hourly. */
  intervalMs?: number;
  /** Told of a failed purge; the next tick tries again. */
  onError?: (message: string, err: unknown) => void;
  /** Called once each run (the boot run and every tick) has settled, so a test can await a run. */
  onTick?: () => void;
}

/** The usage database's keep-periods (design D7; legal-surface-v2 D9): at once, then every
 *  `intervalMs` on an unref'd timer, delete the ledger rows past their retention and the lifetime
 *  rows idle past the idle period. A failed purge goes to `onError`, never into the timer. */
export function scheduleUsagePurge(
  store: Pick<UsageStore, 'purgeLedger'> & Pick<UsageRecordKeeping, 'purgeIdleUsage'>,
  options: UsagePurgeOptions,
): { stop(): void } {
  const runOnce = (): void => {
    const now = options.now();
    const ledger = store
      .purgeLedger(utcDayString(now - options.ledgerRetentionDays * DAY_MS))
      .catch((err: unknown) => options.onError?.('ledger purge failed', err));
    const idle = store
      .purgeIdleUsage(utcDayString(now - options.usageIdleDays * DAY_MS))
      .catch((err: unknown) => options.onError?.('idle usage purge failed', err));
    Promise.all([ledger, idle]).finally(() => options.onTick?.());
  };
  runOnce();
  const timer = setInterval(runOnce, options.intervalMs ?? 3_600_000);
  timer.unref();
  return { stop: () => clearInterval(timer) };
}
