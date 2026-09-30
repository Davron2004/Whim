# Beta-1 final-candidate acceptance run sheet

Use this only after the final full gate/review selects a committed candidate. The
receipt names that SHA and build; it must not reuse 391705 evidence.

## Evidence boundary

- Android 391705 (source `a1586b87`) passed the keyboard, full-window sheets,
  ghost caption, ordinary failure, and stub flows on `emulator-5560`. Repeat
  those visible checks on the rebuilt candidate.
- iOS 391705 (also `a1586b87`) passed plan-row editing, report keyboard,
  one production build, Home/History/orb sheets, and release Settings. It did
  not cover Other, limit, failure/Try again, or a human interactive keyboard
  drag. Repeat candidate-native checks.

## 0. Pin the candidate and serialize work

```sh
REPO=/Users/davrondjabborov/Work/other/Whim
cd "$REPO"
set -euo pipefail
PRODUCT_SOURCE_SHA="$(git rev-parse HEAD)"
CANDIDATE_SHA="$PRODUCT_SOURCE_SHA"
BUILD="$(node scripts/release/run.mjs build-number)"
RUN_ROOT="$(mktemp -d "/tmp/whim-beta1-final-$BUILD.XXXXXX")"
PRODUCT_INPUTS=(android ios src server contract build scripts package.json package-lock.json tsconfig.json babel.config.js metro.config.js)
test -z "$(git status --porcelain -- "${PRODUCT_INPUTS[@]}")"
OLD_SERVER_PID=''
QA_SERVER_PID=''
ANDROID_QA_PID=''
ANDROID_QA_STARTED=0
ANDROID_QA_READY=0
IOS_DEBUG_UDID=''
IOS_RELEASE_UDID=''

stop_old_server() {
  if [ -n "$OLD_SERVER_PID" ]; then
    kill "$OLD_SERVER_PID" 2>/dev/null || true
    wait "$OLD_SERVER_PID" 2>/dev/null || true
    OLD_SERVER_PID=''
  fi
}
assert_product_source() {
  git diff --quiet "$PRODUCT_SOURCE_SHA"..HEAD -- "${PRODUCT_INPUTS[@]}"
  test -z "$(git status --porcelain -- "${PRODUCT_INPUTS[@]}")"
}
cleanup_android_emulator() {
  if [ "$ANDROID_QA_STARTED" = 1 ]; then
    if [ "$ANDROID_QA_READY" = 1 ]; then
      adb -s emulator-5560 reverse --remove "tcp:$QA_PORT" 2>/dev/null || true
    fi
    kill "$ANDROID_QA_PID" 2>/dev/null || true
    wait "$ANDROID_QA_PID" 2>/dev/null || true
    ANDROID_QA_STARTED=0; ANDROID_QA_READY=0; ANDROID_QA_PID=''
  fi
}
stop_qa_server() {
  if [ -n "$QA_SERVER_PID" ]; then
    kill "$QA_SERVER_PID" 2>/dev/null || true
    wait "$QA_SERVER_PID" 2>/dev/null || true
    QA_SERVER_PID=''
  fi
}
cleanup_android_qa() {
  cleanup_android_emulator
  stop_qa_server
}
cleanup_debug_sim() {
  if [ -n "$IOS_DEBUG_UDID" ]; then
    xcrun simctl terminate "$IOS_DEBUG_UDID" com.anycognition.whim 2>/dev/null || true
    xcrun simctl shutdown "$IOS_DEBUG_UDID" 2>/dev/null || true
    xcrun simctl delete "$IOS_DEBUG_UDID" 2>/dev/null || true
    IOS_DEBUG_UDID=''
  fi
}
cleanup_release_sim() {
  if [ -n "$IOS_RELEASE_UDID" ]; then
    xcrun simctl terminate "$IOS_RELEASE_UDID" com.anycognition.whim 2>/dev/null || true
    xcrun simctl shutdown "$IOS_RELEASE_UDID" 2>/dev/null || true
    xcrun simctl delete "$IOS_RELEASE_UDID" 2>/dev/null || true
    IOS_RELEASE_UDID=''
  fi
}
cleanup_owned() {
  stop_old_server
  cleanup_android_qa
  cleanup_debug_sim
  cleanup_release_sim
}
trap cleanup_owned EXIT HUP INT TERM
printf 'source=%s\nbuild=%s\ncreated=%s\n' "$PRODUCT_SOURCE_SHA" "$BUILD" "$(date -u +%FT%TZ)" \
  | tee "$RUN_ROOT/candidate.txt"
```

