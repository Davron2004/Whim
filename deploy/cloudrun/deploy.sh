#!/usr/bin/env bash
# Deploys Whim to Cloud Run, scaled to zero when idle (docs/deploy.md, "Cloud Run"). Run from a
# clean, pushed checkout:
#
#   deploy/cloudrun/deploy.sh                 the server image for HEAD (built unless it exists) and the pages site
#   deploy/cloudrun/deploy.sh --tag <sha>     the server only, from an image already in Artifact Registry (rollback);
#                                             the purge job keeps its image but takes the new config
#   deploy/cloudrun/deploy.sh --site-only     the pages site only; the server is untouched
#
# Values come from deploy/defaults.env, then ~/.config/whim/deploy.env, then the environment, as for
# the VM deploy. Two services: whim-server (the API host) and whim-site (Caddy serving the rendered
# pages). Both run as the whim-run service account, which can read the OpenRouter secret and use
# Firestore. The server keeps usage, reports and waitlist rows in the project's Firestore database
# (WHIM_STORE_BACKEND=firestore), and the whim-purge job, run hourly by Cloud Scheduler, deletes the
# ones past their keep period; the alert deploy/monitoring/policy-purge-failed.json emails when it
# logs an error. WHIM_STORE_BACKEND=sqlite in the environment deploys the server on SQLite stores
# under /tmp instead, which last only as long as the instance (the rollback); it makes no Firestore,
# Scheduler or Monitoring call and leaves an existing purge job as it was.
set -euo pipefail

WHIM_SCRIPT=cloudrun/deploy.sh
WHIM_USAGE='usage: deploy/cloudrun/deploy.sh [--tag <full git commit sha>] [--site-only]'
# shellcheck source=deploy/lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

readonly RUN_SERVER_SERVICE=whim-server
readonly RUN_SITE_SERVICE=whim-site
readonly RUN_SERVICE_ACCOUNT_NAME=whim-run
# The retention purges as a Cloud Run Job, run hourly by a Cloud Scheduler job, so records go on
# time while the scaled-to-zero server has no instance to run its own hourly purge.
readonly RUN_PURGE_JOB=whim-purge
readonly RUN_PURGE_SCHEDULE=whim-purge-hourly
# The alert that emails when the purge job logs an error, and the channel it emails (both applied by
# deploy/provision.sh too).
readonly RUN_PURGE_ALERT="$WHIM_DEPLOY_DIR/monitoring/policy-purge-failed.json"
readonly RUN_ALERT_CHANNEL="$WHIM_DEPLOY_DIR/monitoring/channel-email.json"
# The server's drain must finish inside Cloud Run's 10 s SIGTERM grace. Cloud Run only stops an idle
# instance, so there is normally nothing to drain.
readonly RUN_SERVER_DRAIN_MS=8000
# The server's default WHIM_FIRESTORE_DATABASE, so the server env does not set it.
readonly RUN_FIRESTORE_DATABASE='(default)'
# How long a deploy waits for a composite index that is still building (another deploy's, or one
# an interrupted deploy left): RUN_INDEX_WAIT_POLLS lists, RUN_INDEX_WAIT_SECONDS apart (20 minutes).
readonly RUN_INDEX_WAIT_POLLS=60
readonly RUN_INDEX_WAIT_SECONDS=20
# Reads deploy/firestore/indexes.json (argv[1]) and gcloud's JSON list of the database's composite
# indexes (argv[2]); prints one tab-separated line per wanted index that is not READY:
#   create<TAB><`gcloud firestore indexes composite create` arguments, tab-separated>   none listed
#   building<TAB><index>                                                                CREATING
#   broken<TAB><index><TAB><state>                                                      any other state
# Indexes match on collection group, query scope and fields in order; the API appends __name__ to a
# listed index's fields, so a trailing __name__ is ignored on both sides.
readonly INDEX_PLAN_JS='const indexFile = process.argv[1];
const fs = require("node:fs");
const wanted = JSON.parse(fs.readFileSync(indexFile, "utf8")).indexes || [];
const listed = JSON.parse(fs.readFileSync(process.argv[2], "utf8") || "[]");
const fieldConfig = (field) => {
  if (field.order) return "field-path=" + field.fieldPath + ",order=" + field.order.toLowerCase();
  if (field.arrayConfig) return "field-path=" + field.fieldPath + ",array-config=" + field.arrayConfig.toLowerCase();
  throw new Error("index field " + JSON.stringify(field) + " has neither order nor arrayConfig");
};
const fieldsOf = (fields) => fields.filter((field, i) => !(field.fieldPath === "__name__" && i === fields.length - 1));
const key = (group, scope, fields) => [group, scope || "COLLECTION", ...fieldsOf(fields).map(fieldConfig)].join(" ");
const states = new Map();
for (const index of listed) {
  const k = key((/\/collectionGroups\/([^/]+)\//.exec(index.name) || [])[1], index.queryScope, index.fields);
  states.set(k, [...(states.get(k) || []), index.state || "STATE_UNSPECIFIED"]);
}
for (const index of wanted) {
  const k = key(index.collectionGroup, index.queryScope, index.fields);
  const found = states.get(k) || [];
  if (found.includes("READY")) continue;
  const label = index.collectionGroup + " (" + fieldsOf(index.fields).map(fieldConfig).join(" ") + ")";
  if (found.includes("CREATING")) {
    console.log(["building", label].join("\t"));
  } else if (found.length > 0) {
    console.log(["broken", label, found.join(",")].join("\t"));
  } else {
    const scope = (index.queryScope || "COLLECTION").toLowerCase().replace(/_/g, "-");
    const args = ["create", "--collection-group=" + index.collectionGroup, "--query-scope=" + scope];
    for (const field of fieldsOf(index.fields)) args.push("--field-config=" + fieldConfig(field));
    console.log(args.join("\t"));
  }
}'

tag=""
site_only=0
while [[ "$#" -gt 0 ]]; do
  case "$1" in
    --tag)
      [[ "$#" -ge 2 ]] || whim_usage_error "--tag needs a commit sha"
      tag="$2"
      shift 2
      ;;
    --site-only)
      site_only=1
      shift
      ;;
    *) whim_usage_error "unknown argument: $1" ;;
  esac
