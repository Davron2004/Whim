# developer-observability Sonar round 1, shell (fix-worker) — harness feedback

- **What:** 21 shell findings fixed with no test literal to sync; the deploy-config suite runs the real scripts under bash against PATH stubs and asserts on live argv, not source text. **Verdict:** NEUTRAL (worked). **Cost:** ~15 calls, one gate run.

**What helped:** behaviour-level tests (argv) instead of source-shape tests; exact file:line per finding.

**What the harness should change:** none proposed.
