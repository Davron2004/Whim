/**
 * static-check-pipeline — schema check (task 6.2, spec "The schema check reuses the storage
 * engine's pure functions"). Runs `validateArtifact` on the extracted `schema` literal,
 * surfacing its kinds verbatim (`invalid_artifact`/`malformed_id`/`id_reuse`/`bad_field_type`/
 * `bad_default`). If the artifact is structurally valid, runs `diffSchemas` against the
 * caller-supplied `appliedSchema` (or `emptyApplied()` when absent — first generation
 * validates shape only) and surfaces its conflict kinds verbatim
 * (`type_change`/`tombstone_violation`/`missing_default`), preserving the engine's hints.
 *
 * When an applied schema IS supplied (generation-loop chain 5, #52 D5), also enforces the
 * monotone allocation floor: within each collection present in the applied schema, any field ID
 * the candidate introduces must exceed the collection's burned-ID floor (`burnedIdFloor`, the
 * max ordinal across that collection's active AND retired columns). This is NOT redundant with
 * `diffSchemas` — reusing a never-allocated gap below the max (union has f1,f5; candidate adds
 * f3) reads as additive to a diff but still violates the allocation contract, so it needs its
 * own `id_below_floor` diagnostic. Collections absent from the applied schema have no floor.
 *
 * A supplied applied schema also enforces IDENTITY CONTINUITY (static-checks req "An edit
 * candidate keeps the applied schema's collections and fields", design D6): every collection ID
 * in the applied schema must still be declared, and every ACTIVE field ID inside it must be
 * declared or listed in that collection's own `tombstones`. Abandoning a burned ID does not
 * migrate the user's rows — it orphans them under an identity nothing reads any more — and
 * `diffSchemas` cannot see it, because an omission reads to the engine as a tolerable
 * `older-subset`. Already-RETIRED field IDs are exempt (they are already unread by design), and
 * a collection the candidate introduces is unconstrained. Generation-time only: the engine's
 * rollback tolerance is untouched, because a restore never passes through the checker.
 *
 * Runs only when `ctx.manifest?.schema` is set (manifest-extraction succeeded and a `schema`
 * field was present and statically resolved).
 */

import { Diagnostic, DiagnosticKind } from '../contract';
import { CheckContext, Pass, lineOf } from '../internal/scope';
import { resolveSchemaNode } from '../internal/manifest';
import { burnedIdFloor, diffSchemas, emptyApplied, validateArtifact } from '../../src/host/storage-engine/schema';
import type { AppliedSchema } from '../../src/host/storage-engine/schema';
import type { CollectionSpec, SchemaArtifact, StorageError } from '../../src/host/storage-engine/contract';

function toDiagnostic(e: StorageError, anchor: { line: number; column: number }): Diagnostic {
  const location = [e.collection, e.field].filter((x): x is string => !!x).join('.');
  const locationSuffix = location ? ` (${location})` : '';
  return {
    kind: e.kind as DiagnosticKind, // closed to the 8 validateArtifact/diffSchemas kinds — all in DIAGNOSTIC_KINDS
    severity: 'error',
    line: anchor.line,
    column: anchor.column,
    symbol: e.field ?? e.collection,
    message: `Schema ${e.kind}${locationSuffix}: ${e.hint}`,
    hint: e.hint,
  };
}

function idBelowFloorDiagnostic(
  collName: string,
  fieldName: string,
  fieldId: string,
  floor: number,
  anchor: { line: number; column: number },
): Diagnostic {
  const nextFree = `${fieldId.charAt(0)}${floor + 1}`;
  const hint = `Field ID "${fieldId}" is at or below the burned-ID floor for "${collName}" (max allocated ordinal ${floor}); use "${nextFree}" or a higher ordinal instead.`;
  return {
    kind: 'id_below_floor',
    severity: 'error',
    line: anchor.line,
    column: anchor.column,
    symbol: fieldId,
    message: `Schema id_below_floor (${collName}.${fieldName}): ${hint}`,
    hint,
  };
}

function identityDriftDiagnostic(
  location: string,
  abandonedId: string,
  hint: string,
  anchor: { line: number; column: number },
): Diagnostic {
  return {
    kind: 'schema_identity_drift',
    severity: 'error',
    line: anchor.line,
    column: anchor.column,
    symbol: abandonedId,
    message: `Schema schema_identity_drift (${location}): ${hint}`,
    hint,
  };
}

/** The burned IDs a candidate collection accounts for: the IDs of its declared fields plus the
 *  IDs it explicitly retires. A tombstoned ID is a deliberate goodbye, not drift. */
