/**
 * The data copy over node:sqlite files (copy-app-data, task 1.3) — the opener the Node suites
 * inject in place of the device's op-sqlite one. Stores are `<dir>/<appId>.db`, the layout the
 * file-backed Node engine already uses. Never part of the app bundle.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { createNodeSqlExecutor } from './bindings/node-sqlite';
import { CopyOpener, copyStore, storeFileName } from './copy';
import { CopyStorage } from './copy-contract';

/** An opener over the store files in `dir`. Opening a store that does not exist throws instead of
 *  creating it, so a missing source is `source_unreadable` and never gains a file. */
export function createNodeCopyOpener(dir: string): CopyOpener {
  const fileOf = (appId: string): string => path.join(dir, storeFileName(appId));
  return {
    open(appId) {
      const file = fileOf(appId);
      if (!fs.existsSync(file)) throw new Error(`unable to open database file: ${file}`);
      const sql = createNodeSqlExecutor(file);
      return {
        sql,
        dir,
        runAsync: async (statement, params) => {
          sql.execute(statement, params);
        },
      };
    },
    remove(appId) {
      const file = fileOf(appId);
      for (const f of [file, `${file}-journal`, `${file}-wal`, `${file}-shm`]) fs.rmSync(f, { force: true });
    },
  };
}

/** The `CopyStorage` seam over the store files in `dir`. */
export function createNodeCopyStorage(dir: string): CopyStorage {
  const opener = createNodeCopyOpener(dir);
  return args => copyStore(opener, args);
}
