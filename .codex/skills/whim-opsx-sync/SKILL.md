---
name: whim-opsx-sync
description: Merge a Whim OpenSpec change's delta specifications into the main specifications through the OPSX sync runbook.
license: MIT
---

# OPSX sync

Read `.claude/commands/opsx/sync.md` completely before acting. It is the canonical Whim runbook.

For Codex, translate `AskUserQuestion` to a focused chat question. Preserve the source workflow's explicit user choice when several changes are plausible.

Do not change `AGENTS.md`, `.claude/settings*.json`, `.claude/hooks/**`, `.codex/config.toml`, `.codex/hooks*`, or `.codex/rules/**`. The active host governs root-session authority. Respect existing subagent restrictions and surface a blocked step instead of changing protection configuration.
