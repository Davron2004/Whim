/**
 * The engine core (Decision #40, D2/D4/D5/D5a/D6). Pure TypeScript over a SqlExecutor:
 * one DB handle per instance, no per-call app addressing, all SQL host-authored and
 * parameterized. `createEngine` is binding-agnostic — the Node suite hands it a
 * node:sqlite executor, the device hands it op-sqlite, and the behaviour is identical.
 *
 * Two schema states live side by side:
 *   - `active`  (in-memory, set by the latest open) — the CURRENT generation's vocabulary;
 *               every verb resolves display name → burned ID through it. A name absent from
 *               `active` is `unknown_collection`/`unknown_field`, NEVER concatenated into SQL.
 *   - `applied` (persisted in `_meta`) — the accumulated physical schema; what columns exist.
 *               It only grows (additive-only, no DROP), which is what makes rollback lossless.
 */

import {
  CollectionSpec,
  FieldSpec,
  FieldType,
  JsonValue,
  ListQuery,
  RangeFilter,
  SchemaArtifact,
  StorageEngine,
  StorageRecord,
  storageError,
  WhereClause,
} from './contract';
import { byteLen, checkValue, defaultSqlLiteral, fromStorage, SqlBindValue, sqlColumnType, toStorage } from './marshal';
import {
  AddColumnPlan,
  AppliedSchema,
  diffSchemas,
  emptyApplied,
  PlanColumn,
  validateArtifact,
} from './schema';
import { SqlExecutor } from './sql-executor';

const DEFAULT_KV_CAP_BYTES = 32 * 1024;
const META_TABLE = '_meta';
const KV_TABLE = 'kv';
const APPLIED_KEY = 'applied_schema';
const RECORD_ID = 'id'; // the engine-assigned primary key; never a burned field ID (no digits)
const BURNED_ID_RE = /^[a-z][0-9]+$/;
const RANGE_OPS = { gt: '>', gte: '>=', lt: '<', lte: '<=' } as const;

/** Construct an engine over an already-opened executor (the binding picks the file). */
export function createEngine(executor: SqlExecutor, opts: { kvSizeCapBytes?: number } = {}): StorageEngine {
  return new Engine(executor, opts.kvSizeCapBytes ?? DEFAULT_KV_CAP_BYTES);
}

class Engine implements StorageEngine {
  private active: SchemaArtifact | null = null;
  private applied: AppliedSchema;

  constructor(private readonly sql: SqlExecutor, private readonly kvCap: number) {
    // Infra tables. Both are CREATE TABLE forms (the only-two-DDL-forms rule covers them);
    // IF NOT EXISTS makes construction idempotent across restarts.
    this.sql.execute(`CREATE TABLE IF NOT EXISTS "${META_TABLE}" (k TEXT PRIMARY KEY, v TEXT)`);
    this.sql.execute(`CREATE TABLE IF NOT EXISTS "${KV_TABLE}" (k TEXT PRIMARY KEY, v TEXT)`);
    this.applied = this.loadApplied();
  }

  // ── schema lifecycle (D4) ────────────────────────────────────────────────

  open(artifact: SchemaArtifact): void {
    const invalid = validateArtifact(artifact);
    if (invalid.length) throw storageError(invalid[0]);

    const diff = diffSchemas(this.applied, artifact);
    if (diff.kind === 'conflict') throw storageError(diff.errors[0]);

    this.sql.transaction(() => {
      if (diff.kind === 'additive') {
        for (const create of diff.plan.creates) this.sql.execute(this.createTableSql(create.collectionId, create.columns));
        for (const add of diff.plan.adds) this.sql.execute(this.addColumnSql(add.collectionId, add.column));
      }
      // older-subset / identical: zero DDL — the omitted columns simply persist untouched.
      this.persistApplied(diff.nextApplied);
    });

    this.applied = diff.nextApplied;
    this.active = artifact;
  }

  // ── kv verbs (D5) ────────────────────────────────────────────────────────

  readonly kv = {
    get: (key: string): JsonValue | undefined => {
      const res = this.sql.execute(`SELECT v FROM "${KV_TABLE}" WHERE k = ?`, [key]);
      if (!res.rows.length) return undefined;
      try {
        return JSON.parse(String(res.rows[0].v)) as JsonValue;
      } catch {
        throw storageError({ kind: 'corrupt_storage', hint: `KV value for key "${key}" is not valid JSON; the stored data is corrupt.` });
      }
    },
    set: (key: string, value: JsonValue): void => {
      const size = byteLen(value);
      if (size > this.kvCap) {
        throw storageError({
          kind: 'kv_too_large',
          hint: `Value for "${key}" is ${size} bytes, over the ${this.kvCap}-byte KV cap; store collections with records.append instead.`,
        });
      }
      this.sql.execute(`INSERT OR REPLACE INTO "${KV_TABLE}"(k, v) VALUES (?, ?)`, [key, JSON.stringify(value)]);
    },
    remove: (key: string): void => {
      this.sql.execute(`DELETE FROM "${KV_TABLE}" WHERE k = ?`, [key]);
    },
  };

