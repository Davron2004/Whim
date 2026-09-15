---
name: openspec-explore
description: Explore a Whim idea, problem, or requirement without implementing code.
license: MIT
---

# Explore an OpenSpec change

Read `.claude/skills/openspec-explore/SKILL.md` completely before acting. It is the canonical Whim procedure.

Keep its explore-only boundary: investigate and discuss, but do not implement code. Treat `/opsx:explore` examples as ordinary Codex requests rather than slash commands.

Do not change `AGENTS.md`, `.claude/settings*.json`, `.claude/hooks/**`, `.codex/config.toml`, `.codex/hooks*`, or `.codex/rules/**`. The active host governs root-session authority. Respect existing subagent restrictions and surface a blocked step instead of changing protection configuration.
