#!/usr/bin/env bash
# The release upgrade check (beta-1 design D15; spec release-upgrade-check). Runbook, including how
# to build both artifacts and start the previous release's stub server: docs/release/mobile.md.
#
#   scripts/release/upgrade-check.sh --platform android|ios --from <artifact> --to <artifact>
#       [--evidence <dir>] [--port <n>] [--avd <name>] [--emulator-port <n>]
#       [--sim-type <device type>] [--sim-runtime <runtime>] [--manual-seed] [--keep-device]
#
# A fresh device (a wiped emulator, or a newly created simulator), then: install --from, seed it
# (upgrade-check/seed.yaml), read the seed record, install --to over it, read the same record, and
# diff the two (`node scripts/release/run.mjs upgrade-diff`). Exits non-zero on any difference, on
# a seed that lacks something, or on a failed step, naming the step.
#
# Artifacts: android takes debuggable offline APKs (`:app:assembleOffline`: debug-signed, so the
# upgrade installs over the old build, and run-as can read the app's store); ios takes simulator
# .app bundles. The --to build number must be higher than the --from one, as in a store upgrade.
# Runs under macOS's bash 3.2.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
FLOWS="$REPO/scripts/release/upgrade-check"
APP_ID="com.anycognition.whim"
STAMP="$(date +%Y%m%d-%H%M%S)"

PLATFORM="" FROM="" TO="" EVIDENCE="" PORT=8787 AVD="" EMU_PORT=5580
SIM_TYPE="com.apple.CoreSimulator.SimDeviceType.iPhone-15-Plus" SIM_RUNTIME=""
MANUAL_SEED=0 KEEP_DEVICE=0
DEVICE="" EMU_PID="" CREATED_SIM=0 SCREEN_HEIGHT="" STEP="arguments"

usage() {
  sed -n '5,7p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//' >&2
  exit 2
}