  // ── record verbs (D5/D6) ──────────────────────────────────────────────────

  readonly records = {
    append: (collection: string, record: { [field: string]: JsonValue }): { id: number } => {
      const coll = this.resolveCollection(collection);
      // Resolve + validate + marshal EVERY field before any SQL is built (so a bad
      // identifier throws with nothing executed).
      const cols: string[] = [];
      const binds: SqlBindValue[] = [];
      for (const [name, value] of Object.entries(record)) {
        const f = this.resolveField(coll, collection, name);
        this.assertValue(collection, name, f, value);
        cols.push(quoteIdent(f.id));
        binds.push(toStorage(f.type, value));
      }
      const table = quoteIdent(coll.id);
      const sql = cols.length
        ? `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`
        : `INSERT INTO ${table} DEFAULT VALUES`;
      const res = this.sql.execute(sql, binds);
      return { id: res.lastInsertRowId };
    },

    list: (collection: string, query: ListQuery = {}): StorageRecord[] => {
      const coll = this.resolveCollection(collection);
      const fields = Object.entries(coll.fields); // [displayName, FieldSpec]
      const select = [quoteIdent(RECORD_ID), ...fields.map(([, f]) => quoteIdent(f.id))].join(', ');

      const binds: SqlBindValue[] = [];
      const where = this.compileWhere(coll, collection, query.where, binds);
      const order = this.compileOrderBy(coll, collection, query.orderBy);
      const tail = this.compileLimitOffset(query, binds);
      const sql = `SELECT ${select} FROM ${quoteIdent(coll.id)}${where}${order}${tail}`;

      const res = this.sql.execute(sql, binds);
      return res.rows.map(row => {
        const out: StorageRecord = { id: Number(row[RECORD_ID]) };
        for (const [name, f] of fields) out[name] = fromStorage(f.type, row[f.id]);
        return out;
      });
    },

    update: (collection: string, id: number, patch: { [field: string]: JsonValue }): void => {
      const coll = this.resolveCollection(collection);
      const sets: string[] = [];
      const binds: SqlBindValue[] = [];
      for (const [name, value] of Object.entries(patch)) {
        const f = this.resolveField(coll, collection, name);
        this.assertValue(collection, name, f, value);
        sets.push(`${quoteIdent(f.id)} = ?`);
        binds.push(toStorage(f.type, value));
      }
      if (!sets.length) return; // empty patch — nothing to set, unnamed fields untouched
      binds.push(id);
      this.sql.execute(`UPDATE ${quoteIdent(coll.id)} SET ${sets.join(', ')} WHERE ${quoteIdent(RECORD_ID)} = ?`, binds);
    },

    remove: (collection: string, id: number): void => {
      const coll = this.resolveCollection(collection);
      this.sql.execute(`DELETE FROM ${quoteIdent(coll.id)} WHERE ${quoteIdent(RECORD_ID)} = ?`, [id]);
    },
  };

  close(): void {
    this.sql.close();
  }

  // ── DDL derivation (D4) — the only two forms the engine can emit ───────────

  private createTableSql(collectionId: string, columns: PlanColumn[]): string {
    const defs = [`${quoteIdent(RECORD_ID)} INTEGER PRIMARY KEY`];
    for (const c of columns) defs.push(this.columnDef(c.id, c.type, c.default));
    return `CREATE TABLE ${quoteIdent(collectionId)} (${defs.join(', ')})`;
  }

  private addColumnSql(collectionId: string, column: AddColumnPlan['column']): string {
    return `ALTER TABLE ${quoteIdent(collectionId)} ADD COLUMN ${this.columnDef(column.id, column.type, column.default)}`;
  }

  private columnDef(id: string, type: FieldType, def: JsonValue | undefined): string {
    const base = `${quoteIdent(id)} ${sqlColumnType(type)}`;
    return def === undefined ? base : `${base} DEFAULT ${defaultSqlLiteral(type, def)}`;
  }

  // ── _meta persistence ──────────────────────────────────────────────────────

  private loadApplied(): AppliedSchema {
    const res = this.sql.execute(`SELECT v FROM "${META_TABLE}" WHERE k = ?`, [APPLIED_KEY]);
    if (!res.rows.length) return emptyApplied();
    try {
      return JSON.parse(String(res.rows[0].v)) as AppliedSchema;
    } catch {
      return emptyApplied();
    }
  }

