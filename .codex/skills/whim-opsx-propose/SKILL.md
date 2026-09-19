---
name: whim-opsx-propose
description: Create a Whim OpenSpec proposal through the OPSX propose runbook.
license: MIT
---

# OPSX propose

Read `.claude/commands/opsx/propose.md` completely before acting. It is the canonical Whim runbook.

For Codex, translate `AskUserQuestion` to a focused chat question. Treat `/opsx:apply` references as a request to use `openspec-apply-change` or `whim-opsx-apply`.

Do not change `AGENTS.md`, `.claude/settings*.json`, `.claude/hooks/**`, `.codex/config.toml`, `.codex/hooks*`, or `.codex/rules/**`. The active host governs root-session authority. Respect existing subagent restrictions and surface a blocked step instead of changing protection configuration.
