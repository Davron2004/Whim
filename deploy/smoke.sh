#!/usr/bin/env bash
# Post-deploy smoke checks for Whim (design D17, D20, D21, D22), run from the operator's machine:
#
#   deploy/smoke.sh               DNS, the API, the server container, the pages and association files
#   deploy/smoke.sh --pages-only  DNS, the pages and association files
#
# DNS is checked first. Until both hostnames resolve only to WHIM_STATIC_IP, with no AAAA record,
# smoke stops there and makes no HTTPS request, so a DNS slip reads as a DNS error rather than a
# failed certificate order.
set -euo pipefail

WHIM_SCRIPT=smoke.sh
WHIM_USAGE='usage: deploy/smoke.sh [--pages-only]'
# shellcheck source=deploy/lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

pages_only=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --pages-only)
      pages_only=1
      shift
      ;;
    *) whim_usage_error "unknown argument: $1" ;;
  esac
done

whim_load_values
whim_require_values WHIM_GCP_PROJECT WHIM_GCP_ZONE WHIM_STATIC_IP WHIM_API_HOST WHIM_WEB_HOST
whim_require_host_values
for tool in dig curl; do
  command -v "$tool" >/dev/null 2>&1 || whim_fail "$tool is not on PATH; smoke needs dig and curl"
done

# The minimum builds these values deploy (unset is 0), and the production identity carrying them. A
# load-test server answers with a different service name.
readonly MIN_BUILD_IOS="${WHIM_MIN_BUILD_IOS:-0}"
readonly MIN_BUILD_ANDROID="${WHIM_MIN_BUILD_ANDROID:-0}"
readonly EXPECTED_HEALTH="{\"ok\":true,\"service\":\"whim-server\",\"minBuild\":{\"ios\":$MIN_BUILD_IOS,\"android\":$MIN_BUILD_ANDROID}}"
# Judges the /healthz body on stdin by structure, given the configured iOS and Android minimums as
# arguments, and prints why. Exits 0 when ok is true, the service is whim-server and minBuild holds
# exactly those minimums; 2 when minBuild is absent (a server from before the minimum-build gate,
# e.g. after a rollback) and both minimums are 0, so there is nothing for it to enforce; 1 otherwise.
readonly HEALTH_JS='let healthText = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { healthText += chunk; });
process.stdin.on("end", () => {
  const [iosText, androidText] = process.argv.slice(1);
  const ios = Number(iosText);
  const android = Number(androidText);
  const verdict = (code, reason) => { console.log(reason); process.exit(code); };
  let health;
  try { health = JSON.parse(healthText); } catch { verdict(1, "the body is not JSON"); }
  if (health?.ok !== true || health.service !== "whim-server") verdict(1, "expected ok true from service whim-server");
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
readonly SSE_TIMING_JS='const times = []; let buffer = "";
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
readonly METADATA_JS='fetch("http://169.254.169.254/computeMetadata/v1/", { headers: { "Metadata-Flavor": "Google" }, signal: AbortSignal.timeout(5000) }).then(() => console.log("reachable"), () => console.log("blocked"))'
readonly REACT_NATIVE_JS='process.stdout.write(require("fs").existsSync("/app/node_modules/react-native") ? "present" : "absent")'

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
failures=0

pass() { printf 'ok    %s\n' "$1"; }
flunk() {
  printf 'FAIL  %s\n' "$1" >&2
  failures=$((failures + 1))
}

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
      pass "dns $host -> $WHIM_STATIC_IP, no AAAA"
    else
      printf '%s\n' "$problems" | sed 's/^/FAIL  dns /' >&2
      ready=0
    fi
  done
  [ "$ready" -eq 1 ] || whim_fail "DNS is not ready, so no HTTPS request was made. Point A records for $WHIM_API_HOST and $WHIM_WEB_HOST at $WHIM_STATIC_IP, remove any AAAA record, and rerun."
}

# GETs (or, with extra curl arguments, requests) an HTTPS URL without following redirects. Sets
# PROBE_STATUS, PROBE_TYPE and PROBE_LOCATION; the body lands in $work/body.
probe() {
  local url="$1" meta
  shift
  if ! meta="$(curl -sS --proto '=https' --max-time 20 -o "$work/body" -w '%{http_code}|%{content_type}|%{redirect_url}' "$@" "$url")"; then
    PROBE_STATUS=000
    PROBE_TYPE=""
    PROBE_LOCATION=""
    : >"$work/body"
    return
  fi
  IFS='|' read -r PROBE_STATUS PROBE_TYPE PROBE_LOCATION <<<"$meta"
}

check_health() {
  local url="https://$WHIM_API_HOST/healthz" body verdict code=0
  probe "$url"
  body="$(head -c 300 "$work/body")"
  if [[ "$PROBE_STATUS" != 200 ]]; then
    flunk "api $url answered $PROBE_STATUS '$body', expected 200 $EXPECTED_HEALTH"
    return
  fi
  verdict="$(node -e "$HEALTH_JS" "$MIN_BUILD_IOS" "$MIN_BUILD_ANDROID" <"$work/body")" || code=$?
  case "$code" in
    0) pass "api $url -> $body" ;;
    2) printf 'WARN  api %s answered %s: %s\n' "$url" "$body" "$verdict" >&2 ;;
    *) flunk "api $url answered 200 '$body': ${verdict:-node gave no verdict}; expected $EXPECTED_HEALTH" ;;
  esac
}