  private persistApplied(applied: AppliedSchema): void {
    this.sql.execute(`INSERT OR REPLACE INTO "${META_TABLE}"(k, v) VALUES (?, ?)`, [APPLIED_KEY, JSON.stringify(applied)]);
  }

  // ── resolution + validation (D5a) ──────────────────────────────────────────

  private resolveCollection(name: string): CollectionSpec {
    const coll = this.active?.collections[name];
    if (!coll) {
      throw storageError({
        kind: this.active ? 'unknown_collection' : 'not_open',
        collection: name,
        hint: this.active
          ? `No collection named "${name}" in the open schema; declare it before using it.`
          : `Storage has no schema open yet; call open(schema) before using records.`,
      });
    }
    return coll;
  }

  private resolveField(coll: CollectionSpec, collName: string, name: string): FieldSpec {
    const f = coll.fields[name];
    if (!f) {
      throw storageError({ kind: 'unknown_field', collection: collName, field: name, hint: `No field named "${name}" in "${collName}"; declare it in the schema.` });
    }
    return f;
  }

  private assertValue(collName: string, fieldName: string, f: FieldSpec, value: JsonValue): void {
    const reason = checkValue(f.type, value);
    if (reason) {
      throw storageError({ kind: 'type_mismatch', collection: collName, field: fieldName, hint: `Value for "${fieldName}" in "${collName}" is invalid: ${reason}.` });
    }
  }

  // ── filter compilation (D5) — values bound, identifiers resolved ────────────

  private compileWhere(coll: CollectionSpec, collName: string, where: WhereClause | undefined, binds: SqlBindValue[]): string {
    if (!where) return '';
    const clauses: string[] = [];
    for (const [name, cond] of Object.entries(where)) {
      const f = this.resolveField(coll, collName, name);
      const col = quoteIdent(f.id);
      if (isRangeFilter(cond)) {
        for (const [op, sqlOp] of Object.entries(RANGE_OPS)) {
          const v = (cond as RangeFilter)[op as keyof RangeFilter];
          if (v === undefined) continue;
          this.assertValue(collName, name, f, v);
          clauses.push(`${col} ${sqlOp} ?`);
          binds.push(toStorage(f.type, v));
        }
      } else if (cond === null) {
        clauses.push(`${col} IS NULL`);
      } else {
        this.assertValue(collName, name, f, cond);
        clauses.push(`${col} = ?`);
        binds.push(toStorage(f.type, cond));
      }
    }
    return clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
  }

  private compileOrderBy(coll: CollectionSpec, collName: string, orderBy: ListQuery['orderBy']): string {
    if (!orderBy) return '';
    const f = this.resolveField(coll, collName, orderBy.field);
    if (orderBy.direction !== 'asc' && orderBy.direction !== 'desc') {
      throw storageError({ kind: 'type_mismatch', collection: collName, field: orderBy.field, hint: `orderBy direction must be "asc" or "desc".` });
    }
    return ` ORDER BY ${quoteIdent(f.id)} ${orderBy.direction === 'desc' ? 'DESC' : 'ASC'}`;
  }

  private compileLimitOffset(query: ListQuery, binds: SqlBindValue[]): string {
    const hasLimit = query.limit !== undefined;
    const hasOffset = query.offset !== undefined;
    if (!hasLimit && !hasOffset) return '';
    if (hasLimit) assertCount('limit', query.limit!);
    if (hasOffset) assertCount('offset', query.offset!);
    // SQLite requires LIMIT for OFFSET; -1 means "no limit".
    binds.push(hasLimit ? query.limit! : -1);
    if (!hasOffset) return ' LIMIT ?';
    binds.push(query.offset!);
    return ' LIMIT ? OFFSET ?';
  }
}

// ── identifier safety (D5a) ──────────────────────────────────────────────────

/** Quote a burned-ID identifier. Asserts the `[a-z][0-9]+` form first: the value is already
 *  schema-resolved, so this is the defense-in-depth backstop guaranteeing no caller text and
 *  no metacharacter can ever reach a statement as an identifier. */
function quoteIdent(id: string): string {
  if (id !== RECORD_ID && !BURNED_ID_RE.test(id)) {
    throw new Error(`refusing to build SQL with non-burned identifier "${id}"`);
  }
  return `"${id}"`;
}

function isRangeFilter(cond: unknown): cond is RangeFilter {
  if (typeof cond !== 'object' || cond === null || Array.isArray(cond)) return false;
  return ['gt', 'gte', 'lt', 'lte'].some(k => k in (cond as object));
}

function assertCount(which: string, n: number): void {
  if (!Number.isSafeInteger(n) || n < 0) {
    throw storageError({ kind: 'type_mismatch', hint: `${which} must be a non-negative whole number.` });
  }
}
