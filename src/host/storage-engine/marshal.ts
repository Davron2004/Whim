/**
 * Value marshalling (Decision #40, D3/D5a). The pure boundary between a mini-app's
 * JsonValue universe and SQLite's storage classes. Three jobs:
 *
 *   - checkValue:        validate a JsonValue against a declared FieldType (write-time +
 *                        default-time), returning a human-readable reason or null if ok.
 *   - toStorage/fromStorage:  marshal a validated value to/from its SQLite binding form.
 *                             These values are ALWAYS bound as parameters, never built into
 *                             SQL text (D5a) — so nothing here escapes anything for SQL.
 *   - defaultSqlLiteral: the ONE place a schema-supplied value becomes SQL literal text —
 *                        column DEFAULT clauses, which SQL cannot parameterize. Strictly
 *                        encoded (numbers validated numeric; strings quote-escaped) so an
 *                        adversarial default in an artifact cannot inject DDL.
 *
 * No `Buffer` here — `byteLen` uses TextEncoder so it runs unchanged on Hermes (which
 * ships TextEncoder; the version-store polyfills note it lacks only TextDecoder).
 */

import { FieldType, JsonValue, storageError } from './contract';

/** node:sqlite / op-sqlite both accept these as bind parameters. */
export type SqlBindValue = null | number | bigint | string | Uint8Array;

const enc = new TextEncoder();

/** UTF-8 byte length of a value's JSON serialization (the KV size-cap metric). */
export function byteLen(value: JsonValue): number {
  return enc.encode(JSON.stringify(value)).length;
}

/**
 * Validate a value against a declared field type. Returns null if acceptable, else a
 * one-line reason. `null` is universally acceptable (stored as SQL NULL / a forgiving
 * "no value"). Used for both write-time field validation and default type-checking.
 */
export function checkValue(type: FieldType, value: JsonValue): string | null {
  if (value === undefined) return 'value is undefined; use null for "no value"';
  if (value === null) return null;
  return checkTypedValue(type, value);
}

function checkTypedValue(type: FieldType, value: JsonValue): string | null {
  switch (type) {
    case 'text':
      return typeof value === 'string' ? null : 'expected a string';
    case 'int':
      return typeof value === 'number' && Number.isSafeInteger(value)
        ? null
        : 'expected a whole number within the JS safe-integer range';
    case 'float':
      return typeof value === 'number' && Number.isFinite(value) ? null : 'expected a finite number';
    case 'bool':
      return typeof value === 'boolean' ? null : 'expected a boolean';
    case 'date':
      return typeof value === 'number' && Number.isSafeInteger(value)
        ? null
        : 'expected an epoch-millisecond integer';
    case 'json':
      try {
        JSON.stringify(value);
        return null;
      } catch {
        return 'expected a JSON-serializable value';
      }
    default:
      return `unknown field type "${String(type)}"`;
  }
}

/** Marshal a validated JsonValue to its SQLite bind form. Caller guarantees checkValue passed. */
export function toStorage(type: FieldType, value: JsonValue): SqlBindValue {
  if (value === null) return null;
  switch (type) {
    case 'text':
      return value as string;
    case 'int':
    case 'float':
    case 'date':
      return value as number;
    case 'bool':
      return value ? 1 : 0;
    case 'json':
      return JSON.stringify(value);
  }
}

/** Marshal a raw SQLite cell back to a JsonValue under the declared field type. */
export function fromStorage(type: FieldType, raw: unknown): JsonValue {
  if (raw === null || raw === undefined) return null;
  switch (type) {
    case 'text':
      return String(raw);
    case 'int':
    case 'float':
    case 'date':
      return Number(raw);
    case 'bool':
      return Number(raw) !== 0;
    case 'json':
      try {
        return JSON.parse(String(raw)) as JsonValue;
      } catch {
        throw storageError({ kind: 'corrupt_storage', hint: `Stored JSON field value is not valid JSON; the stored data is corrupt.` });
      }
  }
}

/** The SQLite storage class for a declared field type (used to build CREATE/ALTER DDL). */
export function sqlColumnType(type: FieldType): 'TEXT' | 'INTEGER' | 'REAL' {
  switch (type) {
    case 'text':
    case 'json':
      return 'TEXT';
    case 'int':
    case 'bool':
    case 'date':
      return 'INTEGER';
    case 'float':
      return 'REAL';
  }
}

/**
 * Encode a schema-supplied default as a SQL literal for a column DEFAULT clause. This is
 * the single code path where a value from the artifact becomes SQL text (a DEFAULT cannot
 * be a bind parameter). Numbers are validated numeric; text/json are single-quote-escaped
 * and quoted — so even an adversarial default string is inert. Throws if the value does
 * not match the type (the caller validates first; this is the defense-in-depth backstop).
 */
export function defaultSqlLiteral(type: FieldType, value: JsonValue): string {
  if (value === null || value === undefined) return 'NULL';
  const bad = checkValue(type, value);
  if (bad) throw new Error(`cannot encode default for ${type}: ${bad}`);
  switch (type) {
    case 'text':
      return quote(value as string);
    case 'json':
      return quote(JSON.stringify(value));
    case 'bool':
      return value ? '1' : '0';
    case 'int':
    case 'date':
    case 'float':
      return String(value as number); // validated numeric above — no metacharacters possible
  }
}

function quote(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}
