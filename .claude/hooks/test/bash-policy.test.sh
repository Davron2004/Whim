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

# The worktree provisioner runs `git worktree add` unhooked, like the fix-loop toolkit: orchestrator-only.
expect_decision "subagent may not invoke the fix-loop toolkit" deny agent-a "scripts/fixloop.sh status" "$ROOT"
expect_decision "subagent may not create a worktree via the provisioner" deny agent-a "scripts/worktree.sh create x HEAD" "$ROOT"
expect_decision "subagent may not run the provisioner through bash" deny agent-a "bash scripts/worktree.sh provision $WT" "$ROOT"
expect_decision "main thread's provisioner call is not denied" none "" "scripts/worktree.sh create x HEAD" "$ROOT"
expect_decision "copy into the provisioner stays denied" deny "" "cp payload scripts/worktree.sh" "$ROOT"

# Subagent deny-instead-of-prompt (#181 option 1, subagent-deny.sh). The hook runs from a copy in a
# scratch repo so its derived log path (.claude/run/) and any owner marker land under $ROOT.
REAL_HOOKS="$(cd "$(dirname "$0")/.." && pwd)"
REAL_SETTINGS="$REAL_HOOKS/../settings.json"
DROOT="$ROOT/deny-repo"
mkdir -p "$DROOT/.claude/hooks" "$DROOT/.claude/worktrees/wt-d"
cp "$REAL_HOOKS/subagent-deny.sh" "$REAL_HOOKS/bash-policy.sh" "$REAL_HOOKS/unroll-command.mjs" "$DROOT/.claude/hooks/"
# The scratch repo's settings: the real permissions.allow plus rules bash-policy's allow tier lacks.
jq '.permissions.allow += ["Bash(node tools/probe.mjs:*)", "Bash(node tools/exact.mjs)", "Bash(find * -name x)"]' "$REAL_SETTINGS" > "$DROOT/.claude/settings.json"
printf '%s\n' '{"permissions":{"allow":["Bash(jq --version)"]}}' > "$DROOT/.claude/settings.local.json"
DENY_HOOK="$DROOT/.claude/hooks/subagent-deny.sh"
DENY_LOG="$DROOT/.claude/run/subagent-denials.log"

deny_invoke() {
  local agent="$1" mode="$2" command="$3" cwd="${4:-$DROOT}"
  jq -cn --arg agent "$agent" --arg mode "$mode" --arg command "$command" --arg cwd "$cwd" \
    '{cwd:$cwd,tool_name:"Bash",tool_input:{command:$command}}
     + (if $agent == "" then {} else {agent_id:$agent,agent_type:"implementer"} end)
     + (if $mode == "" then {} else {permission_mode:$mode} end)' | bash "$DENY_HOOK"
}
log_lines() { if [[ -f "$DENY_LOG" ]]; then wc -l < "$DENY_LOG" | tr -d ' '; else echo 0; fi; }
ok() { PASS=$((PASS + 1)); printf 'PASS: %s\n' "$1"; }
bad() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }

expect_pass_through() {
  local name="$1" agent="$2" mode="$3" command="$4" cwd="${5:-$DROOT}" before out
  before=$(log_lines)
  out=$(deny_invoke "$agent" "$mode" "$command" "$cwd") || bad "$name (non-zero exit)"
  [[ -z "$out" ]] || bad "$name (expected no output, got $out)"
  [[ "$(log_lines)" == "$before" ]] || bad "$name (a deny line was logged)"
  ok "$name"
}

expect_subagent_deny() {
  local name="$1" mode="$2" command="$3" rule="$4" before out reason
  before=$(log_lines)
  out=$(deny_invoke agent-d "$mode" "$command") || bad "$name (non-zero exit)"
  [[ "$(printf '%s' "$out" | jq -r '.hookSpecificOutput.permissionDecision')" == "deny" ]] || bad "$name (no deny: $out)"
  reason=$(printf '%s' "$out" | jq -r '.hookSpecificOutput.permissionDecisionReason')
  [[ "$reason" == "Denied for subagents (would need approval nobody sees): "*"$rule"*". Use Write/Edit for file content and one simple command per call." ]] \
    || bad "$name (reason: $reason)"
  [[ "$(log_lines)" == "$((before + 1))" ]] || bad "$name (expected exactly one new log line)"
  IFS=$'\t' read -r l_time l_type l_cmd l_rule < <(tail -n 1 "$DENY_LOG")
  [[ "$l_time" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$ ]] || bad "$name (log time: $l_time)"
  [[ "$l_type" == "implementer" ]] || bad "$name (log agent_type: $l_type)"
  [[ "$l_cmd" == "$(printf '%s' "$command" | jq -Rrs '[.] | @tsv')" ]] || bad "$name (log command: $l_cmd)"
  [[ "$l_rule" == *"$rule"* ]] || bad "$name (log rule: $l_rule)"
  ok "$name"
}

