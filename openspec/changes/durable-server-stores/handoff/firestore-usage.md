# handoff: firestore-usage (chain-3)

## Store (`server/src/firestore/usage-store.ts`)

```ts
export const USAGE_COLLECTION = 'usage';
export const REQUESTS_COLLECTION = 'requests';
export const ADMISSION_COLLECTION = 'admission';
export interface FirestoreUsageStoreOptions { readonly now?: () => number }   // credit's clock
export class FirestoreUsageStore implements UsageStore, UsageRecordKeeping {
  constructor(db: Firestore, root?: FirestoreRoot /* = db */, options?: FirestoreUsageStoreOptions);
}
/** Document id for a caller's key: [A-Za-z0-9-] kept, every other char -> %XX of its UTF-8 bytes. */
export function firestoreKey(key: string): string;          // decodeURIComponent reverses it
export function deviceCounterId(utcDay: string, kind: RequestKind, deviceId: string): string;
export function globalCounterId(utcDay: string, kind: RequestKind): string;
export interface RequestDoc { /* below */ }
```

`server/src/stores.ts`: `openFirestoreUsageStore = (db, root, config) => new FirestoreUsageStore(db, root,
{ now: config.now })`. `createFirestoreStoresOpener` now wraps each store in a proxy that tracks
every promise-returning call; `close()` = close the stores, wait until no call is in flight, then
`db.terminate()` (terminating under a call that has not reached the pool throws uncaught inside the
library: "The client has already been terminated").

`server/src/usage-store.ts` now exports (unchanged bodies): `assertFailureReason`, `utcDayString`,
`secondsUntilNextUtcMidnight`, `computeSummary`, `costWriteLands`, `effectiveGlobalKinds`.

## Documents (all under the store's root; numbers are ms since epoch)

| collection | doc id | fields |
|---|---|---|
| `usage` | `firestoreKey(deviceId)` | `promptTokens`, `completionTokens`, `totalTokens` (number), `lastCreditedDay` (`'YYYY-MM-DD'`) |
| `requests` | `firestoreKey(requestId)` | `RequestDoc` |
| `admission` | `deviceCounterId(...)` | `utcDay`, `kind`, `deviceId` (raw), `count` |
| `admission` | `globalCounterId(...)` | `utcDay`, `kind`, `count` (no `deviceId` field) |

```ts
export interface RequestDoc {
  deviceId: string; kind: RequestKind; utcDay: string; startedAt: number; endedAt: number | null;
  outcome: RequestOutcome | null; failureReason: FailureReason | null;
  promptTokens: number; completionTokens: number; costUsd: number | null; costState: CostState;
  generationIds: string[] | null;   // native array; null once resolved or never registered
  refunded: boolean;
}
```

Counter ids: device `${utcDay}:${kind}:${firestoreKey(deviceId)}`, global `${utcDay}:global:${kind}`
(e.g. `2026-10-07:generate:<uuid>`, `2026-10-07:global:clarify`). A UUID is its own key.

## Counter invariants

- Device counter = that device's non-refunded `requests` rows of `kind` on `utcDay`; global counter =
  every device's. A limit across several kinds (`globalKinds`, e.g. `['clarify','rewrite']`) is the
  SUM of those kinds' global counters, so any kind set counts exactly as SQLite's `kind IN (...)`.
  (Design D2 named one counter per sorted kind set; per-kind counters keep that sum exact.)
- `admit`: one `runTransaction` (maxAttempts 25) reads the request doc + device counter + (when
  `globalLimit` is set) the global counters, refuses device-first then global, rejects a reused id
  (`request id <id> is already in the ledger`) after the limit checks, then `create`s the row and
  `FieldValue.increment(1)`s the device counter and the row kind's global counter (always, limit or not).
- `refund`: transaction; flips `refunded` once, `increment(-1)` on both counters. `unitAvailable`:
  non-transactional `getAll` of the same counters. A missing counter counts 0.
- `purgeLedger(day)`: batched delete of `requests` `utcDay < day`, then `admission` `utcDay < day`.
- `deleteDeviceRecords`: per 100 rows one transaction deletes them, lowers that device's counters
  (deleting one that reaches 0) and the global counters by the non-refunded rows; then deletes the
  device's remaining zero counters and its `usage` doc. Counters are not part of `deviceRecords`.
- `credit`: `set(merge)` of `increment`s + `lastCreditedDay`. `settle`/`recordCost`: transactions with
  the SQLite rules (first outcome wins; `costWriteLands`; ids kept unless a non-empty list is given;
  cleared on `'resolved'`).

## What an import (chain-4) must write so admission honours imported counts

1. Each `requests` row as `RequestDoc` at `firestoreKey(id)`: `generationIds` parsed from SQLite's
   JSON text into an array (or `null`), `refunded` a boolean, nullable columns as `null`, never omitted.
2. Each `usage` row at `firestoreKey(deviceId)` with a non-null `lastCreditedDay` (open the file
   through `NodeSqliteUsageStore` first: its migration backfills nulls; a doc without the field is
   never purged by `purgeIdleUsage`).
3. The counters, as ABSOLUTE `count`s computed from the imported non-refunded rows grouped by
   `(utcDay, kind, deviceId)` and `(utcDay, kind)`, with the fields in the table above. Written with
   `set` (not `increment`), while no server admits against the target, so a re-run is idempotent.
   The conformance entry proves counters written this way bind admission (`usageDocumentModel`).

## Indexes (`deploy/firestore/indexes.json`, Firebase `firestore.indexes.json` format)

```json
{ "indexes": [ { "collectionGroup": "requests", "queryScope": "COLLECTION",
    "fields": [ { "fieldPath": "costState", "order": "ASCENDING" }, { "fieldPath": "endedAt", "order": "ASCENDING" } ] } ],
  "fieldOverrides": [] }
```

The one composite: the cost sweep (`costState ==` + `endedAt` range). Everything else is single-field
(`requests.utcDay`, `requests.deviceId`, `admission.utcDay`, `admission.deviceId`,
`usage.lastCreditedDay`, plus chain-2's). Apply with e.g. `firebase deploy --only firestore:indexes`
or one `gcloud firestore indexes composite create` per entry.

`server/test/firestore-index-coverage.ts` records every query's structured form during the
conformance run (patching `Query.prototype.toProto`) and fails when a composite-needing shape has
no entry, or an entry serves no recorded query. The emulator cannot enforce indexes
(`--require_indexes` is Datastore-mode only), so a NEW store query is covered only once a
conformance case sends it.

## Conformance entry

- `firestore-conformance.ts` runs all `STORE_CONFORMANCE_CASES` (now 15: adds
  `deviceDeleteReleasesUnits`); `REPORT_AND_WAITLIST_CASES` is gone. No `openUsage` override.
- Firestore-only: restart keeps the daily ceiling, usage document model + imported counters,
  unsafe ids, close-while-busy, in-process firestore boot logging
  `{ storeBackend: 'firestore', database: '(default)' }`, index coverage, unreachable host.
- `firestore.run.mjs`: whole-run watchdog 60 s (run ~13 s), `playwright` added to externals.
