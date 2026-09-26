# Section 10 plan (orchestrator, attended)

Order follows progress.md R6 (deploy before the load test) and R10 (reproduce chain-6's device risks first).

## Devices (owner rule: a newly created simulator and a fresh emulator)
- iOS: `xcrun simctl create "Whim-beta1-<hhmm>" "iPhone 17" com.apple.CoreSimulator.SimRuntime.iOS-27-0`.
  Leave the 4 already-booted simulators (other sessions) alone.
- Android: `Whim_Verify` booted with `-wipe-data -no-snapshot -gpu swiftshader_indirect -no-window`. Leave
  emulator-5554 (Pixel_10_Pro_XL, someone's data) alone.

## Pointing a build at a local server
- Android: the offline APK (`WHIM_INTERNAL_BUILD=true`) + `adb reverse tcp:8787 tcp:8787` + Settings → Advanced
  server address `http://localhost:8787`.
- iOS: only DEBUG builds are internal (`WhimAppInfoModule.mm:28-32`), so use a Debug simulator build with the
  bundle embedded (`FORCE_BUNDLING=1`, no Metro) + Settings → Advanced `http://127.0.0.1:8787`.
- Local server at the staging tip, stub pipeline (`WHIM_PIPELINE=stub`, check that no key is loaded), and
  `WHIM_MAX_CONCURRENT_GENERATIONS=1` (or the equivalent key) so "cap + 2" is three builds.

## 10.4 scenarios (both platforms)
1. R10 first: `acceptance/keyboard-checklist.md` "Known risks".
2. Tier 0: the age check ends in ≤ 3 s on the simulator (the Declared Age Range read hangs there), then terms,
   consent, compose (no autofocus), clarify (one/many/Other/Decide for me), plan, build, the app runs, the orb
   inset (last element above the orb), the orb scrim over the status bar, no Android disc, tile colours distinct,
   Settings → "Turn on AI features" shows each legal screen once, and a render error after paint (a stub-built
   app that throws in `useEffect`, if one can be made; else rely on deliver-verify) shows the failure screen.
3. The line: three builds at cap 1 → the second and third show "in line", then run.
4. `[[limit]]` prompt → the limit screen; "Build … instead" re-clarifies; "Change my idea" returns to Compose.
5. `[[future:skip]]` build completes; `[[future:fail]]` → failure screen with the notice;
   `[[future:update]]` → update screen with the notice; nothing installed.
6. Evidence: screenshots in `openspec/changes/beta-1/acceptance/<platform>/`, one ledger line per scenario.

## 10.5 upgrade check
The command sequence is in `docs/release/mobile.md` → "Upgrade check" (382511 = `release/1.0.0+382511` =
`a9b03c47`). The old server needs `WHIM_PIPELINE=stub` + the primary `.env`.

## 10.6 deploy (R6: the staging tip, before merge)
From `../Whim-deploy` checked out at the staging tip: `deploy/deploy.sh`, smoke, one real generation
(flowbench `tip-splitter-p1`), the line check (cap + 2 concurrent flowbench cases), and 381237/382511 get 426
(a request without `x-whim-protocol`). Roll back by `--tag` on failure. Then flowbench AFTER (10.3, same cases
as before), then the load test (10.2) → the caps into the `config.ts` defaults (R8) → commit → closure PR.
Lower `WHIM_BETA_LIMIT_PER_CLIENT_HOUR` back to its default in the same deploy.

## 10.7 / 10.8 after merge
Redeploy from `main`. `fastlane ios testflight` → `fastlane android closed build:<n>`. Add the build to the
`Public beta` group, and check tester invitations with the ASC API (memory testflight-not-invited-api-fix);
don't invite anyone. Then `WHIM_MIN_BUILD_IOS/_ANDROID` = beta-1's build, redeploy, check `/healthz`. The owner
does the demo-phone check.
