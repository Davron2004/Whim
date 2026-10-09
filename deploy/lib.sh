#!/usr/bin/env bash
# Shared by deploy/provision.sh, deploy.sh, smoke.sh, resize.sh and deploy/cloudrun/{deploy,smoke}.sh.
# Sourced, never run. Everything
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
readonly WHIM_VALUE_KEYS="WHIM_GCP_PROJECT WHIM_GCP_REGION WHIM_RUN_REGION WHIM_GCP_ZONE WHIM_STATIC_IP WHIM_API_HOST WHIM_WEB_HOST WHIM_SUPPORT_EMAIL WHIM_ENGINEER_MODEL WHIM_REWRITE_MODEL WHIM_CLARIFY_MODEL WHIM_SUMMARY_MODEL WHIM_PLAN_MODEL WHIM_REPAIR_MODEL WHIM_CLARIFY_REASONING WHIM_REWRITE_REASONING WHIM_SUMMARY_REASONING WHIM_PLAN_REASONING WHIM_ENGINEER_REASONING WHIM_REPAIR_REASONING WHIM_PROVIDER_SORT WHIM_PROVIDER_QUANTIZATIONS WHIM_QUEUE_MAX WHIM_QUEUE_MAX_WAIT_MS WHIM_MIN_BUILD_IOS WHIM_MIN_BUILD_ANDROID WHIM_USAGE_IDLE_DAYS WHIM_BETA_LIMIT_PER_CLIENT_HOUR WHIM_BETA_LIMIT_PER_DAY WHIM_POLICY_ATTEMPT_TIMEOUT_MS WHIM_LIMIT_POLICY_CHECKS_PER_DEVICE_DAY WHIM_LIMIT_POLICY_CHECKS_PER_DAY WHIM_APP_STORE_URL WHIM_PLAY_STORE_URL WHIM_ALERT_EMAIL WHIM_BILLING_ACCOUNT WHIM_MONTHLY_BUDGET"

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

whim_require_hostnames() {
  local key
  for key in WHIM_API_HOST WHIM_WEB_HOST; do
    [[ "${!key}" =~ ^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$ ]] || whim_fail "$key is not a hostname: ${!key}"
  done
  [ "$WHIM_API_HOST" = "api.$WHIM_WEB_HOST" ] \
    || whim_fail "WHIM_API_HOST must be api.$WHIM_WEB_HOST (api. followed by WHIM_WEB_HOST), got $WHIM_API_HOST"
}

whim_require_host_values() {
  whim_require_hostnames
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

# Builds the Cloud Run pages site from this checkout into $1, with the values deploy/cloudrun/deploy.sh
# deploys it with. deploy/cloudrun/smoke.sh compares the association files the pages host serves
# against such a build.
whim_cloudrun_site_build() {
  local -a site_env=(env -u WHIM_APP_STORE_URL -u WHIM_PLAY_STORE_URL
    "WHIM_SUPPORT_EMAIL=$WHIM_SUPPORT_EMAIL" "WHIM_BETA_SIGNUP_URL=https://$WHIM_API_HOST/beta/signup"
    "WHIM_ENGINEER_MODEL=$WHIM_ENGINEER_MODEL" "WHIM_REWRITE_MODEL=$WHIM_REWRITE_MODEL")
  [[ -z "$WHIM_APP_STORE_URL" ]] || site_env+=("WHIM_APP_STORE_URL=$WHIM_APP_STORE_URL")
  [[ -z "$WHIM_PLAY_STORE_URL" ]] || site_env+=("WHIM_PLAY_STORE_URL=$WHIM_PLAY_STORE_URL")
  (cd "$WHIM_REPO_ROOT" && "${site_env[@]}" node server/site.mjs build --out "$1")
}

# ---------------------------------------------------------------------------------------------
# Monitoring (developer-observability D10, server-ops-hardening D5): the committed definitions in
# deploy/monitoring/, applied by deploy/provision.sh and by every plain deploy/cloudrun/deploy.sh.
# Callers set WHIM_MONITORING_WORK to a scratch directory. WHIM_FAIL_CONTEXT, when set, follows the
# message of any failed gcloud call.

readonly WHIM_MONITORING_DIR="$WHIM_DEPLOY_DIR/monitoring"
readonly WHIM_TAB=$'\t'

whim_monitoring_fail() {
  whim_fail "$1.${WHIM_FAIL_CONTEXT:+ $WHIM_FAIL_CONTEXT}"
}

# Renders a deploy/monitoring template into WHIM_MONITORING_WORK: each {{KEY}} named by a KEY VALUE
# pair is filled, then {{SPEC}} gets a fingerprint of everything else. Sets RENDERED_FILE and
# RENDERED_SPEC. The fingerprint covers the definition and every value in it, so it changes exactly
# when they do.
whim_monitoring_render() {
  local template="$1" text key value
  shift
  text="$(<"$template")"
  while [[ "$#" -gt 0 ]]; do
    key="$1" value="$2"
    shift 2
    text="${text//\{\{$key\}\}/$value}"
  done
  RENDERED_SPEC="$(printf '%s' "$text" | git hash-object --stdin)"
  text="${text//\{\{SPEC\}\}/$RENDERED_SPEC}"
  case "$text" in
    *'{{'*) whim_monitoring_fail "$template: a {{placeholder}} is left unfilled" ;;
    *) ;;
  esac
  RENDERED_FILE="$WHIM_MONITORING_WORK/$(basename "$template")"
  printf '%s\n' "$text" >"$RENDERED_FILE"
}

