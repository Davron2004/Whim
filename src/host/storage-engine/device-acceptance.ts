/**
 * On-device acceptance harness for the storage engine (Decision #40, D7; tasks 7.2/7.3).
 *
 * This is the run that actually counts: op-sqlite under RN 0.85 / new arch / Hermes, the
 * full verb lifecycle + schema evolution (add / rename / tombstone / rollback-shaped reopen),
 * the KV cap, per-verb latency at a realistic Tier-0 volume, the DB file size, and — across
 * a process kill — cross-restart integrity. Node-green (test/acceptance.ts) is only the
 * checkpoint; this is the acceptance. Mirrors the version store's device-acceptance.ts.
 *
 * `pass` is the single bar: every section green, 0 failures. The verdict is logged for
 * logcat (`ReactNativeJS`, truncates ~4 KB) and rendered on-screen in full by the probe.
 */

import { createStorageEngine } from './index';
import { createEngine } from './engine';
import { createOpSqlExecutor } from './bindings/op-sqlite';
import { SchemaArtifact, StorageEngine, StorageEngineError } from './contract';

// Realistic Tier-0 volume for a spending tracker (a few thousand ledger rows).
const LEDGER_VOLUME = 2000;
const KV_CAP = 32 * 1024;

const ledgerV1: SchemaArtifact = {
  schemaVersion: 1,
  collections: {
    Expenses: {
      id: 'c1',
      tombstones: [],
      fields: {
        amount: { id: 'f1', type: 'int' },
        note: { id: 'f2', type: 'text' },
        spentAt: { id: 'f3', type: 'date' },
      },
    },
  },
};

// v2: add `category` (additive), rename `note` → `memo` (same id f2).
const ledgerV2: SchemaArtifact = {
  schemaVersion: 1,
  collections: {
    Expenses: {
      id: 'c1',
      tombstones: [],
      fields: {
        amount: { id: 'f1', type: 'int' },
        memo: { id: 'f2', type: 'text' },
        spentAt: { id: 'f3', type: 'date' },
        category: { id: 'f4', type: 'text', default: 'uncategorized' },
      },
    },
  },
};

// v3: tombstone `category` (f4) and reuse the display name with a fresh id f5.
const ledgerV3: SchemaArtifact = {
  schemaVersion: 1,
  collections: {
    Expenses: {
      id: 'c1',
      tombstones: ['f4'],
      fields: {
        amount: { id: 'f1', type: 'int' },
        memo: { id: 'f2', type: 'text' },
        spentAt: { id: 'f3', type: 'date' },
        category: { id: 'f5', type: 'text', default: 'none' },
      },
    },
  },
};

export interface StorageVerdict {
  binding: 'op-sqlite';
  schema: { applyV1: boolean; additiveV2: boolean; renameServed: boolean; tombstoneFreshId: boolean; rollbackShapedNoLoss: boolean };
  verbs: { append: boolean; list: boolean; filteredList: boolean; update: boolean; partialUpdateIntact: boolean; remove: boolean; kv: boolean; kvCapEnforced: boolean };
  ephemeral: { isolated: boolean };
  volume: { records: number };
  dbSizeBytes: number | null;
  persistence: { priorRecords: number; restartVerified: boolean | 'n/a'; totalAfterThisRun: number };
  latencyMs: Record<string, number>;
  failures: string[];
  pass: boolean;
}

function time<T>(into: Record<string, number>, key: string, fn: () => T): T {
  const t0 = Date.now();
  const r = fn();
  into[key] = Date.now() - t0;
  return r;
}

/** Drop every engine table for an app so the next open starts clean (host-side trusted;
 *  table names come from sqlite_master, never from caller input). No-op on the first run. */
