#!/usr/bin/env bash
# Post-deploy smoke checks for Whim on Cloud Run (server-ops-hardening D6), run from the operator's
# machine. deploy/cloudrun/deploy.sh runs it at the end of every mode.
#
#   deploy/cloudrun/smoke.sh                  every check, then one live POST /v1/clarify
#   deploy/cloudrun/smoke.sh --commit <sha>   the same, and /health and the serving revision must be that commit
#   deploy/cloudrun/smoke.sh --no-live        every check but the live clarify: nothing is admitted, credited or stored
#   deploy/cloudrun/smoke.sh --pages-only     the pages and association files only
#
# --site-dir <dir> (any mode) compares the association files with that site build; without it the
# smoke builds the site from this checkout, as deploy.sh does. Standalone, /health may report any
# full 40-character commit SHA. Needs no static IP, SSH or other VM value.
#
# The live clarify is the one production write any smoke makes: one ledger row and one usage document
# under the fixed smoke device id SMOKE_DEVICE_ID, with the fixed prompt SMOKE_PROMPT (docs/deploy.md
# names both, so the usage report can leave them out). The pre-protocol probe carries the all-zero
# device id because the device gate runs first, and is refused before any admission.
set -euo pipefail

WHIM_SCRIPT=cloudrun/smoke.sh
WHIM_USAGE='usage: deploy/cloudrun/smoke.sh [--pages-only | --commit <full git commit sha> | --no-live]... [--site-dir <dir>]'
# shellcheck source=deploy/lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

readonly RUN_SERVER_SERVICE=whim-server
readonly RUN_SITE_SERVICE=whim-site
readonly RUN_PURGE_JOB=whim-purge
readonly RUN_PURGE_SCHEDULE=whim-purge-hourly
readonly SMOKE_DEVICE_ID=5e0ce000-0000-4000-8000-00000000c1a1
readonly SMOKE_PROMPT='smoke: a checklist with one item'
# The live clarify's envelope: what server/src/bench-envelope.ts sends. The build number is the whole
# minutes since BUILD_NUMBER_EPOCH_UTC (scripts/release/lib/build-number.ts), 2026-01-01T00:00Z.
readonly BUILD_NUMBER_EPOCH_S=1767225600
readonly SMOKE_APP_VERSION=1.0.0
readonly SMOKE_CONSENT=2
readonly SMOKE_PROTOCOL=1
# Reads `gcloud run domain-mappings describe --format=json` from the file argv[1]; passes when the
# mapping routes to the service argv[2] and its Ready condition is True.
readonly MAPPING_JS='const mapping = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"));
const route = process.argv[2];
const fail = (why) => { console.log(why); process.exit(1); };
if (mapping.spec?.routeName !== route) fail("routes to " + (mapping.spec?.routeName || "nothing") + ", not " + route);
const ready = (mapping.status?.conditions || []).find((condition) => condition.type === "Ready");
if (ready?.status !== "True") fail("is not ready: " + (ready ? ready.status + (ready.message ? " (" + ready.message + ")" : "") : "no Ready condition"));
console.log("ready, routing to " + route);'
# Reads `gcloud run services describe --format=json` from the file argv[1]; passes when the newest
# revision is the ready one and takes all traffic, runs the image for the commit argv[2] (when given),
# has request-based billing (CPU only during requests), and runs within the instance bounds argv[3]
# (minimum; an absent annotation is 0) and argv[4] (maximum; an absent annotation is no cap), as
# deploy.sh deploys it, so no deploy or console edit leaves instances billing unseen.
readonly SERVICE_JS='const service = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"));
const [, , expectedCommit, minInstances, maxInstances] = process.argv;
const fail = (why) => { console.log(why); process.exit(1); };
const status = service.status || {};
const ready = status.latestReadyRevisionName;
if (!ready) fail("has no ready revision");
if (status.latestCreatedRevisionName !== ready) fail("its newest revision " + status.latestCreatedRevisionName + " is not ready; " + ready + " still serves");
const serving = (status.traffic || []).filter((target) => (target.percent || 0) > 0);
const total = serving.reduce((sum, target) => sum + target.percent, 0);
if (total !== 100 || serving.some((target) => target.revisionName !== ready)) fail("sends traffic " + serving.map((target) => (target.revisionName || "?") + "=" + target.percent + "%").join(", ") + ", not 100% to " + ready);
const image = service.spec?.template?.spec?.containers?.[0]?.image || "";
if (expectedCommit && !image.endsWith(":" + expectedCommit)) fail("revision " + ready + " runs " + (image || "no image") + ", not the image for " + expectedCommit);
const throttling = service.spec?.template?.metadata?.annotations?.["run.googleapis.com/cpu-throttling"];
if (throttling === "false") fail("revision " + ready + " has CPU always allocated (instance-based billing), so an idle instance is billed; deploy with --cpu-throttling");
const templateAnnotations = service.spec?.template?.metadata?.annotations || {};
const minScale = templateAnnotations["autoscaling.knative.dev/minScale"] ?? "0";
if (minScale !== minInstances) fail("revision " + ready + " keeps " + minScale + " instance(s) warm, not " + minInstances + ", so idle instances are billed; deploy with --min-instances " + minInstances);
const serviceMinScale = service.metadata?.annotations?.["run.googleapis.com/minScale"] ?? "0";
if (serviceMinScale !== minInstances) fail("has a service-level minimum of " + serviceMinScale + " instance(s), not " + minInstances + ", so idle instances are billed");
const maxScale = templateAnnotations["autoscaling.knative.dev/maxScale"];
if (maxScale !== maxInstances) fail("revision " + ready + " may scale to " + (maxScale ?? "an uncapped number of") + " instance(s), not " + maxInstances + "; deploy with --max-instances " + maxInstances);
console.log(ready + " takes all traffic" + (expectedCommit ? " at " + expectedCommit : "") + ", CPU only during requests, " + minInstances + "-" + maxInstances + " instances");'

