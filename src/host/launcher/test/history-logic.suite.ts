/**
 * History screen acceptance (`history-ui.spec.md`, shell-redesign-v2 chain-E) — drives a real
 * MemoryFs-backed `VersionStore` through `StoreAccess` + the RN-free `history-logic.ts` decision
 * logic (mirrors `store-access.suite.ts`'s idiom); the rendered screen is in `history-ui.suite.tsx`. Pin verbs are covered by `store-access.suite.ts` — the `4a`
 * redesign withdraws the launcher's pin SURFACE, not the store's pin verbs (version-history
 * REMOVED "Named pins").
 */

import { Harness } from './harness';
import { createMemoryStore, MapKVBackend } from '../../version-store';
import { AppIndex } from '../app-index';
import { StoreAccess, storeIdOf } from '../store-access';
import {
  addedFieldsBetween,
  annotationBetween,
  buildHistoryRows,
  fieldsLeavingViewOnRestore,
  isAtTip,
  listVersions,
  storedSummary,
} from '../history-logic';
import { historyQuotedPrompt } from '../copy';
import { deliverResult } from '../build-lifecycle';
import type { AppRecord } from '../../bridge/contract';
import type { WireAppRecord } from '@whim/contract';

const REC = (id: string): AppRecord => ({ appId: id, name: id, manifest: { capabilities: ['storage'] } });

const envelope = (text: string, summary?: object) => JSON.stringify({ v: 1, text, ...(summary ? { summary } : {}) });

function storeClock(): () => number {
  let t = 1_700_000_000_000;
  return () => (t += 1000);
}

function harnessAccess(now: () => number = storeClock(), historyLimit?: number) {
  const store = createMemoryStore({ autoCompact: false, now, ...(historyLimit != null ? { historyLimit } : {}) });
  const index = new AppIndex(new MapKVBackend());
  const access = new StoreAccess({ store, index, now: () => Date.now() });
  return { store, index, access };
}

const BEFORE_SCHEMA = '{"schemaVersion":1,"collections":{"Entries":{"id":"c1","fields":{"amount":{"id":"f1","type":"int"}},"tombstones":[]}}}';
const AFTER_SCHEMA = '{"schemaVersion":1,"collections":{"Entries":{"id":"c1","fields":{"amount":{"id":"f1","type":"int"},"notes":{"id":"f2","type":"text","default":""}},"tombstones":[]}}}';

const SUMMARY_ADDED = { text: 'A chime now plays before the last pour.', kind: 'Added', touched: ['Sounds'], marks: [] };