Run the remaining blocks in this same dedicated shell so its pin and owned-resource functions remain active.

Before each native build or install, compare product inputs with the pinned
source: `git diff --quiet "$PRODUCT_SOURCE_SHA"..HEAD -- "${PRODUCT_INPUTS[@]}"`.
A changed product input requires a new artifact and source pin. A later
receipt-only or OpenSpec documentation commit does not. Build Android and iOS
one at a time. The Android build is capped at two Gradle workers and
the iOS builds at two Xcode jobs; do not issue a global Gradle stop command.
Run one Maestro process per device at a time; do not issue a concurrent
`maestro hierarchy`, test, or screenshot-helper command.
A prior stray command restarted Maestro's driver and aborted a run
(`docs/harness-feedback/2026-09-25-beta-1/fix-8.md`). No documented
per-project Maestro-log isolation exists, so serialize with Outsiide work too.

Do not use or stop FilmKit/`emulator-5556`, its Outsiide Maestro process, or
Docker. The upgrade script creates `emulator-5580`. For task 10.4, take a
fresh Whim_Verify lease and boot it wiped at `emulator-5560`; do not reuse the
391705 session. The run owns that new process only. The Release pass likewise
uses a new simulator. Neither action touches the shared FilmKit device.

## 1. Android artifact and 382511 upgrade

```sh
cd "$REPO"
assert_product_source
npm run build
(cd android && ./gradlew --no-daemon --max-workers=2 :app:assembleOffline -PwhimBuildNumber="$BUILD")
ANDROID_TO="$REPO/android/app/build/outputs/apk/offline/app-offline.apk"
test -f "$ANDROID_TO"
shasum -a 256 "$ANDROID_TO" | tee "$RUN_ROOT/android-artifact.sha256"
test -f "$HOME/.cache/whim-upgrade/from.apk"
test -d "$HOME/.cache/whim-upgrade/382511"
```

The old cache is tag `release/1.0.0+382511`, commit `a9b03c47`. Start its
server, rather than the candidate server: 382511 has no stub rewrite and
therefore needs the primary checkout's model roster from `.env`. Do not print
that file.

```sh
UPGRADE_PORT=8790
UPGRADE_DATA="$(mktemp -d "/tmp/whim-upgrade-old-$BUILD.XXXXXX")"
(
  cd "$HOME/.cache/whim-upgrade/382511"
  exec env WHIM_PIPELINE=stub WHIM_SERVER_HOST=127.0.0.1 WHIM_SERVER_PORT="$UPGRADE_PORT" \
    WHIM_DATA_DIR="$UPGRADE_DATA" node --env-file="$REPO/.env" server/dev.mjs
) >"$RUN_ROOT/old-server-android.log" 2>&1 &
OLD_SERVER_PID=$!
OLD_SERVER_READY=0
for attempt in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:$UPGRADE_PORT/healthz" >"$RUN_ROOT/old-healthz.json"; then OLD_SERVER_READY=1; break; fi
  sleep 1
done
test "$OLD_SERVER_READY" = 1

(
  cd "$(dirname "$ANDROID_TO")"
  env PATH="/tmp/whim-beta1-native-tools:$PATH" "$REPO/scripts/release/upgrade-check.sh" --platform android --avd Whim_Verify --emulator-port 5580 --port "$UPGRADE_PORT" \
    --from "$HOME/.cache/whim-upgrade/from.apk" --to app-offline.apk \
    --evidence "$REPO/openspec/changes/beta-1/upgrade-check/android-final-$BUILD"
)

stop_old_server
rm -rf "$UPGRADE_DATA"
```

