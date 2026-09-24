#!/usr/bin/env bash
# One-time setup of the Whim VM (design D17, D21, D24). Run as root on the Debian 12 VM from a copy
# of deploy/vm/, after deploy/provision.sh created the VM:
#
#   sudo bash bootstrap.sh --region <gcp-region>
#
# Installs Docker Engine and the compose plugin, the Artifact Registry credential helper, mounts the
# persistent data disk (formatting it only when it has no filesystem), creates the owned data
# directories, asserts unprivileged user namespaces work (Chromium's sandbox needs them), installs
# the egress firewall and the daily container-log age cap. Safe to rerun.
set -euo pipefail

readonly DATA_DEVICE=/dev/disk/by-id/google-whim-data
readonly DATA_MOUNT=/mnt/disks/whim-data
readonly SERVER_UID=10001
readonly DOCKER_KEY_FINGERPRINT=9DC858229FC7DD38854AE2D88D81803C0EBFCD88

fail() {
  printf 'bootstrap.sh: %s\n' "$1" >&2
  exit 1
}

usage() {
  printf 'usage: sudo bash bootstrap.sh --region <gcp-region>\n' >&2
  exit 2
}

region=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --region)
      [ "$#" -ge 2 ] || usage
      region="$2"
      shift 2
      ;;
    *) usage ;;
  esac
done
[ -n "$region" ] || usage
[ "$(id -u)" -eq 0 ] || fail "run as root (sudo bash bootstrap.sh --region $region)"

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

install_docker() {
  if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    echo "docker and the compose plugin are already installed"
    return
  fi
  apt-get update
  apt-get install -y ca-certificates curl gnupg
  install -d -m 0755 /etc/apt/keyrings
  curl -fsSL --proto '=https' --proto-redir '=https' https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc
  local fingerprint
  fingerprint="$(gpg --show-keys --with-colons /etc/apt/keyrings/docker.asc | awk -F: '$1 == "fpr" { print $10; exit }')"
  [ "$fingerprint" = "$DOCKER_KEY_FINGERPRINT" ] || fail "Docker's apt key has fingerprint '$fingerprint', expected $DOCKER_KEY_FINGERPRINT"
  chmod a+r /etc/apt/keyrings/docker.asc
  local codename
  codename="$(. /etc/os-release && printf '%s' "$VERSION_CODENAME")"
  printf 'deb [arch=%s signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian %s stable\n' \
    "$(dpkg --print-architecture)" "$codename" >/etc/apt/sources.list.d/docker.list
  apt-get update
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
  systemctl enable --now docker
}

configure_registry() {
  command -v gcloud >/dev/null 2>&1 || fail "gcloud is missing; the Debian 12 GCE image ships it"
  # Root pulls images; the helper authenticates as the VM's service account (artifactregistry.reader).
  gcloud auth configure-docker "${region}-docker.pkg.dev" --quiet
}

mount_data_disk() {
  [ -b "$DATA_DEVICE" ] || fail "the data disk $DATA_DEVICE is not attached"
  if ! blkid -o value -s TYPE "$DATA_DEVICE" >/dev/null 2>&1; then
    echo "formatting the empty data disk $DATA_DEVICE"
    mkfs.ext4 -m 0 -E lazy_itable_init=0,lazy_journal_init=0,discard "$DATA_DEVICE"
  fi
  local uuid
  uuid="$(blkid -o value -s UUID "$DATA_DEVICE")"
  [ -n "$uuid" ] || fail "cannot read the filesystem UUID of $DATA_DEVICE"
  install -d -m 0755 "$DATA_MOUNT"
  if ! grep -q "^UUID=$uuid " /etc/fstab; then
    printf 'UUID=%s %s ext4 discard,defaults,nofail 0 2\n' "$uuid" "$DATA_MOUNT" >>/etc/fstab
  fi
  mountpoint -q "$DATA_MOUNT" || mount "$DATA_MOUNT"
}

