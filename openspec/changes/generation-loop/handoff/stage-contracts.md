# Contract: stage-contracts (chain 5 — checks-build-and-record)

The check/build stages and the app-record assembler that plug into `machine.ts`'s injected
`CheckStage`/`BuildStage` seams (design D2/D12, `handoff/pipeline-machine.md`), plus the two
additive kinds and the allocation-floor rule they implement.

## 1. `checks/contract.ts` — additive kinds

`DIAGNOSTIC_KINDS` gained exactly two entries, appended (never reordered/renumbered):
`id_below_floor` (schema pass: a new field ID at or below its collection's burned-ID floor) and
`build_failure` (build stage: a production-builder throw mapped to one error diagnostic). No
other file's exports changed shape.

## 2. `checks/passes/schema-check.ts` — the allocation floor (#52 D5)

When `ctx.appliedSchema` is supplied, after `validateArtifact` passes, every candidate collection
matched by burned ID to an applied collection is checked field-by-field: a field ID NOT already in
that applied collection's `active ∪ retired` set (i.e. genuinely new) whose ordinal is `<=` the
collection's `burnedIdFloor` value draws `id_below_floor` (`severity: 'error'`, `symbol` = the
offending burned field ID, `hint` names the next free ID as `${letter}${floor + 1}` using the
offending field's own ID prefix letter). Runs independently of, and in addition to, `diffSchemas` —
an artifact `diffSchemas` alone would call `additive` can still draw this. A collection with no
counterpart in `applied`, or one whose `burnedIdFloor` entry is absent, is unconstrained.

## 3. `server/src/generation/stages/check.ts`

```ts
export function createCheckStage(): CheckStage;                       // machine.ts's CheckStage
export function preflightSource(source: string | undefined): string | undefined;
```

- `createCheckStage()` wraps `checks/index.ts`'s `runStaticChecks(source, { appliedSchema })`
  (`ctx.appliedSchema` cast from the machine's `Record<string, unknown>` to the storage engine's
  structured `AppliedSchema` — the wire shape and the structured shape are the same JSON object,
  only typed more loosely on the wire). Diagnostics forward verbatim (kind/severity/line/symbol/
  message/hint); `report.manifest` (checker's `ExtractedManifest`), when present, maps to
  `CheckedManifest` by splitting off `name`/`schema` — `manifest.manifest` carries the rest
  (`initial`/`screens`/`capabilities`), and `manifest.schema` defaults to `{}` when the app
  declares no schema. `signal` is accepted (interface conformance) but unused — nothing to cancel
  in a synchronous AST walk.
- `preflightSource` treats a supplied source as absent unless it (a) has no `parse_error`
  diagnostic AND (b) declares a default-exported `defineApp({...})` — approximated as
  `report.manifest !== undefined || report.diagnostics.some(d => d.kind === 'manifest_not_static')`
  (the manifest-extraction pass's only two outcomes once a `defineApp` default export was found at
  all — a source with none produces neither, exactly a compiled bundle's shape). Returns `source`
  unchanged on success, `undefined` on failure, never throws. **Not wired into prompt assembly by
  this chain** — it is exported for the composition root (or a later chain) to apply to
  `GenerateRequest.app.source` before any prompt reads it.

## 4. `server/src/generation/stages/build.ts`

```ts
export function createBuildStage(): BuildStage;                        // machine.ts's BuildStage
```

One call into `synthrun`'s `buildCandidateSource` (the production-pinned esbuild contract). A
throw (esbuild's `BuildFailure`, or any other) is caught and mapped to exactly one
`{ kind: 'build_failure', severity: 'error', hint: <non-empty, actionable> }` diagnostic — never
propagated, never a second diagnostic. `signal` accepted for interface conformance; esbuild's
one-shot `build()` has no cancellation hook.

## 5. `server/src/generation/record.ts`

```ts
export function assembleRecord(source: string, manifest: CheckedManifest, build: BuildResult): WireAppRecord;
```

Pure assembly, ONE extraction (design D12): `name`/`manifest`/`schema` come only from the already-
extracted `CheckedManifest` (never re-parsed, never restated by the model); `bundle`/`sourceMap`
come only from `BuildResult`; `source` is passed through verbatim. Takes `CheckedManifest`
directly (not the full `CheckReport`) — a caller MUST already have applied `machine.ts`'s
errors-block gate (`diagnostics[].severity`, design D6) and narrowed `checkReport.manifest` to
defined before calling; this function carries no severity knob of its own and never inspects a
diagnostics array — the never-assemble-on-error invariant is the caller's (chain 6's `RunStage`),
enforced by the type signature requiring a plain `CheckedManifest`, not a `CheckReport`.

## Tests added (`server/test/stages.suite.ts`, not yet registered — chain 7's task 7.5)

Check-stage severity mapping (error/warning forwarded verbatim, manifest split correctly, a
schema-less app maps to `schema: {}`, the allocation floor threads through end to end);
`preflightSource` accepts real TS-with-`defineApp` and rejects `undefined`/compiled-bundle-
text/syntax-errors while still accepting a diagnostic-bearing-but-real `defineApp`; build-stage
success (byte-producing IIFE + source map) and an unresolvable-import failure mapping to
`build_failure`; `assembleRecord` sourcing every field from its inputs only, provably ignoring
prose embedded in `source`.

## Known gotcha for whoever wires `stages.suite.ts` into `server/test/acceptance.ts` (chain 7)

`server/test/run.mjs`'s esbuild call has neither `external: ['typescript']` (needed transitively
via `checks/index.ts`) nor `external: ['esbuild']` (needed transitively via `stages/build.ts` →
`synthrun/builder.ts`) — both are load-bearing once this suite is bundled in, or the bundle throws
`Dynamic require of "fs" is not supported` at import time (the same class of gotcha
`checks/test/run.mjs` already documents for `typescript`). Verified locally with a standalone
esbuild+Node runner outside the repo; `server/test/run.mjs` itself is out of this chain's file
scope.
