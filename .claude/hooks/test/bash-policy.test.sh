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
owner="$(cat "$ROOT/.claude/fixloop/owners/nav-chain")"
[[ "$owner" == "agent-a" ]] || { printf 'FAIL: the owners file binds agent-a (got %s)\n' "$owner" >&2; exit 1; }
PASS=$((PASS + 1)); printf 'PASS: %s\n' 'the owners file binds agent-a'
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

# Remote-write policy (openspec: staging-integration-lane) — server-side `main` protection re-anchor.
expect_decision "main-thread push of main stays denied" deny "" "git push origin main" "$ROOT"
expect_decision "refspec smuggling integration->main stays denied" deny "" "git push origin integration/run-1:main" "$ROOT"
expect_decision "main-thread branch push auto-allows" allow "" "git push origin integration/run-1" "$ROOT"
expect_decision "main-thread force-with-lease branch push auto-allows" allow "" "git push --force-with-lease origin integration/run-1" "$ROOT"
expect_decision "subagent push of integration/* stays denied" deny agent-a "git push origin integration/run-1" "$ROOT"
expect_decision "subagent push of any ref stays denied" deny agent-a "git push" "$ROOT"
expect_decision "all-allowed compound branch push allows" allow "" "git push origin integration/run-1 && npm run build" "$ROOT"
expect_decision "compound push naming main denies" deny "" "npm run build && git push origin main" "$ROOT"
expect_decision "compound refspec smuggling denies" deny "" "git push origin integration/run-1:main && echo done" "$ROOT"

# Tier-1 relaxation (main thread only): fetch + ff-only pull of main; everything else still denied.
expect_decision "main-thread git fetch origin allows" allow "" "git fetch origin" "$ROOT"
expect_decision "main-thread ff-only pull of main allows" allow "" "git pull --ff-only origin main" "$ROOT"
expect_decision "subagent git fetch stays denied" deny agent-a "git fetch origin" "$ROOT"
expect_decision "non-ff pull stays denied" deny "" "git pull origin main" "$ROOT"
expect_decision "git fetch --all stays denied" deny "" "git fetch --all" "$ROOT"

# gh vocabulary (design §D4): read-only for all, closure mutations main-thread-only, merge denied.
expect_decision "gh pr view read-only allows" allow "" "gh pr view 12" "$ROOT"
expect_decision "gh pr checks read-only allows" allow "" "gh pr checks 12" "$ROOT"
expect_decision "gh api GET allows" allow "" "gh api repos/o/r/rulesets" "$ROOT"
expect_decision "gh api POST is not auto-allowed" none "" "gh api repos/o/r/issues -X POST" "$ROOT"
expect_decision "gh pr create --draft allows (main)" allow "" "gh pr create --draft --base main --head integration/run-1 --title x --body y" "$ROOT"
expect_decision "gh pr ready allows (main)" allow "" "gh pr ready 12" "$ROOT"
expect_decision "gh pr merge denied for all callers" deny "" "gh pr merge 12" "$ROOT"
expect_decision "gh pr merge denied for subagents too" deny agent-a "gh pr merge 12" "$ROOT"
expect_decision "gh mutation denied for subagents" deny agent-a "gh pr create --draft --title x" "$ROOT"
expect_decision "gh read-only allowed for subagents" allow agent-a "gh pr view 12" "$ROOT"
# gh api defaults to POST when -f/-F/--field/--input are present with no explicit method — those are
# mutations, not reads (no server-side ruleset gates arbitrary gh api writes).
expect_decision "gh api bare read allowed for subagents" allow agent-a "gh api repos/o/r/rulesets" "$ROOT"
expect_decision "gh api -f is a mutation, denied for subagents" deny agent-a "gh api repos/o/r/issues -f title=x" "$ROOT"
expect_decision "gh api -F is a mutation, denied for subagents" deny agent-a "gh api repos/o/r/pulls/5/comments -F body=hi" "$ROOT"
expect_decision "gh api --input is a mutation, denied for subagents" deny agent-a "gh api repos/o/r/x --input body.json" "$ROOT"
expect_decision "gh api -f is not auto-allowed on the main thread" none "" "gh api repos/o/r/issues -f title=x" "$ROOT"
expect_decision "gh api explicit GET with -f stays read-only" allow agent-a "gh api repos/o/r/x -X GET -f a=b" "$ROOT"

