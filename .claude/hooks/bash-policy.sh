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

# Codex can execute a command with an explicit workdir while the shared hook payload's top-level
# cwd remains pinned to the repo root. For Git only, accept an exact, unquoted, absolute
# `git -C <repo>/.claude/worktrees/<id> …` as the location signal. Normalize it BEFORE every Git
# policy check so `git -C … push/config` cannot bypass the tier-1 denies. Ambiguous paths (spaces,
# traversal, a nested suffix, or a missing id) do not normalize and therefore remain denied for
# subagents by the ordinary scoped-Git policy below.
POLICY_CMD="$CMD"
GIT_C_ROOT=""
GIT_C_WT_ID=""
if [[ "$CMD" =~ ^git[[:space:]]+-C[[:space:]]+(/[^[:space:]]*/\.claude/worktrees/([^/[:space:]]+))[[:space:]]+(.+)$ ]]; then
  git_c_path="${BASH_REMATCH[1]}"
  git_c_id="${BASH_REMATCH[2]}"
  git_c_rest="${BASH_REMATCH[3]}"
  git_c_root="${git_c_path%%/.claude/worktrees/*}"
  case "$git_c_path" in
    *'/../'*|*'/./'*|*/..|*/.) ;;
    "$git_c_root/.claude/worktrees/$git_c_id")
      if [[ -n "$git_c_root" && -n "$git_c_rest" && "$git_c_rest" != -* ]]; then
        POLICY_CMD="git $git_c_rest"
        GIT_C_ROOT="$git_c_root"
        GIT_C_WT_ID="$git_c_id"
      fi ;;
    *) ;;
  esac
fi

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
  local root="$1"
  local wt_id="$2"
  local of="$root/.claude/fixloop/owners/$wt_id"
  mkdir -p "$root/.claude/fixloop/owners" 2>/dev/null
  if [[ -f "$of" ]]; then [[ "$(cat "$of" 2>/dev/null)" = "$AGENT_ID" ]]; return; fi
  ( set -C; printf '%s\n' "$AGENT_ID" > "$of" ) 2>/dev/null || true
  [[ "$(cat "$of" 2>/dev/null)" = "$AGENT_ID" ]]
}

