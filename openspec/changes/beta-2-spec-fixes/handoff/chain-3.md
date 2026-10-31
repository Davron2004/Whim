# chain-3 needs-update-routing — handoff

## What changed
- `grid-composition.ts`: `ComposeOptions.protocolLevel: number` (required); `attemptState` returns
  `needs-update` only when `stillNeedsUpdate(rec, protocolLevel)` (imported from
  `build-lifecycle.ts`, already Node-importable; nothing moved). A caught-up record is an ordinary
  `failed` cell (What happened, Try again, Discard) and collapses after a day like any failure.
- `HomeScreen.tsx`: passes `protocolLevel: PROTOCOL_LEVEL` (`wire-headers.ts`) to `composeGrid`.
- `LauncherRoot.tsx` `settleServerEnding`: a stream `update` fallback still settles the record
  `failed` (notice as reason, `{kind:'update', protocolLevel: PROTOCOL_LEVEL}`), then lands on
  `failureFromRecord(record)` + `announceFailure()` (needs-a-newer-Whim kind) instead of
  `updateScreenFrom`. BASE gating kept: in place of the Making page, or for a detached run only
  where `updateMayInterrupt` (Home, Describe). Non-persisted settlement: generic failure, as before.
  Unchanged (update screen): clarify / rewrite / report fallbacks, the launch check, every
  `update_required` refusal (ruling 13).
- Tile tap / menu on a `needs-update` cell already opened `failureFromRecord` at BASE (no change).
- `docs/design/system.md` §3.2 Needs update row: Tap "Failure page" (was "Update screen").

## Tests
- `grid-composition.suite.ts`: new case, remedy levels L-1 / L / L+1 at running level L read
  `failed` / `needs-update` / `needs-update` (Try again on the first, Update Whim on the third); at
  L+1 the L record reads `failed` too. Fixture remedy now defaults to `PROTOCOL_LEVEL` (what the
  launcher writes) instead of a literal 9; every `composeGrid` call passes `protocolLevel`.
- `flow-messages-ui.suite.tsx` (rendered `LauncherRoot`, the stub's own `stubFutureFrame('update')`):
  mid-build case asserts the Failure page (kind `needs-update`, "Finishing this needs the latest
  Whim.", Update Whim + Not now), no update screen, record failed with notice + update remedy,
  nothing installed, Not now -> Home with the ghost. Detached case: Failure page over Home. Two
  more cases only changed their wait to the Failure page. Clarify/rewrite/report cases unchanged.

## Red-check evidence
- Green: `npm run launcher:test` 19682 passed, 1 failed = #232 (whim-sheet "past a hundred
  versions … version line" timeout) only. typecheck exit 0; eslint clean on touched files.
- Red (BASE `attemptState` predicate and BASE `updateScreenFrom` landing restored together, one
  run, then `git checkout`): 8 failed = #232 + 3 new grid-composition assertions (caught-up record
  read `needs-update`, menu `update,discard`) + the 4 launcher fallback cases (timed out waiting
  for the Failure page). Clarify/rewrite/report `update` cases passed both ways.

## Deviations
- [A] Stale doc comments in `wire-compat.ts` / `wire-fallback.ts` reworded (outside file list).
- [A] Launcher tests live in `flow-messages-ui.suite.tsx` (it already drives the stream
  fallbacks); four existing cases asserted the old update screen and now assert the new landing
  (the mid-build case's two update-screen assertions were replaced by the Failure-page ones).

## For the runner's stub E2E
- Stub path exists: a prompt containing `[[future:update]]` makes the stub pipeline emit
  `stub-future-update` at `PROTOCOL_LEVEL + 1` with `compat.fallback:'update'` and a notice
  (`server/src/stub-markers.ts`). BEFORE: the update screen. AFTER: the Making sheet shows
  "Finishing this needs the latest Whim." with Update Whim / Not now; Home tile "Needs update".
- "Whim caught up" leg: raise `PROTOCOL_LEVEL` in a local debug build (`wire-headers.ts`); the tile
  then reads "Didn't work" and its menu has Try again.

## Fix pass (review MEDIUM + LOW)
- `settleServerEnding`: the Failure-page landing now goes through `holdDraftOf(prev)` (new, beside
  `keepDraft`): aborts the replaced page's in-flight compose/plan requests (`leaveFlowStep`) and, for
  Describe/Plan with text, sets `heldPromptRef` exactly as the old `updateScreenFrom` route held it
  (`Not now` -> Home -> next compose on the same app gets it back). Idempotent, so safe in the updater.
  Not `keepDraft`: that calls `setComposerDraft` and an updater must not set state.
- Null target: a persisted record that `pending.get` cannot read now lands on `genericAttemptFailure`
  ('update fallback record was not readable'), so an attached Making page is always replaced.
  No test: the read cannot be forced to miss through the rendered launcher without a seam.
- Test (`flow-messages-ui.suite.tsx`): detached run, Describe typed, update frame -> Failure page
  replaces Describe -> Not now -> Create shows the typed text. Red-check: the `heldPromptRef` assignment in `holdDraftOf` removed:
  that test alone fails (19684 passed, 1 failed) on the lost prompt; restored.
