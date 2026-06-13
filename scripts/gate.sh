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
check "invariants"        npm run -s invariants
check "version-store"     npm run -s vstore:test
check "storage-engine"    npm run -s storage:test
check "capability-bridge" npm run -s bridge:test
check "launcher"          npm run -s launcher:test
check "deliver-by-source" npm run -s launcher:deliver-verify
check "openspec"          openspec validate --all --strict

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