# cleanup_lane: the git-cleanup lane (docs/archive/parallel-fix-loop.md §4.10; branch-parameterized
# by openspec: staging-branch-integration). ACTIVE iff (a) the human-minted grant exists
# (.claude/fixloop/grants/git-cleanup — agent-unwritable, same trust anchor as Class-1 grants),
# (b) the command runs from inside the lane worktree whose name DERIVES FROM THE GRANT's target
# (`<target_branch with / -> ->-squashed`; legacy grants without target_branch mean main →
# main-squashed) — the grant, not the path, is the authority on which lane exists, and
# (c) THIS agent owns that worktree (owners_claim — same binding as fixers). Inside the lane the
# history-rewrite PATH is freed; the OUTCOME gate is scripts/git-cleanup-check.sh (tree-tip
# identity + target unmoved + backup intact). The main thread is never lane-checked (returns 1 →
# existing behavior), and with no grant file the lane does not exist — policy is byte-identical
# to before for every other caller.
cleanup_lane() {
  [[ -n "$AGENT_ID" ]] || return 1
  local root="" wt_id=""
  case "$CWD" in
    */.claude/worktrees/*-squashed|*/.claude/worktrees/*-squashed/*)
      root="${CWD%%/.claude/worktrees/*}"
      local cl_rest="${CWD#*/.claude/worktrees/}"
      wt_id="${cl_rest%%/*}" ;;
    *)
      # The harness can re-pin a subagent's hook cwd to the repo root. The exact normalized
      # `git -C <lane-root> …` signal above is the only alternate location source.
      case "$GIT_C_WT_ID" in
        *-squashed) root="$GIT_C_ROOT"; wt_id="$GIT_C_WT_ID" ;;
        *) return 1 ;;
      esac ;;
  esac
  local grant="$root/.claude/fixloop/grants/git-cleanup"
  [[ -f "$grant" ]] || return 1
  local gc_target
  gc_target=$(grep -E '^target_branch=' "$grant" | head -1 | cut -d= -f2)
  [[ -n "$gc_target" ]] || gc_target="main"
  [[ "$wt_id" = "${gc_target//\//-}-squashed" ]] || return 1
  owners_claim "$root" "$wt_id"
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
# Remote-write policy (openspec: staging-integration-lane). The human gate for the SHARED remote's
# protected state (`main`) is the server-side GitHub ruleset (require PR, block force-push, restrict
# deletion, require checks) — agents cannot edit it, so it is strictly stronger than any local ask.
# Re-anchored here (the scoped-`ask`-per-push is retired):
#   - ANY push naming `main`/`dev/v1` (incl. refspec smuggling `integration/x:main`) is denied for
#     EVERY caller, match-anywhere, as fail-closed belt-and-braces — a local instant-deny beats a
#     server rejection; "rename the branch" stays the workaround, never a relaxation.
#   - Subagents are denied EVERY push, unconditionally (they never reach the shared remote).
#   - The main thread may push non-`main` refs WITHOUT a prompt — staging-lane traffic, including
#     `git push --force-with-lease origin integration/<id>` for the cleanup lane. Branches are free
#     by declared policy; the protected state is `main`, and its ratification is the reviewed PR.
#   - A COMPOUND containing a push is NOT blanket-denied here: it falls through to the
#     compound-command policy below, which judges the push segment-by-segment (worst-segment verdict).
case "$POLICY_CMD" in
  *"git push"*)
    case "$POLICY_CMD" in
      *main*|*"dev/v1"*)
        deny "push naming a protected branch (main/dev/v1) is denied for ALL callers — the server-side ruleset + PR review is the merge gate; rename the branch (class-B deviation)" ;;
    esac
    if [[ -n "$AGENT_ID" ]]; then
      deny "subagents are denied every push form, unconditionally (class-B deviation)"
    fi
    case "$CMD" in
      *'&'*|*';'*|*'|'*|*'`'*|*'$('*|*'>'*|*'<'*|*$'\n'*) : ;;  # compound: judged by the compound-command policy below
      *)
        case "$POLICY_CMD" in
          "git push "*) allow ;;   # main-thread push of a non-`main` ref (any main-naming form denied above)
          *) : ;;                  # unanchored forms (`git -c … push`) fall through to the generic prompt
        esac ;;
    esac ;;
esac
# Tier-1 relaxation (main thread only, openspec: staging-integration-lane). Closure's ancestor check
# and post-merge teardown need to READ the remote and fast-forward local `main`. EXACTLY two simple
# forms are allowed, main-thread only; every other fetch/pull — and any compounded form — stays
# tier-1 denied for all callers below.
if [[ -z "$AGENT_ID" ]]; then
  case "$CMD" in
    *'&'*|*';'*|*'|'*|*'`'*|*'$('*|*'>'*|*'<'*|*$'\n'*) : ;;  # compound: not relaxed; tier-1 denies below
    *)
      case "$POLICY_CMD" in
        "git fetch origin"|"git fetch origin "*|\
        "git pull --ff-only origin main"|"git pull --ff-only origin main "*)
          allow ;;
      esac ;;
  esac
fi
# Security-critical git, TIER 1 — SHARED-state reach: network, shared-ref forcing, recovery-data
# destruction (reflog/gc — the reflog + backup ref are the cleanup lane's undo button), and
# `git config` (a linked worktree's `git config` writes the SHARED .git/config; core.fsmonitor
# there is code execution in the MAIN tree). Denied for EVERY caller — orchestrator, subagents,
# and the cleanup lane alike — and kept HERE (match-anywhere) so a chained segment can't smuggle
# them past the simple-command policy below. `git worktree` is intentionally NOT listed: the
# orchestrator (main thread) needs it; subagents are blocked from it by the scoped policy further
# down. Worktree-safe mutating git (commit/add/checkout/…) is handled there too.
case "$POLICY_CMD" in
  *"git pull"*|*"git fetch"*|*"git clone"*|*"git remote"*|\
  *"git update-ref"*|*"git symbolic-ref"*|*"git reflog"*|*"git gc"*|*"git config"*|\
  *"git tag -f"*|*"git tag -d"*|\
  *"git branch -f dev/v1"*|*"git branch -D dev/v1"*|*"git branch -m dev/v1"*|\
  *"git branch -f main"*|*"git branch -D main"*|*"git branch -m main"*|\
  *"git checkout -B main"*|*"git switch -C main"*|*"git checkout -B dev/v1"*|*"git switch -C dev/v1"*)
    deny "git network/shared-ref/history op is human-approved only (class-B deviation)" ;;
