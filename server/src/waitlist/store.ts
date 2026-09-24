/**
 * WaitlistStore + NodeSqliteWaitlistStore (beta-waitlist design D4; spec "One row per person",
 * "Retention and operator access").
 *
 * The beta waitlist is the one place the server keeps an email address, so it lives in its own
 * SQLite file (`WHIM_DATA_DIR/waitlist.db`), shaped like the reports store: WAL, `secure_delete`
 * so a removal or purge overwrites freed pages, `busy_timeout` so the operator command never
 * collides with a live signup, and `CREATE TABLE IF NOT EXISTS` for the schema.
 *
 * One row per normalized email (trimmed, lowercased). A repeat signup updates the answers, the
 * notice id and `updated_at`, and keeps `created_at`, so a person changes their answers by signing
 * up again. Rows go `WAITLIST_RETENTION_DAYS` after `updated_at`; the privacy policy states the
 * same number (the site suite holds the two together).
 */
import { DatabaseSync } from 'node:sqlite';

export const WAITLIST_PLATFORMS = ['ios', 'android', 'other'] as const;
export type WaitlistPlatform = (typeof WAITLIST_PLATFORMS)[number];

/** Days after a row's `updated_at` that the purge deletes it. */
export const WAITLIST_RETENTION_DAYS = 730;

const DAY_MS = 86_400_000;

export function isWaitlistPlatform(value: string): value is WaitlistPlatform {
  return (WAITLIST_PLATFORMS as readonly string[]).includes(value);
}

/** The one spelling a person's email is stored and looked up under. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export interface WaitlistSignup {
  /** As submitted; the store normalizes it. */
  readonly email: string;
  readonly platform: WaitlistPlatform;
  readonly updatesOptOut: boolean;
  readonly noticeId: string;
  /** Injected clock reading (ms since epoch). */
  readonly now: number;
}

export interface WaitlistRow {
  readonly email: string;
  readonly platform: WaitlistPlatform;
  readonly updatesOptOut: boolean;
  readonly noticeId: string;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface WaitlistFilter {
  readonly platform?: WaitlistPlatform;
  /** Only rows without the opt-out. */
  readonly updatesOk?: boolean;
}

/** `stored`: a new row. `updated`: an existing row's answers were replaced. */
export type UpsertOutcome = 'stored' | 'updated';

export interface WaitlistStore {
  upsert(signup: WaitlistSignup): UpsertOutcome;
  /** Matching rows, oldest signup first. */
  export(filter?: WaitlistFilter): WaitlistRow[];
  /** Removes the row for `email` in any casing; whether one was there. */
  remove(email: string): boolean;
  /** Deletes rows whose `updated_at` is more than `WAITLIST_RETENTION_DAYS` before `now`. Returns
   *  how many went. */
  purge(now: number): number;
}

/** A row is kept while its `updated_at` is at or after this. */
export function purgeCutoff(now: number): number {
  return now - WAITLIST_RETENTION_DAYS * DAY_MS;
}

function matches(row: WaitlistRow, filter: WaitlistFilter): boolean {
  if (filter.platform !== undefined && row.platform !== filter.platform) return false;
  return !(filter.updatesOk === true && row.updatesOptOut);
}

function byCreated(a: WaitlistRow, b: WaitlistRow): number {
  return a.createdAt - b.createdAt || a.email.localeCompare(b.email);
}

/** In-memory twin for tests: same semantics, no file. */
export class InMemoryWaitlistStore implements WaitlistStore {
  private readonly rows = new Map<string, WaitlistRow>();

  upsert(signup: WaitlistSignup): UpsertOutcome {
    const email = normalizeEmail(signup.email);
    const existing = this.rows.get(email);
    this.rows.set(email, {
      email,
      platform: signup.platform,
      updatesOptOut: signup.updatesOptOut,
      noticeId: signup.noticeId,
      createdAt: existing?.createdAt ?? signup.now,
      updatedAt: signup.now,
    });
    return existing === undefined ? 'stored' : 'updated';
  }

