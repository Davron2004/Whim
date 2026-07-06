/**
 * On-device acceptance harness (tasks 1.3, 5.2, 5.3, 7.2, 7.3).
 *
 * This is the run that actually counts (Decision #36 D7): Hermes load, the full verb
 * lifecycle, compaction, on-device storage/latency, and — when a persistent KV backend
 * is supplied — cross-app-restart integrity. Node-green (test/acceptance.ts) is only the
 * checkpoint. Driven by a programmatic fixture (the real generation loop wires in later),
 * exactly as the spike was.
 *
 * The CORE sections (Hermes load + lifecycle + compaction + reliability) run over the
 * in-memory MemoryFs — ZERO native modules, the substrate the spike validated on-device.
 * The PERSISTENCE section (5.2/5.3) only runs when a real KV backend (MMKV) is passed;
 * it is what proves the repo survives a process kill.
 *
 * `pass` is the single bar: every section green, 0 failures. The verdict is logged for
 * logcat (`ReactNativeJS`, truncates ~4 KB) and rendered on-screen in full.
 */

import './polyfills';
import * as git from 'isomorphic-git';
import { VersionStore } from './engine';
import { MemoryFs } from './fs/memory-fs';
import { KvBackedFs, KVBackend } from './fs/kv-fs';
import { assertNoGitLeak } from './index';

const BUNDLE = (v: number) => `import { defineApp } from 'vc-sdk';\nexport default defineApp({ v: ${v} });\n`;

export interface DeviceVerdict {
  gitVersion: string;
  hermesLoad: { initOk: boolean };
  lifecycle: {
    snapshots: number;
    historyOk: boolean;
    diffOk: boolean;
    rollbackOk: boolean;
    pinOk: boolean;
    forkOk: boolean;
    noMergeOk: boolean;
    gitNeverExposed: boolean;
  };
  compaction: { before: number; after: number; packed: number; integrityOk: boolean };
  persistence: { backend: 'mmkv' | 'none'; priorGenerations: number; restartVerified: boolean | 'n/a'; totalAfterThisRun: number };
  reliability: { cyclesOk: boolean };
  storage: { looseObjects: number; kvKeys: number };
  latencyMs: Record<string, number>;
  failures: string[];
  pass: boolean;
}

async function time<T>(into: Record<string, number>, key: string, fn: () => Promise<T>): Promise<T> {
  const t0 = Date.now();
  const r = await fn();
  into[key] = Date.now() - t0;
  return r;
}

export interface DeviceAcceptanceOptions {
  /** A persistent KV backend (MMKV). When present, the cross-restart section runs. */
  kv?: KVBackend;
}

