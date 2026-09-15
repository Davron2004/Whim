---
name: whim-fix-loop
description: Orchestrate Whim's parallel, staged fix loop for a supplied findings list without implementing fixes inline.
license: MIT
---

# Run the Whim fix loop

Read `.claude/commands/fix-loop.md` completely before acting. It is the canonical Whim runbook.

For Codex, translate Claude Task and `SendMessage` operations to the available collaboration tools, and create or select the explicit git worktree required by the runbook. The main thread remains an orchestrator and does not implement fixes inline.

Do not change `AGENTS.md`, `.claude/settings*.json`, `.claude/hooks/**`, `.codex/config.toml`, `.codex/hooks*`, or `.codex/rules/**`. The active host governs root-session authority. Existing subagent controls may still apply; use an already-active workflow mechanism only when it works under the current host, and surface a refusal instead of changing protection configuration.
