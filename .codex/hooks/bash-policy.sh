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
  local reason="$1"
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"%s"}}\n' "$reason"
  exit 0
  return 0
}
allow() {
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow","permissionDecisionReason":"harness bash policy"}}\n'
  exit 0
  return 0
}
ask() {
  local reason="$1"
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"ask","permissionDecisionReason":"%s"}}\n' "$reason"
  exit 0
  return 0
}

# owners_claim <repo-root> <wt-id>: agent↔worktree binding (critic 2026-07-02 — a fixer could reach a
# SIBLING's worktree because cwd-scoped git only checked "under .claude/worktrees/", not "under MINE").
# 0 iff THIS agent owns <wt-id>, claiming it atomically (noclobber) on first use if unclaimed. The
# marker (.claude/fixloop/owners/<wt-id>) is agent-unwritable via any other path — PROTECTED regex
# below + protect-harness's .claude/* block — the same trust model as the Class-1 grants. The
# orchestrator (main thread, no AGENT_ID) is never ownership-checked; it removes the marker at
# teardown (`finish` prints the rm) and MUST remove it before re-dispatching a parked worktree to a
# NEW agent, or the replacement worker is refused.
owners_claim() {
  local of="$1/.claude/fixloop/owners/$2"
  mkdir -p "$1/.claude/fixloop/owners" 2>/dev/null
  if [[ -f "$of" ]]; then [[ "$(cat "$of" 2>/dev/null)" = "$AGENT_ID" ]]; return; fi
  ( set -C; printf '%s\n' "$AGENT_ID" > "$of" ) 2>/dev/null || true
  [[ "$(cat "$of" 2>/dev/null)" = "$AGENT_ID" ]]
}

# The fix-loop toolkit runs git UNHOOKED (commands inside a script don't re-trigger this hook), so it
# is an orchestrator-only tool. Subagents must never INVOKE it; the main thread falls through to `ask`.
# Invocation shapes only — direct exec at a command-segment start, or via an interpreter — NOT reads:
# the old match-anywhere substring denied `git diff`/`cat` on the file and even report text that merely
# quoted its path (critic 2026-07-02). Env-prefixed invocation (`VAR=x <script>`) slips this matcher;
# the guard is anti-accident — the durable backstops stay the pinned-BASE diff + the orchestrator review.
if [[ -n "$AGENT_ID" ]] && printf '%s' "$CMD" | grep -Eq '(^|[;&|(])[[:space:]]*([^[:space:];&|]*/)?scripts/fixloop\.sh|(^|[[:space:]])(bash|sh|zsh|source|\.)[[:space:]]+([^;&|]*[[:space:]])?[^[:space:];&|]*scripts/fixloop\.sh'; then
  deny "the fix-loop toolkit script is orchestrator-only (it runs git unhooked); subagents must not invoke it (class-B deviation)"
fi

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
# whitespace, a shell operator ;&|, or an opening subshell paren ( via BND — so a substring like "dd"
# in `git add` or "tee" in "committee" cannot false-deny a legit command (this bit real `git add
# build/…` calls before), while `(cp x package.json)` cannot slip the anchor (a bare `(` is neither
# whitespace nor a listed operator, and isn't in the compound-command indicator list below either —
# critic 2026-07-02).
# .claude/fixloop/grants is the scoped-grant manifest dir (docs/parallel-fix-loop.md §4.9): a subagent
# must never write it, or it could forge its own Class-1 grant. Same for fixloop/owners (the
# agent↔worktree binding markers) — forging one would let a fixer claim a sibling's worktree.
# invariants/ is the never-regress suite (owner-authored) — write-protected like the gate it feeds.
PROTECTED='package\.json|package-lock\.json|tsconfig[^ ]*\.json|\.eslintignore|\.eslintrc[^ ]*|eslint\.config\.[a-z]+|knip\.json|knip\.config\.[a-z]+|scripts/gate\.sh|scripts/gate-full\.sh|scripts/fixloop\.sh|\.claude/(hooks|settings|agents|commands|fixloop/(grants|owners))|build/|invariants/'
BND='(^|[[:space:]&;|(])'
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
  *) ;; # simple command: continue to the scoped policies below
