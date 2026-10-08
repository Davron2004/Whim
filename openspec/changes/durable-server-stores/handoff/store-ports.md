# handoff: store-ports (chain-1)

## Store interfaces (all methods async; each store exposes `close()`)

`server/src/usage-store.ts`: `UsageStore` = `credit`, `read`, `admit`, `unitAvailable`, `refund`,
`settle`, `recordCost`, `listUnresolvedCostRows`, `summary`, `purgeLedger`, plus
`close(): Promise<void>`. `UsageRecordKeeping` = `purgeIdleUsage`, `deviceRecords`,
`deleteDeviceRecords`. Signatures and doc comments are unchanged apart from `close` and `admit`'s
contract, which is now stated in spec terms (below).

`server/src/reports/store.ts`: `ReportStore` = `insert`, `list`, `get`, `purgeOlderThan`, plus
`close(): Promise<void>`. `ReportRecordKeeping` = `listByDevice`, `deleteByDevice`. Otherwise unchanged.

`server/src/waitlist/store.ts`, now asynchronous:

```ts
export interface WaitlistStore {
  upsert(signup: WaitlistSignup): Promise<UpsertOutcome>;
  /** Matching rows, oldest signup first. */
  export(filter?: WaitlistFilter): Promise<WaitlistRow[]>;
  /** Removes the row for `email` in any casing; whether one was there. */
  remove(email: string): Promise<boolean>;
  /** Deletes rows whose `updated_at` is more than `WAITLIST_RETENTION_DAYS` before `now`. */
  purge(now: number): Promise<number>;
  close(): Promise<void>;
}
```

Reuse `normalizeEmail`/`purgeCutoff(now)`; `costWriteLands`/`computeSummary` are module-private in
`usage-store.ts` — export them rather than re-derive.

## Config (`server/src/config.ts`)

```ts
export const STORE_BACKENDS = ['sqlite', 'firestore'] as const;
export type StoreBackend = (typeof STORE_BACKENDS)[number];
// ServerConfig gains:
readonly storeBackend: StoreBackend;   // WHIM_STORE_BACKEND; unset or '' -> 'sqlite'
readonly firestoreDatabase: string;    // WHIM_FIRESTORE_DATABASE; unset or '' -> '(default)'
```

Any other `WHIM_STORE_BACKEND` throws `ServerConfigError('WHIM_STORE_BACKEND',
'WHIM_STORE_BACKEND must be one of sqlite, firestore, got "<raw>".')`, so boot fails at `config`.

## Factory (`server/src/stores.ts`)

```ts
export type StoreConfig = Pick<ServerConfig, 'storeBackend' | 'firestoreDatabase' | 'dataDir' | 'now' | 'usageIdleDays'>;
export interface OpenedStores {
  readonly usage: UsageStore & UsageRecordKeeping;
  readonly reports: ReportStore & ReportRecordKeeping;
  readonly waitlist: WaitlistStore;
  /** Closes all three stores (reports, waitlist, then usage). */
  close(): Promise<void>;
}
export type FirestoreStoresOpener = (config: StoreConfig) => Promise<OpenedStores>;
export interface OpenStoresDeps { readonly openFirestore?: FirestoreStoresOpener }
export const openFirestoreStores: FirestoreStoresOpener;  // today: rejects "...firestore store backend is not built"
export async function openStores(config: StoreConfig, deps?: OpenStoresDeps): Promise<OpenedStores>;
```

- `sqlite`: `usage.db`, `reports.db`, `waitlist.db` under `config.dataDir`. A failed open closes
  whatever already opened, then rejects.
- `firestore`: returns `(deps.openFirestore ?? openFirestoreStores)(config)`. Chain-2 replaces the
  body of `openFirestoreStores` (client for `config.firestoreDatabase`, emulator honoured, one probe
  read). It may be async and may reject. Boot runs it inside `atAsyncStep('stores', …)`, so a
  rejection becomes `BootError('stores', <message>)` before listening.
- Callers: `lifecycle.ts` (boot; purge timers on the returned stores; drain awaits `close()`), `admin/main.ts` (closes after the command), `waitlist/cli.ts` `waitlistMain`
  (now `async`, as is `runWaitlistCli`). No other production code constructs `NodeSqlite*`.
  `app.ts` still defaults `reportStore`/`waitlistStore` to `InMemory*` when they are omitted (a test seam).
- Dev runners `server/admin.mjs`/`server/waitlist.mjs` externalize every `server/package.json` dependency.

## Conformance suite (`server/test/store-conformance.suite.ts`)

```ts
export interface ConformanceClock { now: number }
export interface StoreBackendFactory {
  readonly label: string;                                // prefixes each case's check name
  /** Fresh stores holding no record any earlier `open` wrote. `now` = the usage store's clock. */
  open(now: () => number): Promise<OpenedStores>;
}
export interface StoreConformanceCase {
  readonly name: string;
  run(stores: OpenedStores, clock: ConformanceClock): Promise<void>;  // rejects on a violation
}
export const STORE_CONFORMANCE_CASES: readonly StoreConformanceCase[];  // 17 cases
export function runConformanceCase(f: StoreBackendFactory, c: StoreConformanceCase, timeoutMs?: number): Promise<string | undefined>;
export function runStoreConformance(f: StoreBackendFactory, cases?: readonly StoreConformanceCase[]): Promise<void>;
export function runStoreConformanceTests(): Promise<void>;  // in-memory + sqlite + negative control (server:test)
```

- Each case opens its own stores, runs under a 20 s ref'd timeout, then `close()`s them. A failure
  or timeout is one `check(...)` failure in `server/test/harness.ts`; call `report()` at the end to
  set the exit code.
- Cases cover the spec list: admission limits/order, the concurrent last-unit race (device and
  global), reused id, refund once, settle first-wins, recordCost states, sweep candidates, summary,
  credit (including concurrent increments), report list/get, waitlist, device export/delete, and
  every retention cutoff. The ledger purge case also asserts that the admission counts for that day go.
- Case data is fixed (`dev-*` ids, `T0` = 2026-10-07T12:00Z), so a Firestore factory isolates each
  `open` with a fresh collection prefix or namespace — never by clearing the emulator.

### Running it from `server/test/firestore.run.mjs` (plain ESM)

Add a TS entry, e.g. `server/test/firestore-conformance.ts`, that imports `runStoreConformance` plus
a Firestore `StoreBackendFactory`, awaits it, then calls `report()`. In `firestore.run.mjs`, bundle
that entry with esbuild, as `server/test/run.mjs` does: `bundle: true, platform: 'node', format:
'esm', target: 'node22', external: ['typescript', 'esbuild', 'pino', '@google-cloud/firestore']`.
Write it to a temp `.mjs` under `process.cwd()` (so `node_modules` resolves), set `WHIM_LOG_JSON=1`,
`import()` it, remove it in `finally`. Keep the `FIRESTORE_EMULATOR_HOST` refusal and the watchdog.

## Invariants and error surface

- `admit` is one atomic step: device limit, then global limit, then the row. Two concurrent admits
  never both take the last unit. A reused `requestId` rejects (the promise rejects) and consumes no
  device or global unit. A refund frees its unit exactly once. "No `await` between count and
  insert" is no longer the contract; it was a SQLite mechanism.
- `settle` with an unknown failure code, or one beside `delivered`/`ok`, rejects and writes nothing.
- `purgeLedger(day)` also deletes that day's admission counts. Afterwards the purged day admits again.
- Everything else (strictly-before cutoffs, `''` report fields, list default 50, ordering with ties
  in code-unit order as SQLite sorts text, unstorable ids as not found) is pinned by the cases.