done
if [[ -n "$tag" ]]; then
  [[ "$site_only" -eq 0 ]] || whim_usage_error "--site-only builds no image and takes no --tag"
  [[ "$tag" =~ ^[0-9a-f]{40}$ ]] || whim_usage_error "--tag must be a full 40-character git commit sha"
fi
store_backend="${WHIM_STORE_BACKEND:-firestore}"
case "$store_backend" in
  firestore | sqlite) ;;
  *) whim_fail "WHIM_STORE_BACKEND must be firestore or sqlite, got $store_backend. Nothing was changed." ;;
esac

stage="$(mktemp -d)"
trap 'rm -rf "$stage"' EXIT

server_optional_keys="WHIM_CLARIFY_MODEL WHIM_SUMMARY_MODEL WHIM_PLAN_MODEL WHIM_REPAIR_MODEL WHIM_CLARIFY_REASONING WHIM_REWRITE_REASONING WHIM_SUMMARY_REASONING WHIM_PLAN_REASONING WHIM_ENGINEER_REASONING WHIM_REPAIR_REASONING WHIM_PROVIDER_SORT WHIM_PROVIDER_QUANTIZATIONS WHIM_QUEUE_MAX WHIM_QUEUE_MAX_WAIT_MS WHIM_MIN_BUILD_IOS WHIM_MIN_BUILD_ANDROID WHIM_USAGE_IDLE_DAYS WHIM_BETA_LIMIT_PER_CLIENT_HOUR WHIM_BETA_LIMIT_PER_DAY"

whim_load_values
whim_require_values WHIM_GCP_PROJECT WHIM_GCP_REGION WHIM_RUN_REGION WHIM_API_HOST WHIM_WEB_HOST \
  WHIM_SUPPORT_EMAIL WHIM_ENGINEER_MODEL WHIM_REWRITE_MODEL
[[ "$WHIM_API_HOST" = "api.$WHIM_WEB_HOST" ]] \
  || whim_fail "WHIM_API_HOST must be api.$WHIM_WEB_HOST, got $WHIM_API_HOST"
