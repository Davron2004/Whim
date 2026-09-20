---
name: whim-opsx-apply
description: Apply a Whim OpenSpec change through the schema-keyed dispatch runbook.
license: MIT
---

# OPSX apply

Read `.claude/commands/opsx/apply.md` completely before acting. It is the canonical Whim runbook.

For Codex, translate `AskUserQuestion` to a focused chat question, Claude Task and `SendMessage` operations to the available collaboration tools, and `isolation: worktree` to an explicit git worktree. The main thread remains a dispatcher and does not implement change tasks inline.

Do not change `AGENTS.md`, `.claude/settings*.json`, `.claude/hooks/**`, `.codex/config.toml`, `.codex/hooks*`, or `.codex/rules/**`. The active host governs root-session authority. Existing subagent controls may still apply; use an already-active workflow mechanism only when it works under the current host, and surface a refusal instead of changing protection configuration.
