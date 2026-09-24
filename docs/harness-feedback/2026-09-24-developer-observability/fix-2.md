# developer-observability fix-2 (implementer) — harness feedback

- **What:** The gate log in the shared scratchpad got another agent's gate output appended. **Mechanism:** subagents share one scratchpad directory. **Verdict:** DRAWBACK (T7). **Cost:** ~3 calls + one extra gate run.
- **What:** Red-check via hand-rolled `git stash push <file>`/pop. **Verdict:** NEUTRAL (T6).
- **What:** The brief quoted the gate-full failure text and named the invariant-locked loader contract, so the fix (synthrun, not the loader) was found in ~4 reads. **Verdict:** NEUTRAL (helped).

**What helped:** the suite's `openObservedRun`, `framePayload`, `waitUntil` helpers let the new test use real loader frames.

**What the harness should change:**
1. A per-agent scratchpad subdirectory, or chain-id-prefixed log names in every dispatch (T7).
2. A `fixloop.sh redcheck`-style helper that records failing test names (T6).