service_account="$RUN_SERVICE_ACCOUNT_NAME@$WHIM_GCP_PROJECT.iam.gserviceaccount.com"

# A rollback (--tag) needs no checkout state; anything built from HEAD must be committed and pushed.
head_sha=""
if [[ -z "$tag" ]]; then
  [[ -z "$(git -C "$WHIM_REPO_ROOT" status --porcelain)" ]] || whim_fail "the working tree is dirty. Nothing was built or changed."
  head_sha="$(git -C "$WHIM_REPO_ROOT" rev-parse HEAD)"
  [[ -n "$(git -C "$WHIM_REPO_ROOT" branch -r --contains "$head_sha")" ]] \
    || whim_fail "HEAD $head_sha is not pushed. Nothing was built or changed."
fi

# YAML for --env-vars-file: single-quoted, so a comma-separated value stays one value.
yaml_line() {
  printf "%s: '%s'\n" "$1" "${2//\'/\'\'}"
}

# Prints the index plan (INDEX_PLAN_JS) for the database as it is now.
firestore_index_plan() {
  local listed="$stage/firestore-indexes.json"
  whim_gcloud firestore indexes composite list --database="$RUN_FIRESTORE_DATABASE" --format=json >"$listed" \
    || whim_fail "could not list the Firestore indexes. The server was not deployed."
  node -e "$INDEX_PLAN_JS" "$WHIM_DEPLOY_DIR/firestore/indexes.json" "$listed" \
    || whim_fail "could not compare deploy/firestore/indexes.json with the database's indexes. The server was not deployed."
}

# Makes every composite index in deploy/firestore/indexes.json READY before the server deploys. A
# missing index is created, and gcloud waits for it to build. One still building is waited for, up to
# 20 minutes. One in any other state (NEEDS_REPAIR) stops the deploy, naming it. An existing index is
# never changed or deleted.
apply_firestore_indexes() {
  local plan kind index state polls=0 building broken
  local -a create_args
  plan="$(firestore_index_plan)"
  while :; do
    building="" broken=""
    while IFS=$'\t' read -r kind index state; do
      case "$kind" in
        building) building="${building:+$building, }$index" ;;
        broken) broken="${broken:+$broken, }$index is $state" ;;
      esac
    done <<<"$plan"
    [[ -z "$broken" ]] || whim_fail "Firestore index $broken, not READY. Repair or delete it in the console, then deploy again. The server was not deployed."
    [[ -n "$building" ]] || break
    [[ "$polls" -lt "$RUN_INDEX_WAIT_POLLS" ]] \
      || whim_fail "Firestore index $building is still building after $((RUN_INDEX_WAIT_POLLS * RUN_INDEX_WAIT_SECONDS / 60)) minutes. Deploy again once it is READY. The server was not deployed."
    echo "firestore indexes: waiting for $building to finish building"
    sleep "$RUN_INDEX_WAIT_SECONDS"
    polls=$((polls + 1))
    plan="$(firestore_index_plan)"
  done
  if [[ -z "$plan" ]]; then
    echo "firestore indexes: all ready"
    return 0
  fi
  while IFS=$'\t' read -r -a create_args; do
    create_args=("${create_args[@]:1}")
    echo "==> firestore index ${create_args[*]}"
    whim_gcloud firestore indexes composite create --database="$RUN_FIRESTORE_DATABASE" "${create_args[@]}" --quiet \
      || whim_fail "creating a Firestore index failed. The server was not deployed."
  done <<<"$plan"
}

