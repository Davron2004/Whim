# #181 option 1: subagent PreToolUse deny instead of prompt (rulings 32, 33)

## Probe: permission_mode (Claude Code 2.1.314)
`permission_mode` is in main and subagent payloads; bypass value `"bypassPermissions"` (earlier: `"auto"`).
Live E2E (`--permission-mode default`): an allow-listed subagent command passed and ran; an unlisted one came
back with the deny reason; one log line. Claude also auto-approves some read-only builtins (`echo`), which
the hook cannot see in full, so it passes a small documented subset itself.

## Design
- `.claude/hooks/subagent-deny.sh`, the only PreToolUse Bash hook in `.claude/settings.json`. Never emits allow.
- Exit 0, no output, unless ALL hold: non-empty `agent_id`; `permission_mode` default|acceptEdits|plan (others,
  missing, unknown pass); non-empty command; the command is not "allowed".
- Allowed simple command: a `Bash(...)` rule in project `permissions.allow` (settings.json + settings.local.json;
  exact = equality, `p:*` = `p` or `p ...`; mid-pattern `*` not interpreted), a builtin (`pwd`, `true`, `echo`
  without `$`), or bash-policy.sh verdict `allow`.
- Allowed chain: `&&`/`||`/`;`/`|` with no quotes, `$`, backslash, `<`/`>`, lone `&` or newline; every segment
  is an allowed simple command or `cd <dir>` resolving (pwd -P) inside the repo root; later segments are
  classified with the new cwd. Any other chain falls to bash-policy's whole-command verdict.
- Classification runs bash-policy.sh with `WHIM_BASH_POLICY_NO_CLAIM=1` (no owner markers written).
- Fail-safe: malformed JSON, jq missing, bash-policy non-zero -> pass through silently.
- Reason: `Denied for subagents (would need approval nobody sees): <rule>. Use Write/Edit ...`; <rule> =
  bash-policy's deny/ask reason or "not in the auto-allowed command vocabulary (...)".

## Review fix (review-3-181b)
The MEDIUM repro (`git status && git diff`, `cd <wt> && git status` denied) came from a probe copy without
`unroll-command.mjs`; in the repo bash-policy already allows both. The real gap: chains with a builtin,
a `permissions.allow`-only segment, `cd <repo root>`, or worktree git after `cd`. Those now pass.

## Tests (.claude/hooks/test/bash-policy.test.sh; 136 total)
Adds: builtins pass; echo with redirect or `$HOME` denied; empty command passes unlogged; chain passes (the
two review cases plus cd-to-root, builtin segment, relative cd + prefix rule, `git add` after cd); denies for
`git status; rm -rf /tmp/x`, `cd /etc`, `cd ..`, `$(whoami)`, `&`, empty segment; fail-safes (malformed JSON,
PATH without jq, stub bash-policy `exit 3`). Two older cases moved off `echo` (now a builtin pass).
Red-check: segment pass disabled -> "cd to the repo root then read-only git passes" FAILED (the two review
cases still passed via bash-policy); restored, 136/136. Also green: unroll 42, provider-adapters 13,
`sync-codex.mjs --check`.

## Kill switch, log
Kill: `WHIM_SUBAGENT_DENY=off` or drop the `PreToolUse` Bash line. Log: `.claude/run/subagent-denials.log`
(gitignored; ISO time, agent_type, command, rule, tab-separated). Known misfires: harness.md §11.
