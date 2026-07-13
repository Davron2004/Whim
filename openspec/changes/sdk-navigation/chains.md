# Context chains: sdk-navigation

## chain-1: sdk-nav-primitive

- tasks: 1.1–1.6
- rationale: all edits live in `src/sdk/` (emitter, `nav` object, nav root, tests) and share the SDK vocabulary; no build regeneration here — generated artifacts are owned by chain-2/chain-4 to avoid worktree conflicts
- reads: specs/sdk-navigation/spec.md §Requirement: Mini-apps navigate via the `nav` object, §Navigation is a stack rooted at `initial`, §Depth changes emit the untrusted depth hint, §System back pops the stack, §Unknown targets degrade never crash; design.md D1–D5; handoff: none
- writes-contract: handoff/nav-api.md (the `nav` object surface, the nav-root export name/signature the loader mounts, the exact frame shapes emitted/consumed, the emitter's mount-subscription contract)

## chain-2: runtime-loader-mount

- tasks: 2.1–2.4
- rationale: the loader diff, the anchor-comment update, the regeneration, and the invariants runs are one working context — the containment-surface edit and its verification must not be split
- reads: specs/sdk-navigation/spec.md §Navigation adds no containment surface, §Navigation is a stack rooted at `initial` (mount-once semantics); design.md D2/D3 + Risks (loader is containment surface); handoff: handoff/nav-api.md
- writes-contract: none

## chain-3: static-checks-row

- tasks: 3.1–3.2
- rationale: pure `checks/` data-table addition + its acceptance tests; different layer and files from chains 1–2, dependency-free (the row is data over source strings, independent of the SDK implementation), so the dispatcher may run it in parallel with chain-1
- reads: specs/static-checks/spec.md §Requirement: Screen graph resolves statically (MODIFIED); design.md D4; handoff: none
- writes-contract: none

## chain-4: fixture-docs-verify

- tasks: 4.1–4.3
- rationale: end-to-end closure — the multi-screen fixture, capabilities/decision-log rows, and the gate run need the merged SDK + loader + checks state; touches `fixtures/` and regenerated artifacts (same generated files as chain-2, hence the explicit ordering)
- reads: specs/sdk-navigation/spec.md (all requirements, as the e2e checklist); handoff: handoff/nav-api.md
- writes-contract: none
- after: chain-2, chain-3
