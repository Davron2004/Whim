# Findings: launcher-polish-fixes

- source: the iOS launcher follow-ups in `openspec/changes/platform-release-readiness/design.md` "Follow-ups (not in this change)" (lines 286-293), the carry-forwards in `docs/handoff-2026-09-14.md` (line 64) and `openspec/changes/platform-release-readiness/progress.md` (chain-2 line), and the orchestrator's brief for this batch (2026-09-15). F8 and F9 were found by the planner while reconciling F3; the NUL bytes folded into F7 were found while reconciling F7.
- reconciled against: `integration/store-launch` at `117a88f` (store-launch-compliance chain-6 merged; chain-7 still running). Every `file:line` below is at that commit.

Batch-wide ordering, which the fix loop can't infer:
- Every finding that touches `src/host/launcher/**` (F1, F3, F4, F5, F7, F9) waits until `store-launch-compliance` chain-7 has merged. F6 and F8 touch nothing under the launcher and are eligible now.
- F9 edits one line of `src/host/launcher/LauncherRoot.tsx`, which `ios-launcher-back-navigation` chains 2 and 3 also edit (other hunks). Don't merge F9 in the same regate window as either chain.
- No two findings share a file.

## F1: the ⚙ settings glyph renders as a colour emoji on iOS

- severity: med
- files: `src/host/launcher/HomeScreen.tsx:160`, `src/host/launcher/test/theme.suite.ts`
- symptom: the home screen's settings button renders `{'⚙'}` (U+2699) with no variation selector. U+2699 is `Emoji=Yes` and `Extended_Pictographic=Yes` (checked with Node 22's ICU, Unicode 17), and iOS draws it from Apple Color Emoji. The codebase's other glyphs don't have the problem, and not because they carry a selector: none of them uses U+FE0E. `⌂` U+2302, `⚑` U+2691, `✎` U+270E and `↺` U+21BA (`orb-actions.ts:61-64`), `✓` U+2713 (`BuildStep.tsx:135`, `FailureScreen.tsx:113`) and `＋` U+FF0B (`HomeScreen.tsx:212`) have no emoji form at all. A scan of every non-test source under `src/host/` finds U+2699 as the only emoji-capable character rendered as text; the other hits are in comments.
- reproduction: open Whim on an iPhone (or the iOS simulator) and look at the top-right of the home grid: a colour gear, not the ink glyph the design uses. Failing check: a scan of non-comment launcher source for `\p{Extended_Pictographic}` not followed by U+FE0E is red at HEAD on `HomeScreen.tsx:160`.
- fix scope: append U+FE0E (`'⚙\uFE0E'`), which asks for text presentation on both platforms. No new glyph, no font change. Confirm monochrome on the iPhone in the attended walk (`ios-launcher-back-navigation` task 4.1).
- red-check: revert only `HomeScreen.tsx` to BASE; the new invariant case in `theme.suite.ts` turns red naming `HomeScreen.tsx`.

## F2: a Hermes polyfill sets `process.platform = 'android'` on every platform

- severity: low
- files: `src/host/platform/hermes-polyfills.ts`, `src/host/platform/install-entry-polyfills.ts`, `index.js`
- symptom (as reported): `polyfills.ts` hard-coded `process.platform` to `'android'`.
- status: **ALREADY FIXED** by `platform-release-readiness` chain-2. `installHermesPolyfills(target, platform?)` writes the platform only when one is passed and none exists (`hermes-polyfills.ts:43,59`), and its load-time call passes none (`:63`). `install-entry-polyfills.ts:12-14` passes the real `Platform.OS`, and `index.js:5` imports it first. `checks/test/release/hermes-entry.suite.ts:121-138` covers iOS, the no-platform call, and never overwriting. No `'android'` default remains under `src/` or in `index.js`. Record `skipped` at run start; don't dispatch.

## F3: the dev probe screen's fixture buttons deliver nothing

