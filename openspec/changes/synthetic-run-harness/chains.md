# Context chains: synthetic-run-harness

## chain-1: core-builder-session

- tasks: 1.1–1.4
- rationale: the library skeleton, candidate builder, tripwire, and Chromium lifecycle are one working context — everything else consumes their surface
- reads: specs/synthetic-run/spec.md §One candidate in one deterministic run report out, §The candidate boots in the unmodified production runtime page, §Session lifecycle; design.md D4/D6
- writes-contract: handoff/harness-core.md (entry-point + options types, page-assembly function signatures, session/context lifecycle API, where run modules plug into the orchestrator)

## chain-2: observers-watchdog

- tasks: 2.1–2.4
- rationale: trusted-vantage collectors, watchdog, and source-map resolution share the observation vocabulary and the same hostile fixtures
- reads: specs/synthetic-run/spec.md §Observation is trusted-vantage only, §Watchdog makes every timeout an explicit outcome, §Diagnostics extend the central vocabulary (line/source-map clause); design.md D2; handoff: handoff/harness-core.md
- writes-contract: handoff/observe-api.md (collector interfaces, watchdog hooks, the observation-event shapes the sweep and report consume)
- after: chain-1

## chain-3: capability-wiring

- tasks: 3.1–3.3
- rationale: the bridge/storage/effector wiring is the bridge-invariants recipe transplanted — one vocabulary, one precedent file pair to mirror; ordered after chain-2 because both extend the run orchestrator (shared-file rule, not a contract need)
- reads: specs/synthetic-run/spec.md §Real gate ephemeral storage recording effectors; design.md D3; handoff: handoff/harness-core.md
- writes-contract: handoff/capability-trace.md (denial/trace record shapes the report consumes)
- after: chain-2

## chain-4: sweep-and-screens

- tasks: 4.1–4.5
- rationale: enumeration, per-screen driver, nav traversal, and cold-mount pass are the sweep layer; needs the merged observation + session surfaces underneath it
- reads: specs/synthetic-run/spec.md §Interaction sweep covers the interactive surface, §Screen coverage follows real navigation; design.md D1 + Risks (enumeration fallback); handoff: handoff/harness-core.md, handoff/observe-api.md
- writes-contract: none
- after: chain-3 (also requires the `sdk-navigation` change merged to main before dispatch — external ordering, the dispatcher must not start this chain before it)

## chain-5: diagnostics-report-close

- tasks: 5.1–5.5
- rationale: the central-vocabulary addition (`checks/contract.ts`), report assembly, end-to-end acceptance, and docs are the closure layer over everything merged before it
- reads: specs/synthetic-run/spec.md §Diagnostics extend the central vocabulary, §One candidate in one deterministic run report out (report contents); design.md D5; handoff: handoff/harness-core.md, handoff/observe-api.md, handoff/capability-trace.md
- writes-contract: none
- after: chain-4
- HUMAN-BOOTSTRAP touchpoint (task 5.3 only): one `package.json` scripts entry for the new suite (Class-2, agent-blocked). The implementer writes the suite and lists the exact one-line script addition in its report; a human applies that line. Everything else in this chain is dispatchable.
