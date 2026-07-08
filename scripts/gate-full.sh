#!/usr/bin/env bash
# FULL verification gate — per-fix, pre-merge. Run ONCE by the orchestrator before a fix is
# merged to main (serialized). Runs the FAST gate (scripts/gate.sh) first, then the heavy /
# flaky steps deferred from the inner loop: dead-code, the Metro bundler guard, the headless-
# Chromium invariant suites, and openspec validation.
#
# Split rationale (docs/archive/parallel-fix-loop.md §4.3): `npm run build` is ~0.3s and lives in the
# FAST gate (it writes the gitignored src/runtime/generated/* that typecheck + Metro + the
# invariants all need). What we defer here is Metro + headless Chromium — the steps that are slow
# and that contend / flake when N fixer worktrees run in parallel.
#
# This file is human-edited only (protect-harness.sh blocks agents).
set -u
cd "$(dirname "$0")/.." || exit 2

# 1. FAST gate first: tamper tripwire + build + typecheck + lint + Node suites + scaffolding.
#    GATE_BASE (the worktree's recorded base SHA) is inherited from the environment, if set.
./scripts/gate.sh || exit $?

FAILED=()
section() { local name="$1"; printf '\n== %s\n' "$name"; return 0; }
check() {
  local name="$1"; shift
  section "$name"
  if "$@"; then echo "PASS: $name"; else echo "FAIL: $name"; FAILED+=("$name"); fi
  return 0
}

# 2. Heavy / browser / bundler checks. gate.sh already ran the build, so src/runtime/generated/*
#    is present and current for the invariant runners.
check "dead code (knip)"  npx knip
check "metro-guard"       npm run -s guard:metro
check "invariants"        npm run -s invariants
check "bridge-invariants" npm run -s bridge:invariants
check "deliver-by-source" npm run -s launcher:deliver-verify
check "codex-sync"        node scripts/sync-codex.mjs --check
# openspec is a required GLOBAL CLI (Homebrew) — NOT an npm package. Fail clearly if absent.
command -v openspec >/dev/null 2>&1 || { echo "GATE: 'openspec' CLI not found on PATH — install it (e.g. brew install openspec)"; exit 2; }
check "openspec"          npx openspec validate --all --strict

if [[ ${#FAILED[@]} -gt 0 ]]; then
  printf '\nFULL GATE FAILED: %s\n' "${FAILED[*]}"
  exit 1
fi
printf '\nFULL GATE PASSED\n'
exit 0