The script owns, wipes, and tears down `emulator-5580`. A pass requires
`RESULT: PASS` in `upgrade-check/android-final-$BUILD/result.txt`; commit its
`before.json`, `after.json`, and `result.txt`, leaving `raw/` local.

## 2. iOS Release artifact and 382511 upgrade

Do this only after Android's native build and upgrade have stopped.

```sh
cd "$REPO"
assert_product_source
(
  cd ios
  bundle exec pod install
  xcodebuild -jobs 2 -workspace Whim.xcworkspace -scheme Whim -configuration Release -sdk iphonesimulator \
    -derivedDataPath build/sim WHIM_BUILD_NUMBER="$BUILD" build
)
IOS_RELEASE_APP="$REPO/ios/build/sim/Build/Products/Release-iphonesimulator/Whim.app"
test -d "$IOS_RELEASE_APP"
plutil -extract CFBundleVersion raw -o - "$IOS_RELEASE_APP/Info.plist" | tee "$RUN_ROOT/ios-release-build.txt"
shasum -a 256 "$IOS_RELEASE_APP/Whim" | tee "$RUN_ROOT/ios-release-artifact.sha256"
```

After the artifact is recorded, inspect and retain the exact pod-install diff
before restoring it. The last successful iOS build changed exactly these three
tracked generated/order files: `ios/Podfile.lock`,
`ios/Whim.xcodeproj/project.pbxproj`, and `ios/Whim/Info.plist`. The lockfile
change was checksum/order-only. Zero changes or a subset of these three paths is valid; do not require all three to change. Inspect the actual diff for dependency or product changes even when its paths are expected. If any other tracked iOS path changed, stop
and inspect it; do not blanket-restore iOS.

```sh
git diff -- ios/Podfile.lock ios/Whim.xcodeproj/project.pbxproj ios/Whim/Info.plist \
  >"$RUN_ROOT/ios-pod-install.diff"
git diff --name-only -- ios >"$RUN_ROOT/ios-pod-install-files.txt"
while IFS= read -r changed; do
  case "$changed" in
    ios/Podfile.lock|ios/Whim.xcodeproj/project.pbxproj|ios/Whim/Info.plist) ;;
    '') ;;
    *) printf 'Unexpected tracked iOS change: %s\n' "$changed" >&2; exit 1 ;;
  esac
done <"$RUN_ROOT/ios-pod-install-files.txt"
# Pause here to inspect the retained diff. Path membership is not semantic approval.
# Only after checksum/order/generated changes are verified against the pinned inputs:
git -C /Users/davrondjabborov/Work/other/Whim restore -- ios/Podfile.lock ios/Whim.xcodeproj/project.pbxproj ios/Whim/Info.plist
```

```sh
UPGRADE_DATA="$(mktemp -d "/tmp/whim-upgrade-old-$BUILD.XXXXXX")"
(
  cd "$HOME/.cache/whim-upgrade/382511"
  exec env WHIM_PIPELINE=stub WHIM_SERVER_HOST=127.0.0.1 WHIM_SERVER_PORT="$UPGRADE_PORT" \
    WHIM_DATA_DIR="$UPGRADE_DATA" node --env-file="$REPO/.env" server/dev.mjs
) >"$RUN_ROOT/old-server-ios.log" 2>&1 &
OLD_SERVER_PID=$!
OLD_SERVER_READY=0
for attempt in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:$UPGRADE_PORT/healthz" >"$RUN_ROOT/old-healthz-ios.json"; then OLD_SERVER_READY=1; break; fi
  sleep 1
done
test "$OLD_SERVER_READY" = 1

(
  cd "$(dirname "$IOS_RELEASE_APP")"
  "$REPO/scripts/release/upgrade-check.sh" --platform ios --port "$UPGRADE_PORT" --manual-seed \
    --from "$HOME/.cache/whim-upgrade/382511/ios/build/sim/Build/Products/Release-iphonesimulator/Whim.app" \
    --to Whim.app --evidence "$REPO/openspec/changes/beta-1/upgrade-check/ios-final-$BUILD"
)

stop_old_server
rm -rf "$UPGRADE_DATA"
```

