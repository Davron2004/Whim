---
name: whim-git-cleanup
description: Run Whim's gated history-cleanup lane for a staging branch or explicitly requested legacy target.
license: MIT
---

# Run Whim git cleanup

Read `.claude/commands/git-cleanup.md` completely before acting. It is the canonical Whim runbook.

For Codex, translate Claude Task and `SendMessage` operations to the available collaboration tools, and use explicit git worktrees. Keep the pinned-tree checks and backup-ref requirements intact.

Do not change `AGENTS.md`, `.claude/settings*.json`, `.claude/hooks/**`, `.codex/config.toml`, `.codex/hooks*`, or `.codex/rules/**`. The active host governs root-session authority. Existing subagent controls may still apply; use an already-active workflow mechanism only when it works under the current host, and surface a refusal instead of changing protection configuration.
