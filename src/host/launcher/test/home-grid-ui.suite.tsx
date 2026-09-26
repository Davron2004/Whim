/** The rendered home grid: what a ghost tile does when tapped and long-pressed, the rebuild pill on
 *  an installed tile, how an example is labelled, and how a tile's colour and status are painted. */
import React from 'react';
import TestRenderer from 'react-test-renderer';
import { Harness } from './harness';
import { COPY, ghostStateCaption } from '../copy';
import HomeScreen from '../HomeScreen';
import AppTile, { APP_TILE_SIZE } from '../app-tile';
import { homeGridCellWidth } from '../home-grid';
import { monogram, tileColor } from '../tiles';
import { PendingBuildStore, type PendingBuildRecord } from '../pending-builds';
import { ghostTileColorFor } from '../prompt-flow';
import type { InstalledApp } from '../app-index';
import { createMmkvBackend } from '../../version-store/fs/mmkv-backend';
import { STATUS_COLORS } from '../../../sdk/theme';
import { resetNativeStorage } from './native-storage';
import { StyleSheet } from './native-host';
import { button, press, renderScreen, textOf, unmountScreen } from './react-screen';

type Tree = TestRenderer.ReactTestRenderer;
type Style = Record<string, unknown>;
const flat = (node: TestRenderer.ReactTestInstance): Style => StyleSheet.flatten(node.props.style) as Style;

const APP: InstalledApp = { id: 'timer', name: 'Timer', createdAt: 1, lineageId: 'main', record: { appId: 'timer', name: 'Timer', manifest: { capabilities: [] } } };
const EXAMPLE: InstalledApp = { id: 'tip-splitter', name: 'Tip Splitter', example: true, createdAt: 1, lineageId: 'main', record: { appId: 'tip-splitter', name: 'Tip Splitter', manifest: { capabilities: [], tileColor: '#15803d' } } };

/** The tile's art: the one square filled with the app's own colour. */
function art(root: TestRenderer.ReactTestInstance, app: Pick<InstalledApp, 'name' | 'record'>): TestRenderer.ReactTestInstance {
  const fill = tileColor(app.name, app.record.manifest);
  const squares = root.findAll((n) => n.type === 'View' && flat(n).backgroundColor === fill);
  if (squares.length !== 1) throw new Error(`expected one tile filled ${fill} for "${app.name}", got ${squares.length}`);
  return squares[0];
}

function isInside(node: TestRenderer.ReactTestInstance, ancestor: TestRenderer.ReactTestInstance): boolean {
  for (let up = node.parent; up; up = up.parent) if (up === ancestor) return true;
  return false;
}

const lines = (root: TestRenderer.ReactTestInstance) => root.findAll((n) => n.type === 'Text');
/** What is written on the tile's art, and the lines written around it, in reading order. */
const onArt = (square: TestRenderer.ReactTestInstance) => lines(square).map(textOf);
const offArt = (root: TestRenderer.ReactTestInstance, square: TestRenderer.ReactTestInstance) => lines(root).filter((n) => !isInside(n, square));

/** Pending records as the store writes them: a building ghost, a failed one, and a failed rebuild of APP. */
function pendingRecords(): PendingBuildRecord[] {
  resetNativeStorage();
  const store = new PendingBuildStore(createMmkvBackend('whim.launcher'));
  store.create({ id: 'ghost-building', prompt: 'A tea timer that buzzes three times', workingTitle: 'A tea timer' });
  store.create({ id: 'ghost-failed', prompt: 'A dice roller', workingTitle: 'A dice roller' });
  store.setFailed('ghost-failed', { reason: 'It did not build.', diagnostics: '' });
  store.create({ id: 'rebuild', prompt: 'Add laps', workingTitle: 'Add laps', editingAppId: APP.id });
  return store.list();
}

interface Calls { open: unknown[]; openPending: unknown[]; cancel: unknown[]; dismiss: unknown[] }

