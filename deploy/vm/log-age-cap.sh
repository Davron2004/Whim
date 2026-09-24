#!/usr/bin/env bash
# Age cap on the containers' json-file logs (legal-surface-v2). The privacy policy deletes connection
# data and logs within 90 days, but compose.yaml rotates Docker's logs by size only. Run daily by
# whim-log-age-cap.timer, which bootstrap.sh installs with this script as /usr/local/sbin/whim-log-age-cap.sh.
#
# Touches only <root>/<container>/<id>-json.log and its rotated <id>-json.log.N files, where <root>
# is /var/lib/docker/containers (LOG_AGE_CAP_ROOT overrides it, for the acceptance suite only):
#   - a rotated file last written more than MAX_AGE_DAYS ago is deleted;
#   - in every other file, the leading lines whose `time` is more than MAX_AGE_DAYS old are removed
#     in place. The inode is kept: Docker holds the active file open with O_APPEND.
# A line whose `time` can't be read never moves the cut, so a file with no readable line is untouched.
set -euo pipefail

# The daily timer runs at most a day apart, so a line lives at most MAX_AGE_DAYS + 1 days: within the
# 90 days the disclosure manifest publishes for connection logs.
readonly MAX_AGE_DAYS=89
readonly CONTAINERS_ROOT="${LOG_AGE_CAP_ROOT:-/var/lib/docker/containers}"

# Prints how many leading lines are older than `cutoff` (epoch seconds): the lines up to the last
# readable old line before the first readable recent one. Docker writes `time` last, as RFC 3339 UTC.
readonly OLD_PREFIX_LINES='
function epoch(ts,    y, m, d, era, yoe, doy, doe) {
  y = substr(ts, 1, 4) + 0; m = substr(ts, 6, 2) + 0; d = substr(ts, 9, 2) + 0
  if (m <= 2) y -= 1
  era = int(y / 400); yoe = y - era * 400
  doy = int((153 * (m > 2 ? m - 3 : m + 9) + 2) / 5) + d - 1
  doe = yoe * 365 + int(yoe / 4) - int(yoe / 100) + doy
  return (era * 146097 + doe - 719468) * 86400 + substr(ts, 12, 2) * 3600 + substr(ts, 15, 2) * 60 + substr(ts, 18, 2)
}
match($0, /"time":"[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9][.0-9]*Z"}$/) {
  if (epoch(substr($0, RSTART + 8, 19)) >= cutoff) exit
  drop = NR
}
END { print drop + 0 }
'

inode_of() {
  local path="$1"
  ls -di "$path" | awk '{ print $1 }'
}

# Removes the file's old leading lines without replacing it. Lines Docker appends while the kept tail
# is copied are caught up just before the truncate; one appended between that catch-up and the
# truncate is lost. One appended between the truncate and the single O_APPEND write of the tail lands
# ahead of it, whole: the write is one syscall, so the two never interleave.
prune_old_lines() {
  local log="$1" drop dropped_bytes inode kept tail="$work/tail"
  drop="$(LC_ALL=C awk -v cutoff="$cutoff" "$OLD_PREFIX_LINES" "$log")"
  [[ "$drop" -gt 0 ]] || return 0
  inode="$(inode_of "$log")"
  dropped_bytes=$(($(head -n "$drop" "$log" | wc -c)))
  tail -c +"$((dropped_bytes + 1))" "$log" >"$tail"
  kept=$(($(wc -c <"$tail")))
  tail -c +"$((dropped_bytes + kept + 1))" "$log" >>"$tail"
  kept=$(($(wc -c <"$tail")))
  if [[ "$(inode_of "$log")" != "$inode" ]]; then
    printf 'log-age-cap: %s rotated during the run; the next run prunes it\n' "$log" >&2
    return 0
  fi
  : >"$log"
  if [[ "$kept" -gt 0 ]]; then
    dd if="$tail" bs="$kept" count=1 2>/dev/null >>"$log"
  fi
  printf 'log-age-cap: removed %s lines older than %s days from %s\n' "$drop" "$MAX_AGE_DAYS" "$log"
}

if [[ ! -d "$CONTAINERS_ROOT" ]]; then
  printf 'log-age-cap: %s does not exist; nothing to do\n' "$CONTAINERS_ROOT"
  exit 0
fi

cutoff=$(($(date -u +%s) - MAX_AGE_DAYS * 86400))
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

find "$CONTAINERS_ROOT" -mindepth 2 -maxdepth 2 -type f -name '*-json.log.[0-9]*' \
  -mmin +"$((MAX_AGE_DAYS * 1440))" -print -delete

for log in "$CONTAINERS_ROOT"/*/*-json.log "$CONTAINERS_ROOT"/*/*-json.log.[0-9]*; do
  if [[ -f "$log" ]] && [[ ! -L "$log" ]]; then
    prune_old_lines "$log"
  fi
done
