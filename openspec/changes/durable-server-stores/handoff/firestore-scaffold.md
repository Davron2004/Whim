# handoff: firestore-scaffold (chain-2)

## Client (`server/src/firestore/client.ts`)

```ts
export const DEFAULT_PROBE_TIMEOUT_MS = 10_000;
export const DELETE_BATCH_SIZE = 500;
/** Where a store's collections live: the database root (production) or one document per isolated run (tests). */
export type FirestoreRoot = Firestore | DocumentReference;
export interface FirestoreClientOptions { readonly probeTimeoutMs?: number }
export async function openFirestoreClient(database: string, options?: FirestoreClientOptions): Promise<Firestore>;
export async function deleteInBatches(db: Firestore, query: Query, batchSize?: number /* 500 */): Promise<number>;
```

- `new Firestore({ databaseId: database })`, nothing else. Project = `GOOGLE_CLOUD_PROJECT` or ADC;
  the library itself routes to `FIRESTORE_EMULATOR_HOST` when set (read at construction, which
  happens before the function's first `await`).
- Probe = one `db.listCollections()` (unary: a permanent error fails at once; a document read is a
  stream the client retries for seconds). Failure rejects
  `WHIM_STORE_BACKEND=firestore: cannot read Firestore database "<db>": <cause>` and terminates the
  client. No answer within the timeout rejects `... the probe read did not answer within <n> ms` and
  ABANDONS the client: `terminate()` waits for the in-flight retries (~60–75 s against a refused
  port), and terminating while a stream read retries raises an unhandled rejection inside the
  library. Never `terminate()` a client with an in-flight read.
- `deleteInBatches` re-runs `query.limit(batchSize)` and commits one `WriteBatch` per page until a
  page is short. Not atomic across batches.

## Stores (`server/src/firestore/{waitlist,report}-store.ts`)

`new FirestoreWaitlistStore(db, root = db)`, `new FirestoreReportStore(db, root = db)`. Both
`close()` are no-ops: the opener owns the client. All timestamps are numbers (ms since epoch).

| collection | doc id | fields |
|---|---|---|
| `waitlist` (`WAITLIST_COLLECTION`) | `waitlistDocId(email)` = hex SHA-256 of `normalizeEmail(email)` | `email` (normalized), `platform`, `updatesOptOut`, `noticeId`, `createdAt`, `updatedAt` |
| `reports` (`REPORTS_COLLECTION`) | `randomUUID()` report id | `receivedAt`, `deviceId`, `reason`, `note`, `appName`, `prompt`, `source` (unsent texts `''`) |

- Waitlist `upsert` and `remove` are `runTransaction` read-then-write (`create` new / `update`
  answers + `updatedAt`, `createdAt` kept). `export` reads the whole collection and filters/sorts in
  process with `waitlist/store.ts`'s exported `matches`/`byCreated`. `purge` =
  `deleteInBatches(where('updatedAt','<',purgeCutoff(now)))`.
- Reports: `list` = optional `where('receivedAt','>=',cutoff)` + `orderBy('receivedAt','desc')`
  + `limit(limit ?? 50)`, mapped through `reports/store.ts`'s exported `toListItem`.
  `listByDevice` = `where('deviceId','==',id)`, sorted in process (receivedAt, then id).
  `purgeOlderThan`/`deleteByDevice` = `deleteInBatches` on `receivedAt <` / `deviceId ==`.

## Indexes these queries need

None composite. Every query filters and orders on one field, which Firestore's automatic
single-field indexes serve: `reports.receivedAt` (asc + desc), `reports.deviceId`,
`waitlist.updatedAt`. `deploy/firestore/indexes.json` MUST NOT exempt those. It MAY add
single-field exemptions for `reports.prompt`/`source`/`note`/`appName` (never queried; up to
`WHIM_MAX_REPORT_SOURCE_BYTES` 256 KiB). A report document stays under Firestore's 1 MiB limit
only while `WHIM_MAX_BODY_BYTES_REPORT` (default 512 KiB) does.

## Factory (`server/src/stores.ts`)

```ts
export type FirestoreUsageOpener = (db: Firestore, root: FirestoreRoot, config: StoreConfig) => UsageStore & UsageRecordKeeping;
/** TODAY: throws 'WHIM_STORE_BACKEND=firestore: the firestore usage store is not built'. */
export const openFirestoreUsageStore: FirestoreUsageOpener;
export interface FirestoreStoresOptions extends FirestoreClientOptions {
  readonly root?: (db: Firestore) => FirestoreRoot;      // default: the database root
  readonly openUsage?: FirestoreUsageOpener;             // default: openFirestoreUsageStore
}
export function createFirestoreStoresOpener(options?: FirestoreStoresOptions): FirestoreStoresOpener;
export const openFirestoreStores: FirestoreStoresOpener = createFirestoreStoresOpener();
```

Opener order: `openFirestoreClient` (probe) → reports → waitlist → `openUsage(db, root, config)`.
A throw after the probe terminates the client and rejects. `close()` = `closeAll([reports,
waitlist, usage])`, then `db.terminate()`.

**Usage slot — what chain-3 replaces:** the body of `openFirestoreUsageStore` (return
`new FirestoreUsageStore(db, root, { now: config.now, usageIdleDays: config.usageIdleDays })` or
equivalent). Until then a `firestore` boot passes its probe and then refuses at `stores` with the
"not built" message, so no half-working server starts.

## Boot log (`lifecycle.ts`, `stores` step)

After `openStores` resolves: `bootLog.info(<fields>, 'stores opened')` with
`{ storeBackend: 'sqlite', dataDir }` (resolved path) or `{ storeBackend: 'firestore', database }`.
`prod-build.suite.ts` asserts the sqlite line from the built tree. The firestore line is untested
until a firestore boot can succeed; chain-3 adds that assertion.

## Conformance entry

- `server/test/firestore.run.mjs` bundles `server/test/firestore-conformance.ts` (externals
  `typescript`, `esbuild`, `pino`, `@google-cloud/firestore`), keeps the emulator-host refusal and a
  30 s ref'd run watchdog, and ends with `process.exit(0)` (the unreachable case leaves a retrying
  client). Raise the watchdog if the usage races need it; each case also has its 20 s timeout.
