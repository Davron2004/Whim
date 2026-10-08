#!/usr/bin/env bash
# Deploys Whim to Cloud Run, scaled to zero when idle (docs/deploy.md, "Cloud Run"). Run from a
# clean, pushed checkout:
#
#   deploy/cloudrun/deploy.sh                 the server image for HEAD (built unless it exists) and the pages site
#   deploy/cloudrun/deploy.sh --tag <sha>     the server only, from an image already in Artifact Registry (rollback)
#   deploy/cloudrun/deploy.sh --site-only     the pages site only; the server is untouched
#
# Values come from deploy/defaults.env, then ~/.config/whim/deploy.env, then the environment, as for
# the VM deploy. Two services: whim-server (the API host) and whim-site (Caddy serving the rendered
# pages). Both run as the whim-run service account, which can read the OpenRouter secret and use
# Firestore. The server keeps usage, reports and waitlist rows in the project's Firestore database
# (WHIM_STORE_BACKEND=firestore). WHIM_STORE_BACKEND=sqlite in the environment deploys the server on
# SQLite stores under /tmp instead, which last only as long as the instance (the rollback).
set -euo pipefail

WHIM_SCRIPT=cloudrun/deploy.sh
WHIM_USAGE='usage: deploy/cloudrun/deploy.sh [--tag <full git commit sha>] [--site-only]'
# shellcheck source=deploy/lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

