#!/usr/bin/env bash
# Moves the Whim VM to a named capacity profile (design D25):
#
#   deploy/resize.sh --profile event      before the event
#   deploy/resize.sh --profile standard   after it
#
# In order: check the region's E2 vCPU quota (changing nothing if it doesn't fit), drain and stop the
# server container, stop the VM, set its machine type, start it, confirm the type, then redeploy the
# running image tag, which writes the matching profile and runs smoke. A container stopped this way
# stays stopped across the VM restart, so the server never runs on the old limits. When a step after
# the drain fails, the script starts the VM on the type it has, redeploys that type's profile, and
# exits non-zero naming the step.
set -euo pipefail

WHIM_SCRIPT=resize.sh
WHIM_USAGE='usage: deploy/resize.sh --profile <name>'
# shellcheck source=deploy/lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

profile=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --profile)
      [ "$#" -ge 2 ] || whim_usage_error "--profile needs a name"
      profile="$2"
      shift 2
      ;;
    *) whim_usage_error "unknown argument: $1" ;;
  esac
done
[ -n "$profile" ] || whim_usage_error "--profile is required"
profile_file="$(whim_profile_file "$profile")"
if ! [[ "$profile" =~ ^[a-z0-9-]+$ ]] || [ ! -f "$profile_file" ]; then
  whim_fail "no profile named $profile in deploy/profiles/"
fi

whim_load_values
whim_require_values WHIM_GCP_PROJECT WHIM_GCP_REGION WHIM_GCP_ZONE
whim_profile_lookup "$profile_file" WHIM_PROFILE_MACHINE_TYPE
readonly target_type="$WHIM_PROFILE_FOUND_VALUE"
[ -n "$target_type" ] || whim_fail "profile $profile sets no WHIM_PROFILE_MACHINE_TYPE"

current_type="$(whim_vm_machine_type)" || whim_fail "cannot read the machine type of VM $WHIM_VM_NAME. Nothing was changed."
if [ "$current_type" = "$target_type" ]; then
  echo "resize.sh: $WHIM_VM_NAME already runs $target_type (profile $profile); nothing to change"
  exit 0
fi

# The image tag the VM runs now, from the compose .env deploy.sh wrote.
compose_env="$(whim_vm_ssh "sudo cat $WHIM_VM_APP_DIR/.env")" \
  || whim_fail "cannot read $WHIM_VM_APP_DIR/.env on the VM. Nothing was changed."
running_image=""
while IFS= read -r line; do
  case "$line" in
    WHIM_IMAGE=*) running_image="${line#WHIM_IMAGE=}" ;;
  esac
done <<<"$compose_env"
readonly running_tag="${running_image##*:}"
[[ "$running_tag" =~ ^[0-9a-f]{40}$ ]] \
  || whim_fail "cannot read the running image tag from $WHIM_VM_APP_DIR/.env (WHIM_IMAGE=$running_image). Nothing was changed."

echo "==> quota"
needed_vcpus="$(whim_machine_type_vcpus "$target_type")"
current_vcpus="$(whim_machine_type_vcpus "$current_type")"
extra_vcpus=$((needed_vcpus - current_vcpus))
if [ "$extra_vcpus" -gt 0 ]; then
  quotas="$(whim_gcloud compute regions describe "$WHIM_GCP_REGION" --flatten=quotas \
    --format='csv[no-heading](quotas.metric,quotas.limit,quotas.usage)')" \
    || whim_fail "cannot read the quotas of region $WHIM_GCP_REGION. Nothing was changed."
  e2_quota="$(printf '%s\n' "$quotas" | awk -F, '$1 == "E2_CPUS" { print $2 " " $3; exit }')"
  [ -n "$e2_quota" ] || whim_fail "region $WHIM_GCP_REGION reports no E2_CPUS quota. Nothing was changed."
  read -r quota_limit quota_usage <<<"$e2_quota"
  awk -v limit="$quota_limit" -v usage="$quota_usage" -v extra="$extra_vcpus" 'BEGIN { exit !(usage + extra <= limit) }' \
    || whim_fail "region $WHIM_GCP_REGION E2 vCPU quota is $quota_limit with $quota_usage in use; $target_type needs $extra_vcpus more. Nothing was changed."
fi
echo "quota fits $target_type"

# Starts the VM on whatever type it has, redeploys that type's profile, and exits naming the step.
recover() {
  local failed="$1" actual
  printf 'resize.sh: step %s failed; starting the VM on its current machine type and redeploying that profile\n' "$failed" >&2
  whim_gcloud compute instances start "$WHIM_VM_NAME" --zone "$WHIM_GCP_ZONE" \
    || whim_fail "step $failed failed, and starting the VM failed too; the VM may be stopped"
  whim_wait_for_ssh "recovery start" \
    || whim_fail "step $failed failed, and recovery start readiness failed; the VM may be unreachable"
  actual="$(whim_vm_machine_type)" || whim_fail "step $failed failed, and the VM's machine type is unreadable"
  bash "$WHIM_DEPLOY_DIR/deploy.sh" --tag "$running_tag" \
    || whim_fail "step $failed failed, and the recovery deploy on $actual failed too; rerun deploy/deploy.sh --tag $running_tag"
  whim_fail "step $failed failed; the VM runs $actual with that type's profile and smoke passed"
}

run_step() {
  local name="$1"
  shift
  echo "==> $name"
  "$@" || recover "$name"
}

run_step drain whim_vm_ssh "$WHIM_COMPOSE stop whim-server"
run_step stop whim_gcloud compute instances stop "$WHIM_VM_NAME" --zone "$WHIM_GCP_ZONE"
run_step set-machine-type whim_gcloud compute instances set-machine-type "$WHIM_VM_NAME" --zone "$WHIM_GCP_ZONE" \
  --machine-type "$target_type"
start_vm() {
  whim_gcloud compute instances start "$WHIM_VM_NAME" --zone "$WHIM_GCP_ZONE" \
    && whim_wait_for_ssh start
}
run_step start start_vm
echo "==> confirm"
confirmed_type="$(whim_vm_machine_type)" || recover confirm
[ "$confirmed_type" = "$target_type" ] || recover confirm
echo "==> deploy"
bash "$WHIM_DEPLOY_DIR/deploy.sh" --tag "$running_tag" \
  || whim_fail "step deploy failed on $target_type; rerun deploy/deploy.sh --tag $running_tag"
echo "resize.sh: $WHIM_VM_NAME runs $target_type with profile $profile"
