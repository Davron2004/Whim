#!/usr/bin/env bash
# FAST verification gate — inner loop. Exit 0 = the fast checks pass.
#
# Runs on every fixer attempt, in the fixer's worktree: build (≈0.3s — writes the gitignored
# src/runtime/generated/* a fresh worktree lacks) + typecheck + lint + the Node acceptance
# suites + scaffolding tripwires. NO Metro, NO headless Chromium — those live in gate-full.sh,
# which the orchestrator runs once per fix before merge. See docs/parallel-fix-loop.md §4.3.
#
# Still the single source of truth for "fast done": implementers must pass it before finishing,
# and the dispatcher trusts its exit code over any prose report.
# This file is human-edited only (protect-harness.sh blocks agents).
set -u
cd "$(dirname "$0")/.." || exit 2

# Tamper tripwire (anti-reward-hacking capstone), now pinned to a BASE commit instead of HEAD.
# Refuse to run if any verification-config file differs from the trusted baseline. GATE_BASE is
# the worktree's recorded base SHA (exported by the orchestrator); it falls back to HEAD for a
# plain main-tree run. Pinning to a recorded SHA — not HEAD — is what survives agents having
# commit rights: a `git commit` can move HEAD, but it cannot move a recorded SHA (objects are
# content-addressed), so a tampered config can never reach a green run. To make a legit change:
# a human edits the file and commits it deliberately (which advances the baseline).
BASE="${GATE_BASE:-HEAD}"
CONFIG_SET=(
  package.json package-lock.json tsconfig*.json
  eslint.config.* .eslintrc* .eslintignore knip.json knip.config.*
  scripts/gate.sh scripts/gate-full.sh
  .claude/hooks .claude/settings.json .claude/agents .claude/commands
  babel.config.js metro.config.js
  build   # the build harness is executed (npm run build, below) — refuse to run tampered build code
)
if ! git diff --quiet "$BASE" -- "${CONFIG_SET[@]}" 2>/dev/null; then
  echo "GATE REFUSING TO RUN: verification config (or a harness hook) differs from baseline ($BASE)."
  echo "These are human-edited and must be a deliberate human change before the gate will run:"
  git --no-pager diff --name-only "$BASE" -- "${CONFIG_SET[@]}" 2>/dev/null
  exit 2
fi

FAILED=()

section() { printf '\n== %s\n' "$1"; }
check() {
  local name="$1"; shift
  section "$name"
  if "$@"; then echo "PASS: $name"; else echo "FAIL: $name"; FAILED+=("$name"); fi
}

# build first: ≈0.3s (esbuild), and it writes the gitignored src/runtime/generated/* that
# typecheck imports (useMiniAppHost / LauncherRoot / DevProbeScreen) and that Metro + the
# invariants read. A fresh worktree has none of these. Cheap enough to rerun every attempt,
# which also keeps generated current with the fix.
check "build"             npm run -s build
check "typecheck"         npm run -s typecheck
check "lint"              npm run -s lint -- --max-warnings 0
check "version-store"     npm run -s vstore:test
check "storage-engine"    npm run -s storage:test
check "capability-bridge" npm run -s bridge:test
check "launcher"          npm run -s launcher:test
check "server"            npm run -s server:test

# Scaffolding tripwires: cheap greps for the garbage class you've already met. Every new garbage
# pattern the critic/reviewer finds gets a grep line here. Curate it; don't let stale patterns block.
section "scaffolding tripwires"
TRIPWIRE=$(grep -rn --include='*.ts' --include='*.tsx' \
  -e 'TEMP:' -e 'HACK:' -e 'isImplemented' -e 'IS_IMPLEMENTED' \
  -e 'console\.log(.*debug' \
  src/ 2>/dev/null || true)
if [[ -n "$TRIPWIRE" ]]; then
  echo "$TRIPWIRE"
  echo "FAIL: scaffolding tripwires"
  FAILED+=("scaffolding tripwires")
else
  echo "PASS: scaffolding tripwires"
fi

if [[ ${#FAILED[@]} -gt 0 ]]; then
  printf '\nFAST GATE FAILED: %s\n' "${FAILED[*]}"
  exit 1
fi
printf '\nFAST GATE PASSED\n'
exit 0
