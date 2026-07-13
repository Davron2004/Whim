#!/usr/bin/env bash
# Codex adapter for the canonical Claude Bash policy.
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ERR=$(mktemp "${TMPDIR:-/tmp}/whim-codex-bash-hook.XXXXXX")
trap 'rm -f "$ERR"' EXIT
INPUT=$(cat)
OUTPUT=$(printf '%s' "$INPUT" | "$ROOT/.claude/hooks/bash-policy.sh" 2>"$ERR")
STATUS=$?
printf '%s' "$OUTPUT" | bash "$ROOT/.codex/hooks/translate-pre-tool-use.sh" bash "$STATUS" "$ERR"
