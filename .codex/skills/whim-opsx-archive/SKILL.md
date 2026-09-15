---
name: whim-opsx-archive
description: Archive a completed Whim OpenSpec change through the OPSX archive runbook.
license: MIT
---

# OPSX archive

Read `.claude/commands/opsx/archive.md` completely before acting. It is the canonical Whim runbook.

For Codex, translate `AskUserQuestion` to a focused chat question and Claude Task operations to the available collaboration tools. Preserve the runbook's explicit confirmation steps.

Do not change `AGENTS.md`, `.claude/settings*.json`, `.claude/hooks/**`, `.codex/config.toml`, `.codex/hooks*`, or `.codex/rules/**`. The active host governs root-session authority. Respect existing subagent restrictions and surface a blocked step instead of changing protection configuration.
