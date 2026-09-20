---
name: openspec-sync-specs
description: Merge delta specifications from a Whim OpenSpec change into the main specifications without archiving the change.
license: MIT
---

# Sync OpenSpec specifications

Read `.claude/skills/openspec-sync-specs/SKILL.md` completely before acting. It is the canonical Whim procedure.

For Codex, translate `AskUserQuestion` to a focused chat question. Preserve the source workflow's explicit user choice when several changes are plausible.

Do not change `AGENTS.md`, `.claude/settings*.json`, `.claude/hooks/**`, `.codex/config.toml`, `.codex/hooks*`, or `.codex/rules/**`. The active host governs root-session authority. Respect existing subagent restrictions and surface a blocked step instead of changing protection configuration.
