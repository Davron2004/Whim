#!/usr/bin/env bash
set -euo pipefail

ROOT=$(mktemp -d "${TMPDIR:-/tmp}/whim-bash-policy.XXXXXX")
trap 'rm -rf "$ROOT"' EXIT
HOOK="$(cd "$(dirname "$0")/.." && pwd)/bash-policy.sh"
WT="$ROOT/.claude/worktrees/nav-chain"
mkdir -p "$WT"

PASS=0

invoke() {
  local agent="$1"
  local command="$2"
  local cwd="$3"
  jq -cn --arg agent "$agent" --arg command "$command" --arg cwd "$cwd" \
    '{agent_id:$agent,cwd:$cwd,tool_input:{command:$command}}' | bash "$HOOK"
}

expect_decision() {
  local name="$1"
  local expected="$2"
  local agent="$3"
  local command="$4"
  local cwd="$5"
  local output decision
  output=$(invoke "$agent" "$command" "$cwd")
  if [[ -z "$output" ]]; then decision="none"; else
    decision=$(printf '%s' "$output" | jq -r '.hookSpecificOutput.permissionDecision // "none"')
  fi
  if [[ "$decision" != "$expected" ]]; then
    printf 'FAIL: %s (expected %s, got %s)\n%s\n' "$name" "$expected" "$decision" "$output" >&2
    exit 1
  fi
  PASS=$((PASS + 1))
  printf 'PASS: %s\n' "$name"
}

expect_decision "exact git -C add binds owner" allow agent-a "git -C $WT add file.ts" "$ROOT"
[[ "$(cat "$ROOT/.claude/fixloop/owners/nav-chain")" = "agent-a" ]]
expect_decision "same owner may commit" allow agent-a "git -C $WT commit -m test" "$ROOT"
expect_decision "second agent is denied" deny agent-b "git -C $WT add other.ts" "$ROOT"
expect_decision "plain mutating git at repo root is denied" deny agent-a "git add file.ts" "$ROOT"
expect_decision "traversal git -C is denied" deny agent-a "git -C $ROOT/.claude/worktrees/../victim add file.ts" "$ROOT"
expect_decision "nested git -C is denied" deny agent-a "git -C $WT/nested add file.ts" "$ROOT"
expect_decision "git global options are denied" deny agent-a "git -C $WT -c alias.add=evil add file.ts" "$ROOT"
expect_decision "tier-1 push stays denied" deny agent-a "git -C $WT push" "$ROOT"
expect_decision "tier-1 config stays denied" deny agent-a "git -C $WT config user.name attacker" "$ROOT"
expect_decision "compound command is not auto-allowed" none agent-a "git -C $WT add file.ts && true" "$ROOT"
expect_decision "read-only git -C remains allowed" allow agent-b "git -C $WT status --short" "$ROOT"

printf 'bash-policy tests: %d passed\n' "$PASS"
