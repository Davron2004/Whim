#!/usr/bin/env bash
# Egress firewall for traffic leaving the Whim container network (design D17). Installed by
# deploy/vm/bootstrap.sh as /usr/local/sbin/whim-egress.sh and run at boot by whim-egress.service.
# Idempotent: every run rebuilds the WHIM-EGRESS chain and leaves exactly one jump to it at the top
# of DOCKER-USER.
set -euo pipefail

# The fixed bridge subnet deploy/compose.yaml declares for the `whim` network. The bridge is
# IPv4-only (no ipv6 subnet in compose.yaml's ipam) — the ip6tables chain below exists so that IPv6
# being enabled on it later (accidentally or otherwise) inherits the same posture instead of
# bypassing every drop rule above, including the metadata-server one.
readonly SUBNET=172.31.250.0/24
readonly CHAIN=WHIM-EGRESS
readonly CHAIN6=WHIM-EGRESS6
readonly DROPPED=(169.254.169.254/32 10.0.0.0/8 172.16.0.0/12 192.168.0.0/16 100.64.0.0/10 169.254.0.0/16)
# GCE's IPv6 metadata-server address (the fd00:ec2::254 equivalent of 169.254.169.254).
readonly DROPPED6=(fd00:ec2::254/128)

ipt() { iptables -w "$@"; }
ipt6() { ip6tables -w "$@"; }

# Bridged container-to-container traffic (Caddy to the server) crosses FORWARD only with this on.
modprobe br_netfilter

ipt -n -L DOCKER-USER >/dev/null 2>&1 || ipt -N DOCKER-USER
ipt -n -L "$CHAIN" >/dev/null 2>&1 || ipt -N "$CHAIN"
ipt -F "$CHAIN"

# 1. Replies on connections already allowed (for example Caddy answering a client).
ipt -A "$CHAIN" -m conntrack --ctstate ESTABLISHED,RELATED -j RETURN
# 2. The deployment's own containers.
ipt -A "$CHAIN" -d "$SUBNET" -j RETURN
# 3. The metadata server, private, carrier-grade NAT and link-local ranges.
for destination in "${DROPPED[@]}"; do
  ipt -A "$CHAIN" -d "$destination" -j DROP
done
# 4. HTTPS and DNS to anything else.
ipt -A "$CHAIN" -p tcp --dport 443 -j RETURN
ipt -A "$CHAIN" -p udp --dport 53 -j RETURN
ipt -A "$CHAIN" -p tcp --dport 53 -j RETURN
# 5. Everything else.
ipt -A "$CHAIN" -j DROP

while ipt -D DOCKER-USER -s "$SUBNET" -j "$CHAIN" 2>/dev/null; do :; done
ipt -I DOCKER-USER 1 -s "$SUBNET" -j "$CHAIN"
echo "whim-egress: $CHAIN installed for $SUBNET"

ipt6 -n -L DOCKER-USER >/dev/null 2>&1 || ipt6 -N DOCKER-USER
ipt6 -n -L "$CHAIN6" >/dev/null 2>&1 || ipt6 -N "$CHAIN6"
ipt6 -F "$CHAIN6"

# Mirrors the IPv4 chain above (established replies, the metadata-server drop, HTTPS/DNS, then drop
# everything else) — no per-subnet RETURN, since the bridge carries no IPv6 container traffic today.
ipt6 -A "$CHAIN6" -m conntrack --ctstate ESTABLISHED,RELATED -j RETURN
for destination in "${DROPPED6[@]}"; do
  ipt6 -A "$CHAIN6" -d "$destination" -j DROP
done
ipt6 -A "$CHAIN6" -p tcp --dport 443 -j RETURN
ipt6 -A "$CHAIN6" -p udp --dport 53 -j RETURN
ipt6 -A "$CHAIN6" -p tcp --dport 53 -j RETURN
ipt6 -A "$CHAIN6" -j DROP

# Matched by input interface, not subnet: the whim network has no IPv6 subnet configured, and this
# VM runs no other Docker bridge, so every docker-managed bridge interface (br-*) is ours.
while ipt6 -D DOCKER-USER -i br-+ -j "$CHAIN6" 2>/dev/null; do :; done
ipt6 -I DOCKER-USER 1 -i br-+ -j "$CHAIN6"
echo "whim-egress: $CHAIN6 (ip6tables) installed"
