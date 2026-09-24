# legal-surface-v2 chain-6 (implementer) — harness feedback

- **What:** Test directories aren't typechecked, so required props added to screens passed `tsc` while 8 test render sites would have crashed at runtime; found by grep. **Mechanism:** tsconfig excludes `src/host/launcher/test`. **Verdict:** DRAWBACK. **Cost:** ~4 calls. **Evidence:** `npx tsc --noEmit` exit 0 before the test fixes (#79).
- **What:** Launcher and checks runners have no single-suite mode; each iteration ran ~12k checks. **Mechanism:** tooling. **Verdict:** DRAWBACK. **Cost:** ~2–3 min × 6 runs.
- **What:** Red-checks hand-rolled (backups, `sed`, restore). **Mechanism:** no red-check tooling (T6). **Verdict:** NEUTRAL. **Cost:** ~8 calls.
- **What:** Co-author reminder vs the user's CLAUDE.md; committed then amended. **Mechanism:** conflicting instructions (T11). **Verdict:** DRAWBACK. **Cost:** 1 call. **Evidence:** 932c6f09 → e31ec916.
- **What:** The web-site parity tripwire and consent-coverage suite made the French parity and both-tables rules small additions. **Mechanism:** existing tripwires. **Verdict:** NEUTRAL.
- **What:** The parity red-check against chain-7's original fr page caught a real consentWho wording difference, forcing a decision instead of drift. **Mechanism:** chain block's "must end identical" rule + parity check. **Verdict:** CAUGHT-REAL-MISTAKE. **Cost:** 2 calls.

**What helped:** the chain block named the contracts and the French page to align with, and settled that `settings*` keys stay English; the `withLauncher` harness made the restart scenario easy.

**What the harness should change:**
1. Typecheck the launcher test directory (T3, #79).
2. `--only <suite>` for the launcher and checks runners (T10).
3. Resolve the co-author conflict in the dispatcher prompt or the reminder.
