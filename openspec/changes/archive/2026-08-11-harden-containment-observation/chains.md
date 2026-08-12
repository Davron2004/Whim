# Context chains: harden-containment-observation

<!--
  Tasks from tasks.md grouped into context chains for the dispatcher.
  Rules: 3–7 tasks per chain (≤~800 lines expected diff), grouped by shared
  files/layer, sequential by default. Each chain must be completable from ONLY
  its named spec excerpts + contracts from earlier chains — if a task needs
  "whatever an earlier chain happened to learn," promote that into a contract.
  Declare a writes-contract for every chain whose outputs a later chain consumes.
  A contract (handoff/*.md) is an interface, hard-capped at 120 lines.
-->

No chain here is HUMAN-BOOTSTRAP. The design deliberately avoids `build/assemble.mjs`,
`src/runtime/web/loader.js`, `probes.js`, `invariants/` and `build/*` — they stay read-only, and the
D7-local assertion lives in `synthrun/test/acceptance.ts` (chain-4) rather than in owner-authored
`invariants/`. If an implementer finds itself needing to edit any of those files, the chain is
wrong: stop and report rather than marking the chain HUMAN-BOOTSTRAP and proceeding.

File partition (no two chains without a declared `after:` share a file):

- chain-1 — `checks/contract.ts`, `checks/test/acceptance.ts`, `synthrun/observe.ts` (kind roster only)
- chain-2 — `synthrun/observe.ts`, `synthrun/session.ts`, `synthrun/report.ts` (composition only)
- chain-3 — `synthrun/contract.ts`, `synthrun/observe.ts`, `synthrun/report.ts`
- chain-4 — `synthrun/test/acceptance.ts`
- chain-5 — `server/src/generation/stages/run.ts`, `server/src/generation/machine.ts`, `server/test/e2e.ts`
- chain-6 — `evals/adapters/synthetic-run.ts`, `evals/test/**`

chains 1→2→3 are strictly serial because all three touch `synthrun/observe.ts`. chains 4, 5 and 6 are
mutually dependency-free and file-disjoint, so the dispatcher may run them in parallel once chain-3
has merged.

## chain-1: diagnostics-kind-vocabulary

- tasks: 1.1–1.4
- rationale: one closed-vocabulary edit — the kind string, its hint, its roster assertion. Touches
  the checks contract module and only the kind roster in `synthrun/observe.ts`; everything
  downstream needs the exact string, so it goes first and alone.
- reads: `specs/harness-diagnostics/spec.md` §Kinds are a closed, centrally-owned vocabulary;
  `specs/synthetic-run/spec.md` §Diagnostics extend the central vocabulary additively; handoff: none
- writes-contract: handoff/diagnostic-kind.md

## chain-2: synthrun-relay-ordering

- tasks: 2.1–2.7
- rationale: the D1 structural fix — one coherent move of the relay, the transport shim and the
  console listener into the pre-navigation phase, plus the two compositions that consume the phase
  split. All of it is the `attachObserversEarly`/`finish`/`openRun` seam.
- reads: `specs/synthetic-run/spec.md` §Observation is trusted-vantage only (the pre-navigation and
  main-frame-confinement paragraphs), §One candidate in, one deterministic run report out (the
  determinism clause, for the `bootMs` note); handoff: handoff/diagnostic-kind.md
- writes-contract: handoff/observation-phases.md
- after: chain-1 — shares `synthrun/observe.ts`, and the relay callback's diagnostic emission needs
  the kind to exist.

## chain-3: synthrun-verdict-tristate

- tasks: 3.1–3.5
- rationale: the D2/D5 semantic change — widen the verdict, stop the collapse in `report.ts`, attach
  the right diagnostic to each state, and record the forgery signal bounded and payload-free. One
  vocabulary (`ObservationState.contained` → `RunReport.contained`), one file trio.
- reads: `specs/synthetic-run/spec.md` §One candidate in, one deterministic run report out (the
  three-valued verdict paragraph), §Observation is trusted-vantage only (the rejected-forgery
  paragraph); handoff: handoff/diagnostic-kind.md, handoff/observation-phases.md
- writes-contract: handoff/run-report-contract.md
- after: chain-2 — shares `synthrun/observe.ts` and `synthrun/report.ts`, and the "no frame is
  dropped" ordering must already hold before `null` can mean what the spec says it means.

## chain-4: synthrun-acceptance

- tasks: 4.1–4.6
- rationale: the whole acceptance surface of this change, in one file. The un-quarantined
  `mount_timeout` case is the acceptance test for chain-2, the three-state cases for chain-3, and the
  D7-local sandbox-realm assertion belongs beside them.
- reads: `specs/synthetic-run/spec.md` §Observation is trusted-vantage only (all scenarios),
  §One candidate in, one deterministic run report out (all scenarios), §Diagnostics extend the
  central vocabulary additively; handoff: handoff/diagnostic-kind.md,
  handoff/observation-phases.md, handoff/run-report-contract.md
- writes-contract: none
- after: chain-3
- note: task 4.2 may return a **positive** finding — the `__whimSynthRelay` binding reachable from
  the sandbox realm. That is a pre-existing containment hole and becomes its own change. The chain
  records it and leaves the assertion in place; it does not fix it and does not widen its own scope.

## chain-5: pipeline-unobserved-terminal

- tasks: 5.1–5.5
- rationale: the server-side half of the `boolean | null` sweep plus the D3/D6 terminal rule and
  reason copy — one layer, one vocabulary (`RunOutcome`, terminal events, `failure.reason`), three
  adjacent files.
- reads: `specs/generation-pipeline/spec.md` §The run stage is the synthetic harness, and
  containment failure is terminal (all scenarios); handoff: handoff/run-report-contract.md,
  handoff/diagnostic-kind.md
- writes-contract: none
- after: chain-3

## chain-6: evals-containment-verdict

- tasks: 6.1–6.3
- rationale: the evals-side half of the same sweep — the adapter that hardcodes
  `authenticated: true` today (design Open Question 1) plus its fixtures and mapping tests. Disjoint
  from chain-5's files, so the two run in parallel.
- reads: `specs/synthetic-run/spec.md` §One candidate in, one deterministic run report out (the
  three-valued verdict paragraph); handoff: handoff/run-report-contract.md
- writes-contract: none
- after: chain-3
