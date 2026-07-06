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

# Per-project memory store: a SHARED, cross-session, single-writer resource. Subagents must NOT
# mutate it directly (no review, and N parallel subagents would race the MEMORY.md index) — they
# propose edits in their report (a MEMORY: section) and the orchestrator applies them, human-gated.
# The main thread is routed to `ask` so every memory mutation is reviewed as a diff before it lands
# (Write/Edit bypass the OS sandbox, so this prompt — not the sandbox — is the gate on memory).
case "$FILE" in
  */.claude/projects/*/memory/*)
    if [ -n "$AGENT_ID" ]; then
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
esac

# Exemption: ephemeral fix worktrees (isolation:'worktree' lands them under .claude/worktrees/)
# hold ordinary repo files, NOT harness config — so allow edits to those. Two carve-outs WITHIN the
# carve-out stay protected even inside a worktree: a worktree's own nested .claude/ config (a
# checked-out copy of these very hooks) and the build/ harness (executed by `npm run build`) both
# fall through to the block-list below (defense in depth).
case "$FILE" in
  */.claude/worktrees/*/.claude/*) ;;
  */.claude/worktrees/*/build/*) ;;
  */.claude/worktrees/*) exit 0 ;;
esac

case "$FILE" in
  */scripts/gate.sh|scripts/gate.sh|*/scripts/gate-full.sh|scripts/gate-full.sh|*/scripts/fixloop.sh|scripts/fixloop.sh|\
  */.claude/*|.claude/*|\
  */eslint.config.*|eslint.config.*|*/.eslintrc*|.eslintrc*|*/.eslintignore|.eslintignore|\
  */knip.json|knip.json|*/knip.config.*|knip.config.*|\
  */tsconfig*.json|tsconfig*.json|\
  */package.json|package.json|*/package-lock.json|package-lock.json|\
  */babel.config.js|babel.config.js|\
  */metro.config.js|metro.config.js|\
  */build/*|build/*)

    if [ -n "$AGENT_ID" ]; then
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
esac
exit 0
