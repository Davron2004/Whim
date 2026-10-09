#!/usr/bin/env bash
# The Firestore admission load test (#143; docs/deploy.md, "Firestore stores"). Bursts concurrent
# admissions at the production FirestoreUsageStore and prints a JSON report: p50/p99 admit latency,
# transaction attempts, exhausted retries, and admitted against the limit. It never contacts a
# deployed server.
#
#   deploy/loadtest/firestore-admission.sh [options]
#       against the Firestore emulator of the pinned firebase-tools (no GCP call, no cost)
#   deploy/loadtest/firestore-admission.sh --database whim-loadtest-<suffix> --confirm-spend [--max-ops N] [options]
#       against a throwaway real database, with the operator's Application Default Credentials:
#       the script creates the database in WHIM_GCP_REGION, runs, deletes it on exit (failure and
#       interrupt included), then lists the project's databases and fails if any whim-loadtest-*
#       one remains. It refuses (default), the deployed WHIM_FIRESTORE_DATABASE and every name
#       without the whim-loadtest- prefix, and a cap above LOADTEST_OPERATION_CEILING, before any
#       gcloud call or Firestore client. Every read and write is charged against the cap before it
#       is sent, so a run never sends more operations than the cap.
#
# Options passed to the harness (server/test/firestore-admission-load.ts):
#   --bursts 10,25,50,100      concurrent admissions per burst (each burst gets fresh counters)
#   --profile generate|unary|both   generate admissions, or clarify+rewrite under the shared ceiling
#   --limit N                  the global limit every burst races for (default: 40% of the burst)
#   --json FILE                also write the report to FILE
set -euo pipefail

WHIM_SCRIPT=firestore-admission.sh
WHIM_USAGE='usage: deploy/loadtest/firestore-admission.sh [--bursts N,N,...] [--profile generate|unary|both] [--limit N] [--json FILE]
       deploy/loadtest/firestore-admission.sh --database whim-loadtest-<suffix> --confirm-spend [--max-ops N] [same options]'
# shellcheck source=deploy/lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

# The product owner's hard cap on operations per real-database run, and the default cap. Must match
# OPERATION_CEILING in server/test/firestore-admission-load.ts (server/test/loadtest.suite.ts).
readonly LOADTEST_OPERATION_CEILING=50000
readonly LOADTEST_DEFAULT_OPERATIONS=5000
# The estimate's price per 100,000 operations, in hundredths of a cent: Firestore's highest standard
# per-operation price, a multi-region write at $0.18. Must match USD_PER_100K_OPERATIONS.
readonly LOADTEST_PRICE_PER_100K_CENTI_CENTS=1800
readonly LOADTEST_PREFIX=whim-loadtest-
# After the delete, how long the post-run check waits for the database to leave the list.
readonly LOADTEST_LIST_POLLS=6
readonly LOADTEST_LIST_POLL_SECONDS=10

database=""
confirm_spend=0
max_ops="$LOADTEST_DEFAULT_OPERATIONS"
harness_args=()
while [[ "$#" -gt 0 ]]; do
  case "$1" in
    --database | --max-ops | --bursts | --profile | --limit | --json)
      [[ "$#" -ge 2 && -n "$2" ]] || whim_usage_error "$1 needs a value"
      case "$1" in
        --database) database="$2" ;;
        --max-ops) max_ops="$2" ;;
        --bursts)
          [[ "$2" =~ ^[1-9][0-9]*(,[1-9][0-9]*)*$ ]] || whim_usage_error "--bursts must be comma-separated positive integers, got $2"
          harness_args+=("$1" "$2")
          ;;
        --profile)
          whim_word_in "$2" "generate unary both" || whim_usage_error "--profile must be generate, unary or both, got $2"
          harness_args+=("$1" "$2")
          ;;
        --limit)
          [[ "$2" =~ ^[1-9][0-9]*$ ]] || whim_usage_error "--limit must be a positive integer, got $2"
          harness_args+=("$1" "$2")
          ;;
        --json)
          json_dir="$(cd "$(dirname "$2")" && pwd)" || whim_usage_error "--json: no directory for $2"
          harness_args+=("$1" "$json_dir/$(basename "$2")")
          ;;
      esac
      shift 2
      ;;
    --confirm-spend)
      confirm_spend=1
      shift
      ;;
    *) whim_usage_error "unknown argument: $1" ;;
  esac
done

