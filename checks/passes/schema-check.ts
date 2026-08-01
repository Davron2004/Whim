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
 * Runs only when `ctx.manifest?.schema` is set (manifest-extraction succeeded and a `schema`
 * field was present and statically resolved).
 */

import { Diagnostic, DiagnosticKind } from '../contract';
import { CheckContext, Pass, lineOf } from '../internal/scope';
import { resolveSchemaNode } from '../internal/manifest';
import { burnedIdFloor, diffSchemas, emptyApplied, validateArtifact } from '../../src/host/storage-engine/schema';
import type { AppliedSchema } from '../../src/host/storage-engine/schema';
import type { SchemaArtifact, StorageError } from '../../src/host/storage-engine/contract';

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
    for (const d of allocationFloorDiagnostics(ctx.appliedSchema, incoming, anchor)) ctx.report(d);
  }

  const applied = ctx.appliedSchema ?? emptyApplied();
  const diff = diffSchemas(applied, incoming);
  if (diff.kind === 'conflict') {
    for (const e of diff.errors) ctx.report(toDiagnostic(e, anchor));
  }
};
