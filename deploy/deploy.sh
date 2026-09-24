#!/usr/bin/env bash
# Deploys Whim to the VM (design D17, D21, D24, D25), run from a clean, pushed checkout:
#
#   deploy/deploy.sh                 build the image for HEAD (unless it exists) and deploy it
#   deploy/deploy.sh --tag <sha>     deploy an image already in Artifact Registry (rollback, resize)
#   deploy/deploy.sh --site-only     publish the pages site and the Caddyfile; the server is untouched
#
# Values come from deploy/defaults.env, then ~/.config/whim/deploy.env, then the environment.
# Preflight refuses before anything is built or changed: a missing required value, a WHIM_API_HOST
# that isn't api.<WHIM_WEB_HOST>, a Node major other than 22, server values the server's own boot
# parse refuses (such as a keep-period above the disclosure manifest's maximum), a dirty or unpushed
# tree, then (full deploys only) a missing, version-less or empty OpenRouter secret and a VM machine
# type no profile names. The profile is chosen by the VM's machine type; there is no option to pick one.
set -euo pipefail

WHIM_SCRIPT=deploy.sh
WHIM_USAGE='usage: deploy/deploy.sh [--tag <full git commit sha>] [--site-only]'
# shellcheck source=deploy/lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

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
# A --tag deploy is a rollback: it redeploys a PAST commit's image, so building and republishing
# today's checkout's site alongside it would serve pages (e.g. privacy's model-id copy) the rolled-
# back server no longer runs. It touches the server image only; deploy/deploy.sh --site-only moves
# the site separately when that's also wanted (docs/deploy.md, "Rolling back and rotating the key").
rollback=0
[ -z "$tag" ] || rollback=1

stage="$(mktemp -d)"
trap 'rm -rf "$stage"' EXIT
upload="$stage/upload"
mkdir -p "$upload"

head_sha=""
profile=""
profile_file=""
image=""
openrouter_value=""
profile_server_values=()
# The operator values config.env carries when set, after the two model ids it always carries.
server_optional_keys="WHIM_CLARIFY_MODEL WHIM_SUMMARY_MODEL WHIM_PLAN_MODEL WHIM_REPAIR_MODEL WHIM_CLARIFY_REASONING WHIM_REWRITE_REASONING WHIM_SUMMARY_REASONING WHIM_PLAN_REASONING WHIM_ENGINEER_REASONING WHIM_REPAIR_REASONING WHIM_PROVIDER_SORT WHIM_MIN_BUILD_IOS WHIM_MIN_BUILD_ANDROID WHIM_USAGE_IDLE_DAYS"

preflight_values() {
  whim_load_values
  whim_require_values WHIM_GCP_PROJECT WHIM_GCP_REGION WHIM_GCP_ZONE WHIM_STATIC_IP WHIM_API_HOST WHIM_WEB_HOST \
    WHIM_SUPPORT_EMAIL WHIM_ENGINEER_MODEL WHIM_REWRITE_MODEL
  whim_require_host_values
  local key
  for key in WHIM_ENGINEER_MODEL WHIM_REWRITE_MODEL; do
    [[ "${!key}" =~ ^[A-Za-z0-9._:/-]+$ ]] || whim_fail "$key is not a model id: ${!key}"
  done
  for key in WHIM_CLARIFY_MODEL WHIM_SUMMARY_MODEL WHIM_PLAN_MODEL WHIM_REPAIR_MODEL; do
    [[ -z "${!key}" ]] || [[ "${!key}" =~ ^[A-Za-z0-9._:/-]+$ ]] || whim_fail "$key is not a model id: ${!key}"
  done
  for key in WHIM_CLARIFY_REASONING WHIM_REWRITE_REASONING WHIM_SUMMARY_REASONING WHIM_PLAN_REASONING WHIM_ENGINEER_REASONING WHIM_REPAIR_REASONING; do
    [[ -z "${!key}" ]] || case "${!key}" in
      off|on|low|medium|high|default) ;;
      *) whim_fail "$key must be one of off, on, low, medium, high, default: ${!key}" ;;
    esac
  done
  if [[ -n "$WHIM_PROVIDER_SORT" ]]; then
    case "$WHIM_PROVIDER_SORT" in
      price|throughput|latency) ;;
      *) whim_fail "WHIM_PROVIDER_SORT must be one of price, throughput, latency: $WHIM_PROVIDER_SORT" ;;
    esac
  fi
  # The server refuses to boot on anything else, so a typo here would take the API down mid-deploy.
  for key in WHIM_MIN_BUILD_IOS WHIM_MIN_BUILD_ANDROID; do
    [[ -z "${!key}" ]] || [[ "${!key}" =~ ^(0|[1-9][0-9]{0,14})$ ]] \
      || whim_fail "$key must be 0 or a positive integer build number: ${!key}"
  done
}

