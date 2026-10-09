/**
 * A Firestore client that loses every commit reply although the commit landed, as the SDK sees a
 * DEADLINE_EXCEEDED or UNAVAILABLE after a commit that reached the database. The SDK answers that by
 * sending the commit again: a plain commit (`WriteBatch.commit`, which `DocumentReference.set` and
 * friends use) is re-sent as it was, and a transaction is run again from its function. Both replays
 * happen here, and each is counted, so a case can prove that it exercised one.
 */
import { WriteBatch, type Firestore, type WriteResult } from '@google-cloud/firestore';

export interface LostReplyClient {
  /** The client to build the store under test on: its `runTransaction` commits the transaction,
   *  then runs it again. Every other member is the original client's. */
  readonly db: Firestore;
  /** The commits replayed so far, transactional and plain. */
  replays(): number;
}

/**
 * Runs `run` with every commit replayed: transactions through `client.db`, and every plain commit
 * in the process (`WriteBatch.prototype.commit`, whichever client sends it) until `run` settles,
 * when the original commit is restored. Cases using it must not run concurrently with others.
 */
export async function withLostCommitReplies<T>(db: Firestore, run: (client: LostReplyClient) => Promise<T>): Promise<T> {
  let replays = 0;
  const lossy = new Proxy(db, {
    get(target, property) {
      if (property === 'runTransaction') {
        return async (...args: Parameters<Firestore['runTransaction']>): Promise<unknown> => {
          await target.runTransaction(...args);
          replays++;
          return target.runTransaction(...args);
        };
      }
      const value: unknown = Reflect.get(target, property, target);
      return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value;
    },
  });
  const commit = Object.getOwnPropertyDescriptor(WriteBatch.prototype, 'commit');
  if (typeof commit?.value !== 'function') throw new Error('WriteBatch.prototype.commit is not a method; the lost-reply harness cannot replay plain commits');
  const send = commit.value as (this: WriteBatch) => Promise<WriteResult[]>;
  Object.defineProperty(WriteBatch.prototype, 'commit', {
    ...commit,
    value: async function replayed(this: WriteBatch): Promise<WriteResult[]> {
      await send.call(this);
      replays++;
      return send.call(this);
    },
  });
  try {
    return await run({ db: lossy, replays: () => replays });
  } finally {
    Object.defineProperty(WriteBatch.prototype, 'commit', commit);
  }
}
