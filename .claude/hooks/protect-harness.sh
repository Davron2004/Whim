#!/usr/bin/env bash
# PreToolUse(Edit|Write) hook. Anti-reward-hacking layer.
#
# Policy:
#   - Autonomous SUBAGENTS (implementer, etc.) can NEVER edit harness/verification config →
#     hard block (exit 2), report as a class-B deviation. (Guarantee unchanged.)
#   - The interactive MAIN thread is routed to the normal CLI approval prompt
#     (permissionDecision:"ask") so you can approve legit config edits in-session.
#
# The subagent-vs-main signal is `agent_id`, which Claude Code fills in and the agent
# cannot forge — present only inside a subagent. Requires `jq`.
INPUT=$(cat)
FILE=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')
AGENT_ID=$(echo "$INPUT" | jq -r '.agent_id // empty')

# grant_allows <abs-file>: true (0) iff a per-worktree grant covers this file (docs/archive/parallel-fix-loop.md
# §4.9 Class-1 scoped grant). The grant lives at the REPO ROOT (.claude/fixloop/grants/<wt-id>), NOT in
# the worktree — repo-root .claude/ is agent-unwritable (block-list below + bash-policy), so a subagent
# cannot forge its own grant. Root + worktree id are derived from the file path itself (no cwd trust).
# Format mirrors the fixloop.sh allowlist exactly: one repo-relative glob per line, '#' comments, blanks
# skipped. Callers MUST have already excluded Class-2 — a grant never unlocks the control plane.
grant_allows() {
  local f="$1" root rest wtid rel pat gf
  case "$f" in */.claude/worktrees/*) ;; *) return 1;; esac
  root="${f%%/.claude/worktrees/*}"
  rest="${f#*/.claude/worktrees/}"; wtid="${rest%%/*}"; rel="${rest#*/}"
  gf="$root/.claude/fixloop/grants/$wtid"
  [[ -f "$gf" ]] || return 1
  while IFS= read -r pat; do
    [[ -z "$pat" ]] && continue
    case "$pat" in \#*) continue;; *) ;; esac
    # shellcheck disable=SC2254
    case "$rel" in $pat) return 0;; *) ;; esac
  done < "$gf"
  return 1
}