`--manual-seed` reads `/dev/tty`: launch the upgrade checker in an exec PTY session, retain its printed newly-created simulator UDID, and drive only that device while the script is paused. Bound this phase to 15 minutes. Send Enter only after verifying the +2 glasses save, generated app and edited version required by the seed instructions. Stop and retain a failed seed receipt if interaction is unavailable; do not count it as a pass. The script resumes its own serial Maestro work after Enter.

`--manual-seed` is permitted because 382511's compose keyboard can hide
Continue. The script creates/deletes its own simulator. A failed seed log is
not an upgrade pass; retain the directory and use `--keep-device` only for
that script-created simulator.

## 3. Current-tip stub server and Android candidate recapture

This is deterministic UI coverage only, never Release production evidence.
`WHIM_SERVER_PORT` is the actual configuration key.

```sh
if adb devices | grep -q '^emulator-5560[[:space:]]'; then
  echo 'emulator-5560 is already leased; do not reuse or stop it' >&2
  exit 1
fi
assert_product_source
QA_PORT=8790
QA_DATA="$(mktemp -d "/tmp/whim-final-qa-$BUILD.XXXXXX")"
cd "$REPO"
env -u OPENROUTER_API_KEY WHIM_PIPELINE=stub WHIM_SERVER_HOST=127.0.0.1 WHIM_SERVER_PORT="$QA_PORT" \
  WHIM_DATA_DIR="$QA_DATA" WHIM_MAX_CONCURRENT_GENERATIONS=1 WHIM_STUB_DELAY_MS=4000 \
  node server/dev.mjs >"$RUN_ROOT/qa-server.log" 2>&1 &
QA_SERVER_PID=$!
QA_SERVER_READY=0
for attempt in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:$QA_PORT/healthz" >"$RUN_ROOT/qa-healthz.json"; then QA_SERVER_READY=1; break; fi
  sleep 1
done
test "$QA_SERVER_READY" = 1

emulator -avd Whim_Verify -port 5560 -wipe-data -no-snapshot -no-boot-anim -gpu swiftshader_indirect -memory 3072 -cores 2 \
  >"$RUN_ROOT/android-qa-emulator.log" 2>&1 &
ANDROID_QA_PID=$!
ANDROID_QA_STARTED=1
for attempt in $(seq 1 200); do
  if [ "$(adb -s emulator-5560 shell getprop sys.boot_completed 2>/dev/null | tr -d "\r")" = 1 ]; then break; fi
  sleep 3
done
test "$(adb -s emulator-5560 shell getprop sys.boot_completed | tr -d "\r")" = 1
ANDROID_QA_READY=1
adb -s emulator-5560 reverse "tcp:$QA_PORT" "tcp:$QA_PORT"
adb -s emulator-5560 install -r "$ANDROID_TO"
adb -s emulator-5560 shell am start -n com.anycognition.whim/com.whim.MainActivity
```

Set the internal-build Settings → Advanced address to
`http://localhost:8790`. Record source SHA/build and capture paths. Repeat:

1. Settings first focus; Compose Continue/Back or empty-space keyboard
   dismissal; Clarify Other plus a pill while the keyboard is up; plan row four
   and last row with keyboard-up Cancel and Save; report draft and actions.
2. Identity confirmation and installed-tile sheets: full-window scrim,
   independently accessible actions, cancel, and safe inset.
3. `[[future:update]]`: caption survives Home/reopen. `[[fail]]`: ordinary
   failure remains distinct and recoverable.