# The top-level displayName of a deploy/monitoring JSON file (two-space indent, one key per line).
whim_display_name_of() {
  local name file="$1"
  name="$(sed -n 's/^  "displayName": "\([^"]*\)",$/\1/p' "$file")"
  [[ -n "$name" ]] || whim_fail "$file has no top-level displayName"
  printf '%s' "$name"
}

# Finds the one line of $2 (tab-separated: display name, name, fingerprint, extra) whose display
# name is $1, and sets ROW_NAME, ROW_SPEC and ROW_EXTRA from it (all empty when there is none). Two
# resources under one display name can't be told apart, so that refuses.
whim_find_row() {
  local wanted="$1" rows="$2" line match="" rest
  while IFS= read -r line; do
    [[ "${line%%"$WHIM_TAB"*}" = "$wanted" ]] || continue
    [[ -z "$match" ]] || whim_monitoring_fail "two resources are named '$wanted'; delete one, then rerun"
    match="$line"
  done <<<"$rows"
  ROW_NAME="" ROW_SPEC="" ROW_EXTRA=""
  [[ -n "$match" ]] || return 0
  rest="${match#*"$WHIM_TAB"}"
  ROW_NAME="${rest%%"$WHIM_TAB"*}"
  [[ "$rest" != "$ROW_NAME" ]] || return 0
  rest="${rest#*"$WHIM_TAB"}"
  ROW_SPEC="${rest%%"$WHIM_TAB"*}"
  [[ "$rest" != "$ROW_SPEC" ]] || return 0
  ROW_EXTRA="${rest#*"$WHIM_TAB"}"
}

# Creates the rendered resource when no row in $2 carries its display name, updates it when the
# row's fingerprint differs, and otherwise leaves it. $1 names it, $3 is the gcloud flag that takes
# the file, the rest is the gcloud command group. Sets APPLIED_NAME to its resource name.
whim_apply_rendered() {
  local what="$1" rows="$2" file_flag="$3" display
  shift 3
  display="$(whim_display_name_of "$RENDERED_FILE")"
  whim_find_row "$display" "$rows"
  if [[ -z "$ROW_NAME" ]]; then
    APPLIED_NAME="$(whim_gcloud "$@" create "$file_flag=$RENDERED_FILE" --format='value(name)')" \
      || whim_monitoring_fail "creating $what '$display' failed"
    [[ -n "$APPLIED_NAME" ]] || whim_monitoring_fail "creating $what '$display' returned no resource name"
    echo "created $what '$display'"
  elif [[ "$ROW_SPEC" != "$RENDERED_SPEC" ]]; then
    whim_gcloud "$@" update "$ROW_NAME" "$file_flag=$RENDERED_FILE" >/dev/null \
      || whim_monitoring_fail "updating $what '$display' failed"
    APPLIED_NAME="$ROW_NAME"
    echo "updated $what '$display'"
  else
    APPLIED_NAME="$ROW_NAME"
    echo "unchanged $what '$display'"
  fi
}

whim_capture_uptime_value() {
  local key="$1" value="$2" context="$3"
  whim_word_in "$key" "DISPLAY_NAME CHECK_PATH PERIOD_MINUTES TIMEOUT_SECONDS REGIONS MATCHER_CONTENT" \
    || whim_fail "$context: unknown uptime check setting $key"
  printf -v "uptime_$key" '%s' "$value"
}

# Applies all of deploy/monitoring/: the email channel to $1, the uptime check on https://$2, every
# log metric and every alert policy. Each is keyed by display name (a metric by its name) and
# carries a fingerprint of its rendered definition, so a rerun creates what is missing, updates what
# changed and leaves the rest alone. Sets WHIM_MONITORING_CHANNEL to the channel's resource name.
whim_apply_monitoring() {
  local alert_email="$1" api_host="$2" rows template metric description uptime_spec uptime_name uptime_check_id
  local uptime_file="$WHIM_MONITORING_DIR/uptime-healthz.env" key value_name
  local uptime_DISPLAY_NAME="" uptime_CHECK_PATH="" uptime_PERIOD_MINUTES="" uptime_TIMEOUT_SECONDS="" uptime_REGIONS="" uptime_MATCHER_CONTENT=""
  local -a uptime_settings

  # Every definition renders before anything is applied, so a broken one changes nothing.
  for template in "$WHIM_MONITORING_DIR"/channel-email.json "$WHIM_MONITORING_DIR"/metric-*.json "$WHIM_MONITORING_DIR"/policy-*.json; do
    whim_monitoring_render "$template" ALERT_EMAIL "$alert_email" CHANNEL unapplied UPTIME_CHECK_ID unapplied
  done

  echo "==> alert email channel"
  whim_monitoring_render "$WHIM_MONITORING_DIR/channel-email.json" ALERT_EMAIL "$alert_email"
  rows="$(whim_gcloud beta monitoring channels list --format='value(displayName,name,userLabels.whim_spec)')" \
    || whim_monitoring_fail "listing the notification channels failed"
  whim_apply_rendered "notification channel" "$rows" --channel-content-from-file beta monitoring channels
  WHIM_MONITORING_CHANNEL="$APPLIED_NAME"

  echo "==> uptime check on https://$api_host"
  whim_read_env_lines "$uptime_file" whim_capture_uptime_value
  for key in DISPLAY_NAME CHECK_PATH PERIOD_MINUTES TIMEOUT_SECONDS REGIONS MATCHER_CONTENT; do
    value_name="uptime_$key"
    [[ -n "${!value_name}" ]] || whim_fail "$uptime_file sets no $key"
  done
  uptime_spec="$(git hash-object "$uptime_file")"
  uptime_settings=(--path "$uptime_CHECK_PATH" --period "$uptime_PERIOD_MINUTES" --timeout "$uptime_TIMEOUT_SECONDS"
    --validate-ssl=true --matcher-content "$uptime_MATCHER_CONTENT" --matcher-type contains-string)
  rows="$(whim_gcloud monitoring uptime list-configs --format='value(displayName,name,userLabels.whim_spec,monitoredResource.labels.host)')" \
    || whim_monitoring_fail "listing the uptime checks failed"
  whim_find_row "$uptime_DISPLAY_NAME" "$rows"
  if [[ -z "$ROW_NAME" ]]; then
    uptime_name="$(whim_gcloud monitoring uptime create "$uptime_DISPLAY_NAME" --resource-type uptime-url \
      --resource-labels "host=$api_host,project_id=$WHIM_GCP_PROJECT" --protocol https --port 443 "${uptime_settings[@]}" \
      --regions "$uptime_REGIONS" --user-labels "whim_spec=$uptime_spec" --format='value(name)')" \
      || whim_monitoring_fail "creating uptime check '$uptime_DISPLAY_NAME' failed"
    [[ -n "$uptime_name" ]] || whim_monitoring_fail "creating uptime check '$uptime_DISPLAY_NAME' returned no resource name"
    echo "created uptime check '$uptime_DISPLAY_NAME'"
  elif [[ "$ROW_EXTRA" != "$api_host" ]]; then
    # An uptime check's host can't be updated in place.
    whim_monitoring_fail "uptime check '$uptime_DISPLAY_NAME' watches ${ROW_EXTRA:-another host}, not $api_host; delete it (gcloud monitoring uptime delete ${ROW_NAME##*/}), then rerun"
  elif [[ "$ROW_SPEC" != "$uptime_spec" ]]; then
    uptime_name="$ROW_NAME"
    whim_gcloud monitoring uptime update "${uptime_name##*/}" "${uptime_settings[@]}" --set-regions "$uptime_REGIONS" \
      --update-user-labels "whim_spec=$uptime_spec" >/dev/null \
      || whim_monitoring_fail "updating uptime check '$uptime_DISPLAY_NAME' failed"
    echo "updated uptime check '$uptime_DISPLAY_NAME'"
  else
    uptime_name="$ROW_NAME"
    echo "unchanged uptime check '$uptime_DISPLAY_NAME'"
  fi
  uptime_check_id="${uptime_name##*/}"

  echo "==> log-based metrics"
  for template in "$WHIM_MONITORING_DIR"/metric-*.json; do
    metric="$(basename "$template" .json)"
    metric="${metric#metric-}"
    whim_monitoring_render "$template"
    if description="$(whim_gcloud logging metrics describe "$metric" --format='value(description)' 2>/dev/null)"; then
      case "$description" in
        *"whim_spec $RENDERED_SPEC") echo "unchanged log metric $metric" ;;
        *)
          whim_gcloud logging metrics update "$metric" --config-from-file="$RENDERED_FILE" >/dev/null \
            || whim_monitoring_fail "updating log metric $metric failed"
          echo "updated log metric $metric"
          ;;
      esac
    else
      whim_gcloud logging metrics create "$metric" --config-from-file="$RENDERED_FILE" >/dev/null \
        || whim_monitoring_fail "creating log metric $metric failed"
      echo "created log metric $metric"
    fi
  done

  echo "==> alert policies"
  rows="$(whim_gcloud monitoring policies list --format='value(displayName,name,userLabels.whim_spec)')" \
    || whim_monitoring_fail "listing the alert policies failed"
  for template in "$WHIM_MONITORING_DIR"/policy-*.json; do
    whim_monitoring_render "$template" CHANNEL "$WHIM_MONITORING_CHANNEL" UPTIME_CHECK_ID "$uptime_check_id"
    whim_apply_rendered "alert policy" "$rows" --policy-from-file monitoring policies
  done
}

