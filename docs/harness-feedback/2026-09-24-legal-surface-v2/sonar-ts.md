# legal-surface-v2 Sonar round 1, TypeScript (fix-worker) — harness feedback

- **What:** Exact rule id + file:line + message per finding made every fix mechanical. **Verdict:** NEUTRAL (helped). **Cost:** none.
- **What:** The prompt pre-diagnosed S11 (options object, keep public semantics), avoiding a wide restructure. **Verdict:** NEUTRAL (helped).
- **What:** `gate.sh`'s server-suite output logs injected-failure noise indistinguishable at a glance from real failures; had to grep the log. **Mechanism:** gate output. **Verdict:** DRAWBACK. **Cost:** ~1 min.

**What the harness should change:**
1. Findings docs note expected ripple into files outside the target list (call sites of a changed signature).
2. A `checks passed, 0 failed` summary line per gate suite section.