esac
# The ACTIVE staging branch (integration/*) is protected like main against SUBAGENT ref rewrites
# (openspec: staging-branch-integration; static glob, no per-run enumeration). The main thread
# falls through to the ordinary mutating-git ask below — branch creation at run start and
# deletion at run closure are orchestrator/human steps reviewed at the prompt.
if [[ -n "$AGENT_ID" ]]; then
  case "$POLICY_CMD" in
    *"git branch -f integration/"*|*"git branch -D integration/"*|*"git branch -m integration/"*|\
    *"git checkout -B integration/"*|*"git switch -C integration/"*)
      deny "the staging branch (integration/*) is orchestrator/human-managed — subagent force-ops on it are denied (class-B deviation)" ;;
  esac
fi
# Security-critical git, TIER 2 — history rewrite: denied everywhere EXCEPT inside the active
# git-cleanup lane (§4.10), where tree-tip identity at finish is the real gate and the path is
# deliberately free. Still match-anywhere for non-lane callers; in-lane chained forms fall to the
# compound fall-through below (no auto-allow of chained payloads either way).
case "$POLICY_CMD" in
  *"git rebase"*)
    if ! cleanup_lane; then
      deny "git history rewrite is human-approved only outside the git-cleanup lane (class-B deviation)"
    fi ;;
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
# .claude/fixloop/grants is the scoped-grant manifest dir (docs/archive/parallel-fix-loop.md §4.9): a subagent
# must never write it, or it could forge its own Class-1 grant. Same for fixloop/owners (the
# agent↔worktree binding markers) — forging one would let a fixer claim a sibling's worktree.
# invariants/ is the never-regress suite (owner-authored) — write-protected like the gate it feeds.
PROTECTED='package\.json|package-lock\.json|tsconfig[^ ]*\.json|\.eslintignore|\.eslintrc[^ ]*|eslint\.config\.[a-z]+|knip\.json|knip\.config\.[a-z]+|scripts/gate\.sh|scripts/gate-full\.sh|scripts/fixloop\.sh|scripts/git-cleanup-check\.sh|scripts/sync-codex\.mjs|\.claude/(hooks|settings|agents|commands|fixloop/(grants|owners))|\.codex/|build/|invariants/'
BND='(^|[[:space:]&;|(])'
if printf '%s' "$CMD" | grep -Eq ">>?[[:space:]]*[^|&;]*($PROTECTED)|${BND}sed[^|]*-i[^|]*($PROTECTED)|${BND}tee[[:space:]][^|]*($PROTECTED)|${BND}(cp|mv|ln|install|dd|truncate)[[:space:]][^|]*($PROTECTED)|npm[[:space:]]+pkg[[:space:]]+(set|delete)|(yarn|pnpm)[[:space:]]+config[[:space:]]+set"; then
  deny "command writes to harness/verification config — use the Edit tool (prompts you on the main thread) or change it as a human; class-B deviation for subagents"
fi