# ---------------------------------------------------------------------------------------------
# Smoke checks shared by deploy/smoke.sh (the VM) and deploy/cloudrun/smoke.sh. Callers set
# WHIM_SMOKE_WORK to a scratch directory and end with whim_smoke_finish.

WHIM_SMOKE_FAILURES=0

# Judges the /health body on stdin by structure, given the configured iOS and Android minimums and
# the expected commit (empty: any full SHA) as arguments, and prints why. Exits 0 when ok is true,
# the service is whim-server, commit is a full SHA (that one, when given) and minBuild holds exactly
# those minimums; 2 when minBuild is absent (a server from before the minimum-build gate) and both
# minimums are 0, so there is nothing for it to enforce; 1 otherwise.
readonly WHIM_HEALTH_JS='let healthText = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { healthText += chunk; });
process.stdin.on("end", () => {
  const [iosText, androidText, expectedCommit] = process.argv.slice(1);
  const ios = Number(iosText);
  const android = Number(androidText);
  const verdict = (code, reason) => { console.log(reason); process.exit(code); };
  let health;
  try { health = JSON.parse(healthText); } catch { verdict(1, "the body is not JSON"); }
  if (health?.ok !== true || health.service !== "whim-server") verdict(1, "expected ok true from service whim-server");
  if (!Object.hasOwn(health, "commit")) verdict(1, "no commit: this server predates the commit report, so it cannot show which image it runs");
  if (typeof health.commit !== "string" || !/^[0-9a-f]{40}$/.test(health.commit)) verdict(1, "commit " + JSON.stringify(health.commit) + " is not a full 40-character SHA: this image was not built by the release pipeline");
  if (expectedCommit && health.commit !== expectedCommit) verdict(1, "commit is " + health.commit + ", but this deploy rolled out " + expectedCommit + ": the container still runs another image");
  const minimums = "iOS " + iosText + ", Android " + androidText;
  if (!Object.hasOwn(health, "minBuild")) {
    if (ios === 0 && android === 0) verdict(2, "no minBuild: this server predates the minimum-build gate; both configured minimums are 0, so it has nothing to enforce");
    verdict(1, "no minBuild: this server predates the minimum-build gate, so it cannot enforce the configured minimums (" + minimums + "); rolling back below the gate dropped it");
  }
  const got = health.minBuild;
  if (got?.ios === ios && got?.android === android) verdict(0, "minBuild matches");
  verdict(1, "minBuild should hold the configured minimums (" + minimums + ")");
});'
# Reads the stream probe from stdin and passes when three comment frames span at least 1.5 s.
readonly WHIM_SSE_TIMING_JS='const times = []; let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  for (let end = buffer.indexOf("\n\n"); end !== -1; end = buffer.indexOf("\n\n")) {
    if (buffer.startsWith(":")) times.push(performance.now());
    buffer = buffer.slice(end + 2);
  }
});
process.stdin.on("end", () => {
  const span = times.length > 1 ? Math.round(times[times.length - 1] - times[0]) : 0;
  console.log(times.length + " frames over " + span + " ms");
  process.exit(times.length === 3 && span >= 1500 ? 0 : 1);
});'

