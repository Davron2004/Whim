# Contract: storage-copy (chain-1 → chain-2, chain-4)

The storage engine's one-time store copy. Interface only.

## Imports (never through the `storage-engine/index.ts` barrel from Node code)

| What | Path | Loads in Node? |
|---|---|---|
| `CopyStorage`, `CopyReport`, `DataCopyError`, `DataCopyErrorKind`, `isSupersetSchema` | `src/host/storage-engine/copy-contract` | yes (no binding) |
| `copyStore`, `CopyOpener`, `CopyConnection`, `storeFileName` | `src/host/storage-engine/copy` | yes (no binding) |
| `createNodeCopyStorage(dir)`, `createNodeCopyOpener(dir)` | `src/host/storage-engine/copy-node` | yes (node:sqlite, node:fs) — tests only |
| `copyStorage` (device) | `src/host/storage-engine` (index, beside `deleteStorage`) or `.../copy-device` | no: requires op-sqlite lazily when a copy runs |

Device wiring: `import { copyStorage, deleteStorage } from '../storage-engine'` at the `new StoreAccess(...)` site.
Node wiring: `createNodeCopyStorage(dir)` over the same directory the file-backed Node engine writes `<appId>.db` into.

## Signatures (verbatim, `copy-contract.ts`)

```ts
export interface CopyReport {
  bytes: number;
  ms: number;
}

export type CopyStorage = (args: { from: string; to: string }) => Promise<CopyReport>;

export type DataCopyErrorKind = 'no_space' | 'source_unreadable' | 'verify_failed' | 'io';

export class DataCopyError extends Error {
  readonly kind: DataCopyErrorKind;
  readonly cause: unknown;
  constructor(kind: DataCopyErrorKind, message: string, cause?: unknown);
}

/** True when every source collection exists in `copy` and each of its columns, active or
 *  retired, exists there with the same type. Active/retired status is not compared. */
export function isSupersetSchema(copy: AppliedSchema, source: AppliedSchema): boolean;
```

`AppliedSchema` is from `src/host/storage-engine/schema`.

## Opener interface (`copy.ts`)

```ts
export interface CopyConnection {
  readonly sql: SqlExecutor;          // synchronous reads and per-connection pragmas
  readonly dir: string;               // directory holding this connection's file
  runAsync(statement: string, params: SqlBindValue[]): Promise<void>; // off the JS thread on device
}
export interface CopyOpener {
  open(appId: string): CopyConnection; // throws when the store cannot be opened
  remove(appId: string): void;         // delete appId's file; absent is a no-op
}
export function copyStore(opener: CopyOpener, args: { from: string; to: string }): Promise<CopyReport>;
export function storeFileName(appId: string): string; // `${appId}.db`
```

- Node opener: `open` throws for a file that does not exist (it never creates a source); `remove` deletes the file and any `-journal`/`-wal`/`-shm`.
- Device opener: `open({ name: '<appId>.db', location: 'storage' })`; `dir` is the directory of `getDbPath()`; `runAsync` is op-sqlite's async `execute`; `remove` is `open(...).delete()`. op-sqlite's `open` creates a missing file, so on device a never-written source copies as an empty store and gains an empty file.

## What `copyStore` does, in order

1. Refuses (`io`) a `from`/`to` that is empty, `.`, `..`, or contains `/`, `\` or NUL, and `from === to`. Nothing is opened.
2. Opens the source, runs one throwing read, reads its accumulated `_meta` (`readAppliedSchema`).
3. Sets `PRAGMA synchronous = FULL` and `PRAGMA busy_timeout = 5000` on the source connection (connection settings; nothing is written to the source).
4. Snapshots the whole source into `<dir>/<to>.db` with one statement, path bound as a parameter (one read transaction: one committed state; row ids, retired columns, `kv`, `_meta` unchanged).
5. Opens the copy: `PRAGMA quick_check` must be `ok` and `isSupersetSchema(copy _meta, source _meta from step 2)` must hold. Closes it.
6. Resolves `{ bytes: page_count * page_size of the copy, ms: wall time of the whole call }`. The source connection is always closed.

## Error-kind mapping

The SQLite primary code comes from node:sqlite's `errcode` (low byte) or, for op-sqlite (message only), from SQLite's own message text: `database or disk is full` = 13, `database disk image is malformed` = 11, `file is not a database` = 26.

| Where it fails | Kind |
|---|---|
| any step, code 13 (SQLITE_FULL) | `no_space` |
| opening or reading the source (step 2) | `source_unreadable` |
| the snapshot, code 11 or 26 (source found corrupt) | `source_unreadable` |
| the snapshot, target already holds data (`output file already exists`) | `io` (refusal) |
| the snapshot, anything else | `io` |
| opening or checking the copy (step 5) | `verify_failed` |
| invalid ids (step 1) | `io` |

Every rejection is a `DataCopyError`; `cause` holds the binding's error when there was one.

## Guarantees

- The source store is never written: its file is byte-identical after any outcome (tested by hash).
- A target that already holds a store is refused with `io` and left byte-identical. SQLite writes over a zero-byte file at the target (it holds no data).
- After any other rejection, the file the copy wrote is deleted before the promise rejects. If that delete itself throws, the original error is still the rejection, and the file is left for the caller's journal sweep (design D2) — callers must still run their own `deleteStorage(to)` cleanup per D2.
- On resolve, the copy is complete, closed, integrity-checked and carries every source identity: its burned-ID floor equals the source's at copy time, and retired IDs stay burned in it.
- The snapshot statement's keyword appears in no `src/` file but `copy.ts` (the storage suite fails otherwise).

## Device facts left open for chain-4 (`RUN_DATA_COPY_PROBE` in `App.tsx`, `DataCopyProbeScreen`)

The verdict reports: `sqliteVersion`, `journalMode`, `paths.sourceDbPath`/`copyDbPath` (what `getDbPath()` gives), `secondConnection` (a copy beside an engine that keeps writing: `failedWrites`, `writeErrors`, row counts), `large` (≥ 50 MiB, `ms` vs the 5000 ms budget, `quick_check`), `durability` (the previous launch's copy read back after a kill: run, kill the app the moment the verdict renders, relaunch).
