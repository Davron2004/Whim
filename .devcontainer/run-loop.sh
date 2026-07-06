#!/usr/bin/env bash
# Headless / UNATTENDED entry point for the Whim fix loop in its container.
# (The interactive path is `devcontainer up` from .devcontainer/devcontainer.json;
#  this script is for "kick it off and walk away" — the case that made the
#  container necessary, since background/auto-mode never shows a permission prompt.)
#
# Two subcommands:
#   setup          build the image + populate the node_modules volume (needs network; run once)
#   run "<prompt>" run the loop headless: node_modules mounted READ-ONLY, egress
#                  firewalled to Anthropic, claude -p "<prompt>" (e.g. a /fix-loop call)
#
# WHY node_modules :ro here but RW in the devcontainer — with the OS sandbox off
# inside the container, the host's old `denyWrite:["./node_modules"]` guard is gone.
# A read-only mount restores it: nothing in the loop legitimately writes node_modules
# (npm install is hook-denied; npm run build only writes src/runtime/generated +
# build/generated), so :ro closes the node_modules-poison vector for free.
set -euo pipefail

IMAGE=whim-fixloop
VOLUME=whim-node-modules
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

case "${1:-}" in
  setup)
    echo "[setup] building image…"
    docker build -t "$IMAGE" "$REPO/.devcontainer"
    echo "[setup] populating $VOLUME (npm ci + chromium; full network)…"
    docker volume create "$VOLUME" >/dev/null
    # RW + full network here ONLY: hydrate the volume, then it goes read-only for runs.
    docker run --rm \
      -v "$REPO":/workspace \
      -v "$VOLUME":/workspace/node_modules \
      -w /workspace "$IMAGE" \
      bash -lc "npm ci && npx playwright install chromium"
    echo "[setup] done."
    ;;

  run)
    shift
    PROMPT="${1:?usage: run-loop.sh run \"<prompt for claude -p>\"}"
    # SUBSCRIPTION auth, NOT the pay-per-token API. Generate once on the host with
    # `claude setup-token` (needs Claude Pro/Max), then export it. We forward ONLY
    # this token — NOT ANTHROPIC_API_KEY, which would outrank it and bill the API.
    : "${CLAUDE_CODE_OAUTH_TOKEN:?run \`claude setup-token\` on the host, then export CLAUDE_CODE_OAUTH_TOKEN (subscription auth — avoids API billing)}"
    if [ -n "${ANTHROPIC_API_KEY:-}" ]; then
      echo "[run] WARNING: ANTHROPIC_API_KEY is set in your shell — NOT forwarding it (it would override the OAuth token and bill the API)." >&2
    fi
    echo "[run] starting loop (subscription auth, node_modules read-only, egress = Anthropic only)…"
    docker run --rm -it \
      --cap-add=NET_ADMIN --cap-add=NET_RAW \
      -e CLAUDE_CODE_OAUTH_TOKEN \
      -v "$REPO":/workspace \
      -v "$VOLUME":/workspace/node_modules:ro \
      -w /workspace "$IMAGE" \
      bash -lc 'sudo .devcontainer/init-firewall.sh && exec claude --dangerously-skip-permissions -p "$0"' "$PROMPT"
    # NOTE: --dangerously-skip-permissions is SAFE here precisely BECAUSE of the
    # container: untrusted fixer subagents are confined by the egress firewall
    # (Threat C), while Threats A (hooks) and B (integrity/redcheck/fresh-gate/
    # reviewer) still run inside. The flag is what makes "no permission prompts in
    # background" a deliberate property instead of the silent illusion it was on host.
    ;;

  *)
    echo "usage: $0 {setup|run \"<prompt>\"}" >&2
    exit 2
    ;;
esac
