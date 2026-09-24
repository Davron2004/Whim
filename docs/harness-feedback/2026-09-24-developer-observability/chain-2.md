# developer-observability chain-2 (implementer) — harness feedback

- **What:** Task 2.6 can't be done without editing a suite the chain block put off-limits. **Mechanism:** chain block / plan. **Verdict:** DRAWBACK. **Cost:** ~8 min, 6 calls. **Evidence:** `server/test/deploy-config.suite.ts:642` (`--build-arg` ban), `:920`/`:1274` (`DEFAULT_HEALTH`), `:1287`.
- **What:** BASE failed its own fast gate (emoji scan, `orb-actions.ts`). **Mechanism:** gate static-checks on the staging tip. **Verdict:** DRAWBACK. **Cost:** ~6 min, 6 calls.
- **What:** Lint flagged `.sort()` without a comparator; the hidden ordering was fragile. **Mechanism:** gate lint. **Verdict:** CAUGHT-REAL-MISTAKE. **Cost:** ~2 min. **Evidence:** `server/test/ledger.suite.ts:724`.
- **What:** A red-check showed a test would crash on `res.json()` of a 204 instead of failing a named check. **Mechanism:** red-check rule. **Verdict:** CAUGHT-REAL-MISTAKE. **Cost:** ~3 min.
- **What:** One mutation (migration skipped) crashed the whole server suite and hid other mutations in that run. **Mechanism:** server suite runner (no per-test isolation). **Verdict:** DRAWBACK. **Cost:** ~4 min.
- **What:** `cd <worktree> && …` conflicts with the system rule against chained commands; followed the dispatcher. **Mechanism:** runbook rule. **Verdict:** NEUTRAL.

**What helped:** the envelope contract's note that a new route must declare a consent practice; the usage-store migration pointer; the explicit warning off `deploy-config.suite.ts`, which surfaced the 2.6 conflict early instead of as a merge collision.

**What the harness should change:**
1. When a task changes something a suite pins (`/healthz` body, Cloud Build file), assign it to the chain that owns that suite at planning time.
2. Gate the staging tip before dispatching chains.
3. Make the server suite runner report a thrown test as a named failure.
