/**
 * The data copy over op-sqlite (copy-app-data, task 1.3, design D1/D8) — the device `CopyStorage`
 * the launcher injects. Each copy opens its own connections by name under `location: 'storage'`,
 * runs the snapshot through op-sqlite's async `execute` (its worker thread, off the JS thread),
 * and writes the copy into the directory `getDbPath()` reports for the source.
 *
 * The native module is required lazily, as in `bindings/op-sqlite.ts`, so importing this module
 * off-device is safe; only running a copy pulls op-sqlite in. op-sqlite's `open` creates a file
 * that does not exist yet, so a source that never stored anything is copied as an empty store.
 */

import { createOpSqlExecutorOver, OpSqlDb } from './bindings/op-sqlite';
import { CopyOpener, copyStore, storeFileName } from './copy';
import { CopyStorage } from './copy-contract';
import { SqlBindValue } from './marshal';

/** The slice of an op-sqlite database handle the copy uses. */
interface DeviceDb extends OpSqlDb {
  execute(sql: string, params: SqlBindValue[]): Promise<unknown>;
  getDbPath(): string;
  delete(): void;
}

function openDb(appId: string): DeviceDb {
  const { open } = require('@op-engineering/op-sqlite');
  return open({ name: storeFileName(appId), location: 'storage' });
}

/** The opener over op-sqlite's `storage` location. */
function createDeviceCopyOpener(): CopyOpener {
  return {
    open(appId) {
      const db = openDb(appId);
      const dbPath = db.getDbPath();
      return {
        sql: createOpSqlExecutorOver(db),
        dir: dbPath.slice(0, dbPath.lastIndexOf('/')),
        runAsync: async (statement, params) => {
          await db.execute(statement, params);
        },
      };
    },
    remove(appId) {
      openDb(appId).delete();
    },
  };
}

/** The device `CopyStorage` seam (exported beside `deleteStorage` from the storage-engine index). */
export const copyStorage: CopyStorage = args => copyStore(createDeviceCopyOpener(), args);
