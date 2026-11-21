/**
 * Storage upgrade evidence: an exact, deterministic dump of the storage engine's SQLite files as
 * pulled off a device (Android `databases/storage/`, iOS `Library/storage/` in the app's data
 * container), the comparison of two dumps that names every difference, and the check that a seeded
 * store covers what an upgrade has to carry. The `storage-dump`, `storage-diff` and
 * `storage-seed-check` commands of `scripts/release/run.mjs`.
 *
 * Every value is kept exactly: its SQLite storage class plus integers as decimal text (a JS number
 * would round past 2^53), reals in the shortest form that reads back to the same double, blobs as
 * hex. Rows are sorted by content, so a dump depends on what the file holds, not on page layout.
 * The dump reads a scratch copy of each file together with its `-journal`/`-wal`/`-shm` sidecars,
 * so SQLite's own recovery runs on the copy and the evidence file is never written.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { FIELD_TYPES } from '../../../src/host/storage-engine/contract';
import type { AppliedSchema } from '../../../src/host/storage-engine/schema';

declare module 'node:fs' {
  export function copyFileSync(source: string, destination: string): void;
  // The options argument keeps this overload apart from preflight.ts's narrower `statSync(path)`.
  export function statSync(path: string, options: { bigint: false }): { readonly size: number; isDirectory(): boolean; isFile(): boolean };
}

export const STORAGE_DUMP_FORMAT = 'whim-storage-dump/1';

const SIDECAR_SUFFIXES = ['-journal', '-wal', '-shm'];

/** One SQLite value: its storage class, and its exact text unless it is NULL. */
export type DumpCell = ['null'] | ['integer' | 'real' | 'text' | 'blob', string];

export interface DumpTable {
  columns: string[];
  rows: DumpCell[][];
}

/** A `sqlite_master` entry: every table, index and trigger, with the SQL that made it. */
export interface DumpObject {
  type: string;
  name: string;
  table: string;
  sql: string | null;
}

export interface DumpPragmas {
  journalMode: string;
  pageSize: number;
  encoding: string;
  autoVacuum: number;
}

export interface DatabaseDump {
  /** Sidecar files next to the database when it was dumped, as `<suffix> <bytes> bytes`. */
  sidecars: string[];
  integrity: string;
  userVersion: number;
  /** The file-level settings an upgrade could change without touching a row. */
  pragmas: DumpPragmas;
  objects: DumpObject[];
  tables: Record<string, DumpTable>;
}

export interface StorageDump {
  format: typeof STORAGE_DUMP_FORMAT;
  databases: Record<string, DatabaseDump>;
}

