#!/usr/bin/env bash
# Post-deploy smoke checks for Whim (design D17, D20, D21, D22), run from the operator's machine:
#
#   deploy/smoke.sh                  DNS, the API, the server container, the pages and association files,
#                                    and a trap post to the beta signup route (it stores nothing)
#   deploy/smoke.sh --commit <sha>   the same, and /health must report exactly that commit
#   deploy/smoke.sh --pages-only     DNS, the pages and association files
#
# Standalone, /health may report any full 40-character commit SHA. deploy.sh passes --commit with
# the SHA it just rolled out, so a container still serving the previous image fails, naming both.
#
# DNS is checked first. Until both hostnames resolve only to WHIM_STATIC_IP, with no AAAA record,
# smoke stops there and makes no HTTPS request, so a DNS slip reads as a DNS error rather than a
# failed certificate order.
set -euo pipefail

WHIM_SCRIPT=smoke.sh
WHIM_USAGE='usage: deploy/smoke.sh [--pages-only | --commit <full git commit sha>]'
# shellcheck source=deploy/lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

pages_only=0
expected_commit=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --pages-only)
      pages_only=1
      shift
      ;;
    --commit)
      [[ "$#" -ge 2 ]] || whim_usage_error "--commit needs a commit sha"
      expected_commit="$2"
      shift 2
      ;;
    *) whim_usage_error "unknown argument: $1" ;;
  esac
done
if [[ -n "$expected_commit" ]]; then
  [[ "$pages_only" -eq 0 ]] || whim_usage_error "--pages-only checks no /health, so it takes no --commit"
  [[ "$expected_commit" =~ ^[0-9a-f]{40}$ ]] || whim_usage_error "--commit must be a full 40-character git commit sha"
fi

whim_load_values
whim_require_values WHIM_GCP_PROJECT WHIM_GCP_ZONE WHIM_STATIC_IP WHIM_API_HOST WHIM_WEB_HOST
whim_require_host_values
for tool in dig curl; do
  command -v "$tool" >/dev/null 2>&1 || whim_fail "$tool is not on PATH; smoke needs dig and curl"
done

readonly METADATA_JS='fetch("http://169.254.169.254/computeMetadata/v1/", { headers: { "Metadata-Flavor": "Google" }, signal: AbortSignal.timeout(5000) }).then(() => console.log("reachable"), () => console.log("blocked"))'
readonly REACT_NATIVE_JS='process.stdout.write(require("fs").existsSync("/app/node_modules/react-native") ? "present" : "absent")'

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
WHIM_SMOKE_WORK="$work"

# Prints one line per DNS problem for a hostname, nothing when it resolves only to WHIM_STATIC_IP.
dns_problems() {
  local host="$1" answer a_records aaaa_records
  if ! answer="$(dig +short A "$host")"; then
    printf '%s: the A lookup failed\n' "$host"
    return
  fi
  a_records="$(printf '%s\n' "$answer" | awk '/^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$/' | sort -u | tr '\n' ' ')"
  a_records="${a_records% }"
  if ! answer="$(dig +short AAAA "$host")"; then
    printf '%s: the AAAA lookup failed\n' "$host"
    return
  fi
  aaaa_records="$(printf '%s\n' "$answer" | awk '/:/' | sort -u | tr '\n' ' ')"
  aaaa_records="${aaaa_records% }"
  if [ -z "$a_records" ]; then
    printf '%s: no A record (expected %s)\n' "$host" "$WHIM_STATIC_IP"
  elif [ "$a_records" != "$WHIM_STATIC_IP" ]; then
    printf '%s: A records %s (expected only %s)\n' "$host" "$a_records" "$WHIM_STATIC_IP"
  fi
  if [ -n "$aaaa_records" ]; then
    printf '%s: AAAA records %s (expected none)\n' "$host" "$aaaa_records"
  fi
}

check_dns() {
  local host problems ready=1
  for host in "$WHIM_API_HOST" "$WHIM_WEB_HOST"; do
    problems="$(dns_problems "$host")"
    if [ -z "$problems" ]; then
      whim_smoke_pass "dns $host -> $WHIM_STATIC_IP, no AAAA"
    else
      printf '%s\n' "$problems" | sed 's/^/FAIL  dns /' >&2
      ready=0
    fi
  done
  [ "$ready" -eq 1 ] || whim_fail "DNS is not ready, so no HTTPS request was made. Point A records for $WHIM_API_HOST and $WHIM_WEB_HOST at $WHIM_STATIC_IP, remove any AAAA record, and rerun."
}

check_in_container() {
  local name="$1" script="$2" expected="$3" answer
  if answer="$(whim_vm_ssh "$WHIM_COMPOSE exec -T whim-server node -e $(printf '%q' "$script")")" && [ "$answer" = "$expected" ]; then
    whim_smoke_pass "container $name -> $expected"
  else
    whim_smoke_flunk "container $name answered '${answer:-nothing}', expected '$expected'"
  fi
}

# Compares an association path with what the published site on the VM carries.
check_association_file() {
  local name="$1" published state
  published="$WHIM_VM_SITE_DIR/current/.well-known/$1"
  if ! state="$(whim_vm_ssh "if sudo test -f $published; then echo present; else echo absent; fi")"; then
    whim_smoke_flunk "association $name: cannot read the published site on the VM"
    return
  fi
  case "$state" in
    present)
      if whim_vm_ssh "sudo cat $published" >"$work/published"; then
        whim_smoke_association "$name" present "$work/published"
      else
        whim_smoke_flunk "association $name: cannot read the published file on the VM"
      fi
      ;;
    absent) whim_smoke_association "$name" absent "" ;;
    *) whim_smoke_flunk "association $name: unexpected answer from the VM: $state" ;;
  esac
}

check_dns
if [ "$pages_only" -eq 0 ]; then
  whim_smoke_health "$expected_commit"
  whim_smoke_device_header_required
  whim_smoke_pre_protocol_build_refused
  whim_smoke_stream_probe
  check_in_container "metadata server egress" "$METADATA_JS" blocked
  check_in_container "react-native in node_modules" "$REACT_NATIVE_JS" absent
  whim_smoke_beta_signup_trap
fi
whim_smoke_pages
check_association_file apple-app-site-association
check_association_file assetlinks.json
whim_smoke_finish