async function withHome(pending: PendingBuildRecord[], body: (tree: Tree, calls: Calls) => Promise<void>): Promise<void> {
  const calls: Calls = { open: [], openPending: [], cancel: [], dismiss: [] };
  const noop = () => {};
  const tree = await renderScreen(
    <HomeScreen
      apps={[APP]}
      pending={pending}
      onOpen={(a) => { calls.open.push(a); }}
      onFork={noop} onDelete={noop} onHistory={noop} onPromptAgain={noop} onCreate={noop} onSettings={noop}
      onOpenPending={(r) => { calls.openPending.push(r); }}
      onCancelPending={(r) => { calls.cancel.push(r); }}
      onDismissPending={(r) => { calls.dismiss.push(r); }}
    />,
  );
  try { await body(tree, calls); } finally { await unmountScreen(tree); }
}

/** The grid cell (tap + long-press target) whose tile is labelled `name`. */
function cell(tree: Tree, name: string): TestRenderer.ReactTestInstance {
  const cells = tree.root.findAll((n) => n.type === 'TouchableOpacity' && typeof n.props.onLongPress === 'function' && textOf(n).includes(name));
  if (cells.length !== 1) throw new Error(`expected one grid cell for "${name}", got ${cells.length}`);
  return cells[0];
}

export async function runHomeGridUiTests(h: Harness): Promise<void> {
  await h.test('home grid: tapping a ghost opens its attempt, never an app, and the tile shows its working title', async () => {
    const records = pendingRecords();
    await withHome(records, async (tree, calls) => {
      h.ok(!textOf(tree.root).includes('three times'), 'the ghost is labelled by its working title, not the whole prompt');
      await TestRenderer.act(async () => cell(tree, 'A tea timer').props.onPress());
      h.eq(calls.openPending.map((r) => (r as PendingBuildRecord).id), ['ghost-building'], 'the tap opens that attempt');
      h.eq(calls.open.length, 0, 'and never launches an app');
    });
  });

  await h.test('home grid: long-pressing a building ghost offers Cancel only; a failed ghost offers Dismiss only', async () => {
    const records = pendingRecords();
    await withHome(records, async (tree, calls) => {
      await TestRenderer.act(async () => cell(tree, 'A tea timer').props.onLongPress());
      h.ok(!textOf(tree.root).includes(COPY.actionDismissBuild), 'a building ghost offers no Dismiss');
      await press(button(tree, COPY.actionCancelBuild));
      h.eq(calls.cancel.map((r) => (r as PendingBuildRecord).id), ['ghost-building'], 'Cancel cancels that attempt');
      await TestRenderer.act(async () => cell(tree, 'A dice roller').props.onLongPress());
      h.ok(!textOf(tree.root).includes(COPY.actionCancelBuild), 'a failed ghost offers no Cancel');
      await press(button(tree, COPY.actionDismissBuild));
      h.eq(calls.dismiss.map((r) => (r as PendingBuildRecord).id), ['ghost-failed'], 'Dismiss dismisses that attempt');
      h.eq(calls.cancel.length, 1, 'and never cancels');
    });
  });

  await h.test('home grid: a failed rebuild’s pill on the installed tile opens the attempt; a building one is a passive badge', async () => {
    const records = pendingRecords();
    const rebuild = records.find((r) => r.id === 'rebuild')!;
    await withHome(records, async (tree) => {
      const pill = tree.root.findAll((n) => n.type === 'TouchableOpacity' && textOf(n) === ghostStateCaption('building'));
      h.eq(pill.length, 0, 'a building rebuild’s pill is not a button');
      h.ok(textOf(cell(tree, APP.name)).includes(ghostStateCaption('building')), 'but it is shown on the installed tile');
    });
    await withHome(records.map((r) => (r.id === 'rebuild' ? { ...r, state: 'failed' as const } : r)), async (tree, calls) => {
      await press(button(tree, ghostStateCaption('failed')));
      h.eq(calls.openPending.map((r) => (r as PendingBuildRecord).id), [rebuild.id], 'the failed pill opens the rebuild attempt');
      h.eq(calls.open.length, 0, 'not the app');
    });
  });

  await h.test('home grid: an example tile says “Example” under its name, in a ghost caption’s style, with nothing on its art; a generated app’s tile has neither', async () => {
    const noop = () => {};
    const home = await renderScreen(<HomeScreen apps={[EXAMPLE, APP]} onOpen={noop} onFork={noop} onDelete={noop} onHistory={noop} onPromptAgain={noop} onCreate={noop} onSettings={noop} />);
    const ghost = await renderScreen(<AppTile name="A tea timer" ghost="building" />);
    try {
      const example = cell(home, EXAMPLE.name);
      const exampleArt = art(example, EXAMPLE);
      const mono = monogram(EXAMPLE.name);
      h.eq(onArt(exampleArt), [mono, mono], 'the example’s art carries only its monogram: no pill over it');
      const around = offArt(example, exampleArt);
      h.eq(around.map(textOf), [EXAMPLE.name, COPY.exampleBadge], 'it says “Example” on the line under its name');
      const ghostCaption = lines(ghost.root).find((n) => textOf(n) === ghostStateCaption('building'));
      h.eq(around[1] && flat(around[1]), ghostCaption && flat(ghostCaption), 'in the muted caption style a ghost tile uses for its state');

      const generatedArt = art(cell(home, APP.name), APP);
      h.eq(onArt(generatedArt), [monogram(APP.name), monogram(APP.name)], 'a generated app’s art carries only its monogram');
      h.eq(offArt(cell(home, APP.name), generatedArt).map(textOf), [APP.name], 'and its name alone: no “Example” caption');
    } finally {
      await unmountScreen(home);
      await unmountScreen(ghost);
    }
  });

  await h.test('tile: the “Example” caption sits in the column below the art at every grid width, never on it', async () => {
    for (const frame of [320, 390, 430, 900]) {
      const width = homeGridCellWidth(frame, APP_TILE_SIZE);
      const tree = await renderScreen(<AppTile name={EXAMPLE.name} manifest={EXAMPLE.record.manifest} example width={width} />);
      try {
        const square = art(tree.root, EXAMPLE);
        const caption = offArt(tree.root, square).filter((n) => textOf(n) === COPY.exampleBadge);
        h.eq(caption.length, 1, `on a ${frame}pt screen (${width}pt tiles) the caption is drawn outside the art`);
        h.ok(caption.every((n) => flat(n).position !== 'absolute'), `on a ${frame}pt screen it is laid out below the art, not floated onto it`);
      } finally {
        await unmountScreen(tree);
      }
    }
  });

  await h.test('tile: the done tile is filled and glows in the app’s own colour; a grid tile has no glow', async () => {
    const manifest = { capabilities: [], tileColor: '#2f7d5b' };
    const expected = tileColor('Timer', manifest);
    const done = await renderScreen(<AppTile name="Timer" manifest={manifest} size="done" />);
    const plain = await renderScreen(<AppTile name="Timer" manifest={manifest} />);
    try {
      const tileOf = (tree: Tree) => tree.root.findAll((n) => n.type === 'View' && flat(n).backgroundColor === expected);
      h.eq(tileOf(done).length, 1, 'the done tile is filled with the app’s colour');
      const glow = flat(tileOf(done)[0]).boxShadow as { color: string }[] | undefined;
      h.ok(glow?.[0]?.color.startsWith(expected) === true, `its glow is the same colour (got ${JSON.stringify(glow)})`);
      h.eq(tileOf(plain).length, 1, 'the grid tile is filled with the same colour');
      h.ok(flat(tileOf(plain)[0]).boxShadow == null, 'but carries no glow');
    } finally {
      await unmountScreen(done);
      await unmountScreen(plain);
    }
  });

  await h.test('tile: a failed or interrupted ghost is outlined in the broken hue and keeps its own fill; a building ghost is not', async () => {
    for (const ghost of ['failed', 'interrupted', 'building'] as const) {
      const fill = ghostTileColorFor('ghost-1');
      const tree = await renderScreen(<AppTile name="A dice roller" manifest={{ tileColor: fill }} ghost={ghost} />);
      try {
        const tile = tree.root.findAll((n) => n.type === 'View' && flat(n).backgroundColor === fill);
        h.eq(tile.length, 1, `the ${ghost} ghost keeps its own fill`);
        const alert = ghost !== 'building';
        h.eq(flat(tile[0]).borderColor === STATUS_COLORS.broken, alert, `the ${ghost} ghost ${alert ? 'is' : 'is not'} outlined in the broken hue`);
        h.ok(tree.root.findAll((n) => n.type === 'View' && flat(n).backgroundColor === STATUS_COLORS.broken).length === 0, 'the broken hue is never a fill');
      } finally {
        await unmountScreen(tree);
      }
    }
  });
}