whim_smoke_pass() { printf 'ok    %s\n' "$1"; }

whim_smoke_flunk() {
  printf 'FAIL  %s\n' "$1" >&2
  WHIM_SMOKE_FAILURES=$((WHIM_SMOKE_FAILURES + 1))
}

# Fails when any check failed, and otherwise says all passed.
whim_smoke_finish() {
  [ "$WHIM_SMOKE_FAILURES" -eq 0 ] || whim_fail "$WHIM_SMOKE_FAILURES smoke check(s) failed"
  echo "${WHIM_SCRIPT:-smoke}: all checks passed"
}

# GETs (or, with extra curl arguments, requests) an HTTPS URL without following redirects, within
# WHIM_SMOKE_MAX_TIME seconds (20 unless set). Sets PROBE_STATUS, PROBE_TYPE, PROBE_LOCATION and
# PROBE_CSP (the Content-Security-Policy header); the body lands in $WHIM_SMOKE_WORK/body.
whim_smoke_probe() {
  local url="$1" meta
  shift
  if ! meta="$(curl -sS --proto '=https' --max-time "${WHIM_SMOKE_MAX_TIME:-20}" -o "$WHIM_SMOKE_WORK/body" -w '%{http_code}|%{content_type}|%{redirect_url}|%header{content-security-policy}' "$@" "$url")"; then
    PROBE_STATUS=000
    PROBE_TYPE=""
    PROBE_LOCATION=""
    PROBE_CSP=""
    : >"$WHIM_SMOKE_WORK/body"
    return
  fi
  IFS='|' read -r PROBE_STATUS PROBE_TYPE PROBE_LOCATION PROBE_CSP <<<"$meta"
}

