#!/usr/bin/env bash
# Translate canonical Claude PreToolUse decisions into the subset supported by Codex.
set -u

MODE="${1:-}"
STATUS="${2:-0}"
ERR_FILE="${3:-}"
OUTPUT=$(cat)

pretool_deny() {
  local reason="$1"
  jq -cn --arg reason "$reason" '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",permissionDecisionReason:$reason}}'
}

permission_deny() {
  local reason="$1"
  jq -cn --arg reason "$reason" '{hookSpecificOutput:{hookEventName:"PermissionRequest",decision:{behavior:"deny",message:$reason}}}'
}

if [[ "$STATUS" -ne 0 ]]; then
  REASON="$(cat "$ERR_FILE" 2>/dev/null)"
  [[ -n "$REASON" ]] || REASON="Canonical hook blocked without a reason."
  if [[ "$MODE" = "permission" ]]; then permission_deny "$REASON"; else pretool_deny "$REASON"; fi
  exit 0
fi

[[ -n "$OUTPUT" ]] || exit 0
if ! printf '%s' "$OUTPUT" | jq -e . >/dev/null 2>&1; then
  REASON="Canonical hook returned invalid JSON; Codex adapter failed closed."
  if [[ "$MODE" = "permission" ]]; then permission_deny "$REASON"; else pretool_deny "$REASON"; fi
  exit 0
fi

DECISION=$(printf '%s' "$OUTPUT" | jq -r '.hookSpecificOutput.permissionDecision // empty')
REASON=$(printf '%s' "$OUTPUT" | jq -r '.hookSpecificOutput.permissionDecisionReason // .reason // empty')
LEGACY=$(printf '%s' "$OUTPUT" | jq -r '.decision // empty')

if [[ "$LEGACY" = "block" ]]; then
  [[ -n "$REASON" ]] || REASON="Canonical hook blocked the operation."
  if [[ "$MODE" = "permission" ]]; then permission_deny "$REASON"; else pretool_deny "$REASON"; fi
  exit 0
fi

case "$MODE:$DECISION" in
  bash:deny|protect:deny)
    [[ -n "$REASON" ]] || REASON="Canonical hook denied the operation."
    pretool_deny "$REASON" ;;
  bash:allow|bash:ask|bash:)
    # Bare allow/ask are unsupported by Codex PreToolUse. Silence delegates to Codex's native
    # policy; PermissionRequest below restores auto-allow only if Codex was going to prompt.
    exit 0 ;;
  protect:allow|protect:)
    exit 0 ;;
  protect:ask)
    [[ -n "$REASON" ]] || REASON="Protected file requires human review."
    pretool_deny "$REASON Codex PreToolUse cannot force an approval prompt; edit this file manually as the human bootstrap step." ;;
  permission:allow)
    jq -cn '{hookSpecificOutput:{hookEventName:"PermissionRequest",decision:{behavior:"allow"}}}' ;;
  permission:deny)
    [[ -n "$REASON" ]] || REASON="Canonical hook denied the permission request."
    permission_deny "$REASON" ;;
  permission:ask|permission:)
    # No decision preserves Codex's normal approval prompt.
    exit 0 ;;
  *)
    REASON="Canonical hook returned an unsupported decision; Codex adapter failed closed."
    if [[ "$MODE" = "permission" ]]; then permission_deny "$REASON"; else pretool_deny "$REASON"; fi ;;
esac
