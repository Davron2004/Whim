# Handoff: store-access-prompt-flow (chain-2)

Interface added to `src/host/launcher/store-access.ts` and `src/host/launcher/history-logic.ts`
for the prompt flow's delivery path (design D6/D7). All version-store access still goes
exclusively through `StoreAccess`; no new raw `VersionStore` exposure.

## `StoreAccess.update`

```ts
export interface UpdateSpec {
  record: AppRecord;
  bundleSource: string;
  /** Optional storage-engine schema artifact, written alongside `bundle.js` when supplied. */
  schemaJson?: string;
  /** The structured prompt tracked as this snapshot (surfaces in the History screen). */
  prompt: string;
}

update(entry: InstalledApp, spec: UpdateSpec): Promise<InstalledApp>
```

- `ensureLineage(entry)` first (same discipline as every other wrapper method).
- `store.snapshot(storeIdOf(entry), { 'bundle.js': spec.bundleSource, ...(spec.schemaJson != null
  ? { 'schema.json': spec.schemaJson } : {}) }, spec.prompt)` — snapshots onto the entry's own
  existing lineage (no fork, no new index entry).
- `index.put({ ...entry, record: spec.record })` — returns the updated `InstalledApp`.
  `id`/`lineageId`/`createdAt`/`storeId`/`storageGroupId`/`forkedFrom` are all carried over
  unchanged; only `record` changes.
- **`schema.json` is written only when `spec.schemaJson` is supplied.** Because the store's
  `snapshot()` is content-agnostic (drops any previously-tracked file absent from the new
  artifact map), an `update` call that omits `schemaJson` will NOT carry forward a schema.json
  tracked by an earlier snapshot — callers that want it to persist must resupply it every time.

## `InstallSpec` extension

```ts
export interface InstallSpec {
  id: string;
  name: string;
  record: AppRecord;
  bundleSource: string;
  prompt: string;
  example?: boolean;
  /** Optional storage-engine schema artifact, written alongside `bundle.js` when supplied. */
  schemaJson?: string;
}
```

`install()` writes `schema.json` under the same "only when supplied" rule as `update`. No other
change to `install`'s behavior or return shape.

## `StoreAccess.activeSource`

```ts
activeSource(entry: InstalledApp): Promise<string>
```

Mirrors `activeBundle` exactly (same lineage-ensure, same error on no active snapshot). **Known
limitation (design D7):** the store tracks only one `bundle.js` artifact today — there is no
on-disk `source` vs. compiled-`bundle` distinction yet, so `activeSource` currently returns the
same text `activeBundle` does (the compiled bundle, not original TypeScript). v1's edit flow must
re-send that compiled text as `GenerateRequest.app.source`; a future change that needs true
source-text round-tripping will need to add a tracked `source.ts` artifact — out of scope here.

## `isAtTip` (`src/host/launcher/history-logic.ts`)

```ts
export async function isAtTip(access: StoreAccess, app: InstalledApp): Promise<boolean>
```

- Reuses `listVersions(access, app)` — the same fork-safe `history()` (forks: `app.storeId !=
  null`) vs. `timeline()` (originals) split already used by the History screen, so it inherits
  the same F1 DAG-ambiguity guard rather than a second, differently-buggy check.
- `true` iff `listVersions(...)[0]?.id === (await access.activeId(app))` — i.e. the entry's active
  snapshot is the newest row the History screen's own listing would show.
- `true` immediately after `install` and after every fresh `update` (both snapshot onto the tip);
  `false` after a `rollback` to any non-newest snapshot; stays accurate for an undiverged fork
  even while the original's lineage keeps advancing (each entry's own line, not global HEAD).

## Call-site expectations for consumers (chain-1 / the prompt flow itself)

- The prompt flow's post-generation delivery for an **existing entry being updated in place**
  MUST call `StoreAccess.update`, never a raw `store.snapshot` + `index.put` pair.
- Forking-and-then-updating (a silent shared continuation) still goes `StoreAccess.fork(...)`
  followed by `StoreAccess.update(...)` on the returned fork entry — `update` has no fork
  semantics of its own, it always writes onto the entry's OWN existing lineage.
- Every wrapper here still applies the existing ensure-lineage discipline (spec requirement:
  "Delivery only through StoreAccess" — `specs/app-launcher/spec.md`).
