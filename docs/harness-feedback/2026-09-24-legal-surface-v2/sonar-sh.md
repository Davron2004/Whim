# legal-surface-v2 Sonar round 1, shell (fix-worker) — harness feedback

- **What:** A mechanical `[ ]` → `[[ ]]` fix broke a test because `server/test/deploy-config.suite.ts` plants literal substrings of the production script for red-check variants. **Mechanism:** cross-file coupling between the fix allowlist and stringly-typed test fixtures. **Verdict:** CAUGHT-REAL-MISTAKE (gate caught it) / DRAWBACK (scope expanded by one file). **Cost:** ~5 min. **Evidence:** `setup: planted weakening did not apply` → `deploy-config.suite.ts:1933`.

**What helped:** the instruction to check other `[` tests in touched lines.

**What the harness should change:**
1. For findings in `deploy/*.sh` or `deploy/vm/*.sh`, the prompt notes that `deploy-config.suite.ts` plants literal substrings of those scripts; a textual rewrite of a planted line needs a one-line sync in the suite.
