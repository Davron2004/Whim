/** The rendered Home: its layout at every text size, what each tile says and its menu offers, Delete
 *  and Discard with Undo, Make a copy and its question, Customize tile, search, the empty state, the
 *  offline notice, the skeleton, and the tile's plate in every state. The order and the rows
 *  themselves are `grid-composition.suite.ts`; the stores behind Delete are `launcher-interactions`. */
import React from 'react';
import TestRenderer from 'react-test-renderer';
import { Harness } from './harness';
import { COPY } from '../copy';
import { PendingBuildStore, type PendingBuildRecord } from '../pending-builds';
import { MapKVBackend } from '../../version-store';
import type { InstalledApp } from '../app-index';
import { appLinkFor } from '../app-link';
import { tileOf } from '../tile-identity';
import { gridLayout } from '../../ui/AppTile-geometry';
import { TilePlate } from '../../ui/AppTile';
import { HomeSkeleton } from '../HomeSkeleton';
import { COLORS, LAYOUT, ON_PLATE, SHAPE, TILE_RIM, TINTS } from '../../../design/tokens';
import { ICON_PATHS } from '../../../design/icons/paths';
import { squirclePath } from '../../../design/icons/squircle';
import { mixHex } from '../../../design/tints';
import AppTile from '../app-tile';
import { tileColor } from '../tiles';
import { Share, StyleSheet, accessibilitySettings, setColorScheme, windowMetrics } from './native-host';
import { press, renderScreen, screenReaderElement, textOf, unmountScreen, hostType } from './react-screen';
import {
  chooseRow, longPress, menuCard, menuLabels, menuRows, pressToastAction, renderHome, settle, sheetRows, sheetTitled,
  tile, tileLabels, tiles, toastOf, updateHome, type Tree,
} from './home-rig';

type Style = Record<string, unknown>;
const flat = (node: TestRenderer.ReactTestInstance): Style => StyleSheet.flatten(node.props.style) as Style;

const DAY = 24 * 60 * 60 * 1000;

function app(id: string, createdAt: number, extra: Partial<InstalledApp> = {}): InstalledApp {
  return { id, name: id, createdAt, lineageId: 'main', record: { appId: id, name: id, manifest: { capabilities: [] } }, ...extra };
}
const TIMER = app('Timer', 1);

type Spec = { id: string; prompt: string; state: 'building' | 'failed' | 'interrupted'; age?: number; editingAppId?: string; remedy?: boolean };

/** Attempts as the store writes them, newest first as given, aged to `age` ms before now. */
function attempts(spec: Spec[]): PendingBuildRecord[] {
  const store = new PendingBuildStore(new MapKVBackend());
  const make = (s: Spec) => store.create({ id: s.id, prompt: s.prompt, workingTitle: s.prompt.slice(0, 20), ...(s.editingAppId ? { editingAppId: s.editingAppId } : {}) });
  spec.filter((s) => s.state === 'interrupted').forEach(make);
  store.demoteBuildingToInterrupted();
  for (const s of spec.filter((x) => x.state !== 'interrupted')) {
    make(s);
    if (s.state === 'failed') store.setFailed(s.id, { reason: 'It did not build.', ...(s.remedy ? { remedy: { kind: 'update' as const, protocolLevel: 9 } } : {}) });
  }
  return spec.map((s) => ({ ...store.get(s.id)!, createdAt: Date.now() - (s.age ?? 0) }));
}

/** The cell around a tile: the animated frame that gives it its width and height. */
function frameOf(node: TestRenderer.ReactTestInstance): TestRenderer.ReactTestInstance {
  let up = node.parent;
  while (up && hostType(up) !== 'Animated.View') up = up.parent;
  if (!up) throw new Error('a tile has no frame');
  return up;
}

const svgs = (root: TestRenderer.ReactTestInstance) => root.findAll((n) => hostType(n) === 'Svg');
const paths = (root: TestRenderer.ReactTestInstance) => root.findAll((n) => hostType(n) === 'Path');

async function resetPhone(): Promise<void> {
  accessibilitySettings.reduceMotion = false;
  accessibilitySettings.increaseContrast = false;
  accessibilitySettings.screenReader = false;
  windowMetrics.fontScale = 1;
  Share.shared.splice(0);
  await TestRenderer.act(async () => setColorScheme('light'));
}

async function plate(element: React.ReactElement): Promise<Tree> {
  const tree = await renderScreen(element);
  await settle();
  return tree;
}

