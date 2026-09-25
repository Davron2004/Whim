# chain-4 (app-flow-screens), implementer, Opus

- **What:** the `Screen` union rejected a `notice?: string` field on the update screen.
  **Mechanism:** `npm run typecheck` · **Verdict:** CAUGHT-REAL-MISTAKE · **Cost:** ~2 min · **Evidence:** TS2322 at LauncherRoot.tsx:594/1534; renamed to `updateNotice`.
- **What:** sonarjs cognitive-complexity (16/17 > 15) on `onComposeContinue` and `runAttempt` forced extracting the catch bodies.
  **Mechanism:** `npm run lint --max-warnings 0` · **Verdict:** DRAWBACK · **Cost:** ~8 min, plus a bigger diff in a file chains 5/6 share · **Evidence:** lint output, LauncherRoot.tsx:1317/1564.
- **What:** typechecking the touched launcher tests with a scratch tsconfig pulled ~100 errors from untouched suites through `acceptance.ts`, and I had to filter by file and line.
  **Mechanism:** gate doesn't typecheck launcher tests (#79) · **Verdict:** DRAWBACK · **Cost:** ~6 min · **Evidence:** scratchpad `tc/out2.txt`.
- **What:** the server test helper `readSseResponse` throws on frames of a type it doesn't know, so the stub-marker tests needed their own raw frame reader.
  **Mechanism:** `server/test/sse-reader.ts` runs `GenerationEvent.parse` on every frame · **Verdict:** NEUTRAL · **Cost:** ~3 min · **Evidence:** the `sseData` helper in server-core.suite.ts.
- **What:** `sonarjs/no-nested-functions` flagged a `map`/`find` inside the test callbacks.
  **Mechanism:** lint · **Verdict:** NEUTRAL · **Cost:** ~1 min · **Evidence:** flow-messages-ui.suite.tsx:345.

What helped: the dispatch block's pre-made decisions 1–9; the `rendered-launcher.tsx` harness (whole shell plus scripted SSE streams); `wire-future-frames.suite.ts` as a template.

What the harness should change:
1. Typecheck `src/host/launcher/test/**` in the fast gate (fix #79), or ship an `npm run launcher:typecheck -- <files>` that doesn't pull in every suite.
2. Chain blocks that touch LauncherRoot should flag its cognitive-complexity headroom, so an implementer plans the extraction up front.
3. Give `server/test/sse-reader.ts` an option to keep frames it can't decode, for forward-compatibility tests.
