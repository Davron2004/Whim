#!/usr/bin/env bash
# Runs the no-spend load test against the deployed VM (design D26; specs/server-deployment "A load
# test measures capacity without spending provider credit"). Three subcommands:
#
#   deploy/loadtest/run.sh start                                swap whim-server for the load-test image
#   deploy/loadtest/run.sh drive --devices <N> --cap <C> --queue-max <Q> [--json <file>]   drive it, print the report
#   deploy/loadtest/run.sh stop                                 restore production whim-server, then smoke
#
# `start` refuses unless the checkout's HEAD is the tag currently deployed on the VM — the load test
# must measure the exact commit that is live, never a local edit. It builds the load-test image only
# when Artifact Registry lacks it, drains and stops the production `whim-server`, wipes and re-owns
# the load-test data directory, then starts the load-test image under the SAME compose service name
# and network, so Caddy's already-configured API site starts serving it at once. The API answers no
# real request for the duration — there are none yet (design D26).
set -euo pipefail

WHIM_SCRIPT=run.sh
WHIM_USAGE='usage: deploy/loadtest/run.sh start|stop
       deploy/loadtest/run.sh drive --devices <N> --cap <C> --queue-max <Q> [--json <file>]'
# shellcheck source=deploy/lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

readonly WHIM_LOADTEST_DIR="$WHIM_DEPLOY_DIR/loadtest"
readonly WHIM_LOADTEST_VM_DIR="$WHIM_VM_APP_DIR/loadtest"
readonly WHIM_LOADTEST_DATA_DIR=/mnt/disks/whim-data/loadtest
readonly WHIM_LOADTEST_SAMPLE_INTERVAL_S=2

whim_loadtest_image_ref() {
  printf '%s-docker.pkg.dev/%s/%s/server-loadtest:%s' "$WHIM_GCP_REGION" "$WHIM_GCP_PROJECT" "$WHIM_REGISTRY_REPO" "$1"
}

# Prints the tag portion of the currently-deployed `WHIM_IMAGE`, or nothing if the VM has never
# been deployed.
whim_deployed_tag() {
  whim_vm_ssh "sudo test -f $WHIM_VM_APP_DIR/.env && sudo grep '^WHIM_IMAGE=' $WHIM_VM_APP_DIR/.env || true" \
    | sed -e 's/^WHIM_IMAGE=//' -e 's/.*://'
}