# Points the purge job at the server's image, environment and secret (the image runs with
# NODE_ENV=production, whose config needs them) and lets the scheduler's service account run it,
# then creates or updates the hourly trigger. Every call is create-or-update, so a rerun is a no-op.
deploy_purge_job() {
  local image="$1" env_file="$2" schedule_verb=create
  local run_uri="https://run.googleapis.com/v2/projects/$WHIM_GCP_PROJECT/locations/$WHIM_RUN_REGION/jobs/$RUN_PURGE_JOB:run"
  echo "==> cloud run job $RUN_PURGE_JOB"
  whim_gcloud run jobs deploy "$RUN_PURGE_JOB" --region "$WHIM_RUN_REGION" --image "$image" \
    --command node --args=--enable-source-maps,server/whim-admin.mjs,purge \
    --cpu 1 --memory 512Mi --tasks 1 --max-retries 1 --task-timeout 10m \
    --service-account "$service_account" \
    --env-vars-file "$env_file" --set-secrets "OPENROUTER_API_KEY=$WHIM_OPENROUTER_SECRET_ID:latest" --quiet \
    || whim_fail "deploying the purge job failed. The server is deployed; deploy again to retry the job."
  whim_gcloud run jobs add-iam-policy-binding "$RUN_PURGE_JOB" --region "$WHIM_RUN_REGION" \
    --member "serviceAccount:$service_account" --role roles/run.invoker --quiet >/dev/null \
    || whim_fail "granting $service_account run.invoker on the purge job failed. The server is deployed; deploy again to retry."
  whim_gcloud services enable cloudscheduler.googleapis.com --quiet \
    || whim_fail "enabling Cloud Scheduler failed. The server and the purge job are deployed; deploy again to retry the schedule."
  if whim_gcloud scheduler jobs describe "$RUN_PURGE_SCHEDULE" --location "$WHIM_RUN_REGION" >/dev/null 2>&1; then
    schedule_verb=update
  fi
  echo "==> cloud scheduler $RUN_PURGE_SCHEDULE ($schedule_verb)"
  whim_gcloud scheduler jobs "$schedule_verb" http "$RUN_PURGE_SCHEDULE" --location "$WHIM_RUN_REGION" \
    --schedule "0 * * * *" --time-zone Etc/UTC --uri "$run_uri" --http-method POST \
    --oauth-service-account-email "$service_account" \
    --oauth-token-scope https://www.googleapis.com/auth/cloud-platform --quiet \
    || whim_fail "the purge job's hourly schedule failed. The server and the purge job are deployed; deploy again to retry the schedule."
}

# A --tag deploy: points the existing purge job at the server's environment and secret, leaving its
# image. With no job, warns that retention is not enforced and creates none (the tagged image may
# lack `whim-admin purge`); a plain deploy creates it.
update_purge_job_config() {
  local env_file="$1"
  if ! whim_gcloud run jobs describe "$RUN_PURGE_JOB" --region "$WHIM_RUN_REGION" --format='value(name)' >/dev/null 2>&1; then
    printf '%s: WARNING: no Cloud Run job %s exists, so retention is NOT enforced: nothing purges records past their keep period. Run a plain deploy (no --tag) to create it.\n' \
      "$WHIM_SCRIPT" "$RUN_PURGE_JOB" >&2
    return 0
  fi
  echo "==> cloud run job $RUN_PURGE_JOB (environment and secret; image left as it is)"
  whim_gcloud run jobs update "$RUN_PURGE_JOB" --region "$WHIM_RUN_REGION" \
    --env-vars-file "$env_file" --set-secrets "OPENROUTER_API_KEY=$WHIM_OPENROUTER_SECRET_ID:latest" --quiet \
    || whim_fail "updating the purge job's environment failed. The server is deployed; deploy again to retry the job."
}

