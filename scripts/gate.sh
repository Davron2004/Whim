#!/usr/bin/env bash
# Verification gate. Exit 0 = "done" is allowed to mean done.
#
# The single source of truth: implementers must pass it before finishing, the SubagentStop
# hook enforces it, and the dispatcher trusts its exit code over any prose report.
#
# Adapted for Whim (harness-build-guide.md §2). The three generic names in the guide map to:
#   typecheck -> tsc --noEmit          lint -> eslint (.eslintignore scopes it to tsc's set)
#   tests     -> the real never-regress suites (CLAUDE.md): build feeds the headless-Chromium
#               invariants suite, so it runs first; then the Node acceptance suites.
# This file is human-edited only (protect-harness.sh blocks agents). Keep it under ~2 minutes;
# the current clean-tree run is ~15s.
set -u
cd "$(dirname "$0")/.." || exit 2

# Tamper tripwire (Layer 2 — the anti-reward-hacking capstone). Refuse to run if any
# verification-config file differs from committed HEAD. The whole point of doctoring these is a
# green gate; legit config changes are a deliberate human commit, never an uncommitted edit — so
# a tampered config can never reach a green run, no matter which tool (Edit, Bash, anything) wrote
# it. This doesn't depend on catching every write path; it bottoms out at `git commit`. To make a
# legit change: edit, commit it, then run the gate.
#
# H2 (critic 2026-06-18): .claude/settings.local.json is intentionally NOT listed below. It is
# gitignored, so it can never be committed — this git-diff tripwire only sees tracked files — and
# protect-harness.sh already blocks in-session subagent writes to .claude/**. The residual risk (a
# locally-tampered, never-committed allow-list) is accepted; closing it would require a hash baseline.
if ! git diff --quiet HEAD -- \
      package.json package-lock.json tsconfig*.json \
      eslint.config.* .eslintrc* .eslintignore knip.json knip.config.* scripts/gate.sh \
      .claude/hooks .claude/settings.json \
      babel.config.js metro.config.js 2>/dev/null; then
  echo "GATE REFUSING TO RUN: verification config (or a harness hook) differs from committed HEAD."
  echo "These are human-edited and must be committed deliberately before the gate will run:"
  git --no-pager diff --name-only HEAD -- \
      package.json package-lock.json tsconfig*.json \
      eslint.config.* .eslintrc* .eslintignore knip.json knip.config.* scripts/gate.sh \
      .claude/hooks .claude/settings.json \
      babel.config.js metro.config.js 2>/dev/null
  exit 2
fi

FAILED=()

section() { printf '\n== %s\n' "$1"; }
check() {
  local name="$1"; shift
  section "$name"
  if "$@"; then echo "PASS: $name"; else echo "FAIL: $name"; FAILED+=("$name"); fi
}

check "typecheck"         npm run -s typecheck
check "lint"              npm run -s lint -- --max-warnings 0
check "dead code (knip)"  npx knip
check "build"             npm run -s build
check "metro-guard"       npm run -s guard:metro
check "invariants"        npm run -s invariants
check "bridge-invariants" npm run -s bridge:invariants
check "version-store"     npm run -s vstore:test
check "storage-engine"    npm run -s storage:test
check "capability-bridge" npm run -s bridge:test
check "launcher"          npm run -s launcher:test
check "deliver-by-source" npm run -s launcher:deliver-verify
check "server"            npm run -s server:test
# openspec is a required GLOBAL CLI (Homebrew, v1.3.1) — NOT an npm package. Fail clearly if absent.
command -v openspec >/dev/null 2>&1 || { echo "GATE: 'openspec' CLI not found on PATH — install it (e.g. brew install openspec)"; exit 2; }
check "openspec"          npx openspec validate --all --strict

# Scaffolding tripwires: cheap greps for the garbage class you've already met. This is the
# "encode corrections once" slot — every new garbage pattern the critic/reviewer finds gets a
# grep line here. Curate it; don't let stale patterns block legitimate code.
section "scaffolding tripwires"
TRIPWIRE=$(grep -rn --include='*.ts' --include='*.tsx' \
  -e 'TEMP:' -e 'HACK:' -e 'isImplemented' -e 'IS_IMPLEMENTED' \
  -e 'console\.log(.*debug' \
  src/ 2>/dev/null || true)
if [ -n "$TRIPWIRE" ]; then
  echo "$TRIPWIRE"
  echo "FAIL: scaffolding tripwires"
  FAILED+=("scaffolding tripwires")
else
  echo "PASS: scaffolding tripwires"
fi

if [ ${#FAILED[@]} -gt 0 ]; then
  printf '\nGATE FAILED: %s\n' "${FAILED[*]}"
  exit 1
fi
printf '\nGATE PASSED\n'
exit 0
