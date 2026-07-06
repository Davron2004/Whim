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
# "ALLOW *.anthropic.com" — iptables/ipset filter by IP, NOT by hostname, so a
# literal domain wildcard is impossible at this layer. The practical equivalent:
# resolve the known Anthropic hosts and allow the /24 that CONTAINS each resolved
# IP. api/console.anthropic.com both live in Anthropic's OWN registered block
# (160.79.104.0/24 — not a shared CDN), so widening to /24 safely covers every
# *.anthropic.com endpoint on that block AND absorbs IP rotation within it — which
# also retires the earlier "CDN rotating IPs go stale mid-run" limitation. If
# Anthropic ever serves a subdomain from a /24 we haven't resolved, add its host
# below (or its block) and re-run. statsig.anthropic.com is intentionally omitted:
# it's NXDOMAIN (not a real host) and Claude Code runs fine without feature flags.
set -euo pipefail

# Anthropic hosts the loop must reach (each widened to its containing /24 below):
#   api.anthropic.com      — the model API (irreducible; Claude Code needs it)
#   console.anthropic.com  — auth / OAuth (subscription token) flows
ALLOWED_DOMAINS=(api.anthropic.com console.anthropic.com)

echo "[firewall] resetting rules…"
iptables -F
iptables -X || true
ipset destroy anthropic 2>/dev/null || true
ipset create anthropic hash:net   # hash:net so we can store /24 CIDRs, not bare IPs

# Loopback: always allow (local test servers, the SSE bridge, etc.).
iptables -A INPUT  -i lo -j ACCEPT
iptables -A OUTPUT -o lo -j ACCEPT

# DNS: required to resolve the allowlist itself. Allow UDP+TCP/53 outbound.
iptables -A OUTPUT -p udp --dport 53 -j ACCEPT
iptables -A OUTPUT -p tcp --dport 53 -j ACCEPT

# Established/related return traffic.
iptables -A INPUT  -m state --state ESTABLISHED,RELATED -j ACCEPT
iptables -A OUTPUT -m state --state ESTABLISHED,RELATED -j ACCEPT

# Resolve each allowed domain and allow the /24 that contains each A record.
resolved_any=0
for domain in "${ALLOWED_DOMAINS[@]}"; do
  echo "[firewall] resolving $domain…"
  ips="$(dig +short A "$domain" | grep -E '^[0-9.]+$' || true)"
  if [ -z "$ips" ]; then
    echo "[firewall] WARNING: could not resolve $domain (skipping)" >&2
    continue
  fi
  while read -r ip; do
    [ -z "$ip" ] && continue
    net="${ip%.*}.0/24"                       # widen to the containing /24
    ipset add anthropic "$net" 2>/dev/null || true
    echo "[firewall]   + $ip → $net"
    resolved_any=1
  done <<< "$ips"
done
if [ "$resolved_any" -eq 0 ]; then
  echo "[firewall] FATAL: resolved no Anthropic IPs — Claude Code cannot reach the API" >&2
  exit 1
fi

# Allow HTTPS only to the allowed Anthropic /24 block(s).
iptables -A OUTPUT -p tcp --dport 443 -m set --match-set anthropic dst -j ACCEPT

# Default policy: DROP everything else (this is the whole point).
iptables -P INPUT   DROP
iptables -P FORWARD DROP
iptables -P OUTPUT  DROP

echo "[firewall] egress locked to: ${ALLOWED_DOMAINS[*]}"