expect_decision "subagent force-op on integration/* stays denied" deny agent-a "git branch -D integration/run-1" "$ROOT"

# Cleanup lane derives its worktree id from the grant's target_branch (staging-branch-integration)
mkdir -p "$ROOT/.claude/fixloop/grants" "$ROOT/.claude/worktrees/integration-run-1-squashed" "$ROOT/.claude/worktrees/other-squashed"
printf 'target_branch=integration/run-1\ntarget_sha=x\ntarget_tree=y\n' > "$ROOT/.claude/fixloop/grants/git-cleanup"
expect_decision "cleanup lane tracks the grant target" allow agent-c "git rebase -i HEAD~3" "$ROOT/.claude/worktrees/integration-run-1-squashed"
expect_decision "mismatched -squashed worktree is not the lane" deny agent-d "git rebase -i HEAD~3" "$ROOT/.claude/worktrees/other-squashed"


# Simulator installation reads its .app input; only the exact root command is
# exempt from the write heuristic. These are classifier inputs, never executed.
# One head-anchored (env wrapper) and one tail-anchored (; cp) smuggling row stand for the rest:
# the anchors refuse them all the same way, and the unroller's own suite covers compound denies.
SIM_UUID="1349ACC1-1768-4037-A901-3C1A5F3F93B8"
SIM_APP="$ROOT/ios/build/sim/Build/Products/Release-iphonesimulator/Whim.app"
SIM_INSTALL="/usr/bin/xcrun simctl install $SIM_UUID $SIM_APP"
expect_decision "root simulator install defers instead of protected-write denial" none "" "$SIM_INSTALL" "$ROOT"
expect_decision "subagent simulator install retains deny" deny agent-a "$SIM_INSTALL" "$ROOT"
WHIM_BASH_POLICY_SEGMENT=1 expect_decision "segment re-entry cannot claim standalone exception" deny "" "$SIM_INSTALL" "$ROOT"
expect_decision "bare PATH-resolved xcrun keeps previous deny" deny "" "xcrun simctl install $SIM_UUID $SIM_APP" "$ROOT"
expect_decision "lookalike executable keeps deny" deny "" "/tmp/xcrun simctl install $SIM_UUID $SIM_APP" "$ROOT"
expect_decision "non-UUID target keeps deny" deny "" "/usr/bin/xcrun simctl install booted $SIM_APP" "$ROOT"
expect_decision "extra install argument keeps deny" deny "" "$SIM_INSTALL extra" "$ROOT"
expect_decision "extra xcrun flag keeps deny" deny "" "/usr/bin/xcrun --sdk iphonesimulator simctl install $SIM_UUID $SIM_APP" "$ROOT"
expect_decision "traversal input keeps deny" deny "" "/usr/bin/xcrun simctl install $SIM_UUID $ROOT/ios/build/../Whim.app" "$ROOT"
expect_decision "dot-component input keeps deny" deny "" "/usr/bin/xcrun simctl install $SIM_UUID $ROOT/ios/build/./Whim.app" "$ROOT"
expect_decision "env wrapper keeps deny" deny "" "env FOO=bar $SIM_INSTALL" "$ROOT"
expect_decision "semicolon command keeps deny" deny "" "$SIM_INSTALL; cp payload package.json" "$ROOT"
expect_decision "ordinary filesystem install into gate stays denied" deny "" "install payload scripts/gate.sh" "$ROOT"
expect_decision "copy into protected config stays denied" deny "" "cp payload package.json" "$ROOT"
expect_decision "move out of protected config stays denied" deny "" "mv scripts/gate.sh /tmp/gate-backup" "$ROOT"
expect_decision "symlink into protected config stays denied" deny "" "ln -s payload .claude/hooks/bash-policy.sh" "$ROOT"
expect_decision "protected source copy retains conservative decision" deny "" "cp $SIM_APP /tmp/Whim.app" "$ROOT"
expect_decision "earlier hard deny still runs" deny "" "/usr/bin/xcrun simctl install $SIM_UUID $ROOT/ios/build/curl.app" "$ROOT"

printf 'bash-policy tests: %d passed\n' "$PASS"
