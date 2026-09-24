# developer-observability chain-3 (implementer) — harness feedback

- **What:** Fast gate failed on a pre-existing emoji-scan violation in a file this chain doesn't own. **Mechanism:** gate check (`source-scans.suite.ts:46`). **Verdict:** DRAWBACK (real defect; staging should catch it, not a chain). **Cost:** ~8 calls, ~5 min. **Evidence:** `orb-actions.ts:39, :42`, reproduced with changes stashed.
- **What:** Scratch Playwright probe couldn't resolve `playwright` (worktree `node_modules` holds only `@whim`). **Mechanism:** worktree setup. **Verdict:** ENV. **Cost:** 2 calls. Fixed by symlinking primary `node_modules` into the scratch dir.
- **What:** The owner-proxy INV-ERRFRAME cases were a precise red-first target (leak detector, post-paint and calm-tap guards). **Mechanism:** chain block + separately-authored invariants. **Verdict:** NEUTRAL (helped). **Cost:** 0.

**What helped:** the chain block spelled out the invariant cases' four requirements; the two-generation-namespaces reminder pointed at the per-iframe nonce as the stale-frame fence; the bridge runner's `scenario()` was reusable for the 3.1 probe.

**What the harness should change:**
1. Run `checks:test` on the staging tip at run start and fix findings before cutting chain worktrees.
2. Worktree setup symlinks the full primary `node_modules`, or documents a scratch-script recipe.
3. When a task says "record the result", give the report a fixed slot for it.
