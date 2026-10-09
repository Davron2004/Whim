/**
 * WaitlistStore + NodeSqliteWaitlistStore (beta-waitlist design D4; waitlist-hardening D2, D3, D5;
 * spec "One row per person", "News emails need express consent, and a withdrawal is sticky",
 * "Removed addresses stay removed", "Retention and operator access").
 *
 * The beta waitlist is the one place the server keeps an email address, so it lives in its own
 * SQLite file (`WHIM_DATA_DIR/waitlist.db`), shaped like the reports store: WAL, `secure_delete`
 * so a removal or purge overwrites freed pages, `busy_timeout` so the operator command never
 * collides with a live signup, and `CREATE TABLE IF NOT EXISTS` for the schema.
 *
 * One row per normalized email (trimmed, lowercased). A repeat signup updates platform, notice id
 * and `updated_at`, applies the news-consent rules (`consentAfterSignup`) and keeps `created_at`.
 * News consent comes only from a ticked box or an operator `setUpdates(…, true)`; once withdrawn, no
 * signup turns it back on. Rows go `WAITLIST_RETENTION_DAYS` after `updated_at`; the privacy policy
 * states the same number (the site suite holds the two together).
 *
 * Removing an address deletes its row and keeps its fingerprint, the HMAC-SHA-256 of the
 * normalized email under a server key the store is given and never stores, logs or exports. A
 * signup whose fingerprint is kept stores nothing (`suppressed`). Fingerprints go
 * `WAITLIST_FINGERPRINT_RETENTION_DAYS` after the removal, or earlier through `restore`.
 *
 * A row written by the opt-out-model code (no consent fields) is read through `waitlistRowFromLegacy`
 * on every backend until it is rewritten, which its first write does.
 */
