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

# Exemption: per-project memory store lives under .claude/ but is not harness config.
case "$FILE" in
  */.claude/projects/*/memory/*) exit 0 ;;
esac

case "$FILE" in
  */scripts/gate.sh|scripts/gate.sh|\
  */.claude/*|.claude/*|\
  */eslint.config.*|eslint.config.*|*/.eslintrc*|.eslintrc*|*/.eslintignore|.eslintignore|\
  */knip.json|knip.json|*/knip.config.*|knip.config.*|\
  */tsconfig*.json|tsconfig*.json|\
  */package.json|package.json|*/package-lock.json|package-lock.json)
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
