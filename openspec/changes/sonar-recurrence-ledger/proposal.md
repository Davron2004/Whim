# Proposal: sonar-recurrence-ledger

## Why

SonarCloud findings are fixed round by round and then forgotten: nothing records which rules keep firing, so recurring defect classes (e.g. bare `.sort()` before its lint rule existed) are re-discovered and re-fixed post-push instead of being promoted to the in-loop lint where the generating agent fixes them for free. The promotion mechanism demonstrably works — `.eslintrc.js` already carries one promoted rule — but promotion is currently triggered by human annoyance, not data (research.md: no cross-run Sonar record exists anywhere in the repo).

## What Changes

- New append-only recurrence ledger `openspec/critic/sonar-ledger.md`: one line per external (SonarCloud) finding per fix round — date, run id (OpenSpec change id of the round), rule id, file:line. Written at findings-list-transcription time by whoever transcribes the SonarCloud results (human-directed; no automated Sonar ingestion — the repo has none and this change adds none).
- Backfill the ledger from the two rounds already in the repo (`archive/2026-07-12-fix-sonarjs-gate/findings.md`, `clear-sonarqube-warnings`).
- The critic gains a `## Recurring external findings` report section: it reads the ledger, groups by rule id, counts distinct run ids, and lists every rule at or above the promotion threshold (default ≥3 distinct runs) as a **promotion candidate** with a suggested enforcement mechanism (enable a `sonarjs` rule / `no-restricted-syntax` selector with instructional message / type-aware `@typescript-eslint` rule). The critic proposes only; the actual `.eslintrc.js` edit stays a human-ratified Class-1 change.
- `openspec/critic/README.md` documents the ledger and tightens the "since last report" scoping rule to *date-named* files, so the ledger (a non-dated sibling) can never be mistaken for the newest report (research.md flags this collision).
- `docs/harness.md` §4 SonarCloud row gains a pointer to the ledger and the promotion loop.

## Capabilities

### New Capabilities
- `sonar-recurrence-tracking`: the recurrence ledger (format, writer, append discipline) and the critic's promotion-candidate reporting on top of it.

### Modified Capabilities
<!-- none — no existing spec in openspec/specs/ covers the critic or the external quality loop; static-checks and harness-diagnostics cover the mini-app checking pipeline. -->

## Impact

- **Unprotected (dispatchable):** `openspec/critic/sonar-ledger.md` (new), `openspec/critic/README.md`, `docs/harness.md`, ledger backfill from the two archived rounds.
- **Class 2 (human-ratified edits):** `.claude/agents/critic.md` (new report section + ledger read step), `.claude/commands/critic-run.md` (date-named scoping rule, ledger path handoff), followed by `node scripts/sync-codex.mjs --write`.
- **Explicitly not in scope:** any automated SonarCloud API ingestion, any `.eslintrc.js` edit (each promotion is its own later human-ratified change), any change to `fixloop.sh stale`'s evidence-file grammar (the ledger is a separate artifact and deliberately not stale-check-compatible).
