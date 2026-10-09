#!/usr/bin/env bash
# SubagentStop hook. Fires when any subagent tries to finish. Exit 2 blocks the stop and feeds
# stderr back to the subagent, which keeps working. Read-only agents pass through untouched
# (no dirty tree -> no gate). Requires `jq`.
INPUT=$(cat)
AGENT_TYPE=$(echo "$INPUT" | jq -r '.agent_type // empty')
SESSION=$(echo "$INPUT" | jq -r '.session_id // "unknown"')

# git-cleanup lane finisher (§4.10): the cleaner may stop only when the OUTCOME gate passes
# (tree-tip identity + main unmoved + backup intact). Self-reported verdicts are never trusted —
# same reasoning as the sandbox's F4 finding. Same attempt-cap pattern as the implementer gate.
if [[ "$AGENT_TYPE" = "git-cleaner" ]]; then
  ROOT="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
  COUNT_FILE="/tmp/cleanup-gate-attempts-${SESSION}"
  COUNT=$(cat "$COUNT_FILE" 2>/dev/null || echo 0)
  if [[ "$COUNT" -ge 2 ]]; then rm -f "$COUNT_FILE"; exit 0; fi
  OUT=$("$ROOT/scripts/git-cleanup-check.sh" 2>&1)
  if [[ $? -eq 0 ]]; then rm -f "$COUNT_FILE"; exit 0; fi
  echo $((COUNT + 1)) > "$COUNT_FILE"
  {
    echo "CLEANUP GATE FAILED — you are not done."
    echo "The outcome gate (tree-tip identity + main unmoved + backup intact) must pass before you finish."
    echo "--- gate output ---"
    echo "$OUT" | tail -20
  } >&2
  exit 2
fi

# Only gate the implementer.
[[ "$AGENT_TYPE" = "implementer" ]] || exit 0

# Nothing changed -> nothing to verify (also exempts read-only agents defensively).
if git diff --quiet && git diff --cached --quiet; then exit 0; fi

# Attempt cap: after 2 blocked stops, let it stop. The report will say failed-gate and the
# dispatcher handles it. Prevents infinite loops.
COUNT_FILE="/tmp/gate-attempts-${SESSION}"
COUNT=$(cat "$COUNT_FILE" 2>/dev/null || echo 0)
if [[ "$COUNT" -ge 2 ]]; then rm -f "$COUNT_FILE"; exit 0; fi

# Gate the tree the dirty check above just inspected: the subagent's cwd, which is its own worktree
# for a chain implementer. CLAUDE_PROJECT_DIR and this hook's location both name the primary tree,
# which would gate unmerged worktree work against the wrong checkout (false blocks).
ROOT="$(git rev-parse --show-toplevel 2>/dev/null)"
ROOT="${ROOT:-${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}}"
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
