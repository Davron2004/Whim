#!/usr/bin/env bash
# Shared by deploy/provision.sh, deploy.sh, smoke.sh and resize.sh. Sourced, never run. Everything
# here runs on the operator's machine, so it stays compatible with macOS's bash 3.2.
set -euo pipefail

WHIM_DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WHIM_REPO_ROOT="$(cd "$WHIM_DEPLOY_DIR/.." && pwd)"
readonly WHIM_DEPLOY_DIR WHIM_REPO_ROOT

# Fixed GCP resource names (design D17, D24).
readonly WHIM_VM_NAME=whim-vm
readonly WHIM_VM_SERVICE_ACCOUNT_NAME=whim-vm
readonly WHIM_DATA_DISK_NAME=whim-data
readonly WHIM_NETWORK_NAME=whim-net
readonly WHIM_SUBNET_NAME=whim-subnet
readonly WHIM_REGISTRY_REPO=whim
readonly WHIM_OPENROUTER_SECRET_ID=whim-openrouter-api-key
readonly WHIM_RUNBOOK_KEY_SECTION='docs/deploy.md, section "OpenRouter key"'

# Fixed VM paths (design D21, D24).
readonly WHIM_VM_APP_DIR=/opt/whim
readonly WHIM_VM_ETC_DIR=/etc/whim
readonly WHIM_VM_SITE_DIR=/mnt/disks/whim-data/site
readonly WHIM_COMPOSE="sudo -H docker compose --project-directory /opt/whim --file /opt/whim/compose.yaml"

# Every deploy-time value, in the order the operator reads them (design D20, D24).
readonly WHIM_VALUE_KEYS="WHIM_GCP_PROJECT WHIM_GCP_REGION WHIM_GCP_ZONE WHIM_STATIC_IP WHIM_API_HOST WHIM_WEB_HOST WHIM_SUPPORT_EMAIL WHIM_ENGINEER_MODEL WHIM_REWRITE_MODEL WHIM_CLARIFY_MODEL WHIM_SUMMARY_MODEL WHIM_PLAN_MODEL WHIM_REPAIR_MODEL WHIM_CLARIFY_REASONING WHIM_REWRITE_REASONING WHIM_SUMMARY_REASONING WHIM_PLAN_REASONING WHIM_ENGINEER_REASONING WHIM_REPAIR_REASONING WHIM_PROVIDER_SORT WHIM_PROVIDER_QUANTIZATIONS WHIM_QUEUE_MAX WHIM_QUEUE_MAX_WAIT_MS WHIM_MIN_BUILD_IOS WHIM_MIN_BUILD_ANDROID WHIM_USAGE_IDLE_DAYS WHIM_BETA_LIMIT_PER_CLIENT_HOUR WHIM_BETA_LIMIT_PER_DAY WHIM_APP_STORE_URL WHIM_PLAY_STORE_URL WHIM_ALERT_EMAIL WHIM_BILLING_ACCOUNT WHIM_MONTHLY_BUDGET"

# The profile keys that are not server environment (design D25).
readonly WHIM_PROFILE_HOST_KEYS="WHIM_PROFILE_MACHINE_TYPE WHIM_SERVER_MEM_LIMIT WHIM_SERVER_SHM_SIZE"

whim_fail() {
  printf '%s: %s\n' "${WHIM_SCRIPT:-deploy}" "$1" >&2
  exit 1
}

whim_usage_error() {
  printf '%s: %s\n' "${WHIM_SCRIPT:-deploy}" "$1" >&2
  printf '%s\n' "$WHIM_USAGE" >&2
  exit 2
}

whim_word_in() {
  case " $2 " in
    *" $1 "*) return 0 ;;
    *) return 1 ;;
  esac
}

# Reads NAME=value lines. Values are literal: no quoting, no expansion, no command execution.
# Calls `$2 <name> <value> <file:line>` for each assignment.
whim_read_env_lines() {
  local file="$1" callback="$2" line key number=0
  while IFS= read -r line || [ -n "$line" ]; do
    number=$((number + 1))
    case "$line" in
      '' | '#'*) continue ;;
    esac
    key="${line%%=*}"
    if [ "$key" = "$line" ] || ! [[ "$key" =~ ^[A-Z][A-Z0-9_]*$ ]]; then
      whim_fail "$file:$number: expected NAME=value"
    fi
    "$callback" "$key" "${line#*=}" "$file:$number"
  done <"$file"
}

whim_set_value_from_file() {
  whim_word_in "$1" "$WHIM_VALUE_KEYS" || whim_fail "$3: unknown variable $1"
  whim_word_in "$1" "$WHIM_ENV_LOCKED" && return 0
  printf -v "$1" '%s' "$2"
}

# Loads deploy/defaults.env, then ~/.config/whim/deploy.env, then the process environment, later
# sources winning. Every known value ends up set (possibly empty).
whim_load_values() {
  local key operator_file="$HOME/.config/whim/deploy.env"
  WHIM_ENV_LOCKED=""
  for key in $WHIM_VALUE_KEYS; do
    if [ -n "${!key+set}" ]; then
      WHIM_ENV_LOCKED="$WHIM_ENV_LOCKED $key"
    else
      printf -v "$key" '%s' ""
    fi
  done
  whim_read_env_lines "$WHIM_DEPLOY_DIR/defaults.env" whim_set_value_from_file
  if [ -f "$operator_file" ]; then
    whim_read_env_lines "$operator_file" whim_set_value_from_file
  fi
}