pages_only=0
live=1
expected_commit=""
site_dir=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --pages-only)
      pages_only=1
      shift
      ;;
    --no-live)
      live=0
      shift
      ;;
    --commit)
      [[ "$#" -ge 2 ]] || whim_usage_error "--commit needs a commit sha"
      expected_commit="$2"
      shift 2
      ;;
    --site-dir)
      [[ "$#" -ge 2 ]] || whim_usage_error "--site-dir needs a directory"
      site_dir="$2"
      shift 2
      ;;
    *) whim_usage_error "unknown argument: $1" ;;
  esac
done
if [[ -n "$expected_commit" ]]; then
  [[ "$pages_only" -eq 0 ]] || whim_usage_error "--pages-only checks no /health, so it takes no --commit"
  [[ "$expected_commit" =~ ^[0-9a-f]{40}$ ]] || whim_usage_error "--commit must be a full 40-character git commit sha"
fi
[[ -z "$site_dir" ]] || [[ -d "$site_dir" ]] || whim_usage_error "--site-dir $site_dir is not a directory"

whim_load_values
whim_require_values WHIM_GCP_PROJECT WHIM_RUN_REGION WHIM_API_HOST WHIM_WEB_HOST
[[ -n "$site_dir" ]] || whim_require_values WHIM_SUPPORT_EMAIL WHIM_ENGINEER_MODEL WHIM_REWRITE_MODEL
whim_require_hostnames
tools="curl node"
[[ "$pages_only" -eq 1 ]] || tools="$tools dig gcloud"
for tool in $tools; do
  command -v "$tool" >/dev/null 2>&1 || whim_fail "$tool is not on PATH; this smoke needs $tools"
done

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
WHIM_SMOKE_WORK="$work"

# Both domain mappings ready and routing to their service, and both hostnames resolving. Until they
# are, the smoke stops there and makes no HTTPS request.
check_domains() {
  local host route verdict addresses ready=1
  for host in "$WHIM_API_HOST" "$WHIM_WEB_HOST"; do
    route="$RUN_SITE_SERVICE"
    [[ "$host" != "$WHIM_API_HOST" ]] || route="$RUN_SERVER_SERVICE"
    if ! whim_gcloud run domain-mappings describe --domain "$host" --region "$WHIM_RUN_REGION" --format=json >"$work/mapping.json" 2>"$work/mapping.err"; then
      whim_smoke_flunk "domain mapping $host: $(head -c 300 "$work/mapping.err")"
      ready=0
    elif verdict="$(node -e "$MAPPING_JS" "$work/mapping.json" "$route")"; then
      whim_smoke_pass "domain mapping $host -> $verdict"
    else
      whim_smoke_flunk "domain mapping $host $verdict"
      ready=0
    fi
    addresses="$(dig +short A "$host" | awk '/^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$/' | sort -u | tr '\n' ' ')" || addresses=""
    if [[ -n "$addresses" ]]; then
      whim_smoke_pass "dns $host -> ${addresses% }"
    else
      whim_smoke_flunk "dns $host has no A record"
      ready=0
    fi
  done
  [[ "$ready" -eq 1 ]] || whim_fail "the domains are not ready, so no HTTPS request was made ($WHIM_SMOKE_FAILURES check(s) failed)"
}

