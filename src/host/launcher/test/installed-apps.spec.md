# Installed-apps store test spec (task 1.2 — §16.5 English-first)

Two Node-testable modules back the launcher's persistence (design D1/D2/D7):

- `src/host/launcher/app-index.ts` — the **index**: a small, synchronous, list-shaped MMKV
  record per installed app + one ordered id list. Behind a mockable `KVBackend` seam (the same
  `getString/set/delete/getAllKeys` surface `react-native-mmkv` and `MapKVBackend` expose).
- `src/host/launcher/store-access.ts` — the **only sanctioned VersionStore path**: lineage
  check-and-switch per entry, fork, delete-with-refcount, active-bundle read. Holds the
  `storeId`/`lineageId` discipline so no other launcher consumer touches raw `VersionStore`.

`InstalledApp` (the launcher-facing contract, D1):

```
{ id, name, example?, createdAt, record /* #41 AppRecord, verbatim */,
  storeId? /* present only on forks — the original's repo */, lineageId, forkedFrom? }
```

The launcher id IS the store appId for original installs (`storeId` omitted ≡ `id`); fork
entries carry an explicit `storeId` pointing at the original's repo plus their own `lineageId`.

## app-index behaviors

### CRUD + ordering
1. `put` then `get(id)` returns the record verbatim; `get` of an unknown id → `null`.
2. `list()` returns records in install order (the ordered id list), newest last (or a defined,
   stable order); a second `put` of the same id updates in place without duplicating the order
   entry.
3. `remove(id)` drops the record and its order entry; `list()` no longer contains it; the
   relative order of the survivors is unchanged.

### Restart survival
4. Construct a fresh index over the SAME `KVBackend` map (simulating a process kill): `list()`
   returns the same records, same names, same labels, same order.

### Seed marker / idempotence
5. `seedVersion()` is null/0 on a virgin backend; after `markSeeded(v)` it reads back `v`.
6. Seeding is idempotent: running the seed routine twice writes each example exactly once
   (`list()` has no duplicates) and does not bump the order list a second time.
7. Deleted examples stay deleted: after `remove`ing a seeded example and re-running the seed
   routine at the same seed version, the example does NOT reappear (the marker gates it).

### No git vocabulary
8. Every record returned by `get`/`list` passes `assertNoGitLeak` — no `oid/sha/hash/commit/
   ref/head/tree/blob` keys, no 40-hex strings. `lineageId` values are product strings
   (`main`, `fork-1`), never refs.

## store-access behaviors (over MemoryFs-backed VersionStore + a Map index)

### Fork mapping (D2)
9. `fork(entry)` of an original `A`: calls `store.fork(A.id, activeSnapId)`, creates a NEW
   index entry whose `storeId === A.id`, whose `lineageId` is the new lineage, and whose
   `forkedFrom` records `{ id: A.id, name: A.name }`. The new entry's own `id` is fresh
   (never equal to `A.id`).
10. Independent evolution: a snapshot taken through the fork entry does not appear in the
    original's history, and vice versa (the mini-app-forking contract).
11. Correct lineage on every access: reading the original's active bundle after a fork still
    returns the original's bundle (the wrapper switches the repo's lineage back when the
    original is next accessed — `fork()` left HEAD on the new lineage).
12. Own engine appId: the fork's *runtime* engine appId is its launcher `id` (NOT `storeId`),
    so its user data is its own. (Asserted as the value `store-access`/the host launch path
    passes to the storage engine — load-bearing per D8: the realm launches with the launcher
    id as its engine appId, while version-store access uses `storeId` + lineage.)

### Active-bundle read
13. `activeBundle(entry)` returns the `bundle.js` artifact of the entry's active snapshot,
    after switching to the entry's lineage if the repo is currently on another.

### Delete with repo refcount (D2)
14. Last reference: deleting the only entry that references a repo calls the store's
    `remove(appId)`; afterwards the store holds zero keys for that repo.
15. Surviving sibling: deleting the original while a fork still references the same repo
    removes only the index entry — the repo keys remain and the fork still launches with its
    history intact.
16. No per-app residue: delete also drops the entry's user-data database (the storage engine's
    `storage/<launcherId>.db`); "delete leaves no per-app residue" (D2/D8). (The Node suite
    asserts the store side + that the host delete path is handed the right `deleteStorage`
    target; the SQLite-file removal itself is on-device, task 7.2.)

## store `remove(appId)` (task 4.1, asserted in vstore:test, restated here)
17. After `remove(appId)`, the backend (MemoryFs/KvBackedFs) holds zero paths/keys under that
    app's repo; a subsequent `history(appId)` is empty and `active(appId)` is null.
18. `remove` returns a product-verb shape (e.g. `{ removed: true }`) with no git terminology
    (passes `assertNoGitLeak`); removing an app that other lineages do NOT independently key is
    a single clean prefix delete (one repo == one key prefix in `KvBackedFs`).