# Collects a profile line into profile_server_values unless it's a host key (never server env).
collect_profile_server_value() {
  whim_word_in "$1" "$WHIM_PROFILE_HOST_KEYS" || profile_server_values+=("$1=$2")
}

# Runs the server values config.env will carry through the server's own boot parse: it refuses a
# keep-period above the maximum the current disclosure manifest publishes (legal-surface-v2 D9), and
# anything else the server would refuse to boot on, before it can take the API down mid-deploy.
# config.env holds the profile's server lines, then the operator's, so each profile is checked with
# the operator values after its own (a later line wins). The VM's profile isn't known until its
# machine type is read, and a resize can move it to any other, so every profile is checked.
preflight_server_config() {
  local -a values=("WHIM_ENGINEER_MODEL=$WHIM_ENGINEER_MODEL" "WHIM_REWRITE_MODEL=$WHIM_REWRITE_MODEL")
  local key file
  for key in $server_optional_keys; do
    [[ -z "${!key}" ]] || values+=("$key=${!key}")
  done
  for file in "$WHIM_DEPLOY_DIR"/profiles/*.env; do
    [ -f "$file" ] || continue
    profile_server_values=()
    whim_read_env_lines "$file" collect_profile_server_value
    (cd "$WHIM_REPO_ROOT" && node server/config-check.mjs ${profile_server_values[@]+"${profile_server_values[@]}"} "${values[@]}") \
      || whim_fail "the server would refuse these values at boot (above), with profile $(basename "$file" .env)'s lines. Nothing was built or changed."
  done
}

preflight_node() {
  command -v node >/dev/null 2>&1 || whim_fail "node is not on PATH; deploy needs Node 22"
  local version
  version="$(node -p 'process.versions.node')"
  [ "${version%%.*}" = 22 ] || whim_fail "Node $version is running; deploy needs Node 22, the major every gate and the image run"
}

preflight_git() {
  git -C "$WHIM_REPO_ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1 || whim_fail "$WHIM_REPO_ROOT is not a git checkout"
  local status
  status="$(git -C "$WHIM_REPO_ROOT" status --porcelain)"
  [ -z "$status" ] || whim_fail "the working tree has uncommitted or untracked changes; commit and push them first. Nothing was built or changed."
  head_sha="$(git -C "$WHIM_REPO_ROOT" rev-parse HEAD)"
  local remote_branches
  remote_branches="$(git -C "$WHIM_REPO_ROOT" branch -r --contains "$head_sha")"
  [ -n "$remote_branches" ] || whim_fail "commit $head_sha is not on any remote branch; push it first. Nothing was built or changed."
}

# Reads the latest enabled version of the OpenRouter secret into openrouter_value. Never prints it.
preflight_openrouter_key() {
  local secret="$WHIM_OPENROUTER_SECRET_ID" version
  local owner="the owner creates its value ($WHIM_RUNBOOK_KEY_SECTION). Nothing was built or changed."
  whim_gcloud secrets describe "$secret" --format='value(name)' >/dev/null \
    || whim_fail "Secret Manager secret $secret does not exist or is unreadable in project $WHIM_GCP_PROJECT; $owner"
  version="$(whim_gcloud secrets versions list "$secret" --filter='state:ENABLED' --sort-by='~createTime' --limit=1 \
    --format='value(name.basename())')" || whim_fail "cannot list the versions of secret $secret; $owner"
  [ -n "$version" ] || whim_fail "secret $secret has no enabled version; $owner"
  openrouter_value="$(whim_gcloud secrets versions access "$version" --secret "$secret")" \
    || whim_fail "cannot read version $version of secret $secret; $owner"
  case "$openrouter_value" in
    *[![:space:]]*) ;;
    *) whim_fail "secret $secret is empty (version $version); $owner" ;;
  esac
  case "$openrouter_value" in
    *[[:space:]]*) whim_fail "secret $secret holds whitespace or a line break (version $version); $owner" ;;
  esac
}

preflight_profile() {
  local machine_type
  machine_type="$(whim_vm_machine_type)" \
    || whim_fail "cannot read the machine type of VM $WHIM_VM_NAME in $WHIM_GCP_ZONE. Nothing was built or changed."
  [ -n "$machine_type" ] || whim_fail "VM $WHIM_VM_NAME reports no machine type. Nothing was built or changed."
  profile="$(whim_profile_for_machine_type "$machine_type")"
  [ -n "$profile" ] || whim_fail "no profile in deploy/profiles/ names the VM's machine type $machine_type. Nothing was built or changed."
  profile_file="$(whim_profile_file "$profile")"
  echo "profile: $profile ($machine_type)"
}

build_site() {
  local -a site_env=(env -u WHIM_APP_STORE_URL -u WHIM_PLAY_STORE_URL
    "WHIM_SUPPORT_EMAIL=$WHIM_SUPPORT_EMAIL" "WHIM_ENGINEER_MODEL=$WHIM_ENGINEER_MODEL" "WHIM_REWRITE_MODEL=$WHIM_REWRITE_MODEL")
  [ -z "$WHIM_APP_STORE_URL" ] || site_env+=("WHIM_APP_STORE_URL=$WHIM_APP_STORE_URL")
  [ -z "$WHIM_PLAY_STORE_URL" ] || site_env+=("WHIM_PLAY_STORE_URL=$WHIM_PLAY_STORE_URL")
  echo "==> site build"
  (cd "$WHIM_REPO_ROOT" && "${site_env[@]}" node server/site.mjs build --out "$upload/site") \
    || whim_fail "the site build failed. Nothing was built or changed."
}

ensure_image() {
  if [ -n "$tag" ]; then
    image="$(whim_image_ref "$tag")"
    whim_gcloud artifacts docker images describe "$image" >/dev/null \
      || whim_fail "image $image is not in Artifact Registry. Nothing was changed."
    echo "image: $image (existing)"
    return
  fi
  tag="$head_sha"
  image="$(whim_image_ref "$tag")"
  if whim_gcloud artifacts docker images describe "$image" >/dev/null 2>&1; then
    echo "image: $image (already built)"
    return
  fi
  echo "==> cloud build $image"
  whim_gcloud builds submit "$WHIM_REPO_ROOT" --region "$WHIM_GCP_REGION" --config "$WHIM_DEPLOY_DIR/cloudbuild.yaml" \
    --substitutions "COMMIT_SHA=$tag,_REGION=$WHIM_GCP_REGION"
}

append_server_key() {
  whim_word_in "$1" "$WHIM_PROFILE_HOST_KEYS" || printf '%s=%s\n' "$1" "$2" >>"$upload/config.env"
}

stage_server_files() {
  mkdir -p "$upload/seccomp"
  cp "$WHIM_DEPLOY_DIR/compose.yaml" "$upload/compose.yaml"
  cp "$WHIM_DEPLOY_DIR"/seccomp/*.json "$upload/seccomp/"
  : >"$upload/config.env"
  whim_read_env_lines "$profile_file" append_server_key
  printf 'WHIM_ENGINEER_MODEL=%s\nWHIM_REWRITE_MODEL=%s\n' "$WHIM_ENGINEER_MODEL" "$WHIM_REWRITE_MODEL" >>"$upload/config.env"
  local key
  for key in $server_optional_keys; do
    [[ -z "${!key}" ]] || append_server_key "$key" "${!key}"
  done
  local mem_limit shm_size
  whim_profile_lookup "$profile_file" WHIM_SERVER_MEM_LIMIT
  mem_limit="$WHIM_PROFILE_FOUND_VALUE"
  whim_profile_lookup "$profile_file" WHIM_SERVER_SHM_SIZE
  shm_size="$WHIM_PROFILE_FOUND_VALUE"
  [ -n "$mem_limit" ] && [ -n "$shm_size" ] || whim_fail "profile $profile must set WHIM_SERVER_MEM_LIMIT and WHIM_SERVER_SHM_SIZE"
  printf 'WHIM_IMAGE=%s\nWHIM_API_HOST=%s\nWHIM_WEB_HOST=%s\nWHIM_PROFILE=%s\nWHIM_SERVER_MEM_LIMIT=%s\nWHIM_SERVER_SHM_SIZE=%s\n' \
    "$image" "$WHIM_API_HOST" "$WHIM_WEB_HOST" "$profile" "$mem_limit" "$shm_size" >"$upload/compose.env"
}

# Uploads $upload to the VM and prints the remote directory it landed in.
upload_stage() {
  local release="$1" remote="/tmp/whim-deploy-$1"
  cp "$WHIM_DEPLOY_DIR/Caddyfile" "$upload/Caddyfile"
  [ "$site_only" -eq 0 ] || cp "$WHIM_DEPLOY_DIR/compose.yaml" "$upload/compose.yaml"
  echo "==> upload $release" >&2
  whim_gcloud compute scp --zone "$WHIM_GCP_ZONE" --tunnel-through-iap --quiet --recurse "$upload" "$WHIM_VM_NAME:$remote" >&2
  printf '%s' "$remote"
}

# Remote shell text: installs the Caddyfile in place (the caddy bind mount follows the inode) and
# publishes the site as a new release swapped in atomically.
remote_publish_site() {
  local remote="$1" release="$2" site="$WHIM_VM_SITE_DIR"
  cat <<REMOTE
sudo cp $remote/Caddyfile $WHIM_VM_APP_DIR/Caddyfile
sudo chown root:root $WHIM_VM_APP_DIR/Caddyfile
sudo chmod 0644 $WHIM_VM_APP_DIR/Caddyfile
sudo test -d $site/releases
sudo cp -R $remote/site $site/releases/$release
sudo chown -R root:root $site/releases/$release
sudo chmod -R u=rwX,go=rX $site/releases/$release
sudo ln -sfn releases/$release $site/current.next
sudo mv -T $site/current.next $site/current
for old in \$(ls -1 $site/releases | sort -r | tail -n +6); do sudo rm -rf "$site/releases/\$old"; done
REMOTE
}

remote_reload_caddy() {
  local compose="$1"
  cat <<REMOTE
attempt=0
until $compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile; do
  attempt=\$((attempt + 1)); [ "\$attempt" -lt 5 ] || exit 1; sleep 2
done
REMOTE
}

deploy_site_only() {
  local release remote no_server_env
  release="$(date -u +%Y%m%dT%H%M%SZ)-${head_sha:0:12}"
  remote="$(upload_stage "$release")"
  # Before the first full deploy there is no compose .env; Caddy alone then gets its values inline.
  no_server_env="sudo -H env WHIM_IMAGE=none WHIM_PROFILE=none WHIM_SERVER_MEM_LIMIT=1g WHIM_SERVER_SHM_SIZE=1g WHIM_API_HOST=$WHIM_API_HOST WHIM_WEB_HOST=$WHIM_WEB_HOST docker compose --project-directory $WHIM_VM_APP_DIR --file $WHIM_VM_APP_DIR/compose.yaml"
  echo "==> publish site $release, reload caddy"
  whim_vm_ssh "set -eu
sudo test -f $WHIM_VM_APP_DIR/compose.yaml || sudo install -m 0644 -o root -g root $remote/compose.yaml $WHIM_VM_APP_DIR/compose.yaml
$(remote_publish_site "$remote" "$release")
if sudo test -f $WHIM_VM_APP_DIR/.env; then
  sudo sed -i -e 's/^WHIM_API_HOST=.*/WHIM_API_HOST=$WHIM_API_HOST/' -e 's/^WHIM_WEB_HOST=.*/WHIM_WEB_HOST=$WHIM_WEB_HOST/' $WHIM_VM_APP_DIR/.env
  $WHIM_COMPOSE up -d --no-deps caddy
$(remote_reload_caddy "$WHIM_COMPOSE")
else
  $no_server_env up -d --no-deps caddy
$(remote_reload_caddy "$no_server_env")
fi
rm -rf $remote"
  echo "==> smoke (pages)"
  bash "$WHIM_DEPLOY_DIR/smoke.sh" --pages-only
}

