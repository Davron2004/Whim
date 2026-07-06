# Context chains: storage-semantic-guards

Two chains, sequential, no cross-chain contract — the two subsystems share no files, types, or vocabulary, and neither consumes the other's outputs.

## chain-1: storage-engine json query guard

- tasks: 1.1, 1.2, 1.3, 1.4 (verbatim from tasks.md §1)
- rationale: one layer (storage engine), three files (`contract.ts`, `engine.ts`, `test/acceptance.ts`), one vocabulary (StorageErrorKind / compileWhere / accumulated schema)
- reads: `specs/mini-app-storage/spec.md` (this change's delta — the MODIFIED filter requirement + refusal scenario); research.md §ITEM ST-4 (current `isRangeFilter`/`compileWhere` shape, refusal house style with kind-string examples)
- reads-contracts: none
- writes-contract: none (no later chain consumes storage-engine outputs)

## chain-2: version-store lineage-scoped rollback + batch validation

- tasks: 2.1, 2.2, 2.3, 3.1, 3.2 (verbatim from tasks.md §2–3)
- rationale: one layer (version store), two files (`engine.ts`, `test/acceptance.ts`) plus the change-wide validation tasks, which belong in the last chain
- reads: `specs/mini-app-versioning/spec.md` (this change's delta — the MODIFIED rollback requirement + cross-lineage refusal scenario); research.md §ITEM ST-6 (current `rollback()` body, `isDescendent` signature/location, plain-Error examples, fork/switchLineage signatures); design.md D4–D6 (predicate direction, message vocabulary, check placement)
- reads-contracts: none
- writes-contract: none
