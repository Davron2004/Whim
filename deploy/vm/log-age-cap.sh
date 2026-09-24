#!/usr/bin/env bash
# Age cap on the containers' json-file logs (legal-surface-v2). The privacy policy deletes connection
# data and logs within 90 days, but compose.yaml rotates Docker's logs by size only. Run daily by
# whim-log-age-cap.timer, which bootstrap.sh installs with this script as /usr/local/sbin/whim-log-age-cap.sh.
#
# Looks only at <root>/<container>/<id>-json.log and its rotated <id>-json.log.N files, where <root>
# is /var/lib/docker/containers (LOG_AGE_CAP_ROOT overrides it, for the acceptance suite only):
#   - a rotated file last written more than MAX_AGE_DAYS ago is deleted;
#   - in any other rotated file, the leading lines whose `time` is more than MAX_AGE_DAYS old are
#     removed in place. Nothing tails rotated files: the Ops Agent (ops-agent.yaml) reads *-json.log only;
#   - the active <id>-json.log is never edited. The Ops Agent tails it, and a tailer re-reads a file
#     that shrinks below its offset from the start, shipping every kept line again. When it holds a
#     line older than MAX_AGE_DAYS, the container's compose service is recreated instead: Docker
#     starts it with a new id and a new log, and removes the old container's directory, logs and all.
#     That service is down for a few seconds; only a service with no deploy for MAX_AGE_DAYS gets there.
# A line whose `time` can't be read never counts as old, so a file with no readable line is neither
# edited nor the cause of a recreate. A container that isn't a service of the whim compose project
# is reported and fails the run, since its log can't be capped.
set -euo pipefail

# The daily timer runs at most a day apart, so a line lives at most MAX_AGE_DAYS + 1 days: within the
# 90 days the disclosure manifest publishes for connection logs.
readonly MAX_AGE_DAYS=89
readonly CONTAINERS_ROOT="${LOG_AGE_CAP_ROOT:-/var/lib/docker/containers}"
# Where deploy.sh installs compose.yaml and its .env (deploy/lib.sh, WHIM_VM_APP_DIR), and the project name it sets.
readonly COMPOSE_DIR=/opt/whim COMPOSE_PROJECT=whim

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

failed=0
over_cap_services=""

report_failure() {
  printf 'log-age-cap: %s\n' "$1" >&2
  failed=1
}

# Sets `drop` to the file's count of old leading lines; fails when the file can't be read.
count_old_lines() {
  drop="$(LC_ALL=C awk -v cutoff="$cutoff" "$OLD_PREFIX_LINES" "$1")" && [[ "$drop" =~ ^[0-9]+$ ]]
}

inode_of() {
  local path="$1"
  ls -di "$path" | awk '{ print $1 }'
}

# Removes a rotated file's old leading lines. Docker never appends to a rotated file, but its next
# rotation renames it; a file renamed while the tail is copied is left for the next run.
prune_old_lines() {
  local log="$1" dropped_bytes inode kept tail="$work/tail"
  if ! count_old_lines "$log"; then
    report_failure "cannot read $log"
    return 0
  fi
  [[ "$drop" -gt 0 ]] || return 0
  inode="$(inode_of "$log")"
  dropped_bytes=$(($(head -n "$drop" "$log" | wc -c)))
  tail -c +"$((dropped_bytes + 1))" "$log" >"$tail"
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

# Queues the compose service of a container whose active log holds a line older than the cap.
mark_over_cap() {
  local log="$1" id labels project service
  if ! count_old_lines "$log"; then
    report_failure "cannot read $log; its container is left as it is"
    return 0
  fi
  [[ "$drop" -gt 0 ]] || return 0
  id="$(basename "$(dirname "$log")")"
  if ! labels="$(docker inspect --type container \
    --format '{{ index .Config.Labels "com.docker.compose.project" }} {{ index .Config.Labels "com.docker.compose.service" }}' "$id")"; then
    report_failure "container $id holds lines older than $MAX_AGE_DAYS days, but docker cannot inspect it"
    return 0
  fi
  read -r project service <<<"$labels" || true
  if [[ "$project" != "$COMPOSE_PROJECT" ]] || ! [[ "${service:-}" =~ ^[a-z0-9][a-z0-9_-]*$ ]]; then
    report_failure "container $id holds lines older than $MAX_AGE_DAYS days, but is no service of compose project $COMPOSE_PROJECT (labels: '$labels')"
    return 0
  fi
  printf 'log-age-cap: container %s (service %s) holds %s lines older than %s days in its active log\n' \
    "$id" "$service" "$drop" "$MAX_AGE_DAYS"
  case " $over_cap_services " in
    *" $service "*) ;;
    *) over_cap_services="$over_cap_services $service" ;;
  esac
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

for log in "$CONTAINERS_ROOT"/*/*-json.log.[0-9]*; do
  if [[ -f "$log" ]] && [[ ! -L "$log" ]]; then
    prune_old_lines "$log"
  fi
done

for log in "$CONTAINERS_ROOT"/*/*-json.log; do
  if [[ -f "$log" ]] && [[ ! -L "$log" ]]; then
    mark_over_cap "$log"
  fi
done

for service in $over_cap_services; do
  if docker compose --project-directory "$COMPOSE_DIR" --file "$COMPOSE_DIR/compose.yaml" \
    up -d --force-recreate --no-deps "$service"; then
    printf 'log-age-cap: recreated service %s: its new container starts an empty log, and the old one went with its logs\n' "$service"
  else
    report_failure "recreating service $service failed; its active log still holds lines older than $MAX_AGE_DAYS days"
  fi
done

exit "$failed"
