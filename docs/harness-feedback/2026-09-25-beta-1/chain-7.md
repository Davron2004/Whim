# chain-7 (realm-runtime-and-sdk), implementer, Opus

1. **What:** build failed after I added `React.createContext` at SDK module load. **Mechanism:** build.mjs app-record extraction against REACT_STUB (not the gate itself, but the gate's build step). **Verdict:** CAUGHT-REAL-MISTAKE. **Cost:** ~5 min. **Evidence:** "app-record extraction FAILED for non-adversarial fixture(s): tip-splitter, …".
2. **What:** fast gate typecheck rejected `node:assert/strict`, and later `assert.strictEqual`/`assert.match`, in an SDK suite. **Mechanism:** root tsconfig (`types:["jest"]`) resolves only `ok`/`deepStrictEqual` on the default `node:assert` import. **Verdict:** DRAWBACK. **Cost:** ~8 min and two gate loops. **Evidence:** TS2307, then TS2339 "Property 'strictEqual' does not exist on type 'Assert'"; synthrun's harness quietly uses only `ok`.
3. **What:** sonarjs lint flagged `!(x > 0)` and then a nested ternary. **Mechanism:** lint `--max-warnings 0`. **Verdict:** NEUTRAL. **Cost:** ~2 min. **Evidence:** `sonarjs/no-inverted-boolean-check`, `sonarjs/no-nested-conditional`.
4. **What:** a change to a loader frame's `where` breaks synthrun, and neither the chain block nor the fast gate says so. **Mechanism:** synthrun is gate-full only. **Verdict:** DRAWBACK. **Cost:** ~10 min to find it by reading code, plus Chromium runs. **Evidence:** synthrun "exactly one message-bearing diagnostic per error" failed with a `[render] runtime error (no message)` diagnostic.
5. **What:** launcher test files needed a scratch tsconfig for typechecking. **Mechanism:** #79 tsconfig exclude. **Verdict:** DRAWBACK. **Cost:** ~3 min; the output mixes older errors with mine, so I had to separate them by line. **Evidence:** errors at mini-app-host-ui.suite.tsx:64 and :339, native-host.tsx:26.

What helped: the dispatch block's pre-made decisions (focus mechanics, `onUncaughtError` allowed, inset formula, strip-and-resanitize). The existing rendered MiniAppView harness with `injectedScripts` made a real "the inset matches the drawn orb" test cheap. `deliver-by-source.desktop.mjs` was an existing Chromium seam outside `invariants/` where the loader could be tested for real.

What the harness should change:
1. chains.md reads for any chain that edits `loader.js` frame semantics should list `synthrun/observe.ts` `REALM_LISTENER_WHERES` and the synthrun acceptance fixtures as consumers.
2. Add a note in CLAUDE.md "Test assertions": under the root tsconfig only `nodeAssert.ok`/`deepStrictEqual` typecheck, so typechecked suites (SDK, synthrun) should stick to those two.
3. Put the REACT_STUB constraint next to the SDK in a comment or doc: no React API may run at module load except createElement/useState/useEffect.
