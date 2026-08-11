# ghost-handlers — interface contract (chain-2 output, for chain-3)

## What `HomeScreen` receives (`src/host/launcher/HomeScreen.tsx`)

Four props were ADDED to `HomeScreenProps`, verbatim (all optional; `LauncherRoot` always passes
all four, together). `HomeScreen` does not read them yet — chain-3 owns every use.

```ts
import type { PendingBuildRecord } from './pending-builds';

  /** Every in-flight / failed / interrupted generation attempt, NEWEST FIRST, straight from
   *  `PendingBuildStore.list()`. Records carrying `editingAppId` are rebuilds and must not become
   *  their own tile — they belong to the installed tile of that id. */
  pending?: readonly PendingBuildRecord[];
  /** Tap: `building` reattaches to its build-progress screen, `failed`/`interrupted` opens the
   *  failure screen hydrated from the record. Never call this for a rebuild record's tile — that
   *  tile is a launchable installed app and its tap belongs to `onOpen`. */
  onOpenPending?: (rec: PendingBuildRecord) => void;
  /** Quick action on a `building` record: aborts the run and deletes the record. */
  onCancelPending?: (rec: PendingBuildRecord) => void;
  /** Quick action on a `failed`/`interrupted` record: deletes the record. */
  onDismissPending?: (rec: PendingBuildRecord) => void;
```

`apps: InstalledApp[]` is unchanged. Every existing prop is unchanged.

## Handler semantics (what the shell does when chain-3 calls them)

| call | shell behaviour |
| --- | --- |
| `onOpenPending(rec)` where `rec.state === 'building'` | `setScreen` back to that run's own live build screen (current stage/delivering), un-detaches it. No new request. A `building` record with no live run logs a warning and does nothing — unreachable, since launch-time demotion has already made such a record `interrupted`. |
| `onOpenPending(rec)` where `rec.state !== 'building'` | Opens `FailureScreen` hydrated from `rec.failure` (an `interrupted` record has none and gets a plain "stopped when the app closed" reason). Its primary action is Retry (new generation, `rec.id` reused), its secondary is Dismiss (delete). |
| `onCancelPending(rec)` | Aborts the in-flight request if this record owns it, deletes the record, refreshes. Stays on the grid. |
| `onDismissPending(rec)` | Deletes the record and returns home. |

Retry/Dismiss are wired inside the shell's failure screen; chain-3 never calls them directly.

## Invariants chain-3 MUST honor

- **Never write the store.** Chain-3 must not import `PendingBuildStore`, call `create`/`delete`/
  `setFailed`/`demoteBuildingToInterrupted`, or touch `AppIndex`. Single-writer discipline
  (design D4) is the shell's; the grid renders `pending` and calls the four handlers.
- **`pending` is already newest-first.** Do not re-sort by `createdAt`; compose ghosts BEFORE
  `apps` (design D1).
- **Dedupe by id, pending wins.** A rebuild record's `id` IS the installed app's id, so ids across
  the two lists genuinely collide by design. Delivery's delete + refresh is not atomic with a
  render, so a delivered app can appear in both lists for one frame.
- **A record with `editingAppId` spawns NO ghost tile.** It renders against the installed tile of
  that id (`editingAppId === id` for these records): `building` → building state on that tile,
  `failed`/`interrupted` → a failure accent while the tile stays fully launchable (design D8).
  Its tap must remain `onOpen`; route the ghost interaction through the accent/long-press.
- **Tile colour** comes from `ghostTileColorFor(rec.id)` (chain-1, `prompt-flow.ts`) — the same
  palette the delivered tile resolves through, so the hue does not change on transmute.
- **Display text** is `rec.workingTitle` (already truncated at creation). Never re-derive it from
  `rec.prompt`, and never show `rec.id`.
- **No live progress.** `PendingBuildRecord` carries no stage/fraction and never will (explicit
  non-goal); a ghost shows a static state, and `BuildStep` stays the only progress surface.
- **No cancel affordance on the tile face** (design D6) — Cancel/Dismiss live in the long-press
  action sheet, alongside the existing Open/Fork/History/Prompt again/Delete rows.

## Error surface

- All four props are optional: a `HomeScreen` rendered without them must still render the
  installed grid exactly as it does today. Guard with `pending ?? []` and optional calls.
- None of the four handlers throws or returns a value; each is fire-and-forget and drives its own
  `refresh()`. `onOpenPending` on a stale/deleted record is a logged no-op, not a throw.
- `rec.failure` is `{ reason: string; diagnostics?: string }` and is ABSENT on every `building` and
  `interrupted` record. Chain-3 has no reason to read it — the shell hydrates the failure screen.

## Also changed (not a grid concern, listed so it is not re-derived)

- `FailureScreenProps` gained `retryable?: boolean` (default `false`): when true the primary
  action takes `COPY.screenErrorRetry` instead of `COPY.failureRephrase`. The shell sets it; no
  new copy string was added.
- Delivery + the pending-record transitions moved out of `LauncherRoot.tsx` into the RN-free
  `src/host/launcher/build-lifecycle.ts` (`startPendingBuild`, `deliverResult`,
  `deliverAndSettle`, `failPendingBuild`, `dropPendingBuild`, `pendingFailure`,
  `hydratedDiagnostics`, `retryBuildScreen`, `freshAppId`, `mapWireRecord`). Chain-3 needs none of
  it; do not call it from a render surface.