export async function runDeviceAcceptance(opts: DeviceAcceptanceOptions = {}): Promise<DeviceVerdict> {
  const failures: string[] = [];
  const latencyMs: Record<string, number> = {};
  const check = (cond: boolean, msg: string) => {
    if (!cond) failures.push(msg);
    return cond;
  };

  const gitVersion = git.version();

  // --- 1.3 Hermes load: isomorphic-git loaded; git.init runs (proven by snapshotting).
  let initOk = false;
  try {
    const probe = new VersionStore({ backend: new MemoryFs(), config: { autoCompact: false } });
    await probe.snapshot('hermes-load', { 'bundle.js': BUNDLE(0) }, 'hermes load probe');
    initOk = true;
  } catch (err) {
    failures.push(`hermes load / git.init failed: ${(err as Error).message}`);
  }

  // --- 7.2 full lifecycle (mini-app-versioning + forking) + 7.3 latency, in-memory.
  const APP = 'accept-app';
  const fresh = new VersionStore({ backend: new MemoryFs(), config: { autoCompact: false } });

  await time(latencyMs, 'snapshot', () => fresh.snapshot(APP, { 'bundle.js': BUNDLE(1), 'manifest.json': '{}' }, 'gen 1'));
  for (let v = 2; v <= 6; v++) {
    await fresh.snapshot(APP, { 'bundle.js': BUNDLE(v), 'manifest.json': '{}' }, `gen ${v}`);
  }
  const hist = await time(latencyMs, 'history', () => fresh.history(APP));
  const historyOk = check(hist.length === 6 && hist[0].prompt === 'gen 6', 'history wrong');

  const changes = await time(latencyMs, 'diff', () => fresh.diff(APP, 'g1', 'g6'));
  const diffOk = check(changes.some(c => c.file === 'bundle.js' && c.status === 'modified'), 'diff wrong');

  await time(latencyMs, 'rollback', () => fresh.rollback(APP, 'g2'));
  const rollbackOk = check((await fresh.active(APP))?.artifacts['bundle.js'] === BUNDLE(2), 'rollback wrong');
  await fresh.rollback(APP, 'g6'); // non-destructive: g6 still returnable

  await time(latencyMs, 'pin', () => fresh.pin(APP, 'g3', 'milestone'));
  const pinOk = check((await fresh.getPinned(APP, 'milestone')).artifacts['bundle.js'] === BUNDLE(3), 'pin wrong');

  const { lineageId } = await time(latencyMs, 'fork', () => fresh.fork(APP, 'g1'));
  await fresh.snapshot(APP, { 'bundle.js': BUNDLE(99), 'manifest.json': '{}' }, 'fork edit');
  const g6 = await fresh.getSnapshot(APP, 'g6');
  const forkOk = check(lineageId === 'fork-1' && g6.artifacts['bundle.js'] === BUNDLE(6), 'fork not independent');
  const lineages = await fresh.lineages(APP);
  const noMergeOk = check(lineages.includes('main') && lineages.includes('fork-1'), 'lineages missing (no-merge)');

  let gitNeverExposed = true;
  try {
    assertNoGitLeak(hist, 'history');
    assertNoGitLeak(await fresh.listPins(APP), 'pins');
    assertNoGitLeak({ lineageId }, 'fork');
    assertNoGitLeak(changes.map(c => ({ file: c.file, status: c.status })), 'diff');
  } catch (err) {
    gitNeverExposed = false;
    failures.push(`git leaked to surface: ${(err as Error).message}`);
  }

  // --- §4 compaction on-device + integrity (4.3).
  const cStore = new VersionStore({ backend: new MemoryFs(), config: { autoCompact: false } });
  const COMPACT = 'compact-app';
  for (let v = 1; v <= 12; v++) await cStore.snapshot(COMPACT, { 'bundle.js': BUNDLE(v) }, `c${v}`);
  await cStore.pin(COMPACT, 'g4', 'cpin');
  const compaction = await time(latencyMs, 'compact', () => cStore.compact(COMPACT));
  const integrityOk = check(
    (await cStore.history(COMPACT)).length === 12 &&
      (await cStore.getPinned(COMPACT, 'cpin')).artifacts['bundle.js'] === BUNDLE(4),
    'post-compaction integrity failed',
  );
  check(compaction.after < compaction.before, 'compaction did not reduce loose objects');

  // --- 5.3 reliability: repeated commit/checkout cycles, assert no corruption.
  let cyclesOk = true;
  try {
    const relStore = new VersionStore({ backend: new MemoryFs(), config: { autoCompact: false } });
    for (let i = 1; i <= 20; i++) {
      await relStore.snapshot('reliab', { 'bundle.js': BUNDLE(i) }, `r${i}`);
      await relStore.rollback('reliab', 'g1');
      await relStore.rollback('reliab', `g${i}`);
    }
    cyclesOk = (await relStore.history('reliab')).length === 20;
  } catch (err) {
    cyclesOk = false;
    failures.push(`reliability cycles failed: ${(err as Error).message}`);
  }
  check(cyclesOk, 'reliability: repeated commit/checkout cycles corrupted the repo');

  // --- 5.2/5.3 cross-restart persistence — only with a real KV backend (MMKV).
  let persistBackend: 'mmkv' | 'none' = 'none';
  let priorGenerations = 0;
  let restartVerified: boolean | 'n/a' = 'n/a';
  let totalAfterThisRun = 0;
  let kvKeys = 0;
  if (opts.kv) {
    persistBackend = 'mmkv';
    const kv = opts.kv;
    const PERSIST = 'persist-probe';
    const kvFs = new KvBackedFs(kv);
    const store = new VersionStore({ backend: kvFs, config: { autoCompact: false } });
    const priorHistory = await store.history(PERSIST);
    priorGenerations = priorHistory.length;
    if (priorGenerations > 0) {
      let allReadable = true;
      for (const snap of priorHistory) {
        try {
          await store.getSnapshot(PERSIST, snap.id);
        } catch {
          allReadable = false;
        }
      }
      const pinsSurvived = (await store.listPins(PERSIST)).some(p => p.label === 'good');
      const forkSurvived = (await store.lineages(PERSIST)).includes('fork-1');
      restartVerified = check(
        allReadable && pinsSurvived && forkSurvived,
        'cross-restart: prior snapshots/pins/forks did not all survive',
      );
    }
    await store.snapshot(PERSIST, { 'bundle.js': BUNDLE(priorGenerations + 1) }, `persist gen ${priorGenerations + 1}`);
    if (priorGenerations === 0) {
      await store.pin(PERSIST, 'g1', 'good');
      await store.fork(PERSIST, 'g1');
      await store.switchLineage(PERSIST, 'main');
    }
    totalAfterThisRun = (await store.history(PERSIST)).length;
    kvKeys = kvFs.kvKeyCount();
  }

  const verdict: DeviceVerdict = {
    gitVersion,
    hermesLoad: { initOk },
    lifecycle: { snapshots: 6, historyOk, diffOk, rollbackOk, pinOk, forkOk, noMergeOk, gitNeverExposed },
    compaction: { before: compaction.before, after: compaction.after, packed: compaction.packed, integrityOk },
    persistence: { backend: persistBackend, priorGenerations, restartVerified, totalAfterThisRun },
    reliability: { cyclesOk },
    storage: { looseObjects: fresh.looseObjectCount(APP), kvKeys },
    latencyMs,
    failures,
    pass: failures.length === 0,
  };

  // logcat (truncates ~4 KB → the screen renders the full object too).
  console.error('[whim-vstore] verdict ' + JSON.stringify(verdict));
  return verdict;
}
