# chain-2 device-stream-liveness — handoff

## What changed
- `prompt-flow.ts`: `RunSignals.lastFrameAt` is now `lastProgressAt`, the time of the last
  `GenerationEvent` (every event counts, the keepalive does not). `withKeepalive` is deleted.
  `STALL_MS` doc records ruling 5 (keepalives are liveness, not progress). `livenessOf` keeps its
  four states, only the clock under `connected`/`stalled` changed.
- `build-lifecycle.ts` (`journalStreamEvent`), `home-live.ts`, `LauncherRoot.tsx`: renamed to the
  new clock. `recordAttemptKeepalive` and the `onKeepalive` callback are removed.
- `transport-shared.ts` / `generation-client.ts`: `ClientOptions.onKeepalive` is removed (nothing
  read it after the shell stopped). The parser still recognises the keepalive block (`kind:
  'keepalive'`) and yields nothing for it. Neither transport changed: both already disarm the
  connect window on the first chunk, keepalive included.
- Copy (ruling 15): `makingStallLine` is now **"No progress for 40 s. Still waiting."** (was "No
  word from the server for 40 s. Still waiting."). There are no locale catalogues.
- `docs/design/system.md`: §3.3 Stuck row, §4.6 (with the ruling), §8 row now say "no progress
  event for 40 s" and use the new copy.
- Spec delta `specs/prompt-flow/spec.md`: its example `"Nothing has arrived for Ns"` (which claims
  silence) now reads `"No progress for 40 s"` and says the line must not claim the connection
  is silent. `openspec validate --strict` passes on the repo's openspec and on 1.14.1.
- Doc-comment-only edits: `HomeScreen.tsx:69`, `src/host/ui/AppTile.tsx:128` ("no bytes" changed to "no progress event").

## Tests
- `prompt-flow-ui.suite.tsx` (new, the device path through the real `LauncherRoot`): opening
  keepalive, a `stage`, then keepalives at 15/30/41 s, and the Making page shows the stall line with the
  ember stuck. A keepalive at 50 s, then a redraw, and it still shows. A `stage` clears it. On Home,
  keepalives with no event for 41 s make the tile go `stuck`, and the next event clears it. The old
  pulse test no longer waits for a keepalive to move the clock.
- `run-signals.suite.ts` (replaces the `withKeepalive` test): SSE bytes go through `generateApp`
  and `journalStreamEvent`. 41 s of keepalives reads `stalled`, a keepalive does not clear it, a
  `stage` does.
- `build-lifecycle.suite.ts` honest-light test: the keepalive step is now a `usage` event (any
  event is progress).
- `generation-client.suite.ts` (fetch) and `xhr-transport.suite.ts` (fake XHR), using the
  production `CONNECT_TIMEOUT_MS` and the new held clock `holdTimers()` in `fake-xhr.ts` (no real
  sleeps): a first-chunk keepalive disarms the window, a 20 s first step and a 35 s step with
  keepalives fire nothing, and the next events arrive. With no byte in the window, the timeout fires
  at exactly 15 s as a `network` failure with `CONNECT_TIMEOUT_HINT`. The hang guards in both
  suites now use `realSetTimeout`.
- The onKeepalive assertions became "keepalives are skipped, a keepalive-only body yields []". The
  per-file assertion count did not drop.

## Suite results (final tree)
- `launcher:test`: 19670 passed, 1 failed. The failure is the known load flake #232 (whim sheet,
  "past a hundred versions", which this chain does not touch). It passes alone (59/0), and also
  after the generation-client and xhr suites that run before it (284/0).
- tsc: exit 0. eslint on every touched file: exit 0. knip: exit 0, nothing reported. openspec validate --strict
  (repo openspec and 1.14.1): valid.

## Red-check evidence
- (a) The base `f42268b0` production files (prompt-flow, LauncherRoot, build-lifecycle, home-live,
  transport-shared, generation-client) with the new tests: the new prompt-flow-ui test goes red
  ("timed out waiting for the stall line after 41 s of keepalives and no event"), with 171 passed
  and 1 failed. With the files restored, 177 passed and 0 failed.
- (b) The transport red-check was not run: it belongs to the runner (READY.md).

## Deviations (class A)
- Edited beyond the listed files: the rename reached `run-timeline`, `shell-status-ui`,
  `grid-composition` and `prompt-flow-ui` suites, plus doc-only lines in HomeScreen.tsx and AppTile.tsx.
- Not touched: `docs/design/mockups/index.html` still shows the old stall copy (3 places), and the
  `home-grid-ui.suite.tsx:396` test title still says "no bytes". Both are cosmetic and listed for the orchestrator.

## Runner device E2E: what to look for
- `WHIM_STUB_DELAY_MS=20000` and `35000`: the make completes with no "lost the connection".
- `WHIM_STUB_DELAY_MS=60000`: at about 40 s after the last event the Making page reads "No progress
  for 40 s. Still waiting." with the ember dimmed and still, and the Home tile's light goes stuck.
  Both clear at the first event. Keepalives keep arriving the whole time (`curl -N` shows them).

## Fix pass (review-2-1-27 chain-2)
- MEDIUM: `making-progress.ts` stall line is now `makingStallLine(floor((now - lastProgressAt) / 1000))`,
  counting up on the shell's existing 1 s Making tick (`LauncherRoot` `RUN_SIGNAL_TICK_MS`, mounted
  only while the screen is `making`); no new timer. `copy.ts` doc and `system.md` §8 row say N counts up.
- `prompt-flow-ui.suite.tsx`: the keepalive test now holds `Date.now` (moved only by the test; its
  waits use a real-clock deadline, `waitHeld`): no stall at 30 s, "No progress for 41 s" at 41 s,
  "50 s" after a keepalive at 50 s, "90 s" (and not "41 s") at 90 s, a `stage` clears it. Fixed-40
  expectations in `build-lifecycle.suite.ts` (now 41 s / 60 s, hand-computed from the folded times)
  and `flow-screens-ui.suite.tsx` (41 s) were updated.
- LOWs: `run-signals.suite.ts` real-stream test renamed to what it checks (the parser yields
  nothing for a keepalive, so nothing moves the progress clock); stale "any-frame clock"/"liveness"/
  "onKeepalive" wording in `generation-client`, `run-signals`, `build-lifecycle` suites reworded to
  progress; `holdTimers()` doc lists its limits (file not moved); `home-grid-ui.suite.tsx` title
  "no bytes" → "no progress event"; `docs/design/mockups/index.html` stall copy (3 places) → new copy.
- Suites: `launcher:test` 19674 passed, 0 failed. tsc exit 0; eslint on touched files exit 0.
- Red-check (line reverted to a constant 40, run once, source restored): 19663 passed, 4 failed:
  build-lifecycle 41 s and 60 s lines, flow-screens 41 s line, and the prompt-flow-ui test, which
  throws at its first count-up step ("timed out waiting for the stall line to read 41 s"), so it goes
  red before it reaches the 90 s assertion. A line frozen at its first value was not red-checked.
