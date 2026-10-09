# Contract: credit-idempotency (chain-1, #145)

Consumers: chain-2 (edits `server/src/firestore/usage-store.ts`), chain-5 (reuses the lost-reply
harness), chain-6 (runbook prose).

## Store surface: unchanged

`UsageStore.credit(deviceId: string, usage: Usage): Promise<void>`: same signature, same call
sites. SQLite and in-memory `credit` are untouched.

## Firestore document model (addition)

Exported from `server/src/firestore/usage-store.ts`:

```ts
export const CREDIT_MARKS_COLLECTION = 'creditMarks';
```

- Path: `<root>/creditMarks/{markerId}`, beside `usage`, `requests` and `admission`.
- `markerId`: `randomUUID()`, minted once per `credit` call, outside the transaction function.
- Document: exactly `{ utcDay: string }` (`'YYYY-MM-DD'`, the credit's UTC day from the store's
  `now`). No device id, no tokens, no request content.

## `FirestoreUsageStore.credit` semantics

One `db.runTransaction(fn, { maxAttempts: CREDIT_MAX_ATTEMPTS /* 5 */ })`. The budget is small
because `routes/generate.ts` awaits the credit before the run's terminal event; a failed credit is
logged there, the terminal still goes out, and the tokens go to reconciliation.

The transaction:

1. `tx.get(creditMarks/{markerId})`; if it exists, return (no writes).
2. Otherwise `tx.set(usage/{firestoreKey(deviceId)}, { promptTokens, completionTokens,
   totalTokens: FieldValue.increment(...), lastCreditedDay: utcDay }, { merge: true })` and
   `tx.create(creditMarks/{markerId}, { utcDay })`.

Invariants:
- A retried transaction (or a replayed commit) applies one call's usage at most once.
- The usage document is never read in the transaction, so concurrent credits for one device do
  not conflict; they still sum exactly.
- Cost per credit: one document read + two writes, inside one transaction.

## Purge cutoff

`FirestoreUsageStore.purgeLedger(beforeUtcDay)`, after the ledger rows and admission counters:

```ts
deleteInBatches(db, creditMarks.where('utcDay', '<', utcDayString(this.now() - 86_400_000)))
```

- The cut is independent of `beforeUtcDay` (ledger retention): on UTC day D, markers with
  `utcDay < D-1` go, and markers from D-1 and D stay.
- The clock is the store's `now` option (`config.now` in `stores.ts`), the same clock the hourly
  in-process purge and `whim-admin purge` cut from. Both reach it through `purgeLedger`.
- The return value still counts ledger rows only. Markers are not counted in the purge output
  (`ledger: N purged`).
- Single-field range query: no composite index. `deploy/firestore/indexes.json` is unchanged, and
  the index-coverage check passes.
- Device export and delete do not see markers, because markers hold no device id.

## Lost-reply harness (test-only): `server/test/firestore-lost-reply.ts`

```ts
import type { Firestore } from '@google-cloud/firestore';

export interface LostReplyClient {
  /** Proxy of `db` whose `runTransaction` commits the transaction, then runs it again. */
  readonly db: Firestore;
  /** Commits replayed so far, transactional and plain. */
  replays(): number;
}

export function withLostCommitReplies<T>(
  db: Firestore,
  run: (client: LostReplyClient) => Promise<T>,
): Promise<T>;
```

- Transactions are replayed only through `client.db`. Build the store under test as
  `new FirestoreUsageStore(client.db, root)`, where `root` comes from the real `db`.
- Plain commits are replayed process-wide: `WriteBatch.prototype.commit` sends each batch twice
  while `run` is pending, whichever client sends it. The original is restored in `finally`. Cases
  that use the harness must not overlap other Firestore work in the process.
- Assert `client.replays() > 0` so a case proves it exercised a replay.
- It is a module separate from `firestore-conformance.ts`, which has top-level awaits, so it can be
  imported without running the conformance suite.

## Conformance cases added (`server/test/firestore-conformance.ts`)

- "a credit whose commit reply is lost counts once". Red on the plain merge `set`, and red on a
  transaction without a marker.
- "a marker holds the UTC day of its credit and nothing else".
- "the purge keeps the markers of the previous UTC day and later, and only those". This case runs
  through `runPurge` (`whim-admin purge`) and is red on a cut at today.
- The existing admission lost-reply case now runs under `withLostCommitReplies`. The old private
  `losingCommitReplies` helper is gone.