  export(filter: WaitlistFilter = {}): WaitlistRow[] {
    return [...this.rows.values()].filter((row) => matches(row, filter)).sort(byCreated).map((row) => ({ ...row }));
  }

  remove(email: string): boolean {
    return this.rows.delete(normalizeEmail(email));
  }

  purge(now: number): number {
    const cutoff = purgeCutoff(now);
    let deleted = 0;
    for (const [email, row] of this.rows) {
      if (row.updatedAt < cutoff) {
        this.rows.delete(email);
        deleted++;
      }
    }
    return deleted;
  }
}

interface RawRow {
  email: string;
  platform: string;
  updates_opt_out: number;
  notice_id: string;
  created_at: number;
  updated_at: number;
}

function fromRaw(row: RawRow): WaitlistRow {
  return {
    email: row.email,
    platform: row.platform as WaitlistPlatform,
    updatesOptOut: row.updates_opt_out === 1,
    noticeId: row.notice_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Durable store on its own file. `close()` releases the handle. */
export class NodeSqliteWaitlistStore implements WaitlistStore {
  private readonly db: DatabaseSync;

  constructor(dbPath: string) {
    this.db = new DatabaseSync(dbPath);
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec('PRAGMA busy_timeout = 5000');
    this.db.exec('PRAGMA secure_delete = ON');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS waitlist (
        email TEXT PRIMARY KEY,
        platform TEXT NOT NULL,
        updates_opt_out INTEGER NOT NULL,
        notice_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_waitlist_updated_at ON waitlist (updated_at)');
  }

  upsert(signup: WaitlistSignup): UpsertOutcome {
    const email = normalizeEmail(signup.email);
    const existed = this.db.prepare('SELECT 1 FROM waitlist WHERE email = ?').get(email) !== undefined;
    this.db
      .prepare(`
        INSERT INTO waitlist (email, platform, updates_opt_out, notice_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT (email) DO UPDATE SET
          platform = excluded.platform,
          updates_opt_out = excluded.updates_opt_out,
          notice_id = excluded.notice_id,
          updated_at = excluded.updated_at
      `)
      .run(email, signup.platform, signup.updatesOptOut ? 1 : 0, signup.noticeId, signup.now, signup.now);
    return existed ? 'updated' : 'stored';
  }

  export(filter: WaitlistFilter = {}): WaitlistRow[] {
    const rows = this.db
      .prepare('SELECT email, platform, updates_opt_out, notice_id, created_at, updated_at FROM waitlist ORDER BY created_at, email')
      .all() as unknown as RawRow[];
    return rows.map(fromRaw).filter((row) => matches(row, filter));
  }

  remove(email: string): boolean {
    return Number(this.db.prepare('DELETE FROM waitlist WHERE email = ?').run(normalizeEmail(email)).changes) > 0;
  }

  purge(now: number): number {
    return Number(this.db.prepare('DELETE FROM waitlist WHERE updated_at < ?').run(purgeCutoff(now)).changes);
  }

  close(): void {
    this.db.close();
  }
}

export interface WaitlistPurgeSchedule {
  stop(): void;
}

export interface WaitlistPurgeOptions {
  readonly now: () => number;
  /** Defaults to one hour, as the reports purge. */
  readonly intervalMs?: number;
  /** A failed purge never throws into the timer; the next tick tries again. */
  readonly onError: (err: unknown) => void;
}

/** Purges at once, then every `intervalMs` on an unref'd timer. */
export function scheduleWaitlistPurge(store: WaitlistStore, options: WaitlistPurgeOptions): WaitlistPurgeSchedule {
  const runOnce = (): void => {
    try {
      store.purge(options.now());
    } catch (err) {
      options.onError(err);
    }
  };
  runOnce();
  const timer = setInterval(runOnce, options.intervalMs ?? 3_600_000);
  timer.unref();
  return { stop: () => clearInterval(timer) };
}
