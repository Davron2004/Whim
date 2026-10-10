# Context chains: separate-shared-data

No chain edits a `CONFIG_SET` file. The new suite is registered from the launcher's own `acceptance.ts`, so `package.json` is untouched. Nothing here touches `invariants/`, the gate scripts, `.claude/**`, tsconfig, eslint or knip config, or `build/*`. **No HUMAN-BOOTSTRAP chain.**

**No ATTENDED chain.** The route this change names is already a device step of another change: copy-app-data task 5.5 installs an old build, makes a shared copy, installs the new build over it, copies the shared copy with "Copy the data" and deletes one of the pair. Tasks 1.1 and 1.2 are record logic with no device-only behaviour, and their tests run on real database files under Node.

**Cross-change ordering.**
- copy-app-data chain-2 (merged) supplies everything the tests call: `fork({ data })`, `continueSharingData`, the journal and the sweep. Its contracts are read, not changed.
- chain-1 comes after copy-app-data chain-3. Task 1.5 tests that chain's `hasSavedData`. Chain-3 also appends to `docs/decisions.md` and `docs/capabilities.md`, adds to `store-access.ts` (its task 3.0), and registers suites in `acceptance.ts`.
- chain-1 comes after design-system-v1 chain-22. Chains 17–22 own no file this chain edits except `src/host/launcher/test/acceptance.ts`, where chain-21 removes retired suites. Nothing waits on this change, so it takes the place after the shell line.
- **A request to copy-app-data's owner, to act on before chain-3 is dispatched:** task 3.0 should say that the saved-data check is asked of `engineAppId(entry)`, not `entry.id` (design.md D9). This change cannot edit that folder; task 1.5 is the backstop.
- Nothing in copy-app-data or design-system-v1 comes after this change.

Dependency graph: chain-1 only. Task 2.3 is a closure step for the orchestrator.

## chain-1: launcher-index-authority

- tasks: 1.1–1.5, 2.1–2.2
- rationale: two small changes to how the launcher writes an entry (`StoreAccess` re-reading the index, `AppIndex.put`'s write order), the one suite that pins them and the route on the launcher's file-backed harness, and the two doc lines that record what the suite proves. All of it shares the `storageGroupId`, `engineAppId` and index vocabulary.
- files:
  - `src/host/launcher/store-access.ts` (`update`, `fork`, `continueSharingData`, the new error);
  - `src/host/launcher/app-index.ts` (`put`);
  - new `src/host/launcher/test/shared-group.suite.ts`;
  - `src/host/launcher/test/acceptance.ts` (one registration);
  - existing launcher suites only where a fixture called `update`, `fork` or `continueSharingData` on an entry it never put in the index;
  - the saved-data call site chain-3 added, only if task 1.5 finds it asks about the wrong id;
  - `docs/decisions.md`, `docs/capabilities.md`.
- reads:
  - specs/linked-apps/spec.md, all three added requirements;
  - design.md D3 (the kill table), D4, D6, D8, D9;
  - research.md §Current behavior ("Delete", "`fork`/`copyData` order", "Journal", "Delete, soft-delete and Undo"), §Pattern census;
  - handoff: copy-app-data's `handoff/copy-api.md` (signatures of `fork`, `continueSharingData`, `sweepDataCopies`; the import rule for storage-engine submodules).
- writes-contract: none. No later chain consumes this one.
- after: copy-app-data chain-3; design-system-v1 chain-22 (both merged on the staging branch)

## Closure (orchestrator)

- task: 2.3
- Not a chain. It needs `gh` and the decision entry's number, so it runs after chain-1 merges.