# The top-level displayName of a deploy/monitoring JSON file (two-space indent, one key per line).
display_name_of() {
  local name
  name="$(sed -n 's/^  "displayName": "\([^"]*\)",$/\1/p' "$1")"
  [[ -n "$name" ]] || whim_fail "$1 has no top-level displayName"
  printf '%s' "$name"
}

# Prints the fields after the display name (tab-separated) of the one row of $2 whose display name
# is $1, and nothing when there is none. Rows are gcloud `value(displayName,name,...)` lines. $3
# names the rows, for the refusal when two share the display name.
named_row() {
  local found
  found="$(awk -F '\t' -v wanted="$1" '$1 == wanted { sub(/^[^\t]*\t/, ""); print }' <<<"$2")"
  [[ "$found" != *$'\n'* ]] || whim_fail "two $3 are named '$1'; delete one, then deploy again. The server and the purge job are deployed."
  printf '%s' "$found"
}

# Applies the purge job's failure alert as deploy/provision.sh's apply_rendered applies a policy:
# rendered with the alert channel and fingerprinted as provision.sh renders it, it is created when
# no alert policy carries its display name, updated in place when that policy's fingerprint
# (userLabels.whim_spec) differs, and otherwise left alone.
apply_purge_alert() {
  local display channel_display row channel policy policy_spec text spec rendered="$stage/policy-purge-failed.json"
  display="$(display_name_of "$RUN_PURGE_ALERT")"
  channel_display="$(display_name_of "$RUN_ALERT_CHANNEL")"
  row="$(whim_gcloud beta monitoring channels list --format='value(displayName,name)')" \
    || whim_fail "listing the notification channels failed. The server and the purge job are deployed; deploy again to retry the alert."
  row="$(named_row "$channel_display" "$row" "notification channels")"
  channel="${row%%$'\t'*}"
  if [[ -z "$channel" ]]; then
    whim_fail "no notification channel is named '$channel_display', so the purge job's failure alert has nowhere to email. The server and the purge job are deployed. Create the channel, then deploy again:
  sed -e 's/{{ALERT_EMAIL}}/${WHIM_ALERT_EMAIL:-<alert email>}/' -e 's/{{SPEC}}/manual/' deploy/monitoring/channel-email.json >\"\$TMPDIR/whim-channel.json\"
  gcloud --project $WHIM_GCP_PROJECT beta monitoring channels create --channel-content-from-file=\"\$TMPDIR/whim-channel.json\""
  fi
  text="$(<"$RUN_PURGE_ALERT")"
  text="${text//\{\{CHANNEL\}\}/$channel}"
  spec="$(printf '%s' "$text" | git hash-object --stdin)"
  text="${text//\{\{SPEC\}\}/$spec}"
  case "$text" in
    *'{{'*) whim_fail "$RUN_PURGE_ALERT: a {{placeholder}} is left unfilled. The server and the purge job are deployed." ;;
    *) ;;
  esac
  printf '%s\n' "$text" >"$rendered"
  row="$(whim_gcloud monitoring policies list --format='value(displayName,name,userLabels.whim_spec)')" \
    || whim_fail "listing the alert policies failed. The server and the purge job are deployed; deploy again to retry the alert."
  row="$(named_row "$display" "$row" "alert policies")"
  policy="${row%%$'\t'*}"
  policy_spec=""
  [[ "$row" != *$'\t'* ]] || policy_spec="${row#*$'\t'}"
  if [[ -z "$policy" ]]; then
    whim_gcloud monitoring policies create --policy-from-file="$rendered" --format='value(name)' >/dev/null \
      || whim_fail "creating the alert policy '$display' failed. The server and the purge job are deployed; deploy again to retry the alert."
    echo "created alert policy '$display'"
  elif [[ "$policy_spec" != "$spec" ]]; then
    whim_gcloud monitoring policies update "$policy" --policy-from-file="$rendered" >/dev/null \
      || whim_fail "updating the alert policy '$display' failed. The server and the purge job are deployed; deploy again to retry the alert."
    echo "updated alert policy '$display'"
  else
    echo "unchanged alert policy '$display'"
  fi
}

