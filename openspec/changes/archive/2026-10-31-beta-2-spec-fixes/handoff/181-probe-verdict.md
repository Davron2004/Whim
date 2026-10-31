# Probe #181: PreToolUse hook, subagent vs main

claude --version: 2.1.314 (Claude Code)
Command (cwd = probe dir, exit 0, no permission flag needed; permission_mode in payload = "auto", from user's global defaultMode):
  capped-run.sh --mb 2048 --secs 300 -- claude -p --model haiku "<echo probe-main; Agent subagent runs echo probe-sub then echo probe-deny>"
Hook: .claude/settings.json PreToolUse matcher Bash -> hook.sh (logs stdin to hook-input.jsonl; denies if agent_id non-empty AND command has probe-deny)
Deny output used: {"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"probe: denied for subagents"}}

## Payload keys (hook-input.jsonl, 3 lines)
main (echo probe-main): cwd, effort, hook_event_name, permission_mode, prompt_id, session_id, tool_input, tool_name, tool_use_id, transcript_path
  -> NO agent_id, NO agent_type
subagent (echo probe-sub, echo probe-deny): same keys PLUS agent_id ("a79...c42b", same for both calls) and agent_type ("general-purpose")

## Deny result
Subagent's probe-sub call ran normally. Its probe-deny call came back immediately as:
  "PreToolUse:Bash hook error: probe: denied for subagents"
(reason delivered, no approval prompt; relayed by the subagent, not checked against its transcript, but the hook log shows the call fired with agent_id set and our hook emitted the deny).
Caveat: session mode was auto (non-interactive -p), so "would otherwise prompt" was not exercised; deny precedence over a prompt-mode ask is documented behavior but not shown here.

## Conclusion
- Subagent detection by `.agent_id` (and `.agent_type`) works on 2.1.314: present only for subagent calls, absent for main.
- Option 1 (hook denies instead of prompting, subagents only) works mechanically. Needs: a PreToolUse Bash hook wired in the repo .claude/settings.json (bash-policy.sh is not wired today; only SubagentStop is), emitting the hookSpecificOutput deny schema above (exit 0 + JSON), gated on non-empty agent_id.
- Existing bash-policy.sh line 11 comment ("present ONLY for subagents") is re-confirmed.
