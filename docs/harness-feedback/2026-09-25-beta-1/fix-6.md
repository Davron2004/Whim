# fix-6 (reliable clarify limit; flowbench rates), implementer, Opus

- **What:** a scratch runner for single server suites. **Mechanism:** a scratchpad script writes an esbuild entry that imports only the chosen `*.suite.ts` files, bundled to `<worktree>/.fix6-scratch.<pid>.tmp.mjs` with the same externals as `run.mjs`. **Verdict:** NEUTRAL (worked; made red/green loops practical). **Cost:** about 5 minutes to write; when a suite fails, the harness's `report()` exits before the runner's `finally`, so 7 bundles were left behind. **Evidence:** red-check runs took about 5–20 s each, against about 6–7 min for `npm run server:test`.
- **What:** the block's premise about the device reader. **Mechanism:** the block said "the tolerant reader should [accept `limit: null`], but test it". Reading `isClarifyResponse` showed it rejects null. **Verdict:** CAUGHT-REAL-MISTAKE (the "test it" hedge caught a false premise). **Cost:** reading one file. **Evidence:** `generation-client.ts:132-138`.

Proposals:
1. `node server/test/run.mjs --only <suite,...>`: skips tsc, bundles only those suites, and removes its bundle on exit.
2. In dispatch blocks, state cross-layer behaviour the dispatcher hasn't checked as a question ("does the device accept X? check <file>") rather than as "should".
