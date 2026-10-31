/**
 * On-device steps for `hasSavedData` (copy-app-data task 3.0, product-owner rulings 3 and 40
 * revised), run from the storage probe (`RUN_STORAGE_PROBE`). They settle what the Node suite
 * cannot: that op-sqlite's real `open` behaves as the Node stand-in does.
 *
 *   - neverRanThenInit: an id nothing ever opened answers false; the read leaves a store with no
 *     table and deletes nothing; the engine then opens that store normally (its tables and the
 *     applied schema appear) and a row it writes makes the answer true;
 *   - kvOnly: a store holding only a kv value answers true;
 *   - schemaOnly: an applied schema with no rows answers false, and the read leaves its tables.
 *
 * Whether a store is read at all (never for an app that declares no storage) is `StoreAccess`'s
 * call, covered by the launcher suite; this read is told an appId and always reads it. Every check
 * is evaluated and reported, and the steps remove their own stores afterwards (`deleteStorage`)
 * even when a step throws, so a rerun starts clean.
 */

import { createEngine, readAppliedSchema } from './engine';
import { createOpSqlExecutor } from './bindings/op-sqlite';
import { SchemaArtifact } from './contract';
import { deleteStorage, hasSavedData } from './index';

const notes: SchemaArtifact = {
  schemaVersion: 1,
  collections: { Notes: { id: 'c1', tombstones: [], fields: { title: { id: 'f1', type: 'text' } } } },
};

export interface SavedDataVerdict {
  neverRanThenInit: boolean;
  kvOnly: boolean;
  schemaOnly: boolean;
}

const KV_ONLY = 'saved-data-kv-only';
const SCHEMA_ONLY = 'saved-data-schema-only';

/** The tables `appId`'s store holds, sqlite's own excluded, and the collections its `_meta` records. */
function storeShape(appId: string): { tables: string[]; applied: string[] } {
  const sql = createOpSqlExecutor({ appId, mode: 'persistent' });
  try {
    const tables = sql
      .execute(`SELECT name FROM sqlite_master WHERE type = 'table'`)
      .rows.map(r => r.name as string)
      .filter(name => !name.startsWith('sqlite_'))
      .sort((a, b) => a.localeCompare(b));
    return { tables, applied: readAppliedSchema(sql).collections.map(c => c.id) };
  } finally {
    sql.close();
  }
}

/** Every check is evaluated and reported (no short-circuit); true iff all held. */
function allHeld(results: boolean[]): boolean {
  return results.every(Boolean);
}

export function runSavedDataDeviceSteps(check: (cond: boolean, msg: string) => boolean): SavedDataVerdict {
  // An id no earlier launch can have used.
  const neverRan = `saved-data-never-${Date.now()}`;
  try {
    const firstAnswer = hasSavedData({ appId: neverRan });
    const blank = storeShape(neverRan);
    const engine = createEngine(createOpSqlExecutor({ appId: neverRan, mode: 'persistent' }));
    engine.open(notes);
    engine.records.append('Notes', { title: 'first run' });
    engine.close();
    const initialised = storeShape(neverRan);
    const neverRanThenInit = allHeld([
      check(firstAnswer === false, 'savedData: a never-run store is not saved'),
      check(blank.tables.length === 0, 'savedData: the read wrote a table into a never-run store'),
      check(initialised.tables.join() === '_meta,c1,kv' && initialised.applied.join() === 'c1', 'savedData: the engine did not initialise the store the read left'),
      check(hasSavedData({ appId: neverRan }) === true, 'savedData: a row written on the first run is not found'),
    ]);

    deleteStorage({ appId: KV_ONLY });
    const kv = createEngine(createOpSqlExecutor({ appId: KV_ONLY, mode: 'persistent' }));
    kv.kv.set('theme', 'dark');
    kv.close();
    const kvOnly = check(hasSavedData({ appId: KV_ONLY }) === true, 'savedData: a kv-only store is not saved');

    deleteStorage({ appId: SCHEMA_ONLY });
    const schema = createEngine(createOpSqlExecutor({ appId: SCHEMA_ONLY, mode: 'persistent' }));
    schema.open(notes);
    schema.close();
    const schemaAnswer = hasSavedData({ appId: SCHEMA_ONLY });
    const schemaOnly = allHeld([
      check(schemaAnswer === false, 'savedData: a schema-only store is saved'),
      check(storeShape(SCHEMA_ONLY).tables.join() === '_meta,c1,kv', 'savedData: the read changed a schema-only store'),
    ]);
    return { neverRanThenInit, kvOnly, schemaOnly };
  } finally {
    deleteStorage({ appId: neverRan });
    deleteStorage({ appId: KV_ONLY });
    deleteStorage({ appId: SCHEMA_ONLY });
  }
}
