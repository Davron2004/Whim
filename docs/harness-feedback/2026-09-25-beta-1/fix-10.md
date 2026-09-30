# fix-10 (scoped reviewer's lows), implementer, Opus

- **What:** checking one server suite, and typechecking launcher tests. **Mechanism:** `server/test/run.mjs` has no suite filter, so a single suite means the full ~6–7 min run or a temporary entry file inside the worktree; launcher tests are excluded from the root tsconfig, so the scratch-tsconfig check means stashing for a base run and diffing 19 environment errors. **Verdict:** DRAWBACK (works but costs time; the base diff confirmed no new errors). **Cost:** about 4 extra tool calls per item, plus the risk of leaving scratch files behind. **Evidence:** tsc4-base.log vs tsc4-after.log: 19 = 19; the contract-only run took about 3 s vs 6–7 min.

Proposal: `--only <suite>` for `server/test/run.mjs`, and a Node+DOM-lib tsconfig for `src/host/launcher/test` that the gate runs (protected config → human bootstrap).
