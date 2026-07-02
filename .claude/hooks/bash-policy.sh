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
AGENT_ID=$(echo "$INPUT" | jq -r '.agent_id // empty')   # present ONLY for subagents (probe-confirmed)
CWD=$(echo "$INPUT" | jq -r '.cwd // empty')             # always present; the real working dir

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

# The fix-loop toolkit runs git UNHOOKED (commands inside a script don't re-trigger this hook), so it
# is an orchestrator-only tool. Subagents must never invoke it; the main thread falls through to `ask`.
case "$CMD" in
  *"scripts/fixloop.sh"*)
    [ -n "$AGENT_ID" ] && deny "scripts/fixloop.sh is orchestrator-only (it runs git unhooked); subagents must not invoke it (class-B deviation)" ;;
esac

# Hard denies first — match anywhere in the command, including chained segments.
case "$CMD" in
  *sudo*|*"npm install"*|*"npm uninstall"*|*curl*|*wget*|*"rm -rf /"*)
    deny "blocked by harness policy — if genuinely needed, stop and report a class-B deviation" ;;
esac
# Security-critical git: network reach, history rewrite, or SHARED-ref mutation — denied for EVERY
# caller (orchestrator and subagents alike), and kept HERE (match-anywhere) so a chained segment
# can't smuggle them past the simple-command policy below. `git worktree` is intentionally NOT
# listed: the orchestrator (main thread) needs it; subagents are blocked from it by the scoped
# policy further down. Worktree-safe mutating git (commit/add/checkout/…) is handled there too.
case "$CMD" in
  *"git push"*|*"git pull"*|*"git fetch"*|*"git clone"*|*"git remote"*|\
  *"git update-ref"*|*"git symbolic-ref"*|*"git rebase"*|*"git reflog"*|*"git gc"*|*"git config"*|\
  *"git branch -f dev/v1"*|*"git branch -D dev/v1"*|*"git branch -m dev/v1"*|\
  *"git branch -f main"*|*"git branch -D main"*|*"git branch -m main"*)
    deny "git network/shared-ref/history op is human-approved only (class-B deviation)" ;;
esac

# Protected-config writes (Layer 1 — closes the Edit|Write bypass). Harness/verification config
# is human-approved only, so block any command that WRITES to it — for EVERY caller. Reads
# (cat/grep/git diff) are untouched; the legit edit path is the Edit tool. Must sit BEFORE the
# compound-command fall-through, or a `>`-redirect escapes on the control-operator exemption.
# .claude/ is narrowed to the real config dirs so it does not false-positive on fix worktrees
# under .claude/worktrees/. Pairs with the gate's pinned-BASE tripwire, which is the real backstop.
# Write-VERBS (sed/tee/cp/mv/ln/install/dd/truncate) are anchored at a command boundary — start,
# whitespace, or a shell operator ;&| via BND — so a substring like "dd" in `git add` or "tee" in
# "committee" cannot false-deny a legit command (this bit real `git add build/…` calls before).
# .claude/fixloop/grants is the scoped-grant manifest dir (docs/parallel-fix-loop.md §4.9): a subagent
# must never write it, or it could forge its own Class-1 grant. Keep it as write-protected as the hooks.
PROTECTED='package\.json|package-lock\.json|tsconfig[^ ]*\.json|\.eslintignore|\.eslintrc[^ ]*|eslint\.config\.[a-z]+|knip\.json|knip\.config\.[a-z]+|scripts/gate\.sh|scripts/gate-full\.sh|scripts/fixloop\.sh|\.claude/(hooks|settings|agents|commands|fixloop/grants)|build/'
BND='(^|[[:space:]&;|])'
if printf '%s' "$CMD" | grep -Eq ">>?[[:space:]]*[^|&;]*($PROTECTED)|${BND}sed[^|]*-i[^|]*($PROTECTED)|${BND}tee[[:space:]][^|]*($PROTECTED)|${BND}(cp|mv|ln|install|dd|truncate)[[:space:]][^|]*($PROTECTED)|npm[[:space:]]+pkg[[:space:]]+(set|delete)|(yarn|pnpm)[[:space:]]+config[[:space:]]+set"; then
  deny "command writes to harness/verification config — use the Edit tool (prompts you on the main thread) or change it as a human; class-B deviation for subagents"
fi

# Compound commands fall through to the normal permission flow. Positioned BEFORE the git /
# auto-allow policies so neither can auto-ALLOW a chained payload (`npm test && rm -rf src`); the
# security-critical denies above already run on chained segments via match-anywhere. Any shell
# control operator disqualifies the fast path — the implementer contract is one command at a time.
case "$CMD" in
  *'&'*|*';'*|*'|'*|*'`'*|*'$('*|*'>'*|*'<'*|*$'\n'*)
    exit 0 ;;
esac

# ---- git policy (simple commands only — compound already fell through) ----------------------
# Tamper detection is decoupled from git (docs/parallel-fix-loop.md): the orchestrator audits
# every fix as `git diff <recorded BASE>`, which a commit cannot hide — so a subagent may use git
# INSIDE its own worktree. Allowed there: add/commit/checkout/switch/restore/stash/branch/rev-parse.
case "$CMD" in
  "git status"*|"git diff"*|"git log"*|"git show"*|"git rev-parse"*|"git worktree list"*) : ;;  # read-only
  git|"git "*)
    if [ -n "$AGENT_ID" ]; then
      # Subagent: allow the in-worktree vocabulary ONLY when cwd is inside a worktree.
      case "$CWD" in
        */.claude/worktrees/*)
          case "$CMD" in
            "git "*add*|"git "*commit*|"git "*checkout*|"git "*switch*|"git "*restore*|\
            "git "*stash*|"git "*branch*|"git "*"rev-parse"*)
              allow ;;
          esac ;;
      esac
      deny "subagent git is permitted only inside its own .claude/worktrees/<id> (add/commit/checkout/switch/restore/stash/branch/rev-parse). This command or location is not allowed (class-B deviation)."
    fi
    # Main thread: route mutating git to the approval prompt.
    ask "git command needs your approval — review it before allowing (this is the history the gate's BASE-diff trusts)" ;;
esac

# fix-worker entering an orchestrator-created worktree (§6.9). cd is side-effect-free —
# the cwd-keyed git scoping above is re-checked on every later call. No `..` traversal.
case "$CMD" in
  "cd "*".claude/worktrees/"*)
    case "$CMD" in *".."*) : ;; *) allow ;; esac ;;
esac

# Auto-allow vocabulary — anchored at command start; only reached for single, simple commands.
case "$CMD" in
  "./scripts/gate.sh"*|"./scripts/gate-full.sh"*|"npm run "*|"npm test"*|"npx tsc"*|"npx eslint"*|"npx knip"*|"npx openspec"*|"openspec "*|\
  "git status"*|"git diff"*|"git log"*|"git show"*|"git rev-parse"*|"git worktree list"*|\
  "ls"*|"cat "*|"head "*|"tail "*|"grep "*|"rg "*|"wc "*|"mkdir "*)
    allow ;;
esac

# Unknown: no decision -> normal permission flow.
exit 0
