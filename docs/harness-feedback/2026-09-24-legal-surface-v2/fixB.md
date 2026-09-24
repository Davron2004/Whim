# legal-surface-v2 fix-B (implementer) — harness feedback

- **What:** Gradle can't run from the worktree (`node_modules` holds only `@whim`); swapped in a primary symlink for one compile, restored before gating. **Mechanism:** worktree setup. **Verdict:** ENV. **Cost:** ~4 min, 4 calls.
- **What:** The launcher test directory isn't typechecked; ad-hoc tsconfig showed pre-existing errors across many suites. **Mechanism:** tsconfig exclude (#79). **Verdict:** DRAWBACK. **Cost:** ~5 min.
- **What:** No single-suite mode; each of 6 red-check mutations re-ran ~12.3k checks, plus two whole runs under fr_CA. **Mechanism:** tooling. **Verdict:** DRAWBACK. **Cost:** ~8 min.
- **What:** The requested `LANG=fr_CA` proof found a locale dependency outside the six listed suites (run-signals thousands separator, `copy.ts:659` `toLocaleString()` without a locale). **Mechanism:** chain block's explicit env-var proof step. **Verdict:** CAUGHT-REAL-MISTAKE. **Cost:** 1 run. **Evidence:** `run-signals.suite.ts:144` got 'Writing · 1 204 characters'.
- **What:** `&&` rule contradiction. **Verdict:** NEUTRAL.

**What helped:** the javap pointer to the exact AAR; the `native-host` shim's mutable `Platform`/`Settings`/`I18nManager`; one-line ledger entries.

**What the harness should change:**
1. `--only <suite>` for `src/host/launcher/test/run.mjs`.
2. A gate step running the launcher suite once with `LANG=fr_CA.UTF-8`.
3. A `scripts/worktree-gradle.sh` that swaps and restores `node_modules` for native compiles.