export async function runHomeGridUiTests(h: Harness): Promise<void> {
  // ── layout ──────────────────────────────────────────────────────────────────
  await h.test('home layout: four columns of ⌊(screen − 40) / 4⌋ at normal text, three from 135%, a list of 40 pt tiles from 200%', async () => {
    const apps = [TIMER, app('Dice', 2), app('Plants', 3)];
    const seen: Record<string, { width: unknown; plate: number; height: unknown }> = {};
    for (const [scale, key] of [[1, 'normal'], [1.35, '135%'], [2, '200%']] as const) {
      await resetPhone();
      windowMetrics.fontScale = scale;
      const tree = await renderHome({ apps });
      try {
        const cell = frameOf(tile(tree, 'Timer'));
        const side = svgs(tile(tree, 'Timer'))[0].props.width as number;
        seen[key] = { width: flat(cell).width, plate: side, height: flat(cell).minHeight };
      } finally { await unmountScreen(tree); }
    }
    h.eq(seen.normal.width, 87, 'four columns across the 350 pt between the gutters, 87.5 rounded down');
    h.eq(seen.normal.plate, 64, 'of 64 pt tiles');
    h.ok((seen.normal.height as number) >= 84 && (seen.normal.width as number) >= 64, 'a cell is at least 64 × 84 to touch');
    h.eq(seen['135%'].width, 116, 'three columns from 135%, 116.67 rounded down');
    h.eq(seen['135%'].plate, 64, 'the tile keeps its 64');
    h.eq(seen['200%'].width, '100%', 'a list of full-width rows from 200%');
    h.eq(seen['200%'].plate, 40, 'with 40 pt tiles');
    h.ok((seen['200%'].height as number) >= LAYOUT.listRowMinHeight, 'and a row at least the list row’s height');
    windowMetrics.fontScale = 1;
  });

  await h.test('home layout: the list at 200% shows the full name, where the grid cuts a long one at two lines', async () => {
    await resetPhone();
    const long = app('Pour-Over Timer With A Very Long Name Indeed', 1);
    const grid = await renderHome({ apps: [long] });
    const name = (tree: Tree) => tile(tree, long.name).findAll((n) => hostType(n) === 'Text' && textOf(n) === long.name)[0];
    h.eq(name(grid).props.numberOfLines, 2, 'two lines, then an ellipsis, on the grid');
    await unmountScreen(grid);
    windowMetrics.fontScale = 2;
    const list = await renderHome({ apps: [long] });
    try {
      h.ok(name(list).props.numberOfLines === undefined, 'the list shows it in full');
    } finally { await unmountScreen(list); windowMetrics.fontScale = 1; }
  });

  // ── what is on the grid ─────────────────────────────────────────────────────
  await h.test('home grid: attempts being made first, then recent failures, then apps newest first, labelled with their state', async () => {
    await resetPhone();
    const pending = attempts([
      { id: 'p-making', prompt: 'A pour over timer', state: 'building' },
      { id: 'p-failed', prompt: 'A dice roller game', state: 'failed' },
      { id: 'p-stopped', prompt: 'Plant watering tracker app', state: 'interrupted' },
      { id: 'p-update', prompt: 'The garden planner', state: 'failed', remedy: true },
    ]);
    const tree = await renderHome({ apps: [TIMER, app('Dice', 5, { example: true }), app('Copy of Timer', 9, { forkedFrom: { id: 'Timer', name: 'Timer' } })], pending, queued: new Set(['p-making']) });
    try {
      h.eq(tileLabels(tree), [
        'Pour over timer, waiting', 'Dice roller game, didn’t work', 'Plant watering tracker, stopped', 'Garden planner, needs update',
        'Copy of Timer, copy', 'Dice, example', 'Timer',
      ], 'making, recent attempts, then the apps newest first, each with its state');
      h.ok(tiles(tree).every((t) => t.props.accessibilityRole === 'button' && typeof t.props.accessibilityHint === 'string' && t.props.accessibilityHint !== ''), 'each is a button with a hint for what it does');
    } finally { await unmountScreen(tree); }
  });

  await h.test('home grid: a tile being made does not launch an app; its page opens, as does a failed or stopped one’s', async () => {
    await resetPhone();
    const pending = attempts([{ id: 'p-making', prompt: 'A pour over timer', state: 'building' }, { id: 'p-failed', prompt: 'A dice roller game', state: 'failed' }]);
    const opened: string[] = [];
    const pages: string[] = [];
    const tree = await renderHome({ apps: [TIMER], pending, onOpen: (a) => { opened.push(a.id); }, onOpenPending: (r) => { pages.push(r.id); } });
    try {
      await press(tile(tree, 'Pour over timer'));
      await press(tile(tree, 'Dice roller game'));
      await press(tile(tree, 'Timer'));
      h.eq(pages, ['p-making', 'p-failed'], 'the making page and the failure page');
      h.eq(opened, ['Timer'], 'only an installed app opens an app');
    } finally { await unmountScreen(tree); }
  });

  await h.test('home grid: a change in flight shows on the app’s own tile, with no tile of its own; tapping it still opens the app', async () => {
    await resetPhone();
    const pending = attempts([{ id: 'Timer', prompt: 'Add laps', state: 'building', editingAppId: 'Timer' }]);
    const opened: string[] = [];
    const tree = await renderHome({ apps: [TIMER], pending, onOpen: (a) => { opened.push(a.id); } });
    try {
      h.eq(tileLabels(tree), ['Timer, changing'], 'one tile: the app’s, changing');
      await press(tile(tree, 'Timer'));
      h.eq(opened, ['Timer'], 'it opens the app');
    } finally { await unmountScreen(tree); }
  });

  await h.test('home grid: two attempts that failed over a day ago are one tile at the end, reading “2 didn’t work”, that opens a list of them', async () => {
    await resetPhone();
    const pending = attempts([
      { id: 'o1', prompt: 'A dice roller game', state: 'failed', age: 2 * DAY },
      { id: 'o2', prompt: 'Plant watering tracker app', state: 'interrupted', age: 3 * DAY },
    ]);
    const pages: string[] = [];
    const tree = await renderHome({ apps: [TIMER], pending, onOpenPending: (r) => { pages.push(r.id); } });
    try {
      h.eq(tileLabels(tree), ['Timer', '2 didn’t work'], 'the app, then one tile for both');
      await press(tile(tree, '2 didn’t work'));
      const rows = sheetRows(tree, COPY.olderTitle).map((r) => String(r.props.accessibilityLabel));
      h.ok(rows.some((r) => r.startsWith('Dice roller game')) && rows.some((r) => r.startsWith('Plant watering tracker')), `the list names both (${rows.join(' | ')})`);
      await press(sheetRows(tree, COPY.olderTitle).find((r) => String(r.props.accessibilityLabel).startsWith('Plant'))!);
      h.eq(pages, ['o2'], 'a row opens that attempt');
    } finally { await unmountScreen(tree); }
  });

  // ── menus ───────────────────────────────────────────────────────────────────
  await h.test('tile menu: a ready app’s long-press opens a menu headed by its full name, one button per row, a screen reader reaches each on its own', async () => {
    await resetPhone();
    const long = app('Pour-Over Timer With A Very Long Name Indeed', 1);
    const tree = await renderHome({ apps: [long] });
    try {
      await longPress(tree, long.name);
      const card = menuCard(tree)!;
      h.eq([card.props.accessibilityRole, card.props.accessibilityLabel], ['menu', long.name], 'announced as a menu named by the app’s full name');
      h.eq(menuLabels(tree), [COPY.actionOpen, COPY.actionChangeIt, COPY.actionHistory, COPY.actionMakeCopy, COPY.actionCustomize, COPY.actionShareLink, COPY.actionDelete], 'Open, Change it, History, Make a copy, Customize tile, Share link, then Delete');
      h.ok(menuRows(tree).every((row) => screenReaderElement(row) === row), 'each row is an element of its own, not read as part of one around it');
    } finally { await unmountScreen(tree); }
  });

  await h.test('tile menu: a tile being made offers Details and Stop and nothing else; no tile shows a cancel or discard control on its face', async () => {
    await resetPhone();
    const pending = attempts([{ id: 'p-making', prompt: 'A pour over timer', state: 'building' }, { id: 'p-failed', prompt: 'A dice roller game', state: 'failed' }]);
    const tree = await renderHome({ apps: [TIMER], pending });
    try {
      h.eq(tiles(tree).flatMap((t) => t.findAll((n) => n !== t && hostType(n) === 'Pressable')).length, 0, 'a tile holds no control inside it');
      await longPress(tree, 'Pour over timer');
      h.eq(menuLabels(tree), [COPY.actionDetails, COPY.actionStop], 'Details and Stop');
    } finally { await unmountScreen(tree); }
  });

  await h.test('tile menu: each row does what it says for its tile', async () => {
    await resetPhone();
    const log: string[] = [];
    const pending = attempts([
      { id: 'p-making', prompt: 'A pour over timer', state: 'building' },
      { id: 'p-failed', prompt: 'A dice roller game', state: 'failed' },
      { id: 'p-stopped', prompt: 'Plant watering tracker app', state: 'interrupted' },
      { id: 'p-update', prompt: 'The garden planner', state: 'failed', remedy: true },
      { id: 'Timer', prompt: 'Add laps', state: 'building', editingAppId: 'Timer' },
    ]);
    const tree = await renderHome({
      apps: [TIMER],
      pending,
      onOpen: (a) => log.push(`open ${a.id}`),
      onPromptAgain: (a) => log.push(`change ${a.id}`),
      onHistory: (a) => log.push(`history ${a.id}`),
      onOpenPending: (r) => log.push(`page ${r.id}`),
      onCancelPending: (r) => log.push(`stop ${r.id}`),
      onRetryPending: (r) => log.push(`retry ${r.id}`),
    });
    try {
      const pick = async (name: string, label: string) => { await longPress(tree, name); await chooseRow(tree, label); };
      await pick('Timer, changing', COPY.actionStopChange);
      await pick('Pour over timer', COPY.actionDetails);
      await pick('Pour over timer', COPY.actionStop);
      await pick('Dice roller game', COPY.actionWhatHappened);
      await pick('Dice roller game', COPY.actionTryAgain);
      await pick('Plant watering tracker', COPY.actionTryAgain);
      await pick('Garden planner', COPY.actionUpdateWhim);
      h.eq(log, ['stop Timer', 'page p-making', 'stop p-making', 'page p-failed', 'retry p-failed', 'retry p-stopped', 'page p-update'], 'each row acts on its own record');
    } finally { await unmountScreen(tree); }
    const ready = await renderHome({
      apps: [TIMER], onOpen: (a) => log.push(`open ${a.id}`), onPromptAgain: (a) => log.push(`change ${a.id}`), onHistory: (a) => log.push(`history ${a.id}`),
    });
    try {
      log.splice(0);
      for (const label of [COPY.actionOpen, COPY.actionChangeIt, COPY.actionHistory]) { await longPress(ready, 'Timer'); await chooseRow(ready, label); }
      h.eq(log, ['open Timer', 'change Timer', 'history Timer'], 'a ready app’s Open, Change it and History');
      await longPress(ready, 'Timer');
      h.ok(menuCard(ready) !== undefined, 'the menu opens again each time');
    } finally { await unmountScreen(ready); }
  });

  await h.test('tile menu: Share link hands the app’s link to the platform share sheet', async () => {
    await resetPhone();
    const tree = await renderHome({ apps: [TIMER] });
    try {
      await longPress(tree, 'Timer');
      await chooseRow(tree, COPY.actionShareLink);
      h.eq(Share.shared, [{ message: appLinkFor('Timer') }], 'the link, in the system share sheet');
    } finally { await unmountScreen(tree); }
  });

  await h.test('tile menu: a tile whose app is busy reads busy and opens no menu', async () => {
    await resetPhone();
    const tree = await renderHome({ apps: [TIMER, app('Dice', 2)], appBusy: { Timer: 'fork' } });
    try {
      h.eq(tile(tree, 'Timer').props.accessibilityState, { busy: true }, 'it reads busy');
      h.eq(tile(tree, 'Dice').props.accessibilityState, { busy: false }, 'its neighbour does not');
      await longPress(tree, 'Timer');
      h.eq(menuCard(tree), undefined, 'no menu, so no second copy can start');
      await longPress(tree, 'Dice');
      h.ok(menuCard(tree) !== undefined, 'a tile that is not busy opens one');
    } finally { await unmountScreen(tree); }
  });

  // ── delete and discard ──────────────────────────────────────────────────────
  await h.test('Delete: no dialog; the callback runs at once and a toast “Timer deleted” offers Undo for 10 seconds', async () => {
    await resetPhone();
    const log: string[] = [];
    const tree = await renderHome({ apps: [TIMER], onDelete: (a) => log.push(`delete ${a.id}`), onUndoDelete: (a) => { log.push(`undo ${a.id}`); return true; }, onSettleDelete: (a) => log.push(`settle ${a.id}`) });
    try {
      await longPress(tree, 'Timer');
      await chooseRow(tree, COPY.actionDelete);
      h.eq(log, ['delete Timer'], 'deleted at once, with no confirmation between');
      const toast = toastOf(tree);
      h.eq(toast?.message, 'Timer deleted', 'the toast names it');
      h.eq(toast?.action, COPY.toastUndo, 'and offers Undo');
      h.eq(tree.root.findAll((n) => String(n.type) === 'Alert').length, 0, 'no alert');
      await pressToastAction(tree);
      h.eq(log, ['delete Timer', 'undo Timer', 'settle Timer'], 'Undo undoes that delete, and the toast leaving then ends its window');
    } finally { await unmountScreen(tree); }
  });

  await h.test('Delete: a second delete while the first toast shows ends the first window at once and keeps the second’s Undo; an Undo that restores nothing says so', async () => {
    await resetPhone();
    const log: string[] = [];
    const dice = app('Dice', 2);
    let restores = true;
    const tree = await renderHome({
      apps: [TIMER, dice],
      onDelete: (a) => log.push(`delete ${a.id}`),
      onUndoDelete: (a) => { log.push(`undo ${a.id}`); return restores; },
      onSettleDelete: (a) => log.push(`settle ${a.id}`),
    });
    try {
      await longPress(tree, 'Timer');
      await chooseRow(tree, COPY.actionDelete);
      await longPress(tree, 'Dice');
      await chooseRow(tree, COPY.actionDelete);
      h.eq(log, ['delete Timer', 'delete Dice', 'settle Timer'], 'the second delete replaced the first toast: the first window ended, the second’s is open');
      h.eq(toastOf(tree)?.message, 'Dice deleted', 'the second toast shows');
      restores = false;
      await pressToastAction(tree);
      h.eq(log.slice(3), ['undo Dice', 'settle Dice'], 'Undo reaches the second delete');
      h.eq(toastOf(tree)?.message, COPY.undoTooLateToast, 'an Undo that could not restore the app says so, in a toast');
    } finally { await unmountScreen(tree); }
  });

  await h.test('Discard: a failed attempt leaves with a toast offering Undo; Discard all takes every old attempt and one Undo brings them all back', async () => {
    await resetPhone();
    const log: string[] = [];
    const pending = attempts([
      { id: 'p-failed', prompt: 'A dice roller game', state: 'failed' },
      { id: 'o1', prompt: 'Plant watering tracker app', state: 'failed', age: 2 * DAY },
      { id: 'o2', prompt: 'The garden planner', state: 'interrupted', age: 3 * DAY },
    ]);
    const tree = await renderHome({ pending, onDiscard: (r) => log.push(`discard ${r.map((x) => x.id).join('+')}`), onUndoDiscard: (r) => { log.push(`undo ${r.map((x) => x.id).join('+')}`); return true; }, onSettleDiscard: (r) => log.push(`settle ${r.map((x) => x.id).join('+')}`) });
    try {
      await longPress(tree, 'Dice roller game');
      await chooseRow(tree, COPY.actionDiscard);
      h.eq(toastOf(tree)?.action, COPY.toastUndo, 'a toast offers Undo');
      await pressToastAction(tree);
      await longPress(tree, '2 didn’t work');
      h.eq(menuLabels(tree), [COPY.actionDiscardAll], 'the older tile’s menu');
      await chooseRow(tree, COPY.actionDiscardAll);
      await pressToastAction(tree);
      h.eq(log, ['discard p-failed', 'undo p-failed', 'settle p-failed', 'discard o1+o2', 'undo o1+o2', 'settle o1+o2'], 'one Discard and one Undo for the whole set, each window ended with its toast');
    } finally { await unmountScreen(tree); }
  });

  // ── make a copy ─────────────────────────────────────────────────────────────
  await h.test('Make a copy: when the copy can copy data a sheet asks “Copy the data, or start fresh?”; each answer forks with that data, and dismissing creates nothing', async () => {
    await resetPhone();
    const forks: string[] = [];
    const tree = await renderHome({ apps: [TIMER], canCopyData: true, onFork: async (a, opts) => { forks.push(`${a.id}:${opts.data}`); return { ...a, id: `${a.id}-copy` }; } });
    try {
      await longPress(tree, 'Timer');
      await chooseRow(tree, COPY.actionMakeCopy);
      h.eq(forks, [], 'asking first: nothing is made yet');
      const labels = () => sheetRows(tree, COPY.copyQuestionTitle).map((r) => String(r.props.accessibilityLabel));
      h.ok(labels().some((l) => l.startsWith(COPY.copyQuestionData)) && labels().some((l) => l.startsWith(COPY.copyQuestionFresh)), `both answers are rows (${labels().join(' | ')})`);
      h.ok(!labels().some((l) => /share|same/i.test(l)), 'and none shares the original’s data');

      await TestRenderer.act(async () => sheetRows(tree, COPY.copyQuestionTitle).find((r) => r.props.accessibilityLabel === COPY.sheetClose)!.props.onPress());
      h.eq(forks, [], 'closing the sheet makes nothing');

      await longPress(tree, 'Timer');
      await chooseRow(tree, COPY.actionMakeCopy);
      await press(sheetRows(tree, COPY.copyQuestionTitle).find((r) => String(r.props.accessibilityLabel).startsWith(COPY.copyQuestionData))!);
      h.eq(forks, ['Timer:copy'], '“Copy the data” forks with the data');
      await longPress(tree, 'Timer');
      await chooseRow(tree, COPY.actionMakeCopy);
      await press(sheetRows(tree, COPY.copyQuestionTitle).find((r) => String(r.props.accessibilityLabel).startsWith(COPY.copyQuestionFresh))!);
      h.eq(forks, ['Timer:copy', 'Timer:fresh'], '“Start fresh” forks fresh');
    } finally { await unmountScreen(tree); }
  });

  await h.test('Make a copy: when the copy cannot copy data it is made fresh at once, with no question', async () => {
    await resetPhone();
    const forks: string[] = [];
    const tree = await renderHome({ apps: [TIMER], canCopyData: false, onFork: async (a, opts) => { forks.push(`${a.id}:${opts.data}`); return { ...a, id: 'copy' }; } });
    try {
      await longPress(tree, 'Timer');
      await chooseRow(tree, COPY.actionMakeCopy);
      h.eq(forks, ['Timer:fresh'], 'fresh, at once');
      h.eq(sheetTitled(tree, COPY.copyQuestionTitle), undefined, 'no sheet was shown');
    } finally { await unmountScreen(tree); }
  });

  await h.test('Make a copy: success says “Copy made” with an Open action that opens the copy; a failure says so once, makes nothing and never falls back to a fresh copy', async () => {
    await resetPhone();
    const opened: string[] = [];
    const forks: string[] = [];
    let fail = false;
    const tree = await renderHome({
      apps: [TIMER],
      canCopyData: true,
      onOpen: (a) => opened.push(a.id),
      onFork: async (a, opts) => {
        forks.push(String(opts.data));
        if (fail) throw new Error('disk full');
        return { ...a, id: 'Timer-copy' };
      },
    });
    try {
      const copy = async (answer: string) => {
        await longPress(tree, 'Timer');
        await chooseRow(tree, COPY.actionMakeCopy);
        await press(sheetRows(tree, COPY.copyQuestionTitle).find((r) => String(r.props.accessibilityLabel).startsWith(answer))!);
      };
      await copy(COPY.copyQuestionData);
      h.eq(toastOf(tree), { message: COPY.copyMadeToast, action: COPY.actionOpen }, '“Copy made”, with Open');
      await pressToastAction(tree);
      h.eq(opened, ['Timer-copy'], 'Open opens the copy');

      fail = true;
      await copy(COPY.copyQuestionData);
      h.eq(toastOf(tree), { message: COPY.copyFailedToast }, 'one failure toast, with no action to retry it silently');
      h.eq(forks, ['copy', 'copy'], 'and only the data copy was tried: never a fresh one in its place');
    } finally { await unmountScreen(tree); }
  });

  // ── customize tile ──────────────────────────────────────────────────────────
  await h.test('Customize tile: ten tints and a searchable glyph grid; each pick is stored as the override, with the other half of the tile kept', async () => {
    await resetPhone();
    const writes: string[] = [];
    let current = TIMER;
    const tree = await renderHome({ apps: [current], onCustomizeTile: (a, t) => { writes.push(`${a.id}:${t.tint}/${t.icon}`); }, onResetTile: (a) => { writes.push(`reset ${a.id}`); } });
    try {
      await longPress(tree, 'Timer');
      await chooseRow(tree, COPY.actionCustomize);
      const sheet = () => sheetTitled(tree, COPY.customizeTitle)!;
      const radios = () => sheet().findAll((n) => hostType(n) === 'Pressable' && n.props.accessibilityRole === 'radio');
      const swatches = radios().filter((r) => ['Slate', 'Stone', 'Ocean', 'Blue', 'Indigo', 'Violet', 'Purple', 'Orchid', 'Berry', 'Rose'].includes(String(r.props.accessibilityLabel)));
      h.eq(swatches.length, 10, 'ten tints');
      const now = tileOf(current);
      h.eq(swatches.filter((s) => s.props.accessibilityState.checked).map((s) => String(s.props.accessibilityLabel).toLowerCase()), [now.tint], 'the current tint is the checked one');
      await press(swatches.find((s) => s.props.accessibilityLabel === 'Violet')!);
      await TestRenderer.act(async () => {
        sheet().find((n) => hostType(n) === 'TextInput').props.onChangeText('music');
      });
      const glyphs = radios().filter((r) => !['Slate', 'Stone', 'Ocean', 'Blue', 'Indigo', 'Violet', 'Purple', 'Orchid', 'Berry', 'Rose'].includes(String(r.props.accessibilityLabel)));
      h.ok(glyphs.length > 0 && glyphs.length < 20 && glyphs.some((g) => g.props.accessibilityLabel === 'music'), `the search narrows the grid to music and its neighbours (${glyphs.length})`);
      await press(glyphs.find((g) => g.props.accessibilityLabel === 'music')!);
      h.eq(writes, [`Timer:violet/${now.icon}`, `Timer:${now.tint}/music`], 'a tint pick keeps the glyph, a glyph pick keeps the tint');
      current = { ...current, tileOverride: { tint: 'violet', icon: 'music' } };
      await updateHome(tree, { apps: [current], onResetTile: (a) => { writes.push(`reset ${a.id}`); } });
      await press(sheet().find((n) => hostType(n) === 'Pressable' && n.props.accessibilityLabel === COPY.customizeReset));
      h.eq(writes.at(-1), 'reset Timer', 'with an override in place, “Use the original tile” drops it');
    } finally { await unmountScreen(tree); }
  });

  // ── search, empty, offline, composer ───────────────────────────────────────
  await h.test('search: a field appears under the title from 13 apps, not at 12, and filters the grid by name', async () => {
    await resetPhone();
    const many = (n: number) => Array.from({ length: n }, (_, i) => app(`App ${String(i + 1).padStart(2, '0')}`, i + 1));
    const twelve = await renderHome({ apps: many(12) });
    h.eq(twelve.root.findAll((n) => hostType(n) === 'TextInput').length, 0, 'no field at twelve');
    await unmountScreen(twelve);
    const tree = await renderHome({ apps: many(13) });
    try {
      const field = () => tree.root.find((n) => hostType(n) === 'TextInput');
      h.eq(field().props.accessibilityLabel, COPY.homeSearchLabel, 'a labelled field at thirteen');
      await TestRenderer.act(async () => field().props.onChangeText('app 07'));
      h.eq(tileLabels(tree), ['App 07'], 'only the matching app');
      await TestRenderer.act(async () => field().props.onChangeText('nothing like it'));
      h.ok(textOf(tree.root).includes(COPY.homeSearchEmpty), 'a quiet line when nothing matches');
    } finally { await unmountScreen(tree); }
  });

  await h.test('empty Home: the still ember, “Make your first app” and three idea chips, each opening the describe sheet with its words', async () => {
    await resetPhone();
    const ideas: (string | undefined)[] = [];
    const tree = await renderHome({ apps: [], onCreate: (idea) => { ideas.push(idea); } });
    try {
      const text = textOf(tree.root);
      h.ok(text.includes(COPY.homeEmptyTitle), 'the headline');
      const chips = tree.root.findAll((n) => hostType(n) === 'Pressable' && n.props.accessibilityRole === 'button' && [COPY.homeIdeaTimer, COPY.homeIdeaTracker, COPY.homeIdeaDice].includes(n.props.accessibilityLabel));
      h.eq(chips.length, 3, 'three idea chips');
      await press(chips[1]);
      h.eq(ideas, [COPY.homeIdeaTracker], 'a chip opens the describe sheet with its words');
      h.eq(tiles(tree).length, 0, 'and there are no tiles');
    } finally { await unmountScreen(tree); }
  });

  await h.test('offline notice: shown under the title while offline, gone as soon as connectivity returns, with the apps untouched', async () => {
    await resetPhone();
    const tree = await renderHome({ apps: [TIMER], offline: true });
    try {
      const shown = () => tree.root.findAll((n) => hostType(n) === 'View' && n.props.accessibilityLabel === COPY.homeOfflineNotice).length;
      h.eq(shown(), 1, 'the notice');
      await updateHome(tree, { apps: [TIMER], offline: false });
      h.eq(shown(), 0, 'removed without a relaunch');
      await updateHome(tree, { apps: [TIMER], offline: true });
      h.eq(shown(), 1, 'and back again');
      h.eq(tileLabels(tree), ['Timer'], 'the grid is the same throughout');
    } finally { await unmountScreen(tree); }
  });

  await h.test('composer bar: “Describe an app…” until a description is in progress, then the words; either way it opens the describe sheet', async () => {
    await resetPhone();
    let opened = 0;
    const tree = await renderHome({ apps: [TIMER], onCreate: () => { opened += 1; } });
    try {
      const bar = () => tree.root.find((n) => hostType(n) === 'Pressable' && n.props.accessibilityHint === COPY.homeComposerHint);
      h.eq(bar().props.accessibilityLabel, COPY.homeComposerPlaceholder, 'the placeholder');
      await updateHome(tree, { apps: [TIMER], draft: 'A tea timer that buzzes', onCreate: () => { opened += 1; } });
      h.ok(String(bar().props.accessibilityLabel).endsWith('A tea timer that buzzes'), 'the draft, in the label');
      h.ok(textOf(bar()).includes('A tea timer that buzzes') && !textOf(bar()).includes(COPY.homeComposerPlaceholder), 'and on the bar');
      await press(bar());
      h.eq(opened, 1, 'a tap opens the describe sheet');
    } finally { await unmountScreen(tree); }
  });

  // ── skeleton ────────────────────────────────────────────────────────────────
  await h.test('skeleton: the real title and composer, and one cell per known app in the very geometry the grid will have', async () => {
    for (const scale of [1, 1.35, 2]) {
      await resetPhone();
      windowMetrics.fontScale = scale;
      const skeleton = await renderScreen(<HomeSkeleton count={5} />);
      await settle();
      const real = await renderHome({ apps: [1, 2, 3, 4, 5].map((i) => app(`App ${i}`, i)) });
      try {
        const bar = skeleton.root.find((n) => hostType(n) === 'Animated.View' && n.props.accessibilityRole === 'progressbar');
        h.eq(bar.props.accessibilityState, { busy: true }, 'one busy element for a screen reader');
        const skeletonCells = bar.children.map((c) => c as TestRenderer.ReactTestInstance);
        h.eq(skeletonCells.length, 5, `one cell per known app at ${scale * 100}%`);
        const layout = gridLayout(390, scale);
        const widths = skeletonCells.map((c) => flat(c).width);
        const heights = skeletonCells.map((c) => flat(c).minHeight);
        const realCell = frameOf(tile(real, 'App 1'));
        h.eq([widths[0], heights[0]], [flat(realCell).width, flat(realCell).minHeight], 'each cell is the real cell’s width and height');
        h.eq(new Set(widths).size + new Set(heights).size, 2, 'and every cell the same');
        h.ok(textOf(skeleton.root).includes(COPY.homeTitle), 'the real title');
        h.ok(skeleton.root.findAll((n) => hostType(n) === 'Pressable' && n.props.accessibilityLabel === COPY.homeComposerPlaceholder).length === 1, 'and the composer');
        const blockSide = skeleton.root.findAll((n) => hostType(n) === 'View' && flat(n).borderRadius === SHAPE.tileCorner * layout.tile)[0];
        h.eq([flat(blockSide).width, flat(blockSide).height], [layout.tile, layout.tile], 'with a tile-sized block, corner 22.5%');
      } finally { await unmountScreen(skeleton); await unmountScreen(real); windowMetrics.fontScale = 1; }
    }
  });

  await h.test('skeleton: the plate sits where the real tile’s does — the same inset in a list row, centred in the same width in a grid cell', async () => {
    for (const scale of [1, 1.35, 2]) {
      await resetPhone();
      windowMetrics.fontScale = scale;
      const layout = gridLayout(390, scale);
      const skeleton = await renderScreen(<HomeSkeleton count={2} />);
      await settle();
      const real = await renderHome({ apps: [app('App 1', 1), app('App 2', 2)] });
      try {
        type Node = TestRenderer.ReactTestInstance;
        const plateIn = (root: Node) => root.find((n) => hostType(n) === 'View' && flat(n).width === layout.tile && flat(n).height === layout.tile);
        /** Where the plate's left edge falls in its cell, following the styles from the cell down. */
        const plateX = (plateNode: Node, cell: Node): number => {
          const chain: Node[] = [];
          for (let n: Node | null = plateNode.parent; n; n = n.parent) {
            if (hostType(n)) chain.unshift(n);
            if (n === cell) break;
          }
          let left = 0;
          let room = typeof flat(cell).width === 'number' ? (flat(cell).width as number) : 390 - 2 * layout.gutter;
          for (const n of chain) {
            const style = flat(n) ?? {};
            const pad = Number(style.paddingHorizontal ?? 0);
            left += pad;
            room -= 2 * pad;
            if (style.alignItems === 'center' && style.flexDirection !== 'row') return left + (room - layout.tile) / 2;
          }
          return left;
        };
        const bar = skeleton.root.find((n) => hostType(n) === 'Animated.View' && n.props.accessibilityRole === 'progressbar');
        const skeletonCell = bar.children[0] as Node;
        const realCell = frameOf(tile(real, 'App 1'));
        h.eq(plateX(plateIn(skeletonCell), skeletonCell), plateX(plateIn(tile(real, 'App 1')), realCell), `${scale * 100}% text: the plate's left edge in the cell`);
        h.eq(layout.kind === 'list' ? plateX(plateIn(skeletonCell), skeletonCell) > 0 : true, true, 'and a list row is inset, not flush with the gutter');
      } finally { await unmountScreen(skeleton); await unmountScreen(real); windowMetrics.fontScale = 1; }
    }
  });

  await h.test('skeleton: the Settings button and the composer it draws are placeholders — they cannot be pressed and screen readers skip them', async () => {
    await resetPhone();
    const skeleton = await renderScreen(<HomeSkeleton count={2} />);
    await settle();
    try {
      for (const label of [COPY.settingsTitle, COPY.homeComposerPlaceholder]) {
        const control = skeleton.root.find((n) => hostType(n) === 'Pressable' && n.props.accessibilityLabel === label);
        await h.throws(() => press(control), 'disabled', `“${label}” cannot be pressed`);
        let hidden = false;
        for (let n: TestRenderer.ReactTestInstance | null = control; n; n = n.parent) hidden = hidden || n.props.accessibilityElementsHidden === true;
        h.ok(hidden, `“${label}” is hidden from screen readers`);
      }
    } finally { await unmountScreen(skeleton); }
    let opened = 0;
    const real = await renderHome({ apps: [TIMER], onSettings: () => { opened += 1; } });
    try {
      await press(real.root.find((n) => hostType(n) === 'Pressable' && n.props.accessibilityLabel === COPY.settingsTitle));
      h.eq(opened, 1, 'the real Home’s Settings button presses');
    } finally { await unmountScreen(real); }
  });

  await h.test('skeleton: nothing for an empty grid — it is promised content', async () => {
    await resetPhone();
    const skeleton = await renderScreen(<HomeSkeleton count={0} />);
    try {
      h.eq(skeleton.root.findAll((n) => n.props.accessibilityRole === 'progressbar').length, 0, 'no skeleton, only the title and composer');
    } finally { await unmountScreen(skeleton); }
  });

  // ── the tile's plate ────────────────────────────────────────────────────────
  await h.test('tile plate: the tint’s light value in both schemes, a white glyph at half the size, a 1.5 pt inner rim in dark and a 1 pt border with Increase Contrast', async () => {
    await resetPhone();
    const drawn = async () => {
      const tree = await plate(<TilePlate size="grid" state="ready" tint="stone" glyph="coffee" />);
      const all = paths(tree.root);
      const out = { fills: all.map((p) => p.props.fill), strokes: all.map((p) => p.props.stroke).filter(Boolean), widths: all.map((p) => p.props.strokeWidth), glyph: all.find((p) => p.props.d === ICON_PATHS.coffee)?.props, body: all[0].props };
      const glyphSide = tree.root.find((n) => hostType(n) === 'Svg' && n.props.width === 32).props.width;
      await unmountScreen(tree);
      return { ...out, glyphSide };
    };
    const light = await drawn();
    h.eq(light.body.fill, TINTS.stone.light, 'the plate is the light value');
    h.eq(light.body.d, squirclePath(64), 'a superellipse, one path');
    h.eq([light.glyph?.stroke, light.glyphSide], [ON_PLATE, 32], 'the glyph in white at half the side');
    h.eq(light.strokes.length, 1, 'no rim and no outline in light');

    await TestRenderer.act(async () => setColorScheme('dark'));
    const dark = await drawn();
    h.eq(dark.body.fill, TINTS.stone.light, 'dark mode keeps the light value');
    h.ok(dark.strokes.includes(mixHex(TINTS.stone.dark, TINTS.stone.light, TILE_RIM.mix)), 'with an inner rim between the two values');
    h.ok(dark.widths.includes(TILE_RIM.width), 'of 1.5');

    accessibilitySettings.increaseContrast = true;
    const contrast = await plate(<TilePlate size="grid" state="ready" tint="stone" glyph="coffee" />);
    try {
      h.ok(paths(contrast.root).some((p) => p.props.stroke === COLORS.dark.border && p.props.strokeWidth === 1), 'Increase Contrast adds a 1 pt border outline');
    } finally { await unmountScreen(contrast); await resetPhone(); }
  });

  await h.test('tile plate: being made is an ember-soft plate with the ember and no glyph; a failure is a fill plate with the ember out and a badge; a change shows the ring on the app’s own tile', async () => {
    await resetPhone();
    const draw = async (state: React.ComponentProps<typeof TilePlate>['state']) => {
      const tree = await plate(<TilePlate size="grid" state={state} tint="rose" glyph="coffee" />);
      const result = {
        fill: paths(tree.root)[0].props.fill,
        glyph: paths(tree.root).some((p) => p.props.d === ICON_PATHS.coffee),
        badge: paths(tree.root).some((p) => p.props.d === ICON_PATHS['circle-alert']),
        ring: paths(tree.root).some((p) => p.props.stroke === COLORS.light.ember && p.props.strokeWidth === 2),
        outline: paths(tree.root).some((p) => p.props.stroke === COLORS.light['text-2']),
      };
      await unmountScreen(tree);
      return result;
    };
    h.eq(await draw('making'), { fill: COLORS.light['ember-soft'], glyph: false, badge: false, ring: false, outline: false }, 'making');
    h.eq(await draw('queued'), { fill: COLORS.light['ember-soft'], glyph: false, badge: false, ring: false, outline: false }, 'waiting looks the same, still');
    h.eq(await draw('failed'), { fill: COLORS.light.fill, glyph: false, badge: true, ring: false, outline: true }, 'failed: fill plate, ember out, badge');
    h.eq(await draw('stopped'), { fill: COLORS.light.fill, glyph: false, badge: false, ring: false, outline: true }, 'stopped: the same without the badge');
    h.eq(await draw('changing'), { fill: TINTS.rose.light, glyph: true, badge: false, ring: true, outline: false }, 'changing: the app’s tile with a ring');
    h.eq(await draw('change-failed'), { fill: TINTS.rose.light, glyph: true, badge: true, ring: false, outline: false }, 'change failed: the app’s tile with the badge');
  });

  await h.test('Home follows the phone’s appearance: its canvas and its tile names change with the scheme, the tile plates do not', async () => {
    await resetPhone();
    const root = (tree: Tree) => tree.root.findAll((n) => hostType(n) === 'View' && flat(n).flex === 1 && typeof flat(n).backgroundColor === 'string')[0];
    const nameColor = (tree: Tree) => flat(tile(tree, 'Timer').findAll((n) => hostType(n) === 'Text' && textOf(n) === 'Timer')[0]).color;
    const plateFill = (tree: Tree) => tile(tree, 'Timer').findAll((n) => hostType(n) === 'Path')[0].props.fill;
    const light = await renderHome({ apps: [TIMER] });
    const seenLight = [flat(root(light)).backgroundColor, nameColor(light), plateFill(light)];
    await unmountScreen(light);
    await TestRenderer.act(async () => setColorScheme('dark'));
    const dark = await renderHome({ apps: [TIMER] });
    try {
      h.eq(seenLight.slice(0, 2), [COLORS.light.bg, COLORS.light.text], 'light');
      h.eq([flat(root(dark)).backgroundColor, nameColor(dark)], [COLORS.dark.bg, COLORS.dark.text], 'dark');
      h.eq(plateFill(dark), seenLight[2], 'the plate is the tint’s light value in both');
    } finally { await unmountScreen(dark); await resetPhone(); }
  });

  // ── the done step's tile (until the Ready screen moves) ─────────────────────
  await h.test('done tile: filled and glowing in the app’s own colour', async () => {
    await resetPhone();
    const manifest = { capabilities: [], tileColor: '#2f7d5b' };
    const expected = tileColor('Timer', manifest);
    const done = await renderScreen(<AppTile name="Timer" manifest={manifest} size="done" />);
    try {
      const filled = done.root.findAll((n) => hostType(n) === 'View' && flat(n).backgroundColor === expected);
      h.eq(filled.length, 1, 'the tile is filled with the app’s colour');
      const glow = flat(filled[0]).boxShadow as { color: string }[] | undefined;
      h.ok(glow?.[0]?.color.startsWith(expected) === true, `its glow is the same colour (got ${JSON.stringify(glow)})`);
    } finally { await unmountScreen(done); }
  });
}
