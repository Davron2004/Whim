/**
 * History screen acceptance (`history-ui.spec.md`, shell-redesign-v2 chain-E) — drives a real
 * MemoryFs-backed `VersionStore` through `StoreAccess` + the RN-free `history-logic.ts` decision
 * logic (mirrors `store-access.suite.ts`'s idiom), plus a couple of static source-wiring checks
 * for the parts that can only be observed by reading `HistoryScreen.tsx`/`HomeScreen.tsx`/
 * `LauncherRoot.tsx` (this repo's precedent for RN-component wiring — see
 * `dev-probe-back-button.suite.ts`). Pin verbs are covered by `store-access.suite.ts` — the `4a`
 * redesign withdraws the launcher's pin SURFACE, not the store's pin verbs (version-history
 * REMOVED "Named pins").
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { Harness } from './harness';
import { createMemoryStore, MapKVBackend } from '../../version-store';
import { AppIndex } from '../app-index';
import { StoreAccess, storeIdOf } from '../store-access';
import {
  addedFieldsBetween,
  annotationBetween,
  buildHistoryRows,
  fieldsLeavingViewOnRestore,
  filterRows,
  formatRelativeTimestamp,
  groupCounts,
  isAtTip,
  listVersions,
  storedSummary,
} from '../history-logic';
import type { AppRecord } from '../../bridge/contract';

const REC = (id: string): AppRecord => ({ appId: id, name: id, manifest: { capabilities: ['storage'] } });

const envelope = (text: string, summary?: object) => JSON.stringify({ v: 1, text, ...(summary ? { summary } : {}) });

function storeClock(): () => number {
  let t = 1_700_000_000_000;
  return () => (t += 1000);
}

function harnessAccess() {
  const store = createMemoryStore({ autoCompact: false, now: storeClock() });
  const index = new AppIndex(new MapKVBackend());
  const access = new StoreAccess({ store, index, now: () => Date.now() });
  return { store, index, access };
}

const BEFORE_SCHEMA = '{"schemaVersion":1,"collections":{"Entries":{"id":"c1","fields":{"amount":{"id":"f1","type":"int"}},"tombstones":[]}}}';
const AFTER_SCHEMA = '{"schemaVersion":1,"collections":{"Entries":{"id":"c1","fields":{"amount":{"id":"f1","type":"int"},"notes":{"id":"f2","type":"text","default":""}},"tombstones":[]}}}';

const SUMMARY_ADDED = { text: 'A chime now plays before the last pour.', kind: 'Added', touched: ['Sounds'], marks: [] };

export async function runHistoryLogicTests(h: Harness): Promise<void> {
  // ── History reads as the user's own prompts (E1/E2) ───────────────────────
  await h.test('history: a row with a stored summary headlines with the summary text', () => {
    const summary = storedSummary(envelope('give me a warning chime', SUMMARY_ADDED));
    h.ok(summary != null && summary.text === SUMMARY_ADDED.text, 'the summary parses off the prompt envelope');
  });

  await h.test('history: fallback to prompt text (v1 envelope, no summary, or a run with none)', async () => {
    const { store, access } = harnessAccess();
    const orig = await access.install({
      id: 'wc', name: 'WC', record: REC('wc'), bundleSource: 'V1',
      prompt: envelope('make a tip splitter'),
    });
    await store.snapshot('wc', { 'bundle.js': 'V2' }, 'Example: track water'); // raw legacy prompt
    const list = await listVersions(access, orig);
    const rows = buildHistoryRows(list, await access.activeId(orig));
    h.eq(rows.map(r => r.headline), ['Example: track water', 'make a tip splitter'], 'no summary on either row: headline falls back to the resolved prompt text');
    h.eq(rows.map(r => r.kind), [null, null], 'no summary: no kind either');
    h.ok(rows.every(r => typeof r.when === 'string' && r.when.length > 0), 'every row carries a formatted timestamp');
  });

  await h.test('history: a summarised row headlines with the summary; an un-summarised sibling falls back to its prompt', async () => {
    const { store, access } = harnessAccess();
    const orig = await access.install({ id: 'wc', name: 'WC', record: REC('wc'), bundleSource: 'V1', prompt: envelope('a tip splitter') });
    await store.snapshot('wc', { 'bundle.js': 'V2' }, envelope('add a warning chime', SUMMARY_ADDED));
    const list = await listVersions(access, orig); // [summarised, install]
    const rows = buildHistoryRows(list, await access.activeId(orig));
    h.eq(rows[0].headline, SUMMARY_ADDED.text, "the summarised row's headline is the summary's text, not the prompt");
    h.eq(rows[0].kind, 'Added', 'its kind comes from the summary');
    h.eq(rows[1].headline, 'a tip splitter', "the install row (no summary) falls back to its prompt's text");
  });

  // ── Kind grouping + unclassified rows (E6) ────────────────────────────────
  await h.test('history: kind groups into the three filter pills; a version with no kind is unclassified', async () => {
    const { store, access } = harnessAccess();
    const orig = await access.install({ id: 'wc', name: 'WC', record: REC('wc'), bundleSource: 'V1', prompt: envelope('install it') });
    await store.snapshot('wc', { 'bundle.js': 'V2' }, envelope('add a chime', SUMMARY_ADDED)); // features
    await store.snapshot('wc', { 'bundle.js': 'V3' }, envelope('make the numbers bigger', { text: 'The numbers are bigger now.', kind: 'Look', touched: [], marks: [] })); // look
    await store.snapshot('wc', { 'bundle.js': 'V4' }, envelope('it broke', { text: 'Fixed a crash on start.', kind: 'Fixed', touched: [], marks: [] })); // fixes
    await store.snapshot('wc', { 'bundle.js': 'V5' }, 'raw legacy, no envelope at all'); // unclassified
    const list = await listVersions(access, orig);
    const rows = buildHistoryRows(list, await access.activeId(orig));
    h.eq(rows.map(r => r.group), [null, 'fixes', 'look', 'features', null], 'each row groups by its summariser kind; the raw-string and install rows are unclassified');

    const counts = groupCounts(rows);
    h.eq(counts, { features: 1, look: 1, fixes: 1 }, 'live per-group counts');

    const all = filterRows(rows, 'all');
    h.eq(all.length, rows.length, 'the all-versions pill never hides a row, unclassified included');
    const features = filterRows(rows, 'features');
    h.eq(features.map(r => r.id), [rows[3].id], 'the features pill narrows to only that group');
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

  // ── At most two actions per row, never a third (E5/E9) ────────────────────
  await h.test('history: no row ever exposes more than two actions', async () => {
    const { store, access } = harnessAccess();
    const orig = await access.install({ id: 'wc', name: 'WC', record: REC('wc'), bundleSource: 'V1', prompt: envelope('install') });
    await store.snapshot('wc', { 'bundle.js': 'V2' }, envelope('p2'));
    await store.snapshot('wc', { 'bundle.js': 'V3' }, envelope('p3'));
    const list = await listVersions(access, orig); // [p3 (current), p2, install]
    const rows = buildHistoryRows(list, await access.activeId(orig));
    h.ok(rows.every(r => r.actions.length <= 2), 'no row ever carries more than two actions');

    const [current, middle, install] = rows;
    h.eq(current.actions, ['change-from-here'], 'the current version offers exactly one action');
    h.eq(middle.actions, ['go-back', 'start-copy'], 'a past, non-install version offers exactly two');
    h.eq(install.actions, ['start-copy'], 'the install row offers only "start a copy here" — no restore, there is no earlier state');
  });

  // ── Any version can become its own app (unchanged) ─────────────────────────
  await h.test('history: "make this version its own app" forks from the exact version viewed', async () => {
    const { store, index, access } = harnessAccess();
    const orig = await access.install({ id: 'wc', name: 'WC', record: REC('wc'), bundleSource: 'V1', prompt: envelope('p1') });
    await store.snapshot('wc', { 'bundle.js': 'V2' }, envelope('p2'));
    const list = await listVersions(access, orig);
    const oldVersion = list[list.length - 1]; // not the newest
    const forked = await access.fork(orig, oldVersion.id);
    h.eq(await access.activeBundle(forked), 'V1', "the new entry's code is exactly the viewed version");
    h.eq(await access.activeBundle(orig), 'V2', 'the original app is unchanged');
    h.ok(index.get(forked.id) != null, 'a new launcher entry was created');
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

  // ── formatRelativeTimestamp (unchanged) ────────────────────────────────────
  await h.test('history: formatRelativeTimestamp renders short relative labels', () => {
    const now = 1_700_000_000_000;
    h.eq(formatRelativeTimestamp(now - 30_000, now), 'Just now', 'under a minute');
    h.eq(formatRelativeTimestamp(now - 5 * 60_000, now), '5m ago', 'minutes');
    h.eq(formatRelativeTimestamp(now - 3 * 3_600_000, now), '3h ago', 'hours');
    h.eq(formatRelativeTimestamp(now - 2 * 86_400_000, now), '2d ago', 'days');
  });

  // ── Static wiring: HistoryScreen/HomeScreen/LauncherRoot ──────────────────
  await h.test('history: HistoryScreen wires expand-not-restore, confirm-gated restore, and fork-from-version', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'src/host/launcher/HistoryScreen.tsx'), 'utf8');
    h.ok(src.includes('onPress={onToggle}'), 'tapping a row toggles expansion, not a restore');
    h.ok(src.includes('await access.rollback(app, row.id);'), 'restore only happens from the confirm sheet, against the row\'s own version');
    h.ok(src.includes('await access.fork(app, row.id);'), 'fork-from-version calls StoreAccess.fork with the viewed snapshot id');
  });

  await h.test('history: History is reachable from the home action sheet and LauncherRoot switch', () => {
    const homeSrc = fs.readFileSync(path.join(process.cwd(), 'src/host/launcher/HomeScreen.tsx'), 'utf8');
    h.ok(homeSrc.includes('COPY.actionHistory') && homeSrc.includes('onHistory(a)'), 'HomeScreen sheet has a History row wired to onHistory');
    const rootSrc = fs.readFileSync(path.join(process.cwd(), 'src/host/launcher/LauncherRoot.tsx'), 'utf8');
    h.ok(rootSrc.includes("{ kind: 'history'; app: InstalledApp }"), "LauncherRoot's Screen union has the history variant");
    h.ok(rootSrc.includes('<HistoryScreen app={screen.app} access={access} onBack={goHome} />'), 'LauncherRoot renders HistoryScreen with the shared goHome (refreshes Home on return) — the existing props signature, unchanged');
  });
}