# /health must answer for whim-server, at the commit $1 (any full SHA when empty), holding the
# configured minimum builds (unset is 0).
whim_smoke_health() {
  local expected_commit="$1" url="https://$WHIM_API_HOST/health" body verdict code=0
  local ios="${WHIM_MIN_BUILD_IOS:-0}" android="${WHIM_MIN_BUILD_ANDROID:-0}" expected
  expected="{\"ok\":true,\"service\":\"whim-server\",\"commit\":\"${expected_commit:-<40-hex sha>}\",\"minBuild\":{\"ios\":$ios,\"android\":$android}}"
  whim_smoke_probe "$url"
  body="$(head -c 300 "$WHIM_SMOKE_WORK/body")"
  if [[ "$PROBE_STATUS" != 200 ]]; then
    whim_smoke_flunk "api $url answered $PROBE_STATUS '$body', expected 200 $expected"
    return
  fi
  verdict="$(node -e "$WHIM_HEALTH_JS" "$ios" "$android" "$expected_commit" <"$WHIM_SMOKE_WORK/body")" || code=$?
  case "$code" in
    0) whim_smoke_pass "api $url -> $body" ;;
    2) printf 'WARN  api %s answered %s: %s\n' "$url" "$body" "$verdict" >&2 ;;
    *) whim_smoke_flunk "api $url answered 200 '$body': ${verdict:-node gave no verdict}; expected $expected" ;;
  esac
}

