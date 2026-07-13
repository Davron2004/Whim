#!/usr/bin/env bash
# Apply one exact, user-approved Class-2 patch. The PreToolUse authorizer creates
# a short-lived grant only for the registered root transcript; the prompt rule
# then requires a human decision before this helper executes.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PATCH=""
WANT_HASH=""
if [[ "$#" -eq 4 && "$1" == "--patch" && "$3" == "--sha256" ]]; then
  PATCH="$2"
  WANT_HASH="$4"
else
  echo "usage: $0 --patch /absolute/reviewed.patch --sha256 <hex>" >&2
  exit 2
fi

[[ "$PATCH" =~ ^/[-A-Za-z0-9_./]+$ ]] || { echo "invalid reviewed patch path" >&2; exit 3; }
[[ "$WANT_HASH" =~ ^[0-9a-f]{64}$ ]] || { echo "invalid sha256" >&2; exit 3; }

COMMON="$(git -C "$ROOT" rev-parse --git-common-dir)"
[[ "$COMMON" == /* ]] || COMMON="$ROOT/$COMMON"
STATE="$COMMON/codex-protected-approval"
GRANT="$STATE/grant-$WANT_HASH.json"
SNAPSHOT="$STATE/reviewed-$WANT_HASH.patch"
[[ -f "$GRANT" && ! -L "$GRANT" && -f "$SNAPSHOT" && ! -L "$SNAPSHOT" ]] || { echo "no one-shot grant for this patch" >&2; exit 5; }
cleanup() { rm -f "$GRANT" "$SNAPSHOT"; }
trap cleanup EXIT
[[ "$(jq -r '.sha256 // empty' "$GRANT")" == "$WANT_HASH" ]] || { echo "grant hash mismatch" >&2; exit 5; }
[[ "$(shasum -a 256 "$SNAPSHOT" | awk '{print $1}')" == "$WANT_HASH" ]] || { echo "reviewed snapshot hash mismatch" >&2; exit 5; }
ISSUED_AT="$(jq -r '.issued_at // 0' "$GRANT")"
NOW="$(date +%s)"
[[ "$ISSUED_AT" =~ ^[0-9]+$ && "$NOW" -ge "$ISSUED_AT" && $((NOW - ISSUED_AT)) -le 300 ]] || {
  echo "grant expired" >&2
  exit 5
}

[[ "$(git -C "$ROOT" branch --show-current)" == "main" ]] || { echo "protected patches require main" >&2; exit 6; }
if grep -Eq '^(rename (from|to)|copy (from|to)) ' "$SNAPSHOT"; then
  echo "rename/copy patches are not supported" >&2
  exit 7
fi
git -C "$ROOT" apply --check --whitespace=error-all "$SNAPSHOT"

COUNT=0
while IFS=$'\t' read -r ADDED DELETED FILE; do
  [[ -n "$ADDED" && -n "$DELETED" && -n "$FILE" ]] || { echo "could not enumerate patch targets" >&2; exit 7; }
  [[ "$FILE" != /* && "$FILE" != *".."* && "$FILE" != *$'\n'* && "$FILE" != *$'\r'* ]] || {
    echo "ambiguous patch target: $FILE" >&2
    exit 7
  }
  case "$FILE" in
    scripts/gate.sh|scripts/gate-full.sh|scripts/fixloop.sh|scripts/git-cleanup-check.sh|scripts/sync-codex.mjs|\
    .claude/*|.codex/*|package.json|package-lock.json|tsconfig*.json|.eslintrc*|eslint.config.*|.eslintignore|\
    knip.json|babel.config.js|metro.config.js|invariants/*|build/*)
      ;;
    *) echo "not a Class-2 target: $FILE" >&2; exit 7 ;;
  esac
  COUNT=$((COUNT + 1))
done < <(git -C "$ROOT" apply --numstat "$SNAPSHOT")
[[ "$COUNT" -gt 0 ]] || { echo "patch has no targets" >&2; exit 7; }

# Consume before mutation: denial, replay, or a second invocation cannot reuse it.
rm -f "$GRANT"
git -C "$ROOT" apply --whitespace=error-all "$SNAPSHOT"
echo "Applied reviewed Class-2 patch sha256:$WANT_HASH"
