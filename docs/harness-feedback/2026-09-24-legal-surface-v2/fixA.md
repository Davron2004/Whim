# legal-surface-v2 fix-A (implementer) — harness feedback

- **What:** System prompt says no `&&`; the chain block says `cd <wt> && …`. Followed the block. **Mechanism:** runbook rule vs chain block. **Verdict:** NEUTRAL (T2/T11).
- **What:** L3's Caddy route needed edits to the route table and smoke stub in `deploy-config.suite.ts`, a file allowed only for L4. **Mechanism:** chain block file ownership. **Verdict:** DRAWBACK. **Cost:** ~3 min (T13).
- **What:** Hand-rolled red-checks with `cp` backups; crashed runs left four `.server-acceptance.<pid>.tmp.mjs` files. **Mechanism:** tooling. **Verdict:** DRAWBACK. **Cost:** ~6 runs × 1–2 min (T6).
- **What:** Typecheck caught `Record<WideningId,string>` wrongly requiring three `promise:` keys. **Mechanism:** gate typecheck. **Verdict:** CAUGHT-REAL-MISTAKE. **Cost:** 2 calls. **Evidence:** `copy.ts(400,3) TS2739`.
- **What:** Lint forced splitting `legalPageTests` (complexity 22) and rewriting `void` arrow bodies. **Mechanism:** gate lint. **Verdict:** DRAWBACK. **Cost:** 1 gate run (T9).
- **What:** No single-suite mode in the server runner; each red-check ran ~3,140 checks. **Mechanism:** tooling. **Verdict:** DRAWBACK. **Cost:** ~8 min (T10).

**What helped:** the review findings plus the orchestrator's decisions in `progress.md` were precise enough to implement without re-deriving; the web-site parity checks kept page and copy edits in step.

**What the harness should change:**
1. A `redcheck` helper: back up, mutate, run one suite, restore, record the failing test names.
2. A single-suite filter for the server and launcher runners.
3. When planning fix chains, give cross-cutting route/config tables to one owner instead of splitting by finding.
