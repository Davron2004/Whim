#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
PASS=0

payload() {
  local event="$1" command="$2" agent="${3:-}"
  jq -cn --arg event "$event" --arg command "$command" --arg agent "$agent" --arg cwd "$ROOT" \
    '{hook_event_name:$event,tool_name:"Bash",tool_input:{command:$command},agent_id:$agent,cwd:$cwd}'
}

patch_payload() {
  local patch="$1" agent="${2:-}"
  jq -cn --arg patch "$patch" --arg agent "$agent" --arg cwd "$ROOT" \
    '{hook_event_name:"PreToolUse",tool_name:"apply_patch",tool_input:{command:$patch},agent_id:$agent,cwd:$cwd}'
}

expect_silent() {
  local name="$1" output="$2"
  if [[ -n "$output" ]]; then printf 'FAIL: %s expected silence, got %s\n' "$name" "$output" >&2; exit 1; fi
  PASS=$((PASS + 1)); printf 'PASS: %s\n' "$name"
}

expect_value() {
  local name="$1" expected="$2" query="$3" output="$4" actual
  actual=$(printf '%s' "$output" | jq -r "$query")
  if [[ "$actual" != "$expected" ]]; then printf 'FAIL: %s expected %s, got %s\n%s\n' "$name" "$expected" "$actual" "$output" >&2; exit 1; fi
  PASS=$((PASS + 1)); printf 'PASS: %s\n' "$name"
}

OUT=$(payload PreToolUse "npm run build" agent-a | bash "$ROOT/.codex/hooks/bash-policy.sh")
expect_silent "Codex PreToolUse canonical allow becomes silence" "$OUT"
OUT=$(payload PreToolUse "git push" agent-a | bash "$ROOT/.codex/hooks/bash-policy.sh")
expect_value "Codex PreToolUse deny remains deny" deny '.hookSpecificOutput.permissionDecision' "$OUT"
OUT=$(payload PreToolUse "git commit -m test" | bash "$ROOT/.codex/hooks/bash-policy.sh")
expect_silent "Codex PreToolUse canonical ask defers natively" "$OUT"
OUT=$(payload PreToolUse "echo hello" agent-a | bash "$ROOT/.codex/hooks/bash-policy.sh")
expect_silent "Codex PreToolUse fallthrough stays silent" "$OUT"

OUT=$(payload PermissionRequest "npm run build" agent-a | bash "$ROOT/.codex/hooks/permission-request.sh")
expect_value "Codex PermissionRequest canonical allow auto-allows" allow '.hookSpecificOutput.decision.behavior' "$OUT"
OUT=$(payload PermissionRequest "git push" agent-a | bash "$ROOT/.codex/hooks/permission-request.sh")
expect_value "Codex PermissionRequest deny remains deny" deny '.hookSpecificOutput.decision.behavior' "$OUT"
OUT=$(payload PermissionRequest "git commit -m test" | bash "$ROOT/.codex/hooks/permission-request.sh")
expect_silent "Codex PermissionRequest canonical ask preserves prompt" "$OUT"

ORDINARY=$'*** Begin Patch\n*** Update File: src/sdk/index.tsx\n@@\n-old\n+new\n*** End Patch'
PROTECTED=$'*** Begin Patch\n*** Update File: package.json\n@@\n-old\n+new\n*** End Patch'
MULTI=$'*** Begin Patch\n*** Update File: src/sdk/index.tsx\n@@\n-old\n+new\n*** Update File: scripts/gate.sh\n@@\n-old\n+new\n*** End Patch'
MOVE=$'*** Begin Patch\n*** Update File: src/sdk/index.tsx\n*** Move to: .claude/hooks/escaped.sh\n@@\n-old\n+new\n*** End Patch'

OUT=$(patch_payload "$ORDINARY" agent-a | bash "$ROOT/.codex/hooks/protect-harness.sh")
expect_silent "Codex ordinary patch stays allowed" "$OUT"
OUT=$(patch_payload "$PROTECTED" | bash "$ROOT/.codex/hooks/protect-harness.sh")
expect_value "Codex main protected patch fails closed" deny '.hookSpecificOutput.permissionDecision' "$OUT"
OUT=$(patch_payload "$PROTECTED" agent-a | bash "$ROOT/.codex/hooks/protect-harness.sh")
expect_value "Codex subagent protected patch stays denied" deny '.hookSpecificOutput.permissionDecision' "$OUT"
OUT=$(patch_payload "$MULTI" | bash "$ROOT/.codex/hooks/protect-harness.sh")
expect_value "Codex multi-file patch denies if one path is protected" deny '.hookSpecificOutput.permissionDecision' "$OUT"
OUT=$(patch_payload "$MOVE" | bash "$ROOT/.codex/hooks/protect-harness.sh")
expect_value "Codex move destination is protected" deny '.hookSpecificOutput.permissionDecision' "$OUT"
OUT=$(patch_payload 'not a patch' | bash "$ROOT/.codex/hooks/protect-harness.sh")
expect_value "Codex unparseable patch fails closed" deny '.hookSpecificOutput.permissionDecision' "$OUT"

printf 'Codex provider-adapter tests: %d passed\n' "$PASS"
