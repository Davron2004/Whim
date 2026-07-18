# Handoff: `StoreAccess` history-surface wrappers + prompt envelope (chain-2 → chain-3)

Interface only. Implementation: `src/host/launcher/store-access.ts` (wrappers),
`src/host/launcher/prompt-envelope.ts` (envelope parsing). Tests: `src/host/launcher/test/
store-access.suite.ts` §19-23, `prompt-envelope.suite.ts` §24-26 (English spec:
`installed-apps.spec.md`).

## Signatures (all on the existing `StoreAccess` class)

```ts
class StoreAccess {
  async history(entry: InstalledApp, opts?: { limit?: number }): Promise<Snapshot[]>;
  async timeline(entry: InstalledApp, opts?: { limit?: number }): Promise<Snapshot[]>;
  async rollback(entry: InstalledApp, snapshotId: string): Promise<{ activeId: string }>;
  async pin(entry: InstalledApp, snapshotId: string, label: string): Promise<Pin>;
  async listPins(entry: InstalledApp): Promise<Pin[]>;
  async diff(entry: InstalledApp, fromId: string, toId: string): Promise<FileChange[]>;
  async activeId(entry: InstalledApp): Promise<string | null>;
  // updated (additive — old call sites with one argument are unaffected):
  async fork(entry: InstalledApp, versionId?: string): Promise<InstalledApp>;
}
```

`Snapshot`, `Pin`, `FileChange` are re-exported, unchanged, from `../version-store` (see
`timeline-verb.md`): `Snapshot = { id: string; prompt: string; createdAt: number }`,
`Pin = { label: string; snapshotId: string | null }`,
`FileChange = { file: string; status: 'added'|'removed'|'modified'; before?: string; after?: string }`.

## Invariant: every wrapper ensures lineage first

Each method above calls the existing private `ensureLineage(entry)` before delegating to the
store, exactly like `activeBundle`/`fork` already did — for a fork entry, `storeIdOf(entry)`
(the shared repo) differs from `entry.id`, and `ensureLineage` is what switches the repo onto
the entry's own `lineageId` before any read/write. No exceptions; do not call `store.*` for a
history verb from anywhere but these wrappers.

## `fork(entry, versionId?)`

`versionId` omitted: behavior unchanged — forks from the entry's current active snapshot.
`versionId` given: forks from that snapshot id instead (the engine resolves any tagged
snapshot, branch-independent — the id does not need to be on the entry's currently-checked-out
lineage's ancestry at all). Same return shape, same naming/`forkedFrom` handling as before —
"make this version its own app" is this same call with `versionId` set to the version being
viewed, reusing the existing fork→install launcher flow unchanged.

## `history` vs `timeline` — which to use for the History screen (read before choosing)

**`history(entry)`** is a strict backward ancestor walk from the entry's own tip. It is safe
in every case, including forks: a fork entry's `history()` can never include a sibling
lineage's snapshot, diverged or not (verified, store-access.suite.ts §20).

**`timeline(entry)`** additionally survives a rollback on the SAME entry (later snaps taken
before the rollback stay listed as roll-forward targets — see `timeline-verb.md`). **Known
gap, verified empirically, engine-level (not fixable from this wrapper):** if a fork has NOT
yet diverged from its fork point (zero snapshots taken on the fork's own lineage since the
fork), `timeline(forkEntry)` can ALSO surface a snapshot committed *later* on the ORIGINAL's
lineage — because the engine's `isSameLine` check (`engine.ts`, chain-1) is DAG-ancestry-only,
and an un-diverged fork's tip is literally the same commit as the shared fork point, so any
descendant of that commit reads as "same line" regardless of which branch it was actually
committed on. Once the fork has taken even one snapshot of its own, this does not recur
(verified, store-access.suite.ts §20b).

Recommendation for chain-3: either (a) use `history(entry)` for the primary History-screen
listing (always fork-safe) and reserve `timeline` specifically for surfacing roll-forward
targets after a rollback on the CURRENT entry, or (b) use `timeline(entry)` throughout and
accept this narrow edge case (a freshly-forked, not-yet-touched fork, while the original keeps
generating) as a known limitation pending a possible future engine-level fix. This wrapper
exposes both verbs faithfully; it does not silently filter or patch this gap.

## Re-pin semantics (D8) — verified against the engine

Re-pinning a label already in use, to a different snapshot, **moves** the label (last write
wins) — it does **not** throw. The engine's `pin()` uses `git.tag(..., force: true)`, which
overwrites the existing tag. `listPins`/`getPinned` for that label resolve only the newest
snapshot afterward; the old snapshot remains reachable by its own snapshot id, just no longer
under that label. No error-normalization layer was needed in the wrapper.

## `activeId(entry)`

Thin wrapper over `store.active(storeIdOf(entry))`, returning just the id (or `null` if the
entry has never snapshotted). Reflects rollbacks: after `rollback(entry, x)`, the next
`activeId(entry)` call returns `x`. Use this for the History screen's "current version"
marker (D3).

## `parsePromptEnvelope` (`src/host/launcher/prompt-envelope.ts`, design D4)

```ts
interface PromptEnvelope { text: string }
function parsePromptEnvelope(raw: string): PromptEnvelope;
```

Strict-parses `raw` as `{v: 1, text: string}` JSON. On ANY mismatch — invalid JSON, `v !== 1`,
missing/non-string `text`, or a non-object parse result (array, number, `null`, …) — falls back
to `{text: raw}` unchanged. Never throws. Use this to render every version's prompt on the
History screen; do not parse `Snapshot.prompt` any other way. Launcher-local — do not import it
from, or move it to, `contract/`.