create_directories() {
  # The server's data (usage and report stores), owned by the container's uid only.
  install -d -m 0700 -o "$SERVER_UID" -g "$SERVER_UID" "$DATA_MOUNT/server"
  # Caddy's certificates and ACME state.
  install -d -m 0700 -o root -g root "$DATA_MOUNT/caddy"
  # Published site releases; `current` is a symlink deploy.sh swaps. Caddy mounts this read-only.
  install -d -m 0755 -o root -g root "$DATA_MOUNT/site" "$DATA_MOUNT/site/releases"
  # Root-only server environment (config.env, server.env).
  install -d -m 0700 -o root -g root /etc/whim
  # compose.yaml, Caddyfile, seccomp/ and the compose .env.
  install -d -m 0755 -o root -g root /opt/whim /opt/whim/seccomp
}

assert_user_namespaces() {
  local max
  max="$(cat /proc/sys/user/max_user_namespaces)"
  [ "$max" -gt 0 ] || fail "user.max_user_namespaces is $max; Chromium's sandbox needs unprivileged user namespaces"
  if [ -r /proc/sys/kernel/unprivileged_userns_clone ] && [ "$(cat /proc/sys/kernel/unprivileged_userns_clone)" != 1 ]; then
    fail "kernel.unprivileged_userns_clone is off; Chromium's sandbox needs unprivileged user namespaces"
  fi
  if [ -r /proc/sys/kernel/apparmor_restrict_unprivileged_userns ] && [ "$(cat /proc/sys/kernel/apparmor_restrict_unprivileged_userns)" != 0 ]; then
    fail "kernel.apparmor_restrict_unprivileged_userns is on; Chromium's sandbox needs unprivileged user namespaces"
  fi
  setpriv --reuid=65534 --regid=65534 --clear-groups unshare --user --map-root-user true \
    || fail "an unprivileged user cannot create a user namespace; Chromium's sandbox would not start"
  echo "unprivileged user namespaces work"
}

install_egress_firewall() {
  install -m 0755 -o root -g root "$here/whim-egress.sh" /usr/local/sbin/whim-egress.sh
  install -m 0644 -o root -g root "$here/whim-egress.service" /etc/systemd/system/whim-egress.service
  systemctl daemon-reload
  systemctl enable whim-egress.service
  systemctl restart whim-egress.service
}

# The `whim` bridge (compose.yaml) declares no IPv6 subnet, so it stays IPv4-only unless something
# enables IPv6 on it explicitly. The firewall mirrors its restrictions for IPv6, but the deployed
# bridge must still match compose's IPv4-only configuration. Safe before the network exists (a
# rerun after the first `docker compose up`, or bootstrap running again, is when this can catch it).
assert_bridge_no_ipv6() {
  command -v docker >/dev/null 2>&1 || return 0
  docker network inspect whim >/dev/null 2>&1 || return 0
  local enabled
  enabled="$(docker network inspect whim --format '{{.EnableIPv6}}')"
  [ "$enabled" != "true" ] || fail "the whim Docker bridge has IPv6 enabled; compose requires an IPv4-only bridge"
}

# compose.yaml rotates the containers' logs by size only; this daily job enforces the policy's 90 days.
install_log_age_cap() {
  install -m 0755 -o root -g root "$here/log-age-cap.sh" /usr/local/sbin/whim-log-age-cap.sh
  install -m 0644 -o root -g root "$here/whim-log-age-cap.service" /etc/systemd/system/whim-log-age-cap.service
  install -m 0644 -o root -g root "$here/whim-log-age-cap.timer" /etc/systemd/system/whim-log-age-cap.timer
  systemctl daemon-reload
  systemctl enable --now whim-log-age-cap.timer
}

install_docker
configure_registry
mount_data_disk
create_directories
assert_user_namespaces
assert_bridge_no_ipv6
install_egress_firewall
install_log_age_cap
echo "bootstrap.sh: done"
