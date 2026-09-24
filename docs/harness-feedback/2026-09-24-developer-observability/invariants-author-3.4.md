# invariants author (task 3.4, owner-proxy) — harness feedback

- **What:** No sanctioned place for suite-owned fixtures; the product build's `APPS` list is the only fixture path, and it sits outside `invariants/`.
  - **Mechanism:** runbook rule (scope `invariants/` only) plus the build layout
  - **Verdict:** DRAWBACK
  - **Cost:** about 5 minutes and 4 tool calls
  - **Evidence:** `build/build.mjs:201-218` `APPS`; the copy is in `runner.mjs` `bundleLocalFixture`
- **What:** A scratch loader-variant patch was double-JSON-stringified, which made even the correct loader fail; it looked like the loader was wrong when the test harness was the problem.
  - **Mechanism:** tooling (no supported way to run the invariants against a modified loader)
  - **Verdict:** DRAWBACK
  - **Cost:** about 4 tool calls
  - **Evidence:** scratch runner `parts.loader.replace(…)` produced a string-literal statement
- **What:** Running the suite against loader variants proved the cases are satisfiable and catch weaker versions (message leak, wrong `where`, fixed name).
  - **Mechanism:** red-check against weaker variants
  - **Verdict:** CAUGHT-REAL-MISTAKE (without it the failed patch would have led to loosening the cases)
  - **Cost:** about 3 minutes
  - **Evidence:** variant table in the report (correct loader 13/13; message leak, `where` swap, constant name each fail)
- **What:** An injected co-author reminder conflicted with the user's CLAUDE.md; commit amended (T11).
  - **Mechanism:** conflicting instructions
  - **Verdict:** DRAWBACK
  - **Cost:** 1 amend
  - **Evidence:** `0ab4767` → `8c659f1`

**What helped:** the prompt named the loader and outer-page seams; the runner already recorded `__rnFrames` and had `scenario()`/`settled()`; the outer page's `rejected-forgery` frame gives the forged case a positive signal.

**What the harness should change:**
1. Let invariant suites declare their own fixtures (an `invariants/**/fixtures/*.app.tsx` glob bundled by `build.mjs`, or an exported `bundleApp`), removing the copied esbuild options.
2. A runner-only loader override (e.g. `WHIM_INVARIANTS_LOADER=<path>`) so owner-proxy authors can red/green-check new cases without scratch rewrites.
3. Stop injecting the co-author reminder when the user's instructions forbid it (T11).