deploy_full() {
  local release remote publish=""
  ensure_image
  stage_server_files
  release="$(date -u +%Y%m%dT%H%M%SZ)-${tag:0:12}"
  remote="$(upload_stage "$release")"
  if [ "$rollback" -eq 1 ]; then
    echo "==> rollback: the site is untouched (deploy/deploy.sh --site-only republishes it separately if needed)"
  else
    publish="$(remote_publish_site "$remote" "$release")"
  fi
  echo "==> install compose, seccomp, config$([ "$rollback" -eq 1 ] || echo ' and site') $release"
  whim_vm_ssh "set -eu
sudo install -d -m 0755 -o root -g root $WHIM_VM_APP_DIR $WHIM_VM_APP_DIR/seccomp
sudo install -m 0644 -o root -g root $remote/compose.yaml $WHIM_VM_APP_DIR/compose.yaml
sudo install -m 0644 -o root -g root $remote/seccomp/*.json $WHIM_VM_APP_DIR/seccomp/
sudo install -m 0600 -o root -g root $remote/config.env $WHIM_VM_ETC_DIR/config.env
sudo install -m 0600 -o root -g root $remote/compose.env $WHIM_VM_APP_DIR/.env
$publish
rm -rf $remote"
  echo "==> write $WHIM_VM_ETC_DIR/server.env"
  printf 'OPENROUTER_API_KEY=%s\n' "$openrouter_value" \
    | whim_vm_ssh "sudo sh -c 'umask 077 && cat > $WHIM_VM_ETC_DIR/server.env.next && mv -f $WHIM_VM_ETC_DIR/server.env.next $WHIM_VM_ETC_DIR/server.env'"
  openrouter_value=""
  echo "==> pull, restart through the drain, wait for health"
  whim_vm_ssh "set -eu
$WHIM_COMPOSE pull
$WHIM_COMPOSE up -d --wait --wait-timeout 1200
$(remote_reload_caddy "$WHIM_COMPOSE")"
  echo "==> smoke"
  bash "$WHIM_DEPLOY_DIR/smoke.sh"
}

preflight_values
preflight_node
# The re-consent rule (legal-surface-v2 D3): no deploy while the disclosure manifest widened without a consent-version bump.
(cd "$WHIM_REPO_ROOT" && node scripts/release/run.mjs disclosure-check) || whim_fail "the disclosure release check failed (above). Nothing was built or changed."
preflight_server_config
preflight_git
if [ "$site_only" -eq 1 ]; then
  build_site
  deploy_site_only
else
  preflight_openrouter_key
  preflight_profile
  [ "$rollback" -eq 1 ] || build_site
  deploy_full
fi
echo "deploy.sh: done"
