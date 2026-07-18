# Context chains: sonar-recurrence-ledger

<!--
  Small change, two chains. Chain-1 is dispatchable (openspec/critic/ and docs/ are
  unprotected). Chain-2 edits .claude/** (Class 2) and is HUMAN-BOOTSTRAP: a human
  applies the listed edits; no implementer is dispatched for it.
-->

## chain-1: ledger-and-conventions

- tasks: 1.1–1.4
- rationale: one file family (openspec/critic/* + the harness.md row) establishing the ledger artifact, its grammar, and its scoping rule; all consumed verbatim by chain-2.
- reads: specs/sonar-recurrence-tracking/spec.md §"An append-only recurrence ledger", §"The ledger never breaks critic report scoping"; research.md (findings-list precedents, README scoping constraint)
- writes-contract: handoff/ledger-format.md (final line grammar, run-id convention, backfilled-line marking, README scoping wording)
- writes-contract note: the two backfill sources are named in tasks.md 1.2 — the implementer reads those two findings lists only, not the archives at large.

## chain-2: critic-integration (HUMAN-BOOTSTRAP)

- tasks: 2.1–2.4
- rationale: all four edits are the critic/runbook side of the same contract and must land together with the codex-mirror regeneration.
- reads: specs/sonar-recurrence-tracking/spec.md §"The critic reports recurrence-based promotion candidates", §"Promotion remains a human-ratified Class-1 change"; handoff/ledger-format.md
- writes-contract: none
- human-bootstrap edits: `.claude/agents/critic.md`, `.claude/commands/critic-run.md`, the transcription-step append instruction (`.claude/commands/fix-loop.md` or the staging-lane closure sequence, whichever is current), then `node scripts/sync-codex.mjs --write` + `--check`
- after: chain-1