UNKNOWN_CMD="node scripts/sync-codex.mjs --check"
NOVOCAB="not in the auto-allowed command vocabulary"
expect_pass_through "main session passes untouched (default mode)" "" default "$UNKNOWN_CMD"
expect_pass_through "bypass subagent passes untouched" agent-d bypassPermissions "$UNKNOWN_CMD"
expect_pass_through "bypass subagent hard-deny-tier command passes untouched" agent-d bypassPermissions "curl https://example.com"
expect_pass_through "auto-mode subagent passes untouched" agent-d auto "$UNKNOWN_CMD"
expect_pass_through "dontAsk-mode subagent passes untouched" agent-d dontAsk "$UNKNOWN_CMD"
expect_pass_through "subagent without permission_mode passes (fail open)" agent-d "" "$UNKNOWN_CMD"
expect_pass_through "subagent in an unknown mode passes (fail open)" agent-d someFutureMode "$UNKNOWN_CMD"
expect_subagent_deny "default-mode subagent unknown command is denied and logged" default "$UNKNOWN_CMD" "$NOVOCAB"
expect_subagent_deny "acceptEdits-mode subagent unknown command is denied" acceptEdits "$UNKNOWN_CMD" "$NOVOCAB"
expect_subagent_deny "plan-mode subagent unknown command is denied" plan "$UNKNOWN_CMD" "$NOVOCAB"
expect_subagent_deny "default-mode subagent hard-deny-tier command is denied with its rule" default "curl https://example.com" "blocked by harness policy"
expect_subagent_deny "default-mode subagent compound with an unknown segment is denied" default "npm run build && $UNKNOWN_CMD" "$NOVOCAB"
expect_subagent_deny "multi-line command is logged as one line" default $'echo a\n'"$UNKNOWN_CMD" "$NOVOCAB"
expect_pass_through "default-mode subagent vocabulary command passes" agent-d default "npm run build"
expect_pass_through "default-mode subagent worktree git passes" agent-d default "git add file.ts" "$DROOT/.claude/worktrees/wt-d"
[[ ! -e "$DROOT/.claude/fixloop/owners/wt-d" ]] || bad "classification wrote an owner marker"
ok "classification writes no worktree owner marker"
WHIM_SUBAGENT_DENY=off expect_pass_through "kill switch disables the deny" agent-d default "$UNKNOWN_CMD"

# permissions.allow matches pass even outside bash-policy's vocabulary: they never prompt.
expect_pass_through "prefix rule matches the bare prefix" agent-d default "node tools/probe.mjs"
expect_pass_through "prefix rule matches prefix plus arguments" agent-d acceptEdits "node tools/probe.mjs --fast"
expect_subagent_deny "prefix rule stops at a word boundary" default "node tools/probe.mjsx" "$NOVOCAB"
expect_pass_through "exact rule matches" agent-d default "node tools/exact.mjs"
expect_subagent_deny "exact rule does not match extra arguments" default "node tools/exact.mjs now" "$NOVOCAB"
expect_pass_through "settings.local.json rule matches" agent-d default "jq --version"
expect_subagent_deny "mid-pattern wildcard rule is not interpreted" default "find . -name x" "$NOVOCAB"

# Read-only builtins never prompt; an empty command has nothing to classify.
expect_pass_through "builtin echo passes" agent-d default "echo hi there"
expect_pass_through "builtin pwd passes" agent-d default "pwd"
expect_pass_through "builtin true passes" agent-d default "true"
expect_subagent_deny "echo with a redirect is not a builtin pass" default "echo hi > out.txt" "$NOVOCAB"
expect_subagent_deny "echo expanding a variable is not a builtin pass" default "echo \$HOME" "$NOVOCAB"
expect_pass_through "empty command passes, nothing logged" agent-d default ""

