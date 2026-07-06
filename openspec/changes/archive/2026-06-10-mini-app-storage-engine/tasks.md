# mini-app-storage-engine — Tasks

## 1. op-sqlite device smoke (D7 gate — half a day, before the engine is built on it)

- [x] 1.1 Add `@op-engineering/op-sqlite` and confirm it autolinks + loads under RN 0.85.3 / new arch / Hermes on the Android target (offline release bundle, same recipe as the vstore acceptance)
- [x] 1.2 Smoke the minimal lifecycle on-device: open a file-backed DB, `CREATE TABLE`, insert/select with bound parameters, kill+relaunch, read back intact
- [x] 1.3 Record the verdict; if op-sqlite fails, evaluate `react-native-nitro-sqlite` behind the same plan before proceeding (D1 fallback)

## 2. Contract + schema module (D3, D4, D8)

- [x] 2.1 Create `src/host/storage-engine/contract.ts`: `SchemaArtifact`, verb param/result types, the `where`/`orderBy` filter grammar types, and the structured-error shape `{kind, collection?, field?, hint}` — the seam the `capability-bridge` change implements against
- [x] 2.2 Implement artifact validation as a pure, exported function: shape checks, the closed six-type set (`text/int/float/bool/date/json`), defaults type-checked against their field's declared type, burned-ID well-formedness, defaults required on post-creation fields
- [x] 2.3 Implement the artifact diff as a pure, exported function classifying into the four D4 classes (identical / additive / older-subset / conflict), returning structured fix-hint errors for every conflict kind (type change, ID reuse, tombstone violation, missing default)

## 3. SqlExecutor adapter + bindings (D1)

- [x] 3.1 Define the `SqlExecutor` interface (`execute(sql, params) → rows`, transaction wrapper, close) and document the conservative SQL subset the engine may emit
- [x] 3.2 Implement the `node:sqlite` binding (test-side; zero new devDependency)
- [x] 3.3 Implement the op-sqlite binding (device-side), file path layout `storage/<appId>.db` plus `:memory:` mode

## 4. Engine core (D2, D4)

- [x] 4.1 Implement `createStorageEngine({appId, mode})`: one DB handle bound at construction, no per-call app addressing anywhere in the API (the #39 D2 constructor-guard pattern)
- [x] 4.2 Implement the `_meta` table holding the last-applied artifact; `open(artifact)` runs validate → diff → apply per D4
- [x] 4.3 Implement derived DDL limited to `CREATE TABLE` / `ALTER TABLE ADD COLUMN` (with declared defaults); assert no other DDL form can be emitted (test hook: capture every executed statement)
- [x] 4.4 Implement the older-subset (rollback) path: open succeeds with zero DDL, unaddressed columns untouched

## 5. Verbs (D5, D6)

- [x] 5.1 Implement `kv.get/set/remove` over a per-app `kv` table with the configurable size cap; oversized writes rejected with the records-pointing fix hint
- [x] 5.2 Implement `records.append` (engine-assigned integer id returned) and `records.remove` (hard delete per D6); written values validated against declared field types with structured errors — `int` enforces whole numbers within the JS safe-integer range
- [x] 5.3 Implement `records.update` patching only named fields (record-granular writes; unnamed columns provably untouched)
- [x] 5.4 Implement `records.list` with `where` (equality + `gt/gte/lt/lte`, AND-only), `orderBy`, `limit`, `offset` — compiled to parameterized SQL, display-name → burned-ID mapping applied host-side
- [x] 5.5 Assert parameterization end-to-end: agent-supplied strings are only ever bound, never interpolated (the SQL-metacharacters-as-inert-data spec scenario)

## 6. Node acceptance suite + injection gate (D7 fast checkpoint; D5a, D8)

- [x] 6.1 Add `npm run storage:test` (esbuild-bundled TS acceptance suite over `node:sqlite`, mirroring the `vstore:test` runner idiom); make the `SqlExecutor` test binding record every executed statement text + its bound params, so tests can assert what SQL actually ran
- [x] 6.2 Cover every `mini-app-storage` spec scenario runnable off-device: isolation (two engine instances, no cross-visibility, no addressing parameter), verbs, filters, KV cap, ephemeral mode
- [x] 6.3 Cover every `storage-schema-evolution` spec scenario: rename-over-same-ID, each conflict rejection, tombstone + display-name reuse, the rollback/roll-forward retention round-trip, DDL-form capture (only the two allowed forms; zero DDL on older-subset)
- [x] 6.4 Add the **injection invariant block** (clearly labelled, owned as a security invariant per §16.4): adversarial metacharacters in (a) record values, (b) kv keys/values, (c) `where` comparison values, (d) `where`/`orderBy` field names, (e) collection names — asserting values round-trip byte-identical, bad identifiers raise structured `unknown_field`/`unknown_collection` errors with no SQL run, and the captured executed-statement set is exactly the fixed host-authored templates (dangerous input only ever in the param array)
- [x] 6.5 Wire `npm run storage:test` into `.github/workflows/invariants.yml` as a blocking per-push step (alongside `build` + `invariants`), so the D5a injection property is gated on every push — not a file run by hand

## 7. On-device acceptance + record the numbers (D7)

- [x] 7.1 Add a `StorageProbeScreen` following the `VersionStoreProbeScreen` pattern (flag in `App.tsx`; on-screen verdict JSON — logcat truncates ~4 KB)
- [x] 7.2 Run the full lifecycle on-device: schema apply + evolution (add field, rename, tombstone, rollback-shaped reopen), all verbs, KV cap, then kill+relaunch and verify everything intact
- [x] 7.3 Measure per-verb latency and DB file size at realistic Tier-0 volumes (e.g. a few thousand ledger records); confirm interactive feel
- [x] 7.4 Record results as a new numbered entry in `docs/decisions.md` (including the §5.6 "schemaless JSON soup → schema-declared" reversal on the record) + raw capture in `DEVLOG.md`; confirm all spec scenarios pass