if [[ -z "$database" ]]; then
  echo "==> Firestore emulator"
  cd "$WHIM_REPO_ROOT"
  exec node scripts/firestore-emulator-test.mjs server/test/firestore-admission.run.mjs ${harness_args[@]+"${harness_args[@]}"}
fi

# ---- Real Firestore: every refusal below happens before any gcloud call or client.

# The database the production server opens: deploy/cloudrun/deploy.sh pins it (the server's default),
# and an operator may name another in the environment.
deployed_database="$(sed -n "s/^readonly RUN_FIRESTORE_DATABASE='\(.*\)'$/\1/p" "$WHIM_DEPLOY_DIR/cloudrun/deploy.sh")"
[[ -n "$deployed_database" ]] || whim_fail "cannot read RUN_FIRESTORE_DATABASE from deploy/cloudrun/deploy.sh. Nothing was created."
for production in '(default)' "$deployed_database" "${WHIM_FIRESTORE_DATABASE:-}"; do
  [[ -z "$production" || "$database" != "$production" ]] \
    || whim_fail "refusing $database: it is the production database. Nothing was created."
done
[[ "$database" == "$LOADTEST_PREFIX"* && "$database" =~ ^[a-z][a-z0-9-]{2,61}[a-z0-9]$ ]] \
  || whim_fail "refusing $database: only a throwaway $LOADTEST_PREFIX<suffix> database (lowercase letters, digits, hyphens) may be load-tested. Nothing was created."
[[ "$max_ops" =~ ^[1-9][0-9]*$ && "${#max_ops}" -le 6 && "$max_ops" -le "$LOADTEST_OPERATION_CEILING" ]] \
  || whim_fail "--max-ops must be an integer from 1 to $LOADTEST_OPERATION_CEILING, got $max_ops. Nothing was created."
centi_cents=$(((max_ops * LOADTEST_PRICE_PER_100K_CENTI_CENTS + 99999) / 100000))
printf '==> cap %s operations: at most $%d.%04d (every operation priced as a multi-region write)\n' \
  "$max_ops" "$((centi_cents / 10000))" "$((centi_cents % 10000))"
[[ "$confirm_spend" -eq 1 ]] || whim_fail "a real-database run spends money; add --confirm-spend to accept the cost above. Nothing was created."

whim_load_values
whim_require_values WHIM_GCP_PROJECT WHIM_GCP_REGION

create_attempted=0
# Deletes the database (once this run has tried to create it: a create that failed half-way, or on a
# leftover of the same name, still leaves nothing behind), then fails unless no whim-loadtest-*
# database is left in the project. Keeps the run's own failure as the exit status.
cleanup() {
  local status=$? listed remaining="" poll
  trap - EXIT
  if [[ "$create_attempted" -eq 1 ]]; then
    echo "==> deleting database $database"
    whim_gcloud firestore databases delete --database="$database" --quiet \
      || { echo "$WHIM_SCRIPT: could not delete database $database; delete it by hand" >&2; [[ "$status" -ne 0 ]] || status=1; }
  fi
  for ((poll = 1; poll <= LOADTEST_LIST_POLLS; poll++)); do
    if ! listed="$(whim_gcloud firestore databases list --format='value(name)')"; then
      remaining="(the database list could not be read)"
    else
      remaining="$(printf '%s\n' "$listed" | grep "/databases/$LOADTEST_PREFIX" || true)"
    fi
    [[ -n "$remaining" && "$poll" -lt "$LOADTEST_LIST_POLLS" ]] || break
    sleep "$LOADTEST_LIST_POLL_SECONDS"
  done
  if [[ -n "$remaining" ]]; then
    printf '%s: a load-test database remains; delete it by hand:\n%s\n' "$WHIM_SCRIPT" "$remaining" >&2
    [[ "$status" -ne 0 ]] || status=1
  else
    echo "==> no $LOADTEST_PREFIX* database remains"
  fi
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

echo "==> creating database $database in $WHIM_GCP_REGION (project $WHIM_GCP_PROJECT)"
create_attempted=1
whim_gcloud firestore databases create --database="$database" --location="$WHIM_GCP_REGION" --type=firestore-native --quiet

cd "$WHIM_REPO_ROOT"
env -u FIRESTORE_EMULATOR_HOST GOOGLE_CLOUD_PROJECT="$WHIM_GCP_PROJECT" \
  node server/test/firestore-admission.run.mjs --database "$database" --max-ops "$max_ops" ${harness_args[@]+"${harness_args[@]}"}