- Isolation: per open, `root = db.collection('conformance').doc(\`${RUN_ID}-${++opens}\`)`
  (`RUN_ID` = `randomUUID()` per run), passed as `createFirestoreStoresOpener({ root, openUsage })`
  through `openStores(..., { openFirestore })`. Never clear the emulator.
- Today `openUsage` returns `InMemoryUsageStore({ now: config.now })` and the run uses
  `REPORT_AND_WAITLIST_CASES` (exported by `store-conformance.suite.ts`: reportListing,
  waitlistRows, waitlistConcurrentSignups, deviceRecords, retention). **Chain-3:** drop the
  `openUsage` override from `namespacedOpener` and run `STORE_CONFORMANCE_CASES` (now 14 cases).
- Firestore-only checks in the entry: persistence across clients, the document model above,
  `deleteInBatches` across several batches, and an unreachable emulator host (env swapped around the
  synchronous start of `openStores`) rejecting within `probeTimeoutMs + 2 s`.
- `server:test` no longer calls the default Firestore opener (it would reach real Google with a
  developer's ADC). The boot refusal runs in `prod-build.suite.ts` against a loopback HTTP/2 stand-in
  answering every call `PERMISSION_DENIED`, with `FIRESTORE_EMULATOR_HOST` + a `demo-` project.

## Runners

`@google-cloud/firestore` is external in `server/dev.mjs`, `server/test/run.mjs`,
`server/test/e2e.run.mjs`; `server/build.mjs`, `admin.mjs`, `waitlist.mjs` take it from
`server/package.json` already.