import { createHmac, randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { settle } from '../settle';
import { byUtf8Bytes } from '../text-order';

export const WAITLIST_PLATFORMS = ['ios', 'android', 'other'] as const;
export type WaitlistPlatform = (typeof WAITLIST_PLATFORMS)[number];

/** Days after a row's `updated_at` that the purge deletes it. */
export const WAITLIST_RETENTION_DAYS = 730;

/** Days after a removal that the purge deletes the address's fingerprint: the waitlist's published
 *  maximum, so a fingerprint never outlives the keep-period the privacy policy states. */
export const WAITLIST_FINGERPRINT_RETENTION_DAYS = 730;

/** The consent notice id an operator `setUpdates(…, true)` records: the person's written request. */
export const WRITTEN_REQUEST_NOTICE_ID = 'written-request';

/** The shortest fingerprint key a store accepts (characters). */
export const WAITLIST_FINGERPRINT_KEY_MIN_LENGTH = 32;

const DAY_MS = 86_400_000;

export function isWaitlistPlatform(value: string): value is WaitlistPlatform {
  return (WAITLIST_PLATFORMS as readonly string[]).includes(value);
}

/** The one spelling a person's email is stored and looked up under. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** The removal fingerprint of `email` in any casing or spacing: hex HMAC-SHA-256 of its normalized
 *  form under `key`. Without the key, a guessed address cannot be checked against it. */
export function waitlistFingerprint(key: string, email: string): string {
  return createHmac('sha256', key).update(normalizeEmail(email)).digest('hex');
}

/** `email → fingerprint` under `key`, refusing a key shorter than the minimum. The key lives only
 *  in the returned closure, so it is never a field of a store. */
export function waitlistFingerprinter(key: string): (email: string) => string {
  if (key.length < WAITLIST_FINGERPRINT_KEY_MIN_LENGTH) {
    throw new Error(`the waitlist fingerprint key must be at least ${WAITLIST_FINGERPRINT_KEY_MIN_LENGTH} characters`);
  }
  return (email) => waitlistFingerprint(key, email);
}

/** What a durable waitlist store is constructed with. */
export interface WaitlistStoreOptions {
  /** The HMAC key of removal fingerprints (`WHIM_WAITLIST_FINGERPRINT_KEY`). */
  readonly fingerprintKey: string;
}

/** A row's news-consent state. `updatesOptIn` is whether news may be sent now. `updatesConsentAt`
 *  and `updatesConsentNoticeId` record the latest consent (a notice id, or `written-request`), and
 *  stay as its record after a withdrawal; both are null when there never was one. While
 *  `updatesWithdrawnAt` is set, no signup changes any of the four. */
export interface WaitlistConsent {
  readonly updatesOptIn: boolean;
  readonly updatesConsentAt: number | null;
  readonly updatesConsentNoticeId: string | null;
  readonly updatesWithdrawnAt: number | null;
}

export interface WaitlistSignup {
  /** As submitted; the store normalizes it. */
  readonly email: string;
  readonly platform: WaitlistPlatform;
  /** Whether the news box was ticked. */
  readonly updatesOptIn: boolean;
  readonly noticeId: string;
  /** Injected clock reading (ms since epoch). */
  readonly now: number;
}

export interface WaitlistRow extends WaitlistConsent {
  readonly email: string;
  readonly platform: WaitlistPlatform;
  readonly noticeId: string;
  readonly createdAt: number;
  readonly updatedAt: number;
}

/** A row as the opt-out-model code stored it (before waitlist-hardening): no consent fields, and
 *  `updatesOptOut` set when the person ticked "Don't email me". */
export interface LegacyWaitlistRow {
  readonly email: string;
  readonly platform: WaitlistPlatform;
  readonly updatesOptOut: boolean;
  readonly noticeId: string;
  readonly createdAt: number;
  readonly updatedAt: number;
}

const NO_CONSENT: WaitlistConsent = { updatesOptIn: false, updatesConsentAt: null, updatesConsentNoticeId: null, updatesWithdrawnAt: null };

/** The one legacy mapping every backend and the migration share. The opt-out box never obtained
 *  consent, so no legacy row has any; a ticked opt-out becomes a withdrawal at the row's
 *  `updatedAt`. Email, platform, notice id and both timestamps carry over unchanged. */
export function waitlistRowFromLegacy(row: LegacyWaitlistRow): WaitlistRow {
  const consent: WaitlistConsent = row.updatesOptOut ? { ...NO_CONSENT, updatesWithdrawnAt: row.updatedAt } : NO_CONSENT;
  return { email: row.email, platform: row.platform, noticeId: row.noticeId, createdAt: row.createdAt, updatedAt: row.updatedAt, ...consent };
}

/** The consent fields of `row`, and nothing else. */
function consentOf(row: WaitlistConsent): WaitlistConsent {
  return { updatesOptIn: row.updatesOptIn, updatesConsentAt: row.updatesConsentAt, updatesConsentNoticeId: row.updatesConsentNoticeId, updatesWithdrawnAt: row.updatesWithdrawnAt };
}

/** The consent a signup leaves on a row whose consent was `current` (`undefined`: a new row). */
export function consentAfterSignup(current: WaitlistConsent | undefined, signup: Pick<WaitlistSignup, 'updatesOptIn' | 'noticeId' | 'now'>): WaitlistConsent {
  const consented: WaitlistConsent = { updatesOptIn: true, updatesConsentAt: signup.now, updatesConsentNoticeId: signup.noticeId, updatesWithdrawnAt: null };
  if (current === undefined) return signup.updatesOptIn ? consented : NO_CONSENT;
  const kept = consentOf(current);
  if (signup.updatesOptIn) return kept.updatesOptIn || kept.updatesWithdrawnAt !== null ? kept : consented;
  return kept.updatesOptIn ? { ...kept, updatesOptIn: false, updatesWithdrawnAt: signup.now } : kept;
}

/** The consent an operator change leaves: `on` records consent now under `written-request` and
 *  clears any withdrawal; off withdraws now (keeping an earlier withdrawal's time). */
export function consentAfterOperator(current: WaitlistConsent, on: boolean, now: number): WaitlistConsent {
  if (on) return { updatesOptIn: true, updatesConsentAt: now, updatesConsentNoticeId: WRITTEN_REQUEST_NOTICE_ID, updatesWithdrawnAt: null };
  const kept = consentOf(current);
  return { ...kept, updatesOptIn: false, updatesWithdrawnAt: kept.updatesWithdrawnAt ?? now };
}

export interface WaitlistFilter {
  readonly platform?: WaitlistPlatform;
  /** Only rows with news consent. */
  readonly updatesOk?: boolean;
}

/** `stored`: a new row. `updated`: an existing row was signed up again. `suppressed`: the address
 *  was removed (its fingerprint is kept), so nothing was stored. */
export type UpsertOutcome = 'stored' | 'updated' | 'suppressed';

/** What one purge deleted. */
export interface WaitlistPurgeCounts {
  readonly rows: number;
  readonly fingerprints: number;
}

export interface WaitlistStore {
  upsert(signup: WaitlistSignup): Promise<UpsertOutcome>;
  /** Matching rows, oldest signup first. */
  export(filter?: WaitlistFilter): Promise<WaitlistRow[]>;
  /** Deletes the row for `email` in any casing and keeps its fingerprint (kept at `now`), whether
   *  or not a row was there; resolves to whether one was. */
  remove(email: string, now: number): Promise<boolean>;
  /** Turns news consent on (`written-request`) or off for the row of `email`, leaving `updated_at`
   *  as it is; resolves to whether a row was there. */
  setUpdates(email: string, on: boolean, now: number): Promise<boolean>;
  /** Deletes the fingerprint of `email`; resolves to whether one was kept. */
  restore(email: string): Promise<boolean>;
  /** Deletes rows whose `updated_at` is more than `WAITLIST_RETENTION_DAYS` before `now`, and
   *  fingerprints kept more than `WAITLIST_FINGERPRINT_RETENTION_DAYS` before it. */
  purge(now: number): Promise<WaitlistPurgeCounts>;
  /** Releases the store's handle or client. Nothing is called on the store after it. */
  close(): Promise<void>;
}

/** A row is kept while its `updated_at` is at or after this. */
export function purgeCutoff(now: number): number {
  return now - WAITLIST_RETENTION_DAYS * DAY_MS;
}

/** A fingerprint is kept while it was kept at or after this. */
export function fingerprintPurgeCutoff(now: number): number {
  return now - WAITLIST_FINGERPRINT_RETENTION_DAYS * DAY_MS;
}

/** Whether `row` passes `filter`. */
export function matches(row: WaitlistRow, filter: WaitlistFilter): boolean {
  if (filter.platform !== undefined && row.platform !== filter.platform) return false;
  return !(filter.updatesOk === true && !row.updatesOptIn);
}

/** Export order: oldest signup first, ties by email in UTF-8 byte order — SQLite's
 *  `ORDER BY created_at, email`, never the locale's, and not JS `<`, whose UTF-16 code units put an
 *  astral character before U+E000–U+FFFF. */
export function byCreated(a: WaitlistRow, b: WaitlistRow): number {
  return a.createdAt - b.createdAt || byUtf8Bytes(a.email, b.email);
}

/** The row a signup leaves, given the row it found (`undefined`: none). */
export function rowAfterSignup(existing: WaitlistRow | undefined, signup: WaitlistSignup): WaitlistRow {
  return {
    email: normalizeEmail(signup.email),
    platform: signup.platform,
    noticeId: signup.noticeId,
    createdAt: existing?.createdAt ?? signup.now,
    updatedAt: signup.now,
    ...consentAfterSignup(existing, signup),
  };
}

function isLegacy(row: WaitlistRow | LegacyWaitlistRow): row is LegacyWaitlistRow {
  return !('updatesOptIn' in row);
}

/** In-memory twin for tests: same semantics, no file. Without a key it fingerprints under a random
 *  one of its own, which lasts exactly as long as its rows do. */
export class InMemoryWaitlistStore implements WaitlistStore {
  private readonly rows = new Map<string, WaitlistRow | LegacyWaitlistRow>();
  /** Fingerprint → when it was kept. */
  private readonly fingerprints = new Map<string, number>();
  private readonly fingerprint: (email: string) => string;

  constructor(options: Partial<WaitlistStoreOptions> = {}) {
    this.fingerprint = waitlistFingerprinter(options.fingerprintKey ?? randomBytes(32).toString('hex'));
  }

  /** Holds `row` exactly as the opt-out-model in-memory store held it: the twin of an unmigrated
   *  SQLite row or Firestore document, so the shared conformance suite reads one on every backend. */
  insertLegacyRow(row: LegacyWaitlistRow): void {
    this.rows.set(normalizeEmail(row.email), { ...row });
  }

  private row(email: string): WaitlistRow | undefined {
    const row = this.rows.get(email);
    return row === undefined || !isLegacy(row) ? row : waitlistRowFromLegacy(row);
  }

  upsert(signup: WaitlistSignup): Promise<UpsertOutcome> {
    return settle(() => {
      if (this.fingerprints.has(this.fingerprint(signup.email))) return 'suppressed';
      const email = normalizeEmail(signup.email);
      const existing = this.row(email);
      this.rows.set(email, rowAfterSignup(existing, signup));
      return existing === undefined ? 'stored' : 'updated';
    });
  }

  export(filter: WaitlistFilter = {}): Promise<WaitlistRow[]> {
    return settle(() =>
      [...this.rows.keys()]
        .map((email) => this.row(email))
        .filter((row): row is WaitlistRow => row !== undefined && matches(row, filter))
        .sort(byCreated)
        .map((row) => ({ ...row })),
    );
  }

  remove(email: string, now: number): Promise<boolean> {
    return settle(() => {
      this.fingerprints.set(this.fingerprint(email), now);
      return this.rows.delete(normalizeEmail(email));
    });
  }

  setUpdates(email: string, on: boolean, now: number): Promise<boolean> {
    return settle(() => {
      const key = normalizeEmail(email);
      const row = this.row(key);
      if (row === undefined) return false;
      this.rows.set(key, { ...row, ...consentAfterOperator(row, on, now) });
      return true;
    });
  }

  restore(email: string): Promise<boolean> {
    return settle(() => this.fingerprints.delete(this.fingerprint(email)));
  }

  purge(now: number): Promise<WaitlistPurgeCounts> {
    return settle(() => {
      const cutoff = purgeCutoff(now);
      let rows = 0;
      for (const [email, row] of this.rows) {
        if (row.updatedAt < cutoff) {
          this.rows.delete(email);
          rows++;
        }
      }
      const fingerprintCutoff = fingerprintPurgeCutoff(now);
      let fingerprints = 0;
      for (const [fingerprint, keptAt] of this.fingerprints) {
        if (keptAt < fingerprintCutoff) {
          this.fingerprints.delete(fingerprint);
          fingerprints++;
        }
      }
      return { rows, fingerprints };
    });
  }

  /** Nothing to release. */
  close(): Promise<void> {
    return Promise.resolve();
  }
}

/** The SQLite table of removal fingerprints. */
export const WAITLIST_SUPPRESSED_TABLE = 'waitlist_suppressed';

/** The consent columns, in the order `RawRow` names them; NULL `updates_opt_in` marks a legacy row. */
const CONSENT_COLUMNS = [
  ['updates_opt_in', 'INTEGER'],
  ['updates_consent_at', 'INTEGER'],
  ['updates_consent_notice_id', 'TEXT'],
  ['updates_withdrawn_at', 'INTEGER'],
] as const;

const SELECT_ROWS = `SELECT email, platform, updates_opt_out, notice_id, created_at, updated_at,
  updates_opt_in, updates_consent_at, updates_consent_notice_id, updates_withdrawn_at FROM waitlist`;

interface RawRow {
  email: string;
  platform: string;
  /** The rollback shadow (`!updatesOptIn`), or a legacy row's own answer. */
  updates_opt_out: number;
  notice_id: string;
  created_at: number;
  updated_at: number;
  updates_opt_in: number | null;
  updates_consent_at: number | null;
  updates_consent_notice_id: string | null;
  updates_withdrawn_at: number | null;
}

function fromRaw(row: RawRow): WaitlistRow {
  const kept = { email: row.email, platform: row.platform as WaitlistPlatform, noticeId: row.notice_id, createdAt: row.created_at, updatedAt: row.updated_at };
  if (row.updates_opt_in === null) return waitlistRowFromLegacy({ ...kept, updatesOptOut: row.updates_opt_out === 1 });
  return {
    ...kept,
    updatesOptIn: row.updates_opt_in === 1,
    updatesConsentAt: row.updates_consent_at,
    updatesConsentNoticeId: row.updates_consent_notice_id,
    updatesWithdrawnAt: row.updates_withdrawn_at,
  };
}

/** The consent columns' values for `row`, in `CONSENT_COLUMNS` order, then the shadow. */
function consentValues(row: WaitlistConsent): [number, number | null, string | null, number | null, number] {
  return [row.updatesOptIn ? 1 : 0, row.updatesConsentAt, row.updatesConsentNoticeId, row.updatesWithdrawnAt, row.updatesOptIn ? 0 : 1];
}

/** The `waitlist` table's column names. */
function columnsOf(db: DatabaseSync): Set<string> {
  return new Set((db.prepare('PRAGMA table_info(waitlist)').all() as unknown as { name: string }[]).map((column) => column.name));
}

/** Every row in the `waitlist.db` at `dbPath`, of either schema, oldest signup first, read through a
 *  read-only connection so the file is never written (the SQLite-to-Firestore import). */
export function readWaitlistFile(dbPath: string): WaitlistRow[] {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const columns = columnsOf(db);
    const select = CONSENT_COLUMNS.every(([name]) => columns.has(name))
      ? SELECT_ROWS
      : `SELECT email, platform, updates_opt_out, notice_id, created_at, updated_at, NULL AS updates_opt_in,
           NULL AS updates_consent_at, NULL AS updates_consent_notice_id, NULL AS updates_withdrawn_at FROM waitlist`;
    return (db.prepare(`${select} ORDER BY created_at, email`).all() as unknown as RawRow[]).map(fromRaw);
  } finally {
    db.close();
  }
}

