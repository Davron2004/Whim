## 1. Bootstrap: dependency and gate wiring (config files, committed into the run's base)

- [x] 1.1 Add `@google-cloud/firestore` at an exact version to `server/package.json` dependencies and update `package-lock.json`. Confirm `npm run guard:metro` still passes and that the Dockerfile's `deps` stage (`npm ci --omit=dev --workspace server`) carries it.
- [x] 1.2 Add an npm script `stores:firestore:test`. It starts the Firestore emulator through a pinned `firebase-tools` (`npx --ignore-scripts --package=firebase-tools@<exact> firebase emulators:exec --only firestore --project demo-whim-conformance "<run the Firestore conformance entry>"`; Java 21 is required) and runs the conformance suite's Firestore entry, exiting non-zero on any failure.
- [x] 1.3 Run `stores:firestore:test` from `scripts/gate-full.sh`, and install Java 21 in the CI job that runs `gate-full.sh`. With no Firestore entry yet, the script runs an empty suite and passes.

## 2. Async store ports, backend config and factory

- [x] 2.1 Make `WaitlistStore` asynchronous (every method returns a `Promise`). Update `InMemoryWaitlistStore`, `NodeSqliteWaitlistStore`, `routes/beta-signup.ts`, `waitlist/cli.ts` (`runWaitlistCli`, `waitlistMain`), `scheduleWaitlistPurge` and the waitlist suites to await it, with no behaviour change.
- [x] 2.2 Add `close(): Promise<void>` to `UsageStore`, `ReportStore` and `WaitlistStore`, and implement it on every existing class. Retype `Opened` (`lifecycle.ts`) and `scheduleCostSweep` to the interfaces instead of the `NodeSqlite*` classes.
- [x] 2.3 Parse `WHIM_STORE_BACKEND` (`sqlite` default | `firestore`) and `WHIM_FIRESTORE_DATABASE` (default `(default)`) in `server/src/config.ts`. Any other backend value fails config, naming the variable and both allowed values, with a test.
- [x] 2.4 Add `openStores(config, deps)`, which returns `{ usage, reports, waitlist, close }` and is the only production constructor of store classes. Make the boot `stores` step async on it, and switch `admin/main.ts` and `waitlistMain` to it. The `firestore` branch calls an injected opener that this chain leaves throwing "not built".
- [x] 2.5 Add `server/test/store-conformance.suite.ts`, parametrized by a backend factory. It covers every case listed in `specs/server-storage-backends` "Every backend honours the same store contracts", runs against the in-memory and SQLite backends in `npm run server:test`, and exports the case list for the Firestore entry.

## 3. Firestore stores: waitlist, reports, factory branch

- [x] 3.1 Implement `FirestoreWaitlistStore` per design D3: doc id is sha256 of the normalized email, `upsert` runs in a transaction so `stored`/`updated` is exact, `export` is oldest first with ties by email, and `purge` deletes in batches.
- [x] 3.2 Implement `FirestoreReportStore` per design D3: optional text stored as `''`, `list` newest first with the default limit 50 and byte sizes, plus `listByDevice`/`deleteByDevice` and batched `purgeOlderThan`.
- [x] 3.3 Wire the factory's `firestore` branch: build a `Firestore` client for `WHIM_FIRESTORE_DATABASE`, honour `FIRESTORE_EMULATOR_HOST`, and do one probe read at boot so missing credentials fail boot naming the store backend (test against an unreachable emulator host).
- [x] 3.4 Add the Firestore conformance entry run by `stores:firestore:test` (a fresh emulator project namespace per run). Waitlist and report cases pass on Firestore.

## 4. Firestore usage store and atomic admission

- [x] 4.1 Implement `FirestoreUsageStore` reads and writes: `credit` (merge plus `FieldValue.increment`, stamping `lastCreditedDay`), `read`, `settle` (first outcome wins, `utcDay` unchanged, failure reasons validated as in SQLite), `recordCost` (the `costWriteLands` state machine, `generationIds` as an array cleared on resolve), `listUnresolvedCostRows`, and `summary`.
- [x] 4.2 Implement `admit` and `refund` per design D2 with counter documents in one transaction. Device limit before global, a reused request id rejected without consuming a unit, `retryAfterSec` to the next UTC midnight, refund idempotent. Implement `unitAvailable` as a counter read.
- [x] 4.3 Implement `purgeLedger` (requests and that day's admission counters), `purgeIdleUsage`, `deviceRecords` and `deleteDeviceRecords` (ledger rows and usage doc, batched).
- [x] 4.4 Write `deploy/firestore/indexes.json` with every composite index the Firestore queries need, and add a conformance case asserting that no Firestore query in the suite fails with a missing-index error under the emulator's index enforcement.
- [x] 4.5 All usage and admission conformance cases pass on Firestore, including a concurrent last-unit race (many parallel `admit`s for one remaining unit admit exactly one).

## 5. SQLite-to-Firestore import

- [x] 5.1 Add `whim-admin import-sqlite --data-dir <dir>`. It reads `usage.db`, `reports.db` and `waitlist.db` read-only and writes Firestore docs with original ids and timestamps (set by id, so reruns change nothing). It rebuilds admission counters for imported ledger days within retention and prints per-store counts. It refuses unless the configured backend is `firestore`.
- [x] 5.2 Test with fixtures produced by the real `NodeSqlite*` stores (not hand-written rows): import twice into the emulator and assert equal counts and an equal document set, and assert that admission after import honours the imported day's counts.

## 6. Deploy and documentation

- [x] 6.1 `deploy/cloudrun/deploy.sh`: set `WHIM_STORE_BACKEND=firestore` on `whim-server`, and apply `deploy/firestore/indexes.json` idempotently (create only the missing indexes; existing ones are left alone) before deploying the server.
- [x] 6.2 `docs/deploy.md` "Cloud Run": replace "No durable state" with the Firestore backend. Document operator commands from a laptop (`gcloud auth application-default login`, then `WHIM_STORE_BACKEND=firestore GOOGLE_CLOUD_PROJECT=… node server/admin.mjs …` / `node server/waitlist.mjs …`), the import procedure, and rollback to `sqlite`.
- [x] 6.3 Append the next-numbered decision to `docs/decisions.md` and add the `server-storage-backends` row to `docs/capabilities.md`.

## 7. Rollout (orchestrator, attended, after merge)

- [ ] 7.1 (run AFTER 7.2 — see progress.md rollout ordering) Deploy with `deploy/cloudrun/deploy.sh`. Confirm boot logs the Firestore backend, then send one real `/v1/clarify` and check its ledger row exists in Firestore.
- [ ] 7.2 Run `import-sqlite` against `~/.config/whim/vm-backup-2026-10-07` (extracted). Verify 5 waitlist rows and 11 reports through the laptop CLIs, and rerun it to confirm nothing changes.