check_serving_revision() {
  local verdict
  if ! whim_gcloud run services describe "$RUN_SERVER_SERVICE" --region "$WHIM_RUN_REGION" --format=json >"$work/service.json" 2>"$work/service.err"; then
    whim_smoke_flunk "cloud run $RUN_SERVER_SERVICE: $(head -c 300 "$work/service.err")"
  elif verdict="$(node -e "$SERVICE_JS" "$work/service.json" "$expected_commit" "$WHIM_RUN_SERVER_MIN_INSTANCES" "$WHIM_RUN_SERVER_MAX_INSTANCES")"; then
    whim_smoke_pass "cloud run $RUN_SERVER_SERVICE -> $verdict"
  else
    whim_smoke_flunk "cloud run $RUN_SERVER_SERVICE $verdict"
  fi
}

# The retention purge: the job, and its hourly trigger, enabled. A WHIM_STORE_BACKEND=sqlite deploy
# runs none.
check_purge_job() {
  local name schedule expected="0 * * * *${WHIM_TAB}ENABLED"
  if [[ "${WHIM_STORE_BACKEND:-firestore}" = sqlite ]]; then
    echo "skip  purge job: WHIM_STORE_BACKEND=sqlite runs none"
    return
  fi
  if name="$(whim_gcloud run jobs describe "$RUN_PURGE_JOB" --region "$WHIM_RUN_REGION" --format='value(name)' 2>&1)" && [[ -n "$name" ]]; then
    whim_smoke_pass "cloud run job $RUN_PURGE_JOB exists"
  else
    whim_smoke_flunk "cloud run job $RUN_PURGE_JOB: ${name:-not found}; retention is not enforced"
  fi
  schedule="$(whim_gcloud scheduler jobs describe "$RUN_PURGE_SCHEDULE" --location "$WHIM_RUN_REGION" --format='value(schedule,state)' 2>/dev/null)" || schedule=""
  if [[ "$schedule" = "$expected" ]]; then
    whim_smoke_pass "cloud scheduler $RUN_PURGE_SCHEDULE -> hourly, enabled"
  else
    whim_smoke_flunk "cloud scheduler $RUN_PURGE_SCHEDULE is '${schedule:-missing}', expected '0 * * * *' and ENABLED"
  fi
}

# The one production write: a benign clarify from the smoke device, with the envelope the server's
# own drivers send.
check_live_clarify() {
  local url="https://$WHIM_API_HOST/v1/clarify" build body
  build=$((($(date -u +%s) - BUILD_NUMBER_EPOCH_S) / 60))
  WHIM_SMOKE_MAX_TIME=90 whim_smoke_probe "$url" -X POST \
    -H 'content-type: application/json' \
    -H "x-whim-device: $SMOKE_DEVICE_ID" \
    -H 'x-whim-platform: android' \
    -H "x-whim-app-version: $SMOKE_APP_VERSION" \
    -H "x-whim-build: $build" \
    -H "x-whim-consent: $SMOKE_CONSENT" \
    -H "x-whim-protocol: $SMOKE_PROTOCOL" \
    --data "{\"prompt\":\"$SMOKE_PROMPT\"}"
  body="$(head -c 300 "$work/body")"
  if [[ "$PROBE_STATUS" = 200 ]]; then
    whim_smoke_pass "api $url from the smoke device -> 200"
  else
    whim_smoke_flunk "api $url from the smoke device answered $PROBE_STATUS '$body', expected 200"
  fi
}

check_association_file() {
  local name="$1" published="$site_dir/.well-known/$1"
  if [[ -f "$published" ]]; then
    whim_smoke_association "$name" present "$published"
  else
    whim_smoke_association "$name" absent ""
  fi
}

if [[ "$pages_only" -eq 0 ]]; then
  check_domains
  check_serving_revision
  whim_smoke_health "$expected_commit"
  whim_smoke_device_header_required
  whim_smoke_pre_protocol_build_refused
  whim_smoke_stream_probe
  whim_smoke_beta_signup_trap
  check_purge_job
  if [[ "$live" -eq 1 ]]; then
    check_live_clarify
  else
    echo "skip  live clarify (--no-live)"
  fi
fi
if [[ -z "$site_dir" ]]; then
  site_dir="$work/site"
  whim_cloudrun_site_build "$site_dir" >"$work/site-build.log" 2>&1 \
    || { cat "$work/site-build.log" >&2; whim_fail "the site build to compare the association files with failed"; }
fi
whim_smoke_pages
check_association_file apple-app-site-association
check_association_file assetlinks.json
whim_smoke_finish