/** Durable store on its own file. `close()` releases the handle. */
export class NodeSqliteWaitlistStore implements WaitlistStore {
  private readonly db: DatabaseSync;
  private readonly fingerprint: (email: string) => string;

  constructor(dbPath: string, options: WaitlistStoreOptions) {
    this.fingerprint = waitlistFingerprinter(options.fingerprintKey);
    this.db = new DatabaseSync(dbPath);
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec('PRAGMA busy_timeout = 5000');
    this.db.exec('PRAGMA secure_delete = ON');
    this.transaction(() => this.migrate());
  }

  /** Creates the schema, or brings an opt-out-model file to the opt-in model: adds the consent
   *  columns and the fingerprint table, and converts every legacy row through the shared mapping.
   *  `updates_opt_out` stays as the rollback shadow. Idempotent. */
  private migrate(): void {
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
    const columns = columnsOf(this.db);
    for (const [name, type] of CONSENT_COLUMNS) {
      if (!columns.has(name)) this.db.exec(`ALTER TABLE waitlist ADD COLUMN ${name} ${type}`);
    }
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_waitlist_updated_at ON waitlist (updated_at)');
    this.db.exec(`CREATE TABLE IF NOT EXISTS ${WAITLIST_SUPPRESSED_TABLE} (fingerprint TEXT PRIMARY KEY, suppressed_at INTEGER NOT NULL)`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_waitlist_suppressed_at ON ${WAITLIST_SUPPRESSED_TABLE} (suppressed_at)`);
    const legacy = this.db.prepare(`${SELECT_ROWS} WHERE updates_opt_in IS NULL`).all() as unknown as RawRow[];
    for (const raw of legacy) this.writeConsent(fromRaw(raw));
  }

  /** Runs `fn` in one write transaction, so another process (the operator command beside a live
   *  server) never interleaves with it. */
  private transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  private row(email: string): WaitlistRow | undefined {
    const raw = this.db.prepare(`${SELECT_ROWS} WHERE email = ?`).get(email) as unknown as RawRow | undefined;
    return raw === undefined ? undefined : fromRaw(raw);
  }

  private writeConsent(row: WaitlistRow): void {
    this.db
      .prepare('UPDATE waitlist SET updates_opt_in = ?, updates_consent_at = ?, updates_consent_notice_id = ?, updates_withdrawn_at = ?, updates_opt_out = ? WHERE email = ?')
      .run(...consentValues(row), row.email);
  }

  upsert(signup: WaitlistSignup): Promise<UpsertOutcome> {
    return settle(() =>
      this.transaction((): UpsertOutcome => {
        if (this.db.prepare(`SELECT 1 FROM ${WAITLIST_SUPPRESSED_TABLE} WHERE fingerprint = ?`).get(this.fingerprint(signup.email)) !== undefined) return 'suppressed';
        const existing = this.row(normalizeEmail(signup.email));
        const next = rowAfterSignup(existing, signup);
        this.db
          .prepare(`
            INSERT INTO waitlist (email, platform, notice_id, created_at, updated_at,
              updates_opt_in, updates_consent_at, updates_consent_notice_id, updates_withdrawn_at, updates_opt_out)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (email) DO UPDATE SET
              platform = excluded.platform,
              notice_id = excluded.notice_id,
              updated_at = excluded.updated_at,
              updates_opt_in = excluded.updates_opt_in,
              updates_consent_at = excluded.updates_consent_at,
              updates_consent_notice_id = excluded.updates_consent_notice_id,
              updates_withdrawn_at = excluded.updates_withdrawn_at,
              updates_opt_out = excluded.updates_opt_out
          `)
          .run(next.email, next.platform, next.noticeId, next.createdAt, next.updatedAt, ...consentValues(next));
        return existing === undefined ? 'stored' : 'updated';
      }),
    );
  }

  export(filter: WaitlistFilter = {}): Promise<WaitlistRow[]> {
    return settle(() => {
      const rows = this.db.prepare(`${SELECT_ROWS} ORDER BY created_at, email`).all() as unknown as RawRow[];
      return rows.map(fromRaw).filter((row) => matches(row, filter));
    });
  }

  remove(email: string, now: number): Promise<boolean> {
    return settle(() =>
      this.transaction(() => {
        const removed = Number(this.db.prepare('DELETE FROM waitlist WHERE email = ?').run(normalizeEmail(email)).changes) > 0;
        this.db
          .prepare(`INSERT INTO ${WAITLIST_SUPPRESSED_TABLE} (fingerprint, suppressed_at) VALUES (?, ?) ON CONFLICT (fingerprint) DO UPDATE SET suppressed_at = excluded.suppressed_at`)
          .run(this.fingerprint(email), now);
        return removed;
      }),
    );
  }

  setUpdates(email: string, on: boolean, now: number): Promise<boolean> {
    return settle(() =>
      this.transaction(() => {
        const row = this.row(normalizeEmail(email));
        if (row === undefined) return false;
        this.writeConsent({ ...row, ...consentAfterOperator(row, on, now) });
        return true;
      }),
    );
  }

  restore(email: string): Promise<boolean> {
    return settle(() => Number(this.db.prepare(`DELETE FROM ${WAITLIST_SUPPRESSED_TABLE} WHERE fingerprint = ?`).run(this.fingerprint(email)).changes) > 0);
  }

  purge(now: number): Promise<WaitlistPurgeCounts> {
    return settle(() =>
      this.transaction(() => ({
        rows: Number(this.db.prepare('DELETE FROM waitlist WHERE updated_at < ?').run(purgeCutoff(now)).changes),
        fingerprints: Number(this.db.prepare(`DELETE FROM ${WAITLIST_SUPPRESSED_TABLE} WHERE suppressed_at < ?`).run(fingerprintPurgeCutoff(now)).changes),
      })),
    );
  }

  close(): Promise<void> {
    return settle(() => this.db.close());
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
    store.purge(options.now()).catch((err: unknown) => options.onError(err));
  };
  runOnce();
  const timer = setInterval(runOnce, options.intervalMs ?? 3_600_000);
  timer.unref();
  return { stop: () => clearInterval(timer) };
}