esac

# ---- git policy (simple commands only — compound already fell through) ----------------------
# Tamper detection is decoupled from git (docs/parallel-fix-loop.md): the orchestrator audits
# every fix as `git diff <recorded BASE>`, which a commit cannot hide — so a subagent may use git
# INSIDE its own worktree. Allowed there: add/commit/checkout/switch/restore/stash/branch/rev-parse.
case "$CMD" in
  "git status"*|"git diff"*|"git log"*|"git show"*|"git rev-parse"*|"git worktree list"*) : ;;  # read-only
  git|"git "*)
    if [[ -n "$AGENT_ID" ]]; then
      # Subagent: allow the in-worktree vocabulary ONLY when cwd is inside a worktree — and only
      # inside the worktree THIS agent owns (owners_claim binds on first use; critic 2026-07-02).
      case "$CWD" in
        */.claude/worktrees/*)
          wt_root="${CWD%%/.claude/worktrees/*}"; wt_rest="${CWD#*/.claude/worktrees/}"; wt_id="${wt_rest%%/*}"
          if ! owners_claim "$wt_root" "$wt_id"; then
            deny "worktree .claude/worktrees/$wt_id is bound to a different agent — a fixer may touch only its own worktree (class-B deviation)"
          fi
          case "$CMD" in
            "git "*add*|"git "*commit*|"git "*checkout*|"git "*switch*|"git "*restore*|\
            "git "*stash*|"git "*branch*|"git "*"rev-parse"*)
              allow ;;
            *)
              deny "subagent git command is not in the allowlist for its owned worktree (class-B deviation)" ;;
          esac ;;
        *) ;;
      esac
      deny "subagent git is permitted only inside its own .claude/worktrees/<id> (add/commit/checkout/switch/restore/stash/branch/rev-parse). This command or location is not allowed (class-B deviation)."
    fi
    # Main thread: route mutating git to the approval prompt.
    ask "git command needs your approval — review it before allowing (this is the history the gate's BASE-diff trusts)" ;;
  *) ;;
esac

# fix-worker entering an orchestrator-created worktree (§6.9). cd is side-effect-free —
# the cwd-keyed git scoping above is re-checked on every later call. No `..` traversal, and a
# subagent may only cd into the worktree it OWNS (owners_claim binds on first use — without this,
# a worker could cd into a SIBLING's worktree and the cwd-keyed vocabulary would follow it there).
case "$CMD" in
  "cd "*".claude/worktrees/"*)
    case "$CMD" in
      *".."*) : ;;
      *)
        [[ -z "$AGENT_ID" ]] && allow   # main thread: unchanged
        cd_tgt="${CMD#cd }"; cd_tgt="${cd_tgt#\"}"; cd_tgt="${cd_tgt%\"}"; cd_tgt="${cd_tgt#\'}"; cd_tgt="${cd_tgt%\'}"
        cd_rest="${cd_tgt#*.claude/worktrees/}"; cd_id="${cd_rest%%/*}"
        case "$cd_tgt" in
          /*) cd_root="${cd_tgt%%/.claude/worktrees/*}" ;;
          *)  cd_root="$CWD" ;;
        esac
        if owners_claim "$cd_root" "$cd_id"; then allow; fi
        deny "worktree .claude/worktrees/$cd_id is bound to a different agent — cd refused (class-B deviation)" ;;
    esac ;;
  *) ;;
esac

# Auto-allow vocabulary — anchored at command start; only reached for single, simple commands.
case "$CMD" in
  "./scripts/gate.sh"*|"./scripts/gate-full.sh"*|"npm run "*|"npm test"*|"npx tsc"*|"npx eslint"*|"npx knip"*|"npx openspec"*|"openspec "*|\
  "git status"*|"git diff"*|"git log"*|"git show"*|"git rev-parse"*|"git worktree list"*|\
  "ls"*|"cat "*|"head "*|"tail "*|"grep "*|"rg "*|"wc "*|"mkdir "*)
    allow ;;
  *) ;;
esac

# Unknown: no decision -> normal permission flow.
exit 0
