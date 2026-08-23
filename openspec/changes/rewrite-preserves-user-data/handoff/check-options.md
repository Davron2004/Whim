# handoff: check-options (chain-2 → chain-3)

Interface only. Source of truth: `checks/index.ts`, `checks/internal/scope.ts`,
`checks/passes/schema-check.ts`, `checks/passes/storage-continuity.ts`.

## Public entry (widened)

```ts
import { runStaticChecks, scanStorageSurface } from 'checks/index';

export function runStaticChecks(
  source: string,
  opts?: {
    appliedSchema?: AppliedSchema;      // src/host/storage-engine/schema (unchanged)
    previousSurface?: StorageSurface;   // NEW — checks/storage-surface
    filename?: string;
  },
): CheckReport;
```

`previousSurface` is the surface of the source THIS CANDIDATE REPLACES, produced by
`scanStorageSurface(previousSource)` — never hand-built, never re-derived (one scanner, two
consumers). Both edit-turn inputs are optional and independent: pass `appliedSchema` alone and
only identity continuity runs; pass `previousSurface` alone and only surface continuity runs.

`CheckContext` (`checks/internal/scope.ts`) gains the matching field, and `buildContext` gains a
fifth, optional positional parameter:

```ts
export interface CheckContext {
  // …existing fields…
  appliedSchema?: AppliedSchema;
  previousSurface?: StorageSurface;
}

export function buildContext(
  source: string,
  sourceFile: ts.SourceFile,
  report: (d: Diagnostic) => void,
  appliedSchema: AppliedSchema | undefined,
  previousSurface?: StorageSurface,
): CheckContext;
```

`storageContinuityPass` is registered LAST in `checks/index.ts`'s `PASSES`; the identity rule
lives inside the existing `schemaCheckPass`, reusing the `appliedSchema` plumbing the burned-ID
floor already had. Neither is a new caller-visible entry point.

## Diagnostics emitted

| kind | severity | symbol | anchor |
| --- | --- | --- | --- |
| `schema_identity_drift` | error | the abandoned burned ID (`c1`, `f1`) | the manifest's `schema` node |
| `storage_surface_drift` | error | the missing location's literal name | the candidate's first token |
| `storage_surface_dynamic` | warning | `storage.<facade>.<method>` | the offending ARGUMENT |

Shapes (`message`/`hint` wording is not contractual; the `kind`/`severity`/`symbol`/anchor
columns above are):

```ts
{ kind: 'schema_identity_drift', severity: 'error', symbol: 'f1',
  message: 'Schema schema_identity_drift (Notes.f1): …',
  hint: 'Field ID "f1" is active in collection "c1" but this artifact neither declares nor '
      + 'tombstones it; the user\'s existing rows live under "f1", …' }

{ kind: 'storage_surface_drift', severity: 'error', symbol: 'habitCompletionHistory',
  message: 'The previous version read the kv key "habitCompletionHistory"; this one does not.',
  hint: 'Keep reading the kv key "habitCompletionHistory" — the user\'s existing data lives '
      + 'there; a storage.kv call under a different name starts from empty.' }

{ kind: 'storage_surface_dynamic', severity: 'warning', symbol: 'storage.kv.get',
  message: 'The argument to `storage.kv.get` is not a string literal, …',
  hint: 'Pass a string literal to `storage.kv.get` so the key it reads can be checked …' }
```

## Invariants a caller must not assume away

- **Both rules are OPT-IN by input.** No `appliedSchema` ⇒ no `schema_identity_drift`; no
  `previousSurface` ⇒ neither surface kind, INCLUDING the warning. A first generation is
  unconstrained, so passing `undefined` is how a caller says "new app", never a bug.
- **Superset, never equality.** A candidate may add kv keys and collections freely; only a
  location it stops naming is drift.
- **Suppression is per facade.** A non-literal argument suppresses `storage_surface_drift` for
  `kv` or `records` — whichever facade the call belonged to — and never for both.
- **`ok` is unchanged**: `diagnostics.length === 0`, any severity. A lone
  `storage_surface_dynamic` warning still fails the report, so the check stage still gates.
- **Per-field identity continuity only runs when the candidate SHIPS a schema literal** (the
  schema pass's standing precondition) and only after `validateArtifact` comes back clean. The
  one exception is an OUTRIGHT OMISSION: a candidate declaring no `schema` field at all, against
  a non-empty applied schema, declares no collection, so the rule fires once per applied
  collection id (collection level only — there is no artifact to carry a `tombstones` list). A
  `schema` that is present but not statically resolvable is left to `manifest_not_static`.
  `storage_surface_drift` does NOT cover any of this: it judges the locations the candidate
  NAMES, and a schema-less candidate can go on naming every one of them.
- **A retired field ID is exempt; a tombstoned one is accounted for.** The candidate satisfies an
  active applied ID by declaring it OR by listing it in that collection's own `tombstones`.
- **The scanner's aliased-facade blind spot points the safe way.** An uncollected read in the
  previous source is a location this pass never demands — a missed guarantee, never a false
  accusation. Do not "fix" it by widening the demand side.
