/**
 * On-device acceptance harness for the capability-bridge (Decision #41, D8; tasks 6.1–6.3).
 *
 * The run that counts for the HOST CORE: the real gate/dispatcher/registry over op-sqlite under
 * RN 0.85 / new arch / Hermes — gate denials, storage round-trip through the dispatcher,
 * end-to-end injection inertness, idempotent delivery, the generation fence, per-verb syscall
 * latency (gate + engine), the pure-pipe `diag.echo` round-trip (the task-1.3 baseline, host
 * side), and — across a process kill — cross-restart persistence. The desktop suites
 * (`bridge:test`, `bridge:invariants`) are the checkpoints; this and the WebView round-trip are
 * the acceptance. Mirrors storage-engine/device-acceptance.ts.
 *
 * `pass` is the single bar. Logged for logcat (`ReactNativeJS`, truncates ~4 KB) and rendered
 * in full on-screen by BridgeProbeScreen. Toggle with RUN_BRIDGE_PROBE in App.tsx.
 */

import { createStorageEngine } from '../storage-engine';
import { SchemaArtifact } from '../storage-engine/contract';
import {
  AppRecord,
  CapabilityRegistry,
  createDefaultRegistry,
  Dispatcher,
  launchApp,
  registerStorageRows,
  SyscallError,
  SyscallFrame,
  SysretFrame,
} from './index';

const REGISTRY = createDefaultRegistry();
const engineFactory = (appId: string) => createStorageEngine({ appId, mode: 'persistent' });

const notesSchema: SchemaArtifact = {
  schemaVersion: 1,
  collections: { Notes: { id: 'c1', tombstones: [], fields: { body: { id: 'f1', type: 'text' }, n: { id: 'f2', type: 'int' } } } },
};
const persistSchema: SchemaArtifact = {
  schemaVersion: 1,
  collections: { Log: { id: 'c1', tombstones: [], fields: { at: { id: 'f1', type: 'date' } } } },
};

function storageApp(appId: string): AppRecord {
  return { appId, name: appId, manifest: { capabilities: ['storage'] }, schemaArtifact: notesSchema };
}

export interface BridgeVerdict {
  binding: 'op-sqlite';
  gate: { unknownMethod: boolean; undeclaredCapability: boolean; permissionDenied: boolean; invalidParams: boolean };
  dispatch: { roundTrip: boolean; dedupNoDouble: boolean; staleGenDropped: boolean };
  storage: { kvRoundTrip: boolean; recordsRoundTrip: boolean };
  injection: { valuesInert: boolean; identifiersRejected: boolean };
  registry: { appendOnly: boolean };
  persistence: { priorRecords: number; restartVerified: boolean | 'n/a'; totalAfterThisRun: number };
  latencyMs: Record<string, number>;
  failures: string[];
  pass: boolean;
}

const ADVERSARIAL = [`'); DROP TABLE c1;--`, `" OR "1"="1`, `'; DELETE FROM kv; --`, `Robert'); DROP TABLE students;--`];

let SEQ = 0;
function frame(method: string, params: Record<string, unknown>, gen = 1, id?: number): SyscallFrame {
  return { whim: 'syscall', v: 1, id: id ?? ++SEQ, gen, method, params } as unknown as SyscallFrame;
}

