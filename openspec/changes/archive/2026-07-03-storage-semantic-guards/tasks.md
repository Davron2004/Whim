# Tasks: storage-semantic-guards

## 1. Storage engine: json fields are non-queryable

- [x] 1.1 Add `unqueryable_field` to the `StorageErrorKind` union in `src/host/storage-engine/contract.ts`, with a grammar doc note on `WhereClause`/`ListQuery` stating json-typed fields are opaque and not accepted in `where`/`orderBy`
- [x] 1.2 In the where-compilation path in `src/host/storage-engine/engine.ts`, resolve each `where` field's declared type (same resolution point that raises `unknown_field`) and refuse json-typed fields with `storageError({kind: 'unqueryable_field', collection, field, hint})` BEFORE `isRangeFilter` can misread the condition; no SQL is built for a refused query
- [x] 1.3 Apply the same refusal to `orderBy` naming a json-typed field
- [x] 1.4 Acceptance tests in `src/host/storage-engine/test/acceptance.ts`: (a) `where` on a json field whose value carries `gt`-shaped keys is refused with kind/collection/field asserted and storage unchanged; (b) `orderBy` on a json field is refused; (c) existing scalar equality + range filters still pass unchanged

## 2. Version store: rollback is lineage-scoped

- [x] 2.1 Add a same-line predicate helper in `src/host/version-store/engine.ts` using vendored isomorphic-git `isDescendent`: target === tip, or target is ancestor of tip, or tip is ancestor of target
- [x] 2.2 Wire the predicate into `rollback()` after `resolveSnap` and before `writeRef`; on failure throw a plain `Error` whose message says the snapshot is not in the active lineage and names `fork`/`switchLineage` — no git vocabulary (no "commit"/"ref"/"branch"/"ancestor")
- [x] 2.3 Acceptance tests in `src/host/version-store/test/acceptance.ts`: (a) fork an app, then `rollback` on the original lineage with a fork-created snapshot id → refused, and the original's active snapshot + bundle are unchanged; (b) roll back to generation 1 then roll forward to generation 2 → both succeed; (c) rollback to the current tip succeeds

## 3. Validation

- [x] 3.1 `npm run storage:test` and `npm run vstore:test` green; `./scripts/gate.sh` green
- [x] 3.2 `openspec validate storage-semantic-guards --strict` green
