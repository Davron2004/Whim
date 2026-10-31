# Contract: copy-api (chain-2 → chain-3, chain-5)

The launcher's "Make a copy" API with "Copy the data". Interface only.

## Imports

| What | Path |
|---|---|
| `StoreAccess`, `ForkOptions`, `StoreAccessOptions` | `src/host/launcher/store-access` |
| `DataCopyJournal`, `DataCopyJournalEntry`, `sweepDataCopies` | `src/host/launcher/data-copy-journal` |
| `DataCopyError`, `DataCopyErrorKind` | `src/host/storage-engine/copy-contract` (never the storage-engine barrel from Node code) |

## Signatures (verbatim, `store-access.ts`)

```ts
export interface ForkOptions {
  data?: 'fresh' | 'copy';
}

type DataCopySeam =
  | { copyStorage: CopyStorage; copyJournal: DataCopyJournal }
  | { copyStorage?: undefined; copyJournal?: undefined };
export type StoreAccessOptions = StoreAccessBaseOptions & DataCopySeam; // base: store, index, deleteStorage?, now?

class StoreAccess {
  readonly canCopyData: boolean;
  fork(entry: InstalledApp, versionId?: string, opts?: ForkOptions): Promise<InstalledApp>;
  continueSharingData(entry: InstalledApp): Promise<InstalledApp>;
  sweepDataCopies(): Promise<void>;
}
```

`data-copy-journal.ts`:

```ts
export interface DataCopyJournalEntry { readonly copyAppId: string; readonly sourceAppId: string; readonly startedAt: number }
export class DataCopyJournal {
  constructor(kv: KVBackend);
  put(entry: DataCopyJournalEntry): void;
  clear(copyAppId: string): void;
  list(): DataCopyJournalEntry[];
}
export function sweepDataCopies(deps: {
  journal: DataCopyJournal; index: AppIndex;
  deleteStorage: (appId: string) => void | Promise<void>;
  inFlight?: (copyAppId: string) => boolean;
}): Promise<void>;
```

## Semantics

- `canCopyData` is true exactly when `copyStorage` (and its `copyJournal`) were injected. The
  device `LauncherRoot` injects both, so it is true on device; a `StoreAccess` built without them
  (all other suites' rigs) has it false. Show "Copy the data" only when it is true.
- `fork(entry, versionId?, { data })` is "Make a copy" (tile menu and History). `data` defaults
  to `'fresh'`. The result ALWAYS has no `storageGroupId`; `engineAppId(result) === result.id`.
  No option, including a stray legacy `{ shareData: true }`, can share the original's store.
  - `'fresh'`: an empty store (any stray file under the new id is deleted first).
  - `'copy'`: a verified one-time snapshot of the store `entry` resolves to (`engineAppId(entry)`:
    the group's store for a legacy shared copy). From an older `versionId`, the copy runs that
    version's code on the current data (the hidden-data line applies, as for rollback).
- `continueSharingData(entry)` is for rewind continuations only (`build-lifecycle.ts`): a new
  lineage from the active snapshot whose `storageGroupId` is `entry.storageGroupId ?? entry.id`.
  No UI calls it.
- `sweepDataCopies()` runs once at launch in `LauncherRoot`, before the grid is ready. It skips
  copies running in this process. A no-op without the seam.
- Legacy shared copies (`storageGroupId` set by #52) are untouched: they keep sharing; refcounted
  delete keeps the group's store until its last member goes.

## Error surface (what a `fork` caller can catch)

| When | Rejection | Persisted effect |
|---|---|---|
| `'copy'` on an instance without the seam | plain `Error` ("…has no data copy") | none (no lineage, entry or file) |
| version-store failure (no active snapshot, fork failed) | plain `Error`, as before | none, or an invisible orphan lineage |
| the new id is already used by an entry (broken invariant) | `DataCopyError('io')` | that entry and its store untouched; an orphan lineage |
| the copy itself fails | `DataCopyError` with `no_space` / `source_unreadable` / `verify_failed` / `io` | no entry; copy file deleted; journal cleared |
| anything else inside the data step (stray delete, index write) | `DataCopyError('io', …, cause)` | same as above |

For chain-3's failure copy: `no_space` → "there wasn't room"; `source_unreadable` → the original's
data could not be read; `verify_failed` / `io` → the copy could not be made. Every kind offers
"Start fresh" (`fork(entry, versionId, { data: 'fresh' })`). Never fall back silently.

## Guarantees

- A rejected `fork` left no launcher entry for the copy. If deleting the half-written file failed
  too, its journal record stays and the next launch's sweep deletes it; it is never served.
- A resolved `'copy'` fork's store is complete, closed, integrity-checked and carries the source's
  whole accumulated schema (its next generation's floor is the source's at copy time).
- The source store is never written; the store of any appId that has (or resolves to) an entry
  is never deleted by the copy path or the sweep.
- `fork` runs inside the per-repo `serial` section; a copy and a delete of the same repo never
  interleave.

## Busy gating (caller's job)

Callers run `fork` under `runAppOp(appOps, setAppBusy, app.id, 'fork', …)` as `LauncherRoot.onFork`
already does (`onFork(app, opts: ForkOptions)`), so the control shows busy and cannot be
re-triggered for that app while a copy runs. `HomeScreen`'s `onFork` prop takes `ForkOptions`.

## State of Home after this chain

The share row is gone. The fork sheet holds "Start fresh" (`onFork(a, { data: 'fresh' })`) and
Cancel. `COPY.forkShareData` is now unused; chain-3 (or design-system-v1 15.3) deletes it with the
rest of the share-question keys.

## Not provided

No "has this app ever saved data" probe (owner ruling 3, skip the question for a never-saved
original). `StoreAccess` cannot tell without a storage-engine read; see the chain-2 report.
