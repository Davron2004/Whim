/**
 * mini-app-storage-engine — the shared contract (Decision #40, D8).
 *
 * This file is the inter-change SEAM. It declares the schema-artifact format, the verb
 * param/result types, the `where`/`orderBy` filter grammar, and the structured-error
 * shape. The follow-up `capability-bridge` change imports these types VERBATIM for its
 * registry rows and `vc-sdk` client stubs — the protocol-shaped decisions are made once,
 * here, and treated as read-mostly after the bridge lands (breaking them touches both
 * changes). Keep this file dependency-free: types + small const tables only, no engine
 * logic, so the bridge can import it without pulling in `node:sqlite`/op-sqlite.
 */

// ─────────────────────────────────────────────────────────────────────────────
// JSON value universe (what crosses the bridge as a field value or KV scalar)
// ─────────────────────────────────────────────────────────────────────────────

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

// ─────────────────────────────────────────────────────────────────────────────
// Schema artifact (D3) — the declared shape of a generation's storage
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The closed six-type set (D3). There is deliberately no undifferentiated `number`: a
 * count (`int`) and a price (`float`) are different declarations, so the prompt-time
 * choice is never ambiguous.
 *
 *   text  → SQLite TEXT
 *   int   → INTEGER, write-validated to the JS safe-integer range
 *   float → REAL (8-byte IEEE-754 double, end to end)
 *   bool  → INTEGER 0/1
 *   date  → INTEGER epoch-milliseconds
 *   json  → TEXT (JSON-serialized) — the one escape hatch for amorphous values
 */
export type FieldType = 'text' | 'int' | 'float' | 'bool' | 'date' | 'json';

export const FIELD_TYPES: readonly FieldType[] = ['text', 'int', 'float', 'bool', 'date', 'json'];

export interface FieldSpec {
  /** Burned field ID, e.g. 'f1' — IS the physical column name. Never reused once retired. */
  id: string;
  type: FieldType;
  /** REQUIRED for fields added after their collection was first created (forgiving reads). */
  default?: JsonValue;
}

export interface CollectionSpec {
  /** Burned collection ID, e.g. 'c1' — IS the physical table name. */
  id: string;
  /** Keyed by display name; the display name is the alias, the `id` is the identity. */
  fields: { [displayName: string]: FieldSpec };
  /** Retired field IDs — never reusable, their data is retained (a tombstone). */
  tombstones: string[];
}

export interface SchemaArtifact {
  /** Format version of the artifact itself (not a generation counter). */
  schemaVersion: 1;
  /** Keyed by display name; the value's `id` is the burned, physical identity. */
  collections: { [displayName: string]: CollectionSpec };
}

/** Burned IDs are engine-minted from a `[a-z][0-9]+` alphabet (D3, D5a) — one lowercase
 *  letter followed by one or more digits. Structurally incapable of carrying a SQL
 *  metacharacter, which is what lets a resolved identifier be interpolated safely. */
export const BURNED_ID_RE = /^[a-z][0-9]+$/;

// ─────────────────────────────────────────────────────────────────────────────
// Filter grammar (D5) — closed; AND-composed; equality + range only
// ─────────────────────────────────────────────────────────────────────────────

export interface RangeFilter {
  gt?: JsonValue;
  gte?: JsonValue;
  lt?: JsonValue;
  lte?: JsonValue;
}

/** A `where` clause: per-field equality (`value`) or a range (`{gt|gte|lt|lte}`),
 *  AND-composed across fields. No OR, no joins, no aggregates, no expressions. */
export type WhereClause = { [displayField: string]: JsonValue | RangeFilter };

export interface OrderBy {
  field: string;
  direction: 'asc' | 'desc';
}

export interface ListQuery {
  where?: WhereClause;
  orderBy?: OrderBy;
  limit?: number;
  offset?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Verb surface (D5, D6) — the closed set; SQL is always host-authored
// ─────────────────────────────────────────────────────────────────────────────

/** A single stored record as seen by a mini-app: the engine-assigned `id` plus the
 *  active artifact's fields keyed by their CURRENT display names. */
export type StorageRecord = { id: number } & { [displayField: string]: JsonValue };

export interface StorageEngine {
  /** Apply a generation's schema (validate → diff → {no-op | DDL | accept-older | reject}). */
  open(artifact: SchemaArtifact): void;

  readonly kv: {
    get(key: string): JsonValue | undefined;
    set(key: string, value: JsonValue): void;
    remove(key: string): void;
  };

  readonly records: {
    /** Append one record; returns the engine-assigned integer id (opaque reference). */
    append(collection: string, record: { [displayField: string]: JsonValue }): { id: number };
    list(collection: string, query?: ListQuery): StorageRecord[];
    /** Patch only the named fields; columns outside the patch are provably untouched. */
    update(collection: string, id: number, patch: { [displayField: string]: JsonValue }): void;
    /** Hard delete (D6 — no engine-level soft delete). */
    remove(collection: string, id: number): void;
  };

  /** Release the underlying database handle. */
  close(): void;
}

export interface CreateEngineOptions {
  /** Binds this instance to exactly one app's store. There is no per-call app addressing
   *  anywhere in the API (D2 constructor-guard isolation). */
  appId: string;
  /** 'persistent' → a file at `storage/<appId>.db`; 'ephemeral' → an in-memory DB (D2/Spike 3). */
  mode: 'persistent' | 'ephemeral';
  /** Override the KV value size cap (bytes of the JSON serialization). Default 32 KiB. */
  kvSizeCapBytes?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Structured errors (D8) — every refusal carries a machine-actionable fix hint
// ─────────────────────────────────────────────────────────────────────────────

export type StorageErrorKind =
  // — artifact validation (shape / types / defaults / IDs) —
  | 'invalid_artifact'
  | 'bad_field_type'
  | 'bad_default'
  | 'malformed_id'
  // — schema evolution conflicts (the four D4/§2.3 reject kinds) —
  | 'type_change'
  | 'id_reuse'
  | 'tombstone_violation'
  | 'missing_default'
  // — verb-time resolution / validation —
  | 'unknown_collection'
  | 'unknown_field'
  | 'unknown_record'
  | 'type_mismatch'
  | 'kv_too_large'
  | 'not_open'
  | 'corrupt_storage';

export interface StorageError {
  kind: StorageErrorKind;
  collection?: string;
  field?: string;
  /** Always present: a one-line, machine-and-human actionable next step (§8.1). */
  hint: string;
}

/** The Error subclass the engine throws. `.detail` is the structured {kind, …, hint};
 *  the message is the hint so a bare `catch` still surfaces something useful. */
export class StorageEngineError extends Error {
  readonly detail: StorageError;
  constructor(detail: StorageError) {
    super(detail.hint);
    this.name = 'StorageEngineError';
    this.detail = detail;
  }
}

export function storageError(detail: StorageError): StorageEngineError {
  return new StorageEngineError(detail);
}