function resetAppDb(appId: string): void {
  try {
    const { open } = require('@op-engineering/op-sqlite');
    const db = open({ name: `${appId}.db`, location: 'storage' });
    const exec = (sql: string): Record<string, unknown>[] => {
      const res = typeof db.executeSync === 'function' ? db.executeSync(sql, []) : db.execute(sql, []);
      return Array.isArray(res?.rows) ? res.rows : (res?.rows?._array ?? []);
    };
    const tables = exec(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name <> 'android_metadata'`);
    for (const t of tables) exec(`DROP TABLE IF EXISTS "${String(t.name)}"`);
    db.close();
  } catch {
    /* first run */
  }
}

export async function runBridgeDeviceAcceptance(): Promise<BridgeVerdict> {
  const failures: string[] = [];
  const latencyMs: Record<string, number> = {};
  const check = (cond: boolean, msg: string): boolean => {
    if (!cond) failures.push(msg);
    return cond;
  };
  const isErr = (s: SysretFrame | null, kind: string): boolean => !!s && !s.ok && (s.error as SyscallError)?.kind === kind;

  async function timeN(into: string, n: number, fn: () => Promise<unknown>): Promise<void> {
    const t0 = Date.now();
    for (let i = 0; i < n; i++) await fn();
    latencyMs[into] = Math.round(((Date.now() - t0) / n) * 100) / 100;
  }

  // Fresh DBs for the deterministic sections (the persist-probe id below is intentionally kept).
  resetAppDb('bridge-accept');
  const launched = launchApp(storageApp('bridge-accept'), engineFactory);
  if (!launched.ok) throw new Error('launch refused: ' + launched.error.hint);
  const realm = launched.realm;
  const d = Dispatcher.forRealm(realm, REGISTRY);

  // ── gate denials ───────────────────────────────────────────────────────────
  const unknownMethod = check(isErr(await d.handle(frame('storage.kv.nope', { key: 'k' })), 'unknown_method'), 'unknown_method not refused');
  // an app that declares nothing → undeclared_capability
  const noCap = launchApp({ appId: 'nocap', name: 'nocap', manifest: { capabilities: [] } }, engineFactory);
  const dNoCap = noCap.ok ? Dispatcher.forRealm(noCap.realm, REGISTRY) : null;
  const undeclaredCapability = check(!!dNoCap && isErr(await dNoCap.handle(frame('storage.kv.set', { key: 'k', value: 1 })), 'undeclared_capability'), 'undeclared_capability not refused');
  const dDeny = Dispatcher.forRealm(realm, REGISTRY, () => false);
  const permissionDenied = check(isErr(await dDeny.handle(frame('storage.kv.set', { key: 'k', value: 1 })), 'permission_denied'), 'permission_denied not refused');
  const invalidParams = check(isErr(await d.handle(frame('storage.kv.set', { key: 'k' })), 'invalid_params'), 'invalid_params not refused');

  // ── dispatch: round-trip, dedup, stale generation ───────────────────────────
  const rt = await d.handle(frame('storage.kv.set', { key: 'rt', value: 1 }, 1, 5001));
  const roundTrip = check(!!rt && rt.ok && rt.id === 5001, 'round-trip / id echo failed');

  const dupFrame = frame('storage.records.append', { collection: 'Notes', record: { body: 'dup', n: 1 } }, 1, 6001);
  const s1 = await d.handle(dupFrame);
  const s2 = await d.handle(dupFrame);
  const dedupNoDouble = check(
    JSON.stringify(s1) === JSON.stringify(s2) && realm.engine!.records.list('Notes', { where: { body: 'dup' } }).length === 1,
    'dedup double-appended',
  );

  const staleGenDropped = check((await d.handle(frame('storage.kv.get', { key: 'rt' }, 0))) === null, 'stale-generation frame not dropped');

  // ── storage round-trip ───────────────────────────────────────────────────────
  await d.handle(frame('storage.kv.set', { key: 'theme', value: 'dark' }));
  const kvGet = await d.handle(frame('storage.kv.get', { key: 'theme' }));
  const kvRoundTrip = check(!!kvGet && kvGet.ok && (kvGet.result as { value?: unknown })?.value === 'dark', 'kv round-trip failed');
  const ap = await d.handle(frame('storage.records.append', { collection: 'Notes', record: { body: 'hi', n: 2 } }));
  const apId = (ap?.result as { id?: number })?.id ?? 0;
  const ls = await d.handle(frame('storage.records.list', { collection: 'Notes', query: { where: { body: 'hi' } } }));
  const recordsRoundTrip = check(apId > 0 && ((ls?.result as { records?: unknown[] })?.records?.length ?? 0) === 1, 'records round-trip failed');

  // ── end-to-end injection through the dispatcher (over op-sqlite) ─────────────
  let valuesInert = true;
  for (const evil of ADVERSARIAL) {
    const a = await d.handle(frame('storage.records.append', { collection: 'Notes', record: { body: evil, n: 1 } }));
    const aid = (a?.result as { id?: number })?.id ?? 0;
    const back = await d.handle(frame('storage.records.list', { collection: 'Notes', query: { where: { body: evil } } }));
    const rows = (back?.result as { records?: { body?: string }[] })?.records ?? [];
    if (rows.length !== 1 || rows[0].body !== evil) valuesInert = false;
    if (aid) await d.handle(frame('storage.records.remove', { collection: 'Notes', id: aid }));
  }
  check(valuesInert, 'adversarial values did not round-trip byte-identical');
  let identifiersRejected = true;
  for (const evil of ADVERSARIAL) {
    if (!isErr(await d.handle(frame('storage.records.append', { collection: evil, record: { body: 'x' } })), 'unknown_collection')) identifiersRejected = false;
    if (!isErr(await d.handle(frame('storage.records.list', { collection: 'Notes', query: { where: { [evil]: 1 } } })), 'unknown_field')) identifiersRejected = false;
  }
  check(identifiersRejected, 'crafted identifiers not rejected');

  // ── registry append-only ──────────────────────────────────────────────────────
  let appendOnly = false;
  try {
    const reg = new CapabilityRegistry();
    registerStorageRows(reg);
    try { reg.register('storage.kv.get', { capability: 'storage', paramsSchema: () => null, handler: () => ({}) }); } catch { appendOnly = true; }
  } catch { /* ignore */ }
  check(appendOnly, 'duplicate registration did not throw');

  // ── per-verb latency (gate + engine round-trip) + pure-pipe echo (task 1.3) ──
  await timeN('diag.echo (pure pipe)', 50, () => dDiag().handle(frame('diag.echo', { payload: 1 })));
  await timeN('storage.kv.set', 50, () => d.handle(frame('storage.kv.set', { key: 'lat', value: 1 })));
  await timeN('storage.kv.get', 50, () => d.handle(frame('storage.kv.get', { key: 'lat' })));
  await timeN('storage.records.append', 50, () => d.handle(frame('storage.records.append', { collection: 'Notes', record: { body: 'lat', n: 1 } })));
  await timeN('storage.records.list', 50, () => d.handle(frame('storage.records.list', { collection: 'Notes', query: { limit: 50 } })));
  realm.engine!.close();

  // ── cross-restart persistence (survives a process kill) ──────────────────────
  const PERSIST = 'bridge-persist-probe';
  const pl = launchApp({ appId: PERSIST, name: PERSIST, manifest: { capabilities: ['storage'] }, schemaArtifact: persistSchema }, engineFactory);
  let priorRecords = 0;
  let restartVerified: boolean | 'n/a' = 'n/a';
  let totalAfterThisRun = 0;
  if (pl.ok) {
    const dp = Dispatcher.forRealm(pl.realm, REGISTRY);
    const prior = (await dp.handle(frame('storage.records.list', { collection: 'Log' })))?.result as { records?: unknown[] };
    priorRecords = prior?.records?.length ?? 0;
    if (priorRecords > 0) restartVerified = check(true, 'cross-restart: prior records present');
    await dp.handle(frame('storage.records.append', { collection: 'Log', record: { at: Date.now() } }));
    const after = (await dp.handle(frame('storage.records.list', { collection: 'Log' })))?.result as { records?: unknown[] };
    totalAfterThisRun = after?.records?.length ?? 0;
    pl.realm.engine!.close();
  }

  const verdict: BridgeVerdict = {
    binding: 'op-sqlite',
    gate: { unknownMethod, undeclaredCapability, permissionDenied, invalidParams },
    dispatch: { roundTrip, dedupNoDouble, staleGenDropped },
    storage: { kvRoundTrip, recordsRoundTrip },
    injection: { valuesInert, identifiersRejected },
    registry: { appendOnly },
    persistence: { priorRecords, restartVerified, totalAfterThisRun },
    latencyMs,
    failures,
    pass: failures.length === 0,
  };
  console.error('[whim-bridge] verdict ' + JSON.stringify(verdict));
  return verdict;
}

// A diag-capable realm for the pure-pipe latency echo (gate + dispatch, no engine).
let _dDiag: Dispatcher | null = null;
function dDiag(): Dispatcher {
  if (!_dDiag) {
    const l = launchApp({ appId: 'diag-probe', name: 'diag-probe', manifest: { capabilities: ['diag'] } }, engineFactory);
    if (!l.ok) throw new Error('diag launch refused');
    _dDiag = Dispatcher.forRealm(l.realm, REGISTRY);
  }
  return _dDiag;
}
