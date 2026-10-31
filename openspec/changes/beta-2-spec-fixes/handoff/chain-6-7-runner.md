# chain 6-7 runner verdict: FAIL (gate) / PASS (partial: device install unproven)
Branch chain/beta-2-spec-fixes-6-7 @ 50f76ed7, BASE f42268b0.
1. gate.sh: EXIT 137, CAPPED at 1500 s wall clock (peak RSS 1237 MB) in "Deploy scripts" under the server step.
   Steps PASS: build, typecheck, lint, version-store, storage-engine, capability-bridge.
   `^FAIL: launcher` = 19645 passed, 1 failed: "whim sheet: past a hundred versions the version line still counts the
   whole chain, as History does: threw timed out waiting for the version line" (timing; file untouched by this chain;
   machine ran ~17 capped-run processes). Not re-run (one run per check). server step did not finish: gate NOT green.
2. integrity: EXIT 3. Flagged (CHANGED): CLAUDE.md README.md checks/test/release/android-dev-script.suite.ts
   checks/test/release/index.ts demo/README.md docs/release/mobile.md handoff/chain-6-7.md package.json
   scripts/android-release.mjs scripts/release/cli.ts scripts/release/lib/android-dev-script.ts.
   Only package.json is CLASS-1 TAMPER ("no allowlist declared"): the approved file (ruling 20a). Nothing else flagged.
3. ratchet (base f42268b0): EXIT 0, PASS.
4. co-authored lines: 0. 4ddb63f7 --stat: package.json only, 1 insertion 1 deletion.
5. Device (emulator-5560 only, started by me; at start `adb devices` listed only emulator-5640, not touched):
   (a) `npm run android:release -- --device emulator-5560`: EXIT 1. Gradle BUILD SUCCESSFUL in 9m50s and
       installOffline printed "Installed on 1 device."; then RN CLI `adb -s emulator-5560 install -r -d` failed with
       "adb: device 'emulator-5560' not found" (emulator dropped off adb). Afterwards `pm list packages -3` on 5560
       lists nothing and `| grep -i whim` is empty: install NOT confirmed. Not rebuilt.
       Other devices: 5640 appeared only in ddmlib timeout lines; nothing installed on any other device.
   (b) no ANDROID_SERIAL, no --device (one device attached): EXIT 2, names `--device` and ANDROID_SERIAL, built nothing.
   (c) --device emulator-9999: EXIT 2, "not attached ... Nothing was built."
   Multi-device targeting proof (second emulator): not done.
