## 1. Age check and legal flow (app)

- [ ] 1.1 Bound `runAgeCheck` with a 3 s deadline that resolves `unavailable` through the existing reduction (design D1). Test in `age-check.suite.ts` with a `read` that never settles and a fake clock: the check ends `unavailable` and `nextLegalStep` lands on the terms step. Red-check against the unbounded version.
- [ ] 1.2 Add `acknowledgeSignificantUpdate(description)` to the `WhimAgeSignal` native module: Swift on iOS 26.2+ via `AgeRangeService.showSignificantUpdateAcknowledgment`, the `.mm` binding and the TS spec. It resolves `acknowledged | declined | unavailable`. Older iOS and Android resolve `unavailable` (D2).
- [ ] 1.3 Request the acknowledgment in the age-check phase only for `minor-approved` with an older accepted terms version, bounded by the D1 deadline. `declined` keeps AI features off, `unavailable` proceeds. Store only the outcome keyed by terms version. Tests for every `store-age-signals` scenario.
- [ ] 1.4 Route Settings "Turn on AI features" through `nextLegalStep` from its first step (D6). Tests: outdated terms → terms then one consent; current terms → one consent; no pass shows a legal screen twice.
- [ ] 1.5 Reword `openspec/changes/developer-observability/tasks.md` 8.2(a): an up-to-date consent grant is not re-asked, and a grant older than `AI_CONSENT_VERSION` is.

## 2. Keyboard in the host shell (app)

- [ ] 2.1 Build the shared keyboard-safe screen wrapper from React Native built-ins (D3): an inset-adjusting ScrollView, platform dismiss modes, a footer slot for the primary action above the keyboard, tap-empty-space to dismiss, and an iOS `InputAccessoryView` "Done" for multiline fields. Put any pure logic in a non-RN sibling so a Node suite can test it.
- [ ] 2.2 Compose: adopt the wrapper, pin Continue in the footer, remove `autoFocus`, add Done on the description field.
- [ ] 2.3 Adopt the wrapper on every other screen and sheet with a TextInput (plan editing, "Change it", report sheet, settings/server fields). List each one in the chain report. `SheetModal`'s existing `KeyboardAvoidingView` is kept or folded into the wrapper, not doubled.

## 3. Realm and host runtime (app runtime + SDK)

- [ ] 3.1 In `src/runtime/web/loader.js`, scroll a focused editable element into view on focus and on viewport resize while it has focus (D3). The runtime does this, not generated code.
- [ ] 3.2 Mount the mini-app inside a runtime-owned error boundary that posts a nonce-authenticated error frame with `where:'render'` on catch. Add `render` to the host's `isFatalErrorWhere` (D4). Tests in `mini-app-host-ui.suite.tsx`: a trusted `render` frame shows FailureScreen, an untrusted one is ignored.
- [ ] 3.3 Extend the theme payload with `chromeInsetBottom` (sanitized, clamped 0–200). The host computes it from the orb size, margin and bottom safe-area inset, and sends it on every mount (D5).
- [ ] 3.4 SDK `Screen` adds `chromeInsetBottom` to its scrollable content's bottom padding; generated code can't read the value. `sdk:test` covers both with-inset and no-inset.
- [ ] 3.5 `npm run build`, then `npm run invariants` and `npm run bridge:invariants` green against the new build.

## 4. Diagnostics and polish (app)

- [ ] 4.1 `crash-capture.ts#thrownFields` reduces each frame location to file name + line:column on every platform (D7). Test with an iOS-shaped stack (with the `Bundle/Application/<UUID>` path). Check that a trimmed stack still symbolicates to the same source lines.
- [ ] 4.2 Orb: the menu scrim covers the status bar on both platforms, and the Android grey disc is gone (D14; see the `rn-style-platform-gaps` memory on shadow/elevation).
- [ ] 4.3 Re-check #48 on the current build. Fix the watermark only if it still clips or truncates. Give the built-in examples distinct declared tile colours without touching `appColor`, and add a test that example colours are pairwise distinct.
- [ ] 4.4 `copy.ts` counts use `toLocaleString('en-CA')`. `run-signals.suite.ts` passes under `LANG=fr_CA.UTF-8`.

