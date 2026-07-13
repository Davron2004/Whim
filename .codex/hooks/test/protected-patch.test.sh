#!/usr/bin/env bash
set -euo pipefail

SOURCE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/whim-protected-patch-test.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT
ROOT="$TMP/repo"
mkdir -p "$ROOT/.codex/hooks" "$ROOT/src"
ROOT="$(cd "$ROOT" && pwd)"
cp "$SOURCE_ROOT/.codex/hooks/register-root-session.sh" "$ROOT/.codex/hooks/"
cp "$SOURCE_ROOT/.codex/hooks/authorize-protected-patch.sh" "$ROOT/.codex/hooks/"
cp "$SOURCE_ROOT/.codex/hooks/apply-reviewed-protected-patch.sh" "$ROOT/.codex/hooks/"
chmod +x "$ROOT/.codex/hooks/"*.sh
git init -q -b main "$ROOT"
git -C "$ROOT" config user.email test@whim.local
git -C "$ROOT" config user.name "Whim Test"
printf 'module.exports = {};\n' > "$ROOT/.eslintrc.js"
printf 'ordinary\n' > "$ROOT/src/ordinary.ts"
git -C "$ROOT" add .
git -C "$ROOT" commit -qm seed

REGISTER="$ROOT/.codex/hooks/register-root-session.sh"
AUTHORIZE="$ROOT/.codex/hooks/authorize-protected-patch.sh"
HELPER="$ROOT/.codex/hooks/apply-reviewed-protected-patch.sh"
STATE="$ROOT/.git/codex-protected-approval"
PASS=0

ok() { PASS=$((PASS + 1)); printf 'PASS: %s\n' "$1"; }
fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }
event() {
  local command="$1" transcript="$2" agent_id="$3"
  jq -cn \
    --arg session_id root-session \
    --arg transcript_path "$transcript" \
    --arg turn_id turn-1 \
    --arg cwd "$ROOT" \
    --arg agent_id "$agent_id" \
    --arg command "$command" \
    '{session_id:$session_id,transcript_path:$transcript_path,turn_id:$turn_id,cwd:$cwd,agent_id:$agent_id,tool_input:{command:$command}}'
}
hash_file() { shasum -a 256 "$1" | awk '{print $1}'; }
assert_no_authority() {
  ! find "$STATE" -maxdepth 1 -type f \( -name 'grant-*.json' -o -name 'reviewed-*.patch' \) -print -quit | grep -q .
}

event "" /tmp/root-transcript "" | "$REGISTER"
[[ "$(jq -r .session_id "$STATE/root-session.json")" == root-session ]]
[[ "$(jq -r .transcript_path "$STATE/root-session.json")" == /tmp/root-transcript ]]
ok "root session registered"

ROOT_RECORD_HASH="$(hash_file "$STATE/root-session.json")"
event "" /tmp/subagent-transcript agent-a | "$REGISTER"
[[ "$(hash_file "$STATE/root-session.json")" == "$ROOT_RECORD_HASH" ]]
ok "subagent SessionStart cannot replace root registration"

PROTECTED_PATCH="$TMP/protected.patch"
cat > "$PROTECTED_PATCH" <<'PATCH'
diff --git a/.eslintrc.js b/.eslintrc.js
--- a/.eslintrc.js
+++ b/.eslintrc.js
@@ -1 +1 @@
-module.exports = {};
+module.exports = {root:true};
PATCH
PROTECTED_HASH="$(hash_file "$PROTECTED_PATCH")"
COMMAND="$HELPER --patch $PROTECTED_PATCH --sha256 $PROTECTED_HASH"

OUT="$(event "$COMMAND" /tmp/root-transcript "" | "$AUTHORIZE")"
[[ -z "$OUT" ]]
[[ "$(jq -r .sha256 "$STATE/grant-$PROTECTED_HASH.json")" == "$PROTECTED_HASH" ]]
[[ "$(hash_file "$STATE/reviewed-$PROTECTED_HASH.patch")" == "$PROTECTED_HASH" ]]
ok "root authorization creates hash-bound grant and snapshot"

