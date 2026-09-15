#!/usr/bin/env bash
# Egress firewall for traffic leaving the Whim container network (design D17). Installed by
# deploy/vm/bootstrap.sh as /usr/local/sbin/whim-egress.sh and run at boot by whim-egress.service.
# Idempotent: every run rebuilds the WHIM-EGRESS chain and leaves exactly one jump to it at the top
# of DOCKER-USER.
set -euo pipefail

# The fixed bridge subnet deploy/compose.yaml declares for the `whim` network.
readonly SUBNET=172.31.250.0/24
readonly CHAIN=WHIM-EGRESS
readonly DROPPED=(169.254.169.254/32 10.0.0.0/8 172.16.0.0/12 192.168.0.0/16 100.64.0.0/10 169.254.0.0/16)

ipt() { iptables -w "$@"; }

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
