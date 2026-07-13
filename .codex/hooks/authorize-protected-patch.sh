#!/usr/bin/env bash
# PreToolUse authorizer for the exact protected-patch helper command. Ordinary
# Bash commands are ignored; malformed helper-like commands fail closed.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
HELPER="$ROOT/.codex/hooks/apply-reviewed-protected-patch.sh"
INPUT="$(cat)"

deny() {
  jq -cn --arg reason "$1" '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",permissionDecisionReason:$reason}}'
  exit 0
}

COMMON="$(git -C "$ROOT" rev-parse --git-common-dir)"
[[ "$COMMON" == /* ]] || COMMON="$ROOT/$COMMON"
STATE="$COMMON/codex-protected-approval"
mkdir -p "$STATE"
chmod 700 "$STATE"
# A denied prompt leaves no durable authority: the next Bash event clears every
# unconsumed grant and its immutable snapshot before that command proceeds.
find "$STATE" -maxdepth 1 -type f \( -name 'grant-*.json' -o -name 'reviewed-*.patch' \) -delete

COMMAND="$(printf '%s' "$INPUT" | jq -r '.tool_input.command // empty')"
case "$COMMAND" in
  "$HELPER"*) ;;
  *) exit 0 ;;
esac

HELPER_RE="${HELPER//./\\.}"
if [[ "$COMMAND" =~ ^${HELPER_RE}\ --patch\ (/[-A-Za-z0-9_./]+)\ --sha256\ ([0-9a-f]{64})$ ]]; then
  PATCH="${BASH_REMATCH[1]}"
  WANT_HASH="${BASH_REMATCH[2]}"
else
  deny "Malformed protected-patch helper invocation."
fi

SESSION="$(printf '%s' "$INPUT" | jq -r '.session_id // empty')"
TRANSCRIPT="$(printf '%s' "$INPUT" | jq -r '.transcript_path // empty')"
TURN="$(printf '%s' "$INPUT" | jq -r '.turn_id // empty')"
CWD="$(printf '%s' "$INPUT" | jq -r '.cwd // empty')"
AGENT_ID="$(printf '%s' "$INPUT" | jq -r '.agent_id // empty')"
[[ -n "$SESSION" && -n "$TRANSCRIPT" && -n "$TURN" && "$CWD" == "$ROOT" && -z "$AGENT_ID" ]] || deny "Protected-patch identity context is incomplete or belongs to a subagent."
[[ "$PATCH" == /* && -f "$PATCH" && ! -L "$PATCH" ]] || deny "Protected patch must be an absolute regular non-symlink."
GOT_HASH="$(shasum -a 256 "$PATCH" | awk '{print $1}')"
[[ "$GOT_HASH" == "$WANT_HASH" ]] || deny "Protected patch hash mismatch before approval."

ROOT_RECORD="$STATE/root-session.json"
[[ -f "$ROOT_RECORD" && ! -L "$ROOT_RECORD" ]] || deny "No registered root Codex transcript; restart Codex."
ROOT_SESSION="$(jq -r '.session_id // empty' "$ROOT_RECORD")"
ROOT_TRANSCRIPT="$(jq -r '.transcript_path // empty' "$ROOT_RECORD")"
[[ "$SESSION" == "$ROOT_SESSION" && "$TRANSCRIPT" == "$ROOT_TRANSCRIPT" ]] || deny "Only the registered root task may request a Class-2 patch."

SNAPSHOT="$STATE/reviewed-$WANT_HASH.patch"
SNAPSHOT_TMP="$SNAPSHOT.tmp.$$"
cp -- "$PATCH" "$SNAPSHOT_TMP"
chmod 600 "$SNAPSHOT_TMP"
[[ "$(shasum -a 256 "$SNAPSHOT_TMP" | awk '{print $1}')" == "$WANT_HASH" ]] || deny "Protected patch changed while being snapshotted."
mv "$SNAPSHOT_TMP" "$SNAPSHOT"
GRANT="$STATE/grant-$WANT_HASH.json"
TMP="$GRANT.tmp.$$"
jq -cn \
  --arg session_id "$SESSION" \
  --arg transcript_path "$TRANSCRIPT" \
  --arg turn_id "$TURN" \
  --arg sha256 "$WANT_HASH" \
  --argjson issued_at "$(date +%s)" \
  '{session_id:$session_id,transcript_path:$transcript_path,turn_id:$turn_id,sha256:$sha256,issued_at:$issued_at}' > "$TMP"
chmod 600 "$TMP"
mv "$TMP" "$GRANT"
exit 0
