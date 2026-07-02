#!/usr/bin/env bash
# SubagentStop hook. Fires when any subagent tries to finish. Exit 2 blocks the stop and feeds
# stderr back to the subagent, which keeps working. Read-only agents pass through untouched
# (no dirty tree -> no gate). Requires `jq`.
INPUT=$(cat)
AGENT_TYPE=$(echo "$INPUT" | jq -r '.agent_type // empty')
SESSION=$(echo "$INPUT" | jq -r '.session_id // "unknown"')

# Only gate the implementer.
[[ "$AGENT_TYPE" = "implementer" ]] || exit 0

# Nothing changed -> nothing to verify (also exempts read-only agents defensively).
if git diff --quiet && git diff --cached --quiet; then exit 0; fi

# Attempt cap: after 2 blocked stops, let it stop. The report will say failed-gate and the
# dispatcher handles it. Prevents infinite loops.
COUNT_FILE="/tmp/gate-attempts-${SESSION}"
COUNT=$(cat "$COUNT_FILE" 2>/dev/null || echo 0)
if [[ "$COUNT" -ge 2 ]]; then rm -f "$COUNT_FILE"; exit 0; fi

# Resolve gate.sh by project root (CLAUDE_PROJECT_DIR), falling back to this hook's own location
# (.claude/hooks → repo root is two levels up) so it works regardless of the hook's cwd.
ROOT="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
OUT=$("$ROOT/scripts/gate.sh" 2>&1)
if [[ $? -eq 0 ]]; then
  rm -f "$COUNT_FILE"
  exit 0
fi

echo $((COUNT + 1)) > "$COUNT_FILE"
{
  echo "VERIFICATION GATE FAILED — you are not done."
  echo "Fix the failures, rerun ./scripts/gate.sh yourself, and only finish when it passes."
  echo "If a failure is genuinely outside your chain's scope, finish with STATUS: failed-gate and explain in DEVIATIONS."
  echo "--- gate output (tail) ---"
  echo "$OUT" | tail -40
} >&2
exit 2
