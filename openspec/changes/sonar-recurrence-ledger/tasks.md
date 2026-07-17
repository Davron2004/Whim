# Tasks: sonar-recurrence-ledger

## 1. Ledger + conventions (dispatchable)

- [ ] 1.1 Create `openspec/critic/sonar-ledger.md` with the header comment documenting the line grammar (`- <YYYY-MM-DD> <run-id> <rule-id> <path>:<line>`), append-only discipline, run-id convention (OpenSpec change id), and the distinct-runs counting rule.
- [ ] 1.2 Backfill from the two rounds present verbatim in the repo: `openspec/changes/archive/2026-07-12-fix-sonarjs-gate/findings.md` and the `clear-sonarqube-warnings` change folder; mark backfilled lines with a trailing `(backfilled)` note; no reconstruction from memory.
- [ ] 1.3 Update `openspec/critic/README.md`: document the ledger (purpose, grammar, who appends and when) and tighten the "since last report" scoping rule to newest *date-named* (`YYYY-MM-DD.md`) file.
- [ ] 1.4 `docs/harness.md`: extend the §4 SonarCloud row (or add an adjacent sentence) pointing at the ledger and the promotion loop (external finding → ledger → critic candidate → human-ratified Class-1 lint promotion).

## 2. Critic integration (Class 2 — human-applied)

- [ ] 2.1 `.claude/agents/critic.md`: add the `## Recurring external findings` section spec after `## Patterns worth a tripwire` — read `openspec/critic/sonar-ledger.md`; report last-append date; group by rule id, count distinct run-ids; list ≥3-run rules as promotion candidates with recurrence citations and one suggested mechanism from the fixed menu (sonarjs enable / `no-restricted-syntax` selector + message / type-aware `@typescript-eslint` rule / local custom rule); ≥2-run rules may be "watch"; state the threshold inline; propose only, never edit lint config.
- [ ] 2.2 `.claude/commands/critic-run.md`: switch scoping wording to newest date-named report; pass the ledger path to the critic alongside the scope ref; include candidate counts in the post-run summary contract.
- [ ] 2.3 Run `node scripts/sync-codex.mjs --write` to regenerate `.codex/agents/critic.toml`; verify with `--check`.
- [ ] 2.4 Add the append instruction to the Sonar transcription workflow step (wherever the active integration lane defines findings-list transcription — `.claude/commands/fix-loop.md` today; the staging-lane closure sequence if staging-branch-integration has landed): when transcribing SonarCloud results into a findings list, also append the ledger lines.