This run created the wiped, visible `emulator-5560` with a 3-GB/2-core budget.
As soon as the Android capture files are saved, stop only this run's emulator.
The QA server stays up for Debug iOS; never use `adb kill-server`.

```sh
cleanup_android_emulator
# Keep the owned QA server and "$QA_DATA" for the Debug-iOS phase.
```

## 4. Debug iOS deterministic coverage

Debug is internal and may use the server override; Release cannot, because
`WhimAppInfoModule.mm` returns `internalBuild=true` only under `DEBUG`.

```sh
cd "$REPO"
assert_product_source
(
  cd ios
  FORCE_BUNDLING=1 xcodebuild -jobs 2 -workspace Whim.xcworkspace -scheme Whim -configuration Debug -sdk iphonesimulator \
    -derivedDataPath build/final-debug WHIM_BUILD_NUMBER="$BUILD" build
)
IOS_DEBUG_APP="$REPO/ios/build/final-debug/Build/Products/Debug-iphonesimulator/Whim.app"
test -d "$IOS_DEBUG_APP"
IOS_DEBUG_UDID="$(xcrun simctl create "Whim-beta1-final-debug-$BUILD" "iPhone 17" com.apple.CoreSimulator.SimRuntime.iOS-27-0)"
xcrun simctl boot "$IOS_DEBUG_UDID"
xcrun simctl bootstatus "$IOS_DEBUG_UDID" -b
xcrun simctl install "$IOS_DEBUG_UDID" "$IOS_DEBUG_APP"
xcrun simctl launch "$IOS_DEBUG_UDID" com.anycognition.whim
```

Set Settings → Advanced to `http://127.0.0.1:8790`, then perform these
serial flows with screenshots/hierarchies:

1. Normal prompt → question three **Other**; field/Next stay above keyboard,
   and a select-one pill responds while keyboard remains up.
2. `[[limit]]` → capture limit; **Build … instead** re-clarifies; **Change my
   idea** returns to Compose.
3. `[[future:fail]]` → capture failure notice and no installed app, activate
   **Try again**, and capture the retry destination/outcome.
4. Normal flow through Plan row four or later: field, Cancel, Save, Build it,
   and keyboard/scroll bounds.

These close the deterministic iOS Clarify and keyboard gaps from 391705.

```sh
cleanup_debug_sim
stop_qa_server
# Preserve "$QA_DATA" for diagnosis until its screenshots/logs are safely recorded.
```

## 5. iOS Release production acceptance and decoder limit

Install `$IOS_RELEASE_APP` on a new Release simulator for task 10.4. Keep
Release on its production endpoint; no Advanced override is expected.

```sh
assert_product_source
IOS_RELEASE_UDID="$(xcrun simctl create "Whim-beta1-final-release-$BUILD" "iPhone 17" com.apple.CoreSimulator.SimRuntime.iOS-27-0)"
xcrun simctl boot "$IOS_RELEASE_UDID"
xcrun simctl bootstatus "$IOS_RELEASE_UDID" -b
xcrun simctl install "$IOS_RELEASE_UDID" "$IOS_RELEASE_APP"
xcrun simctl launch "$IOS_RELEASE_UDID" com.anycognition.whim
```

Use one normal production clarify/rewrite/generation path, record the count of
production requests, source SHA/build, and capture:

1. Clarify → Plan; lowest editor with keyboard, Done/refocus, keyboard-up
   Cancel/Save.
2. Other if this response has it; record its absence rather than spending a
   request to force it.
3. Report-sheet keyboard bounds and scrim dismissal.
4. A normal human-performed interactive keyboard drag. Maestro/XCTest drags do
   not count. After it, record the Whim process CPU and a screen/hierarchy if
   it stalls.
5. Generated-app Home/History/orb navigation on this candidate binary.

The semantic suite already executes all three membership branches, including
optional null normalization and summary validation. A successful known SSE
decode on this iOS Release build proves that the changed Object.hasOwn
intrinsic executes in the host Hermes engine. The Android offline generation
does the same on Android Hermes. A result summary is useful product evidence
but is optional and is not required for engine compatibility. See
/tmp/whim-beta1-host-guards-evidence.md.