abspath() {
  if [[ $1 == /* ]]; then printf '%s\n' "$1"; else printf '%s/%s\n' "$PWD" "$1"; fi
}

while (($# > 0)); do
  case "$1" in
    --platform) PLATFORM="${2:-}"; shift 2 ;;
    --from) FROM="$(abspath "${2:-}")"; shift 2 ;;
    --to) TO="$(abspath "${2:-}")"; shift 2 ;;
    --evidence) EVIDENCE="$(abspath "${2:-}")"; shift 2 ;;
    --port) PORT="${2:-}"; shift 2 ;;
    --avd) AVD="${2:-}"; shift 2 ;;
    --emulator-port) EMU_PORT="${2:-}"; shift 2 ;;
    --sim-type) SIM_TYPE="${2:-}"; shift 2 ;;
    --sim-runtime) SIM_RUNTIME="${2:-}"; shift 2 ;;
    --manual-seed) MANUAL_SEED=1; shift ;;
    --keep-device) KEEP_DEVICE=1; shift ;;
    -h|--help) usage ;;
    *) printf 'upgrade-check: unknown argument "%s"\n' "$1" >&2; usage ;;
  esac
done

SERVER_URL="http://127.0.0.1:$PORT"
EVIDENCE="${EVIDENCE:-${TMPDIR:-/tmp}/whim-upgrade-check/$PLATFORM-$STAMP}"
RAW="$EVIDENCE/raw"

step() {
  STEP="$1"
  printf '\n== %s ==\n' "$STEP"
}

fail() {
  printf 'upgrade-check: step "%s": %s\n' "$STEP" "$*" >&2
  exit 1
}

teardown() {
  if ((KEEP_DEVICE)) && [[ -n $DEVICE ]]; then
    printf 'upgrade-check: --keep-device: %s is still running\n' "$DEVICE" >&2
    return 0
  fi
  if [[ -n $EMU_PID ]]; then
    adb -s "$DEVICE" emu kill </dev/null >/dev/null 2>&1 || true
    wait "$EMU_PID" 2>/dev/null || true
  fi
  if ((CREATED_SIM)); then
    xcrun simctl shutdown "$DEVICE" >/dev/null 2>&1 || true
    xcrun simctl delete "$DEVICE" >/dev/null 2>&1 || true
  fi
}

on_exit() {
  local code=$?
  if ((code != 0)); then
    printf 'upgrade-check: FAILED at step "%s" (exit %s). Evidence so far: %s\n' "$STEP" "$code" "$EVIDENCE" >&2
  fi
  teardown
}
trap on_exit EXIT

# Runs "$@" with a wall-clock limit, since macOS has no `timeout`: past $1 seconds the command is
# killed and this returns 124. Polls every tenth of a second.
with_deadline() {
  local ticks=$(($1 * 10)) pid
  shift
  "$@" &
  pid=$!
  while kill -0 "$pid" 2>/dev/null; do
    if ((ticks <= 0)); then
      kill "$pid" 2>/dev/null || true
      wait "$pid" 2>/dev/null || true
      return 124
    fi
    sleep 0.1
    ticks=$((ticks - 1))
  done
  wait "$pid"
}

# What a failed Maestro run on iOS most likely was. Maestro has crashed SpringBoard on this machine
# before, and 382511's compose keyboard can't be dismissed and covers Continue (#49/#50).
maestro_ios_hint() {
  [[ $PLATFORM == ios ]] || return 0
  local launchd_jobs springboard
  launchd_jobs="$(xcrun simctl spawn "$DEVICE" launchctl list 2>/dev/null || true)"
  springboard="$(grep -i springboard <<<"$launchd_jobs" || true)"
  cat >&2 <<EOF
upgrade-check: Maestro failed on iOS. SpringBoard job now: ${springboard:-not listed}.
  Known causes here: Maestro has crashed SpringBoard on this machine before, and on 382511 the
  compose keyboard can't be dismissed and covers Continue (#49/#50). Maestro's screenshots are
  under $RAW/maestro. To seed by hand instead, rerun with --manual-seed (docs/release/mobile.md).
EOF
}

# run_flow <name> <flow> [maestro test args...]: one Maestro flow, its log and debug output in raw/maestro.
# On iOS every flow also gets SCREEN_HEIGHT, for the tile menu rows it taps by position.
run_flow() {
  local name=$1 flow=$2 limit=300
  shift 2
  if [[ $flow == seed ]]; then limit=1800; fi
  if [[ -n $SCREEN_HEIGHT ]]; then set -- "$@" -e "SCREEN_HEIGHT=$SCREEN_HEIGHT"; fi
  if ! with_deadline "$limit" maestro --device "$DEVICE" test --debug-output "$RAW/maestro/$name" "$@" "$FLOWS/$flow.yaml" \
    </dev/null >"$RAW/maestro/$name.log" 2>&1; then
    tail -n 25 "$RAW/maestro/$name.log" >&2
    maestro_ios_hint
    fail "Maestro flow $flow.yaml failed or ran past ${limit}s (log: $RAW/maestro/$name.log)"
  fi
}

# dump <path without extension>: the screen's view hierarchy (what upgrade-record reads) and a screenshot.
dump() {
  if ! with_deadline 180 maestro --device "$DEVICE" hierarchy </dev/null >"$1.json" 2>>"$RAW/maestro/hierarchy.log"; then
    maestro_ios_hint
    fail "maestro hierarchy failed for $1.json"
  fi
  if [[ $PLATFORM == android ]]; then
    adb -s "$DEVICE" exec-out screencap -p </dev/null >"$1.png"
  else
    xcrun simctl io "$DEVICE" screenshot "$1.png" </dev/null >/dev/null 2>&1
  fi
}

stop_app() {
  if [[ $PLATFORM == android ]]; then
    adb -s "$DEVICE" shell am force-stop "$APP_ID" </dev/null
  else
    xcrun simctl terminate "$DEVICE" "$APP_ID" >/dev/null 2>&1 || true
  fi
}

# pull_store <dir>: the launcher's MMKV store (data + .crc meta), read with the app stopped.
pull_store() {
  local dir=$1 container matches source file
  mkdir -p "$dir"
  if [[ $PLATFORM == android ]]; then
    for file in whim.launcher whim.launcher.crc; do
      adb -s "$DEVICE" exec-out run-as "$APP_ID" cat "files/mmkv/$file" </dev/null >"$dir/$file"
    done
  else
    container="$(xcrun simctl get_app_container "$DEVICE" "$APP_ID" data)"
    matches="$(find "$container" -type f -path '*/mmkv/whim.launcher')"
    source="${matches%%$'\n'*}"
    [[ -n $source ]] || fail "no mmkv/whim.launcher under $container"
    cp "$source" "$source.crc" "$dir/"
  fi
}

# capture <name>: one full read of the device into raw/<name>, and its record at <name>.json.
capture() {
  local name=$1 dir="$RAW/$1" tiles id tile
  mkdir -p "$dir/history"
  run_flow "$name-grid" read-grid
  dump "$dir/grid"
  stop_app
  pull_store "$dir/storage"
  tiles="$(node scripts/release/run.mjs upgrade-record --capture "$dir" --list-tiles)"
  while IFS=$'\t' read -r id tile <&3; do
    [[ -n $id ]] || continue
    run_flow "$name-history-$id" read-history -e "TILE=$tile"
    dump "$dir/history/$id"
    if [[ $tile == "Water Counter" && ! -e "$dir/water-counter.json" ]]; then
      run_flow "$name-water-counter" read-water-counter
      dump "$dir/water-counter"
    fi
  done 3<<<"$tiles"
  node scripts/release/run.mjs upgrade-record --capture "$dir" --out "$EVIDENCE/$name.json"
  printf 'record: %s\n' "$EVIDENCE/$name.json"
}

install_app() {
  if [[ $PLATFORM == android ]]; then
    adb -s "$DEVICE" install -r "$1" </dev/null >"$RAW/install.log" 2>&1 || { cat "$RAW/install.log" >&2; fail "adb install $1 failed"; }
    adb -s "$DEVICE" shell run-as "$APP_ID" true </dev/null ||
      fail "run-as $APP_ID failed: the APKs must be debuggable (the offline build, :app:assembleOffline)"
  else
    xcrun simctl install "$DEVICE" "$1"
  fi
}

# build_of <artifact>: the build number, read from the installed package (android) or the bundle (ios).
build_of() {
  local out
  if [[ $PLATFORM == android ]]; then
    out="$(adb -s "$DEVICE" shell dumpsys package "$APP_ID" </dev/null)"
    awk 'match($0, /versionCode=[0-9]+/) { print substr($0, RSTART + 12, RLENGTH - 12); exit }' <<<"$out"
  else
    bundle_value "$1" CFBundleVersion
  fi
}

bundle_value() {
  plutil -extract "$2" raw -o - "$1/Info.plist"
}

record_artifact() {
  local label=$1 artifact=$2 build=$3 digest
  if [[ -f $artifact ]]; then
    digest="$(shasum -a 256 "$artifact")"
  else
    digest="$(shasum -a 256 "$artifact/$(bundle_value "$artifact" CFBundleExecutable)")"
  fi
  printf '%s: %s, build %s, sha256 %s\n' "$label" "$artifact" "$build" "${digest%% *}" >>"$EVIDENCE/result.txt"
}

step preflight
cd "$REPO"
[[ $PLATFORM == android || $PLATFORM == ios ]] || usage
[[ -n $FROM && -n $TO ]] || usage
[[ $PORT =~ ^[0-9]+$ ]] || fail "--port must be a number"
[[ ! -e "$EVIDENCE/result.txt" ]] || fail "$EVIDENCE already holds a run; pass a new --evidence directory"
for tool in maestro node curl; do command -v "$tool" >/dev/null || fail "$tool is not on PATH"; done
if [[ $PLATFORM == android ]]; then
  [[ -n $AVD ]] || fail "--avd is required for android (emulator -list-avds)"
  [[ $EMU_PORT =~ ^[0-9]+$ ]] && ((EMU_PORT % 2 == 0)) || fail "--emulator-port must be an even number"
  for tool in adb emulator; do command -v "$tool" >/dev/null || fail "$tool is not on PATH"; done
  for artifact in "$FROM" "$TO"; do [[ -f $artifact && $artifact == *.apk ]] || fail "$artifact is not an .apk file"; done
else
  command -v xcrun >/dev/null || fail "xcrun is not on PATH"
  for artifact in "$FROM" "$TO"; do
    [[ -d $artifact && $artifact == *.app ]] || fail "$artifact is not a .app bundle"
    [[ "$(bundle_value "$artifact" CFBundleIdentifier)" == "$APP_ID" ]] || fail "$artifact is not $APP_ID"
  done
fi
health="$(curl -fsS -m 5 "$SERVER_URL/healthz")" || health=""
[[ $health == *whim-server* ]] ||
  fail "no Whim server answers at $SERVER_URL/healthz: start the --from build's stub server first (docs/release/mobile.md)"
mkdir -p "$RAW/maestro"
printf 'upgrade check: %s, %s\nserver: %s %s\n' "$PLATFORM" "$STAMP" "$SERVER_URL" "$health" >"$EVIDENCE/result.txt"
# The raw captures (view hierarchies, screenshots, the pulled store) stay out of git.
printf 'raw/\n' >"$EVIDENCE/.gitignore"

step device
if [[ $PLATFORM == android ]]; then
  devices="$(adb devices)"
  if grep -q "^emulator-$EMU_PORT[[:space:]]" <<<"$devices"; then
    fail "emulator-$EMU_PORT is already running; pick another --emulator-port"
  fi
  DEVICE="emulator-$EMU_PORT"
  emulator -avd "$AVD" -port "$EMU_PORT" -wipe-data -no-snapshot -no-boot-anim -gpu swiftshader_indirect -no-window \
    </dev/null >"$RAW/emulator.log" 2>&1 &
  EMU_PID=$!
  booted=0
  for ((i = 0; i < 200; i++)); do
    if ! kill -0 "$EMU_PID" 2>/dev/null; then
      EMU_PID=""
      tail -n 20 "$RAW/emulator.log" >&2
      fail "the emulator exited while booting (is AVD $AVD already running?)"
    fi
    if [[ "$(adb -s "$DEVICE" shell getprop sys.boot_completed </dev/null 2>/dev/null | tr -d '\r')" == 1 ]]; then
      booted=1
      break
    fi
    sleep 3
  done
  ((booted)) || fail "the emulator did not finish booting in 10 minutes"
  adb -s "$DEVICE" reverse "tcp:$PORT" "tcp:$PORT" </dev/null >/dev/null
  printf 'device: %s (AVD %s, wiped)\n' "$DEVICE" "$AVD" >>"$EVIDENCE/result.txt"
else
  DEVICE="$(xcrun simctl create "whim-upgrade-check-$STAMP" "$SIM_TYPE" ${SIM_RUNTIME:+"$SIM_RUNTIME"})"
  CREATED_SIM=1
  with_deadline 600 xcrun simctl bootstatus "$DEVICE" -b >"$RAW/bootstatus.log" 2>&1 ||
    fail "the simulator did not boot (log: $RAW/bootstatus.log)"
  printf 'device: %s (new simulator, %s)\n' "$DEVICE" "$SIM_TYPE" >>"$EVIDENCE/result.txt"
fi

step install-from
install_app "$FROM"
FROM_BUILD="$(build_of "$FROM")"
record_artifact from "$FROM" "$FROM_BUILD"
if [[ $PLATFORM == ios ]]; then
  # The screen's height in points: the first element in a hierarchy dump with a size is the screen.
  dump "$RAW/screen"
  SCREEN_HEIGHT="$(sed -n 's/.*"bounds" : "\[0,0\]\[[0-9]*,\([1-9][0-9]*\)\]".*/\1/p' "$RAW/screen.json" | head -n 1)"
  [[ -n $SCREEN_HEIGHT ]] || fail "no screen size in $RAW/screen.json"
fi

step seed
if ((MANUAL_SEED)); then
  cat <<EOF
Seed $DEVICE by hand (Maestro is skipped for this step):
  1. Settings > Advanced > Server address: $SERVER_URL
  2. Open Water Counter, tap "+2 glasses", wait for "saved", then the orb > Home.
  3. Describe an app... > agree > any prompt > Continue (skip the questions) > Build it > Back to your apps.
  4. Long-press the new app > Prompt again > any change > Continue > Make the change > Back to your apps.
Press Enter once the grid shows the new app.
EOF
  read -r _ </dev/tty
  printf 'seed: by hand (--manual-seed)\n' >>"$EVIDENCE/result.txt"
else
  run_flow seed seed -e "SERVER_URL=$SERVER_URL"
  printf 'seed: scripts/release/upgrade-check/seed.yaml\n' >>"$EVIDENCE/result.txt"
fi

step read-before
capture before

step install-to
if [[ $PLATFORM == ios ]]; then
  TO_BUILD="$(build_of "$TO")"
  ((TO_BUILD > FROM_BUILD)) || fail "the --to build ($TO_BUILD) must be higher than the --from build ($FROM_BUILD)"
fi
install_app "$TO"
TO_BUILD="$(build_of "$TO")"
((TO_BUILD > FROM_BUILD)) || fail "build $TO_BUILD is installed after the upgrade; it must be higher than the --from build ($FROM_BUILD)"
record_artifact to "$TO" "$TO_BUILD"

step read-after
capture after

step diff
if node scripts/release/run.mjs upgrade-diff "$EVIDENCE/before.json" "$EVIDENCE/after.json" | tee -a "$EVIDENCE/result.txt"; then
  printf 'RESULT: PASS\n' | tee -a "$EVIDENCE/result.txt"
else
  printf 'RESULT: FAIL\n' | tee -a "$EVIDENCE/result.txt"
  exit 1
fi