# A plain chain passes when every segment would run unprompted; cd must stay inside the repo.
DWT="$DROOT/.claude/worktrees/wt-d"
expect_pass_through "all-allowed && chain passes" agent-d default "git status && git diff"
expect_pass_through "cd into a worktree then git passes" agent-d default "cd $DWT && git status"
expect_pass_through "cd to the repo root then read-only git passes" agent-d default "cd $DROOT && git log --oneline -3" "$DWT"
expect_pass_through "chain of policy command and builtin passes" agent-d default "git status && echo done"
expect_pass_through "relative cd then a permissions.allow rule passes" agent-d default "cd .claude/worktrees/wt-d; node tools/probe.mjs --fast | wc -l"
expect_pass_through "worktree git after cd is judged in the new cwd" agent-d default "cd $DWT && git add file.ts"
expect_subagent_deny "chain with a hard-deny segment is denied" default "git status; rm -rf /tmp/x" "blocked by harness policy"
expect_subagent_deny "cd outside the repo is denied" default "cd /etc && git status" "$NOVOCAB"
expect_subagent_deny "cd to the repo's parent is denied" default "cd .. && git status" "$NOVOCAB"
expect_subagent_deny "chain with command substitution is denied" default "git status && echo \$(whoami)" "$NOVOCAB"
expect_subagent_deny "chain with a background job is denied" default "git status & $UNKNOWN_CMD" "$NOVOCAB"
expect_subagent_deny "chain with an empty segment is denied" default "git status ;; git diff" ""

# Fail-safe: anything the hook cannot read or classify passes through silently.
out=$(printf '{bad' | bash "$DENY_HOOK") || bad "malformed JSON (non-zero exit)"
[[ -z "$out" ]] || bad "malformed JSON (output: $out)"
ok "malformed JSON passes through"
NOJQ_BIN="$ROOT/nojq-bin"
mkdir -p "$NOJQ_BIN"
for tool in bash cat dirname date mkdir node; do ln -s "$(command -v "$tool")" "$NOJQ_BIN/$tool"; done
before=$(log_lines)
out=$(jq -cn --arg c "$UNKNOWN_CMD" '{agent_id:"agent-d",permission_mode:"default",tool_input:{command:$c}}' \
  | PATH="$NOJQ_BIN" "$NOJQ_BIN/bash" "$DENY_HOOK") || bad "jq missing (non-zero exit)"
[[ -z "$out" && "$(log_lines)" == "$before" ]] || bad "jq missing (output: $out)"
ok "jq missing from PATH passes through"
FROOT="$ROOT/failing-policy-repo"
mkdir -p "$FROOT/.claude/hooks"
cp "$DENY_HOOK" "$DROOT/.claude/settings.json" "$FROOT/.claude/hooks/"
mv "$FROOT/.claude/hooks/settings.json" "$FROOT/.claude/settings.json"
printf '%s\n' '#!/usr/bin/env bash' 'exit 3' > "$FROOT/.claude/hooks/bash-policy.sh"
out=$(jq -cn --arg c "$UNKNOWN_CMD" --arg d "$FROOT" '{cwd:$d,agent_id:"agent-d",permission_mode:"default",tool_input:{command:$c}}' \
  | bash "$FROOT/.claude/hooks/subagent-deny.sh") || bad "bash-policy failure (non-zero exit)"
[[ -z "$out" && ! -e "$FROOT/.claude/run/subagent-denials.log" ]] || bad "bash-policy failure (output: $out)"
ok "bash-policy exiting non-zero passes through"

# Every Bash entry of the real permissions.allow must pass through: those calls never prompt.
while IFS= read -r rule; do
  sample="${rule%:\*}"
  [[ "$sample" == "$rule" ]] || sample="$sample x"
  expect_pass_through "permissions.allow entry passes: $rule" agent-d default "$sample"
done < <(jq -r '.permissions.allow[] | select(startswith("Bash(")) | ltrimstr("Bash(") | rtrimstr(")")' "$REAL_SETTINGS")

# The real settings wire exactly this hook for Bash, at a path that exists and is executable.
wired=$(jq -r '.hooks.PreToolUse[] | select(.matcher == "Bash") | .hooks[].command' "$REAL_SETTINGS")
[[ "$wired" == '$CLAUDE_PROJECT_DIR/.claude/hooks/subagent-deny.sh' ]] || bad "settings wire the hook (got $wired)"
[[ -x "$REAL_HOOKS/subagent-deny.sh" ]] || bad "wired hook is executable"
ok "settings wire subagent-deny.sh for Bash"

printf 'bash-policy tests: %d passed\n' "$PASS"