# Sends the protocol level every /v1 request carries, so the one header missing is the device's.
whim_smoke_device_header_required() {
  local url="https://$WHIM_API_HOST/v1/generate"
  whim_smoke_probe "$url" -X POST -H 'content-type: application/json' -H 'x-whim-protocol: 1' --data '{}'
  if [ "$PROBE_STATUS" = 400 ]; then
    whim_smoke_pass "api $url without a device header -> 400"
  else
    whim_smoke_flunk "api $url without a device header answered $PROBE_STATUS, expected 400"
  fi
}

# Sends a full, well-formed envelope from a build the minimum-build gate alone would admit (382511,
# above any minimum this deploy config sets), but with no x-whim-protocol: exactly what a pre-D16
# build (381237, 382511) sends. This is the gate that retires them (design D16 layer 2, D17): it runs
# in request-edge.ts#readProtocolLevel, mounted before min-build.ts's own gate, so it fires whether or
# not a minimum is configured. Picking an admitted build proves this 426 comes from the protocol
# check, not incidentally from the minimum-build gate. It runs before any admission, ledger row or
# model call (app.ts mounts it ahead of the routes and of minimumBuildGate). It carries the all-zero
# device id because the device gate runs first; nothing is stored under it.
whim_smoke_pre_protocol_build_refused() {
  local url="https://$WHIM_API_HOST/v1/generate" body
  whim_smoke_probe "$url" -X POST \
    -H 'content-type: application/json' \
    -H 'x-whim-platform: ios' \
    -H 'x-whim-app-version: 1.0.0' \
    -H 'x-whim-build: 382511' \
    -H 'x-whim-consent: 2' \
    -H 'x-whim-device: 00000000-0000-4000-8000-000000000000' \
    --data '{}'
  body="$(head -c 300 "$WHIM_SMOKE_WORK/body")"
  if [[ "$PROBE_STATUS" = 426 ]] && [[ "$body" == *'"error":"update_required"'* ]]; then
    whim_smoke_pass "api $url from a pre-protocol build (no x-whim-protocol) -> 426 update_required"
  else
    whim_smoke_flunk "api $url from a pre-protocol build answered $PROBE_STATUS '$body', expected 426 update_required"
  fi
}

whim_smoke_stream_probe() {
  local url="https://$WHIM_API_HOST/healthz/sse" verdict
  if verdict="$(curl -sS -N --proto '=https' --max-time 20 "$url" | node -e "$WHIM_SSE_TIMING_JS")"; then
    whim_smoke_pass "api $url -> $verdict"
  else
    whim_smoke_flunk "api $url -> ${verdict:-no answer}; expected 3 frames about a second apart (is the proxy buffering?)"
  fi
}

