/** MMKV-shaped memory store and an op-sqlite-shaped database over `node:sqlite`: the production
 *  backend adapters and the real storage engine still run above them. */
import { DatabaseSync } from 'node:sqlite';

const stores = new Map<string, Map<string, string>>();
export function createMMKV({ id }: { id: string }) {
  if (!stores.has(id)) stores.set(id, new Map());
  const data = stores.get(id)!;
  return {
    getString: (key: string) => data.get(key),
    set: (key: string, value: string) => data.set(key, value),
    remove: (key: string) => data.delete(key),
    getAllKeys: () => [...data.keys()],
  };
}

/** One in-memory SQLite database per op-sqlite name, surviving close/reopen like a file would. */
const databases = new Map<string, DatabaseSync>();
/** How many times each named database was closed — a leaked handle is one never closed. */
export const closedDatabases = new Map<string, number>();

export function resetNativeStorage(): void {
  stores.clear();
  for (const db of databases.values()) db.close();
  databases.clear();
  closedDatabases.clear();
}

const READS = /^\s*(SELECT|PRAGMA|WITH)\b/i;

export function open({ name }: { name: string; location?: string }) {
  if (!databases.has(name)) databases.set(name, new DatabaseSync(':memory:'));
  const db = databases.get(name)!;
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
    close() { closedDatabases.set(name, (closedDatabases.get(name) ?? 0) + 1); },
    delete() { databases.get(name)?.close(); databases.delete(name); },
  };
}
