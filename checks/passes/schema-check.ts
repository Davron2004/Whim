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
 * field was present and statically resolved) — with ONE exception: a candidate that declares no
 * `schema` field at all against a NON-EMPTY applied schema declares no collection, so identity
 * continuity fails for every collection the applied schema contains and each is reported before
 * the pass returns. Nothing else sees that omission: `diffSchemas` is never reached, and the
 * storage-continuity pass judges the locations the source NAMES, which a schema-less candidate
 * can go on naming exactly as before. A candidate that DOES declare a `schema` the extractor
 * could not resolve is left alone — `manifest_not_static` already fired, and the artifact might
 * well declare those collections.
 *
 * DECLARED FIELDS (`ctx.declaredFields`, decision #82): the fields a saved version declares that the
 * applied schema does not hold — a version delivered and never opened, or one a rollback left
 * behind. Their ids are burned and their types fixed, but no column exists. So they join the floor
 * (`burnedSchema`), a candidate that reuses one with another type is a `type_change`, and the diff
 * still runs against the applied schema alone: a candidate naming one is a new column there and
 * needs a default, exactly as it will on the device. Identity continuity ignores them (no rows live
 * under them). Folding them into the applied schema as retired columns would read a reuse as a
 * rollback across a tombstone and skip that default — the version would then refuse to open.
 */

import { Diagnostic, DiagnosticKind } from '../contract';
import { CheckContext, Pass, lineOf, type DeclaredField } from '../internal/scope';
import { getProperty, resolveSchemaNode } from '../internal/manifest';
import { burnedIdFloor, diffSchemas, emptyApplied, validateArtifact } from '../../src/host/storage-engine/schema';
import type { AppliedColumn, AppliedSchema } from '../../src/host/storage-engine/schema';
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

/** Identity continuity for a candidate with NO usable `schema`. Only an outright OMISSION is
 *  drift, and only against data that already exists: the manifest object must have been found
 *  (otherwise there is nothing to read an omission from) and must carry no `schema` property at
 *  all. Such a candidate declares none of the applied collections, so every one of them is
 *  abandoned. Collection-level only — with no artifact there is no per-collection `tombstones`
 *  list to account for a field, and naming the collection IDs is what tells the model where the
 *  user's rows already live. */
function reportMissingArtifactDrift(ctx: CheckContext, anchor: { line: number; column: number }): void {
  const applied = ctx.appliedSchema;
  if (!applied || applied.collections.length === 0) return;
  if (ctx.manifestArgumentNode === undefined) return;
  if (getProperty(ctx.manifestArgumentNode, 'schema') !== undefined) return;

  for (const coll of applied.collections) {
    ctx.report(
      identityDriftDiagnostic(
        coll.id,
        coll.id,
        `Collection ID "${coll.id}" is in the applied schema but this candidate declares no \`schema\` at all; the user's existing rows live under "${coll.id}", so ship a schema artifact that keeps that ID (and the field IDs inside it) rather than dropping it.`,
        anchor,
      ),
    );
  }
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

/**
 * The burned-id view of an edit: `applied` plus every declared field it does not hold, as a
 * RETIRED column (a collection only declared fields name is added with them alone). Retired is
 * the engine's word for "burned, type fixed, not required", so `burnedIdFloor` over this view is
 * the floor the pass enforces and the prompt states. Never a diff baseline: no column exists for
 * a declared field. `undefined` when there is no applied schema and nothing declared.
 */
export function burnedSchema(
  applied: AppliedSchema | undefined,
  declared: readonly DeclaredField[] | undefined,
): AppliedSchema | undefined {
  if (!declared || declared.length === 0) return applied;
  // Keyed lookups keep this linear in the request: it runs for the prompt and once per check
  // attempt, on the server's one event loop.
  const collections = (applied?.collections ?? []).map((c) => ({ id: c.id, active: [...c.active], retired: [...c.retired] }));
  const byId = new Map<string, { into: (typeof collections)[number]; held: Set<string> }>();
  for (const into of collections) {
    if (!byId.has(into.id)) byId.set(into.id, { into, held: new Set([...into.active, ...into.retired].map((c) => c.id)) });
  }
  for (const field of declared) {
    let target = byId.get(field.collection);
    if (!target) {
      target = { into: { id: field.collection, active: [], retired: [] }, held: new Set() };
      collections.push(target.into);
      byId.set(field.collection, target);
    }
    if (target.held.has(field.id)) continue;
    target.held.add(field.id);
    target.into.retired.push({ id: field.id, type: field.type as AppliedColumn['type'] });
  }
  return { collections };
}

/** A candidate field reusing a declared id with another type. Ids the applied schema holds are
 *  left to `diffSchemas`, which judges them against their real column. */
function declaredTypeDiagnostics(
  applied: AppliedSchema | undefined,
  declared: readonly DeclaredField[],
  incoming: SchemaArtifact,
  anchor: { line: number; column: number },
): Diagnostic[] {
  const held = new Set((applied?.collections ?? []).flatMap((c) => [...c.active, ...c.retired].map((f) => `${c.id}/${f.id}`)));
  const declaredTypes = new Map<string, Set<string>>();
  for (const d of declared) {
    const key = `${d.collection}/${d.id}`;
    declaredTypes.set(key, (declaredTypes.get(key) ?? new Set()).add(d.type));
  }
  const diagnostics: Diagnostic[] = [];
  for (const [collName, coll] of Object.entries(incoming.collections)) {
    for (const [fieldName, field] of Object.entries(coll.fields)) {
      const key = `${coll.id}/${field.id}`;
      const types = declaredTypes.get(key);
      if (held.has(key) || !types || [...types].every((t) => t === field.type)) continue;
      const declaredAs = [...types].filter((t) => t !== field.type).join('/');
      const hint = `Field "${fieldName}" in "${collName}" reuses ID "${field.id}", which a saved version declares as ${declaredAs}; a burned field's type is fixed — keep ${declaredAs} or mint a fresh ID above the floor.`;
      diagnostics.push({
        kind: 'type_change',
        severity: 'error',
        line: anchor.line,
        column: anchor.column,
        symbol: fieldName,
        message: `Schema type_change (${collName}.${fieldName}): ${hint}`,
        hint,
      });
    }
  }
  return diagnostics;
}

/** The rules only an edit turn's inputs switch on: identity continuity against the applied schema,
 *  the allocation floor over the burned-id view, and the declared fields' fixed types. */
function editTurnDiagnostics(ctx: CheckContext, incoming: SchemaArtifact, anchor: { line: number; column: number }): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  if (ctx.appliedSchema) diagnostics.push(...identityContinuityDiagnostics(ctx.appliedSchema, incoming, anchor));
  const burned = burnedSchema(ctx.appliedSchema, ctx.declaredFields);
  if (burned) diagnostics.push(...allocationFloorDiagnostics(burned, incoming, anchor));
  if (ctx.declaredFields) diagnostics.push(...declaredTypeDiagnostics(ctx.appliedSchema, ctx.declaredFields, incoming, anchor));
  return diagnostics;
}

export const schemaCheckPass: Pass = (ctx: CheckContext) => {
  const manifest = ctx.manifest;
  const { sourceFile } = ctx;

  const schemaNode = resolveSchemaNode(sourceFile, ctx.manifestArgumentNode) ?? ctx.manifestArgumentNode ?? sourceFile;
  const anchor = lineOf(sourceFile, schemaNode);

  if (manifest?.schema === undefined) {
    reportMissingArtifactDrift(ctx, anchor);
    return;
  }

  const artifactErrors = validateArtifact(manifest.schema);
  if (artifactErrors.length > 0) {
    for (const e of artifactErrors) ctx.report(toDiagnostic(e, anchor));
    return; // diffSchemas/floor check assume a structurally-valid incoming artifact
  }

  const incoming = manifest.schema as SchemaArtifact;
  for (const d of editTurnDiagnostics(ctx, incoming, anchor)) ctx.report(d);

  const applied = ctx.appliedSchema ?? emptyApplied();
  const diff = diffSchemas(applied, incoming);
  if (diff.kind === 'conflict') {
    for (const e of diff.errors) ctx.report(toDiagnostic(e, anchor));
  }
};
