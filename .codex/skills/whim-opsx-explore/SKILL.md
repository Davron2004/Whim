---
name: whim-opsx-explore
description: Explore a Whim idea or OpenSpec change through the OPSX explore playbook without implementing code.
license: MIT
---

# OPSX explore

Read `.claude/commands/opsx/explore.md` completely before acting. It is the canonical Whim runbook.

Keep its explore-only boundary: investigate and discuss, but do not implement code. Treat `/opsx:explore` examples as ordinary Codex requests rather than slash commands.

Do not change `AGENTS.md`, `.claude/settings*.json`, `.claude/hooks/**`, `.codex/config.toml`, `.codex/hooks*`, or `.codex/rules/**`. The active host governs root-session authority. Respect existing subagent restrictions and surface a blocked step instead of changing protection configuration.
