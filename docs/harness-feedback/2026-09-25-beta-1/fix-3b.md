# fix-3b (candidate generation cap 5), implementer, Sonnet

- **What:** The block's suggested grep set (`maxConcurrentGenerations`, `MAX_CONCURRENT_GENERATIONS`, `profileProblems`) surfaced every code/test site that could plausibly need updating, and all but the two named docs turned out to already be default-independent (explicit overrides or dynamic ratio checks). **Mechanism:** chain block · **Verdict:** NEUTRAL (worked) · **Cost:** ~10 min of verification · **Evidence:** `server/test/deploy-config.suite.ts:872-873` (dynamic ratio), `server/test/e2e.ts:652` (explicit pin), `deploy/profiles/standard.env` (no server-key overrides).

Proposal: none; "load the new value through the suites once before editing docs" was the right verification step.
