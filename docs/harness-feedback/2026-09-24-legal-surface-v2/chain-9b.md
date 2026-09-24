# legal-surface-v2 chain-9b (fix-worker) — harness feedback

- **What:** Asked to run Gradle `assembleOffline` from a chain worktree; it can't complete there (Metro `Unable to resolve module @babel/runtime/helpers/interopRequireDefault`, identical with zero diff). **Mechanism:** worktree setup / Metro path-depth. **Verdict:** ENV. **Cost:** ~15 min. **Evidence:** reproduced on BASE `8f35a9b8` with the diff stashed; first confirmation that it blocks native Android builds (`createBundleOfflineJsAndAssets`), not just `guard:metro`. Verified with `:app:compileDebugKotlin` instead.
- **What:** The `PATH=…v22.20.0` prefix for Gradle, reused for `gate.sh`, gives a spurious emoji-scan failure. **Mechanism:** env/tooling (ICU, #87). **Verdict:** ENV. **Cost:** ~10 min.
- **What:** The emoji scan reports wrong line numbers after a multi-line block comment (`withoutComments` strips newlines before `split('\n')`): `orb-actions.ts:39/42` for real hits at 61/64. **Mechanism:** checks/ tooling bug. **Verdict:** DRAWBACK. **Cost:** ~5 min. **Evidence:** `checks/test/repo/source-scans.suite.ts:23-24`.
- **Also (orchestrator note):** the worker's fast gate failed `@whim/contract is bundled into the entry` (`server/test/prod-build.suite.ts:251`) because its worktree had the FULL primary `node_modules` symlinked, so `@whim/contract` resolved to the primary tree; the main-tree regate of the merge passed. ENV, caused by the orchestrator's setup for native builds.

**What helped:** the javap/AAR instruction made the API-shape question mechanical; the stash isolation pattern gave confident "not my diff" verdicts.

**What the harness should change:**
1. Native Android device builds (anything reaching `createBundleOfflineJsAndAssets`) belong in a post-merge main-tree step; chain blocks should say "verify with `compileDebugKotlin`, defer `assembleOffline`".
2. Fix the emoji scan's line attribution (report against the original line index).