readonly RUN_SERVER_SERVICE=whim-server
readonly RUN_SITE_SERVICE=whim-site
readonly RUN_SERVICE_ACCOUNT_NAME=whim-run
# The server's drain must finish inside Cloud Run's 10 s SIGTERM grace. Cloud Run only stops an idle
# instance, so there is normally nothing to drain.
readonly RUN_SERVER_DRAIN_MS=8000
# The server's default WHIM_FIRESTORE_DATABASE, so the server env does not set it.
readonly RUN_FIRESTORE_DATABASE='(default)'
# Reads deploy/firestore/indexes.json (argv[1]) and gcloud's JSON list of the database's composite
# indexes (argv[2]); prints one tab-separated line of `gcloud firestore indexes composite create`
# arguments per wanted index the database lacks. Indexes match on collection group, query scope and
# fields in order; the API appends __name__ to a listed index's fields, so a trailing __name__ is
# ignored on both sides.
readonly MISSING_INDEXES_JS='const indexFile = process.argv[1];
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
const present = new Set(listed.map((index) => key((/\/collectionGroups\/([^/]+)\//.exec(index.name) || [])[1], index.queryScope, index.fields)));
for (const index of wanted) {
  if (present.has(key(index.collectionGroup, index.queryScope, index.fields))) continue;
  const scope = (index.queryScope || "COLLECTION").toLowerCase().replace(/_/g, "-");
  const args = ["--collection-group=" + index.collectionGroup, "--query-scope=" + scope];
  for (const field of fieldsOf(index.fields)) args.push("--field-config=" + fieldConfig(field));
  console.log(args.join("\t"));
}'

tag=""
site_only=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --tag)
      [ "$#" -ge 2 ] || whim_usage_error "--tag needs a commit sha"
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
if [ -n "$tag" ]; then
  [ "$site_only" -eq 0 ] || whim_usage_error "--site-only builds no image and takes no --tag"
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
[ "$WHIM_API_HOST" = "api.$WHIM_WEB_HOST" ] \
  || whim_fail "WHIM_API_HOST must be api.$WHIM_WEB_HOST, got $WHIM_API_HOST"
service_account="$RUN_SERVICE_ACCOUNT_NAME@$WHIM_GCP_PROJECT.iam.gserviceaccount.com"

# A rollback (--tag) needs no checkout state; anything built from HEAD must be committed and pushed.
head_sha=""
if [ -z "$tag" ]; then
  [ -z "$(git -C "$WHIM_REPO_ROOT" status --porcelain)" ] || whim_fail "the working tree is dirty. Nothing was built or changed."
  head_sha="$(git -C "$WHIM_REPO_ROOT" rev-parse HEAD)"
  [ -n "$(git -C "$WHIM_REPO_ROOT" branch -r --contains "$head_sha")" ] \
    || whim_fail "HEAD $head_sha is not pushed. Nothing was built or changed."
fi

# YAML for --env-vars-file: single-quoted, so a comma-separated value stays one value.
yaml_line() {
  printf "%s: '%s'\n" "$1" "${2//\'/\'\'}"
}

# Creates each composite index in deploy/firestore/indexes.json that the database lacks. An existing
# index is never changed or deleted. gcloud waits for each new index to finish building, so the
# server never runs a query its index does not serve yet.
apply_firestore_indexes() {
  local listed="$stage/firestore-indexes.json" missing
  local -a create_args
  whim_gcloud firestore indexes composite list --database="$RUN_FIRESTORE_DATABASE" --format=json >"$listed" \
    || whim_fail "could not list the Firestore indexes. The server was not deployed."
  missing="$(node -e "$MISSING_INDEXES_JS" "$WHIM_DEPLOY_DIR/firestore/indexes.json" "$listed")" \
    || whim_fail "could not compare deploy/firestore/indexes.json with the database's indexes. The server was not deployed."
  if [ -z "$missing" ]; then
    echo "firestore indexes: all present"
    return 0
  fi
  while IFS=$'\t' read -r -a create_args; do
    echo "==> firestore index ${create_args[*]}"
    whim_gcloud firestore indexes composite create --database="$RUN_FIRESTORE_DATABASE" "${create_args[@]}" --quiet \
      || whim_fail "creating a Firestore index failed. The server was not deployed."
  done <<<"$missing"
}

deploy_server() {
  local image_tag="${tag:-$head_sha}" image key env_file="$stage/server-env.yaml"
  image="$(whim_image_ref "$image_tag")"
  if whim_gcloud artifacts docker images describe "$image" >/dev/null 2>&1; then
    echo "image: $image (exists)"
  else
    [ -z "$tag" ] || whim_fail "image $image is not in Artifact Registry. Nothing was changed."
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
  [ "$store_backend" != firestore ] || apply_firestore_indexes
  echo "==> cloud run $RUN_SERVER_SERVICE"
  # gen2: Chromium's namespace sandbox needs it, and boot refuses to listen without the sandbox.
  # One instance at most, so the in-memory daily ceilings stay one set of counters.
  whim_gcloud run deploy "$RUN_SERVER_SERVICE" --region "$WHIM_RUN_REGION" --image "$image" \
    --execution-environment gen2 --port 8787 --cpu 2 --memory 4Gi --cpu-boost \
    --min-instances 0 --max-instances 1 --concurrency 40 --timeout 900 \
    --service-account "$service_account" --allow-unauthenticated \
    --env-vars-file "$env_file" --set-secrets "OPENROUTER_API_KEY=$WHIM_OPENROUTER_SECRET_ID:latest" --quiet
}

deploy_site() {
  local image="$WHIM_GCP_REGION-docker.pkg.dev/$WHIM_GCP_PROJECT/$WHIM_REGISTRY_REPO/site:$head_sha"
  local -a site_env=(env -u WHIM_APP_STORE_URL -u WHIM_PLAY_STORE_URL
    "WHIM_SUPPORT_EMAIL=$WHIM_SUPPORT_EMAIL" "WHIM_BETA_SIGNUP_URL=https://$WHIM_API_HOST/beta/signup"
    "WHIM_ENGINEER_MODEL=$WHIM_ENGINEER_MODEL" "WHIM_REWRITE_MODEL=$WHIM_REWRITE_MODEL")
  [ -z "$WHIM_APP_STORE_URL" ] || site_env+=("WHIM_APP_STORE_URL=$WHIM_APP_STORE_URL")
  [ -z "$WHIM_PLAY_STORE_URL" ] || site_env+=("WHIM_PLAY_STORE_URL=$WHIM_PLAY_STORE_URL")
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

[ "$site_only" -eq 1 ] || deploy_server
[ -n "$tag" ] || deploy_site
echo "deployed. Check: https://$WHIM_API_HOST/health and https://$WHIM_WEB_HOST/privacy"