# Refuses, naming every listed value that is empty.
whim_require_values() {
  local key missing=""
  for key in "$@"; do
    [ -n "${!key}" ] || missing="$missing $key"
  done
  if [ -n "$missing" ]; then
    for key in $missing; do
      printf '%s: missing required value %s (set it in ~/.config/whim/deploy.env; see deploy/operator.env.example)\n' \
        "${WHIM_SCRIPT:-deploy}" "$key" >&2
    done
    exit 1
  fi
}

whim_require_host_values() {
  local key
  for key in WHIM_API_HOST WHIM_WEB_HOST; do
    [[ "${!key}" =~ ^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$ ]] || whim_fail "$key is not a hostname: ${!key}"
  done
  [ "$WHIM_API_HOST" = "api.$WHIM_WEB_HOST" ] \
    || whim_fail "WHIM_API_HOST must be api.$WHIM_WEB_HOST (api. followed by WHIM_WEB_HOST), got $WHIM_API_HOST"
  [[ "$WHIM_STATIC_IP" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] || whim_fail "WHIM_STATIC_IP is not an IPv4 address: $WHIM_STATIC_IP"
}

whim_gcloud() {
  gcloud --project "$WHIM_GCP_PROJECT" "$@"
}

# Runs one command on the VM as the operator, over IAP. Standard input is passed through.
whim_vm_ssh() {
  whim_gcloud compute ssh "$WHIM_VM_NAME" --zone "$WHIM_GCP_ZONE" --tunnel-through-iap --quiet \
    --ssh-flag=-oServerAliveInterval=30 --ssh-flag=-oConnectTimeout=5 --command "$1"
}

whim_wait_for_ssh() {
  local step="$1" budget="${2:-180}" probe_timeout="${3:-10}" deadline remaining probe_budget sleep_for
  deadline=$((SECONDS + budget))
  while [ "$SECONDS" -lt "$deadline" ]; do
    remaining=$((deadline - SECONDS))
    probe_budget="$probe_timeout"
    [ "$probe_budget" -lt "$remaining" ] || probe_budget="$remaining"
    if WHIM_SSH_PROBE_TIMEOUT_MS=$((probe_budget * 1000)) node -e \
      'const { spawnSync } = require("node:child_process"); const args = process.argv.slice(1); const command = args.pop(); const result = spawnSync(args.shift(), [...args, "--command", command], { stdio: "ignore", timeout: Number(process.env.WHIM_SSH_PROBE_TIMEOUT_MS) || 10000 }); process.exit(result.error?.code === "ETIMEDOUT" ? 124 : (result.status ?? 1));' \
      gcloud --project "$WHIM_GCP_PROJECT" compute ssh "$WHIM_VM_NAME" --zone "$WHIM_GCP_ZONE" --tunnel-through-iap --quiet \
      --ssh-flag=-oServerAliveInterval=30 --ssh-flag=-oConnectTimeout="$probe_budget" ':'; then
      return 0
    fi
    remaining=$((deadline - SECONDS))
    [ "$remaining" -gt 0 ] || break
    sleep_for=5
    [ "$sleep_for" -lt "$remaining" ] || sleep_for="$remaining"
    sleep "$sleep_for"
  done
  printf '%s: step %s readiness failed: SSH did not become available within %s seconds\n' \
    "${WHIM_SCRIPT:-deploy}" "$step" "$budget" >&2
  return 1
}

whim_vm_machine_type() {
  whim_gcloud compute instances describe "$WHIM_VM_NAME" --zone "$WHIM_GCP_ZONE" \
    --format='value(machineType.basename())'
}

whim_image_ref() {
  printf '%s-docker.pkg.dev/%s/%s/server:%s' "$WHIM_GCP_REGION" "$WHIM_GCP_PROJECT" "$WHIM_REGISTRY_REPO" "$1"
}

whim_profile_file() {
  printf '%s/profiles/%s.env' "$WHIM_DEPLOY_DIR" "$1"
}

whim_capture_profile_value() {
  [ "$1" = "$WHIM_PROFILE_WANTED_KEY" ] && WHIM_PROFILE_FOUND_VALUE="$2"
  return 0
}

# Sets WHIM_PROFILE_FOUND_VALUE to one key's value in a profile file (empty when it isn't set).
whim_profile_lookup() {
  WHIM_PROFILE_WANTED_KEY="$2"
  WHIM_PROFILE_FOUND_VALUE=""
  whim_read_env_lines "$1" whim_capture_profile_value
}

# Prints the name of the one profile whose machine type equals $1, or nothing.
whim_profile_for_machine_type() {
  local file name match=""
  for file in "$WHIM_DEPLOY_DIR"/profiles/*.env; do
    [ -f "$file" ] || continue
    whim_profile_lookup "$file" WHIM_PROFILE_MACHINE_TYPE
    if [ "$WHIM_PROFILE_FOUND_VALUE" = "$1" ]; then
      name="$(basename "$file" .env)"
      [ -z "$match" ] || whim_fail "profiles $match and $name both name machine type $1"
      match="$name"
    fi
  done
  printf '%s' "$match"
}

# The vCPU count a machine type name carries (e2-standard-8 -> 8).
whim_machine_type_vcpus() {
  [[ "$1" =~ -([0-9]+)$ ]] || whim_fail "cannot read a vCPU count from machine type $1"
  printf '%s' "${BASH_REMATCH[1]}"
}
