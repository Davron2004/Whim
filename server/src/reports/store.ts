/**
 * ReportStore + NodeSqliteReportStore (public-generation-server chain-5, design D10).
 *
 * Reports are the ONE place the server persists user-sent content (specs/content-reports
 * "Reports are the only stored user content, kept in their own store"), so they live in their
 * OWN SQLite file (`reports.db`), never `usage.db`. WAL + `PRAGMA secure_delete = ON` so a purge
 * overwrites freed pages instead of leaving content behind, and `busy_timeout = 5000` so the
 * operator CLI's reads never collide with a live insert (consistent with chain-2's usage store).
 *
 * A row always carries exactly eight fields — `note`/`appName`/`prompt`/`source` are stored as
 * `''` when the user did not send them, never `NULL` and never omitted, so "the row holds ...
 * empty source and appName" (spec scenario) is a literal equality, not an absence to special-case.
 */
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import type { ReportReason } from '@whim/contract';

export interface InsertReportParams {
  deviceId: string;
  reason: ReportReason;
  note?: string;
  appName?: string;
  prompt?: string;
  source?: string;
  /** Injected clock reading (ms since epoch) — becomes the row's `receivedAt`. */
  now: number;
}

/** Exactly the columns specs/content-reports names — nothing else. */
export interface ReportRow {
  reportId: string;
  receivedAt: number;
  deviceId: string;
  reason: ReportReason;
  note: string;
  appName: string;
  prompt: string;
  source: string;
}

export interface ListReportsParams {
  /** Injected clock reading driving the `sinceDays` cutoff. */
  now: number;
  /** Only reports received within this many trailing days. Omit for no time bound. */
  sinceDays?: number;
  /** Row cap, newest first. Defaults to 50. */
  limit?: number;
}

/** The operator-facing list shape — sizes only, never prompt/source text (spec "Listing hides
 *  bulky content"). */
export interface ReportListItem {
  reportId: string;
  receivedAt: number;
  reason: ReportReason;
  appName: string;
  note: string;
  promptBytes: number;
  sourceBytes: number;
}

export interface ReportStore {
  /** Inserts one report and returns its server-generated id. */
  insert(params: InsertReportParams): Promise<string>;
  list(params: ListReportsParams): Promise<ReportListItem[]>;
  get(reportId: string): Promise<ReportRow | undefined>;
  /** Deletes rows with `receivedAt` strictly before `cutoffMs` and reclaims their storage.
   *  Returns the number of rows deleted. */
  purgeOlderThan(cutoffMs: number): Promise<number>;
}

export interface PurgeScheduleOptions {
  /** WHIM_REPORT_RETENTION_DAYS — rows older than this many days are purged. */
  retentionDays: number;
  /** Injected clock. Defaults to `Date.now`. */
  now?: () => number;
  /** Defaults to one hour (design D10: "Purge runs at boot and hourly"). */
  intervalMs?: number;
}

export interface PurgeSchedule {
  stop(): void;
}

/** Runs a purge immediately, then every `intervalMs` on an unref'd timer, for the process's
 *  lifetime — the timer never keeps the process alive on its own (composition calls `stop()` on
 *  shutdown, but exit does not depend on it). Errors from a scheduled purge are never thrown into
 *  the timer (an unhandled rejection would crash the process); the next tick tries again. */
export function schedulePurge(store: ReportStore, options: PurgeScheduleOptions): PurgeSchedule {
  const now = options.now ?? Date.now;
  const intervalMs = options.intervalMs ?? 3_600_000;

  const runOnce = (): void => {
    const cutoffMs = now() - options.retentionDays * 86_400_000;
    store.purgeOlderThan(cutoffMs).catch(() => {
      // Swallowed deliberately: a failed scheduled purge must not crash the process or stop
      // future ticks. The operator's `reports purge` subcommand surfaces a failure explicitly.
    });
  };

  runOnce();
  const timer = setInterval(runOnce, intervalMs);
  timer.unref();
  return { stop: () => clearInterval(timer) };
}

/** In-memory twin for tests — same semantics, no file on disk. */
export class InMemoryReportStore implements ReportStore {
  private readonly rows = new Map<string, ReportRow>();

  async insert(params: InsertReportParams): Promise<string> {
    const reportId = randomUUID();
    this.rows.set(reportId, {
      reportId,
      receivedAt: params.now,
      deviceId: params.deviceId,
      reason: params.reason,
      note: params.note ?? '',
      appName: params.appName ?? '',
      prompt: params.prompt ?? '',
      source: params.source ?? '',
    });
    return reportId;
  }