function accountedFieldIds(coll: CollectionSpec): Set<string> {
  const ids = new Set(Object.values(coll.fields).map((f) => f.id));
  for (const t of Array.isArray(coll.tombstones) ? coll.tombstones : []) ids.add(t);
  return ids;
}

/** Diagnoses every applied-schema collection ID the candidate stops declaring, and every ACTIVE
 *  field ID inside a still-declared collection that the candidate neither declares nor
 *  tombstones. Retired field IDs are exempt; collections only the candidate has are
 *  unconstrained (the applied schema is the whole of what the user's data occupies). */
function identityContinuityDiagnostics(
  applied: AppliedSchema,
  incoming: SchemaArtifact,
  anchor: { line: number; column: number },
): Diagnostic[] {
  const incomingByCollectionId = new Map(
    Object.entries(incoming.collections).map(([displayName, coll]) => [coll.id, { displayName, coll }]),
  );
  const diagnostics: Diagnostic[] = [];

  for (const appliedColl of applied.collections) {
    const candidate = incomingByCollectionId.get(appliedColl.id);
    if (!candidate) {
      diagnostics.push(
        identityDriftDiagnostic(
          appliedColl.id,
          appliedColl.id,
          `Collection ID "${appliedColl.id}" is in the applied schema but this artifact declares no collection with that ID; the user's existing rows live under "${appliedColl.id}", so keep that ID instead of allocating a new one.`,
          anchor,
        ),
      );
      continue;
    }
    const accounted = accountedFieldIds(candidate.coll);
    for (const active of appliedColl.active) {
      if (accounted.has(active.id)) continue;
      diagnostics.push(
        identityDriftDiagnostic(
          `${candidate.displayName}.${active.id}`,
          active.id,
          `Field ID "${active.id}" is active in collection "${appliedColl.id}" but this artifact neither declares nor tombstones it; the user's existing rows live under "${active.id}", so keep that ID — or list it in "${candidate.displayName}"'s \`tombstones\` if the field is genuinely retired.`,
          anchor,
        ),
      );
    }
  }
  return diagnostics;
}

/** Diagnoses every genuinely-new field ID (not already active or retired in the matching
 *  applied collection) whose ordinal falls at or below that collection's burned-ID floor. A
 *  candidate collection with no counterpart in `applied` is unconstrained — skipped entirely. */
function allocationFloorDiagnostics(
  applied: AppliedSchema,
  incoming: SchemaArtifact,
  anchor: { line: number; column: number },
): Diagnostic[] {
  const floors = burnedIdFloor(applied);
  const appliedById = new Map(applied.collections.map((c) => [c.id, c]));
  const diagnostics: Diagnostic[] = [];

  for (const [collName, coll] of Object.entries(incoming.collections)) {
    const appliedColl = appliedById.get(coll.id);
    if (!appliedColl) continue; // collection absent from the applied schema has no floor
    const floor = floors[coll.id];
    if (floor === undefined) continue; // matched collection burned no columns yet

    const burnedIds = new Set([...appliedColl.active, ...appliedColl.retired].map((c) => c.id));
    for (const [fieldName, field] of Object.entries(coll.fields)) {
      if (burnedIds.has(field.id)) continue; // not a new introduction (existing active/retired id)
      const ordinal = Number(field.id.slice(1));
      if (ordinal > floor) continue;
      diagnostics.push(idBelowFloorDiagnostic(collName, fieldName, field.id, floor, anchor));
    }
  }
  return diagnostics;
}

export const schemaCheckPass: Pass = (ctx: CheckContext) => {
  const manifest = ctx.manifest;
  if (manifest?.schema === undefined) return;
  const { sourceFile } = ctx;

  const schemaNode = resolveSchemaNode(sourceFile, ctx.manifestArgumentNode) ?? ctx.manifestArgumentNode ?? sourceFile;
  const anchor = lineOf(sourceFile, schemaNode);

  const artifactErrors = validateArtifact(manifest.schema);
  if (artifactErrors.length > 0) {
    for (const e of artifactErrors) ctx.report(toDiagnostic(e, anchor));
    return; // diffSchemas/floor check assume a structurally-valid incoming artifact
  }

  const incoming = manifest.schema as SchemaArtifact;

  if (ctx.appliedSchema) {
    for (const d of identityContinuityDiagnostics(ctx.appliedSchema, incoming, anchor)) ctx.report(d);
    for (const d of allocationFloorDiagnostics(ctx.appliedSchema, incoming, anchor)) ctx.report(d);
  }

  const applied = ctx.appliedSchema ?? emptyApplied();
  const diff = diffSchemas(applied, incoming);
  if (diff.kind === 'conflict') {
    for (const e of diff.errors) ctx.report(toDiagnostic(e, anchor));
  }
};
