/**
 * FirestoreWaitlistStore (durable-server-stores D3; waitlist-hardening D2, D3, D5;
 * specs/server-storage-backends "Records outlive every server instance on the Firestore backend",
 * "Every backend honours the same store contracts").
 *
 * One document per person in the `waitlist` collection, keyed by the (unkeyed) SHA-256 of the
 * normalized email, so every casing and spacing of one address lands on one document. The email is
 * kept as a field for the export. Removal fingerprints are documents of `waitlistSuppressed`, each
 * named by the HMAC-SHA-256 of the normalized email under the store's key and holding only
 * `suppressedAt`.
 *
 * `upsert` reads the row and the fingerprint and writes in one transaction, and `remove` deletes the
 * row and writes the fingerprint in one transaction, so a signup racing a removal ends either
 * removed with its fingerprint kept or refused as `suppressed`, never as a row beside its
 * fingerprint. Concurrent signups of one address report `stored` exactly once and the first
 * signup's `createdAt` survives. A document without `updatesOptIn` was written by the opt-out-model
 * code: it reads through `waitlistRowFromLegacy` and its first write rewrites it whole. Every write
 * also sets `updatesOptOut` to `!updatesOptIn`, the shadow a rolled-back revision reads.
 */
import { createHash } from 'node:crypto';
import type { DocumentData, DocumentReference, Firestore } from '@google-cloud/firestore';
import { deleteInBatches, type FirestoreRoot } from './client';
import {
  byCreated,
  consentAfterOperator,
  fingerprintPurgeCutoff,
  matches,
  normalizeEmail,
  purgeCutoff,
  rowAfterSignup,
  waitlistFingerprinter,
  waitlistRowFromLegacy,
  type LegacyWaitlistRow,
  type UpsertOutcome,
  type WaitlistFilter,
  type WaitlistPlatform,
  type WaitlistPurgeCounts,
  type WaitlistRow,
  type WaitlistSignup,
  type WaitlistStore,
  type WaitlistStoreOptions,
} from '../waitlist/store';

export const WAITLIST_COLLECTION = 'waitlist';
export const WAITLIST_SUPPRESSED_COLLECTION = 'waitlistSuppressed';

/** The document id of `email` in any casing or spacing: the hex SHA-256 of its normalized form. */
export function waitlistDocId(email: string): string {
  return createHash('sha256').update(normalizeEmail(email)).digest('hex');
}

/** The fields of one waitlist document. */
interface WaitlistDoc {
  email: string;
  platform: WaitlistPlatform;
  noticeId: string;
  createdAt: number;
  updatedAt: number;
  updatesOptIn: boolean;
  updatesConsentAt: number | null;
  updatesConsentNoticeId: string | null;
  updatesWithdrawnAt: number | null;
  /** The rollback shadow: always `!updatesOptIn`, never read. */
  updatesOptOut: boolean;
}

/** The document `row` is stored as, with its rollback shadow. */
export function waitlistDocOf(row: WaitlistRow): WaitlistDoc {
  return {
    email: row.email,
    platform: row.platform,
    noticeId: row.noticeId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    updatesOptIn: row.updatesOptIn,
    updatesConsentAt: row.updatesConsentAt,
    updatesConsentNoticeId: row.updatesConsentNoticeId,
    updatesWithdrawnAt: row.updatesWithdrawnAt,
    updatesOptOut: !row.updatesOptIn,
  };
}

/** The row a stored document holds, of either model. */
function rowOf(data: DocumentData): WaitlistRow {
  if (typeof data.updatesOptIn !== 'boolean') return waitlistRowFromLegacy(data as LegacyWaitlistRow);
  const doc = data as WaitlistDoc;
  return {
    email: doc.email,
    platform: doc.platform,
    noticeId: doc.noticeId,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    updatesOptIn: doc.updatesOptIn,
    updatesConsentAt: doc.updatesConsentAt,
    updatesConsentNoticeId: doc.updatesConsentNoticeId,
    updatesWithdrawnAt: doc.updatesWithdrawnAt,
  };
}

export class FirestoreWaitlistStore implements WaitlistStore {
  private readonly fingerprint: (email: string) => string;

  constructor(
    private readonly db: Firestore,
    private readonly root: FirestoreRoot,
    options: WaitlistStoreOptions,
  ) {
    this.fingerprint = waitlistFingerprinter(options.fingerprintKey);
  }

  private doc(email: string): DocumentReference {
    return this.root.collection(WAITLIST_COLLECTION).doc(waitlistDocId(email));
  }

  private fingerprintDoc(email: string): DocumentReference {
    return this.root.collection(WAITLIST_SUPPRESSED_COLLECTION).doc(this.fingerprint(email));
  }

  async upsert(signup: WaitlistSignup): Promise<UpsertOutcome> {
    const ref = this.doc(signup.email);
    const suppressedRef = this.fingerprintDoc(signup.email);
    return await this.db.runTransaction(async (tx): Promise<UpsertOutcome> => {
      const [existing, suppressed] = await tx.getAll(ref, suppressedRef);
      if (suppressed?.exists) return 'suppressed';
      const current = existing?.exists ? rowOf(existing.data() ?? {}) : undefined;
      const next = waitlistDocOf(rowAfterSignup(current, signup));
      if (current === undefined) {
        tx.create(ref, next);
        return 'stored';
      }
      tx.set(ref, next);
      return 'updated';
    });
  }

  async export(filter: WaitlistFilter = {}): Promise<WaitlistRow[]> {
    const snapshot = await this.root.collection(WAITLIST_COLLECTION).get();
    return snapshot.docs.map((doc) => rowOf(doc.data())).filter((row) => matches(row, filter)).sort(byCreated);
  }

  async remove(email: string, now: number): Promise<boolean> {
    const ref = this.doc(email);
    const suppressedRef = this.fingerprintDoc(email);
    return await this.db.runTransaction(async (tx) => {
      const [existing] = await tx.getAll(ref, suppressedRef);
      const found = existing?.exists === true;
      if (found) tx.delete(ref);
      tx.set(suppressedRef, { suppressedAt: now });
      return found;
    });
  }

  async setUpdates(email: string, on: boolean, now: number): Promise<boolean> {
    const ref = this.doc(email);
    return await this.db.runTransaction(async (tx) => {
      const existing = await tx.get(ref);
      if (!existing.exists) return false;
      const row = rowOf(existing.data() ?? {});
      tx.set(ref, waitlistDocOf({ ...row, ...consentAfterOperator(row, on, now) }));
      return true;
    });
  }

  async restore(email: string): Promise<boolean> {
    const ref = this.fingerprintDoc(email);
    return await this.db.runTransaction(async (tx) => {
      const existing = await tx.get(ref);
      if (existing.exists) tx.delete(ref);
      return existing.exists;
    });
  }

  async purge(now: number): Promise<WaitlistPurgeCounts> {
    const rows = await deleteInBatches(this.db, this.root.collection(WAITLIST_COLLECTION).where('updatedAt', '<', purgeCutoff(now)));
    const fingerprints = await deleteInBatches(this.db, this.root.collection(WAITLIST_SUPPRESSED_COLLECTION).where('suppressedAt', '<', fingerprintPurgeCutoff(now)));
    return { rows, fingerprints };
  }

  /** The client belongs to whoever opened it (`OpenedStores.close` terminates it). */
  close(): Promise<void> {
    return Promise.resolve();
  }
}
