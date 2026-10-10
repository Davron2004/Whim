#!/bin/bash
# XCUITest command driver for the iOS simulator. See README.md.
#   driver.sh build <udid>          generate the Xcode project and build the UI test
#   driver.sh start <udid>          run the test detached; returns once the driver answers
#   driver.sh cmd <verb> [args...]  send one command, print its reply
#   driver.sh stop                  end the test and make sure xcodebuild is gone
#   driver.sh shot <udid> <out.png> screenshot (no driver needed)
set -u

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
WORK=${WHIM_IOS_DRIVER_DIR:-${TMPDIR:-/tmp}/whim-ios-driver}
WORK=${WORK%/}
case $WORK in
  /*) ;;
  *) WORK=$PWD/$WORK ;;
esac
CMD_TIMEOUT=${WHIM_IOS_DRIVER_TIMEOUT:-40}
START_TIMEOUT=${WHIM_IOS_DRIVER_START_TIMEOUT:-180}
PROJECT=$WORK/project/Driver.xcodeproj
DERIVED=$WORK/build
PIDFILE=$WORK/xcodebuild.pid
LOG=$WORK/xcodebuild.log

die() { echo "ios-ui-driver: $*" >&2; exit 1; }

usage() {
  sed -n '2,7p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//' >&2
  echo "working directory: $WORK (WHIM_IOS_DRIVER_DIR)" >&2
  exit 2
}

need_udid() {
  [ -n "${1:-}" ] || die "missing simulator UDID (xcrun simctl list devices)"
}

# Pids of the xcodebuild that runs the test: the recorded one, plus any other xcodebuild started
# with this working directory's derived data path (a leftover from a lost pid file).
driver_pids() {
  local pid
  if [ -f "$PIDFILE" ]; then
    pid=$(cat "$PIDFILE")
    if kill -0 "$pid" 2>/dev/null && ps -p "$pid" -o command= | grep -q xcodebuild; then
      echo "$pid"
    fi
  fi
  pgrep -f "xcodebuild .*-derivedDataPath $DERIVED " || true
}

driver_alive() {
  [ -n "$(driver_pids)" ]
}

wait_gone() {
  local deadline=$((SECONDS + $1))
  while driver_alive; do
    [ "$SECONDS" -lt "$deadline" ] || return 1
    sleep 0.2
  done
}

# Ends every xcodebuild of this working directory: a polite stop file first, then TERM, then KILL.
kill_driver() {
  driver_alive || { rm -f "$PIDFILE"; return 0; }
  touch "$WORK/stop"
  wait_gone 20 || {
    # shellcheck disable=SC2046
    kill $(driver_pids) 2>/dev/null
    wait_gone 10 || {
      # shellcheck disable=SC2046
      kill -9 $(driver_pids) 2>/dev/null
      wait_gone 5
    }
  }
  local rc=$?
  rm -f "$PIDFILE"
  return $rc
}

xcb() {
  xcodebuild -project "$PROJECT" -scheme Driver -sdk iphonesimulator \
    -derivedDataPath "$DERIVED" "$@" CODE_SIGNING_ALLOWED=NO
}

cmd_build() {
  need_udid "${1:-}"
  driver_alive && die "a driver is running from $WORK, run: driver.sh stop"
  mkdir -p "$WORK/project" || die "cannot create $WORK/project"
  rm -rf "$WORK/project/Driver" "$WORK/project/DriverUITests" "$PROJECT"
  cp -R "$HERE/Driver" "$HERE/DriverUITests" "$WORK/project/" || die "could not copy sources to $WORK/project"
  ruby "$HERE/gen.rb" "$WORK/project" "$WORK" || die "project generation failed"
  xcb -destination "platform=iOS Simulator,id=$1" build-for-testing > "$WORK/build.log" 2>&1 \
    || { tail -n 30 "$WORK/build.log" >&2; die "build-for-testing failed, full log: $WORK/build.log"; }
  echo "built: $DERIVED"
}

cmd_start() {
  need_udid "${1:-}"
  [ -d "$DERIVED" ] || die "nothing built in $WORK, run: driver.sh build $1"
  xcrun simctl list devices booted | grep -qF "$1" \
    || die "simulator $1 is not booted (xcrun simctl boot $1)"
  driver_alive && die "a driver is already running, run: driver.sh stop"
  rm -f "$WORK/cmd.txt" "$WORK/stop" "$WORK"/res-*.txt
  nohup xcodebuild -project "$PROJECT" -scheme Driver -sdk iphonesimulator \
    -derivedDataPath "$DERIVED" -destination "platform=iOS Simulator,id=$1" \
    test-without-building -only-testing:DriverUITests/DriverUITests/testDrive \
    CODE_SIGNING_ALLOWED=NO > "$LOG" 2>&1 < /dev/null &
  echo $! > "$PIDFILE"
  local deadline=$((SECONDS + START_TIMEOUT))
  while [ ! -f "$WORK/res-ready.txt" ]; do
    if ! driver_alive; then
      tail -n 30 "$LOG" >&2
      rm -f "$PIDFILE"
      die "xcodebuild exited before the driver answered, full log: $LOG"
    fi
    if [ "$SECONDS" -ge "$deadline" ]; then
      tail -n 30 "$LOG" >&2
      kill_driver
      die "driver did not answer within ${START_TIMEOUT}s (WHIM_IOS_DRIVER_START_TIMEOUT), log: $LOG"
    fi
    sleep 0.5
  done
  echo "driver ready (pid $(cat "$PIDFILE"))"
}

cmd_cmd() {
  [ $# -ge 1 ] || die "usage: driver.sh cmd <verb> [args...]"
  driver_alive || die "no driver running (working directory $WORK), run: driver.sh start <udid>"
  local id out deadline
  id="$(date +%s)-$$-$RANDOM"
  printf '%s %s\n' "$id" "$*" >> "$WORK/cmd.txt"
  deadline=$((SECONDS + CMD_TIMEOUT))
  while [ "$SECONDS" -lt "$deadline" ]; do
    if [ -f "$WORK/res-$id.txt" ]; then
      out=$(cat "$WORK/res-$id.txt")
      printf '%s\n' "$out"
      case $out in
        notfound* | "unknown verb"* | usage:* | app-not-foreground* | no-snapshot*) exit 3 ;;
      esac
      return 0
    fi
    driver_alive || die "the driver exited while waiting for the reply to '$*', log: $LOG"
    sleep 0.2
  done
  die "no reply to '$*' within ${CMD_TIMEOUT}s (WHIM_IOS_DRIVER_TIMEOUT), log: $LOG"
}

cmd_stop() {
  if ! driver_alive; then
    rm -f "$PIDFILE"
    echo "no driver running"
    return 0
  fi
  kill_driver || die "xcodebuild is still running after kill, check: pgrep -fl xcodebuild"
  echo "driver stopped"
}

cmd_shot() {
  need_udid "${1:-}"
  [ -n "${2:-}" ] || die "usage: driver.sh shot <udid> <out.png>"
  xcrun simctl io "$1" screenshot "$2" || die "screenshot failed"
}

verb=${1:-}
[ $# -eq 0 ] || shift
case $verb in
  build) cmd_build "$@" ;;
  start) cmd_start "$@" ;;
  cmd) cmd_cmd "$@" ;;
  stop) cmd_stop ;;
  shot) cmd_shot "$@" ;;
  *) usage ;;
esac
