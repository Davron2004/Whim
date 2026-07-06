#!/usr/bin/env bash
# Lock the container's egress to ANTHROPIC ONLY. This is the fix loop's
# Threat-C boundary (arbitrary execution / exfil) — it replaces the macOS
# Seatbelt sandbox, whose excludedCommands carve-outs (Chromium, fixloop.sh)
# left holes. With egress denied to everything but Anthropic, code running
# freely inside has nowhere to exfil to.
#
# Runs at every container start (iptables/ipset state does not persist).
# Requires NET_ADMIN + NET_RAW (granted via devcontainer runArgs / run-loop.sh).
#
# KNOWN LIMITATION: api.anthropic.com sits behind a CDN with rotating IPs. We
# resolve + pin the IP set at apply time. A run spanning hours could see the IP
# set go stale (Anthropic calls start failing). Re-run this script to refresh,
# or widen the allowlist to the CDN range if that ever bites. Resolve-at-start
# is fine for the minutes-to-an-hour the loop normally takes.
set -euo pipefail

# Hosts the loop is allowed to reach. Anthropic only (per the egress decision):
#   api.anthropic.com      — the model API (irreducible; Claude Code needs it)
#   statsig.anthropic.com  — feature flags (non-fatal if missing, but cheap to allow)
#   console.anthropic.com  — auth / OAuth flows
ALLOWED_DOMAINS=(api.anthropic.com statsig.anthropic.com console.anthropic.com)

echo "[firewall] resetting rules…"
iptables -F
iptables -X || true
ipset destroy anthropic 2>/dev/null || true
ipset create anthropic hash:ip

# Loopback: always allow (local test servers, the SSE bridge, etc.).
iptables -A INPUT  -i lo -j ACCEPT
iptables -A OUTPUT -o lo -j ACCEPT

# DNS: required to resolve the allowlist itself. Allow UDP+TCP/53 outbound.
iptables -A OUTPUT -p udp --dport 53 -j ACCEPT
iptables -A OUTPUT -p tcp --dport 53 -j ACCEPT

# Established/related return traffic.
iptables -A INPUT  -m state --state ESTABLISHED,RELATED -j ACCEPT
iptables -A OUTPUT -m state --state ESTABLISHED,RELATED -j ACCEPT

# Resolve each allowed domain and pin every A record into the ipset.
for domain in "${ALLOWED_DOMAINS[@]}"; do
  echo "[firewall] resolving $domain…"
  ips="$(dig +short A "$domain" | grep -E '^[0-9.]+$' || true)"
  if [ -z "$ips" ]; then
    echo "[firewall] WARNING: could not resolve $domain — Anthropic calls may fail" >&2
    continue
  fi
  while read -r ip; do
    [ -n "$ip" ] && ipset add anthropic "$ip" 2>/dev/null || true
    echo "[firewall]   + $ip"
  done <<< "$ips"
done

# Allow HTTPS only to the pinned Anthropic IPs.
iptables -A OUTPUT -p tcp --dport 443 -m set --match-set anthropic dst -j ACCEPT

# Default policy: DROP everything else (this is the whole point).
iptables -P INPUT   DROP
iptables -P FORWARD DROP
iptables -P OUTPUT  DROP

echo "[firewall] egress locked to: ${ALLOWED_DOMAINS[*]}"
