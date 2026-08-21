# Context chains: failure-dismiss-honesty

## chain-1: honest-exits

- tasks: 1.1–2.1
- rationale: one small UI/copy/wiring change across three launcher files plus their suites; a
  single chain — no contract consumers, no parallelism to exploit.
- reads: `specs/prompt-flow/spec.md` (the MODIFIED requirement, all scenarios); design.md
  Decisions 1–5; research.md anchors (copy.ts:158, FailureScreen.tsx:207, LauncherRoot.tsx:862/:901,
  the `dropPendingBuild(` one-call-site lock in prompt-flow-wiring.suite.ts)
- writes-contract: none (terminal chain)
