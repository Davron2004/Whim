---
name: openspec-archive-change
description: Archive a completed Whim OpenSpec change after its implementation and required checks are complete.
license: MIT
---

# Archive an OpenSpec change

Read `.claude/skills/openspec-archive-change/SKILL.md` completely before acting. It is the canonical Whim procedure.

For Codex, translate `AskUserQuestion` to a focused chat question and any Claude Task operation to the available Codex collaboration tools. Preserve the source workflow's explicit human decisions.

Do not change `AGENTS.md`, `.claude/settings*.json`, `.claude/hooks/**`, `.codex/config.toml`, `.codex/hooks*`, or `.codex/rules/**`. The active host governs root-session authority. Respect existing subagent restrictions and surface a blocked step instead of changing protection configuration.
