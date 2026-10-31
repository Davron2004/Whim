## 1. Server: the generation stream writes a frame as it opens

- [x] 1.1 `server/src/sse.ts`: in `buildSseStream`'s `start()`, when keepalives are on, enqueue the keepalive frame once before the `for await` over the pipeline (no `id:`, so event ids still start at 1). Update the file's doc comment.
- [x] 1.2 `server/test/server-core.suite.ts`: a source whose first event is held by a controllable promise (not a sleep): the first chunk read is the keepalive frame, the held event then arrives with `id: 1`; with `keepaliveMs` 0 or undefined no comment frame is written. Red-check by removing the enqueue.
- [x] 1.3 Check the other consumers of the stream's first bytes still pass: `server/src/loadtest/drive.ts` (skips `:` lines), `server/flowbench.mjs`, the e2e suite; run `npm run server:test` through the watchdog.

## 2. Device: keepalives are liveness, not progress

- [x] 2.1 `src/host/launcher/prompt-flow.ts`: `RunSignals.lastFrameAt` becomes the last progress event (rename to `lastProgressAt` across `withRestart`, `livenessOf`, the initial value, `home-live.ts`); `withKeepalive` is deleted (a keepalive no longer touches `RunSignals`). Rewrite the doc comments (the "ANY frame, INCLUDING the keepalive" text) to the new rule.
- [x] 2.2 `LauncherRoot.tsx` / `build-lifecycle.ts` / `transport-shared.ts` / `generation-client.ts`: remove `recordAttemptKeepalive` and the `onKeepalive` plumbing if nothing else reads it (knip decides); the SSE parser still recognises and skips the keepalive block.
- [x] 2.3 Tests (`run-signals.suite.ts`, `prompt-flow-screens.suite.ts` or the making-progress suite): keepalives every 15 s with no event for 41 s reads `stalled` and the Making stall line shows; a `stage` event clears it; a keepalive alone does not; the Home tile (`home-live`) goes stuck on the same input. Red-check against the old `withKeepalive`.
- [x] 2.4 Transport tests (`xhr-transport.suite.ts` with `fake-xhr.ts`, and `generation-client.suite.ts` for the fetch path): a keepalive as the first chunk disarms the connect window; a 20 s and a 35 s gap after it (fake timers or an injected `connectTimeoutMs`, never real sleeps) does not end the attempt; no byte within the window still ends it as a `network` failure.
- [x] 2.5 `docs/design/system.md` §4.6 ("Stuck after 40 s with no bytes") and §8 (the "No bytes for 40 s" row): reword to "no progress event for 40 s"; record the ruling (keepalives are liveness) beside `STALL_MS`.

## 3. Needs-update: one predicate, one landing

- [x] 3.1 `grid-composition.ts`: add `protocolLevel` to `ComposeOptions`; `attemptState` returns `needs-update` only when `stillNeedsUpdate(rec, protocolLevel)` (import it from `build-lifecycle.ts` if that module is Node-importable, else move the predicate to a pure sibling). Wire `PROTOCOL_LEVEL` where the grid is composed.
- [x] 3.2 `grid-composition.suite.ts`: a record with an `update` remedy at a level the running Whim meets gives an ordinary failed cell; one above gives `needs-update`; red on `485aecef`.
- [x] 3.3 `LauncherRoot.tsx` `settleServerEnding`: for an `update` fallback during a run open the record's Failure page (`failureFromRecord`) instead of `updateScreenFrom`; keep the update screen for the clarify, rewrite and report paths and for the `update_required` refusal. A tile tap on a `needs-update` cell opens the same page. Launcher-level test: stream `update` fallback -> Failure page with Update Whim / Not now, no update screen; clarify `update` fallback -> update screen.
- [x] 3.4 `docs/design/system.md` §3.2 "Needs update" row: tap target "Failure page" (was "Update screen").

## 4. Whim sheet See why; the Copy label

- [x] 4.1 `WhimSheet.tsx`: add a `failedChange` prop and an `onSeeWhy` handler; show a "See why" row (`COPY.toastSeeWhy`) in the first group when a change has failed and none is running.
- [x] 4.2 `LauncherRoot.tsx`: pass `runningChange.failed` and `seeWhy(failedId)` to the sheet; the sheet closes onto the Failure page exactly as the toast action does.
- [x] 4.3 `whim-sheet-ui.suite.tsx` (+ a launcher flow test): row shown after the toast has expired, absent with no failure and once a new change runs, tap opens the Failure page. Red on `485aecef`.
- [x] 4.4 Locate the "Copy" path for rewind continuations (`store-access.ts` fork vs `continueSharingData`, `app-index.ts forkedFrom`): add a `home-grid-ui.suite.tsx` test that both a Make a copy entry and a continuation show "Copy"; fix the data path only if the continuation does not set `forkedFrom`.
- [x] 4.5 `docs/design/system.md` §9 Whim sheet row: mention See why.

## 5. Synthetic run: wait for a dismissed Modal to leave

- [x] 5.1 `synthrun/test/sweep-reach.ts`: copy `FIXTURE_UNDER_MODAL` with an `onClose` that closes after `delay(2500)`; assert "Second" is pressed, zero blocked, zero failed actions. Red on `485aecef` every time (no load needed).
- [x] 5.2 `synthrun/sweep.ts`: after a backdrop dismissal, poll until the dismissed backdrop no longer receives at its click point (`firstActionable(frame, [backdrop])` is null), capped at 5000 ms, once per dismissal, no action spent, before the next enumeration. Update the `sweepOneScreen` and `pickNext` comments.
- [x] 5.3 Keep the existing "deferring a covered control does not spend the per-screen cap" test as is; it must pass unchanged.

## 6. `npm run android:release`: bootstrap (HUMAN)

- [x] 6.1 HUMAN-BOOTSTRAP: `package.json` line 11: `"android:release": "node scripts/android-release.mjs"`. Commit it on the staging branch before chain-7 is dispatched.

## 7. `npm run android:release`: the script, its check and the docs

- [x] 7.1 New `scripts/android-release.mjs`: resolve the serial from `--device <serial>` or `ANDROID_SERIAL`; refuse (exit 2, message naming both) when neither is set; refuse when `adb devices` does not list it as `device`; otherwise export `ANDROID_SERIAL` and run `react-native run-android --mode offline --active-arch-only --device <serial>`. Pure resolver function exported for the test; it lives in `scripts/release/lib/android-dev-script.ts`, behind the release CLI that `scripts/android-release.mjs` calls.
- [x] 7.2 Release check + suite (`scripts/release/lib/`, `checks/test/release/`): fails when `package.json` has any script that runs `react-native run-android` outside `scripts/android-release.mjs`, or when `android:release` does not point at it; resolver unit cases (no device, flag wins over env, unknown serial). Wire it into `scripts/release/cli.ts`'s `check`.
- [x] 7.3 Docs: `CLAUDE.md` Android section (replace the `npm run android:release` sentence in place: `npm run android:release -- --device emulator-5560`), `README.md:149`, `demo/README.md:22`, `docs/release/mobile.md` troubleshooting (the "runs react-native run-android" sentence).
