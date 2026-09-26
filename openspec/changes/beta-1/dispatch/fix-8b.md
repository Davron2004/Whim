# fix-8b: the upgrade-check seed works on Android end to end (10.5)

The Android run of `scripts/release/upgrade-check.sh` (382511 → 386398, AVD Whim_Upgrade, emulator port 5580,
old server on :8790) failed at the seed: after `Input text ${SERVER_URL}` (it typed `http://127.0.0.1:8790`
correctly) and `Tap on "Back"` (COMPLETED), `Assert that "YOUR APPS" is visible` FAILED: the app was still
on 382511's Settings screen with the keyboard gone. On 382511 the first tap outside the field only dismisses the
keyboard, so the back control never fired. Evidence (moved out of the repo):
`/private/tmp/claude-501/-Users-davrondjabborov-Work-other-Whim/ce81f3ce-38b7-4b66-989b-32e7d934775f/scratchpad/upgrade-android-failed-run-1/`
(`raw/maestro/seed.log` and the ❌ screenshot).

1. Make the seed (and any read flow with the same pattern) dismiss the keyboard before navigating on both
   platforms. Tap a non-interactive label ("SERVER ADDRESS"), or retry the back tap until "YOUR APPS" shows,
   bounded. Don't use `hideKeyboard` (it presses Back, which navigates on Android). Keep fix-8's iOS path passing.
2. Run the Android check end to end: `scripts/release/upgrade-check.sh --platform android --avd Whim_Upgrade
   --from ~/.cache/whim-upgrade/from.apk --to /Users/davrondjabborov/Work/other/Whim/android/app/build/outputs/apk/offline/app-offline.apk
   --evidence <scratch dir> --port 8790 --emulator-port 5580` from your worktree (the old server is running on
   :8790; don't start or stop it). Iterate until PASS, or until a REAL upgrade defect shows (then stop and report
   it as a finding). Copy `before.json`, `after.json` and `result.txt` of the passing run to
   `openspec/changes/beta-1/upgrade-check/android/` in your worktree and commit them.
3. Devices: only the AVD `Whim_Upgrade` on port 5580, which the script boots headless and wipes. NEVER touch
   `emulator-5554` (another app's) or `emulator-5560` (another agent's). Kill your emulator when done
   (`adb -s emulator-5580 emu kill`).
Scope: `scripts/release/upgrade-check/*.yaml`, `scripts/release/upgrade-check.sh` if needed,
`checks/test/release/*`, evidence. Self-gate with `./scripts/gate.sh`.
