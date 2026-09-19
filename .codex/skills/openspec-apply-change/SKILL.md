---
name: openspec-apply-change
description: Dispatch a Whim OpenSpec change through its build harness when implementation should start or continue.
license: MIT
---

# Apply an OpenSpec change

Read `.claude/skills/openspec-apply-change/SKILL.md` and its linked runbooks completely before acting. That file is the canonical Whim procedure.

For Codex, translate `AskUserQuestion` to a focused chat question; translate Claude Task and message operations to the available Codex collaboration tools; and use an explicit git worktree when the runbook requires isolation.

Do not change `AGENTS.md`, `.claude/settings*.json`, `.claude/hooks/**`, `.codex/config.toml`, `.codex/hooks*`, or `.codex/rules/**`. The active host governs root-session authority. Respect existing subagent restrictions and surface a blocked step instead of changing protection configuration.
