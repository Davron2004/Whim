/**
 * FirestoreWaitlistStore (durable-server-stores D3; specs/server-storage-backends "Records outlive
 * every server instance on the Firestore backend", "Every backend honours the same store contracts").
 *
 * One document per person in the `waitlist` collection, keyed by the SHA-256 of the normalized
 * email, so every casing and spacing of one address lands on one document. The email is kept as a
 * field for the export. `upsert` reads and writes in one transaction, so concurrent signups of one
 * address report `stored` exactly once and the first signup's `createdAt` survives.
 */
import { createHash } from 'node:crypto';
import type { DocumentReference, DocumentSnapshot, Firestore } from '@google-cloud/firestore';
import { deleteInBatches, type FirestoreRoot } from './client';
import {
  byCreated,
  matches,
  normalizeEmail,
  purgeCutoff,
  type UpsertOutcome,
  type WaitlistFilter,
  type WaitlistPlatform,
  type WaitlistRow,
  type WaitlistSignup,
  type WaitlistStore,
} from '../waitlist/store';

export const WAITLIST_COLLECTION = 'waitlist';

/** The document id of `email` in any casing or spacing: the hex SHA-256 of its normalized form. */
export function waitlistDocId(email: string): string {
  return createHash('sha256').update(normalizeEmail(email)).digest('hex');
}

/** The fields of one waitlist document. */
interface WaitlistDoc {
  email: string;
  platform: WaitlistPlatform;
  updatesOptOut: boolean;
  noticeId: string;
  createdAt: number;
  updatedAt: number;
}

function fromSnapshot(snapshot: DocumentSnapshot): WaitlistRow {
  const doc = snapshot.data() as WaitlistDoc;
  return {
    email: doc.email,
    platform: doc.platform,
    updatesOptOut: doc.updatesOptOut,
    noticeId: doc.noticeId,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

export class FirestoreWaitlistStore implements WaitlistStore {
  constructor(
    private readonly db: Firestore,
    private readonly root: FirestoreRoot = db,
  ) {}

  private doc(email: string): DocumentReference {
    return this.root.collection(WAITLIST_COLLECTION).doc(waitlistDocId(email));
  }

  async upsert(signup: WaitlistSignup): Promise<UpsertOutcome> {
    const ref = this.doc(signup.email);
    return await this.db.runTransaction(async (tx): Promise<UpsertOutcome> => {
      const existing = await tx.get(ref);
      const answers = { platform: signup.platform, updatesOptOut: signup.updatesOptOut, noticeId: signup.noticeId, updatedAt: signup.now };
      if (existing.exists) {
        tx.update(ref, answers);
        return 'updated';
      }
      const created: WaitlistDoc = { email: normalizeEmail(signup.email), ...answers, createdAt: signup.now };
      tx.create(ref, created);
      return 'stored';
    });
  }

  async export(filter: WaitlistFilter = {}): Promise<WaitlistRow[]> {
    const snapshot = await this.root.collection(WAITLIST_COLLECTION).get();
    return snapshot.docs.map(fromSnapshot).filter((row) => matches(row, filter)).sort(byCreated);
  }

  async remove(email: string): Promise<boolean> {
    const ref = this.doc(email);
    return await this.db.runTransaction(async (tx) => {
      const existing = await tx.get(ref);
      if (existing.exists) tx.delete(ref);
      return existing.exists;
    });
  }

  async purge(now: number): Promise<number> {
    return await deleteInBatches(this.db, this.root.collection(WAITLIST_COLLECTION).where('updatedAt', '<', purgeCutoff(now)));
  }

  /** The client belongs to whoever opened it (`OpenedStores.close` terminates it). */
  close(): Promise<void> {
    return Promise.resolve();
  }
}
