/**
 * Schema validation + evolution diff (Decision #40, D3/D4). Both exported as PURE
 * functions with no engine/SQL dependency, so the future generation harness can run them
 * as static checks at generation time — before any device is involved (#38 rules 1–3 as
 * code, the proposal's core obligation).
 *
 * The applied-schema model — a design clarification worth stating outright. D3 speaks of
 * `_meta` holding "the last-applied artifact". What `_meta` actually holds is the
 * ACCUMULATED applied schema: the union of every column ever physically created, which —
 * because evolution is additive-only and the engine never DROPs — only ever grows. This
 * is what makes the rollback/roll-forward retention scenario lossless: re-opening an older
 * artifact is an `older-subset` no-op (the omitted columns stay), and rolling forward
 * again is `identical` (the columns already exist) rather than a doomed re-`ADD COLUMN`.
 * A tombstoned field keeps its physical column (we remember its type in `retired`) so an
 * ID can never be re-`ADD`ed and a same-typed re-appearance (rollback across a tombstone)
 * is distinguishable from repurposing a retired ID for a different field (a violation).
 */

import {
  BURNED_ID_RE,
  CollectionSpec,
  FIELD_TYPES,
  FieldType,
  JsonValue,
  SchemaArtifact,
  StorageError,
} from './contract';
import { checkValue } from './marshal';

// ─────────────────────────────────────────────────────────────────────────────
// Accumulated applied schema (the `_meta` form) — keyed by burned ID, monotonic
// ─────────────────────────────────────────────────────────────────────────────

export interface AppliedColumn {
  id: string;
  type: FieldType;
}

export interface AppliedCollection {
  id: string;
  /** Currently-readable columns. */
  active: AppliedColumn[];
  /** Tombstoned columns: physically present, ID retired forever, type remembered. */
  retired: AppliedColumn[];
}

export interface AppliedSchema {
  collections: AppliedCollection[];
}

export function emptyApplied(): AppliedSchema {
  return { collections: [] };
}

// ─────────────────────────────────────────────────────────────────────────────
// DDL plan + diff result (D4)
// ─────────────────────────────────────────────────────────────────────────────

export interface PlanColumn {
  id: string;
  type: FieldType;
  default?: JsonValue;
}

export interface CreateTablePlan {
  collectionId: string;
  columns: PlanColumn[];
}

export interface AddColumnPlan {
  collectionId: string;
  /** A post-creation field always carries a default (enforced by the diff). */
  column: { id: string; type: FieldType; default: JsonValue };
}

export interface DdlPlan {
  creates: CreateTablePlan[];
  adds: AddColumnPlan[];
}

export type SchemaDiff =
  | { kind: 'identical'; nextApplied: AppliedSchema }
  | { kind: 'additive'; plan: DdlPlan; nextApplied: AppliedSchema }
  | { kind: 'older-subset'; nextApplied: AppliedSchema }
  | { kind: 'conflict'; errors: StorageError[] };

// ─────────────────────────────────────────────────────────────────────────────
// validateArtifact — shape, the closed six-type set, defaults, burned-ID form
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validate a schema artifact in isolation (no applied context). Returns every problem
 * found (empty array = valid). Post-creation default requirements are NOT checked here —
 * that needs the applied schema and is a `missing_default` conflict from `diffSchemas`.
 */
