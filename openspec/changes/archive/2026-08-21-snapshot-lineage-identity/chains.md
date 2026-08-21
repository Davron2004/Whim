# Context chains: snapshot-lineage-identity

## chain-1: engine-lineage-correctness

- tasks: 1.1, 2.1–2.2, 3.1–3.2
- rationale: one file/layer — version-store `engine.ts` (+ `index.ts`) and the vstore acceptance suite. The stamp write/strip (2.x) and the lineage-correct predicate (3.x) share the same `lineageOf` mechanism and test fixtures, and BOTH edit `engine.ts`, so they must live in one chain (splitting a single file across chains guarantees merge conflicts).
- reads: specs/mini-app-versioning/spec.md (ADDED: Version enumeration and restore are lineage-correct); design.md D1–D5; research.md (Current behavior, Constraints and invariants)
- writes-contract: handoff/lineage-correctness.md (post-fix invariants: `timeline`/`rollback` are lineage-correct including the non-diverged fork and the original-rolled-back-past-a-fork-point cases; the `Snapshot` shape and `StoreAccess.timeline`/`history` signatures are unchanged; the lineage stamp never surfaces in `prompt`/errors — so the launcher's interim fork guard is safe to remove)

## chain-2: retire-ui-guard

- tasks: 4.1
- rationale: the launcher layer only (`src/host/launcher/history-logic.ts` + its launcher suite). Removes `version-history-ux`'s interim `history()`-for-forks guard now that `timeline` is lineage-correct; touches no engine files, so no overlap with chain-1.
- reads: design.md D6; handoff: handoff/lineage-correctness.md
- writes-contract: none
- after: chain-1

## chain-3: docs-decision

- tasks: 5.1
- rationale: docs-only append to `docs/decisions.md` (new decision + the decision-#48 correction), written after the as-built surface exists.
- reads: design.md (Decisions); handoff: handoff/lineage-correctness.md
- writes-contract: none
- after: chain-2

Task 5.2 (on-device acceptance) is attended and human-run — not dispatched to an implementer; it closes the change after chain-3 merges, like `version-history-ux`'s task 5.2.