  async list(params: ListReportsParams): Promise<ReportListItem[]> {
    const cutoff = params.sinceDays !== undefined ? params.now - params.sinceDays * 86_400_000 : undefined;
    const rows = [...this.rows.values()]
      .filter((r) => cutoff === undefined || r.receivedAt >= cutoff)
      .sort((a, b) => b.receivedAt - a.receivedAt)
      .slice(0, params.limit ?? 50);
    return rows.map(toListItem);
  }

  async get(reportId: string): Promise<ReportRow | undefined> {
    return this.rows.get(reportId);
  }

  async purgeOlderThan(cutoffMs: number): Promise<number> {
    let deleted = 0;
    for (const [id, row] of this.rows) {
      if (row.receivedAt < cutoffMs) {
        this.rows.delete(id);
        deleted++;
      }
    }
    return deleted;
  }
}

function toListItem(row: ReportRow): ReportListItem {
  return {
    reportId: row.reportId,
    receivedAt: row.receivedAt,
    reason: row.reason,
    appName: row.appName,
    note: row.note,
    promptBytes: Buffer.byteLength(row.prompt, 'utf8'),
    sourceBytes: Buffer.byteLength(row.source, 'utf8'),
  };
}

/**
 * Durable ReportStore backed by node:sqlite, on its own file (`WHIM_DATA_DIR/reports.db`).
 * Pass `:memory:` for a transient store (tests); pass a file path for the durable production
 * store. `close()` releases the handle (required before reopening the same file).
 */
export class NodeSqliteReportStore implements ReportStore {
  private readonly db: DatabaseSync;

  constructor(dbPath: string) {
    this.db = new DatabaseSync(dbPath);
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec('PRAGMA busy_timeout = 5000');
    this.db.exec('PRAGMA secure_delete = ON');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS reports (
        id TEXT PRIMARY KEY,
        device_id TEXT NOT NULL,
        reason TEXT NOT NULL,
        received_at INTEGER NOT NULL,
        note TEXT NOT NULL DEFAULT '',
        app_name TEXT NOT NULL DEFAULT '',
        prompt TEXT NOT NULL DEFAULT '',
        source TEXT NOT NULL DEFAULT ''
      )
    `);
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_reports_received_at ON reports (received_at)
    `);
  }

  async insert(params: InsertReportParams): Promise<string> {
    const reportId = randomUUID();
    this.db.prepare(`
      INSERT INTO reports (id, device_id, reason, received_at, note, app_name, prompt, source)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      reportId,
      params.deviceId,
      params.reason,
      params.now,
      params.note ?? '',
      params.appName ?? '',
      params.prompt ?? '',
      params.source ?? '',
    );
    return reportId;
  }

  async list(params: ListReportsParams): Promise<ReportListItem[]> {
    const limit = params.limit ?? 50;
    const rows = (
      params.sinceDays !== undefined
        ? this.db.prepare(`
            SELECT id, device_id, reason, received_at, note, app_name, prompt, source
            FROM reports WHERE received_at >= ? ORDER BY received_at DESC LIMIT ?
          `).all(params.now - params.sinceDays * 86_400_000, limit)
        : this.db.prepare(`
            SELECT id, device_id, reason, received_at, note, app_name, prompt, source
            FROM reports ORDER BY received_at DESC LIMIT ?
          `).all(limit)
    ) as unknown as RawRow[];
    return rows.map((r) => toListItem(fromRawRow(r)));
  }

  async get(reportId: string): Promise<ReportRow | undefined> {
    const row = this.db.prepare(`
      SELECT id, device_id, reason, received_at, note, app_name, prompt, source
      FROM reports WHERE id = ?
    `).get(reportId) as RawRow | undefined;
    return row ? fromRawRow(row) : undefined;
  }

  async purgeOlderThan(cutoffMs: number): Promise<number> {
    const result = this.db.prepare('DELETE FROM reports WHERE received_at < ?').run(cutoffMs);
    return Number(result.changes);
  }

  /** Release the database handle. Required before re-opening the same file path. */
  close(): void {
    this.db.close();
  }
}

interface RawRow {
  id: string;
  device_id: string;
  reason: string;
  received_at: number;
  note: string;
  app_name: string;
  prompt: string;
  source: string;
}

function fromRawRow(row: RawRow): ReportRow {
  return {
    reportId: row.id,
    receivedAt: row.received_at,
    deviceId: row.device_id,
    reason: row.reason as ReportReason,
    note: row.note,
    appName: row.app_name,
    prompt: row.prompt,
    source: row.source,
  };
}
