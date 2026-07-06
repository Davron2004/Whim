# Design: storage-semantic-guards

## Context

Two critic findings (ST-4, ST-6 in `openspec/critic/2026-07-02-product-sweep.md`), both reconciled alive at HEAD after the dev/v1→main merge and Sonar sweep (research.md, "Sonar-sweep touch summary"). Both are silent-wrong-answer defects in the two stores that hold user data: the storage engine's range-filter discriminator misreads json equality values (`isRangeFilter` at `engine.ts:316-319` keys on the mere presence of `gt/gte/lt/lte` — research.md ST-4), and `rollback` force-writes the branch ref to any resolvable snapshot oid with no lineage check (`engine.ts:285-293` — research.md ST-6). Constraints: the storage engine has a closed structured-error union (`StorageErrorKind`) and a house refusal shape `{kind, collection?, field?, hint}`; the version store's error surface is bare `Error` throws and its spec forbids git vocabulary from ever reaching the user surface.

## Goals / Non-Goals

**Goals:** engine-side refusals for both holes; acceptance coverage for the refusals and for the neighboring moves that must keep working (scalar filters, roll-back-then-roll-forward).

**Non-Goals:** ST-2 (ref packing/compaction) — separate change; HL-4, RT-1 — different subsystems; any new query capability for json fields (deep-path filters etc.); a structured error class for the version store; lineage-membership metadata on snapshots (see D4 residual).

## Decisions

**D1 — Forbid `where` on json-typed fields rather than disambiguate the grammar.** Alternative considered: an explicit range discriminator (`{$range: {...}}`). Rejected because equality filtering on json is already semantically broken independent of the ambiguity — json values are stored serialized, so "equality" is string comparison of serializations, where key order changes the answer. `$range` would churn the grammar (and every future generated app's mental model) to preserve a capability that never worked. Research.md confirms zero usage at HEAD (no fixture, acceptance scenario, or spec scenario filters a json field), so the restriction is free today and the structured hint teaches the future generator the right pattern (promote the queried value into its own scalar field). This also matches the engine's philosophy: the closed six-type field set exists so the queryable types are boring scalars.

**D2 — `orderBy` on json is refused too.** Ordering by serialized JSON text is deterministic but meaningless (lexicographic over serialization). Leaving it legal while `where` refuses would be a half-closed surface; the check is the same one-line type lookup.

**D3 — Refusal kind `unqueryable_field`, standard shape.** Slots into the closed `StorageErrorKind` union beside `unknown_field`/`type_mismatch` (research.md house style), with `collection`, `field`, and a hint of the form: json fields are opaque and cannot be used in `where`/`orderBy`; filter on a scalar field or declare the value you need to query as its own field. The check runs during query compilation, before any SQL is built — a refused query executes no SQL (consistent with the existing injection-guard requirement's "no SQL is executed with that name" posture).

**D4 — Rollback guard is a "same line" ancestry predicate, not full lineage membership.** Predicate: target oid `===` current tip, or target is an ancestor of tip (roll back), or tip is an ancestor of target (roll forward) — via the vendored isomorphic-git `isDescendent` run in both directions (research.md: exported at `index.d.ts:1875-1883`, currently unused in the codebase). Ancestor-only was rejected because the existing spec scenario guarantees generation 2 "can be returned to" after rolling back to generation 1 — roll-forward is a spec-level move. Full lineage membership (knowing which branch a snapshot was *created* on) was rejected for now: git records no such fact intrinsically, so it would require stamping lineage metadata into snapshots — a bigger change with a migration story, not warranted by the threat. **Residual corner, accepted and documented:** if the active lineage is currently rolled back to at-or-before a fork point, a fork-lineage snapshot (a descendant of the tip) would pass the line check. Reaching it requires hand-passing a foreign id while rolled back past the fork point — callers only surface ids from the active lineage's own `history()` — and the full fix is the lineage-metadata design above, deferred until lineage stamping exists for some other reason.

**D5 — Version-store refusal follows the plain-`Error` house style.** Research.md: every existing version-store error is a bare `throw new Error(msg)` (`unknown snapshot: ...`, `invalid pin label: ...`). Importing storage-engine's structured class into a subsystem with zero structured errors is scope creep. Message vocabulary is product-verbs only per the "Git is never exposed" requirement: it says the snapshot "is not in the active lineage" and names `fork`/`switchLineage` — never "ancestor", "commit", "ref", or "branch".

**D6 — Check placement in `rollback`.** After `resolveSnap` (so unknown ids keep their existing `unknown snapshot` error) and before `writeRef` (a refused rollback changes nothing — ref, checkout, and working state untouched, asserted in the acceptance test).

## Risks / Trade-offs

- [`isDescendent` walks history O(depth) per rollback] → rollback is a rare, user-deliberate verb; depth = lifetime generation count; well inside the "feels interactive" budget. If ST-2's ref-growth work later adds indexes, this can ride them.
- [D4's residual fork-point corner] → documented above; blocked in every path the product actually exposes.
- [A future generated app tries to filter json and hits the refusal] → that is the mechanism working: the hint is machine-actionable (D8-style), and the generation harness learns the promote-to-field pattern instead of silently getting wrong rows.
- [Type lookup for D1/D2 must resolve the field's declared type during compilation] → the engine already resolves display-field names against the accumulated schema to raise `unknown_field`; the json check uses the same resolution point, no new schema plumbing.

## Migration Plan

None. Pre-v1, both changes are pure refusals of previously-undefined inputs; no persisted data or wire shape changes. Deploy = merge behind the standard gate; rollback = revert the merge commit.

## Open Questions

None blocking. HL-4's handler-side generation fence and ST-2's packed-refs writer were deliberately excluded (Non-Goals) and are tracked in the 2026-07-02 sweep report.
