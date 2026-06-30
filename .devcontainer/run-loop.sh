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
    # Run as root (-u 0): a fresh named volume mounts ROOT-owned, and the /workspace
    # bind mount shadows the image dir so Docker can't seed node-ownership the usual
    # way — so `npm ci` as the node user hits EACCES. Install as root, then chown the
    # tree to node (the run step reads it :ro as node; world-readable would also do,
    # but explicit ownership avoids any package that drops a non-readable dir).
    docker run --rm -u 0 \
      -v "$REPO":/workspace \
      -v "$VOLUME":/workspace/node_modules \
      -w /workspace "$IMAGE" \
      bash -lc "npm ci && npx playwright install chromium && chown -R node:node node_modules"
    echo "[setup] done."
    ;;

  run)
    shift
    PROMPT="${1:?usage: run-loop.sh run \"<prompt for claude -p>\"}"
    # SUBSCRIPTION auth (Claude Pro/Max), NOT the pay-per-token API. The token is
    # managed BY HAND (long-lived — re-minted ~once a year) and lives in TOKEN_FILE:
    #   line 1: the sk-ant-oat... token
    #   line 2: its expiry date, YYYY-MM-DD (optional — if present we reject past it)
    # We only READ + VALIDATE it here; minting/rotating is a manual step you do on
    # the host (see .devcontainer/README.md). The token is opaque (no embedded
    # expiry), so line 2 is the only way to fail fast on an outdated token.
    TOKEN_FILE="${WHIM_OAUTH_TOKEN_FILE:-$HOME/.config/whim/oauth-token}"
    [ -f "$TOKEN_FILE" ] || { echo "[run] FATAL: no token file at $TOKEN_FILE — create it (see .devcontainer/README.md)." >&2; exit 2; }
    TOKEN="$(sed -n '1p' "$TOKEN_FILE" | tr -d '[:space:]')"
    EXPIRY="$(sed -n '2p' "$TOKEN_FILE" | tr -d '[:space:]')"
    case "$TOKEN" in
      sk-ant-oat*) ;;
      *) echo "[run] FATAL: line 1 of $TOKEN_FILE is not an sk-ant-oat... token (did you paste the setup-token banner instead of just the token?)." >&2; exit 2 ;;
    esac
    if [ -n "$EXPIRY" ] && ! [[ "$(date +%F)" < "$EXPIRY" ]]; then
      echo "[run] FATAL: token expired (expiry $EXPIRY, today $(date +%F)) — re-mint with \`claude setup-token\` and update $TOKEN_FILE." >&2
      exit 2
    fi
    if [ -n "${ANTHROPIC_API_KEY:-}" ]; then
      echo "[run] WARNING: ANTHROPIC_API_KEY is set — NOT forwarding it (it would override the token and bill the API)." >&2
    fi
    LOG_DIR="$REPO/.claude/fixloop"
    mkdir -p "$LOG_DIR"
    LOG="$LOG_DIR/run-$(date +%Y%m%d-%H%M%S).log"
    echo "[run] starting loop (subscription auth, node_modules read-only, egress = Anthropic only)…"
    echo "[run] streaming to: $LOG"
    echo "[run] watch it from another terminal:  tail -f \"$LOG\"   (pretty: see .devcontainer/README.md)"
    # No -it: without a TTY, stdout can pipe to tee. --verbose --output-format
    # stream-json emits the live event stream (tool calls + messages) instead of a
    # single end-of-run dump; 2>&1 folds the firewall output and any errors into the
    # log too. pipefail (set above) surfaces docker's exit code through the pipe.
    docker run --rm \
      --cap-add=NET_ADMIN --cap-add=NET_RAW \
      -e CLAUDE_CODE_OAUTH_TOKEN="$TOKEN" \
      -v "$REPO":/workspace \
      -v "$VOLUME":/workspace/node_modules:ro \
      -w /workspace "$IMAGE" \
      bash -lc 'sudo .devcontainer/init-firewall.sh && exec claude --dangerously-skip-permissions --verbose --output-format stream-json -p "$0"' "$PROMPT" 2>&1 | tee "$LOG"
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
