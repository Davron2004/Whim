#!/usr/bin/env bash
# PreToolUse(Edit|Write) hook. The anti-reward-hacking layer: an agent that can't pass the
# checks must never be able to edit the checks. Blocks even in permissive modes.
#
# package.json is included because `npm run` is broadly allowed — an agent must not be able to
# redefine what `npm run typecheck` means. .eslintignore is included because it defines the
# lint scope (Whim-specific: it mirrors tsconfig's excludes; widening it would silence real
# findings). Script or dependency changes are class-B deviations: the agent stops, the human
# edits these in an editor. Requires `jq`.
INPUT=$(cat)
FILE=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')

# Exemption: the global memory store (~/.claude/projects/<slug>/memory/) lives under a
# .claude/ dir but is NOT harness config — it is Claude Code's per-project memory. Let it
# through, or the broad */.claude/* rule below would silently break memory persistence.
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
    echo "BLOCKED: harness and verification config are human-edited only. If a config change is genuinely required, report it as a class-B deviation." >&2
    exit 2
    ;;
esac
exit 0