## 6. Remaining ownership and cleanup

The final-candidate evidence still required is:

- source-pinned Android and iOS artifact hashes;
- both 382511 → candidate `RESULT: PASS` upgrade receipts;
- Android stub and Debug-iOS deterministic recaptures;
- Release-iOS production receipt and human drag verdict;
- successful Android and iOS host decode receipts, alongside the full-gate
  semantic suite, for the Object.hasOwn replacements.

The owner alone supplies the genuine finger/Simulator-GUI drag verdict and,
after merge/store assignment, section 10.8's demo-phone check. Record actual
production request counts; never label stub traffic as production.

```sh
cleanup_owned
# After the evidence is copied and no repro is needed:
rm -rf "$QA_DATA"
```

The Android and iOS devices in this cleanup were created by this run. Do not
kill FilmKit/`emulator-5556`, the Outsiide Maestro process, or any PID this
run did not create. The fresh QA data directory is also owned by this run;
do not remove a prior QA server or its data.

## Required coverage supplement

Use final-native-flow-map.md for source-derived stub controls, existing capture helpers and exact cases. Repeat ordinary failure, both limit exits, `[[future:skip]]` through successful delivery, `[[future:fail]]` plus Try again, and `[[future:update]]` with no installed app on both internal native platforms. These are required section-10 cases; earlier short recapture lists do not waive them.

For the cap-one line, run controlled HTTP clients A and B with fresh QA device IDs against the owned local stub. Prepare the single native host C through Plan before starting them. After A starts and B queues, C must show one build ahead, then next, then begin after B. Retain real A/B SSE traces, C native captures and server ordering. A/B are server clients; only C supplies native UI evidence. The source-derived temporary client is /tmp/whim-beta1-line-clients-final.mjs; capture its hash and keep its raw trace with the acceptance receipt. This satisfies three distinct builds without three native devices.

Before any Maestro use, follow maestro-global-log-isolation.md: two clear process/archive scans sixty seconds apart, bounded to ten minutes, then one client per owned device. Do not interrupt another project's QA, change its home/settings or claim debug-output isolates global diagnostic logs.

## Fresh evidence and helper amendment

Existing upgrade result directories are immutable receipts. Use BUILD-suffixed directories above; append an attempt suffix for retries rather than overwriting a failed run. Place native captures in new `android-final-BUILD`, `ios-debug-final-BUILD` and `ios-release-final-BUILD` acceptance directories. Copy the Android helper to its new output directory before using it; it writes beside itself and remains pinned to emulator-5560.

The new evidence-only line helper retains exact A/B response bytes as `a.sse` and `b.sse`, timestamps summary events, hashes itself into metadata, owns early rejection handlers and aborts both requests on failure/deadline/termination. Its `--self-test` performs no network I/O. Preserve the previous helper for audit. Record the actual helper hash at execution; source preparation hash is in the accompanying handoff.

Before Maestro, `/tmp/whim-beta1-maestro-quiet.py` offers the read-only two-clear-scans check, bounded to ten minutes. It changes no global settings. A quiet scan is not a cross-project lock; recheck immediately before the owned command and leave Outsiide's work alone.

Use explicit owned Android IDs (5580 upgrade, 5560 recapture) and record every newly-created iOS UDID. Do not reuse earlier simulator leases. Cap Android Gradle at `--no-daemon --max-workers=2`, every Xcode build at `-jobs 2`, and the recapture emulator at 3072 MB/two cores. The Android upgrade command uses `/tmp/whim-beta1-native-tools/emulator` through a per-command PATH. This Bash 3.2 adapter refuses every AVD/port except Whim_Verify/5580 and appends 3072 MB/two cores before executing the real emulator. It does not alter shared AVD settings, global PATH, HOME or other projects. Preserve and hash the adapter with the receipt.
