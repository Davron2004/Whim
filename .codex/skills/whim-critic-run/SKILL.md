---
name: whim-critic-run
description: Run Whim's critic over changes since the last date-named critic report without acting on its findings.
license: MIT
---

# Run the Whim critic

Read `.claude/commands/critic-run.md` completely before acting. It is the canonical Whim runbook.

Use Codex collaboration tools for the critic subagent. Report findings exactly as the runbook requires and do not act on them; the user triages them.

Do not change `AGENTS.md`, `.claude/settings*.json`, `.claude/hooks/**`, `.codex/config.toml`, `.codex/hooks*`, or `.codex/rules/**`. The active host governs root-session authority. Respect existing subagent restrictions and surface a blocked step instead of changing protection configuration.
