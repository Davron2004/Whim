# Context chains: version-history-ux

## chain-1: store-timeline

- tasks: 1.1, 2.1–2.2
- rationale: one layer (version-store engine + vstore suite), one vocabulary (snap tags, same-line predicate); English test spec, red tests, and the `timeline` implementation share full context
- reads: specs/mini-app-versioning/spec.md (ADDED: Same-line enumeration survives rollback); design.md D2; research.md (Current behavior, verified fact 1)
- writes-contract: handoff/timeline-verb.md (exact `timeline` signature, ordering, cap semantics, exported names)

## chain-2: launcher-store-surface

- tasks: 1.2, 3.1–3.2
- rationale: all edits live in the launcher's store seam (`store-access.ts`, new `prompt-envelope.ts`, their suites); no UI files touched
- reads: specs/app-launcher/spec.md (ADDED: Version-store access for history flows stays behind StoreAccess); specs/version-history/spec.md (Requirement: History reads as the user's own prompts — envelope scenarios); design.md D4/D6/D8; handoff: handoff/timeline-verb.md
- writes-contract: handoff/store-access-history.md (wrapper signatures incl. fork's optional version id, `parsePromptEnvelope` API, re-pin semantics as verified)

## chain-3: history-screen-ui

- tasks: 1.3, 4.1–4.6
- rationale: the UI layer as one unit — `HistoryScreen.tsx`, `LauncherRoot.tsx`, `HomeScreen.tsx`, `copy.ts`, and the UI acceptance tests share files and the copy/guard vocabulary
- reads: specs/version-history/spec.md (all requirements); specs/app-launcher/spec.md (ADDED: History entry point in the app action sheet); design.md D1/D3/D5/D7; handoff: handoff/store-access-history.md
- writes-contract: none

## chain-4: docs-decision

- tasks: 5.1
- rationale: docs-only append to `docs/decisions.md`, written after the as-built surface exists
- reads: design.md (Decisions); handoff: handoff/store-access-history.md
- writes-contract: none
- after: chain-3

Task 5.2 (on-device acceptance) is attended and human-run — not dispatched to an implementer; it closes the change after chain-4 merges, like harness-server-skeleton's task 8.2.