## 5. Server admission and routing config (server)

- [ ] 5.1 `SlotController`: an async acquire for `generate` with a FIFO waiter list bounded by `WHIM_ADMISSION_WAIT_MS` and `WHIM_ADMISSION_MAX_WAITERS`. `release()` stays idempotent and hands the slot to the head waiter. A waiter leaves on abort or drain. Overflow and expiry → `server_busy`. Check order unchanged (D8). Tests for every `server-admission-control` scenario, bounded by timeouts (see the `whim-node-suite-bare-await-hang` memory).
- [ ] 5.2 Config: parse both new keys with defaults (10000; 2× the generation cap) and refuse a wait ≥ 14000 at boot. Add the rows to `docs/deploy.md`.
- [ ] 5.3 `WHIM_PROVIDER_QUANTIZATIONS` → `provider.quantizations` in `requestBody`, through the config/roster seam. Unset leaves the provider object byte-identical (test). Add the row to `docs/deploy.md` (D12).

## 6. Generation quality (server)

- [ ] 6.1 One list of mini-app limits interpolated into `CLARIFY_SYSTEM` and `REWRITE_SYSTEM`, with the instructions not to offer them and to substitute the nearest buildable version, stated in the plan (D9). A prompts-suite test pins both prompts to the list and fails when the capability registry gains a capability the list names as missing.
- [ ] 6.2 Retry a generate/repair turn once on an upstream failure before its first token event (D10). Tests: a failure before the first token retries and can deliver; a failure after tokens stays terminal; usage of the failed attempt is metered.
- [ ] 6.3 `stages/run.ts` passes a content-free `{kind, check}` verdict summary. The machine logs it at info with `requestId` on `containment_failed`/`run_unverified` (D11). A test asserts the log line's fields and that no source/DOM/console text appears.
- [ ] 6.4 Reproduce #106 (a "Change it" whose summary says no changes while the saved source changed) and locate the path. Enforce: a no-change claim only when the delivered source is byte-identical to the starting source, with a neutral line otherwise (D13). Test with a generated-output-shaped fixture.

## 7. Release upgrade check (tooling)

- [ ] 7.1 Maestro seed flow: on the previous release, open an example with saved data (write a value) and a generated app with two versions. Record what was seeded in a machine-readable file.
- [ ] 7.2 `scripts/release/upgrade-check.sh --platform android|ios --from <old> --to <new>`: fresh emulator/simulator, install old, seed, install new over it (`adb install -r` / `simctl install`), assert tiles, versions, data, consent state and device id with a Maestro flow. Exit non-zero on any difference.
- [ ] 7.3 `docs/release/mobile.md`: the upgrade check is a required step before any beta build ships; where the evidence goes.

## 8. Acceptance and rollout (orchestrator, attended)

- [ ] 8.1 `gate-full.sh` green on the staging tip, then the reviewer pass.
- [ ] 8.2 Load-test `e2-standard-2` with the replay image (`deploy/loadtest/run.sh drive`). Set the highest caps with p95 CPU < 70 % and no failed runs in `deploy/profiles/standard.env`, and record the run in `docs/deploy.md`.
- [ ] 8.3 Flowbench before and after 6.1 on the visible set plus a weather-app case. Record the results in `progress.md`.
- [ ] 8.4 After merge: server deploy from `../Whim-deploy`, smoke, one real generation, a concurrency check (cap + 2 simultaneous generations: the extras wait, then run or get refused as specified). Legacy client check with 381237/382511. Roll back on failure.
- [ ] 8.5 iOS and Android release builds → a newly created simulator and a fresh emulator: every tier-0 scenario (age check, keyboard on every input screen, inside a mini-app, render failure, orb inset, Settings legal flow, trimmed stacks).
- [ ] 8.6 Run the upgrade check from 382511 to the candidate on both platforms; record the evidence.
- [ ] 8.7 Owner: demo-phone check of the same build (real-device age signals, keyboard, a generation).
- [ ] 8.8 Add the build to TestFlight `Public beta` and the Play closed track; close the issues this change fixes, with evidence.
