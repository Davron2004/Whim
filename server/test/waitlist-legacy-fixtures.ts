/**
 * Opt-out-model waitlist records, written by the opt-out-model code itself rather than hand-built:
 * the SQL and the Firestore transaction below are BASE's `NodeSqliteWaitlistStore` constructor and
 * `upsert`, and its `FirestoreWaitlistStore.upsert`, verbatim (`git show e58f8e4d:server/src/waitlist/store.ts`,
 * `…:server/src/firestore/waitlist-store.ts`; the same as 4276f86d). Production holds five such
 * people; `LEGACY_SIGNUPS` writes five rows that cover every legacy state, including a repeat signup
 * in each direction.
 */
import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { DocumentReference, Firestore } from '@google-cloud/firestore';
import type { WaitlistPlatform } from '../src/waitlist/store';

const DAY_MS = 86_400_000;

/** One signup as the opt-out-model route handed it to the store. */
export interface LegacySignup {
  readonly email: string;
  readonly platform: WaitlistPlatform;
  readonly updatesOptOut: boolean;
  readonly noticeId: string;
  readonly now: number;
}

/** 2026-09-30T12:00Z, a week after the waitlist went live. */
export const LEGACY_T0 = Date.UTC(2026, 8, 30, 12, 0, 0);

/** Five people, in signup order: unticked; ticked; unticked then ticked again later; ticked then
 *  unticked later; unticked. */
export const LEGACY_SIGNUPS: readonly LegacySignup[] = [
  { email: 'Una@Example.com', platform: 'android', updatesOptOut: false, noticeId: 'beta-1', now: LEGACY_T0 - 10 * DAY_MS },
  { email: 'tick@example.com', platform: 'ios', updatesOptOut: true, noticeId: 'beta-1', now: LEGACY_T0 - 9 * DAY_MS },
  { email: 'later-tick@example.com', platform: 'other', updatesOptOut: false, noticeId: 'beta-1', now: LEGACY_T0 - 8 * DAY_MS },
  { email: ' Later-Tick@example.com', platform: 'ios', updatesOptOut: true, noticeId: 'beta-1', now: LEGACY_T0 - 7 * DAY_MS },
  { email: 'untick@example.com', platform: 'android', updatesOptOut: true, noticeId: 'beta-1', now: LEGACY_T0 - 6 * DAY_MS },
  { email: 'untick@example.com', platform: 'android', updatesOptOut: false, noticeId: 'beta-1', now: LEGACY_T0 - 5 * DAY_MS },
  { email: 'last@example.com', platform: 'ios', updatesOptOut: false, noticeId: 'beta-1', now: LEGACY_T0 - 4 * DAY_MS },
];

/** What the five legacy people's rows hold, by normalized email: their preserved fields and
 *  whether the opt-out was ticked at their last signup. */
export const LEGACY_ROWS = [
  { email: 'una@example.com', platform: 'android', noticeId: 'beta-1', createdAt: LEGACY_T0 - 10 * DAY_MS, updatedAt: LEGACY_T0 - 10 * DAY_MS, optedOut: false },
  { email: 'tick@example.com', platform: 'ios', noticeId: 'beta-1', createdAt: LEGACY_T0 - 9 * DAY_MS, updatedAt: LEGACY_T0 - 9 * DAY_MS, optedOut: true },
  { email: 'later-tick@example.com', platform: 'ios', noticeId: 'beta-1', createdAt: LEGACY_T0 - 8 * DAY_MS, updatedAt: LEGACY_T0 - 7 * DAY_MS, optedOut: true },
  { email: 'untick@example.com', platform: 'android', noticeId: 'beta-1', createdAt: LEGACY_T0 - 6 * DAY_MS, updatedAt: LEGACY_T0 - 5 * DAY_MS, optedOut: false },
  { email: 'last@example.com', platform: 'ios', noticeId: 'beta-1', createdAt: LEGACY_T0 - 4 * DAY_MS, updatedAt: LEGACY_T0 - 4 * DAY_MS, optedOut: false },
] as const;

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** BASE's schema, created on `db` exactly as its constructor did (after the pragmas). */
export function createLegacySqliteSchema(db: DatabaseSync): void {
  db.exec(`
      CREATE TABLE IF NOT EXISTS waitlist (
        email TEXT PRIMARY KEY,
        platform TEXT NOT NULL,
        updates_opt_out INTEGER NOT NULL,
        notice_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);
  db.exec('CREATE INDEX IF NOT EXISTS idx_waitlist_updated_at ON waitlist (updated_at)');
}

/** BASE's SQLite `upsert`, on `db`. */
export function legacySqliteUpsert(db: DatabaseSync, signup: LegacySignup): void {
  const email = normalizeEmail(signup.email);
  db.prepare(`
          INSERT INTO waitlist (email, platform, updates_opt_out, notice_id, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT (email) DO UPDATE SET
            platform = excluded.platform,
            updates_opt_out = excluded.updates_opt_out,
            notice_id = excluded.notice_id,
            updated_at = excluded.updated_at
        `).run(email, signup.platform, signup.updatesOptOut ? 1 : 0, signup.noticeId, signup.now, signup.now);
}

/** BASE's Firestore `upsert`, against the `waitlist` collection under `root`. */
export async function legacyFirestoreUpsert(db: Firestore, root: Firestore | DocumentReference, signup: LegacySignup): Promise<void> {
  const ref = root.collection('waitlist').doc(createHash('sha256').update(normalizeEmail(signup.email)).digest('hex'));
  await db.runTransaction(async (tx) => {
    const existing = await tx.get(ref);
    const answers = { platform: signup.platform, updatesOptOut: signup.updatesOptOut, noticeId: signup.noticeId, updatedAt: signup.now };
    if (existing.exists) {
      tx.update(ref, answers);
      return;
    }
    tx.create(ref, { email: normalizeEmail(signup.email), ...answers, createdAt: signup.now });
  });
}