# A filled trap field answers thanks and stores nothing, so this post is safe against production.
whim_smoke_beta_signup_trap() {
  local url="https://$WHIM_API_HOST/beta/signup" thanks="https://$WHIM_WEB_HOST/beta/thanks"
  whim_smoke_probe "$url" -H 'content-type: application/x-www-form-urlencoded' --data 'email=smoke%40example.com&platform=other&hp_ref=smoke'
  if [[ "$PROBE_STATUS" = 303 ]] && [[ "$PROBE_LOCATION" = "$thanks" ]]; then
    whim_smoke_pass "api $url with the trap field filled -> 303 $thanks"
  else
    whim_smoke_flunk "api $url with the trap field filled answered $PROBE_STATUS${PROBE_LOCATION:+ redirecting to $PROBE_LOCATION}, expected 303 to $thanks"
  fi
}

whim_smoke_page() {
  local path="$1" expected="$2" url="https://$WHIM_WEB_HOST$1"
  whim_smoke_probe "$url"
  if [ "$PROBE_STATUS" = "$expected" ] && [ -z "$PROBE_LOCATION" ] && [[ "$PROBE_TYPE" == text/html* ]]; then
    whim_smoke_pass "pages $path -> $expected HTML, no redirect"
  else
    whim_smoke_flunk "pages $url answered $PROBE_STATUS ($PROBE_TYPE)${PROBE_LOCATION:+ redirecting to $PROBE_LOCATION}, expected $expected HTML without a redirect"
  fi
}

# The /beta page loads its self-hosted fonts, so its CSP must allow font-src 'self'.
whim_smoke_beta_page() {
  local url="https://$WHIM_WEB_HOST/beta"
  whim_smoke_probe "$url"
  if [[ "$PROBE_STATUS" = 200 ]] && [[ -z "$PROBE_LOCATION" ]] && [[ "$PROBE_TYPE" == text/html* ]] && [[ "$PROBE_CSP" == *"font-src 'self'"* ]]; then
    whim_smoke_pass "pages /beta -> 200 HTML, CSP allows font-src 'self'"
  else
    whim_smoke_flunk "pages $url answered $PROBE_STATUS ($PROBE_TYPE)${PROBE_LOCATION:+ redirecting to $PROBE_LOCATION} with CSP '$PROBE_CSP', expected 200 HTML whose CSP has font-src 'self'"
  fi
}

whim_smoke_pages() {
  whim_smoke_page /privacy 200
  whim_smoke_page /privacy/v1 200
  whim_smoke_page /terms 200
  whim_smoke_page /fr/privacy 200
  whim_smoke_page /fr/terms 200
  whim_smoke_page /support 200
  whim_smoke_page /a/x 200
  whim_smoke_beta_page
  whim_smoke_page /beta/thanks 200
  whim_smoke_page /beta/retry 200
  whim_smoke_page /nope 404
}

# Compares one association path on the pages host with the published site: $2 is "present" (its
# bytes in the file $3) or "absent".
whim_smoke_association() {
  local name="$1" state="$2" published="$3" url="https://$WHIM_WEB_HOST/.well-known/$1"
  whim_smoke_probe "$url"
  case "$state" in
    present)
      if [ "$PROBE_STATUS" = 200 ] && [ -z "$PROBE_LOCATION" ] && [[ "$PROBE_TYPE" == application/json* ]] \
        && cmp -s "$WHIM_SMOKE_WORK/body" "$published"; then
        whim_smoke_pass "association $name -> 200 application/json, bytes equal the published file"
      else
        whim_smoke_flunk "association $url answered $PROBE_STATUS ($PROBE_TYPE)${PROBE_LOCATION:+ redirecting to $PROBE_LOCATION}; expected 200 application/json with the published bytes"
      fi
      ;;
    absent)
      if [ "$PROBE_STATUS" = 404 ] && [ -z "$PROBE_LOCATION" ]; then
        whim_smoke_pass "association $name -> 404 (the published site has none)"
      else
        whim_smoke_flunk "association $url answered $PROBE_STATUS; the published site has no such file, so expected 404"
      fi
      ;;
    *) whim_smoke_flunk "association $name: unexpected state of the published site: $state" ;;
  esac
}