- severity: low
- files: `src/host/launcher/DevProbeScreen.tsx:20-24,61`, `src/host/launcher/useMiniAppHost.ts:157,244-248,387`, `src/host/launcher/test/dev-probe-back-button.suite.ts`, `src/host/launcher/test/bundle-error-watchdog.suite.ts:178`
- symptom: each button calls `host.deliverByRecord(recordFor(name), name)`, which injects `window.__whimControl.reinject({ bundle: name, … })` with no source. The page resolves the name from its baked bundle map, and `build/build.mjs:301` bakes `bundles: {}` into `RUNTIME_HTML` on purpose (the product delivers by source; comment at `:288-297`). `build/assemble.mjs:130` then logs `deliver: unknown bundle <name>` and returns, so no app paints and the screen shows no error. The sources still exist: `src/runtime/generated/app-bundles.ts` (`APP_BUNDLES`, written by `build/build.mjs:341-346`) has every fixture the buttons name.
- reproduction: in a build where the probe is reachable (`__DEV__`, or the dev flag once F9 lands), long-press the home title and tap `tip-splitter`. The realm stays blank and logcat shows `deliver: unknown bundle tip-splitter`. Failing check: a Node case asserting that every dev-probe fixture name resolves to a record and to a source `bundleDefinesApp` accepts fails, because today the screen resolves no source at all.
- fix scope: entirely outside `build/` (Class 2). Move the name list and record lookup into a new React Native-free `src/host/launcher/dev-probe-fixtures.ts` that also returns `APP_BUNDLES[name]`; have the buttons call `host.deliverBySource(record, source)`; delete `deliverByRecord`, which then has no caller; re-pin the watchdog suite's slice boundary.
- red-check: new-module caveat (runbook step 3). The discriminating weaker variant is a `devProbeFixture` that looks the source up in the baked page map instead of `APP_BUNDLES` and gets nothing back; the new case must fail against it. The reviewer checks that by inspection.

## F4: screen readers announce each home tile's initials twice

- severity: med
- files: `src/host/launcher/app-tile.tsx:146-147`
- symptom: the tile renders its monogram twice, as a large ghost `Text` and a small foreground `Text`, both carrying `{mono}` and neither hidden from accessibility. The touchable around it (`HomeScreen.tsx:187-193` for installed tiles, `:296-303` for ghosts) sets no label, so the platform composes one from every child's text: the initials twice, then the name. On iOS, React Native builds that label in `RCTRecursiveAccessibilityLabel`, which skips only subviews with `accessibilityElementsHidden` (`node_modules/react-native/React/Fabric/Mounting/ComponentViews/View/RCTViewComponentView.mm:1376-1400`).
- reproduction: iOS simulator with Accessibility Inspector (or VoiceOver on the iPhone) on the home grid; focus a tile and the label repeats the initials before the name. Android emulator with TalkBack does the same. No Node check can see this: `app-tile.tsx` imports React Native and the label is composed natively.
- fix scope: mark both monogram `Text` nodes decorative with `accessibilityElementsHidden` and `importantForAccessibility="no"`. The name and the pill stay in the label, and no touchable changes. One file.
- red-check: device-only. In the attended walk, VoiceOver reads a tile as its name once (`ios-launcher-back-navigation` task 4.1), and TalkBack on the emulator does the same. The reviewer confirms by inspection that only those two nodes changed.

## F5: nothing tests that `ConnectivityLoop.stop()` clears its pending retry

- severity: low
- files: `src/host/launcher/connectivity.ts:116-119`, `src/host/launcher/test/connectivity.suite.ts`
- symptom: `stop()` sets `stopped` and calls `clearPendingTimer()`, which is correct today, but no case in `connectivity.suite.ts` calls `stop()` (`grep -c '\.stop(' src/host/launcher/test/connectivity.suite.ts` prints 0). Deleting the clear would leave a retry timer alive after unmount. That timer would call `probe()` once more before the `stopped` guard in `runProbe` (`:90-92`) returns, and the suite would stay green.
- reproduction: delete `this.clearPendingTimer();` from `stop()` and run `npm run launcher:test`; everything passes.
- fix scope: test only. One case using the suite's `FakeTimers`: an unreachable probe, `start()`, await `whenIdle()`, one retry pending; `stop()`; then no retry pending, `probe` called exactly once, and nothing published after `stop()`.
- red-check: `fixloop.sh redcheck` can't show this, because BASE already has the clear. Mutate instead: in the worktree, delete the clear from `stop()`, run `npm run launcher:test`, see the new case fail on the pending count, and restore. The orchestrator repeats the mutation before VERIFY.

## F6: a stale "see ./polyfills" comment in `env.d.ts`

- severity: low
- files: `src/host/version-store/env.d.ts:4`
- symptom: the header points at `./polyfills`, which moved to `src/host/platform/hermes-polyfills.ts` in `platform-release-readiness` chain-2. No file exists at the old path.
- reproduction: `ls src/host/version-store/polyfills.ts` fails.
- fix scope: change the reference to `../platform/hermes-polyfills`. One line.
- red-check: none; comment only.

## F7: `contract-mirror.ts` outlived the contract it stood in for

