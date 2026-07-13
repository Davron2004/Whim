#!/usr/bin/env bash
# Preserve the canonical Bash no-stall policy when Codex is already about to request approval.
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ERR=$(mktemp "${TMPDIR:-/tmp}/whim-codex-permission-hook.XXXXXX")
trap 'rm -f "$ERR"' EXIT
INPUT=$(cat)
OUTPUT=$(printf '%s' "$INPUT" | "$ROOT/.claude/hooks/bash-policy.sh" 2>"$ERR")
STATUS=$?
printf '%s' "$OUTPUT" | bash "$ROOT/.codex/hooks/translate-pre-tool-use.sh" permission "$STATUS" "$ERR"