check_device_header_required() {
  local url="https://$WHIM_API_HOST/v1/generate"
  probe "$url" -X POST -H 'content-type: application/json' --data '{}'
  if [ "$PROBE_STATUS" = 400 ]; then
    pass "api $url without a device header -> 400"
  else
    flunk "api $url without a device header answered $PROBE_STATUS, expected 400"
  fi
}

check_stream_probe() {
  local url="https://$WHIM_API_HOST/healthz/sse" verdict
  if verdict="$(curl -sS -N --proto '=https' --max-time 20 "$url" | node -e "$SSE_TIMING_JS")"; then
    pass "api $url -> $verdict"
  else
    flunk "api $url -> ${verdict:-no answer}; expected 3 frames about a second apart (is the proxy buffering?)"
  fi
}

check_in_container() {
  local name="$1" script="$2" expected="$3" answer
  if answer="$(whim_vm_ssh "$WHIM_COMPOSE exec -T whim-server node -e $(printf '%q' "$script")")" && [ "$answer" = "$expected" ]; then
    pass "container $name -> $expected"
  else
    flunk "container $name answered '${answer:-nothing}', expected '$expected'"
  fi
}

check_page() {
  local path="$1" expected="$2" url="https://$WHIM_WEB_HOST$1"
  probe "$url"
  if [ "$PROBE_STATUS" = "$expected" ] && [ -z "$PROBE_LOCATION" ] && [[ "$PROBE_TYPE" == text/html* ]]; then
    pass "pages $path -> $expected HTML, no redirect"
  else
    flunk "pages $url answered $PROBE_STATUS ($PROBE_TYPE)${PROBE_LOCATION:+ redirecting to $PROBE_LOCATION}, expected $expected HTML without a redirect"
  fi
}

# Compares an association path with what the published site on the VM carries.
check_association_file() {
  local name="$1" url="https://$WHIM_WEB_HOST/.well-known/$1" published state
  published="$WHIM_VM_SITE_DIR/current/.well-known/$1"
  if ! state="$(whim_vm_ssh "if sudo test -f $published; then echo present; else echo absent; fi")"; then
    flunk "association $name: cannot read the published site on the VM"
    return
  fi
  probe "$url"
  case "$state" in
    present)
      if ! whim_vm_ssh "sudo cat $published" >"$work/published"; then
        flunk "association $name: cannot read the published file on the VM"
      elif [ "$PROBE_STATUS" = 200 ] && [ -z "$PROBE_LOCATION" ] && [[ "$PROBE_TYPE" == application/json* ]] \
        && cmp -s "$work/body" "$work/published"; then
        pass "association $name -> 200 application/json, bytes equal the published file"
      else
        flunk "association $url answered $PROBE_STATUS ($PROBE_TYPE)${PROBE_LOCATION:+ redirecting to $PROBE_LOCATION}; expected 200 application/json with the published bytes"
      fi
      ;;
    absent)
      if [ "$PROBE_STATUS" = 404 ] && [ -z "$PROBE_LOCATION" ]; then
        pass "association $name -> 404 (the published site has none)"
      else
        flunk "association $url answered $PROBE_STATUS; the published site has no such file, so expected 404"
      fi
      ;;
    *) flunk "association $name: unexpected answer from the VM: $state" ;;
  esac
}

check_dns
if [ "$pages_only" -eq 0 ]; then
  check_health
  check_device_header_required
  check_stream_probe
  check_in_container "metadata server egress" "$METADATA_JS" blocked
  check_in_container "react-native in node_modules" "$REACT_NATIVE_JS" absent
fi
check_page /privacy 200
check_page /privacy/v1 200
check_page /terms 200
check_page /fr/privacy 200
check_page /fr/terms 200
check_page /support 200
check_page /a/x 200
check_page /nope 404
check_association_file apple-app-site-association
check_association_file assetlinks.json

[ "$failures" -eq 0 ] || whim_fail "$failures smoke check(s) failed"
echo "smoke.sh: all checks passed"
