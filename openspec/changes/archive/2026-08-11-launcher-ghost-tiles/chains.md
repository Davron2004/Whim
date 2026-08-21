# Context chains: launcher-ghost-tiles

## chain-1: persistence-pending-store

- tasks: 1.1–1.4
- rationale: the pending-build record store plus the pure identity helpers — one persistence/pure-logic vocabulary, no UI or flow wiring; everything else in the change consumes this surface.
- reads: specs/pending-builds/spec.md (all §); design.md decisions 1–2, 4 (record shape, keyspace, demotion); research.md §1, §6 (KVBackend/AppIndex conventions, id invariants)
- writes-contract: handoff/pending-store.md (store API signatures, record type verbatim, demotion semantics, helper signatures `workingTitleFromPrompt`/`ghostTileColorFor`)

## chain-2: flow-shell-wiring

- tasks: 2.1–2.5
- rationale: every task edits the same generation lifecycle in `LauncherRoot.tsx` (`onBuildIt`, `deliverResult`, cancel/failure paths) — splitting it would smear one state machine across contexts.
- reads: specs/prompt-flow/spec.md (all §); specs/pending-builds/spec.md (lifecycle + crash-ordering requirements); design.md decisions 3–5, 7; handoff: handoff/pending-store.md
- writes-contract: handoff/ghost-handlers.md (shell→grid handler props: ghost tap/long-press/retry/dismiss signatures, and how ghost records + installed apps reach `HomeScreen`)
- after: chain-1

## chain-3: ui-grid-tiles

- tasks: 3.1–3.5
- rationale: pure rendering layer — grid composition, `AppTile` ghost visuals, rebuild accents, copy — all UI vocabulary, consuming the two upstream interfaces. New pure composition logic goes in a non-RN sibling module (Node-suite importable), not `prompt-flow.ts`, to avoid overlapping chain-1's files.
- reads: specs/app-launcher/spec.md (all §); design.md decisions 6–8; handoff: handoff/pending-store.md, handoff/ghost-handlers.md
- writes-contract: none
- after: chain-2
