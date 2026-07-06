/**
 * Node acceptance for the pure-JS core (task 7.1 / Decision #36 D7) — the cheap, fast
 * checkpoint over the in-memory + KV backends. Green here is NOT the pass (the device
 * run is, tasks 7.2–7.3); it is the correctness gate the engine must clear first.
 *
 * Covers every numbered behavior that does not require Hermes: the per-app repo
 * contract (§2), all product verbs (§3), compaction (§4), the KV serialize round-trip
 * (§5 logic, restart simulated in Node), the content-agnostic seams (§6), plus every
 * mini-app-versioning / mini-app-forking spec scenario (§7.4).
 */

import * as git from 'isomorphic-git';
import {
  createMemoryStore,
  createPersistentStore,
  KvBackedFs,
  MapKVBackend,
  MemoryFs,
  VersionStore,
  assertNoGitLeak,
} from '../index';

// --- tiny test harness -----------------------------------------------------

let passed = 0;
const failures: string[] = [];

function ok(cond: boolean, msg: string): void {
  if (cond) {
    passed++;
  } else {
    failures.push(msg);
    // eslint-disable-next-line no-console
    console.error('  ✗ ' + msg);
  }
}

function eq(a: unknown, b: unknown, msg: string): void {
  ok(JSON.stringify(a) === JSON.stringify(b), `${msg} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);
}

async function test(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    // eslint-disable-next-line no-console
    console.log('• ' + name);
  } catch (err) {
    failures.push(`${name}: threw ${(err as Error).message}`);
    // eslint-disable-next-line no-console
    console.error(`  ✗ ${name} THREW: ${(err as Error).stack}`);
  }
}

// A monotonic clock so snapshot timestamps strictly increase.
function clock(): () => number {
  let t = 1_700_000_000_000;
  return () => (t += 1000);
}

const BUNDLE = (v: number) => `import { defineApp } from 'vc-sdk';\nexport default defineApp({ v: ${v} });\n`;
const MANIFEST = (v: number) => JSON.stringify({ name: 'demo', version: v });

function freshStore(overrides = {}): VersionStore {
  return createMemoryStore({ now: clock(), autoCompact: false, ...overrides });
}

// --- §2 per-app repo + code-artifact contract ------------------------------

await test('§2.1 per-app repos are isolated', async () => {
  const s = freshStore();
  await s.snapshot('app-a', { 'bundle.js': BUNDLE(1) }, 'a gen1');
  await s.snapshot('app-b', { 'bundle.js': BUNDLE(99) }, 'b gen1');
  const a = await s.getSnapshot('app-a', 'g1');
  const b = await s.getSnapshot('app-b', 'g1');
  ok(a.artifacts['bundle.js'] === BUNDLE(1), 'app-a bundle is its own');
  ok(b.artifacts['bundle.js'] === BUNDLE(99), 'app-b bundle is its own');
  eq((await s.history('app-a')).length, 1, 'app-a has one snapshot');
});

await test('§2.2 the code-artifact set is tracked incl. prompt.md', async () => {
  const s = freshStore();
  await s.snapshot(
    'app',
    { 'bundle.js': BUNDLE(1), 'manifest.json': MANIFEST(1), 'LEARNED.md': '# learned' },
    'build it',
  );
  const snap = await s.getSnapshot('app', 'g1');
  const names = Object.keys(snap.artifacts).sort();
  eq(names, ['LEARNED.md', 'bundle.js', 'manifest.json', 'prompt.md'], 'all four artifacts tracked');
  eq(snap.artifacts['prompt.md'], 'build it', 'prompt is tracked as prompt.md');
});

await test('§2.3 code/data boundary — constructor refuses a data handle', async () => {
  let threw = false;
  try {
    // @ts-expect-error deliberately passing a forbidden data handle
    new VersionStore({ backend: new (await import('../fs/memory-fs')).MemoryFs(), dataStore: {} });
  } catch {
    threw = true;
  }
  ok(threw, 'VersionStore rejects a user-data handle');
});

// --- §3 product verbs (mini-app-versioning) --------------------------------

await test('§3.1 snapshot records prompt as message AND prompt.md', async () => {
  const s = freshStore();
  const snap = await s.snapshot('app', { 'bundle.js': BUNDLE(1) }, 'make a tip splitter');
  eq(snap.id, 'g1', 'first snapshot id is g1');
  eq(snap.prompt, 'make a tip splitter', 'snapshot carries its prompt');
  const content = await s.getSnapshot('app', 'g1');
  eq(content.artifacts['prompt.md'], 'make a tip splitter', 'prompt.md diffs/persists the prompt');
});

await test('§3.2 history lists snapshots with prompts, in order (spec: two traceable snapshots)', async () => {
  const s = freshStore();
  await s.snapshot('app', { 'bundle.js': BUNDLE(1) }, 'first prompt');
  await s.snapshot('app', { 'bundle.js': BUNDLE(2) }, 'second prompt');
  const hist = await s.history('app');
  eq(hist.length, 2, 'two snapshots exist');
  eq(hist[0].prompt, 'second prompt', 'newest first carries its prompt');
  eq(hist[1].prompt, 'first prompt', 'oldest carries its prompt');
  eq([hist[0].id, hist[1].id], ['g2', 'g1'], 'ids are ordered');
  assertNoGitLeak(hist, 'history');
});

await test('§3.3 diff shows the bundle change between two snapshots', async () => {
  const s = freshStore();
  await s.snapshot('app', { 'bundle.js': BUNDLE(1) }, 'p1');
  await s.snapshot('app', { 'bundle.js': BUNDLE(2) }, 'p2');
  const changes = await s.diff('app', 'g1', 'g2');
  const bundle = changes.find(c => c.file === 'bundle.js');
  ok(!!bundle && bundle.status === 'modified', 'bundle.js is modified');
  eq(bundle!.after, BUNDLE(2), 'diff carries the new content');
  assertNoGitLeak(changes.map(c => ({ file: c.file, status: c.status })), 'diff');
});

await test('§3.4 rollback is non-destructive (spec: gen1 active, gen2 still returnable)', async () => {
  const s = freshStore();
  await s.snapshot('app', { 'bundle.js': BUNDLE(1) }, 'p1');
  await s.snapshot('app', { 'bundle.js': BUNDLE(2) }, 'p2');
  await s.rollback('app', 'g1');
  const active = await s.active('app');
  eq(active!.artifacts['bundle.js'], BUNDLE(1), 'gen1 is the active bundle');
  // gen2 is still present and can be returned to
  const g2 = await s.getSnapshot('app', 'g2');
  eq(g2.artifacts['bundle.js'], BUNDLE(2), 'gen2 still recoverable');
  await s.rollback('app', 'g2');
  eq((await s.active('app'))!.artifacts['bundle.js'], BUNDLE(2), 'can return to gen2');
});

// --- ST-6: rollback is lineage-scoped (storage-semantic-guards §2) --------

await test('§ST-6a a cross-lineage snapshot id is refused; original lineage unchanged', async () => {
  const s = freshStore();
  await s.snapshot('app', { 'bundle.js': BUNDLE(1) }, 'p1'); // main: g1
  await s.snapshot('app', { 'bundle.js': BUNDLE(2) }, 'p2'); // main: g2
  await s.fork('app', 'g1'); // creates fork-1, checked out on the fork now
  const forkSnap = await s.snapshot('app', { 'bundle.js': BUNDLE(42) }, 'fork edit'); // g3, on fork-1 only
  await s.switchLineage('app', 'main'); // back to the original lineage

  const activeBefore = await s.active('app');
  eq(activeBefore!.id, 'g2', 'original lineage active id is g2 before the refused rollback');
  eq(activeBefore!.artifacts['bundle.js'], BUNDLE(2), 'original lineage active bundle before the refused rollback');

  let threw = false;
  let message = '';
  try {
    await s.rollback('app', forkSnap.id);
  } catch (err) {
    threw = true;
    message = (err as Error).message;
  }
  ok(threw, 'rollback() refuses a snapshot id from another lineage');
  ok(/not in the active lineage/.test(message), 'error names the active-lineage refusal');
  ok(/fork/.test(message) && /switchLineage/.test(message), 'error names fork/switchLineage as the sanctioned path');
  ok(!/\b(commit|ref|branch|ancestor)\b/i.test(message), 'error message carries no git vocabulary');

  const activeAfter = await s.active('app');
  eq(activeAfter!.id, 'g2', 'original lineage active id unchanged by the refused rollback');
  eq(activeAfter!.artifacts['bundle.js'], BUNDLE(2), 'original lineage active bundle unchanged by the refused rollback');
});

await test('§ST-6b rollback to generation 1 then roll forward to generation 2 both succeed', async () => {
  const s = freshStore();
  await s.snapshot('app', { 'bundle.js': BUNDLE(1) }, 'p1');
  await s.snapshot('app', { 'bundle.js': BUNDLE(2) }, 'p2');

  const back = await s.rollback('app', 'g1');
  eq(back.activeId, 'g1', 'rollback to g1 succeeds');
  eq((await s.active('app'))!.artifacts['bundle.js'], BUNDLE(1), 'g1 is the active bundle after rollback');

  const forward = await s.rollback('app', 'g2');
  eq(forward.activeId, 'g2', 'roll forward to g2 succeeds');
  eq((await s.active('app'))!.artifacts['bundle.js'], BUNDLE(2), 'g2 is the active bundle after rolling forward');
});

await test('§ST-6c rollback to the current tip succeeds', async () => {
  const s = freshStore();
  await s.snapshot('app', { 'bundle.js': BUNDLE(1) }, 'p1');
  await s.snapshot('app', { 'bundle.js': BUNDLE(2) }, 'p2'); // tip is g2

  const res = await s.rollback('app', 'g2');
  eq(res.activeId, 'g2', 'rollback to the current tip succeeds');
  eq((await s.active('app'))!.artifacts['bundle.js'], BUNDLE(2), 'active bundle unchanged when rolling back to the tip');
});

await test('§3.5 pin survives later generations (spec)', async () => {
  const s = freshStore();
  await s.snapshot('app', { 'bundle.js': BUNDLE(1) }, 'p1');
  const pin = await s.pin('app', 'g1', 'known-good');
  eq(pin.label, 'known-good', 'pin returns its label');
  for (let v = 2; v <= 5; v++) await s.snapshot('app', { 'bundle.js': BUNDLE(v) }, `p${v}`);
  const pinned = await s.getPinned('app', 'known-good');
  eq(pinned.artifacts['bundle.js'], BUNDLE(1), 'pinned bundle unchanged after later gens');
  assertNoGitLeak(await s.listPins('app'), 'pins');
});

await test('§3.5 pin label rejects spaces (ref name must be portable to real git)', async () => {
  const s = freshStore();
  await s.snapshot('app', { 'bundle.js': BUNDLE(1) }, 'p1');

  let threw = false;
  try {
    await s.pin('app', 'g1', 'known good');
  } catch (err) {
    threw = /invalid pin label/.test((err as Error).message);
  }
  ok(threw, 'pin() rejects a label containing a space');

  const dashPin = await s.pin('app', 'g1', 'known-good');
  eq(dashPin.label, 'known-good', 'pin() accepts a label with a dash');

  const underscorePin = await s.pin('app', 'g1', 'known_good');
  eq(underscorePin.label, 'known_good', 'pin() accepts a label with an underscore');
});

await test('§3.6 fork is independent (spec: fork advances, original unchanged)', async () => {
  const s = freshStore();
  await s.snapshot('app', { 'bundle.js': BUNDLE(1) }, 'p1');
  await s.snapshot('app', { 'bundle.js': BUNDLE(2) }, 'p2'); // main: g1 -> g2
  const { lineageId } = await s.fork('app', 'g1');
  assertNoGitLeak({ lineageId }, 'fork');
  await s.snapshot('app', { 'bundle.js': BUNDLE(42) }, 'fork edit'); // commits on the fork
  // original lineage (main) is unchanged
  const g2 = await s.getSnapshot('app', 'g2');
  eq(g2.artifacts['bundle.js'], BUNDLE(2), 'original gen2 unchanged by the fork');
  const lineages = await s.lineages('app');
  ok(lineages.includes('main') && lineages.includes(lineageId), 'both lineages exist');
  // both lineages remain usable, and nothing required a merge
  await s.switchLineage('app', 'main');
  eq((await s.active('app'))!.artifacts['bundle.js'], BUNDLE(2), 'main still usable after fork diverges');
});

await test('§3.7 git is never exposed across verb return shapes', async () => {
  const s = freshStore();
  await s.snapshot('app', { 'bundle.js': BUNDLE(1) }, 'p1');
  await s.snapshot('app', { 'bundle.js': BUNDLE(2) }, 'p2');
  await s.pin('app', 'g1', 'good');
  const fork = await s.fork('app', 'g1');
  assertNoGitLeak(await s.history('app'), 'history');
  assertNoGitLeak(await s.listPins('app'), 'pins');
  assertNoGitLeak(fork, 'fork');
  assertNoGitLeak(await s.lineages('app'), 'lineages');
});

// --- §4 compaction ---------------------------------------------------------

await test('§4 compaction drops loose objects; history/rollback/pin/fork still resolve', async () => {
  const s = freshStore();
  for (let v = 1; v <= 10; v++) await s.snapshot('app', { 'bundle.js': BUNDLE(v) }, `p${v}`);
  await s.pin('app', 'g3', 'milestone');
  const before = s.looseObjectCount('app');
  ok(before > 0, 'loose objects accumulate before compaction');
  const res = await s.compact('app');
  ok(res.after < res.before, `compaction reduced loose objects (${res.before} -> ${res.after})`);
  eq(s.looseObjectCount('app'), 0, 'all reachable loose objects packed away');
  // §4.3 integrity: every verb still resolves against the packed repo
  eq((await s.history('app')).length, 10, 'history intact post-pack');
  await s.rollback('app', 'g5');
  eq((await s.active('app'))!.artifacts['bundle.js'], BUNDLE(5), 'rollback works post-pack');
  eq((await s.getPinned('app', 'milestone')).artifacts['bundle.js'], BUNDLE(3), 'pin resolves post-pack');
  const { lineageId } = await s.fork('app', 'g2');
  eq((await s.active('app'))!.artifacts['bundle.js'], BUNDLE(2), 'fork checkout works post-pack');
  ok(lineageId === 'fork-1', 'fork created post-pack');
});

await test('§4.2 auto-compaction fires on the loose-object threshold', async () => {
  const s = freshStore({ autoCompact: true, compactionThreshold: 12 });
  for (let v = 1; v <= 12; v++) await s.snapshot('app', { 'bundle.js': BUNDLE(v) }, `p${v}`);
  ok(s.looseObjectCount('app') <= 12, 'auto-compaction kept loose count bounded');
  eq((await s.history('app')).length, 12, 'history intact after auto-compaction');
});

await test('§4 compaction removes the PREVIOUS pack instead of accumulating stale pack files', async () => {
  const backend = new MemoryFs();
  const s = new VersionStore({ backend, config: { now: clock(), autoCompact: false } });
  const gitdir = '/whim/apps/app/.git';

  for (let v = 1; v <= 5; v++) await s.snapshot('app', { 'bundle.js': BUNDLE(v) }, `p${v}`);
  await s.compact('app');
  eq(backend.listPackFiles(gitdir).length, 2, 'one .pack + one .idx after first compaction');

  for (let v = 6; v <= 10; v++) await s.snapshot('app', { 'bundle.js': BUNDLE(v) }, `p${v}`);
  await s.compact('app');
  eq(backend.listPackFiles(gitdir).length, 2, 'still one .pack + one .idx after second compaction (no stale pack accumulation)');
});

// --- §5 persistence: KV serialize round-trip + restart (logic, in Node) ----

await test('§5 KV-backed store survives a simulated restart (repo/history/pins/forks)', async () => {
  const map = new Map<string, string>();
  const store1 = createPersistentStore(new MapKVBackend(map), { now: clock(), autoCompact: false });
  await store1.snapshot('app', { 'bundle.js': BUNDLE(1) }, 'p1');
  await store1.snapshot('app', { 'bundle.js': BUNDLE(2) }, 'p2');
  await store1.pin('app', 'g1', 'good');
  await store1.fork('app', 'g1');
  await store1.snapshot('app', { 'bundle.js': BUNDLE(7) }, 'fork edit');

  // simulate kill + relaunch: a brand-new FS hydrated from the SAME KV blob store
  const store2 = createPersistentStore(new MapKVBackend(map), { autoCompact: false });
  eq((await store2.getSnapshot('app', 'g2')).artifacts['bundle.js'], BUNDLE(2), 'gen2 survived restart');
  eq((await store2.getPinned('app', 'good')).artifacts['bundle.js'], BUNDLE(1), 'pin survived restart');
  const lineages = await store2.lineages('app');
  ok(lineages.includes('main') && lineages.includes('fork-1'), 'both lineages survived restart');
  // and the rehydrated repo is still writable
  const snap = await store2.snapshot('app', { 'bundle.js': BUNDLE(8) }, 'post-restart');
  ok(snap.id.startsWith('g'), 'can keep generating after restart');
});

await test('§5 repeated commit/checkout + restart cycles do not corrupt the repo', async () => {
  const map = new Map<string, string>();
  for (let cycle = 0; cycle < 5; cycle++) {
    const s = createPersistentStore(new MapKVBackend(map), { now: clock(), autoCompact: false });
    const v = cycle + 1;
    await s.snapshot('app', { 'bundle.js': BUNDLE(v) }, `cycle ${v}`);
    await s.rollback('app', 'g1'); // exercise checkout each cycle
    await s.rollback('app', `g${v}`);
  }
  const s = createPersistentStore(new MapKVBackend(map), { autoCompact: false });
  eq((await s.history('app')).length, 5, 'all 5 cross-restart snapshots intact, no corruption');
});

await test('§5 auto-compaction on a KV-backed store reduces real KV key count (not just MemoryFs)', async () => {
  const backend = new KvBackedFs(new MapKVBackend());
  const s = new VersionStore({ backend, config: { now: clock(), autoCompact: true, compactionThreshold: 12 } });

  for (let v = 1; v <= 3; v++) await s.snapshot('app', { 'bundle.js': BUNDLE(v) }, `p${v}`); // loose stays <=12, no compaction
  const before = backend.kvKeyCount();

  await s.snapshot('app', { 'bundle.js': BUNDLE(4) }, 'p4'); // loose crosses >12, auto-compaction fires inside this call
  const after = backend.kvKeyCount();

  ok(after < before, `auto-compaction shrank the real KV key count (${before} -> ${after})`);
  eq(s.looseObjectCount('app'), 0, 'loose objects packed away on the KV-backed store too');
  eq((await s.history('app')).length, 4, 'history intact after KV-backed auto-compaction');
});

// --- §6 forward seams: content-agnostic + multi-file lockstep --------------

await test('§6.1 an extra (schema) artifact is versioned/diffed/rolled-back like any file', async () => {
  const s = freshStore();
  await s.snapshot('app', { 'bundle.js': BUNDLE(1), 'schema.json': '{"fields":[]}' }, 'p1');
  await s.snapshot('app', { 'bundle.js': BUNDLE(2), 'schema.json': '{"fields":["a"]}' }, 'p2');
  const changes = await s.diff('app', 'g1', 'g2');
  const schema = changes.find(c => c.file === 'schema.json');
  ok(!!schema && schema.status === 'modified', 'schema.json diffed with no special-casing');
  await s.rollback('app', 'g1');
  eq((await s.active('app'))!.artifacts['schema.json'], '{"fields":[]}', 'schema rolled back like any file');
});

await test('§6.2 rollback restores ALL tracked files in lockstep', async () => {
  const s = freshStore();
  await s.snapshot('app', { 'bundle.js': BUNDLE(1), 'schema.json': 'S1', 'manifest.json': MANIFEST(1) }, 'p1');
  await s.snapshot('app', { 'bundle.js': BUNDLE(2), 'schema.json': 'S2', 'manifest.json': MANIFEST(2) }, 'p2');
  await s.rollback('app', 'g1');
  const active = await s.active('app');
  eq(active!.artifacts['bundle.js'], BUNDLE(1), 'bundle rolled back');
  eq(active!.artifacts['schema.json'], 'S1', 'schema rolled back together with the bundle');
  eq(active!.artifacts['manifest.json'], MANIFEST(1), 'manifest rolled back together too');
});

// --- remove(appId): the additive launcher-shell (#5 D2) verb -----------------

await test('§remove drops the app history; history empty + active null afterward', async () => {
  const s = freshStore();
  await s.snapshot('app', { 'bundle.js': BUNDLE(1) }, 'p1');
  await s.snapshot('app', { 'bundle.js': BUNDLE(2) }, 'p2');
  const res = await s.remove('app');
  eq(res, { removed: true }, 'remove reports a product-verb shape');
  assertNoGitLeak(res, 'remove');
  eq((await s.history('app')).length, 0, 'history is empty after remove');
  eq(await s.active('app'), null, 'active is null after remove');
});

await test('§remove on a KV-backed store leaves ZERO keys for the repo', async () => {
  const map = new Map<string, string>();
  const store1 = createPersistentStore(new MapKVBackend(map), { now: clock(), autoCompact: false });
  await store1.snapshot('app', { 'bundle.js': BUNDLE(1) }, 'p1');
  await store1.snapshot('app', { 'bundle.js': BUNDLE(2) }, 'p2');
  const repoKeys = () => [...map.keys()].filter(k => k === 'p:/whim/apps/app' || k.startsWith('p:/whim/apps/app/'));
  ok(repoKeys().length > 0, 'repo wrote some KV keys');
  await store1.remove('app');
  // Every key UNDER the app's repo prefix is gone (one repo == one key prefix). The shared
  // root-dir scaffolding (/whim, /whim/apps) legitimately remains — it is not repo data.
  eq(repoKeys().length, 0, 'every KV key for the repo is gone (one repo == one key prefix)');
  // and a rehydrated store shows no trace
  const store2 = createPersistentStore(new MapKVBackend(map), { autoCompact: false });
  eq((await store2.history('app')).length, 0, 'no history survives the remove across a restart');
});

await test('§remove is scoped to one app — a sibling repo is untouched', async () => {
  const s = freshStore();
  await s.snapshot('app', { 'bundle.js': BUNDLE(1) }, 'a');
  await s.snapshot('app-extra', { 'bundle.js': BUNDLE(9) }, 'b'); // shares the "app" prefix
  await s.remove('app');
  eq((await s.history('app')).length, 0, 'target app removed');
  eq((await s.history('app-extra')).length, 1, 'prefix-sharing sibling app-extra is intact');
});

await test('§remove is idempotent — removing an unknown app is a clean no-op', async () => {
  const s = freshStore();
  const res = await s.remove('never-installed');
  eq(res, { removed: false }, 'removing an absent app reports removed:false, does not throw');
});

// --- §4 C1: auto-compaction failure must not reject a durable snapshot -------

await test('§4 C1: snapshot() resolves even when auto-compaction throws', async () => {
  // A BrokenPackFs subclass that throws when git tries to write the packfile,
  // simulating a compactRepo failure AFTER the commit+tag are already durable.
  const { MemoryFs: MFs } = await import('../fs/memory-fs');
  class BrokenPackFs extends MFs {
    override async writeFile(path: string, data: Uint8Array | string, opts?: { mode?: number; encoding?: string } | string): Promise<void> {
      if (path.endsWith('.pack')) throw new Error('simulated pack failure');
      return super.writeFile(path, data, opts);
    }
  }

  const { VersionStore: VS } = await import('../engine');
  const brokenBackend = new BrokenPackFs();
  // threshold:0 ensures the autoCompact branch always fires (loose count > 0 after commit)
  const store = new VS({ backend: brokenBackend, config: { autoCompact: true, compactionThreshold: 0 } });

  let snap: { id: string; prompt: string; createdAt: number } | undefined;
  let threw = false;
  try {
    snap = await store.snapshot('app', { 'bundle.js': BUNDLE(1) }, 'test compact fail');
  } catch {
    threw = true;
  }

  // (1) Promise resolves — not rejects — despite the compaction throw
  ok(!threw, 'snapshot() resolves even when auto-compaction throws');
  // (2) the resolved Snapshot has an id starting with 'g'
  ok(!!snap && snap.id.startsWith('g'), 'resolved Snapshot has a valid id');
  // (3) history() lists the snapshot
  const hist = await store.history('app');
  eq(hist.length, 1, 'history() lists the new snapshot after compaction failure');
  ok(!!snap && hist[0].id === snap.id, 'history entry matches the returned snapshot id');
  // (4) loose objects not zeroed — compaction was swallowed, not completed
  ok(store.looseObjectCount('app') > 0, 'looseObjectCount > 0 (compaction did not complete)');
});

// --- ST-3: history()'s catch around git.log must only swallow the unborn- --
//     HEAD case (repo exists, no commits) — any other git.log failure must --
//     reject, not silently surface as an empty history -----------------------

await test('§ST-3: history() still resolves [] for the unborn-HEAD case (repo exists, no commits)', async () => {
  const backend = new MemoryFs();
  const s = new VersionStore({ backend, config: { now: clock(), autoCompact: false } });
  const dir = '/whim/apps/app';
  const gitdir = '/whim/apps/app/.git';
  // Mirror what ensureRepo() does on first use, WITHOUT ever committing —
  // HEAD exists (points at refs/heads/main) but that ref has no commits.
  await backend.mkdir('/whim');
  await backend.mkdir('/whim/apps');
  await backend.mkdir(dir);
  await git.init({ fs: { promises: backend }, dir, gitdir, defaultBranch: 'main' });

  eq(await s.history('app'), [], 'unborn HEAD (repo exists, no commits) still resolves to []');
});

await test('§ST-3: history() REJECTS on a generic git.log failure instead of returning []', async () => {
  const backend = new MemoryFs();
  const s = new VersionStore({ backend, config: { now: clock(), autoCompact: false } });
  const gitdir = '/whim/apps/app/.git';

  // A real snapshot exists first, so the HEAD-exists precheck passes and
  // git.log() actually reaches a real, tracked commit object.
  await s.snapshot('app', { 'bundle.js': BUNDLE(1) }, 'p1');

  // Corrupt the tip commit's loose-object bytes in place. isomorphic-git's own
  // fs.read() wrapper swallows EVERY readFile-level error (ENOENT or otherwise)
  // into a uniform NotFoundError — the only way to produce a git.log failure
  // that is NOT the unborn-HEAD case is to make a read SUCCEED but the object
  // it returns be unparseable (a corrupted/bit-rotted store), which throws a
  // real decompress/parse error straight out of git.log(), never wrapped.
  const oid = await git.resolveRef({ fs: { promises: backend }, gitdir, ref: 'HEAD' });
  const objPath = `${gitdir}/objects/${oid.slice(0, 2)}/${oid.slice(2)}`;
  await backend.writeFile(objPath, new Uint8Array([1, 2, 3, 4, 5]));

  let threw = false;
  let isNotFoundError = false;
  try {
    await s.history('app');
  } catch (err) {
    threw = true;
    isNotFoundError = err instanceof git.Errors.NotFoundError;
  }
  ok(threw, 'history() rejects instead of resolving to [] on a non-unborn-HEAD git.log failure');
  ok(!isNotFoundError, 'the rejection is a genuine failure, not the unborn-HEAD NotFoundError case');
});

// --- C9: assertNoGitLeak's HEX40 value-scan must not false-positive on -----
//        opaque mini-app artifact content nested under an "artifacts" key,
//        while FORBIDDEN_KEYS key-checking still fires everywhere -----------

await test('§assertNoGitLeak: HEX40 artifact content does not false-positive', async () => {
  let threw1 = false;
  try {
    assertNoGitLeak({ artifacts: { 'bundle.js': 'a'.repeat(40) } }, 'snap');
  } catch {
    threw1 = true;
  }
  ok(!threw1, 'HEX40 string inside artifacts does not throw');

  let threw2 = false;
  try {
    assertNoGitLeak({ oid: 'a'.repeat(40) }, 'snap');
  } catch {
    threw2 = true;
  }
  ok(threw2, 'forbidden key oid still throws');

  let threw3 = false;
  try {
    assertNoGitLeak({ id: 'a'.repeat(40) }, 'snap');
  } catch {
    threw3 = true;
  }
  ok(threw3, 'top-level HEX40 value under non-forbidden key still throws');
});

// --- C8: an untagged commit (no whim/snap/* tag) must throw loudly, never --
//        silently surface as id:'' ----------------------------------------

await test('§C8: history() throws an invariant error on an untagged commit', async () => {
  const backend = new MemoryFs();
  const s = new VersionStore({ backend, config: { now: clock(), autoCompact: false } });
  const dir = '/whim/apps/app';
  const gitdir = '/whim/apps/app/.git';
  await s.snapshot('app', { 'bundle.js': BUNDLE(1) }, 'p1'); // creates repo/branch/HEAD + one tagged commit

  // Advance HEAD with a commit that has NO snap tag — the legitimate way the engine
  // itself would never produce, but a corrupted/partial repo could.
  await git.commit({
    fs: { promises: backend },
    dir,
    gitdir,
    message: 'untagged',
    author: { name: 't', email: 't' },
  });

  let threw = false;
  try {
    await s.history('app');
  } catch (err) {
    threw = /invariant: commit .* has no snap tag/.test((err as Error).message);
  }
  ok(threw, 'history() throws an invariant error instead of returning id:""');
});

await test('§C8: active() throws an invariant error on an untagged commit', async () => {
  const backend = new MemoryFs();
  const s = new VersionStore({ backend, config: { now: clock(), autoCompact: false } });
  const dir = '/whim/apps/app';
  const gitdir = '/whim/apps/app/.git';
  await s.snapshot('app', { 'bundle.js': BUNDLE(1) }, 'p1');

  await git.commit({
    fs: { promises: backend },
    dir,
    gitdir,
    message: 'untagged',
    author: { name: 't', email: 't' },
  });

  let threw = false;
  try {
    await s.active('app');
  } catch (err) {
    threw = /invariant: commit .* has no snap tag/.test((err as Error).message);
  }
  ok(threw, 'active() throws an invariant error instead of returning id:""');
});

// --- summary ---------------------------------------------------------------

// eslint-disable-next-line no-console
console.log(`\n${passed} checks passed, ${failures.length} failed`);
if (failures.length) {
  // eslint-disable-next-line no-console
  console.error('\nFAILURES:\n' + failures.map(f => '  - ' + f).join('\n'));
  process.exit(1);
}
// eslint-disable-next-line no-console
console.log('ALL GREEN');