# Compound commands (openspec: compound-command-policy). Positioned BEFORE the git / auto-allow
# policies so neither can auto-ALLOW a chained payload; the security-critical denies above already
# ran on the RAW string via match-anywhere, so a denied substring cannot survive a parser bug. A
# command joined by top-level && || ; | is unrolled by the parser helper and judged by its WORST
# segment (deny > ask > none > allow). Anything the parser cannot soundly unroll — command
# substitution, expansion, eval-family wrappers, process substitution, … — falls through to the
# pre-existing generic permission flow, EXACTLY as before this capability existed (fail closed to
# the prompt, never to allow).
#
# WHIM_BASH_POLICY_SEGMENT marks a re-entrant per-segment evaluation: skip unrolling entirely so a
# segment carrying a QUOTED connector or redirect is judged as the simple command it is (quotes are
# inert to the prefix-based policy below), and so the recursion cannot run away.
if [[ -z "${WHIM_BASH_POLICY_SEGMENT:-}" ]]; then
  case "$CMD" in
    *'&'*|*';'*|*'|'*|*'`'*|*'$('*|*'>'*|*'<'*|*$'\n'*)
      HOOKDIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
      UNROLL_JSON=$(printf '%s' "$CMD" | node "$HOOKDIR/unroll-command.mjs" 2>/dev/null)
      if [[ -z "$UNROLL_JSON" ]] || [[ "$(printf '%s' "$UNROLL_JSON" | jq -r '.unrollable // false')" != "true" ]]; then
        exit 0   # not soundly unrollable -> pre-existing generic permission flow, unchanged
      fi
      # Redirect pseudo-writes: deny a redirect whose target hits the protected list (shell redirects
      # bypass the Edit/Write file-protection hook). Belt-and-braces with the raw-string check above.
      while IFS= read -r _rt; do
        [[ -n "$_rt" ]] || continue
        if printf '%s' "$_rt" | grep -Eq "($PROTECTED)"; then
          deny "compound redirect writes to harness/verification config ($_rt) — use the Edit tool (class-B deviation)"
        fi
      done < <(printf '%s' "$UNROLL_JSON" | jq -r '.redirects[]?')
      # Evaluate each segment through THIS policy (re-entrant, guarded); keep the worst verdict.
      _worst=0   # 0 allow  1 none/fallthrough  2 ask  3 deny
      while IFS= read -r _seg; do
        [[ -n "$_seg" ]] || continue
        _out=$(printf '%s' "$INPUT" | jq -c --arg c "$_seg" '.tool_input.command=$c' \
                 | WHIM_BASH_POLICY_SEGMENT=1 bash "${BASH_SOURCE[0]}")
        if [[ -z "$_out" ]]; then _lvl=1; else
          case "$(printf '%s' "$_out" | jq -r '.hookSpecificOutput.permissionDecision // "none"')" in
            allow) _lvl=0 ;; deny) _lvl=3 ;; ask) _lvl=2 ;; *) _lvl=1 ;;
          esac
        fi
        (( _lvl > _worst )) && _worst=$_lvl
        (( _worst == 3 )) && break
      done < <(printf '%s' "$UNROLL_JSON" | jq -r '.segments[]')
      case "$_worst" in
        3) deny "a segment of this compound is denied by policy (class-B deviation)" ;;
        2) ask "compound command — review the full command line before approving" ;;
        1) exit 0 ;;   # defer to the normal permission flow, as an unknown simple command would
        0) allow ;;
      esac ;;
    *) ;; # simple command: continue to the scoped policies below
  esac
fi

