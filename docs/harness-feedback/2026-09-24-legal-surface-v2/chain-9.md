# legal-surface-v2 chain-9 (implementer) — harness feedback

- **What:** Couldn't verify the Play Age Signals version or API names: `curl` to maven.google.com denied, artifact not cached. **Mechanism:** tooling / permission policy. **Verdict:** ENV. **Cost:** 3 calls; left to the orchestrator's Android build.
- **What:** Lint failed the first gate (cognitive complexity 16 in `renderScreenContent`, `void`, nested test closures). **Mechanism:** eslint sonarjs. **Verdict:** NEUTRAL. **Cost:** 1 gate run, ~4 calls. **Evidence:** `LauncherRoot.tsx 1836:51`.
- **What:** The contract puts the async check in `advanceLegalFlow`, but the synchronous refusal path also reaches the terms step, pushing the design to a check screen. **Mechanism:** contract (`handoff/terms-flow.md`). **Verdict:** DRAWBACK. **Cost:** ~10 min design.
- **What:** The brief said the consent button is "Turn on AI features"; ask mode says "Agree and continue". **Mechanism:** chain block. **Verdict:** CAUGHT-REAL-MISTAKE (checked against code, not the brief). **Cost:** 2 calls. **Evidence:** `ConsentScreen.tsx:38`, `copy.ts:289`.
- **What:** Native checks without node_modules/Pods needed codegen in a scratch dir, `swiftc -typecheck`, a test dylib link and `-showBuildSettings`. **Mechanism:** worktree setup. **Verdict:** ENV. **Cost:** ~8 calls.

**What helped:** the `WhimAppInfo` precedent pointer; `rendered-launcher`'s injectable native seams and `waitFor`; the screen-controls fixture rule forcing a visible exit and system back on the new screen.

**What the harness should change:**
1. Allow read-only `curl` to maven.google.com / dl.google.com, or pre-cache artifacts a chain block names.
2. Contracts that prescribe where async work lives should list every caller path (entry, refusal, Settings).
3. A native self-check helper (codegen into scratch + `swiftc -typecheck` + `-showBuildSettings`) for native chains in worktrees.
