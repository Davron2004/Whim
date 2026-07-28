# Context chains: linked-apps-data-model

## chain-1: launcher-storage-groups

- tasks: 1.1, 2.1–2.4
- rationale: one seam (`app-index.ts` + `store-access.ts` + their suites); the group field, resolution branch, fork parameter, and refcounted delete are a single vocabulary
- reads: specs/linked-apps/spec.md (Storage groups are host-mediated…; Rewind continuations share by default; Storage deletion is refcount-gated); specs/mini-app-storage/spec.md (MODIFIED requirement); design.md D1–D3; research.md (Current behavior 1–3)
- writes-contract: handoff/storage-groups.md (`storageGroupId` field semantics, `engineAppId` resolution, `fork` signature with `shareData`, `storageRefCount` name and idiom)

## chain-2: fork-question-ui

- tasks: 1.2, 3.1–3.2
- rationale: UI-layer files (`HomeScreen.tsx`, `LauncherRoot.tsx`, `copy.ts`) and the guard/copy vocabulary, distinct from the machinery seam
- reads: specs/app-launcher/spec.md (Explicit fork asks share-vs-fresh at fork time); design.md D4; handoff: handoff/storage-groups.md
- writes-contract: none

## chain-3: shared-storage-acceptance

- tasks: 1.3, 4.1–4.3
- rationale: acceptance surface — shared-file lifecycle and collision behavior exercised end-to-end, plus the launch-error copy rendering; touches launcher test suites and the launch-error surface (and `copy.ts` for the error string, hence ordered after chain-2)
- reads: specs/linked-apps/spec.md (Schema collisions on shared storage fail closed at launch; Storage groups scenarios); specs/app-launcher/spec.md (Delete tears down storage only when the group is empty); design.md D5, D7; handoff: handoff/storage-groups.md
- writes-contract: none
- after: chain-2

## chain-4: docs-decision

- tasks: 5.1
- rationale: docs-only append to `docs/decisions.md`, written after the as-built surface exists
- reads: design.md (Decisions); handoff: handoff/storage-groups.md
- writes-contract: none
- after: chain-3

Task 5.2 (on-device acceptance) is attended and human-run — not dispatched to an implementer; it closes the change after chain-4 merges.

Cross-change ordering: this change is dispatched only after `version-history-ux` has merged (shared files: `store-access.ts`, `LauncherRoot.tsx`, `HomeScreen.tsx`, `copy.ts`, launcher suites).