cmd_start() {
  whim_load_values
  whim_require_values WHIM_GCP_PROJECT WHIM_GCP_REGION WHIM_GCP_ZONE
  command -v git >/dev/null 2>&1 || whim_fail "git is not on PATH"

  local status head deployed image
  status="$(git -C "$WHIM_REPO_ROOT" status --porcelain)"
  [ -z "$status" ] || whim_fail "the working tree has uncommitted or untracked changes; commit them first. Nothing was changed."
  head="$(git -C "$WHIM_REPO_ROOT" rev-parse HEAD)"
  deployed="$(whim_deployed_tag)" || whim_fail "cannot read the deployed image tag from the VM"
  [ -n "$deployed" ] || whim_fail "the VM reports no deployed image; run deploy/deploy.sh first"
  [ "$head" = "$deployed" ] \
    || whim_fail "HEAD ($head) is not the deployed tag ($deployed); check out the deployed commit before load-testing it"

  image="$(whim_loadtest_image_ref "$head")"
  if ! whim_gcloud artifacts docker images describe "$image" >/dev/null 2>&1; then
    echo "==> cloud build $image"
    whim_gcloud builds submit "$WHIM_REPO_ROOT" --region "$WHIM_GCP_REGION" --config "$WHIM_LOADTEST_DIR/cloudbuild.yaml" \
      --substitutions "COMMIT_SHA=$head,_REGION=$WHIM_GCP_REGION"
  else
    echo "image: $image (already built)"
  fi

  echo "==> upload the load-test compose override"
  whim_gcloud compute scp --zone "$WHIM_GCP_ZONE" --tunnel-through-iap --quiet \
    "$WHIM_LOADTEST_DIR/compose.loadtest.yaml" "$WHIM_VM_NAME:/tmp/whim-loadtest-compose.yaml"

  echo "==> drain production, wipe the load-test data directory, start the load-test image"
  remote_output=""
  if remote_output="$(whim_vm_ssh "set -eu
stopped=0
cleanup() {
  trap - EXIT
  cleanup_error=0
  if ! $WHIM_COMPOSE stop whim-server; then
    echo 'run.sh: recovery failed while stopping the replay service' >&2
    cleanup_error=1
  fi
  if ! $WHIM_COMPOSE up -d --wait --wait-timeout 300 whim-server; then
    echo 'run.sh: recovery failed while restoring the production service' >&2
    cleanup_error=1
  fi
  return \$cleanup_error
}
on_exit() {
  original_rc=\$?
  cleanup_rc=0
  if [ "\$stopped" -eq 1 ]; then cleanup || cleanup_rc=\$?; fi
  exit \$original_rc
}
trap on_exit EXIT
sudo install -d -m 0755 -o root -g root '$WHIM_LOADTEST_VM_DIR'
sudo install -m 0644 -o root -g root /tmp/whim-loadtest-compose.yaml '$WHIM_LOADTEST_VM_DIR/compose.loadtest.yaml'
rm -f /tmp/whim-loadtest-compose.yaml
$WHIM_COMPOSE stop whim-server
stopped=1
sudo rm -rf '$WHIM_LOADTEST_DATA_DIR'
sudo install -d -m 0700 -o 10001 -g 10001 '$WHIM_LOADTEST_DATA_DIR'
if sudo -H env WHIM_LOADTEST_IMAGE='$image' ${WHIM_COMPOSE#sudo -H } -f '$WHIM_VM_APP_DIR/compose.yaml' -f '$WHIM_LOADTEST_VM_DIR/compose.loadtest.yaml' up -d --wait --wait-timeout 300 whim-server; then
  :
else
  compose_rc=\$?
  echo 'run.sh: load-test compose start failed' >&2
  exit "\$compose_rc"
fi
attempt=0
while [ \"\$attempt\" -lt 60 ]; do
  if $WHIM_COMPOSE exec -T whim-server node -e \"fetch('http://127.0.0.1:8787/healthz').then((r)=>r.json()).then((j)=>process.exit(j.service==='whim-server-loadtest'?0:1),()=>process.exit(1))\"; then
    stopped=0
    exit 0
  fi
  attempt=\$((attempt + 1))
  sleep 2
done
echo 'run.sh: load-test health check failed: the server never reported whim-server-loadtest on /healthz' >&2
exit 1")"; then
    [ -z "$remote_output" ] || printf '%s\n' "$remote_output"
  else
    remote_rc=$?
    echo "run.sh: load-test start failed (exit $remote_rc); verifying restored production service" >&2
    if ! bash "$WHIM_DEPLOY_DIR/smoke.sh"; then echo 'run.sh: recovery failed while running production smoke' >&2; fi
    [ -z "$remote_output" ] || printf '%s\n' "$remote_output"
    exit "$remote_rc"
  fi
  echo "run.sh: the load-test server is live behind https://${WHIM_API_HOST:-<WHIM_API_HOST unset>}"
}

cmd_drive() {
  whim_load_values
  whim_require_values WHIM_GCP_PROJECT WHIM_GCP_REGION WHIM_GCP_ZONE WHIM_API_HOST

  local devices="" cap="" queue_max="" json=""
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --devices)
        [ "$#" -ge 2 ] || whim_usage_error "--devices needs a number"
        devices="$2"
        shift 2
        ;;
      --cap)
        [ "$#" -ge 2 ] || whim_usage_error "--cap needs a number"
        cap="$2"
        shift 2
        ;;
      --queue-max)
        [ "$#" -ge 2 ] || whim_usage_error "--queue-max needs a number"
        queue_max="$2"
        shift 2
        ;;
      --json)
        [ "$#" -ge 2 ] || whim_usage_error "--json needs a file path"
        json="$2"
        shift 2
        ;;
      *) whim_usage_error "unknown argument: $1" ;;
    esac
  done
  [[ "$devices" =~ ^[0-9]+$ ]] || whim_usage_error "--devices must be a positive integer"
  [[ "$cap" =~ ^[0-9]+$ ]] || whim_usage_error "--cap must be a positive integer"
  [[ "$queue_max" =~ ^[0-9]+$ ]] || whim_usage_error "--queue-max must be the server's WHIM_QUEUE_MAX, 0 or more"

  local stats sampler_pid="" monitor_was_set=0
  stats="$(mktemp)"
  cleanup() {
    if [ -n "$sampler_pid" ]; then
      kill -TERM -- "-$sampler_pid" >/dev/null 2>&1 || true
      wait "$sampler_pid" >/dev/null 2>&1 || true
    fi
    rm -f "$stats"
  }
  trap cleanup EXIT

  echo "==> sampling docker stats on the VM every ${WHIM_LOADTEST_SAMPLE_INTERVAL_S}s" >&2
  # CPU% and MEM% only — both are `docker stats`-native percentages, so the sampler needs no
  # byte-unit conversion in bash. `server/src/loadtest/drive.ts#parseStatsCsv` reads this shape.
  case "$-" in *m*) monitor_was_set=1 ;; esac
  set -m
  whim_vm_ssh "container=\$($WHIM_COMPOSE ps -q whim-server)
while sudo docker inspect -f '{{.State.Running}}' \"\$container\" >/dev/null 2>&1; do
  sample=\$(sudo docker stats \"\$container\" --no-stream --format '{{.CPUPerc}},{{.MemPerc}}') || exit
  printf '%s\\n' \"\$sample\" | tr -d '%' || exit
  sleep $WHIM_LOADTEST_SAMPLE_INTERVAL_S
done" >"$stats" 2>/dev/null &
  sampler_pid=$!
  [ "$monitor_was_set" -eq 1 ] || set +m

  local -a args=(node "$WHIM_REPO_ROOT/server/loadtest.mjs" --target "https://$WHIM_API_HOST" --devices "$devices" --cap "$cap" --queue-max "$queue_max" --stats "$stats")
  [ -z "$json" ] || args+=(--json "$json")
  local driver_status=0
  "${args[@]}" || driver_status=$?
  cleanup
  trap - EXIT
  return "$driver_status"
}

cmd_stop() {
  whim_load_values
  whim_require_values WHIM_GCP_PROJECT WHIM_GCP_REGION WHIM_GCP_ZONE
  echo "==> restoring the production whim-server"
  whim_vm_ssh "$WHIM_COMPOSE up -d --wait --wait-timeout 300 whim-server"
  echo "==> smoke"
  bash "$WHIM_DEPLOY_DIR/smoke.sh"
}

[ "$#" -ge 1 ] || whim_usage_error "missing subcommand"
subcommand="$1"
shift
case "$subcommand" in
  start) cmd_start "$@" ;;
  drive) cmd_drive "$@" ;;
  stop) cmd_stop "$@" ;;
  *) whim_usage_error "unknown subcommand: $subcommand" ;;
esac
