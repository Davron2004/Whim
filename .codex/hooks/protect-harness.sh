#!/usr/bin/env bash
# Codex apply_patch adapter for the canonical Claude Edit/Write protection policy.
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
INPUT=$(cat)
CWD=$(printf '%s' "$INPUT" | jq -r '.cwd // empty')
PATCH=$(printf '%s' "$INPUT" | jq -r '.tool_input.command // empty')

deny_parse() {
  local reason="$1"
  jq -cn --arg reason "$reason" '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",permissionDecisionReason:$reason}}'
  exit 0
}

[[ -n "$PATCH" ]] || deny_parse "Codex apply_patch hook received no patch command; protection adapter failed closed."
PATHS=$(printf '%s\n' "$PATCH" | sed -nE \
  -e 's/^\*\*\* (Add|Update|Delete) File: (.*)$/\2/p' \
  -e 's/^\*\*\* Move to: (.*)$/\1/p')
[[ -n "$PATHS" ]] || deny_parse "Codex apply_patch hook could not enumerate target paths; protection adapter failed closed."

while IFS= read -r FILE; do
  FILE="${FILE%$'\r'}"
  [[ -n "$FILE" ]] || deny_parse "Codex apply_patch contained an empty target path."
  while [[ "$FILE" = ./* ]]; do FILE="${FILE#./}"; done
  case "/$FILE/" in
    *'/../'*|*'/./'*) deny_parse "Codex apply_patch target uses ambiguous traversal; protection adapter failed closed." ;;
  esac
  case "$FILE" in
    /*) ABS_FILE="$FILE" ;;
    *) [[ -n "$CWD" ]] || deny_parse "Codex apply_patch target is relative but hook cwd is missing."
       ABS_FILE="$CWD/$FILE" ;;
  esac

  ERR=$(mktemp "${TMPDIR:-/tmp}/whim-codex-protect-hook.XXXXXX")
  SYNTHETIC=$(printf '%s' "$INPUT" | jq --arg file "$ABS_FILE" '.tool_input.file_path=$file')
  OUTPUT=$(printf '%s' "$SYNTHETIC" | "$ROOT/.claude/hooks/protect-harness.sh" 2>"$ERR")
  STATUS=$?
  TRANSLATED=$(printf '%s' "$OUTPUT" | bash "$ROOT/.codex/hooks/translate-pre-tool-use.sh" protect "$STATUS" "$ERR")
  rm -f "$ERR"
  if [[ -n "$TRANSLATED" ]]; then printf '%s\n' "$TRANSLATED"; exit 0; fi
done <<< "$PATHS"

exit 0
