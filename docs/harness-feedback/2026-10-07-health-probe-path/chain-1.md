# chain-1 (implementer): harness feedback, health-probe-path 2026-10-07

## Blocks, stops and detours
- **What:** The red-check run with `/health` removed aborted the whole `server:test` run at the first assertion (`res.json()` on Hono's plain-text 404), so only one failure showed.
  **Mechanism:** the suite runner has no per-test isolation; an unhandled throw ends the run. **Verdict:** DRAWBACK. **Cost:** 3 extra runs: I swapped in a JSON 404 stand-in for `/health` to see every assertion fail, and ran the load-test wrapper revert separately. **Evidence:** `SyntaxError: Unexpected non-whitespace character after JSON` at `res.json()`.
- **What:** A first red-check shell line redirected output into a path that didn't exist; the `;`-chained `git stash pop` still ran, so nothing was lost, but the red run never happened.
  **Mechanism:** none (my own shell mistake). **Verdict:** NEUTRAL. **Cost:** 1 call.
- **What:** Two new assertions ("logs exactly one record", "no request id") do not fail when `/health` is a 404, since a 404 also logs once and carries no id. The record-status and body assertions beside them catch the removal.
  **Mechanism:** red-check against the route removed. **Verdict:** NEUTRAL (they guard against moving health under `/v1`, not removal).

## What helped
- The chain block named every existing test pinning health with line numbers, so I extended them in place with path loops instead of adding a parallel suite.
- The prepared worktree (build run, `@whim/*` symlinks) meant `server:test` read my edits straight away.

## What the harness should change
- Red-check guidance: say that a suite which throws on the first failure needs a non-throwing stand-in for the removed code, or each assertion cannot be shown failing individually.
