/**
 * `hasSavedData` over node:sqlite files (copy-app-data task 3.0) — what the Node suites inject in
 * place of the device's op-sqlite one. Stores are `<dir>/<appId>.db`, as in `copy-node.ts`. Like
 * op-sqlite's `open`, connecting creates a missing file, so the suites see what the device does.
 * Never part of the app bundle.
 */

import * as path from 'node:path';
import { createNodeSqlExecutor } from './bindings/node-sqlite';
import { storeFileName } from './copy';
import { readSavedData } from './saved-data';

/** Whether appId's store file holds user data. Reads only and never deletes; a missing store is
 *  created table-less, as on the device. */
export function createNodeHasSavedData(dir: string): (appId: string) => boolean {
  return appId => readSavedData(createNodeSqlExecutor(path.join(dir, storeFileName(appId))));
}
