# Storage groups — interface (chain-1: launcher-storage-groups)

Scope: `src/host/launcher/app-index.ts`, `src/host/launcher/store-access.ts`.

## `InstalledApp.storageGroupId?: string`

New optional field on `InstalledApp` (`app-index.ts`). Names the storage group an entry
belongs to: **the founding entry's own launcher `id`**. Absent = the entry is in its own
group (today's per-app behavior, unchanged; no migration needed for existing installs).
Recorded only at creation time (`install` never sets it; `fork` may) — **immutable
thereafter**: no API mutates it post-creation, no join/leave/unlink in v1.

Grouping is transitive through the founder only: forking a fork with `shareData: true`
still resolves to the ORIGINAL founder's id, never re-rooted at the intermediate entry.

## `engineAppId(entry: InstalledApp): string`

Existing method on `StoreAccess`, changed resolution rule:

```ts
engineAppId(entry: InstalledApp): string {
  return entry.storageGroupId ?? entry.id;
}
```

This is the id passed to the runtime engine / storage-engine construction (`useMiniAppHost`
already calls `engineAppId(entry)` — unchanged call site). A bundle never sees this id or
any group concept; no syscall carries it.

## `fork(entry, versionId?, opts?): Promise<InstalledApp>`

Signature **extended**, not replaced, to stay compatible with existing callers
(`LauncherRoot.tsx: access.fork(app)`, `HistoryScreen.tsx: access.fork(app, snapshot.id)`):

```ts
async fork(
  entry: InstalledApp,
  versionId?: string,
  opts?: { shareData?: boolean },
): Promise<InstalledApp>
```

- `opts.shareData === true` → the new entry's `storageGroupId` is set to
  `entry.storageGroupId ?? entry.id` (the founder's own id, whether `entry` is the founder
  or already a sharer).
- `opts.shareData` false/absent, or `opts` omitted entirely (every pre-existing call site) →
  the new entry gets **no** `storageGroupId` — its own group, exactly as before this change.
- `versionId` is unrelated (D6, prior chain): which snapshot to fork from. Independent of
  `shareData`; either, both, or neither may be passed.

The rewind-continuation path (spec: "Rewind continuations share by default") calls
`fork(originalEntry, undefined, { shareData: true })`.

## `AppIndex.storageRefCount(groupId: string): number`

New method on `AppIndex`, mirrors `refCount`'s idiom exactly:

```ts
storageRefCount(groupId: string): number {
  return this.list().filter(a => (a.storageGroupId ?? a.id) === groupId).length;
}
```

## Delete semantics (`StoreAccess.remove`)

Unchanged signature (`remove(entry: InstalledApp): Promise<void>`), extended body: computes
`groupId = this.engineAppId(entry)` **before** removing the index entry, removes the index
entry, then calls `deleteStorage(groupId)` **only if** `storageRefCount(groupId) === 0`
afterward — independently of the pre-existing repo refcount (`refCount`/`store.remove`),
since a storage group and a version-store repo need not share membership. Works founder-first
or sharer-first: the file/db is dropped exactly when the last resolving entry is gone.

## Error surface

No new throws. `fork`/`engineAppId`/`remove` have the same error surface as before this
change (`fork` still throws `cannot fork "<id>": no active snapshot` when there's nothing to
fork from and no `versionId` given).

## No sandbox-visible surface

Nothing here is reachable from a bundle: `storageGroupId`, `shareData`, and
`storageRefCount` are host-only launcher/index concepts, never threaded into `AppRecord`,
the bridge manifest, or any syscall parameter.
