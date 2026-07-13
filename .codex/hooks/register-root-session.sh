#!/usr/bin/env bash
# SessionStart runs for the root task. Record its transcript in Git-private state
# so later PreToolUse events can reject every other transcript, including agents.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
INPUT="$(cat)"
SESSION="$(printf '%s' "$INPUT" | jq -r '.session_id // empty')"
TRANSCRIPT="$(printf '%s' "$INPUT" | jq -r '.transcript_path // empty')"
CWD="$(printf '%s' "$INPUT" | jq -r '.cwd // empty')"
AGENT_ID="$(printf '%s' "$INPUT" | jq -r '.agent_id // empty')"
[[ -n "$SESSION" && -n "$TRANSCRIPT" && "$CWD" == "$ROOT" && -z "$AGENT_ID" ]] || exit 0

COMMON="$(git -C "$ROOT" rev-parse --git-common-dir)"
[[ "$COMMON" == /* ]] || COMMON="$ROOT/$COMMON"
STATE="$COMMON/codex-protected-approval"
mkdir -p "$STATE"
chmod 700 "$STATE"
RECORD="$STATE/root-session.json"
TMP="$RECORD.tmp.$$"
jq -cn \
  --arg session_id "$SESSION" \
  --arg transcript_path "$TRANSCRIPT" \
  --argjson registered_at "$(date +%s)" \
  '{session_id:$session_id,transcript_path:$transcript_path,registered_at:$registered_at}' > "$TMP"
chmod 600 "$TMP"
mv "$TMP" "$RECORD"
