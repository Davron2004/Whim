# Contract: has-saved-data (chains 3a + 3b1r -> chain 3b2)

Task 3.0 (rulings 3 and 40 revised): "does this app's store hold any user data?", so the
copy-or-fresh question is skipped (start fresh silently) for an original that never saved anything.
Interface only.

## Imports

| What | Path | Loads in Node? |
|---|---|---|
| `hasSavedData` (device) | `src/host/storage-engine` (index, beside `deleteStorage`) | no: requires op-sqlite lazily |
| `inspectStore`, `readSavedData`, `StoreContents` | `src/host/storage-engine/saved-data` | yes |
| `createNodeHasSavedData(dir)` | `src/host/storage-engine/saved-data-node` | yes, tests only |
| `runSavedDataDeviceSteps`, `SavedDataVerdict` | `src/host/storage-engine/saved-data-device-acceptance` | no (device probe) |
| `HasSavedData`, `StoreAccess.hasSavedData` | `src/host/launcher/store-access` | yes |

## Signatures (unchanged from 3a except `settleProbe` -> `readSavedData`)

```ts
export function hasSavedData(opts: { appId: string }): boolean;            // storage-engine index
export function readSavedData(sql: SqlExecutor): boolean;                  // reads, then closes `sql`
export function createNodeHasSavedData(dir: string): (appId: string) => boolean;
export type HasSavedData = (appId: string) => boolean | Promise<boolean>;  // store-access.ts
// StoreAccessBaseOptions has `hasSavedData?: HasSavedData`
class StoreAccess { hasSavedData(entry: InstalledApp): Promise<boolean> }
```

## What 3b2 does (unchanged)

1. At `new StoreAccess(...)` in `LauncherRoot.tsx`: `hasSavedData: (appId) => hasSavedData({ appId })`.
2. Before the question: `await access.hasSavedData(entry)` with the ORIGINAL ENTRY, never an id.
   `false`: `fork(entry, versionId, { data: 'fresh' })`, no question. `true`: ask (only when
   `access.canCopyData` too).
3. Under the same `runAppOp(... 'fork' ...)` busy gate as the fork.
4. The question can only show for an app whose record (or a version on its group's timelines)
   declares `'storage'`: a 3b2 fixture that expects the question gives its record
   `manifest: { capabilities: ['storage'] }`; `capabilities: []` plus saved rows answers `false`.

## Semantics

`StoreAccess.hasSavedData(entry)`:

1. Seam absent → `true`.
2. **Declared storage, ever?** Over every app whose code opens `engineAppId(entry)`'s store (the
   entry and the index entries of its repo in the same storage group): if any one's current
   `record.manifest.capabilities` holds `'storage'` → declared. Otherwise each version on each
   one's timeline: a saved `manifest.json` declaring `'storage'`, or a version with no
   `manifest.json` (saved before versions kept it: cannot tell) → declared. None → `false`, and the
   injected read is never called: no store is opened, no file is created.
3. Declared → the injected read on `engineAppId(entry)`: `true` iff `kv` or any collection table
   holds a row. `_meta` never counts (applied schema with no rows, emptied store, table-less file
   → `false`; `inspectStore` returns `'empty'` for all three, `'data'` otherwise).

"Declares storage" is exactly what makes the bridge open an engine (`launchApp`,
`bridge/launch.ts:45`). Each version's declaration is read from the version store once per repo per
process and kept with `declaredSchemas`'s (`StoreAccess.declarationOf`).

**Cost (ruling 41, #212):** the walk and `declaredSchemas` read a version through the version store's
`declarationOf(appId, snapshotId): Promise<Declaration>` (`{ manifest: string | null; schema: string | null }`,
exported from `src/host/version-store`): the snapshot's top-level file list, then at most two small
blobs (`manifest.json`, `schema.json`). Never `bundle.js`, `source.ts` or `prompt.md`. So a first
Make-a-copy tap on a no-storage app costs one commit + one tree + ≤2 small blob reads per version on
its group's timelines, once per process (the memo); later taps read none. `timeline` per tap is a
ref walk (commit objects only). Still inside `serial(repo)`.

The storage-engine read (device and Node alike): connects (op-sqlite's `open` and node:sqlite both
create a missing file), SELECTs only, closes. **Never deletes.** A never-run app that declares
storage is left with a table-less store; the engine's first open treats it exactly like a missing
file (`engine.ts:81-83` creates `_meta`/`kv` with `IF NOT EXISTS`; `engine.ts:58-66` reads the
applied schema as `emptyApplied()` when `_meta` or its row is absent), and the bridge opens that
store before the app's first run anyway (D7). A hot rollback journal left by a crashed writer is
rolled back by SQLite on the read's first statement, as on any connection; the read adds no write.

Known limit (kept `false`): a copy made with "Copy the data" from an older version whose whole
lineage declares no storage holds data none of its versions can read; asked of that copy, the
answer is `false`. Reachable: History -> a pre-storage version -> Make a copy -> Copy the data. The
orchestrator files a follow-up issue for it.

## Error surface

`StoreAccess.hasSavedData` never rejects. A version store that cannot be read (timeline or
declaration), a version whose manifest or schema does not parse, or an injected read that throws or
rejects (corrupt store) → logs a warning, resolves `true`. An index entry with no repo behind it
(does not occur in production; a test's bare `index.put`) still answers `true`: the lineage switch
before the walk fails first, and the verb itself would reject `unknown snapshot: <id>`. Not
special-cased. A corrupt store then surfaces as the copy's own
`source_unreadable` if "Copy the data" is picked. The storage-engine functions throw the binding's
error; only `StoreAccess` converts it.

## Device probe

`runSavedDataDeviceSteps(check)` runs from `runStorageDeviceAcceptance` (`RUN_STORAGE_PROBE`); the
verdict gains `savedData: { neverRanThenInit, kvOnly, schemaOnly }`. Every check is evaluated and
reported (no short-circuit). It deletes only the stores it created itself, in a `finally`, so a
step that throws still cleans up.

Not provided: no change to `fork`, the journal, the sweep or any UI.
