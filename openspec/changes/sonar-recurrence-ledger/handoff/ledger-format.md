# Contract: sonar-ledger format

## File

`openspec/critic/sonar-ledger.md` — append-only, kept in git (same directory as dated
critic reports).

## Line grammar

```
- <YYYY-MM-DD> <run-id> <rule-id> <path>:<line>
```

Example (real entry):

```
- 2026-07-12 2026-07-12-fix-sonarjs-gate sonarjs/cognitive-complexity server/src/pipeline.ts:53 (backfilled)
```

- `<YYYY-MM-DD>` — date the fix round addressed the finding.
- `<run-id>` — the OpenSpec change id of the fix round. Re-running the same round
  (re-pushed on the same staging branch) reuses the same run-id; recurrence counting
  is over **distinct run-ids**, never distinct lines.
- `<rule-id>` — SonarCloud form when known (e.g. `S2871`); else the local `sonarjs/<rule>`
  ESLint-mirror alias as-is.
- `<path>:<line>` — 1-based line the source cites; `-` for the line if a source names a
  rule without a line (never invent a line number).
- NOT the `scripts/fixloop.sh` stale-evidence grammar (`## <path>` headers) — a flat
  historical log, not live findings state.

## Backfill marking

Lines transcribed from pre-ledger fix rounds (no ledger existed yet) end with a trailing
` (backfilled)` token, added only from the fix round's own recorded artifacts (findings.md/
research.md), never reconstructed from memory. Future lines appended by a live fix round
carry no such marker.

## README scoping wording (openspec/critic/README.md)

Critic-run scoping is the newest **date-named** report — a file matching `YYYY-MM-DD.md`
exactly. Non-date-named files in `openspec/critic/` (including `sonar-ledger.md`) are never
candidates for "newest report", because a naive lexical sort would otherwise rank a
non-date filename above a genuinely newer dated report.

## Promotion loop (who appends, when, and what happens next)

External SonarCloud finding (draft-PR quality gate) → whoever closes that fix round appends
one ledger line per finding before archiving the change → critic reads the ledger during a
run and flags a rule/location recurring across ≥3 distinct run-ids as a promotion candidate
→ human-ratified `.eslintrc.js` edit (Class 1) → the fast gate's lint then catches that
pattern in the inner loop going forward.
