# Carrying out the audit: progress

One line per item: status (done / skipped / overturned / parked), commit, reason. Branch
`integration/store-launch`. Batches follow the order in the task: 1 bugs, 2 containment and data
gaps, 3 deletions, 4 rewrites and merges, 5 moves to lint/`checks/` and `node:assert`, 6
`invariants/` leftovers. New problems found on the way are in [follow-ups.md](follow-ups.md).

## Batch 1: real bugs

| Item | Status | Commit | Note |
|---|---|---|---|
| Eval storage-roundtrip method names (`evals/assertions.ts`) | done | 8a3b99e | Round trip = write + read on one store (kv or records). The new tier-b rows failed against the old evaluator (3 failures), then passed |
| Eval fixture from a real synthrun report | done | 8a3b99e | `synthetic-run-report.json` is a real run of `fixtures/water-counter.app.tsx`. It has only kv calls because of the sysret bug in follow-ups.md. `tier-a`'s adapter test lost its cue entry with it |
| greenBy harness fails open on a stale `.phase` | done | 7b960c0 | Confirmed first: `.phase`=B plus a planted failure gave `PENDING 1 · FAIL 0`, exit 0. After: same plant exits 1. 50 tags, name prefixes, 3 self-tests, and every `.phase`/XPASS instruction removed |
| store-listing domain rule ran against `example.com` | done | efa1c0c | Confirmed first: `anycognition.ca` appended to a listing file passed. After: the same plant fails |
| `policy.suite.ts:113` exit-13 hang | done | 55d3c0c | Confirmed: a policy that ignores its timeout gave exit 13. After: named failure |
| `history-wait.suite.ts:64` exit-13 hang | done | 55d3c0c | Confirmed: a never-settling `runHistoryLoad` gave exit 13. After: named failures |

Fast gate after batch 1: PASSED.

## Not in any batch (README "Bugs and gaps")

| Item | Status | Reason |
|---|---|---|
| `HINT_SEPARATOR = '\n'` splits a multi-line hint after reload | parked | Product change, not in the requested batches |
| Storage engine: corrupt `_meta` falls back to `emptyApplied()` | parked | Product change, not in the requested batches |
| `diag.echo` in the production default registry | parked | Product decision, not in the requested batches |
| Wire `failure` event carries only prose | parked | Contract change, not in the requested batches |
| Control-plane hooks wired only under Codex; CLAUDE.md says otherwise | parked | Harness decision (memory `whim-harness-hooks-off`), not in the requested batches |