function quoteIdent(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

function toCell(type: unknown, value: unknown): DumpCell {
  switch (type) {
    case 'null':
      return ['null'];
    case 'real':
      return ['real', Object.is(value, -0) ? '-0' : String(value)];
    case 'integer':
    case 'text':
    case 'blob':
      return [type, String(value)];
    default:
      throw new Error(`unexpected SQLite storage class ${String(type)}`);
  }
}

function dumpTable(db: DatabaseSync, table: string): DumpTable {
  const columns = db.prepare(`PRAGMA table_info(${quoteIdent(table)})`).all().map((row) => String(row.name));
  if (columns.length === 0) return { columns, rows: [] };
  const select = columns
    .map((column, i) => {
      const q = quoteIdent(column);
      return `typeof(${q}) AS t${i}, CASE typeof(${q}) WHEN 'integer' THEN CAST(${q} AS TEXT) WHEN 'blob' THEN hex(${q}) ELSE ${q} END AS v${i}`;
    })
    .join(', ');
  const rows = db
    .prepare(`SELECT ${select} FROM ${quoteIdent(table)}`)
    .all()
    .map((row) => columns.map((_, i) => toCell(row[`t${i}`], row[`v${i}`])));
  const keyed = rows.map((row) => ({ key: JSON.stringify(row), row }));
  keyed.sort((a, b) => (a.key < b.key ? -1 : Number(a.key > b.key)));
  return { columns, rows: keyed.map((k) => k.row) };
}

function readDatabase(file: string): Omit<DatabaseDump, 'sidecars'> {
  const db = new DatabaseSync(file);
  try {
    const integrity = db.prepare('PRAGMA integrity_check').all().map((row) => String(row.integrity_check)).join('; ');
    const userVersion = Number(db.prepare('PRAGMA user_version').all()[0]?.user_version ?? 0);
    const pragma = (name: string): unknown => Object.values(db.prepare(`PRAGMA ${name}`).all()[0] ?? {})[0];
    const pragmas: DumpPragmas = {
      journalMode: String(pragma('journal_mode')),
      pageSize: Number(pragma('page_size')),
      encoding: String(pragma('encoding')),
      autoVacuum: Number(pragma('auto_vacuum')),
    };
    const objects: DumpObject[] = db
      .prepare('SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY type, name')
      .all()
      .map((row) => ({ type: String(row.type), name: String(row.name), table: String(row.tbl_name), sql: row.sql === null ? null : String(row.sql) }));
    const tables: Record<string, DumpTable> = {};
    for (const object of objects) {
      if (object.type === 'table') tables[object.name] = dumpTable(db, object.name);
    }
    return { integrity, userVersion, pragmas, objects, tables };
  } finally {
    db.close();
  }
}

/** Dumps one database file through a scratch copy of it and its sidecars. */
export function dumpDatabase(file: string): DatabaseDump {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'whim-storage-dump-'));
  try {
    const copy = path.join(scratch, path.basename(file));
    fs.copyFileSync(file, copy);
    const sidecars: string[] = [];
    for (const suffix of SIDECAR_SUFFIXES) {
      if (!fs.existsSync(file + suffix)) continue;
      fs.copyFileSync(file + suffix, copy + suffix);
      sidecars.push(`${suffix} ${fs.statSync(file + suffix, { bigint: false }).size} bytes`);
    }
    try {
      return { sidecars, ...readDatabase(copy) };
    } catch (err) {
      throw new Error(`${file}: ${err instanceof Error ? err.message : String(err)}`);
    }
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

/** Dumps a database file, or every `*.db` file directly inside a directory, keyed by file name. */
export function dumpStorage(target: string): StorageDump {
  const files = fs.statSync(target, { bigint: false }).isDirectory()
    ? fs
        .readdirSync(target)
        .filter((name) => name.endsWith('.db') && fs.statSync(path.join(target, name), { bigint: false }).isFile())
        .sort((a, b) => a.localeCompare(b))
        .map((name) => path.join(target, name))
    : [target];
  if (files.length === 0) throw new Error(`no *.db file in ${target}`);
  const databases: Record<string, DatabaseDump> = {};
  for (const file of files) databases[path.basename(file)] = dumpDatabase(file);
  return { format: STORAGE_DUMP_FORMAT, databases };
}

/** Reads a dump file, refusing anything that is not one. */
export function readStorageDump(file: string): StorageDump {
  const dump = JSON.parse(fs.readFileSync(file, 'utf8')) as StorageDump;
  if (dump.format !== STORAGE_DUMP_FORMAT || typeof dump.databases !== 'object' || dump.databases === null) {
    throw new Error(`${file} is not a ${STORAGE_DUMP_FORMAT} file (make one with storage-dump)`);
  }
  return dump;
}

function cellText(cell: DumpCell): string {
  if (cell[0] === 'null') return 'NULL';
  if (cell[0] === 'text') return JSON.stringify(cell[1]);
  if (cell[0] === 'blob') return `x'${cell[1]}'`;
  return cell[0] === 'real' && !/[.e]/.test(cell[1]) ? `${cell[1]}.0` : cell[1];
}

function rowText(columns: string[], row: DumpCell[]): string {
  return columns.map((column, i) => `${column}=${cellText(row[i])}`).join(', ');
}

/** Every row of `from` that `other` does not hold (as a multiset: a duplicated row counts twice). */
function rowsMissingFrom(from: DumpCell[][], other: DumpCell[][]): DumpCell[][] {
  const counts = new Map<string, number>();
  for (const row of other) counts.set(JSON.stringify(row), (counts.get(JSON.stringify(row)) ?? 0) + 1);
  return from.filter((row) => {
    const key = JSON.stringify(row);
    const left = counts.get(key) ?? 0;
    if (left > 0) counts.set(key, left - 1);
    return left === 0;
  });
}

function diffRows(where: string, columns: string[], before: DumpCell[][], after: DumpCell[][]): string[] {
  const lost = rowsMissingFrom(before, after);
  const added = rowsMissingFrom(after, before);
  const lines: string[] = [];
  // A lost and an added row with the same first column (the record id) is one changed row.
  for (const row of lost) {
    const key = JSON.stringify(row[0]);
    const match = added.findIndex((other) => JSON.stringify(other[0]) === key);
    if (match === -1) {
      lines.push(`${where}: row missing after: ${rowText(columns, row)}`);
      continue;
    }
    const [other] = added.splice(match, 1);
    const changes = columns
      .map((column, i) => (JSON.stringify(row[i]) === JSON.stringify(other[i]) ? undefined : `${column} ${cellText(row[i])} -> ${cellText(other[i])}`))
      .filter((change): change is string => change !== undefined);
    lines.push(`${where}: row ${columns[0]}=${cellText(row[0])} changed: ${changes.join('; ')}`);
  }
  for (const row of added) lines.push(`${where}: row added after: ${rowText(columns, row)}`);
  return lines;
}

const PRAGMA_NAMES: [keyof DumpPragmas, string][] = [['journalMode', 'journal_mode'], ['pageSize', 'page_size'], ['encoding', 'encoding'], ['autoVacuum', 'auto_vacuum']];

function diffPragmas(name: string, before: DumpPragmas, after: DumpPragmas): string[] {
  return PRAGMA_NAMES.filter(([key]) => before[key] !== after[key]).map(
    ([key, label]) => `${name}: ${label} ${JSON.stringify(before[key])} -> ${JSON.stringify(after[key])}`,
  );
}

function diffDatabase(name: string, before: DatabaseDump, after: DatabaseDump): string[] {
  const lines: string[] = [];
  const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
  if (!same(before.sidecars, after.sidecars)) lines.push(`${name}: sidecar files ${JSON.stringify(before.sidecars)} -> ${JSON.stringify(after.sidecars)}`);
  if (before.integrity !== after.integrity) lines.push(`${name}: integrity_check ${JSON.stringify(before.integrity)} -> ${JSON.stringify(after.integrity)}`);
  if (before.userVersion !== after.userVersion) lines.push(`${name}: user_version ${before.userVersion} -> ${after.userVersion}`);
  lines.push(...diffPragmas(name, before.pragmas, after.pragmas));
  const objectKey = (o: DumpObject): string => `${o.type} ${o.name}`;
  const afterObjects = new Map(after.objects.map((o) => [objectKey(o), o]));
  const beforeObjects = new Map(before.objects.map((o) => [objectKey(o), o]));
  for (const [key, o] of beforeObjects) {
    const other = afterObjects.get(key);
    if (other === undefined) lines.push(`${name}: ${key} missing after`);
    else if (!same(o, other)) lines.push(`${name}: ${key} definition changed: ${JSON.stringify(o.sql)} -> ${JSON.stringify(other.sql)}`);
  }
  for (const key of afterObjects.keys()) {
    if (!beforeObjects.has(key)) lines.push(`${name}: ${key} added after`);
  }
  for (const [table, dumped] of Object.entries(before.tables)) {
    const other = after.tables[table];
    if (other === undefined) continue; // reported above as a missing table object
    const where = `${name} table ${table}`;
    if (!same(dumped.columns, other.columns)) {
      lines.push(`${where}: columns ${JSON.stringify(dumped.columns)} -> ${JSON.stringify(other.columns)}`);
      continue;
    }
    lines.push(...diffRows(where, dumped.columns, dumped.rows, other.rows));
  }
  return lines;
}

/** Every difference between two dumps, one line each; empty when they hold the same data. */
export function diffStorageDumps(before: StorageDump, after: StorageDump): string[] {
  const lines: string[] = [];
  for (const [name, dumped] of Object.entries(before.databases)) {
    const other = after.databases[name];
    if (other === undefined) lines.push(`${name}: database missing after`);
    else lines.push(...diffDatabase(name, dumped, other));
  }
  for (const name of Object.keys(after.databases)) {
    if (before.databases[name] === undefined) lines.push(`${name}: database added after (not in the before dump)`);
  }
  return lines;
}

/** The paths in a `find . -name '*.db*'` listing (one per line, the leading `./` dropped), sorted. */
export function parseFileListing(text: string): string[] {
  const paths = text
    .split('\n')
    .map((line) => line.trim().replace(/^\.\//, ''))
    .filter((line) => line !== '');
  return [...new Set(paths)].sort((a, b) => a.localeCompare(b));
}

/** Every path that is in one listing and not the other. A store that moved shows up as a path gone
 *  and a path appeared, which a dump of the old files alone would never show. An empty `before`
 *  listing is itself a finding: there is nothing to compare against. */
export function diffFileListings(before: string[], after: string[]): string[] {
  if (before.length === 0) return ['the before listing holds no files (no database was found to compare)'];
  const beforeSet = new Set(before);
  const afterSet = new Set(after);
  return [
    ...before.filter((file) => !afterSet.has(file)).map((file) => `${file}: file missing after`),
    ...after.filter((file) => !beforeSet.has(file)).map((file) => `${file}: file added after (not in the before listing)`),
  ];
}

function appliedSchemaOf(dumped: DatabaseDump): AppliedSchema | undefined {
  const meta = dumped.tables._meta;
  const row = meta?.rows.find((r) => r[0][0] === 'text' && r[0][1] === 'applied_schema');
  const value = row?.[1];
  return value?.[0] === 'text' ? (JSON.parse(value[1]) as AppliedSchema) : undefined;
}

/** What a database lacks to be an upgrade seed: a column holding a value of every field type in the
 *  engine's closed set, a burned (retired) field id whose column still holds data, and two collections with rows. */
function seedGaps(dumped: DatabaseDump): string[] {
  const applied = appliedSchemaOf(dumped);
  if (applied === undefined) return ['no _meta applied schema (not a storage-engine store)'];
  const gaps: string[] = [];
  const holdsValue = (table: string, column: string): boolean => {
    const dumpedTable = dumped.tables[table];
    const index = dumpedTable?.columns.indexOf(column) ?? -1;
    return index !== -1 && dumpedTable.rows.some((row) => row[index][0] !== 'null');
  };
  const columns = applied.collections.flatMap((c) => [...c.active, ...c.retired].map((column) => ({ ...column, table: c.id })));
  const untyped = FIELD_TYPES.filter((type) => !columns.some((c) => c.type === type && holdsValue(c.table, c.id)));
  if (untyped.length > 0) gaps.push(`no column of type ${untyped.join(', ')} holding a value`);
  const retired = applied.collections.flatMap((c) => c.retired.map((column) => ({ table: c.id, column: column.id })));
  if (retired.length === 0) {
    gaps.push('no burned (retired) field id in _meta');
  } else {
    const holdsData = retired.some(({ table, column }) => holdsValue(table, column));
    const names = retired.map((r) => r.table + '.' + r.column).join(', ');
    if (!holdsData) gaps.push(`no retired column holds data (${names})`);
  }
  const filled = applied.collections.filter((c) => (dumped.tables[c.id]?.rows.length ?? 0) > 0);
  if (filled.length < 2) gaps.push(`${filled.length} collection(s) with rows, expected at least 2`);
  return gaps;
}

/** The databases in a dump that are complete upgrade seeds, and every gap of the others. */
export function storageSeedCheck(dump: StorageDump): { seeds: string[]; gaps: string[] } {
  const seeds: string[] = [];
  const gaps: string[] = [];
  for (const [name, dumped] of Object.entries(dump.databases)) {
    const found = seedGaps(dumped);
    if (found.length === 0) seeds.push(name);
    else gaps.push(...found.map((gap) => `${name}: ${gap}`));
  }
  return { seeds, gaps };
}
