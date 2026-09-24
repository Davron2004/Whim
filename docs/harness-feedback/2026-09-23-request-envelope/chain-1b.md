# chain-1b (implementer): harness feedback, request-envelope 2026-09-23

## Blocks, stops and detours
- **What:** `chains.md`'s chain-1b entry ("the cost resolver's lines carry `requestId`") named a log
  line that does not exist anywhere in the codebase — `usage/resolve.ts#resolveRequestUsage`, the
  in-request cost resolver, emits no log line at all (only its unrelated background sweep does).
  I had to grep the whole `server/src` tree and `progress.md` before I trusted that conclusion
  instead of assuming I'd missed a call site.
  **Mechanism:** chain block's task wording (inherited from chain-1's honest-gap report in
  `chains.md`)
  **Verdict:** DRAWBACK
  **Cost:** ~10 grep/read calls, ~15 min
  **Evidence:** `chains.md`: "the cost resolver's lines carry requestId" vs. zero `.info(`/`.warn(`
  calls in `resolveRequestUsage`
- **What:** `./scripts/gate.sh` failed on eslint's `no-restricted-syntax` for a bare `.sort()` in my
  new test, even though the two-string array sorts identically with or without a comparator.
  **Mechanism:** gate.sh → `npm run lint`
  **Verdict:** DRAWBACK
  **Cost:** one gate re-run (~2 min) + one edit
  **Evidence:** "Pass an explicit comparator to sort()... no-restricted-syntax" at
  `request-edge.suite.ts:280`
- **What:** I passed a malformed (non-JSON) argument to the Read tool twice before correcting the
  call shape.
  **Mechanism:** Read tool's strict JSON parameter validation
  **Verdict:** ENV
  **Cost:** 2 tool calls, ~1 min

## What helped
- `handoff/envelope.md` gave exact types (`RequestVariables`, middleware order) so I never had to
  read `app.ts`/`request-edge.ts` in full to find where the request-bound logger lives.
- Existing test-double infra (`route-doubles.ts#machinePipeline`/`ControlledModelClient`,
  `wire-v2.suite.ts`'s `deliveringDeps` + real-`OpenRouterClient` wire-fetch pattern) was a ready
  template for building an E2E test with a REAL model client, which I needed since fakes never emit
  the "model call" log line.
- The mandated red-check-against-a-weaker-variant step caught a real bug in MY OWN new test
  (`capture.stop()` called before `drain()`, silently hiding 2 of 3 expected log lines) — without
  that discipline this would have shipped looking correct.
- `gate.sh`'s fast scope (no Metro/Chromium) let me re-run it ~6 times cheaply while red-checking
  four different seams one at a time.

## What the harness should change
1. When a chain's report hands a factual claim to a later chain (e.g. "this log line still lacks
   `requestId`"), have it note whether the claim was grep-verified or inferred — chain-1's honest
   gap report read as verified fact but the "cost resolver" line was inferred/aspirational.
2. `server/test/run.mjs` always type-checks both workspaces and bundles+runs the FULL
   `acceptance.ts` (~2800+ checks) even when iterating on one new test in one suite file; a
   single-suite mode would speed up the inner loop noticeably.
