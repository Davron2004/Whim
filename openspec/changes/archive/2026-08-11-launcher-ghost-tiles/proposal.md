## Why

A generation in flight or a generation that died leaves **zero persisted trace** today: the launcher id is allocated only inside the success path (`deliverResult`), failures only set transient screen state, and "Leave it running" returns the user to a grid that shows no evidence anything is happening (research.md §2–§3). The user cannot tell whether their app is still being built, silently failed, or never started — the single most trust-damaging gap in the prompt→app loop.

## What Changes

- **Pending-build record**: a small persisted record is written the moment a generation starts (own KV keyspace alongside `AppIndex`, NOT an `InstalledApp` record — the store-is-source-of-truth ordering of decision #43b/D1 is preserved; an app record still never exists without a bundle behind it). States: `building`, `failed`, `interrupted`. Deleted on successful delivery, on user cancel, and on dismiss.
- **Up-front launcher id**: the launcher id is allocated at generation start, carried in the pending record, and threaded through `deliverResult`, so on success the ghost transmutes into the real tile in place (same grid position, same key).
- **Ghost tiles on the home grid**: pending records render as greyed, non-launchable tiles interleaved with real ones. Identity = working title truncated from the user's prompt + deterministic hash-derived tile color from the launcher id. `building` and `failed`/`interrupted` are visually distinct states.
- **Persistence across restarts**: process death mid-build surfaces the record as an `interrupted` ghost on next launch; failed ghosts persist until dismissed or retried. Nothing vanishes silently anymore.
- **Ghost interactions**: tap on a `building` ghost reopens the build-progress screen (reattaching to the in-shell stream from "Leave it running"); tap on a `failed`/`interrupted` ghost opens the failure screen with Retry (re-run the stored prompt) and Dismiss. Long-press offers the same quick actions (Cancel while building; Dismiss otherwise). No always-visible cancel affordance on the tile face — destructive actions stay one deliberate step away.
- **Rebuild/edit of an existing app** spawns no ghost; the existing tile shows a `building` state instead.

Out of scope (deliberately deferred): mascot/animations, live per-tile progress streaming (BuildStep remains the progress surface), the generated-icon system, a reopenable build-progress timeline for *completed* runs, resuming an interrupted stream.

## Capabilities

### New Capabilities

- `pending-builds`: the persisted pending-build record — lifecycle (created at generation start; resolved on delivery/cancel/dismiss), states (`building`/`failed`/`interrupted`), identity fields (up-front launcher id, prompt-derived working title), restart semantics (live `building` records demote to `interrupted` on relaunch), and the invariant that a pending record is never an `InstalledApp` and never touches the version store.

### Modified Capabilities

- `app-launcher`: the home grid renders ghost tiles for pending-build records (greyed, non-launchable, distinct building/failed visuals, hash-derived color); ghost tap/long-press behaviors; existing-app rebuilds mark the installed tile as building.
- `prompt-flow`: generation start writes the pending record and allocates the launcher id up front; delivery/cancel/failure resolve it; "Leave it running" leaves a visible ghost; tap-to-reattach returns to the build screen.

## Impact

- `src/host/launcher/`: `LauncherRoot.tsx` (`onBuildIt`, `deliverResult`, `freshAppId` timing, `onLeaveRunning`), `app-index.ts` (or a sibling `pending-builds.ts` store on the same `KVBackend`), `HomeScreen.tsx`, `app-tile.tsx` (ghost visual state), `prompt-flow.ts` (pure-state additions), failure screen wiring.
- Specs: `openspec/specs/app-launcher/`, `openspec/specs/prompt-flow/` (deltas), new `pending-builds` spec.
- Tests: `launcher:test` suite additions (pending-record lifecycle, restart demotion, transmute-on-success, no-ghost-for-edits). No server, contract, sandbox, or storage-engine changes.

## ⚠ ARCHIVE ORDER CONSTRAINT — read before `/opsx:archive`

**`launcher-ghost-tiles` MUST be archived AFTER `shell-redesign-v2`.**

This change's delta carries a `## MODIFIED Requirements` entry for *A tile's colour is the app's
declared colour, with a deterministic fallback*. That requirement does **not** exist in
`openspec/specs/app-launcher/spec.md` today — it exists only in `shell-redesign-v2`'s own
unarchived delta. Archiving this change first would leave the MODIFIED block targeting nothing.

Why the entry is needed at all: this change makes the launcher **inject** a tile colour
(`ghostTileColorFor(appId)`) into `record.manifest.tileColor` for a new install whose generated
manifest declares none, so the ghost tile's hue survives the transmute into the real tile. After
that, `manifest.tileColor` no longer means "the app declared this" — it means "declared OR
launcher-injected" — and the `appColor(name)` fallback is unreachable for every post-change
install. The MODIFIED entry restates the requirement to cover both sources, keeping the archived
live spec truthful about what the field holds. Its heading matches `shell-redesign-v2`'s verbatim
so it resolves as a modification rather than adding a second, contradictory tile-colour requirement.
