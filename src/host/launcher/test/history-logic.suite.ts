/**
 * History screen acceptance (task 1.3/4.6, `history-ui.spec.md`) — drives a real MemoryFs-backed
 * `VersionStore` through `StoreAccess` + the RN-free `history-logic.ts` decision logic (mirrors
 * `store-access.suite.ts`'s idiom), plus a few static source-wiring checks for the parts that can
 * only be observed by reading `HistoryScreen.tsx`/`HomeScreen.tsx`/`LauncherRoot.tsx` (this repo's
 * precedent for RN-component wiring — see `dev-probe-back-button.suite.ts`).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { Harness } from './harness';
import { createMemoryStore, MapKVBackend } from '../../version-store';
import { AppIndex } from '../app-index';
import { StoreAccess, storeIdOf } from '../store-access';
import { parsePromptEnvelope } from '../prompt-envelope';
import {
  addedFieldsBetween,
  annotationBetween,
  fieldsLeavingViewOnRestore,
  formatRelativeTimestamp,
  listVersions,
  restoreTargetId,
} from '../history-logic';
import type { AppRecord } from '../../bridge/contract';

const REC = (id: string): AppRecord => ({ appId: id, name: id, manifest: { capabilities: ['storage'] } });

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

export async function runHistoryLogicTests(h: Harness): Promise<void> {
  // ── Rows read as the user's own prompts (§1) ──────────────────────────────
  await h.test('history §1 rows render envelope-parsed and raw-fallback prompts, with timestamps', async () => {
    const { store, access } = harnessAccess();
    const orig = await access.install({
      id: 'wc', name: 'WC', record: REC('wc'), bundleSource: 'V1',
      prompt: JSON.stringify({ v: 1, text: 'make a tip splitter' }),
    });
    await store.snapshot('wc', { 'bundle.js': 'V2' }, 'Example: track water'); // raw legacy prompt
    const list = await listVersions(access, orig);
    h.eq(list.map(s => parsePromptEnvelope(s.prompt).text), ['Example: track water', 'make a tip splitter'], 'envelope + raw fallback both render as plain text');
    h.ok(list.every(s => typeof s.createdAt === 'number'), 'every row carries a timestamp');
  });

  // ── Install row has no restore affordance (§2) ────────────────────────────
  await h.test('history §2 the oldest (install) row has no restore target', async () => {
    const { access } = harnessAccess();
    const orig = await access.install({ id: 'wc', name: 'WC', record: REC('wc'), bundleSource: 'V1', prompt: 'p1' });
    const list = await listVersions(access, orig);
    h.eq(restoreTargetId(list, list.length - 1), null, 'oldest row: no predecessor to restore to');
  });

  // ── Tap restores the state before that prompt (§3-4) ──────────────────────
  await h.test('history §3-4 a row restores to its predecessor and the current marker follows', async () => {
    const { store, access } = harnessAccess();
    const orig = await access.install({ id: 'wc', name: 'WC', record: REC('wc'), bundleSource: 'V1', prompt: 'p1' });
    await store.snapshot('wc', { 'bundle.js': 'V2' }, 'p2');
    const list = await listVersions(access, orig); // [p2, p1] newest-first
    const target = restoreTargetId(list, 0);
    h.eq(target, list[1].id, "row 0's (p2) restore target is its predecessor (p1)");
    await access.rollback(orig, target!);
    h.eq(await access.activeId(orig), target, 'current marker moved to the restore target');
  });

  // ── Undo returns to the pre-restore version (§5) ──────────────────────────
  await h.test('history §5 undo captures the pre-restore active id and returns to it', async () => {
    const { store, access } = harnessAccess();
    const orig = await access.install({ id: 'wc', name: 'WC', record: REC('wc'), bundleSource: 'V1', prompt: 'p1' });
    await store.snapshot('wc', { 'bundle.js': 'V2' }, 'p2');
    const list = await listVersions(access, orig);
    const priorActiveId = await access.activeId(orig); // captured BEFORE the restore, like the screen does
    const target = restoreTargetId(list, 0)!;
    await access.rollback(orig, target);
    h.eq(await access.activeId(orig), target, 'restored');
    await access.rollback(orig, priorActiveId!); // Undo
    h.eq(await access.activeId(orig), priorActiveId, 'undo returned to the version active before the restore');
  });

  // ── Named pins: label appears, re-pin moves it (§6) ───────────────────────
  await h.test('history §6 pin label appears and re-pinning moves it', async () => {
    const { store, access } = harnessAccess();
    const orig = await access.install({ id: 'wc', name: 'WC', record: REC('wc'), bundleSource: 'V1', prompt: 'p1' });
    await store.snapshot('wc', { 'bundle.js': 'V2' }, 'p2');
    const list = await listVersions(access, orig);
    const [newest, oldest] = list;
    await access.pin(orig, oldest.id, 'known-good');
    h.eq((await access.listPins(orig)).map(p => p.snapshotId), [oldest.id], 'label appears on the pinned version');
    await access.pin(orig, newest.id, 'known-good'); // re-pin
    const pins = await access.listPins(orig);
    h.eq(pins.length, 1, 'still exactly one pin under that label');
    h.eq(pins[0].snapshotId, newest.id, 're-pinning moved the label to the newly pinned version');
  });

  // ── Fork-from-version creates a new entry (§7) ────────────────────────────
  await h.test('history §7 "make this version its own app" forks from the exact version viewed', async () => {
    const { store, index, access } = harnessAccess();
    const orig = await access.install({ id: 'wc', name: 'WC', record: REC('wc'), bundleSource: 'V1', prompt: 'p1' });
    await store.snapshot('wc', { 'bundle.js': 'V2' }, 'p2');
    const list = await listVersions(access, orig);
    const oldVersion = list[list.length - 1]; // not the newest
    const forked = await access.fork(orig, oldVersion.id);
    h.eq(await access.activeBundle(forked), 'V1', 'the new entry\'s code is exactly the viewed version');
    h.eq(await access.activeBundle(orig), 'V2', 'the original app is unchanged');
    h.ok(index.get(forked.id) != null, 'a new launcher entry was created');
  });

  // ── Data-shape annotation on a schema-adding row (§8) ─────────────────────
  await h.test('history §8 a row whose schema.json added a field carries the annotation', async () => {
    const { store, access } = harnessAccess();
    const orig = await access.install({ id: 'wc', name: 'WC', record: REC('wc'), bundleSource: 'V1', prompt: 'install' });
    await store.snapshot('wc', { 'bundle.js': 'V1', 'schema.json': BEFORE_SCHEMA }, 'p1');
    await store.snapshot('wc', { 'bundle.js': 'V1', 'schema.json': AFTER_SCHEMA }, 'p2 adds notes');
    const list = await listVersions(access, orig); // [p2, p1, install]
    const annotation = await annotationBetween(access, orig, list[1].id, list[0].id);
    h.eq(annotation, ['notes (text)'], 'the added field is named with its type');
  });

  await h.test('history §8b a row whose schema.json did not change carries no annotation', async () => {
    const { store, access } = harnessAccess();
    const orig = await access.install({ id: 'wc', name: 'WC', record: REC('wc'), bundleSource: 'V1', prompt: 'install' });
    await store.snapshot('wc', { 'bundle.js': 'V1', 'schema.json': BEFORE_SCHEMA }, 'p1');
    await store.snapshot('wc', { 'bundle.js': 'V2', 'schema.json': BEFORE_SCHEMA }, 'p2 no schema change');
    const list = await listVersions(access, orig);
    const annotation = await annotationBetween(access, orig, list[1].id, list[0].id);
    h.eq(annotation, [], 'no schema.json diff -> no annotation');
  });

  // ── Restore reassurance when fields leave view (§9) ───────────────────────
  await h.test('history §9 restoring to a version missing fields the active version has shows a reassurance', async () => {
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

  await h.test('history §9b restoring to the active version itself shows no reassurance', async () => {
    const { store, access } = harnessAccess();
    const orig = await access.install({ id: 'wc', name: 'WC', record: REC('wc'), bundleSource: 'V1', prompt: 'install' });
    await store.snapshot('wc', { 'bundle.js': 'V1', 'schema.json': BEFORE_SCHEMA }, 'p1');
    const activeIdValue = (await access.activeId(orig))!;
    const leaving = await fieldsLeavingViewOnRestore(access, orig, activeIdValue, activeIdValue);
    h.eq(leaving, [], 'no fields leave view when the restore target IS the active version');
  });

  // ── addedFieldsBetween never throws on malformed input ────────────────────
  await h.test('history addedFieldsBetween tolerates malformed JSON without throwing', () => {
    h.eq(addedFieldsBetween(undefined, '{not json'), [], 'malformed "after" JSON yields no annotation, no throw');
    h.eq(addedFieldsBetween('{not json', '{"schemaVersion":1,"collections":{}}'), [], 'malformed "before" JSON yields no annotation, no throw');
  });

  // ── F1 guard: fork listing never leaks the original's later lineage (§10) ─
  await h.test('history §10 F1 repro: a fresh, undiverged fork lists only its own line', async () => {
    const { store, access } = harnessAccess();
    const orig = await access.install({ id: 'wc', name: 'WC', record: REC('wc'), bundleSource: 'V1', prompt: 'p1' });
    const fork = await access.fork(orig); // fresh, undiverged: fork tip === orig tip
    await access.activeBundle(orig); // switches the repo back to main (ensureLineage side effect)
    await store.snapshot(storeIdOf(orig), { 'bundle.js': 'V2_ORIG' }, 'orig post-fork edit'); // ONLY on original's line
    const forkList = await listVersions(access, fork);
    h.eq(forkList.map(s => s.prompt), ['p1'], "the undiverged fork's listing has no trace of the original's later edit");
  });

  // ── Primary lineage lists via timeline(): roll-forward survives a restore (§11) ─
  await h.test('history §11 the primary lineage listing survives a restore (roll-forward)', async () => {
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

  // ── formatRelativeTimestamp ────────────────────────────────────────────────
  await h.test('history formatRelativeTimestamp renders short relative labels', () => {
    const now = 1_700_000_000_000;
    h.eq(formatRelativeTimestamp(now - 30_000, now), 'Just now', 'under a minute');
    h.eq(formatRelativeTimestamp(now - 5 * 60_000, now), '5m ago', 'minutes');
    h.eq(formatRelativeTimestamp(now - 3 * 3_600_000, now), '3h ago', 'hours');
    h.eq(formatRelativeTimestamp(now - 2 * 86_400_000, now), '2d ago', 'days');
  });

  // ── Static wiring: HistoryScreen/HomeScreen/LauncherRoot ──────────────────
  await h.test('history: HistoryScreen wires install-row-disabled, undo-before-restore, pin, and fork', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'src/host/launcher/HistoryScreen.tsx'), 'utf8');
    h.ok(src.includes('disabled={isInstallRow}'), 'the install row disables the restore tap');
    // Undo must capture the pre-restore active id before calling rollback for the restore itself.
    const priorIdx = src.indexOf('const priorActiveId = activeId;');
    const rollbackIdx = src.indexOf('await access.rollback(app, targetId);');
    h.ok(priorIdx !== -1 && rollbackIdx !== -1 && priorIdx < rollbackIdx, 'priorActiveId is captured before the restore rollback call');
    h.ok(src.includes('await access.rollback(app, toast.priorActiveId);'), 'undo rolls back to the captured prior active id');
    h.ok(src.includes('await access.pin(app, snapshot.id, label);'), 'pin flow calls StoreAccess.pin with the label');
    h.ok(src.includes('await access.fork(app, snapshot.id);'), 'fork-from-version calls StoreAccess.fork with the viewed snapshot id');
  });

  await h.test('history: History is reachable from the home action sheet and LauncherRoot switch', () => {
    const homeSrc = fs.readFileSync(path.join(process.cwd(), 'src/host/launcher/HomeScreen.tsx'), 'utf8');
    h.ok(homeSrc.includes('COPY.actionHistory') && homeSrc.includes('onHistory(a)'), 'HomeScreen sheet has a History row wired to onHistory');
    const rootSrc = fs.readFileSync(path.join(process.cwd(), 'src/host/launcher/LauncherRoot.tsx'), 'utf8');
    h.ok(rootSrc.includes("{ kind: 'history'; app: InstalledApp }"), "LauncherRoot's Screen union has the history variant");
    h.ok(rootSrc.includes('<HistoryScreen app={screen.app} access={access} onBack={goHome} />'), 'LauncherRoot renders HistoryScreen with the shared goHome (refreshes Home on return)');
  });
}
