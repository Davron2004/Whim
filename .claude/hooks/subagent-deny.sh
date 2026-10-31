#!/usr/bin/env bash
# PreToolUse(Bash), Claude only (#181 option 1, owner rulings 32/33). A subagent can never answer a
# permission prompt, so a Bash call that would raise one stalls it forever. This hook turns that
# prompt into an immediate deny with a reason — and does nothing else. It denies ONLY when all hold:
#   - the caller is a subagent (non-empty agent_id; the main session's payload has none),
#   - permission_mode is default|acceptEdits|plan (auto, dontAsk, bypassPermissions, a missing
#     field or an unknown value pass through),
#   - the command is not "allowed", where an allowed simple command is one that matches a Bash(...)
#     rule in the project's permissions.allow (settings.json, settings.local.json; exact rules and
#     `prefix:*` rules only), is a read-only builtin (`pwd`, `true`, `echo` without `$`), or is in
#     bash-policy.sh's allow tier (kept in sync with permissions.allow). A plain && || ; | chain
#     (no quotes, `$`, backslash, redirect, `&`, newline) is allowed when every segment is an allowed
#     simple command or `cd <dir>` resolving inside the repo; later segments see the new cwd.
#     bash-policy's deny tier, ask tier and silent fall-through all count as "would prompt": no
#     other wired hook denies for Claude, so each of them would reach the prompt.
# Everything else exits 0 with no output (including an empty command and any jq/bash-policy
# failure). Never emits allow. Kill switch: WHIM_SUBAGENT_DENY=off.
# Each deny appends one line (ISO time, agent_type, command, rule; tab-separated) to
# .claude/run/subagent-denials.log, gitignored. Requires jq.
set -u
unset CDPATH
INPUT=$(cat)
[[ "${WHIM_SUBAGENT_DENY:-}" == "off" ]] && exit 0
AGENT_ID=$(printf '%s' "$INPUT" | jq -r '.agent_id // empty' 2>/dev/null)
[[ -n "$AGENT_ID" ]] || exit 0
case "$(printf '%s' "$INPUT" | jq -r '.permission_mode // empty')" in
  default|acceptEdits|plan) ;;
  *) exit 0 ;;
esac

HOOKDIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HOOKDIR/../.." && pwd -P)"
CMD=$(printf '%s' "$INPUT" | jq -r '.tool_input.command // empty')
[[ -n "$CMD" ]] || exit 0
CWD=$(printf '%s' "$INPUT" | jq -r '.cwd // empty')

# permissions.allow match; wildcard rules other than a trailing `:*` are not interpreted.
rule_allows() {
  local settings rule cmd=$1
  for settings in "$ROOT/.claude/settings.json" "$ROOT/.claude/settings.local.json"; do
    [[ -f "$settings" ]] || continue
    while IFS= read -r rule; do
      case "$rule" in
        *:\*) [[ "$cmd" == "${rule%:\*}" || "$cmd" == "${rule%:\*} "* ]] && return 0 ;;
        *\**) ;;
        *) [[ "$cmd" == "$rule" ]] && return 0 ;;
      esac
    done < <(jq -r '.permissions.allow[]? | select(startswith("Bash(") and endswith(")")) | .[5:-1]' "$settings" 2>/dev/null)
  done
  return 1
}
builtin_allows() {
  local cmd=$1
  case "$cmd" in
    pwd|true) return 0 ;;
    echo|"echo "*) [[ "$cmd" != *'$'* ]] ;;
    *) return 1 ;;
  esac
}
# Classification only: WHIM_BASH_POLICY_NO_CLAIM keeps bash-policy from writing worktree owner markers.
policy_allows() {
  local out cmd=$1 dir=$2
  out=$(printf '%s' "$INPUT" | jq -c --arg c "$cmd" --arg d "$dir" '.tool_input.command=$c | if $d == "" then . else .cwd=$d end' \
    | WHIM_BASH_POLICY_NO_CLAIM=1 bash "$HOOKDIR/bash-policy.sh" 2>/dev/null) || return 1
  [[ "$(printf '%s' "$out" | jq -r '.hookSpecificOutput.permissionDecision // empty' 2>/dev/null)" == "allow" ]]
}

case "$CMD" in
  *'&'*|*';'*|*'|'*|*'`'*|*'$('*|*'>'*|*'<'*|*$'\n'*)
    SEGS=${CMD//&&/$'\x1f'}; SEGS=${SEGS//||/$'\x1f'}; SEGS=${SEGS//;/$'\x1f'}; SEGS=${SEGS//|/$'\x1f'}
    case "$SEGS" in
      *'&'*|*'$'*|*'`'*|*'<'*|*'>'*|*\"*|*\'*|*\\*|*$'\n'*) ;;
      *)
        seg_cwd="$CWD"; all_allowed=1
        IFS=$'\x1f' read -r -a segs <<< "$SEGS"
        for seg in "${segs[@]}"; do
          read -r -a words <<< "$seg"
          seg="${words[*]:-}"
          if [[ "${#words[@]}" == 2 && "${words[0]}" == "cd" ]]; then
            dest=$(cd -- "${seg_cwd:-/nonexistent}" 2>/dev/null && cd -- "${words[1]}" 2>/dev/null && pwd -P) || dest=""
            if [[ -n "$dest" && ( "$dest" == "$ROOT" || "$dest" == "$ROOT"/* ) ]]; then seg_cwd="$dest"; continue; fi
            all_allowed=0; break
          fi
          [[ -n "$seg" ]] && { rule_allows "$seg" || builtin_allows "$seg" || policy_allows "$seg" "$seg_cwd"; } || { all_allowed=0; break; }
        done
        [[ "$all_allowed" == 1 ]] && exit 0 ;;
    esac ;;
  *) { rule_allows "$CMD" || builtin_allows "$CMD"; } && exit 0 ;;
esac

POLICY_OUT=$(printf '%s' "$INPUT" | WHIM_BASH_POLICY_NO_CLAIM=1 bash "$HOOKDIR/bash-policy.sh" 2>/dev/null) || exit 0
if [[ -z "$POLICY_OUT" ]]; then
  DECISION="none"
else
  DECISION=$(printf '%s' "$POLICY_OUT" | jq -r '.hookSpecificOutput.permissionDecision // "none"' 2>/dev/null) || exit 0
fi
case "$DECISION" in
  allow) exit 0 ;;
  deny|ask) RULE=$(printf '%s' "$POLICY_OUT" | jq -r '.hookSpecificOutput.permissionDecisionReason // "harness bash policy"') ;;
  *) RULE="not in the auto-allowed command vocabulary (bash-policy allow tier / permissions.allow)" ;;
esac

LOG_DIR="$ROOT/.claude/run"
mkdir -p "$LOG_DIR" 2>/dev/null
printf '%s' "$INPUT" | jq -r --arg t "$(date -u +%Y-%m-%dT%H:%M:%SZ)" --arg r "$RULE" \
  '[$t, (.agent_type // "unknown"), (.tool_input.command // ""), $r] | @tsv' \
  >> "$LOG_DIR/subagent-denials.log" 2>/dev/null

jq -cn --arg r "Denied for subagents (would need approval nobody sees): $RULE. Use Write/Edit for file content and one simple command per call." \
  '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",permissionDecisionReason:$r}}'
exit 0
