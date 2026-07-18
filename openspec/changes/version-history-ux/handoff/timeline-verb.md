# Handoff: `timeline` verb (chain-1 → chain-2)

Interface only. Implementation lives in `src/host/version-store/engine.ts`; exported
(unchanged export surface — `VersionStore` was already re-exported) via
`src/host/version-store/index.ts`.

## Signature

```ts
class VersionStore {
  async timeline(appId: string, opts?: { limit?: number }): Promise<Snapshot[]>;
}
```

- Same `VersionStore` class you already reach via `createMemoryStore()` /
  `createPersistentStore()`. No new export name was added — `timeline` is a method
  on the already-exported `VersionStore`.
- `Snapshot` is the existing exported type, unchanged: `{ id: string; prompt: string; createdAt: number }`.

## Ordering guarantee

Newest first, ordered by commit timestamp (`createdAt` descending) — NOT ancestry-walk
order. This is what makes it differ from `history()`: `history()` only sees `HEAD`'s
ancestors, so it can go blind to snapshots later on the same line after a rollback moves
`HEAD` backward. `timeline()` enumerates every snap tag and keeps only the ones on the
active lineage's line (ancestors AND tag-reachable descendants of the current tip), so
those later snapshots stay listed and remain valid `rollback()` (roll-forward) targets.

## Cap semantics

`opts.limit ?? config.historyLimit` (same config field `history()` uses, default 100).
After sorting newest-first, the array is truncated to `limit` entries — same cap
semantics as `history()` (a hard count cap, not cursor pagination).

## Lineage scoping

Only snapshots on the **active** lineage's line are returned — reuses the existing
private `isSameLine` predicate against the current branch tip (equal, ancestor, or
descendant of the tip). Snapshots that live only on another fork lineage are excluded.
Switching lineage (`switchLineage`) changes what `timeline()` considers "active" on the
next call, same as it already does for `history()`/`active()`.

## Invariants preserved

- Additive only: no existing verb (`history`, `rollback`, `pin`, `fork`, …) changed
  shape or behavior.
- Same `Snapshot` shape as `history()` — when there is no rollback/fork divergence,
  `timeline()` and `history()` return identical arrays.
- No git vocabulary crosses the surface (`assertNoGitLeak` passes on `timeline()`'s
  return value, same as every other verb).

## Error / edge surface

- App never snapshotted (no repo dir yet) → resolves `[]`, never throws.
- Repo exists but is unborn (initialized, zero commits) → resolves `[]`, never throws.
- Any other internal failure (e.g. a corrupted repo) propagates as a rejection — mirrors
  `history()`'s "only swallow the unborn-HEAD case" contract.

## What chain-2 should build on this

`StoreAccess.timeline` (design D6) is a thin pass-through wrapper, same pattern as the
existing `StoreAccess.history` wrapper — no new error handling is required beyond what
that existing wrapper already does, since `timeline()`'s edge cases (empty/unborn) both
resolve to `[]` rather than throwing.