export function validateArtifact(artifact: unknown): StorageError[] { // NOSONAR - schema validation is deliberately exhaustive and branch-heavy.
  const errors: StorageError[] = [];
  if (!isObject(artifact)) {
    return [{ kind: 'invalid_artifact', hint: 'Schema artifact must be an object.' }];
  }
  const art = artifact as unknown as SchemaArtifact;
  if (art.schemaVersion !== 1) {
    errors.push({ kind: 'invalid_artifact', hint: 'Schema artifact must declare schemaVersion: 1.' });
  }
  const collections = art.collections;
  if (!isObject(collections)) {
    errors.push({ kind: 'invalid_artifact', hint: 'Schema artifact must have a `collections` object.' });
    return errors;
  }

  const seenCollectionIds = new Set<string>();
  for (const [collName, coll] of Object.entries(collections)) {
    if (collName === 'id') {
      errors.push({ kind: 'invalid_artifact', collection: collName, hint: 'Collection display name "id" is reserved for the engine-assigned primary key; choose a different name.' });
      continue;
    }
    if (!isObject(coll) || !isObject((coll as CollectionSpec).fields)) {
      errors.push({ kind: 'invalid_artifact', collection: collName, hint: `Collection "${collName}" must have an \`id\` and a \`fields\` object.` });
      continue;
    }
    const c = coll as CollectionSpec;
    if (!BURNED_ID_RE.test(c.id)) {
      errors.push({ kind: 'malformed_id', collection: collName, hint: `Collection "${collName}" has a malformed ID "${c.id}"; burned IDs are a lowercase letter then digits (e.g. c1).` });
    }
    if (seenCollectionIds.has(c.id)) {
      errors.push({ kind: 'id_reuse', collection: collName, hint: `Collection ID "${c.id}" is used by more than one collection; each needs a unique burned ID.` });
    }
    seenCollectionIds.add(c.id);

    const tombstones = Array.isArray(c.tombstones) ? c.tombstones : [];
    if (!Array.isArray(c.tombstones)) {
      errors.push({ kind: 'invalid_artifact', collection: collName, hint: `Collection "${collName}" must have a \`tombstones\` array (use [] if none).` });
    }
    const tombstoneSet = new Set(tombstones);
    for (const tid of tombstones) {
      if (!BURNED_ID_RE.test(tid)) {
        errors.push({ kind: 'malformed_id', collection: collName, hint: `Tombstone ID "${tid}" in "${collName}" is malformed.` });
      }
    }

    const seenFieldIds = new Set<string>();
    for (const [fieldName, field] of Object.entries(c.fields)) {
      if (fieldName === 'id') {
        errors.push({ kind: 'invalid_artifact', collection: collName, field: fieldName, hint: 'Field display name "id" is reserved for the engine-assigned primary key; choose a different name.' });
        continue;
      }
      if (!isObject(field)) {
        errors.push({ kind: 'invalid_artifact', collection: collName, field: fieldName, hint: `Field "${fieldName}" in "${collName}" must be an object.` });
        continue;
      }
      const f = field;
      if (!BURNED_ID_RE.test(f.id)) {
        errors.push({ kind: 'malformed_id', collection: collName, field: fieldName, hint: `Field "${fieldName}" in "${collName}" has a malformed ID "${f.id}"; burned IDs are a lowercase letter then digits (e.g. f1).` });
      }
      if (seenFieldIds.has(f.id)) {
        errors.push({ kind: 'id_reuse', collection: collName, field: fieldName, hint: `Field ID "${f.id}" is used by more than one field in "${collName}".` });
      }
      seenFieldIds.add(f.id);
      if (tombstoneSet.has(f.id)) {
        errors.push({ kind: 'id_reuse', collection: collName, field: fieldName, hint: `Field ID "${f.id}" in "${collName}" is both active and tombstoned; a retired ID cannot be active.` });
      }
      if (!FIELD_TYPES.includes(f.type)) {
        errors.push({ kind: 'bad_field_type', collection: collName, field: fieldName, hint: `Field "${fieldName}" in "${collName}" has unknown type "${String(f.type)}"; use one of ${FIELD_TYPES.join('/')}.` });
      } else if (f.default !== undefined) {
        const reason = checkValue(f.type, f.default);
        if (reason) {
          errors.push({ kind: 'bad_default', collection: collName, field: fieldName, hint: `Default for "${fieldName}" in "${collName}" is invalid: ${reason}.` });
        }
      }
    }
  }
  return errors;
}

// ─────────────────────────────────────────────────────────────────────────────
// diffSchemas — classify into the four D4 classes; derive the DDL plan
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Diff an incoming (assumed-valid) artifact against the accumulated applied schema.
 * Lands in exactly one of: identical, additive (with a CREATE/ADD-only plan), older-subset
 * (rollback — zero DDL), or conflict (the four reject kinds, each with a fix hint).
 */
