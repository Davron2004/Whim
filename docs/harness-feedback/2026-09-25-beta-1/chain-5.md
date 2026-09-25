# chain-5 (app-legal-flow), implementer, Opus

- **What:** Launcher test files aren't typechecked by the gate, so I needed a scratch tsconfig and had to sort pre-existing errors from mine by hand, three rounds.
  **Mechanism:** tsconfig exclude of `src/host/launcher/test` (#79), per the chain-block rule · **Verdict:** DRAWBACK · **Cost:** ~6 tool calls · **Evidence:** the TS2367/TS2769/TS2345 errors at native-host.tsx:23, rendered-launcher.tsx:93, privacy-settings-ui.suite.tsx:66/72/187/197.
- **What:** Decision 2 asked for two JS deadlines (3 s query, 60 s sheet) on one native method, which can't be done. I had to redesign the native interface and pick the deviation class myself.
  **Mechanism:** chain block (dispatch/chain-5.md decision 2 vs decision 3) · **Verdict:** DRAWBACK · **Cost:** ~10 min deliberating · **Evidence:** chain-5.md:19 "bounded in JS at 3 s" vs :24 "resolves a string" and :34 "JS bounds it at 60 s".
- **What:** D6 "from the start" conflicts with the live ai-data-consent text ("Tapping it SHALL open the consent screen in review mode"). I read GitHub issue #104 to settle which entry point "Turn on AI features" meant.
  **Mechanism:** spec deltas / chain block · **Verdict:** DRAWBACK · **Cost:** ~10 min, 4 tool calls · **Evidence:** openspec/changes/store-launch-compliance/specs/ai-data-consent/spec.md:80-82 vs the beta-1 terms-acceptance delta.
- **What:** The first red-check capture missed the failure names, because the runner prints them to stderr.
  **Mechanism:** tooling (launcher run.mjs output split) · **Verdict:** ENV · **Cost:** 1 rerun · **Evidence:** the redcheck.py stdout-only capture.

What helped: the chain block's exact decisions and the swiftinterface path (API names checked before writing Swift). The launcher suite runs in about 4 s, which made five-variant red-checks cheap. The existing FakeTimers/captureTimeouts seams meant no new test infrastructure. The chain-4 note about `notice` field naming.

What the harness should change:
1. Fix #79's pre-existing test-file type errors and typecheck launcher tests in the gate, so implementers stop hand-diffing scratch tsc output.
2. Add a planning checklist line: every JS deadline in a chain block must map to its own native promise (one native call, one bound).
3. Document a "native verification from a worktree" recipe in docs/harness.md (standalone `swiftc -typecheck`, ObjC header emit, codegen into scratch), so native chains report more than "couldn't compile".
