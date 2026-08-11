/**
 * pending-builds Node suite (launcher-ghost-tiles chain-1, tasks 1.1/1.2/1.3/1.4, from
 * `pending-builds/spec.md`). Record lifecycle round-trips, list ordering, launch-time demotion,
 * corrupt-record tolerance, working-title truncation, and ghost hash-colour determinism.
 */

import { Harness } from './harness';
import { MapKVBackend } from '../../version-store';
import { PendingBuildStore } from '../pending-builds';
import { workingTitleFromPrompt, ghostTileColorFor } from '../prompt-flow';
import { appColor } from '../../../sdk/theme';

export async function runPendingBuildsTests(h: Harness): Promise<void> {
  // ── create / get round-trip ────────────────────────────────────────────────
  await h.test('pending-builds: create writes a fresh building record; get round-trips it', async () => {
    const store = new PendingBuildStore(new MapKVBackend());
    const rec = store.create({ id: 'app-1', prompt: 'a tip splitter for camping trips', workingTitle: 'a tip splitter for camping' });
    h.eq(rec.state, 'building', 'a fresh record starts building');
    h.eq(rec.id, 'app-1', 'id carried through');
    h.eq(rec.prompt, 'a tip splitter for camping trips', 'prompt carried through');
    h.eq(rec.workingTitle, 'a tip splitter for camping', 'workingTitle carried through');
    h.ok(rec.failure === undefined, 'no failure on a fresh record');
    h.ok(rec.editingAppId === undefined, 'no editingAppId when not supplied');
    h.eq(store.get('app-1'), rec, 'get returns the exact record just created');
    h.eq(store.get('unknown'), null, 'unknown id returns null');
  });

  await h.test('pending-builds: create carries editingAppId when supplied (rebuild/edit attempts)', async () => {
    const store = new PendingBuildStore(new MapKVBackend());
    const rec = store.create({ id: 'app-2', prompt: 'add a dark mode', workingTitle: 'add a dark mode', editingAppId: 'app-1' });
    h.eq(rec.editingAppId, 'app-1', 'editingAppId is set on the created record');
    h.eq(store.get('app-2')!.editingAppId, 'app-1', 'and persists');
  });

  // ── list ordering ───────────────────────────────────────────────────────────
  await h.test('pending-builds: list returns records newest first', async () => {
    const store = new PendingBuildStore(new MapKVBackend());
    store.create({ id: 'a', prompt: 'first', workingTitle: 'first' });
    store.create({ id: 'b', prompt: 'second', workingTitle: 'second' });
    store.create({ id: 'c', prompt: 'third', workingTitle: 'third' });
    h.eq(store.list().map((r) => r.id), ['c', 'b', 'a'], 'newest-created record leads the list');
  });

  await h.test('pending-builds: re-creating an existing id updates in place without duplicating order', async () => {
    const store = new PendingBuildStore(new MapKVBackend());
    store.create({ id: 'a', prompt: 'first', workingTitle: 'first' });
    store.create({ id: 'b', prompt: 'second', workingTitle: 'second' });
    store.create({ id: 'a', prompt: 'first, retried', workingTitle: 'first retried' });
    h.eq(store.list().map((r) => r.id), ['b', 'a'], 're-create does not add a second order entry');
    h.eq(store.get('a')!.prompt, 'first, retried', 're-create overwrites the record');
  });

  // ── setFailed ────────────────────────────────────────────────────────────────
  await h.test('pending-builds: setFailed transitions to failed and persists the payload, never deletes', async () => {
    const store = new PendingBuildStore(new MapKVBackend());
    store.create({ id: 'a', prompt: 'x', workingTitle: 'x' });
    store.setFailed('a', { reason: 'server-unreachable', diagnostics: 'ECONNRESET' });
    const rec = store.get('a')!;
    h.eq(rec.state, 'failed', 'state becomes failed');
    h.eq(rec.failure, { reason: 'server-unreachable', diagnostics: 'ECONNRESET' }, 'failure payload persisted verbatim');
    h.ok(store.list().some((r) => r.id === 'a'), 'the record is not deleted on failure');
  });

  await h.test('pending-builds: setFailed on an unknown id is a tolerated no-op', async () => {
    const store = new PendingBuildStore(new MapKVBackend());
    store.setFailed('ghost', { reason: 'never existed' });
    h.eq(store.get('ghost'), null, 'no record is created by setFailed on a missing id');
  });

  // ── delete ───────────────────────────────────────────────────────────────────
  await h.test('pending-builds: delete drops the record and its order entry; a deleted record never reappears', async () => {
    const store = new PendingBuildStore(new MapKVBackend());
    store.create({ id: 'a', prompt: 'x', workingTitle: 'x' });
    store.create({ id: 'b', prompt: 'y', workingTitle: 'y' });
    store.delete('a');
    h.eq(store.get('a'), null, 'get returns null after delete');
    h.eq(store.list().map((r) => r.id), ['b'], 'the surviving record remains, delivery order intact');
    store.delete('a'); // deleting again is a no-op, not a throw
    h.eq(store.list().map((r) => r.id), ['b'], 'deleting an already-absent id changes nothing');
  });

  // ── demoteBuildingToInterrupted (launch-time, task 1.3) ───────────────────────
  await h.test('pending-builds: demoteBuildingToInterrupted flips only building records to interrupted', async () => {
    const map = new Map<string, string>();
    const store1 = new PendingBuildStore(new MapKVBackend(map));
    store1.create({ id: 'building-one', prompt: 'x', workingTitle: 'x' });
    store1.create({ id: 'building-two', prompt: 'y', workingTitle: 'y' });
    store1.setFailed('building-two', { reason: 'already failed before the "crash"' });
    // Simulate the host process dying and relaunching: a fresh store over the SAME backend.
    const store2 = new PendingBuildStore(new MapKVBackend(map));
    store2.demoteBuildingToInterrupted();
    h.eq(store2.get('building-one')!.state, 'interrupted', 'a live building record surfaces as interrupted after relaunch');
    h.eq(store2.get('building-two')!.state, 'failed', 'an already-failed record is left untouched');
  });

  await h.test('pending-builds: a clean relaunch with no building records changes nothing', async () => {
    const map = new Map<string, string>();
    const store1 = new PendingBuildStore(new MapKVBackend(map));
    store1.create({ id: 'a', prompt: 'x', workingTitle: 'x' });
    store1.setFailed('a', { reason: 'done failing' });
    const before = store1.get('a');
    const store2 = new PendingBuildStore(new MapKVBackend(map));
    store2.demoteBuildingToInterrupted();
    h.eq(store2.get('a'), before, 'no record is altered by the launch-time demotion step');
  });

  await h.test('pending-builds: demoteBuildingToInterrupted on an empty store is a no-op', async () => {
    const store = new PendingBuildStore(new MapKVBackend());
    store.demoteBuildingToInterrupted(); // must not throw
    h.eq(store.list(), [], 'still empty');
  });

  // ── corrupt-record tolerance (mirrors AppIndex.get) ──────────────────────────
  await h.test('pending-builds: an unreadable record reads as absent, not a throw', async () => {
    const map = new Map<string, string>();
    map.set('pending:order', JSON.stringify(['broken']));
    map.set('pending:broken', '{not json');
    const store = new PendingBuildStore(new MapKVBackend(map));
    h.eq(store.get('broken'), null, 'corrupt JSON reads as no record');
    h.eq(store.list(), [], 'list drops the corrupt entry rather than throwing');
  });

  await h.test('pending-builds: an unreadable order list reads as empty, not a throw', async () => {
    const map = new Map<string, string>();
    map.set('pending:order', 'not-an-array-or-json{{{');
    map.set('pending:a', JSON.stringify({ id: 'a', prompt: 'x', workingTitle: 'x', state: 'building', createdAt: 1, updatedAt: 1 }));
    const store = new PendingBuildStore(new MapKVBackend(map));
    h.eq(store.list(), [], 'an unreadable order list yields an empty list even though a record exists');
  });

  await h.test('pending-builds: a dangling order id with no record is dropped, survivors keep their order', async () => {
    const kv = new MapKVBackend();
    const store = new PendingBuildStore(kv);
    store.create({ id: 'a', prompt: 'x', workingTitle: 'x' });
    store.create({ id: 'b', prompt: 'y', workingTitle: 'y' });
    // Simulate an order entry surviving its record being lost some other way (e.g. a partial
    // write) — inject a dangling id directly at the KV layer, ahead of the survivors.
    const raw = kv.getString('pending:order');
    kv.set('pending:order', JSON.stringify(['dangling', ...JSON.parse(raw ?? '[]')]));
    h.eq(store.list().map((r) => r.id), ['b', 'a'], 'the dangling id is silently dropped, survivors keep their order');
  });

  // ── workingTitleFromPrompt (task 1.2) ─────────────────────────────────────────
  await h.test('workingTitleFromPrompt: a short prompt passes through untouched (trimmed)', async () => {
    h.eq(workingTitleFromPrompt('  a tip splitter  '), 'a tip splitter', 'trims leading/trailing whitespace');
  });

  await h.test('workingTitleFromPrompt: a long prompt truncates at a word boundary, never mid-word', async () => {
    const prompt = 'a tip splitter for camping trips with friends and family';
    const title = workingTitleFromPrompt(prompt);
    h.ok(title.length <= 28, `title "${title}" is at most 28 chars (got ${title.length})`);
    h.ok(prompt.startsWith(title), 'the title is a verbatim prefix of the prompt');
    h.ok(!prompt[title.length] || prompt[title.length] === ' ', 'the cut lands exactly on a word boundary');
  });

  await h.test('workingTitleFromPrompt: internal whitespace runs collapse to a single space', async () => {
    h.eq(workingTitleFromPrompt('a   tip    splitter'), 'a tip splitter', 'runs of whitespace collapse');
  });

  await h.test('workingTitleFromPrompt: a single word longer than the limit hard-truncates (no boundary to use)', async () => {
    const longWord = 'a'.repeat(40);
    const title = workingTitleFromPrompt(longWord);
    h.eq(title.length, 28, 'hard-truncates to exactly the limit when there is no space to break on');
    h.eq(title, 'a'.repeat(28), 'and the content is the verbatim prefix');
  });

  await h.test('workingTitleFromPrompt: empty and whitespace-only prompts produce an empty title', async () => {
    h.eq(workingTitleFromPrompt(''), '', 'empty prompt');
    h.eq(workingTitleFromPrompt('   '), '', 'whitespace-only prompt');
  });

  // ── ghostTileColorFor (task 1.2, design D6) ───────────────────────────────────
  await h.test('ghostTileColorFor: deterministic — same id always resolves the same colour', async () => {
    h.eq(ghostTileColorFor('app-abc123'), ghostTileColorFor('app-abc123'), 'stable across calls');
  });

  await h.test('ghostTileColorFor: draws from the existing tile palette (appColor), not a second one', async () => {
    h.eq(ghostTileColorFor('app-abc123'), appColor('app-abc123'), 'reuses appColor with the id as the hashed input');
  });

  await h.test('ghostTileColorFor: different ids can resolve different colours (not a constant)', async () => {
    const colors = new Set(['id-1', 'id-2', 'id-3', 'id-4', 'id-5'].map(ghostTileColorFor));
    h.ok(colors.size > 1, 'at least two distinct hues across five distinct ids');
  });
}
