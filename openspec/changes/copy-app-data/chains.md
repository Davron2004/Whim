# Context chains: copy-app-data

No chain edits a `CONFIG_SET` file. The storage and launcher suites are registered from their own `acceptance.ts` entries, so `package.json` is untouched. No chain touches `invariants/`, the gate scripts, `.claude/**`, tsconfig, eslint or knip config, or `build/*`. **No HUMAN-BOOTSTRAP chain.**

**Cross-change ordering.**
- chain-3 builds on design-system-v1's chains 15 (home menu) and 20 (History), which own `HomeScreen.tsx`, `HistoryScreen.tsx`, `copy.ts` and the question's visual design. chain-3 starts only once both are merged on the staging branch (task 3.1's precondition).
- chain-2 edits `LauncherRoot.tsx` (seam injection and launch sweep) and possibly `HomeScreen.tsx`'s share row. If design-system-v1's shell line is merging in the same window, chain-2 merges after chain-15, and the share-row edit becomes a no-op.

**Attended chains** (chain-4 and chain-5) need a device or simulator. The orchestrator runs them in the foreground; they are never dispatched to a background implementer. chain-4 runs as soon as chain-1 merges, so design D8's open device facts are settled before chain-2 relies on them.

Dependency graph:
- chain-1 → chain-2 → chain-3 → chain-5.
- chain-1 → chain-4, then chain-4 → chain-3 (the decision entry in 4.1 records the probe results).

## chain-1: engine-snapshot

- tasks: 1.1–1.5
- rationale: the `VACUUM INTO` snapshot, its contract types, both openers, its suite and its device probe all live in `src/host/storage-engine/`, and share the SqlExecutor/`_meta` vocabulary.
- files:
  - new `src/host/storage-engine/{copy-contract.ts,copy.ts,copy-node.ts,copy-device.ts,copy-device-acceptance.ts}`;
  - `src/host/storage-engine/index.ts` (export beside `deleteStorage`);
  - `src/host/storage-engine/test/acceptance.ts` and new copy test files;
  - `App.tsx` (the probe flag, default `false`, plus the probe screen).
- reads:
  - specs/app-data-copy/spec.md §"Copied data is a faithful snapshot of the whole store", §"A failed copy creates nothing and says so", §"Copying stays responsive and has no size cap";
  - design.md D1, D2 (the Durability paragraph), D6, D7, D8;
  - research.md §Current behavior 1–3, §Risks;
  - handoff: none.
- writes-contract: handoff/storage-copy.md. It covers:
  - the `CopyStorage`, `CopyReport` and `DataCopyError` signatures, verbatim;
  - `isSupersetSchema`;
  - the opener interface;
  - how the device and Node openers are constructed and imported (submodule paths, no barrel);
  - the error-kind mapping;
  - the guarantee that no destination file remains after a rejection.

## chain-2: launcher-copy-api

- tasks: 2.1–2.5
- rationale: the journal, the `StoreAccess` API change, the continuation seam, the launch sweep wiring, and their crash, schema and census suites all share `store-access.ts` and the launcher's file-backed Node harness.
- files:
  - new `src/host/launcher/data-copy-journal.ts`;
  - `src/host/launcher/{store-access.ts,build-lifecycle.ts,LauncherRoot.tsx}`;
  - `HomeScreen.tsx` (only if the share row still exists);
  - new launcher suites registered from `src/host/launcher/test/acceptance.ts`.
- reads:
  - specs/app-data-copy/spec.md §"The copy option is offered only behind the capability flag", §"A copy is all-or-nothing across crashes", §"Copied schema evolves independently with no identity reuse", §"Copies are fully independent after the copy";
  - specs/linked-apps/spec.md (both MODIFIED requirements);
  - specs/mini-app-storage/spec.md (MODIFIED requirement);
  - design.md D2, D3, D4, D5;
  - research.md §Current behavior 4–7, §Pattern census;
  - handoff: handoff/storage-copy.md.
- writes-contract: handoff/copy-api.md. It covers:
  - the `fork(entry, versionId?, { data })` and `continueSharingData(entry)` signatures;
  - `canCopyData` semantics;
  - which `DataCopyError` kinds reach the UI;
  - the guarantee that a rejected copy left no entry;
  - the busy-gating expectation, which is that callers use `runAppOp`.
- after: chain-1

## chain-3: launcher-question-ui

- tasks: 3.1–3.4, 4.1–4.2
- rationale: the question sheet, History's use of it, the busy and failure states and their copy keys all sit on design-system-v1's home and History screens and `copy.ts`. The two doc lines describe exactly what this chain makes visible.
- files:
  - `src/host/launcher/{HomeScreen.tsx,HistoryScreen.tsx,LauncherRoot.tsx,copy.ts}`, plus the shared question component chain-15 or chain-20 introduced (or a new `CopyQuestionSheet.tsx` if neither did);
  - the launcher UI suites;
  - `docs/decisions.md`, `docs/capabilities.md`.
- reads:
  - specs/app-data-copy/spec.md §"Making a copy asks whether to copy the data or start fresh", §"The copy option is offered only behind the capability flag", §"A failed copy creates nothing and says so", §"Copying stays responsive and has no size cap";
  - design.md D3, D5, D7, Open Questions 1–3;
  - `docs/design/system.md` §8 (glossary) and §9 (Your apps, History);
  - handoff: handoff/copy-api.md, plus design-system-v1's handoff/home.md and the History contract it records.
- writes-contract: none
- after: chain-2, chain-4, design-system-v1 chain-15 and chain-20 (merged on the staging branch)

## chain-4: device-probe — ATTENDED

- tasks: 5.1–5.2
- rationale: settles the facts design D8 and D2's durability note leave open (a second connection, `getDbPath`, output durability, the 50 MB time) on real Android and iOS runtimes, using chain-1's flag-gated probe.
- reads: design.md D2 (Durability), D7, D8; handoff: handoff/storage-copy.md
- writes-contract: none. The results are recorded in the change's `progress.md` and copied into 4.1's decision entry.
- after: chain-1

## chain-5: device-e2e — ATTENDED

- tasks: 5.3–5.5
- rationale: end-to-end acceptance of the shipped flow on both platforms, including killing the app mid-copy and the legacy shared-copy upgrade path.
- reads: specs/app-data-copy/spec.md (all); specs/linked-apps/spec.md §"Storage groups are host-mediated and decided at creation"; handoff: handoff/copy-api.md
- writes-contract: none
- after: chain-3
