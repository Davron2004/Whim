/** MMKV-shaped memory store and an op-sqlite-shaped database over `node:sqlite`: the production
 *  backend adapters and the real storage engine still run above them. */
import { DatabaseSync } from 'node:sqlite';

const stores = new Map<string, Map<string, string>>();
type WriteFailure = (input: Readonly<{ id: string; key: string; value: string }>) => boolean;
let writeFailure: WriteFailure | undefined;
type RemovalFailure = (input: Readonly<{ id: string; key: string }>) => 'throw' | 'return-false' | undefined;
let removalFailure: RemovalFailure | undefined;

/** Test-only fault injection for every MMKV-shaped adapter over the shared named store. */
export function failNativeStorageWritesWhen(predicate: WriteFailure): () => void {
  const previous = writeFailure;
  writeFailure = predicate;
  return () => { writeFailure = previous; };
}

/** Test-only removal faults are independent from set faults and retain the key on either failure. */
export function failNativeStorageRemovalsWhen(predicate: RemovalFailure): () => void {
  const previous = removalFailure;
  removalFailure = predicate;
  return () => { removalFailure = previous; };
}

export function createMMKV({ id }: { id: string }) {
  if (!stores.has(id)) stores.set(id, new Map());
  const data = stores.get(id)!;
  return {
    getString: (key: string) => data.get(key),
    set: (key: string, value: string) => {
      if (writeFailure?.({ id, key, value })) throw new Error('native storage write failed');
      data.set(key, value);
    },
    remove: (key: string) => {
      const fault = removalFailure?.({ id, key });
      if (fault === 'throw') throw new Error('native storage removal failed');
      if (fault === 'return-false') return false;
      return data.delete(key);
    },
    getAllKeys: () => [...data.keys()],
  };
}

/** One in-memory SQLite database per op-sqlite name, surviving close/reopen like a file would. */
const databases = new Map<string, DatabaseSync>();
/** How many times each named database was closed — a leaked handle is one never closed. */
export const closedDatabases = new Map<string, number>();

export function resetNativeStorage(): void {
  stores.clear();
  writeFailure = undefined;
  removalFailure = undefined;
  for (const db of databases.values()) db.close();
  databases.clear();
  closedDatabases.clear();
}

/** Whether a database file named `name` exists, as a directory listing would say. */
export function hasDatabase(name: string): boolean {
  return databases.has(name);
}

/** Gives `appId`'s user-data store one kv row, as a mini-app's first save would. */
export function saveUserData(appId: string): void {
  const db = open({ name: `${appId}.db` });
  db.executeSync('CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  db.executeSync("INSERT OR REPLACE INTO kv (key, value) VALUES ('count', '1')");
}

const READS = /^\s*(SELECT|PRAGMA|WITH)\b/i;

/** As op-sqlite 19 resolves it (cpp/OPSqlite.cpp:88-96, cpp/OPBridge.cpp:117-119): only
 *  `location: ':memory:'` opens a fresh in-memory database and creates no file; any other open,
 *  including `name: ':memory:'` without that location, is the named file under the storage base. */
export function open({ name, location }: { name: string; location?: string }) {
  const inMemory = location === ':memory:';
  if (!inMemory && !databases.has(name)) databases.set(name, new DatabaseSync(':memory:'));
  const db = inMemory ? new DatabaseSync(':memory:') : databases.get(name)!;
  return {
    executeSync(sql: string, params: unknown[] = []) {
      if (READS.test(sql)) {
        return { rows: db.prepare(sql).all(...(params as never[])), insertId: 0, rowsAffected: 0 };
      }
      if (params.length === 0 && !/\?/.test(sql)) {
        db.exec(sql);
        return { rows: [], insertId: 0, rowsAffected: 0 };
      }
      const result = db.prepare(sql).run(...(params as never[]));
      return { rows: [], insertId: Number(result.lastInsertRowid), rowsAffected: Number(result.changes) };
    },
    close() {
      if (inMemory) {
        db.close();
        return;
      }
      closedDatabases.set(name, (closedDatabases.get(name) ?? 0) + 1);
    },
    /** An in-memory database has no file, so deleting it never touches the persistent one of that name. */
    delete() {
      if (inMemory) return;
      databases.get(name)?.close();
      databases.delete(name);
    },
  };
}
