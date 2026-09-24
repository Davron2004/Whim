# developer-observability credit-alert fix (fix-worker, post-merge) — harness feedback

- **What:** A production `provision.sh` run failed on a policy shape Cloud Monitoring rejects (two log-match conditions); no gate check modelled the API's constraint. **Mechanism:** deploy-config suite tested filters, not the policy schema's server-side rules. **Verdict:** DRAWBACK (caught in production provisioning, harmless because provision stops before later resources). Now a structural check.
- **What:** Lint forced the extended `filterMatches` into top-level functions (complexity) and explicit sort comparators. **Verdict:** NEUTRAL.

**What the harness should change:**
1. For committed cloud configs, encode the provider's documented shape limits as structural checks (one condition per log-match policy, etc.).
