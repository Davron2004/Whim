# Research digest: version-history-ux (roadmap #6) — per-app history screen over the version store's product verbs

## Relevant files
- `src/host/version-store/engine.ts` — `VersionStore`: all product verbs (snapshot/history/diff/rollback/pin/listPins/getPinned/fork/lineages/switchLineage/getSnapshot/active/remove/compact).
- `src/host/version-store/index.ts` — public re-exports, `createPersistentStore`, `assertNoGitLeak` guard.
- `src/host/version-store/config.ts` — `historyLimit` default 100 (cap, not cursor pagination).
- `src/host/launcher/store-access.ts` — `StoreAccess`, the sole sanctioned launcher→version-store path (#43b D2 contract note: "#6 reads through this, never raw `VersionStore`"); currently exposes only `install`/`activeBundle`/`fork`/`remove`/`engineAppId` — no history/rollback/pin/diff wrappers.
- `src/host/launcher/app-index.ts` — `InstalledApp` shape.
- `src/host/launcher/LauncherRoot.tsx` — `Screen` union + plain-state screen switch.
- `src/host/launcher/HomeScreen.tsx` — tile grid + long-press action sheet (Open/Fork/Delete).
- `src/host/launcher/SettingsScreen.tsx` — full-screen sibling pattern (own `BackHandler`, `shellPalette`, no nav lib).
- `src/host/launcher/copy.ts` + `src/host/launcher/test/product-verbs.suite.ts` — centralized copy + the build-guard denylist.
- `src/host/storage-engine/{index.ts,engine.ts,schema.ts}` — `diffSchemas`/`validateArtifact`/`_meta` (schema-artifact evolution, relevant to any per-snapshot data-shape annotation).
- `openspec/specs/mini-app-versioning/spec.md`, `openspec/specs/mini-app-forking/spec.md`, `openspec/specs/app-launcher/spec.md`.
- `docs/decisions.md` #36, #38, #39, #40, #43b.

## Current behavior
Version-store verbs (`engine.ts`), one-line signatures:
- `snapshot(appId, artifacts, prompt): Promise<Snapshot>` (`engine.ts:200`) — `Snapshot {id, prompt: string, createdAt}` (`engine.ts:35-39`); `prompt` is free text, stored as the commit message + a tracked `prompt.md`; store is content-agnostic (D6, `engine.ts:19`).
- `history(appId, {limit?}): Promise<Snapshot[]>` (`engine.ts:240`) — walks `git.log({ref:'HEAD', depth: limit})` (`engine.ts:246`), default cap 100, no cursor param.
- `diff(appId, fromId, toId): Promise<FileChange[]>` (`engine.ts:264`) — per-file `{file, status, before?, after?}`.
- `rollback(appId, snapshotId): Promise<{activeId}>` (`engine.ts:306`) — `isSameLine` predicate (`engine.ts:298-303`) permits both directions (rollback OR roll-forward) but refuses any target off the active lineage; moves the branch ref then checks out (`engine.ts:316-317`).
- `pin(appId, snapshotId, label): Promise<Pin>` (`engine.ts:322`), `listPins(appId): Promise<Pin[]>` (`engine.ts:330`), `getPinned(appId, label): Promise<SnapshotContent>` (`engine.ts:345`) — pins are labeled, survive later generations.
- `fork(appId, snapshotId): Promise<{lineageId}>` (`engine.ts:357`), `active(appId): Promise<SnapshotContent|null>` (`engine.ts:393`), `getSnapshot(appId, snapshotId): Promise<SnapshotContent>` (`engine.ts:386`).

**Verified fact 1 — roll-forward enumeration gap:** `rollback()` writes the branch ref to the target oid and checks out (`engine.ts:316-317`); `history()` always logs from `ref:'HEAD'` with `depth: limit` (`engine.ts:246`), which is an ancestry walk from the current tip. After a rollback moves HEAD backward, snapshots that were later on the same line are *not* ancestors of the new HEAD, so a subsequent `history()` call omits them — even though their snap tags still exist (nothing deletes tags) and `isSameLine` (`engine.ts:298-303`) would accept them as valid roll-forward targets for `rollback()`. The store API has no verb that lists "everything reachable by tag on this lineage" — only tip-ancestry history and tag-addressed point lookups (`getSnapshot`, `resolveSnap` at `engine.ts:151-157`).

**Verified fact 2 — fork targets any tagged snapshot:** `fork()` calls `this.resolveSnap(gitdir, snapshotId)` (`engine.ts:359`), which resolves `refs/tags/whim/snap/<id>` (`engine.ts:151-157`) — branch-independent. So `fork` works on a snapshot that is an "abandoned tail" (unreachable from any branch tip after a rollback rewrote the branch ref), unlike `rollback`, which is lineage-gated.

**Verified fact 3 — delete refcounts the repo, not per-app storage:** `StoreAccess.remove(entry)` (`store-access.ts:143-151`) calls `this.deleteStorage(entry.id)` unconditionally at line 146 (per-launcher-id storage-engine delete, no refcount check), then only calls `this.store.remove(repo)` when `this.index.refCount(repo) === 0` (line 147-148) — the version-store repo is shared/refcounted across forks, the storage-engine data is not (each launcher id, including each fork, owns its own storage-engine db per D8, so an unconditional per-app delete is correct there, not a bug).

## Constraints and invariants
- Git vocabulary must never cross the launcher surface (mini-app-versioning spec, `openspec/specs/mini-app-versioning/spec.md:47-54`; app-launcher spec `openspec/specs/app-launcher/spec.md:100-109` names realm/generation/hash-form snapshot ids explicitly).
- Build guard: `src/host/launcher/test/product-verbs.suite.ts:14-18` — a regex denylist run over every string in `copy.ts`'s `COPY` table (part of `npm run launcher:test`, 433 checks, blocking CI): `git`, `commit`, `oid`, `sha`, `hash`, `ref`, `blob`, `tree`, `gitdir`, `HEAD`, `realm`, `generation`, `dispatcher`, `iframe`, `webview`, `lineage`, `snapshot`, `fork-\d`, 40-hex strings. **Verified: `version` is not on this denylist** (no `\bversion\b` pattern present).
- Rollback is non-destructive and lineage-scoped; a cross-lineage id must error naming `fork`/`switchLineage` (spec scenario, `openspec/specs/mini-app-versioning/spec.md:24-27`).
- Forks never require merging (`openspec/specs/mini-app-forking/spec.md:15-22`); `git.merge` exists in the dependency but is never called (decision #39, `docs/decisions.md:378`).
- Decision #39 (`docs/decisions.md:377`): on-device, history ~10–29ms, rollback ~58–183ms — named "the depth-scaling ops," still uncapped-safe for Tier-0 sizes but capped by `historyLimit`.
- Storage engine (#38/#40): schema artifact is tracked/diffed/rolled-back like any other file (content-agnostic D6); `diffSchemas`/`validateArtifact` are pure exports (`src/host/storage-engine/index.ts:20`) already reused by static checks (#9); additive-only evolution means a schema diff between any two snapshots can only ever contain additions/display-renames, never deletions (`docs/decisions.md:363-368,390-393`); `_meta` persists the accumulated union, never the last-applied artifact (`docs/decisions.md:392`, `src/host/storage-engine/engine.ts:11`).
- `InstalledApp` (`app-index.ts:24-41`) carries no "current snapshot" or "current pin" field — only `lineageId`; "active" is derived live from the store's HEAD via `store.active(storeId)`.

## Integration points
- `LauncherRoot.tsx:33-37` `Screen` union — a history screen would be a new variant, rendered in the same if/else chain as `home | app | dev | settings`.
- `HomeScreen.tsx:126-137` long-press action sheet (`SheetRow` for Open/Fork/Delete) — the existing entry-point shape for adding a history action.
- `SettingsScreen.tsx` — the structural precedent for a full-screen, non-mini-app-host launcher screen: owns its own `BackHandler` binding directly (does not touch `BackPolicy`, which binds only inside `useMiniAppHost`), colors via `shellPalette(theme)`, strings via `copy.ts`'s `COPY` table.
- `StoreAccess` (`store-access.ts`) — the ledger-mandated single path in; `ensureLineage(entry)` (`store-access.ts:75-80`, "checks first") is the discipline any new wrapper method must apply before calling `VersionStore` history/rollback/pin/diff, since a fork entry's `storeId`+`lineageId` differ from its launcher `id`.
- `npm run vstore:test` and `npm run launcher:test` are the existing blocking-CI suites that would gain coverage for any new verbs/UI.

## Risks and unknowns
- I did not verify whether `src/host/launcher/test/store-access.suite.ts` exercises any history/rollback/pin path today (none exist to test) — this is new surface, not a refactor.
- Whether the roll-forward enumeration gap (fact 1) needs a store-level fix or a UI-level workaround (e.g. listing pins/tags separately) is unresolved in code; I report the gap, not a resolution.
- Whether "structured-prompt tagging" (roadmap #6 wording) implies a new tracked artifact file (content-agnostic D6 permits this for free) or a JSON-encoded `prompt` string is not decided anywhere in code or docs.
- I did not check `src/host/launcher/test/installed-apps.spec.md` for any history-adjacent acceptance scenarios already sketched.

## Open questions for the planner
1. Should `StoreAccess` gain `history`/`rollback`/`pin`/`listPins`/`diff` wrapper methods (per the #43b "reads through store-access, never raw VersionStore" contract note), and should they call `ensureLineage` per the existing fork/activeBundle pattern?
2. Does the roll-forward enumeration gap (verified fact 1) need a store-level addition (e.g. a tag-enumeration verb), or can it stay a launcher-side UX decision (e.g., listing pins only, never "future" unpinned snapshots)?
3. Is "structured-prompt tagging" scoped to this change alone, or does it wait on #7 (`prompt-flow-ux`, unproposed) to define the two-stage prompt shape it would tag?