- severity: low
- files: `src/host/launcher/contract-mirror.ts`; importers `service-refusal.ts:10`, `refusal-landing.ts:9`, `report-payload.ts:10`, `ReportSheet.tsx:21`, `generation-client.ts:39`; suites `test/service-refusal.suite.ts:15`, `test/refusal-landing.suite.ts:17`, `test/report-payload.suite.ts:20`
- symptom: the module mirrors `ServiceRefusalCode`, `ReportReason`, `ReportRequest` and `ReportResponse` until `public-generation-server` chain-1 lands them in `@whim/contract`, and its header says to delete it then (`:11-14`). They have landed with identical shapes (`contract/src/index.ts`: `ReportReason` `:193`, `ReportRequest` `:200-206`, `ReportResponse` `:210`, `ServiceRefusalCode` `:306-314`), and compliance chain-6 merged without removing the mirror. As a result `service-refusal.suite.ts:29`, "keys equal the real ServiceRefusalCode vocabulary", compares against the mirror rather than the contract, so a contract change would slip past it.
- also in scope, same file: `test/report-payload.suite.ts:131-133` holds three literal NUL bytes (`'<NUL>never'`), so git and grep treat the suite as a binary file. Its diffs can't be reviewed, and two branches editing it can't merge textually. It's folded in here because F7 has to edit that file anyway. (`DEVLOG.md` also contains a NUL byte; not batched.)
- reproduction: `/usr/bin/grep -rn contract-mirror src` lists the five importers and prints `Binary file src/host/launcher/test/report-payload.suite.ts matches` for the sixth.
- fix scope: repoint the five production imports to `import type { … } from '@whim/contract'` (type-only stays mandatory so zod never reaches Metro) and fix the three header comments that name the mirror; point the three suites at `@whim/contract`'s zod values; replace the three NULs with the `\u0000` escape; delete `contract-mirror.ts`.
- red-check: none (structural). Typecheck, `npm run launcher:test` and `gate-full.sh`'s `guard:metro` are the assurance. After the fix, `git diff --stat` shows the suite as text, not `Bin`.

## F8: probe screens hard-code `paddingTop: 48` instead of the safe area

- severity: low
- files: `src/host/BridgeProbeScreen.tsx:34,61`, `src/host/VersionStoreProbeScreen.tsx:48,75`, `src/host/NetworkDenyProbeScreen.tsx:221,254`, `src/host/StorageProbeScreen.tsx:38,65`
- symptom: all four on-device harnesses use a root `View` with `paddingTop: 48`. On an iPhone with a Dynamic Island the top inset is larger than that, so the probe header sits under the island, on exactly the screens the attended device chains read verdicts from (`platform-release-readiness` task 13.2 runs the storage and bridge probes on the iPhone, and 13.7 and 18.5 run the network-deny probe on the iOS simulator). The launcher itself insets through `react-native-safe-area-context` (`LauncherRoot.tsx:1752`), and `App.tsx:40` wraps every probe in `SafeAreaProvider`.
- reproduction: set `RUN_STORAGE_PROBE = true` locally and run on the iPhone; the first row of the probe output is clipped by the Dynamic Island.
- fix scope: make each root a `SafeAreaView` from `react-native-safe-area-context` with its default edges and drop `paddingTop: 48`. Background and horizontal padding stay. Four files, one edit shape. Nothing under `src/host/launcher/`, so eligible now.
- red-check: device-only, in the next attended iPhone probe run.

## F9: the dev probe entry is gated on `__DEV__` alone

- severity: low
- files: `src/host/launcher/LauncherRoot.tsx:1719`, `src/host/launcher/test/observability-ui.suite.ts`
- symptom: `onOpenDevProbe={__DEV__ ? () => setScreen({ kind: 'dev' }) : undefined}`. `app-launcher` §"Production builds hide developer diagnostics surfaces" requires every developer diagnostics surface to be gated on `__DEV__` or an explicit build-time flag, because this project runs release builds where `__DEV__` is false, and decision #60(c) calls a `__DEV__`-only gate a defect. The dev log overlay (`LauncherRoot.tsx:370`, `DevLogOverlay.tsx:56`) and the run timeline (`:601`) already go through gate functions; this is the one bare use left. It's also why F3 went unnoticed: the probe can't be reached in the build anyone runs.
- reproduction: flip `SHOW_DEV_LOG_OVERLAY` to `true` in `dev-log-view.ts` locally and run `npm run android:release`. The `Logs` button appears, but long-pressing the home title does nothing. Failing check: a scan of non-comment launcher source for `__DEV__` used anywhere other than as the sole argument of a call (`gate(__DEV__)`) is red at HEAD on `LauncherRoot.tsx:1719`.
- fix scope: `onOpenDevProbe={devLogOverlayEnabled(__DEV__) ? … : undefined}`, the gate the spec's scenario ties the probe and the overlay to ("reachable from the same developer affordance that opens the device probe screen"). `devLogOverlayEnabled` is already imported there. Add the invariant case beside the existing overlay-gate case (`observability-ui.suite.ts:274`).
- red-check: revert only `LauncherRoot.tsx` to BASE; the new case turns red naming `LauncherRoot.tsx`.