function resetAppDb(appId: string): void {
  try {
    const { open } = require('@op-engineering/op-sqlite');
    const db = open({ name: `${appId}.db`, location: 'storage' });
    const exec = (sql: string): Record<string, unknown>[] => {
      const res = db.executeSync(sql, []);
      return Array.isArray(res?.rows) ? res.rows : (res?.rows?._array ?? []);
    };
    const tables = exec(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name <> 'android_metadata'`);
    for (const t of tables) exec(`DROP TABLE IF EXISTS "${String(t.name)}"`);
    db.close();
  } catch {
    /* first run: nothing to reset */
  }
}

/** Best-effort DB byte size via a raw op-sqlite pragma (host-side trusted; not a verb). */
function dbSizeBytes(appId: string): number | null {
  try {
    const { open } = require('@op-engineering/op-sqlite');
    const db = open({ name: `${appId}.db`, location: 'storage' });
    const run = (sql: string): number => {
      const res = db.executeSync(sql, []);
      const rows = Array.isArray(res?.rows) ? res.rows : (res?.rows?._array ?? []);
      const row = rows[0] ?? {};
      return Number(row[Object.keys(row)[0]] ?? 0);
    };
    const bytes = run('PRAGMA page_count') * run('PRAGMA page_size');
    db.close();
    return bytes;
  } catch {
    return null;
  }
}

export function runStorageDeviceAcceptance(): StorageVerdict {
  const failures: string[] = [];
  const latencyMs: Record<string, number> = {};
  const check = (cond: boolean, msg: string): boolean => {
    if (!cond) failures.push(msg);
    return cond;
  };

  const APP = 'storage-accept';

  // The deterministic sections (evolution + verbs + latency + size) assume a clean slate, so
  // reset this app's persistent DB each launch — otherwise a relaunch reopens last run's
  // accumulated schema + leftover rows and the fresh-DB assertions misfire. (The vstore
  // acceptance gets this for free by running its deterministic core on a fresh MemoryFs; an
  // op-sqlite file persists, so we drop it explicitly.) The cross-restart section below uses
  // a SEPARATE app id that is intentionally never reset.
  resetAppDb(APP);
  const store: StorageEngine = createStorageEngine({ appId: APP, mode: 'persistent', kvSizeCapBytes: KV_CAP });

  // ── schema apply v1 ────────────────────────────────────────────────────────
  const applyV1 = check(safe(() => store.open(ledgerV1)), 'open(v1) failed');

  // ── verbs at volume + latency ──────────────────────────────────────────────
  let firstId = 0;
  time(latencyMs, `append_x${LEDGER_VOLUME}`, () => {
    for (let i = 0; i < LEDGER_VOLUME; i++) {
      const { id } = store.records.append('Expenses', { amount: i, note: `row ${i}`, spentAt: 1700000000000 + i * 1000 });
      if (i === 0) firstId = id;
    }
  });
  const all = time(latencyMs, 'list_all', () => store.records.list('Expenses'));
  const append = check(firstId > 0, 'append returned no id');
  const list = check(all.length >= LEDGER_VOLUME, `list returned ${all.length}, expected ≥ ${LEDGER_VOLUME}`);

  const filtered = time(latencyMs, 'filtered_list', () =>
    store.records.list('Expenses', { where: { amount: { gte: 10, lt: 20 } }, orderBy: { field: 'amount', direction: 'asc' }, limit: 5 }),
  );
  const filteredList = check(filtered.length === 5 && filtered[0].amount === 10, 'filtered/ordered/limited list wrong');

  time(latencyMs, 'update', () => store.records.update('Expenses', firstId, { amount: 99999 }));
  const afterUpdate = store.records.list('Expenses', { where: { spentAt: 1700000000000 } })[0];
  const update = check(afterUpdate?.amount === 99999, 'update did not apply');
  const partialUpdateIntact = check(afterUpdate?.note === 'row 0', 'partial update clobbered an unnamed field');

  time(latencyMs, 'remove', () => store.records.remove('Expenses', firstId));
  const remove = check(store.records.list('Expenses', { where: { spentAt: 1700000000000 } }).length === 0, 'remove did not hard-delete');

  // ── kv + cap ───────────────────────────────────────────────────────────────
  time(latencyMs, 'kv_set', () => store.kv.set('lastOpened', Date.now()));
  const kv = check(typeof store.kv.get('lastOpened') === 'number', 'kv round-trip failed');
  let kvCapEnforced = false;
  try {
    store.kv.set('huge', 'x'.repeat(KV_CAP + 1));
  } catch (err) {
    kvCapEnforced = err instanceof StorageEngineError && err.detail.kind === 'kv_too_large';
  }
  check(kvCapEnforced, 'KV size cap not enforced');

  // ── evolution: additive v2 + rename served ─────────────────────────────────
  const seedNote = store.records.append('Expenses', { amount: 7, note: 'rename-probe', spentAt: 1 });
  const additiveV2 = check(safe(() => store.open(ledgerV2)), 'open(v2) additive failed');
  const renamedRow = store.records.list('Expenses', { where: { spentAt: 1 } })[0];
  const renameServed = check(renamedRow?.memo === 'rename-probe' && renamedRow?.category === 'uncategorized', 'rename did not serve old data / default not backfilled');

  // ── evolution: tombstone + fresh-id reuse of display name ───────────────────
  store.records.update('Expenses', seedNote.id, { category: 'travel' }); // writes f4
  const tombstoneApplied = check(safe(() => store.open(ledgerV3)), 'open(v3) tombstone failed');
  const afterTombstone = store.records.list('Expenses', { where: { spentAt: 1 } })[0];
  // The reused display name now maps to the FRESH column f5 (default 'none'), not stale f4 data.
  const tombstoneFreshId = check(tombstoneApplied && afterTombstone?.category === 'none', 'tombstoned display-name reuse resurrected stale data');

  // ── evolution: rollback-shaped reopen loses nothing ─────────────────────────
  const rollbackShapedNoLoss = check(safe(() => store.open(ledgerV1)), 'older-subset reopen refused') &&
    check(store.records.list('Expenses', { where: { spentAt: 1 } })[0]?.note === 'rename-probe', 'older code lost data on rollback-shaped reopen');

  store.close();
  const dbSize = dbSizeBytes(APP);

  // ── ephemeral isolation ────────────────────────────────────────────────────
  const ephem = createEngine(createOpSqlExecutor({ appId: 'ephemeral-probe', mode: 'ephemeral' }), { kvSizeCapBytes: KV_CAP });
  ephem.open(ledgerV1);
  ephem.records.append('Expenses', { amount: 1, note: 'ghost' });
  ephem.close();
  const persistedSameApp = createStorageEngine({ appId: 'ephemeral-probe', mode: 'persistent' });
  persistedSameApp.open(ledgerV1);
  const isolated = check(persistedSameApp.records.list('Expenses').length === 0, 'ephemeral writes leaked into the persistent store');
  persistedSameApp.close();

  // ── cross-restart persistence (5.2/5.3): survives a process kill ────────────
  const PERSIST = 'storage-persist-probe';
  const ps = createStorageEngine({ appId: PERSIST, mode: 'persistent' });
  ps.open(ledgerV1);
  const prior = ps.records.list('Expenses');
  const priorRecords = prior.length;
  let restartVerified: boolean | 'n/a' = 'n/a';
  if (priorRecords > 0) {
    restartVerified = check(prior.every(r => typeof r.note === 'string'), 'cross-restart: prior records not all readable');
  }
  ps.records.append('Expenses', { amount: priorRecords + 1, note: `persist ${priorRecords + 1}`, spentAt: Date.now() });
  const totalAfterThisRun = ps.records.list('Expenses').length;
  ps.close();

  const verdict: StorageVerdict = {
    binding: 'op-sqlite',
    schema: { applyV1, additiveV2, renameServed, tombstoneFreshId, rollbackShapedNoLoss },
    verbs: { append, list, filteredList, update, partialUpdateIntact, remove, kv, kvCapEnforced },
    ephemeral: { isolated },
    volume: { records: all.length },
    dbSizeBytes: dbSize,
    persistence: { priorRecords, restartVerified, totalAfterThisRun },
    latencyMs,
    failures,
    pass: failures.length === 0,
  };

  // logcat (truncates ~4 KB → the screen renders the full object too).
  console.error('[whim-storage] verdict ' + JSON.stringify(verdict));
  return verdict;
}

function safe(fn: () => void): boolean {
  try {
    fn();
    return true;
  } catch {
    return false;
  }
}
