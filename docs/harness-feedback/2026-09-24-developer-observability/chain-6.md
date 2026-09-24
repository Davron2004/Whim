# developer-observability chain-6 (+2.6) (implementer) — harness feedback

- **What:** The task assumed a log line holding `budget_exhausted` that doesn't exist; Class B for that one alert. **Mechanism:** chain block / plan. **Verdict:** DRAWBACK (T1). **Cost:** ~12 min, 8 calls. **Evidence:** no log call next to any `budgetExhaustedRefusal` site.
- **What:** The suite's hostname rule stopped the uptime host being committed under `deploy/monitoring/`, shaping the design. **Mechanism:** gate check (`hostnameProblems`). **Verdict:** NEUTRAL. **Cost:** ~2 min.
- **What:** Notification channels need `gcloud beta`, not installed; flags unverifiable locally. **Mechanism:** tooling. **Verdict:** ENV. **Cost:** 3 calls.
- **What:** No single-suite mode in the server runner; each red-check ran ~3300 checks. **Mechanism:** tooling. **Verdict:** DRAWBACK (T10). **Cost:** ~6 min over 4 runs.
- **What:** Red-checks hand-rolled with cp backups and python mutations. **Mechanism:** red-check rule. **Verdict:** DRAWBACK (T6). **Cost:** ~3 min.
- **What:** Co-author reminder vs the user's CLAUDE.md; committed, then amended. **Mechanism:** conflicting instructions. **Verdict:** DRAWBACK (T11). **Cost:** 1 call. **Evidence:** 25c0b9a4 → 739fab03.
- **What:** macOS has no `timeout`. **Mechanism:** tooling. **Verdict:** ENV (T5). **Cost:** 1 call.

**What helped:** the chain block's precise notes on the suite contradictions with line hints and the narrow fix; the log-shipping handoff's field paths; the suite's existing gcloud stubs (a real two-run provision test).

**What the harness should change:**
1. Before dispatch, grep-check every log field or message a chain's filters rely on (T1).
2. A single-suite filter for `server/test/run.mjs` (T10).
3. Drop the injected co-author reminder for subagents whose user rules forbid it (T11).