# ---- git policy (simple commands only — compound already fell through) ----------------------
# Tamper detection is decoupled from git (docs/archive/parallel-fix-loop.md): the orchestrator audits
# every fix as `git diff <recorded BASE>`, which a commit cannot hide — so a subagent may use git
# INSIDE its own worktree. Allowed there: add/commit/checkout/switch/restore/stash/branch/rev-parse.
case "$POLICY_CMD" in
  "git status"*|"git diff"*|"git log"*|"git show"*|"git rev-parse"*|"git worktree list"*) : ;;  # read-only
  git|"git "*)
    if [[ -n "$AGENT_ID" ]]; then
      # git-cleanup lane (§4.10): inside the ACTIVE lane the full simple-command git vocabulary is
      # allowed — the tier-1 denies above have already screened every shared-state verb, and the
      # outcome gate (tree-tip identity) is what actually vouches for the result. Worktree
      # management stays orchestrator-only even here.
      if cleanup_lane; then
        case "$POLICY_CMD" in
          "git worktree"*)
            deny "git worktree management is orchestrator-only, even inside the cleanup lane (class-B deviation)" ;;
          *) allow ;;
        esac
      fi
      # Subagent: allow the in-worktree vocabulary ONLY when cwd is inside a worktree — and only
      # inside the worktree THIS agent owns (owners_claim binds on first use; critic 2026-07-02).
      git_wt_root=""
      git_wt_id=""
      if [[ -n "$GIT_C_WT_ID" ]]; then
        git_wt_root="$GIT_C_ROOT"
        git_wt_id="$GIT_C_WT_ID"
      else
        case "$CWD" in
          */.claude/worktrees/*)
            git_wt_root="${CWD%%/.claude/worktrees/*}"
            git_wt_rest="${CWD#*/.claude/worktrees/}"
            git_wt_id="${git_wt_rest%%/*}" ;;
          *) ;;
        esac
      fi
      if [[ -n "$git_wt_id" ]]; then
          wt_root="$git_wt_root"; wt_id="$git_wt_id"
          if ! owners_claim "$wt_root" "$wt_id"; then
            deny "worktree .claude/worktrees/$wt_id is bound to a different agent — a fixer may touch only its own worktree (class-B deviation)"
          fi
          case "$POLICY_CMD" in
            "git add"|"git add "*|"git commit"|"git commit "*|\
            "git checkout"|"git checkout "*|"git switch"|"git switch "*|\
            "git restore"|"git restore "*|"git stash"|"git stash "*|\
            "git branch"|"git branch "*|"git rev-parse"|"git rev-parse "*)
              allow ;;
            *)
              deny "subagent git command is not in the allowlist for its owned worktree (class-B deviation)" ;;
          esac
      fi
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

# gh vocabulary (openspec: staging-integration-lane; design §D4). Read-only forms auto-allow for
# every caller; closure mutations are main-thread-only and enumerated; `gh pr merge` is denied for
# ALL callers — merging the reviewed PR into `main` is the human's click on GitHub, never a local
# command. A compound containing gh is judged per-segment by the compound-command policy above.
case "$POLICY_CMD" in
  "gh "*|gh)
    case "$POLICY_CMD" in
      "gh pr merge"*)
        deny "gh pr merge is denied for all callers — the human merges the reviewed PR on GitHub (class-B deviation)" ;;
    esac
    # Read-only forms: allowed for everyone (subagents included).
    case "$POLICY_CMD" in
      "gh pr view"*|"gh pr checks"*|"gh pr status"*|"gh pr list"*|"gh pr diff"*|\
      "gh run view"*|"gh run list"*|"gh run watch"*)
        allow ;;
      "gh api "*)
        case "$POLICY_CMD" in
          *"-X GET"*|*"--method GET"*) allow ;;                                     # explicit GET
          *" -X "*|*"--method "*|*"-XPOST"*|*"-XPUT"*|*"-XPATCH"*|*"-XDELETE"*) : ;; # mutation -> caller rules
          *) allow ;;                                                               # no method flag -> GET
        esac ;;
    esac
    # Mutations from here. Subagents never mutate via gh.
    if [[ -n "$AGENT_ID" ]]; then
      deny "gh mutations are denied for subagents — read-only gh only (class-B deviation)"
    fi
    # Main-thread closure mutations: open the DRAFT PR and flip it to ready-for-review.
    case "$POLICY_CMD" in
      "gh pr create "*)
        case "$POLICY_CMD" in
          *"--draft"*) allow ;;
          *) : ;;   # non-draft create -> generic prompt (draft-first is the closure default)
        esac ;;
      "gh pr ready"*|"gh pr ready") allow ;;
      *) : ;;       # any other main-thread gh -> generic permission flow
    esac ;;
esac

# Auto-allow vocabulary — anchored at command start; only reached for single, simple commands.
case "$POLICY_CMD" in
  "./scripts/gate.sh"*|"./scripts/gate-full.sh"*|"npm run "*|"npm test"*|"npx tsc"*|"npx eslint"*|"npx knip"*|"npx openspec"*|"openspec "*|\
  "git status"*|"git diff"*|"git log"*|"git show"*|"git rev-parse"*|"git worktree list"*|\
  "ls"*|"cat "*|"head "*|"tail "*|"grep "*|"rg "*|"wc "*|"mkdir "*)
    allow ;;
  *) ;;
esac

# Unknown: no decision -> normal permission flow.
exit 0