# Per-project memory store: a SHARED, cross-session, single-writer resource. Subagents must NOT
# mutate it directly (no review, and N parallel subagents would race the MEMORY.md index) — they
# propose edits in their report (a MEMORY: section) and the orchestrator applies them, human-gated.
# The main thread is routed to `ask` so every memory mutation is reviewed as a diff before it lands
# (Write/Edit bypass the OS sandbox, so this prompt — not the sandbox — is the gate on memory).
case "$FILE" in
  */.claude/projects/*/memory/*)
    if [[ -n "$AGENT_ID" ]]; then
      echo "BLOCKED: the shared cross-session memory store is single-writer and human-reviewed. Subagents must NOT write it directly — propose your edit in the report's MEMORY: section and the orchestrator applies it (human-gated). Report as a class-B deviation." >&2
      exit 2
    fi
    cat <<'JSON'
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "ask",
    "permissionDecisionReason": "Persistent cross-session memory — review the full diff before approving."
  }
}
JSON
    exit 0 ;;
  *) ;;
esac

# Ephemeral fix worktrees (isolation:'worktree' → under .claude/worktrees/<id>/) hold ordinary repo
# files a fixer may freely edit. But a worktree is a FULL checkout, so it also contains COPIES of the
# protected files — handle those by class (docs/archive/parallel-fix-loop.md §4.9). For SUBAGENTS:
#   • Class 2 (control plane: nested .claude/, build/, gate scripts, fixloop.sh, invariants/) — NEVER
#     editable, even in-worktree and even if a grant lists it. Hard block here (immediate), with the
#     post-hoc `fixloop integrity` diff as the second backstop. This CLOSES the old hole: the previous
#     blanket carve-out silently allowed a subagent to edit gate.sh/fixloop.sh/invariants/ in-worktree.
#   • Class 1 (package.json/tsconfig/eslint/knip/babel/metro) — editable ONLY under a per-worktree
#     grant: allowed iff `.claude/fixloop/grants/<id>` covers this file; otherwise blocked. No grant,
#     no edit — and no mid-flight prompt either way (the plan-approval + grant-write was the touchpoint).
#   • anything else (src/, fixtures/, docs/, tests…) — freely editable; that is the carve-out's point.
# The MAIN thread inside a worktree keeps the interactive path (Class-1/2 fall through to `ask` below;
# ordinary files are freely allowed) — the human is present, so no grant is required.
case "$FILE" in
  # Class 2 — the harness that verifies the work. Subagent: hard-block; main thread: fall to `ask`.
  */.claude/worktrees/*/.claude/*|\
  */.claude/worktrees/*/.codex/*|\
  */.claude/worktrees/*/build/*|\
  */.claude/worktrees/*/scripts/gate.sh|*/.claude/worktrees/*/scripts/gate-full.sh|*/.claude/worktrees/*/scripts/fixloop.sh|*/.claude/worktrees/*/scripts/git-cleanup-check.sh|\
  */.claude/worktrees/*/scripts/sync-codex.mjs|\
  */.claude/worktrees/*/invariants/*)
    if [[ -n "$AGENT_ID" ]]; then
      echo "BLOCKED: '$FILE' is Class-2 control-plane config (the harness that verifies the work). It is NEVER editable by a subagent — even inside a worktree, even under a grant. Report as a class-B deviation." >&2
      exit 2
    fi ;;
  # Class 1 — grantable config. Subagent: allowed iff a per-worktree grant covers it; else block.
  */.claude/worktrees/*/package.json|*/.claude/worktrees/*/package-lock.json|\
  */.claude/worktrees/*/tsconfig*.json|\
  */.claude/worktrees/*/eslint.config.*|*/.claude/worktrees/*/.eslintrc*|*/.claude/worktrees/*/.eslintignore|\
  */.claude/worktrees/*/knip.json|*/.claude/worktrees/*/knip.config.*|\
  */.claude/worktrees/*/babel.config.js|*/.claude/worktrees/*/metro.config.js)
    if [[ -n "$AGENT_ID" ]]; then
      if grant_allows "$FILE"; then exit 0; fi
      echo "BLOCKED: '$FILE' is Class-1 protected config. A subagent may edit it only under a per-worktree grant (.claude/fixloop/grants/<id>) written by the orchestrator; none covers this file. Report as a class-B deviation (or the orchestrator declares it in the plan allowlist and writes the grant)." >&2
      exit 2
    fi ;;
  # Any other file inside a worktree → free (the carve-out's actual purpose).
  */.claude/worktrees/*) exit 0 ;;
  *) ;;
esac

case "$FILE" in
  */scripts/gate.sh|scripts/gate.sh|*/scripts/gate-full.sh|scripts/gate-full.sh|*/scripts/fixloop.sh|scripts/fixloop.sh|\
  */scripts/git-cleanup-check.sh|scripts/git-cleanup-check.sh|\
  */scripts/sync-codex.mjs|scripts/sync-codex.mjs|\
  */.claude/*|.claude/*|\
  */.codex/*|.codex/*|\
  */eslint.config.*|eslint.config.*|*/.eslintrc*|.eslintrc*|*/.eslintignore|.eslintignore|\
  */knip.json|knip.json|*/knip.config.*|knip.config.*|\
  */tsconfig*.json|tsconfig*.json|\
  */package.json|package.json|*/package-lock.json|package-lock.json|\
  */babel.config.js|babel.config.js|\
  */metro.config.js|metro.config.js|\
  */build/*|build/*|\
  */invariants/*|invariants/*)

    if [[ -n "$AGENT_ID" ]]; then
      echo "BLOCKED: harness/verification config is human-approved only. Subagents cannot edit it — report as a class-B deviation." >&2
      exit 2
    fi
    cat <<'JSON'
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "ask",
    "permissionDecisionReason": "Protected harness/verification config — review the diff before approving."
  }
}
JSON
    exit 0
    ;;
  *) ;;
esac
exit 0