export function diffSchemas(applied: AppliedSchema, incoming: SchemaArtifact): SchemaDiff { // NOSONAR - schema diff classification is intentionally centralized for invariant coverage.
  const errors: StorageError[] = [];
  const creates: CreateTablePlan[] = [];
  const adds: AddColumnPlan[] = [];
  let changed = false; // a non-additive, zero-DDL change (omission / tombstone / resurrection)

  const next = cloneApplied(applied);
  const nextById = new Map(next.collections.map(c => [c.id, c]));
  const appliedById = new Map(applied.collections.map(c => [c.id, c]));

  for (const [collName, coll] of Object.entries(incoming.collections)) {
    const aColl = appliedById.get(coll.id);

    if (!aColl) {
      // Brand-new collection → one CREATE TABLE with all declared fields (no default needed:
      // there are no existing rows to read forgivingly).
      const columns: PlanColumn[] = Object.values(coll.fields).map(f => ({ id: f.id, type: f.type, default: f.default }));
      creates.push({ collectionId: coll.id, columns });
      const nextColl: AppliedCollection = {
        id: coll.id,
        active: Object.values(coll.fields).map(f => ({ id: f.id, type: f.type })),
        retired: [],
      };
      next.collections.push(nextColl);
      nextById.set(coll.id, nextColl);
      continue;
    }

    const nextColl = nextById.get(coll.id)!;
    const activeById = new Map(aColl.active.map(c => [c.id, c]));
    const retiredById = new Map(aColl.retired.map(c => [c.id, c]));
    const incomingTombstones = new Set(coll.tombstones);

    for (const [fieldName, f] of Object.entries(coll.fields)) {
      if (incomingTombstones.has(f.id)) continue; // contradiction caught by validateArtifact

      const activeCol = activeById.get(f.id);
      const retiredCol = retiredById.get(f.id);

      if (activeCol) {
        if (activeCol.type !== f.type) {
          errors.push({ kind: 'type_change', collection: collName, field: fieldName, hint: `Field "${fieldName}" in "${collName}" changed type ${activeCol.type}→${f.type}; a burned field's type is fixed — add a new field instead.` });
        }
        // same id + same type, possibly a different display name = rename → no DDL.
      } else if (retiredCol) {
        if (retiredCol.type === f.type) {
          // Rollback across a tombstone: the SAME field re-appears (same id, same type).
          // The column exists — no DDL — and it returns to active.
          moveColumn(nextColl, 'retired', 'active', f.id);
          changed = true;
        } else {
          errors.push({ kind: 'tombstone_violation', collection: collName, field: fieldName, hint: `Field "${fieldName}" in "${collName}" reuses retired ID "${f.id}"; mint a fresh ID for a new field — retired IDs are never reused.` });
        }
      } else if (f.default === undefined) {
        // Truly new field on an existing collection → a default is required (forgiving reads).
        errors.push({ kind: 'missing_default', collection: collName, field: fieldName, hint: `New field "${fieldName}" in "${collName}" needs a default so existing rows can be read.` });
      } else {
        adds.push({ collectionId: coll.id, column: { id: f.id, type: f.type, default: f.default } });
        nextColl.active.push({ id: f.id, type: f.type });
      }
    }

    // Apply incoming tombstones: move any still-active column to retired (data retained).
    for (const tid of incomingTombstones) {
      if (nextColl.active.some(c => c.id === tid)) {
        moveColumn(nextColl, 'active', 'retired', tid);
        changed = true;
      }
    }

    // Omission: an applied-active field the incoming artifact no longer mentions (rollback to
    // older code). Retained untouched (no DDL); this is what makes older code lossless.
    const incomingActiveIds = new Set(Object.values(coll.fields).map(f => f.id));
    for (const ac of aColl.active) {
      if (!incomingActiveIds.has(ac.id)) changed = true;
    }
  }

  // Whole collections the incoming artifact omits are likewise retained.
  const incomingCollIds = new Set(Object.values(incoming.collections).map(c => c.id));
  for (const ac of applied.collections) {
    if (!incomingCollIds.has(ac.id)) changed = true;
  }

  if (errors.length) return { kind: 'conflict', errors };
  if (creates.length || adds.length) return { kind: 'additive', plan: { creates, adds }, nextApplied: next };
  if (changed) return { kind: 'older-subset', nextApplied: next };
  return { kind: 'identical', nextApplied: next };
}

// ─────────────────────────────────────────────────────────────────────────────
// helpers
// ─────────────────────────────────────────────────────────────────────────────

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function cloneApplied(a: AppliedSchema): AppliedSchema {
  return { collections: a.collections.map(c => ({ id: c.id, active: c.active.map(x => ({ ...x })), retired: c.retired.map(x => ({ ...x })) })) };
}

function moveColumn(coll: AppliedCollection, from: 'active' | 'retired', to: 'active' | 'retired', id: string): void {
  const idx = coll[from].findIndex(c => c.id === id);
  if (idx < 0) return;
  const [col] = coll[from].splice(idx, 1);
  coll[to].push(col);
}
