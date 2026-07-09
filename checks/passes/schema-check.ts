/**
 * static-check-pipeline — schema check (task 6.2, spec "The schema check reuses the storage
 * engine's pure functions"). Runs `validateArtifact` on the extracted `schema` literal,
 * surfacing its kinds verbatim (`invalid_artifact`/`malformed_id`/`id_reuse`/`bad_field_type`/
 * `bad_default`). If the artifact is structurally valid, runs `diffSchemas` against the
 * caller-supplied `appliedSchema` (or `emptyApplied()` when absent — first generation
 * validates shape only) and surfaces its conflict kinds verbatim
 * (`type_change`/`tombstone_violation`/`missing_default`), preserving the engine's hints.
 *
 * Runs only when `ctx.manifest?.schema` is set (manifest-extraction succeeded and a `schema`
 * field was present and statically resolved).
 */

import { Diagnostic, DiagnosticKind } from '../contract';
import { CheckContext, Pass, lineOf } from '../internal/scope';
import { resolveSchemaNode } from '../internal/manifest';
import { diffSchemas, emptyApplied, validateArtifact } from '../../src/host/storage-engine/schema';
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

export const schemaCheckPass: Pass = (ctx: CheckContext) => {
  const manifest = ctx.manifest;
  if (manifest?.schema === undefined) return;
  const { sourceFile } = ctx;

  const schemaNode = resolveSchemaNode(sourceFile, ctx.manifestArgumentNode) ?? ctx.manifestArgumentNode ?? sourceFile;
  const anchor = lineOf(sourceFile, schemaNode);

  const artifactErrors = validateArtifact(manifest.schema);
  if (artifactErrors.length > 0) {
    for (const e of artifactErrors) ctx.report(toDiagnostic(e, anchor));
    return; // diffSchemas assumes a structurally-valid incoming artifact
  }

  const applied = ctx.appliedSchema ?? emptyApplied();
  const diff = diffSchemas(applied, manifest.schema as SchemaArtifact);
  if (diff.kind === 'conflict') {
    for (const e of diff.errors) ctx.report(toDiagnostic(e, anchor));
  }
};