export async function runHistoryLogicTests(h: Harness): Promise<void> {

  await h.test('history: a row headlines with its own prompt, quoted, from an envelope or a raw legacy string', async () => {
    const { store, access } = harnessAccess();
    const orig = await access.install({
      id: 'wc', name: 'WC', record: REC('wc'), bundleSource: 'V1',
      prompt: envelope('make a tip splitter'),
    });
    await store.snapshot('wc', { 'bundle.js': 'V2' }, 'Example: track water'); // raw legacy prompt
    const list = await listVersions(access, orig);
    const rows = buildHistoryRows(list, await access.activeId(orig));
    h.eq(rows.map(r => r.headline), [historyQuotedPrompt('Example: track water'), historyQuotedPrompt('make a tip splitter')], 'each headline quotes the resolved prompt text');
    h.eq(rows.map(r => r.promptText), ['Example: track water', 'make a tip splitter'], 'each keeps the words it quotes');
    h.eq(rows.map(r => r.kind), [null, 'Start'], 'no summary: no kind, except the first version, which is the Start');
    h.eq(rows.map(r => r.result), [null, null], 'and no summary of Whim’s under the words');
    h.eq(rows.map(r => r.meta.split(' · ')[0]), ['v2', 'v1'], 'every row’s meta line names its version');
  });

  await h.test('history: a summarised row still headlines with the user’s words; the summary, with its marks, is what the opened row says', async () => {
    const { store, access } = harnessAccess();
    const orig = await access.install({ id: 'wc', name: 'WC', record: REC('wc'), bundleSource: 'V1', prompt: envelope('a tip splitter') });
    const marked = { ...SUMMARY_ADDED, marks: [{ cls: 'chg', start: 2, end: 7 }] };
    await store.snapshot('wc', { 'bundle.js': 'V2' }, envelope('add a warning chime', marked));
    const list = await listVersions(access, orig); // [summarised, install]
    const rows = buildHistoryRows(list, await access.activeId(orig));
    h.eq(rows[0].headline, historyQuotedPrompt('add a warning chime'), 'the summarised row’s headline is the prompt, not the summary');
    h.eq(rows[0].marks, [], 'the summary’s marks point into the summary, so none land on the quoted prompt');
    h.eq(rows[0].result, { text: SUMMARY_ADDED.text, marks: marked.marks }, 'the summary and its marks are the opened row’s result');
    h.eq(rows[0].kind, 'Added', 'its kind comes from the summary');
    h.eq(rows[1].headline, historyQuotedPrompt('a tip splitter'), 'the install row (no summary) quotes its prompt too');
  });

  await h.test('history: a version with no prompt headlines with its summary, once', async () => {
    const { store, access } = harnessAccess();
    const orig = await access.install({ id: 'wc', name: 'WC', record: REC('wc'), bundleSource: 'V1', prompt: envelope('a tip splitter') });
    const fixed = { text: 'The timer kept counting past zero.', kind: 'Fixed', touched: ['The timer screen'], marks: [{ cls: 'chg', start: 4, end: 9 }] };
    await store.snapshot('wc', { 'bundle.js': 'V2' }, envelope('', fixed));
    const [unprompted] = buildHistoryRows(await listVersions(access, orig), await access.activeId(orig));
    h.eq(unprompted.promptText, '', 'no words of the user’s to quote');
    h.eq(unprompted.headline, fixed.text, 'so the summary is the headline');
    h.eq(unprompted.marks, fixed.marks, 'with the summary’s own marks');
    h.eq(unprompted.result, null, 'and the row does not say it a second time');
  });

  // ── Kinds + unclassified rows ─────────────────────────────────────────────
  await h.test('history: each row’s kind comes from its summary; a version with no kind is unclassified, and none is hidden', async () => {
    const { store, access } = harnessAccess();
    const orig = await access.install({ id: 'wc', name: 'WC', record: REC('wc'), bundleSource: 'V1', prompt: envelope('install it') });
    await store.snapshot('wc', { 'bundle.js': 'V2' }, envelope('add a chime', SUMMARY_ADDED)); // features
    await store.snapshot('wc', { 'bundle.js': 'V3' }, envelope('make the numbers bigger', { text: 'The numbers are bigger now.', kind: 'Look', touched: [], marks: [] })); // look
    await store.snapshot('wc', { 'bundle.js': 'V4' }, envelope('it broke', { text: 'Fixed a crash on start.', kind: 'Fixed', touched: [], marks: [] })); // fixes
    await store.snapshot('wc', { 'bundle.js': 'V5' }, 'raw legacy, no envelope at all'); // unclassified
    const list = await listVersions(access, orig);
    const rows = buildHistoryRows(list, await access.activeId(orig));
    h.eq(rows.map(r => r.kind), [null, 'Fixed', 'Look', 'Added', 'Start'], 'each row takes its summariser kind; the raw-string row is unclassified; the first version is the Start');
    h.eq(rows.length, list.length, 'every version is a row, unclassified included');
  });

  // ── Live count (E6) ────────────────────────────────────────────────────────
  await h.test('history: the all-versions count is live — a newly delivered version is included', async () => {
    const { store, access } = harnessAccess();
    const orig = await access.install({ id: 'wc', name: 'WC', record: REC('wc'), bundleSource: 'V1', prompt: envelope('install it') });
    const before = buildHistoryRows(await listVersions(access, orig), await access.activeId(orig));
    h.eq(before.length, 1, 'one version so far');
    await store.snapshot('wc', { 'bundle.js': 'V2' }, envelope('a change'));
    const after = buildHistoryRows(await listVersions(access, orig), await access.activeId(orig));
    h.eq(after.length, 2, 'the newly delivered version is counted once History is reopened');
  });

  // ── Current-version marking, live and after a restore (E3) ────────────────
  await h.test('history: the current marker follows the active snapshot, including after a restore', async () => {
    const { store, access } = harnessAccess();
    const orig = await access.install({ id: 'wc', name: 'WC', record: REC('wc'), bundleSource: 'V1', prompt: envelope('p1') });
    await store.snapshot('wc', { 'bundle.js': 'V2' }, envelope('p2'));
    let list = await listVersions(access, orig);
    let rows = buildHistoryRows(list, await access.activeId(orig));
    h.eq(rows.filter(r => r.isCurrent).map(r => r.id), [list[0].id], 'the newest row starts as current');

    const target = list[1].id;
    await access.rollback(orig, target);
    list = await listVersions(access, orig);
    rows = buildHistoryRows(list, await access.activeId(orig));
    h.eq(rows.filter(r => r.isCurrent).map(r => r.id), [target], 'the current marker moved to the restored version, and only it');
  });

  // ── Each row's actions (version-history "Using an older version is immediate and undoable") ──
  await h.test('history: the current version offers Change it; every other version, the first and a newer one after going back included, offers Use this version and Make a copy from here', async () => {
    const { store, access } = harnessAccess();
    const orig = await access.install({ id: 'wc', name: 'WC', record: REC('wc'), bundleSource: 'V1', prompt: envelope('install') });
    await store.snapshot('wc', { 'bundle.js': 'V2' }, envelope('p2'));
    await store.snapshot('wc', { 'bundle.js': 'V3' }, envelope('p3'));
    const list = await listVersions(access, orig); // [p3 (current), p2, install]
    const [current, middle, install] = buildHistoryRows(list, await access.activeId(orig));
    h.eq(current.actions, ['change-it'], 'the current version offers exactly one action');
    h.eq(middle.actions, ['use-version', 'make-copy'], 'a past version offers exactly two');
    h.eq(install.actions, ['use-version', 'make-copy'], 'the first version can be used too: there is no confirm to protect it any more');
    h.eq([current.number, middle.number, install.number], [3, 2, 1], 'each row knows its place in the chain');

    await access.rollback(orig, middle.id);
    const after = buildHistoryRows(await listVersions(access, orig), await access.activeId(orig));
    h.eq(after.map(r => [r.version, r.actions]), [['v3', ['use-version', 'make-copy']], ['v2', ['change-it']], ['v1', ['use-version', 'make-copy']]], 'after going back, the newer version is still listed and can be used again: the Undo that outlives the toast');
  });

  // ── Nothing is lost by changing an older version (prompt-flow D5 routing) ──
  await h.test('history: using an older version and then changing it never drops the newer versions: the change lands on a new app that shares the data, and the original still lists and can use every version', async () => {
    const { store, index, access } = harnessAccess();
    const orig = await access.install({ id: 'wc', name: 'WC', record: REC('wc'), bundleSource: 'V1', prompt: envelope('install') });
    await store.snapshot('wc', { 'bundle.js': 'V2' }, envelope('p2'));
    await store.snapshot('wc', { 'bundle.js': 'V3' }, envelope('p3'));
    await store.snapshot('wc', { 'bundle.js': 'V4' }, envelope('p4'));
    const [v4, v3] = await listVersions(access, orig);
    await access.rollback(orig, v3.id);
    const wire: WireAppRecord = { name: 'WC', source: 'export default () => null;', bundle: 'var __WHIM_APP_MODULE__ = (() => ({}))();', manifest: {}, schema: {} };
    const landed = await deliverResult({ access, appId: 'unused', editing: index.get('wc')!, text: 'p5', wire });
    h.ok(landed.id !== orig.id, 'the change made on version 3 landed on a new app, not on the original’s line');
    h.eq(access.engineAppId(landed), access.engineAppId(orig), 'which keeps the original’s data (a rewind continuation, never a copy)');
    const listed = await listVersions(access, orig);
    h.eq(listed.map(s => s.id), [v4.id, v3.id, listed[2].id, listed[3].id], 'the original still lists version 4 above version 3');
    h.eq(await access.activeId(orig), v3.id, 'and is still on version 3');
    await access.rollback(orig, v4.id);
    h.eq((await access.activeBundle(orig)), 'V4', 'and version 4 can be used again, unchanged');
  });

  // ── Data-shape annotation on a schema-adding row (D5, unchanged) ──────────
  await h.test('history: a row whose schema.json added a field carries the annotation', async () => {
    const { store, access } = harnessAccess();
    const orig = await access.install({ id: 'wc', name: 'WC', record: REC('wc'), bundleSource: 'V1', prompt: 'install' });
    await store.snapshot('wc', { 'bundle.js': 'V1', 'schema.json': BEFORE_SCHEMA }, 'p1');
    await store.snapshot('wc', { 'bundle.js': 'V1', 'schema.json': AFTER_SCHEMA }, 'p2 adds notes');
    const list = await listVersions(access, orig); // [p2, p1, install]
    const annotation = await annotationBetween(access, orig, list[1].id, list[0].id);
    h.eq(annotation, ['notes (text)'], 'the added field is named with its type');
  });

  await h.test('history: a row whose schema.json did not change carries no annotation', async () => {
    const { store, access } = harnessAccess();
    const orig = await access.install({ id: 'wc', name: 'WC', record: REC('wc'), bundleSource: 'V1', prompt: 'install' });
    await store.snapshot('wc', { 'bundle.js': 'V1', 'schema.json': BEFORE_SCHEMA }, 'p1');
    await store.snapshot('wc', { 'bundle.js': 'V2', 'schema.json': BEFORE_SCHEMA }, 'p2 no schema change');
    const list = await listVersions(access, orig);
    const annotation = await annotationBetween(access, orig, list[1].id, list[0].id);
    h.eq(annotation, [], 'no schema.json diff -> no annotation');
  });

  // ── Restore reassurance when fields leave view (D5, unchanged) ────────────
  await h.test('history: restoring to a version missing fields the active version has shows a reassurance', async () => {
    const { store, access } = harnessAccess();
    const orig = await access.install({ id: 'wc', name: 'WC', record: REC('wc'), bundleSource: 'V1', prompt: 'install' });
    await store.snapshot('wc', { 'bundle.js': 'V1', 'schema.json': BEFORE_SCHEMA }, 'p1');
    await store.snapshot('wc', { 'bundle.js': 'V1', 'schema.json': AFTER_SCHEMA }, 'p2 adds notes');
    const list = await listVersions(access, orig); // [p2 (active), p1, install]
    const activeIdValue = (await access.activeId(orig))!;
    const target = list[1].id; // p1 — predates "notes"
    const leaving = await fieldsLeavingViewOnRestore(access, orig, target, activeIdValue);
    h.eq(leaving, ['notes (text)'], 'restoring past the field that added "notes" surfaces a reassurance');
  });

  await h.test('history: restoring to the active version itself shows no reassurance', async () => {
    const { store, access } = harnessAccess();
    const orig = await access.install({ id: 'wc', name: 'WC', record: REC('wc'), bundleSource: 'V1', prompt: 'install' });
    await store.snapshot('wc', { 'bundle.js': 'V1', 'schema.json': BEFORE_SCHEMA }, 'p1');
    const activeIdValue = (await access.activeId(orig))!;
    const leaving = await fieldsLeavingViewOnRestore(access, orig, activeIdValue, activeIdValue);
    h.eq(leaving, [], 'no fields leave view when the restore target IS the active version');
  });

  // ── addedFieldsBetween never throws on malformed input (unchanged) ───────
  await h.test('history: addedFieldsBetween tolerates malformed JSON without throwing', () => {
    h.eq(addedFieldsBetween(undefined, '{not json'), [], 'malformed "after" JSON yields no annotation, no throw');
    h.eq(addedFieldsBetween('{not json', '{"schemaVersion":1,"collections":{}}'), [], 'malformed "before" JSON yields no annotation, no throw');
  });

  // ── storedSummary never throws on malformed input ─────────────────────────
  await h.test('history: storedSummary tolerates malformed/raw prompts without throwing', () => {
    h.eq(storedSummary('not json at all'), undefined, 'a raw legacy string carries no summary');
    h.eq(storedSummary('{not json'), undefined, 'malformed JSON carries no summary, no throw');
    h.eq(storedSummary(envelope('text only, no summary field')), undefined, 'a v1 envelope with no summary carries none');
    h.eq(storedSummary(JSON.stringify({ v: 1, text: 't', summary: { text: 't', kind: 'Bogus', touched: [], marks: [] } })), undefined, 'an invalid kind fails the structural guard');
  });

  // ── F1 fixed: fork listing never leaks the original's later lineage, via timeline() ──
  await h.test('history: F1 fixed — a fresh, undiverged fork lists only its own line via timeline()', async () => {
    const { store, access } = harnessAccess();
    const orig = await access.install({ id: 'wc', name: 'WC', record: REC('wc'), bundleSource: 'V1', prompt: 'p1' });
    const fork = await access.fork(orig); // fresh, undiverged: fork tip === orig tip
    await access.activeBundle(orig); // switches the repo back to main (ensureLineage side effect)
    await store.snapshot(storeIdOf(orig), { 'bundle.js': 'V2_ORIG' }, 'orig post-fork edit'); // ONLY on original's line
    const forkList = await listVersions(access, fork);
    h.eq(forkList.map(s => s.prompt), ['p1'], "the undiverged fork's listing (via timeline(), lineage-correct) has no trace of the original's later edit");
  });

  await h.test("history: a fork entry's own listing survives a restore (roll-forward), same as an original", async () => {
    const { store, access } = harnessAccess();
    const orig = await access.install({ id: 'wc', name: 'WC', record: REC('wc'), bundleSource: 'V1', prompt: 'p1' });
    const fork = await access.fork(orig);
    await store.snapshot(storeIdOf(fork), { 'bundle.js': 'V2_FORK' }, 'fork p2');
    await store.snapshot(storeIdOf(fork), { 'bundle.js': 'V3_FORK' }, 'fork p3');
    const beforeRollback = await listVersions(access, fork);
    const oldest = beforeRollback[beforeRollback.length - 1];
    await access.rollback(fork, oldest.id);
    const afterRollback = await listVersions(access, fork);
    h.eq(afterRollback.map(s => s.prompt), ['fork p3', 'fork p2', 'p1'], 'later fork versions stay listed and restorable after rolling backward');
  });

  await h.test('history: the primary lineage listing survives a restore (roll-forward)', async () => {
    const { store, access } = harnessAccess();
    const orig = await access.install({ id: 'wc', name: 'WC', record: REC('wc'), bundleSource: 'V1', prompt: 'p1' });
    await store.snapshot('wc', { 'bundle.js': 'V2' }, 'p2');
    await store.snapshot('wc', { 'bundle.js': 'V3' }, 'p3');
    const beforeRollback = await listVersions(access, orig);
    const oldest = beforeRollback[beforeRollback.length - 1];
    await access.rollback(orig, oldest.id);
    const afterRollback = await listVersions(access, orig);
    h.eq(afterRollback.map(s => s.prompt), ['p3', 'p2', 'p1'], 'later versions stay listed and restorable after rolling backward');
  });

  // ── Order by the version chain, Start on the true first version (#126) ───
  const ONE_SECOND = () => 1_700_000_000_250;
  /** A store clock that hands out `stamps` (ms) in turn, then repeats the last one. */
  const scripted = (stamps: number[]) => {
    let i = 0;
    return () => stamps[Math.min(i++, stamps.length - 1)];
  };
  const startRows = (rows: readonly { kind: string | null; isInstall: boolean; promptText: string }[]) => ({
    start: rows.filter(r => r.kind === 'Start').map(r => r.promptText),
    first: rows.filter(r => r.isInstall).map(r => r.promptText),
  });

  await h.test('history: two versions saved in one second — the later is listed first and Start is on the true first version', async () => {
    const { access } = harnessAccess(ONE_SECOND);
    const orig = await access.install({ id: 'wc', name: 'WC', record: REC('wc'), bundleSource: 'V1', prompt: envelope('a tip splitter') });
    const edited = await access.update(orig, { record: orig.record, bundleSource: 'V2', prompt: envelope('round up the tip') });
    const list = await listVersions(access, edited);
    h.eq(new Set(list.map(s => s.createdAt)).size, 1, 'both versions carry the same timestamp');
    const rows = buildHistoryRows(list, await access.activeId(edited));
    h.eq(rows.map(r => r.promptText), ['round up the tip', 'a tip splitter'], 'the later version is listed first');
    h.eq(rows.map(r => r.version), ['v2', 'v1'], 'and numbered after it');
    h.eq(startRows(rows), { start: ['a tip splitter'], first: ['a tip splitter'] }, 'Start and the first-version label are on the version the app began with');
    h.eq(rows.map(r => r.isCurrent), [true, false], 'the later version is the current one');
  });

  await h.test('history: Start is the version the chain begins with, even when its timestamp is the newest', async () => {
    const { store, access } = harnessAccess(scripted([1_700_000_120_000, 1_700_000_060_000, 1_700_000_000_000]));
    const orig = await access.install({ id: 'wc', name: 'WC', record: REC('wc'), bundleSource: 'V1', prompt: envelope('p1') });
    await store.snapshot('wc', { 'bundle.js': 'V2' }, envelope('p2'));
    await store.snapshot('wc', { 'bundle.js': 'V3' }, envelope('p3'));
    const rows = buildHistoryRows(await listVersions(access, orig), await access.activeId(orig));
    h.eq(rows.map(r => r.promptText), ['p3', 'p2', 'p1'], 'newest made first, though the clock ran backwards');
    h.eq(startRows(rows), { start: ['p1'], first: ['p1'] }, 'Start is on the first version, not on the oldest timestamp');
  });

  await h.test('history: an app with more versions than the store lists by default still ends at its true first version', async () => {
    const { store, access } = harnessAccess(storeClock(), 3);
    const orig = await access.install({ id: 'wc', name: 'WC', record: REC('wc'), bundleSource: 'V1', prompt: envelope('p1') });
    for (let v = 2; v <= 5; v++) await store.snapshot('wc', { 'bundle.js': `V${v}` }, envelope(`p${v}`));
    const rows = buildHistoryRows(await listVersions(access, orig), await access.activeId(orig));
    h.eq(rows.map(r => r.promptText), ['p5', 'p4', 'p3', 'p2', 'p1'], 'every version on the chain is listed');
    h.eq(rows[rows.length - 1].version, 'v1', 'the last row is v1');
    h.eq(startRows(rows), { start: ['p1'], first: ['p1'] }, 'and Start is the version the app began with, not the oldest one shown');
  });

  await h.test('history: a later version whose summary says Start is not labelled Start — only the chain decides', async () => {
    const { store, access } = harnessAccess();
    const orig = await access.install({ id: 'wc', name: 'WC', record: REC('wc'), bundleSource: 'V1', prompt: envelope('p1') });
    await store.snapshot('wc', { 'bundle.js': 'V2' }, envelope('start over', { text: 'A fresh tip splitter.', kind: 'Start', touched: [], marks: [] }));
    const rows = buildHistoryRows(await listVersions(access, orig), await access.activeId(orig));
    h.eq(rows.map(r => r.kind), [null, 'Start'], 'one Start, on the first version');
    h.eq(rows[0].result?.text, 'A fresh tip splitter.', 'the later version still opens with its summary');
  });

  await h.test('history: a version made from an older one is placed by its chain, not by its time', async () => {
    const { store, access } = harnessAccess(scripted([1_700_000_060_000, 1_700_000_060_000, 1_700_000_060_000, 1_700_000_000_000]));
    const orig = await access.install({ id: 'wc', name: 'WC', record: REC('wc'), bundleSource: 'V1', prompt: envelope('p1') });
    await store.snapshot('wc', { 'bundle.js': 'V2' }, envelope('p2'));
    await store.snapshot('wc', { 'bundle.js': 'V3' }, envelope('p3'));
    const first = (await listVersions(access, orig))[2];
    await access.rollback(orig, first.id);
    const edited = await access.update(orig, { record: orig.record, bundleSource: 'V4', prompt: envelope('from p1') });
    let rows = buildHistoryRows(await listVersions(access, edited), await access.activeId(edited));
    h.eq(rows.map(r => r.promptText), ['from p1', 'p1'], 'the version made from p1 sits above it, though it is stamped a minute earlier');
    h.eq(rows.map(r => r.isCurrent), [true, false], 'and is the current one');
    h.eq(startRows(rows), { start: ['p1'], first: ['p1'] }, 'Start stays on p1');

    await access.rollback(edited, first.id);
    rows = buildHistoryRows(await listVersions(access, edited), await access.activeId(edited));
    h.eq(rows.map(r => r.promptText), ['from p1', 'p3', 'p2', 'p1'], 'back on p1, the later versions list newest made first');
    h.eq(startRows(rows), { start: ['p1'], first: ['p1'] }, 'with Start still on p1');
  });

  await h.test('history: a copy and its original each keep their own chain, ordered within one second', async () => {
    const { access } = harnessAccess(ONE_SECOND);
    const orig = await access.install({ id: 'wc', name: 'WC', record: REC('wc'), bundleSource: 'V1', prompt: envelope('p1') });
    const v2 = await access.update(orig, { record: orig.record, bundleSource: 'V2', prompt: envelope('p2') });
    const [, firstVersion] = await listVersions(access, v2);
    const copy = await access.fork(v2, firstVersion.id);
    const copyEdited = await access.update(copy, { record: copy.record, bundleSource: 'C1', prompt: envelope('copy a') });
    await access.update(copyEdited, { record: copy.record, bundleSource: 'C2', prompt: envelope('copy b') });
    await access.update(v2, { record: orig.record, bundleSource: 'V3', prompt: envelope('p3') });

    const copyRows = buildHistoryRows(await listVersions(access, copy), await access.activeId(copy));
    h.eq(copyRows.map(r => r.promptText), ['copy b', 'copy a', 'p1'], "the copy lists its own versions newest first, then the version it was made from");
    h.eq(startRows(copyRows), { start: ['p1'], first: ['p1'] }, "the copy's Start is the first version of its chain");
    const origRows = buildHistoryRows(await listVersions(access, orig), await access.activeId(orig));
    h.eq(origRows.map(r => r.promptText), ['p3', 'p2', 'p1'], "the original keeps its own order, with none of the copy's versions");
    h.eq(startRows(origRows), { start: ['p1'], first: ['p1'] }, "the original's Start is unchanged");
  });

  // ── isAtTip (design D6, unchanged — LauncherRoot's delivery path depends on it) ──
  await h.test('history: isAtTip is true immediately after install and after every fresh update', async () => {
    const { access } = harnessAccess();
    const orig = await access.install({ id: 'wc', name: 'WC', record: REC('wc'), bundleSource: 'V1', prompt: 'p1' });
    h.eq(await isAtTip(access, orig), true, 'at tip right after install');
    const updated = await access.update(orig, { record: orig.record, bundleSource: 'V2', prompt: 'p2' });
    h.eq(await isAtTip(access, updated), true, 'at tip right after a fresh update');
  });

  await h.test('history: isAtTip is false after a rollback to a non-tip snapshot', async () => {
    const { store, access } = harnessAccess();
    const orig = await access.install({ id: 'wc', name: 'WC', record: REC('wc'), bundleSource: 'V1', prompt: 'p1' });
    await store.snapshot('wc', { 'bundle.js': 'V2' }, 'p2');
    const list = await listVersions(access, orig);
    const oldest = list[list.length - 1];
    await access.rollback(orig, oldest.id);
    h.eq(await isAtTip(access, orig), false, 'not at tip after rolling back to an older snapshot');
  });

  // ── the meta line ─────────────────────────────────────────────────────────
  await h.test('history: a row’s meta line says its version and how long ago it was made, in words', async () => {
    const { store, access } = harnessAccess();
    const orig = await access.install({ id: 'wc', name: 'WC', record: REC('wc'), bundleSource: 'V1', prompt: envelope('p1') });
    await store.snapshot('wc', { 'bundle.js': 'V2' }, envelope('p2'));
    const list = await listVersions(access, orig);
    const made = list[0].createdAt;
    const metaAt = (later: number) => buildHistoryRows(list, list[0].id, made + later)[0].meta;
    h.eq(metaAt(30_000), 'v2 · just now', 'under a minute');
    h.eq(metaAt(5 * 60_000), 'v2 · 5 min ago', 'minutes');
    h.eq(metaAt(3 * 3_600_000), 'v2 · 3 h ago', 'hours');
    h.eq(metaAt(2 * 86_400_000), 'v2 · 2 days ago', 'days');
    h.eq(buildHistoryRows(list, list[0].id, made + 30_000)[1].meta, 'v1 · just now', 'the first version is v1');
  });

}