event "pwd" /tmp/root-transcript "" | "$AUTHORIZE"
assert_no_authority || fail "unrelated Bash event did not clear orphan authority"
ok "next Bash event clears an orphaned denied-prompt grant"

BAD_COMMAND="$HELPER --patch $PROTECTED_PATCH --sha256 0000000000000000000000000000000000000000000000000000000000000000"
OUT="$(event "$BAD_COMMAND" /tmp/root-transcript "" | "$AUTHORIZE")"
grep -q 'hash mismatch' <<< "$OUT"
assert_no_authority || fail "hash mismatch left authority"
ok "hash mismatch denies without authority"

OUT="$(event "$COMMAND; echo bypass" /tmp/root-transcript "" | "$AUTHORIZE")"
grep -q 'Malformed' <<< "$OUT"
assert_no_authority || fail "malformed command left authority"
ok "shell metacharacter command is denied"

OUT="$(event "$COMMAND" /tmp/subagent-transcript agent-a | "$AUTHORIZE")"
grep -Eq 'subagent|registered root' <<< "$OUT"
assert_no_authority || fail "subagent command left authority"
ok "subagent transcript is denied"

event "$COMMAND" /tmp/root-transcript "" | "$AUTHORIZE"
printf 'mutated after authorization\n' > "$PROTECTED_PATCH"
"$HELPER" --patch "$PROTECTED_PATCH" --sha256 "$PROTECTED_HASH" >/dev/null
grep -q 'root:true' "$ROOT/.eslintrc.js"
assert_no_authority || fail "successful apply left authority"
ok "immutable reviewed snapshot defeats patch-file TOCTOU"

set +e
REPLAY_OUT="$("$HELPER" --patch "$PROTECTED_PATCH" --sha256 "$PROTECTED_HASH" 2>&1)"
REPLAY_STATUS=$?
set -e
[[ "$REPLAY_STATUS" -ne 0 ]]
grep -q 'no one-shot grant' <<< "$REPLAY_OUT"
ok "consumed grant cannot replay"

ORDINARY_PATCH="$TMP/ordinary.patch"
cat > "$ORDINARY_PATCH" <<'PATCH'
diff --git a/src/ordinary.ts b/src/ordinary.ts
--- a/src/ordinary.ts
+++ b/src/ordinary.ts
@@ -1 +1 @@
-ordinary
+changed
PATCH
ORDINARY_HASH="$(hash_file "$ORDINARY_PATCH")"
ORDINARY_COMMAND="$HELPER --patch $ORDINARY_PATCH --sha256 $ORDINARY_HASH"
event "$ORDINARY_COMMAND" /tmp/root-transcript "" | "$AUTHORIZE"
set +e
ORDINARY_OUT="$("$HELPER" --patch "$ORDINARY_PATCH" --sha256 "$ORDINARY_HASH" 2>&1)"
ORDINARY_STATUS=$?
set -e
[[ "$ORDINARY_STATUS" -ne 0 ]]
grep -q 'not a Class-2 target' <<< "$ORDINARY_OUT"
grep -qx ordinary "$ROOT/src/ordinary.ts"
ok "non-Class-2 target is rejected without mutation"

RENAME_PATCH="$TMP/rename.patch"
cat > "$RENAME_PATCH" <<'PATCH'
diff --git a/.eslintrc.js b/src/escaped.js
similarity index 100%
rename from .eslintrc.js
rename to src/escaped.js
PATCH
RENAME_HASH="$(hash_file "$RENAME_PATCH")"
RENAME_COMMAND="$HELPER --patch $RENAME_PATCH --sha256 $RENAME_HASH"
event "$RENAME_COMMAND" /tmp/root-transcript "" | "$AUTHORIZE"
set +e
RENAME_OUT="$("$HELPER" --patch "$RENAME_PATCH" --sha256 "$RENAME_HASH" 2>&1)"
RENAME_STATUS=$?
set -e
[[ "$RENAME_STATUS" -ne 0 ]]
grep -q 'rename/copy' <<< "$RENAME_OUT"
[[ ! -e "$ROOT/src/escaped.js" ]]
ok "rename escape is rejected"

printf 'protected-patch approval tests: %d passed\n' "$PASS"
