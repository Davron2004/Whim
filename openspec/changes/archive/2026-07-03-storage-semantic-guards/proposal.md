# Proposal: storage-semantic-guards

## Why

Two data-integrity backstops from the 2026-07-02 critic sweep (ST-4, ST-6 — both reconciled alive at HEAD post-Sonar, see research.md) close silent-wrong-answer holes: the storage engine's `where` grammar silently misreads a json-field equality filter as a numeric range and returns wrong rows, and the version store's `rollback` will graft a cross-lineage snapshot onto the active branch with no check. Both are cheap engine-side refusals whose absence today produces wrong data with no error — the worst failure class for the two stores that hold user data.

## What Changes

- **Storage engine — json fields become non-queryable.** `records.list` refuses `where` or `orderBy` on a `json`-typed field with a new structured refusal (`unqueryable_field`, standard `{kind, collection, field, hint}` shape; hint directs the caller to filter on a scalar field or promote the queried value into its own field). **BREAKING** in the narrow grammar sense — a previously-accepted (and silently misinterpreted) filter now errors — but research.md confirms zero usage at HEAD: no fixture, test, or spec scenario filters a json field.
- **Version store — rollback is lineage-scoped.** `rollback` verifies the target snapshot lies on the active lineage's line (ancestor of, equal to, or descendant of the current tip) before moving the branch ref; a cross-lineage id is refused with an error naming `fork`/`switchLineage` (plain-`Error` house style, matching every existing version-store refusal). Roll-*forward* to a later snapshot stays legal — the existing spec scenario guarantees "generation 2 … can be returned to."
- Acceptance-suite coverage for both refusals and for the moves that must keep working (scalar range filters; roll-back then roll-forward).

## Capabilities

- **New Capabilities:** none.
- **Modified Capabilities:**
  - `mini-app-storage` — the "Reads can be filtered, ordered, and bounded host-side" requirement gains the json-field restriction and a refusal scenario.
  - `mini-app-versioning` — the "Rollback is non-destructive" requirement gains the lineage-scope qualifier and a cross-lineage refusal scenario.

## Impact

- `src/host/storage-engine/contract.ts` (new `StorageErrorKind` member + `WhereClause`/grammar doc note), `src/host/storage-engine/engine.ts` (`compileWhere`/orderBy compilation), `src/host/storage-engine/test/acceptance.ts`.
- `src/host/version-store/engine.ts` (`rollback`), `src/host/version-store/test/acceptance.ts`; new use of vendored isomorphic-git `isDescendent` (already exported, no new dependency).
- Bridge/SDK surfaces unchanged — the refusals travel through the existing structured-error path.
- No migration: pre-v1, no persisted data is affected; both changes are pure refusals of previously-undefined inputs.
