#!/usr/bin/env bash
# PreToolUse(Bash) hook. The no-stall guarantee: deterministic allow/deny over the harness's
# command vocabulary, evaluated inside subagents where allowlist inheritance has historically
# been flaky. Three outcomes: hard-deny with a reason the agent sees, auto-allow the known
# vocabulary, or stay silent — an unknown command falls through to the normal permission flow
# (safe-by-default; a stall on an unknown command is information). Requires `jq`.
#
# Keep this vocabulary in sync with permissions.allow in .claude/settings.json.
INPUT=$(cat)
CMD=$(echo "$INPUT" | jq -r '.tool_input.command // empty')

deny() {
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"%s"}}\n' "$1"
  exit 0
}
allow() {
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow","permissionDecisionReason":"harness bash policy"}}\n'
  exit 0
}

# Hard denies first — match anywhere in the command, including chained segments.
case "$CMD" in
  *sudo*|*"git push"*|*"npm install"*|*"npm uninstall"*|*curl*|*wget*|*"rm -rf /"*)
    deny "blocked by harness policy — if genuinely needed, stop and report a class-B deviation" ;;
esac

# Compound commands fall through to the normal permission flow. The auto-allow patterns below
# are anchored at the START of the command, but a trailing glob would otherwise let an allowed
# prefix drag a chained payload along with it (`npm test && rm -rf src`). Any shell control
# operator (&, &&, ;, |, ||, redirection, command substitution, newline) disqualifies the fast
# path — which is exactly the implementer-prompt contract: run commands one at a time.
case "$CMD" in
  *'&'*|*';'*|*'|'*|*'`'*|*'$('*|*'>'*|*'<'*|*$'\n'*)
    exit 0 ;;
esac

# Auto-allow vocabulary — anchored at command start; only reached for single, simple commands.
case "$CMD" in
  "./scripts/gate.sh"*|"npm run "*|"npm test"*|"npx tsc"*|"npx eslint"*|"npx knip"*|"npx openspec"*|"openspec "*|\
  "git status"*|"git diff"*|"git log"*|"git show"*|"git add "*|"git commit "*|\
  "ls"*|"cat "*|"head "*|"tail "*|"grep "*|"rg "*|"wc "*|"mkdir "*)
    allow ;;
esac

# Unknown: no decision -> normal permission flow.
exit 0
