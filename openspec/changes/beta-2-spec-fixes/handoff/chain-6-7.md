# chain-6 + chain-7 handoff (android-release-bootstrap, android-release-script)

Commits (branch chain/beta-2-spec-fixes-6-7, BASE f42268b0):
- 4ddb63f7 chain 6: package.json line 11 only -> `"android:release": "node scripts/android-release.mjs"` (ruling 20a).
- chain 7 commit (next on the branch): the script, lib, check, suite, docs.

## What changed (chain 7)
- `scripts/android-release.mjs`: delegates to release CLI command `android-release` (same shape as symbolicate.mjs).
- `scripts/release/lib/android-dev-script.ts`: `attachedSerials`, pure `resolveAndroidRelease(args, env, adbOutput)`
  (flag wins over `ANDROID_SERIAL`; refusal exit 2 naming both; serial must be in `device` state),
  `runAndroidRelease(args, env, deps)`, `realAndroidReleaseDeps`, `checkDevScripts(repoRoot)`.
- `scripts/release/cli.ts`: `android-release` command; `check` now includes `checkDevScripts`.
- Docs: CLAUDE.md sentence replaced in place, README.md:149, demo/README.md:22, docs/release/mobile.md troubleshooting.

## Tests
`checks/test/release/android-dev-script.suite.ts` (wired in index.ts): resolver cases, refusal builds nothing,
live deps through a fake `adb` + fake `react-native` in a temp dir (ANDROID_SERIAL reaches the build),
checkDevScripts on real package.json and on temp fixtures. `npm run checks:test`: PASS 439 / FAIL 0.
eslint --max-warnings 0 on touched files: 0. `tsc --noEmit -p .`: 0. gate.sh NOT run (per brief).
Red-check: fixture package.json with `android:release` = bare `react-native run-android --mode offline ...`
yields 2 findings (test "bare run-android is a finding"); the real package.json yields 0.
Not red-checked by mutating the real package.json (brief said use a copy).

## Deviation (A)
Spec 7.2 says "any script that runs react-native run-android outside the wrapper". The existing `android`
script (`react-native run-android`, Metro dev loop, line 10) would then fail, and package.json may not change.
The check flags `android:release` not running the wrapper, and any OTHER script running run-android with
`offline` outside it. The bare `android` script is left alone. Say so if you want it stricter (needs a
package.json edit: class B).

## Runner commands (never the phone, 5554, or UI2_*)
- Install: `cd <worktree> && npm run android:release -- --device emulator-5560`
  (or `ANDROID_SERIAL=emulator-5560 npm run android:release`). Needs JDK 21, node 22.
- Multi-device proof: with a second headless emulator on another port, compare
  `adb -s <other> shell pm list packages | grep whim` before and after.
- No-device refusal (builds nothing): `env -u ANDROID_SERIAL npm run android:release; echo $?` -> exit 2,
  message names `--device` and `ANDROID_SERIAL` (verified here, exit 2). Unlisted serial:
  `npm run android:release -- --device emulator-9999` -> exit 2.
