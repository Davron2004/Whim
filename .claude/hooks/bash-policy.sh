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
AGENT_ID=$(echo "$INPUT" | jq -r '.agent_id // empty')

deny() {
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"%s"}}\n' "$1"
  exit 0
}
allow() {
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow","permissionDecisionReason":"harness bash policy"}}\n'
  exit 0
}
ask() {
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"ask","permissionDecisionReason":"%s"}}\n' "$1"
  exit 0
}

# Hard denies first — match anywhere in the command, including chained segments.
case "$CMD" in
  *sudo*|*"git push"*|*"npm install"*|*"npm uninstall"*|*curl*|*wget*|*"rm -rf /"*)
    deny "blocked by harness policy — if genuinely needed, stop and report a class-B deviation" ;;
esac

# Protected-config writes (Layer 1 — closes the Edit|Write bypass). Harness/verification config
# is human-approved only, so block any command that WRITES to it — for EVERY caller, orchestrator
# and subagents alike. Unlike the Edit hook there is no per-actor "ask" path here: a one-liner
# redirect is too easy to wave through, and nobody should bash-write these files. Reads
# (cat/grep/git diff) are untouched; the legit edit path is the Edit tool. Must sit BEFORE the
# compound-command fall-through below, or a `>`-redirect escapes on the control-operator exemption.
# Best-effort regex over shell — pairs with the gate's tamper tripwire, which is the real guarantee.
# .claude/ is narrowed to the real config dirs (hooks|settings|agents|commands) so it does not
# false-positive on ephemeral fix worktrees under .claude/worktrees/. The gate's tamper tripwire
# (which watches .claude/hooks + .claude/settings.json) remains the real backstop; this is best-effort.
PROTECTED='package\.json|package-lock\.json|tsconfig[^ ]*\.json|\.eslintignore|\.eslintrc[^ ]*|eslint\.config\.[a-z]+|knip\.json|knip\.config\.[a-z]+|scripts/gate\.sh|\.claude/(hooks|settings|agents|commands)'
if printf '%s' "$CMD" | grep -Eq ">>?[[:space:]]*[^|&;]*($PROTECTED)|sed[^|]*-i[^|]*($PROTECTED)|tee[[:space:]][^|]*($PROTECTED)|(cp|mv|ln|install|dd|truncate)[[:space:]][^|]*($PROTECTED)|npm[[:space:]]+pkg[[:space:]]+(set|delete)|(yarn|pnpm)[[:space:]]+config[[:space:]]+set"; then
  deny "command writes to harness/verification config — use the Edit tool (prompts you on the main thread) or change it as a human; class-B deviation for subagents"
fi

# Mutating git is human-approved only — this is what makes Layer 2 real. The tripwire trusts that
# the human is the ONLY committer: an agent that can `git commit`/`--amend`/`reset`/`rebase` could
# bake a tampered config into HEAD (HEAD==tree -> no diff -> the gate runs green) or rewrite history
# to erase the evidence. Read-only git (status/diff/log/show) stays auto-allowed below. Subagents
# are hard-denied; the main thread is routed to the approval prompt — same ask mechanism as the
# protected edits. Best-effort prefix match (an agent can still evade via `g=git; $g ...` or an
# absolute path); the durable backstops are commit visibility, your review, and not running in
# full bypass mode.
case "$CMD" in
  "git status"*|"git diff"*|"git log"*|"git show"*) : ;;   # read-only — defer to auto-allow vocab
  git|"git "*)
    [ -n "$AGENT_ID" ] && deny "git is human-approved only — subagents must not run git; a commit/amend/reset could defeat the gate tripwire (class-B deviation)"
    ask "git command needs your approval — review it before allowing (this is the commit history the gate's integrity check trusts)" ;;
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
  "git status"*|"git diff"*|"git log"*|"git show"*|\
  "ls"*|"cat "*|"head "*|"tail "*|"grep "*|"rg "*|"wc "*|"mkdir "*)
    allow ;;
esac

# Unknown: no decision -> normal permission flow.
exit 0