deploy_server() {
  local image_tag="${tag:-$head_sha}" image key env_file="$stage/server-env.yaml"
  image="$(whim_image_ref "$image_tag")"
  if whim_gcloud artifacts docker images describe "$image" >/dev/null 2>&1; then
    echo "image: $image (exists)"
  else
    [[ -z "$tag" ]] || whim_fail "image $image is not in Artifact Registry. Nothing was changed."
    echo "==> cloud build $image"
    whim_gcloud builds submit "$WHIM_REPO_ROOT" --region "$WHIM_GCP_REGION" --config "$WHIM_DEPLOY_DIR/cloudbuild.yaml" \
      --substitutions "COMMIT_SHA=$image_tag,_REGION=$WHIM_GCP_REGION"
  fi
  {
    yaml_line WHIM_ENGINEER_MODEL "$WHIM_ENGINEER_MODEL"
    yaml_line WHIM_REWRITE_MODEL "$WHIM_REWRITE_MODEL"
    # Where the beta signup route redirects: the pages host (beta-waitlist D1).
    yaml_line WHIM_WEB_ORIGIN "https://$WHIM_WEB_HOST"
    yaml_line WHIM_STORE_BACKEND "$store_backend"
    yaml_line WHIM_DATA_DIR /tmp/whim-data
    yaml_line WHIM_DRAIN_TIMEOUT_MS "$RUN_SERVER_DRAIN_MS"
    for key in $server_optional_keys; do
      [[ -z "${!key}" ]] || yaml_line "$key" "${!key}"
    done
  } >"$env_file"
  [[ "$store_backend" != firestore ]] || apply_firestore_indexes
  echo "==> cloud run $RUN_SERVER_SERVICE"
  # gen2: Chromium's namespace sandbox needs it, and boot refuses to listen without the sandbox.
  # One instance at most, so the in-memory daily ceilings stay one set of counters.
  whim_gcloud run deploy "$RUN_SERVER_SERVICE" --region "$WHIM_RUN_REGION" --image "$image" \
    --execution-environment gen2 --port 8787 --cpu 2 --memory 4Gi --cpu-boost \
    --min-instances 0 --max-instances 1 --concurrency 40 --timeout 900 \
    --service-account "$service_account" --allow-unauthenticated \
    --env-vars-file "$env_file" --set-secrets "OPENROUTER_API_KEY=$WHIM_OPENROUTER_SECRET_ID:latest" --quiet
  [[ "$store_backend" = firestore ]] || return 0
  # A rollback leaves the purge job on its image: an older one may predate `whim-admin purge`. Its
  # environment and secret follow the server's, so a configuration change deployed with --tag (a
  # keep period, say) reaches the job too.
  if [[ -n "$tag" ]]; then
    update_purge_job_config "$env_file"
    return 0
  fi
  deploy_purge_job "$image" "$env_file"
  apply_purge_alert
}

deploy_site() {
  local image="$WHIM_GCP_REGION-docker.pkg.dev/$WHIM_GCP_PROJECT/$WHIM_REGISTRY_REPO/site:$head_sha"
  local -a site_env=(env -u WHIM_APP_STORE_URL -u WHIM_PLAY_STORE_URL
    "WHIM_SUPPORT_EMAIL=$WHIM_SUPPORT_EMAIL" "WHIM_BETA_SIGNUP_URL=https://$WHIM_API_HOST/beta/signup"
    "WHIM_ENGINEER_MODEL=$WHIM_ENGINEER_MODEL" "WHIM_REWRITE_MODEL=$WHIM_REWRITE_MODEL")
  [[ -z "$WHIM_APP_STORE_URL" ]] || site_env+=("WHIM_APP_STORE_URL=$WHIM_APP_STORE_URL")
  [[ -z "$WHIM_PLAY_STORE_URL" ]] || site_env+=("WHIM_PLAY_STORE_URL=$WHIM_PLAY_STORE_URL")
  echo "==> site build"
  (cd "$WHIM_REPO_ROOT" && "${site_env[@]}" node server/site.mjs build --out "$stage/site-image/site") \
    || whim_fail "the site build failed. Nothing was changed."
  cp "$WHIM_DEPLOY_DIR/cloudrun/Caddyfile" "$stage/site-image/Caddyfile"
  cp "$WHIM_DEPLOY_DIR/cloudrun/site.Dockerfile" "$stage/site-image/Dockerfile"
  echo "==> cloud build $image"
  whim_gcloud builds submit "$stage/site-image" --region "$WHIM_GCP_REGION" --tag "$image"
  echo "==> cloud run $RUN_SITE_SERVICE"
  whim_gcloud run deploy "$RUN_SITE_SERVICE" --region "$WHIM_RUN_REGION" --image "$image" \
    --port 8080 --cpu 1 --memory 256Mi --min-instances 0 --max-instances 2 --concurrency 80 \
    --service-account "$service_account" --allow-unauthenticated --quiet
}

[[ "$site_only" -eq 1 ]] || deploy_server
[[ -n "$tag" ]] || deploy_site
echo "deployed. Check: https://$WHIM_API_HOST/health and https://$WHIM_WEB_HOST/privacy"
