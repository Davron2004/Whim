/** The rendered Home: its layout at every text size, what each tile says and its menu offers, Delete
 *  and Discard with Undo, Make a copy and its question, Customize tile, search, the empty state, the
 *  offline notice, the skeleton, and the tile's plate in every state. The order and the rows
 *  themselves are `grid-composition.suite.ts`; the stores behind Delete are `launcher-interactions`. */
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import TestRenderer from 'react-test-renderer';
import { Harness } from './harness';
import { COPY, makingStallLine } from '../copy';
import { PendingBuildStore, type PendingBuildRecord } from '../pending-builds';
import { createMemoryStore, MapKVBackend } from '../../version-store';
import { AppIndex, type InstalledApp } from '../app-index';
import { StoreAccess } from '../store-access';
import { deliverResult } from '../build-lifecycle';
import { listVersions } from '../history-logic';
import type { WireAppRecord } from '@whim/contract';
import { appLinkFor } from '../app-link';
import { tileOf } from '../tile-identity';
import { gridLayout, TILE_SIDE } from '../../ui/AppTile-geometry';
import { TilePlate } from '../../ui/AppTile';
import { MENU } from '../../ui/ContextMenu';
import { Ember, RESTING_ACTIVITY } from '../../ui/Ember';
import { resolveTokens } from '../../ui/tokens-pure';
import { HomeSkeleton } from '../HomeSkeleton';
import { COLORS, LAYOUT, ON_PLATE, SHAPE, TILE_RIM, TINTS, TYPE_SCALE } from '../../../design/tokens';
import { ICON_PATHS } from '../../../design/icons/paths';
import { EMBER_PATH } from '../../../design/icons/ember';
import { squirclePath } from '../../../design/icons/squircle';
import { mixHex } from '../../../design/tints';
import { Share, StyleSheet, accessibilitySettings, setColorScheme, windowMetrics } from './native-host';
import { animations, isStep } from './native-reanimated';
import { captureTimeouts, press, renderScreen, screenReaderElement, textOf, unmountScreen, hostType } from './react-screen';
import {
  CELL_RECT, STATUS_BAR_OFFSET, chooseRow, longPress, menuCard, menuLabels, menuRows, pressToastAction, renderHome, settle, sheetRows, sheetTitled,
  tile, tileLabels, tiles, toastOf, updateHome, type Tree,
} from './home-rig';

type Style = Record<string, unknown>;
const flat = (node: TestRenderer.ReactTestInstance): Style => StyleSheet.flatten(node.props.style) as Style;

const DAY = 24 * 60 * 60 * 1000;

/** An ember's body: the faded layer holding the flame's gradient (centred low). */
const isEmberBody = (v: TestRenderer.ReactTestInstance) =>
  hostType(v) === 'Animated.View' && flat(v).opacity !== undefined && v.findAll((n) => hostType(n) === 'RadialGradient' && n.props.cy === '74%').length === 1;
/** A changing tile's ring: the absolutely placed layer around the plate holding the ember-stroked outline. */
const isRing = (v: TestRenderer.ReactTestInstance) =>
  hostType(v) === 'Animated.View' && flat(v).position === 'absolute' && v.findAll((n) => hostType(n) === 'Path' && n.props.stroke === COLORS.light.ember).length === 1;

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

  await h.test('home layout: the first row starts below the top fade, on Home and on its skeleton, at every text size', async () => {
    const host = (node: TestRenderer.ReactTestInstance) => {
      let up = node.parent;
      while (up && hostType(up) !== 'View') up = up.parent;
      return up!;
    };
    /** The 16 pt fade over the top of the list, as drawn: the absolute, touch-through View at top 0. */
    const topFade = (tree: Tree) => tree.root.find((n) => hostType(n) === 'View' && n.props.pointerEvents === 'none' && flat(n).position === 'absolute' && flat(n).top === 0 && typeof flat(n).height === 'number');
    for (const scale of [1, 1.35, 2]) {
      await resetPhone();
      windowMetrics.fontScale = scale;
      const real = await renderHome({ apps: [TIMER, app('Dice', 2)] });
      const skeleton = await renderScreen(<HomeSkeleton count={2} />);
      await settle();
      try {
        const fade = flat(topFade(real)).height as number;
        const inset = flat(host(frameOf(tile(real, 'Timer')))).paddingTop as number;
        h.ok(inset >= fade, `at ${scale * 100}% the grid is inset ${inset} pt, the fade is ${fade} pt: nothing at rest sits under it`);
        const bar = skeleton.root.find((n) => hostType(n) === 'Animated.View' && n.props.accessibilityRole === 'progressbar');
        h.eq(flat(bar).paddingTop, inset, 'the skeleton leaves the same room, so nothing moves when the tiles arrive');
      } finally { await unmountScreen(real); await unmountScreen(skeleton); windowMetrics.fontScale = 1; }
    }
  });

  await h.test('home layout: plates line up — a grid cell holds its plate at the top with or without a state line; a list row centres it in a row as tall as the one that states its state', async () => {
    const seen: Record<string, { plain: Style; stated: Style; plainCell: Style; statedCell: Style }> = {};
    for (const [scale, key] of [[1, 'normal'], [1.35, '135%'], [2, '200%']] as const) {
      await resetPhone();
      windowMetrics.fontScale = scale;
      const tree = await renderHome({ apps: [TIMER, app('Dice', 2, { example: true })] });
      try {
        seen[key] = {
          plain: flat(tile(tree, 'Timer')),
          stated: flat(tile(tree, 'Dice, example')),
          plainCell: flat(frameOf(tile(tree, 'Timer'))),
          statedCell: flat(frameOf(tile(tree, 'Dice, example'))),
        };
      } finally { await unmountScreen(tree); windowMetrics.fontScale = 1; }
    }
    h.eq([seen.normal.plain.justifyContent, seen.normal.stated.justifyContent], ['flex-start', 'flex-start'], 'at 100% text a tile without a state line starts at the top of its cell, as its neighbour that has one does');
    h.eq([seen['135%'].plain.justifyContent, seen['135%'].stated.justifyContent], ['flex-start', 'flex-start'], 'and at 135%');
    h.eq([seen['200%'].plain.justifyContent, seen['200%'].stated.justifyContent], ['center', 'center'], 'a list row centres its plate on the row, with or without a state line');
    const content = (TYPE_SCALE.body.lineHeight + TYPE_SCALE.caption.lineHeight) * 2;
    h.ok((seen['200%'].statedCell.minHeight as number) >= content, 'a row that states its state fits its name and that line at 200% text');
    h.eq(seen['200%'].plainCell.minHeight, seen['200%'].statedCell.minHeight, 'and the row without one is as tall, so the list keeps its rhythm');
  });

  // The name block of a grid row (#218): the names of a row take the lines of its longest name, as
  // the platform lays them out (`onTextLayout`, played here as the platform reports it).
  const nameOf = (tree: Tree, name: string) => {
    const label = tile(tree, name).findAll((n) => hostType(n) === 'Text' && textOf(n) === name)[0];
    if (!label) throw new Error(`no name under "${name}"`);
    return label;
  };
  const stateLineOf = (tree: Tree, name: string) => tile(tree, name).findAll((n) => hostType(n) === 'Text' && textOf(n) === COPY.exampleBadge)[0];
  const layOut = (tree: Tree, lines: Record<string, number>) => TestRenderer.act(async () => {
    for (const [name, count] of Object.entries(lines)) {
      nameOf(tree, name).props.onTextLayout({ nativeEvent: { lines: Array.from({ length: count }, (_, i) => ({ text: `${name} ${i}` })) } });
    }
  });
  const nameBlock = (tree: Tree, name: string) => flat(nameOf(tree, name)).minHeight as number;
  const gridShown = (tree: Tree) => {
    const grid = tree.root.findAll((n) => hostType(n) === 'View' && flat(n).flexWrap === 'wrap')[0];
    return flat(grid).opacity !== 0;
  };
  const line = (scale: number) => TYPE_SCALE.caption.lineHeight * scale;
  /** Seeded apps the grid shows in the order given (newest first). */
  const examples = (names: string[]) => names.map((n, i) => app(n, names.length - i, { example: true }));

  await h.test('home layout: a grid row whose names all fit one line has no empty line under them, at every grid text size (#218)', async () => {
    for (const scale of [1, 1.35]) {
      await resetPhone();
      windowMetrics.fontScale = scale;
      const tree = await renderHome({ apps: examples(['Dice', 'Timer', 'Plants']) });
      try {
        await layOut(tree, { Dice: 1, Timer: 1, Plants: 1 });
        for (const name of ['Dice', 'Timer', 'Plants']) {
          h.eq([nameOf(tree, name).props.numberOfLines, nameBlock(tree, name), flat(nameOf(tree, name)).height], [2, line(scale), undefined],
            `${name} at ${scale * 100}%: a one-line name block (minHeight, never height), still cut at two lines`);
          const texts = tile(tree, name).findAll((n) => hostType(n) === 'Text');
          h.ok(texts.indexOf(stateLineOf(tree, name)) === texts.indexOf(nameOf(tree, name)) + 1, `${name}: its state line follows the name`);
        }
      } finally { await unmountScreen(tree); windowMetrics.fontScale = 1; }
    }
  });

  await h.test('home layout: a name that wraps gives every name of its row a two-line block, so the state lines sit level (#218)', async () => {
    await resetPhone();
    const tree = await renderHome({ apps: examples(['Water Counter', 'Dice', 'Timer', 'Plants']) });
    try {
      await layOut(tree, { 'Water Counter': 2, Dice: 1, Timer: 1, Plants: 1 });
      h.eq(['Water Counter', 'Dice', 'Timer', 'Plants'].map((n) => nameBlock(tree, n)), [2, 2, 2, 2].map((n) => n * line(1)), 'all four names of the row take two lines');
      await layOut(tree, { 'Water Counter': 5 });
      h.eq(nameBlock(tree, 'Dice'), 2 * line(1), 'a platform reporting every line of a cut name still gives two, the label’s most');
    } finally { await unmountScreen(tree); }
  });

  await h.test('home layout: each grid row takes its own longest name, a wrap in one row leaves the next alone (#218)', async () => {
    await resetPhone();
    const names = ['Water Counter', 'Dice', 'Timer', 'Plants', 'Tea', 'Coin', 'Mood', 'Notes', 'Pour-Over Timer Deluxe'];
    const tree = await renderHome({ apps: examples(names) });
    try {
      const order = tileLabels(tree).map((l) => l.split(',')[0]);
      const lines = Object.fromEntries(order.map((n) => [n, n.length > 12 ? 2 : 1]));
      await layOut(tree, lines);
      const rows = [order.slice(0, 4), order.slice(4, 8), order.slice(8)];
      for (const row of rows) {
        const want = row.some((n) => lines[n] === 2) ? 2 : 1;
        h.eq(row.map((n) => nameBlock(tree, n)), row.map(() => want * line(1)), `row ${row.join(' · ')}: every name a ${want}-line block`);
      }
      h.eq(rows.map((row) => row.some((n) => lines[n] === 2)), [true, false, true], 'the case under test: a row with no wrapped name between two with one');
    } finally { await unmountScreen(tree); }
  });

  await h.test('home layout: a text size that changes the column count measures the names again and regroups the rows (#218)', async () => {
    await resetPhone();
    // Four columns: Water Counter and Dice share the first row; at 135% three columns put Plants
    // in the second row, alone with Tea, and Water Counter's wrap no longer reaches it.
    const names = ['Water Counter', 'Dice', 'Timer', 'Plants', 'Tea'];
    const clock = captureTimeouts();
    const tree = await renderHome({ apps: examples(names) });
    try {
      const order = tileLabels(tree).map((l) => l.split(',')[0]);
      h.eq(order, names, 'the grid holds them in this order');
      await layOut(tree, { 'Water Counter': 2, Dice: 1, Timer: 1, Plants: 1, Tea: 1 });
      h.eq(nameBlock(tree, 'Plants'), 2 * line(1), 'at 100% Plants shares the wrapped row');
      await TestRenderer.act(async () => { windowMetrics.fontScale = 1.35; });
      await updateHome(tree, { apps: examples(names) });
      h.ok(!gridShown(tree), 'at the new size the grid is not shown before its names are measured again');
      await layOut(tree, { 'Water Counter': 2, Dice: 2, Timer: 1, Plants: 1, Tea: 1 });
      h.ok(gridShown(tree), 'and is once they are');
      h.eq(['Water Counter', 'Dice', 'Timer'].map((n) => nameBlock(tree, n)), [2, 2, 2].map((n) => n * line(1.35)), 'the first row of three takes two lines at 135%');
      h.eq(['Plants', 'Tea'].map((n) => nameBlock(tree, n)), [1, 1].map((n) => n * line(1.35)), 'Plants, now in the second row, takes one');
    } finally { clock.restore(); await unmountScreen(tree); windowMetrics.fontScale = 1; }
  });

  await h.test('home layout: the grid shows once every name has been laid out, and a tile that arrives later does not hide it again (#218)', async () => {
    await resetPhone();
    const clock = captureTimeouts();
    const tree = await renderHome({ apps: examples(['Water Counter', 'Dice']) });
    try {
      h.ok(!gridShown(tree), 'before the names are laid out the grid is not shown');
      await layOut(tree, { 'Water Counter': 2 });
      h.ok(!gridShown(tree), 'nor with one name still to come');
      await layOut(tree, { Dice: 1 });
      h.ok(gridShown(tree), 'with both, it shows');
      await updateHome(tree, { apps: examples(['Water Counter', 'Dice', 'Timer']) });
      h.ok(gridShown(tree), 'a new tile settles its row as it appears, the grid stays');
      h.eq(nameBlock(tree, 'Timer'), 2 * line(1), 'the new tile takes its row’s block from the names already measured');
    } finally { clock.restore(); await unmountScreen(tree); }
  });

  await h.test('home layout: an app whose name is empty draws no name and waits on none; the grid shows once the others are laid out (#218)', async () => {
    await resetPhone();
    const clock = captureTimeouts();
    const tree = await renderHome({ apps: [app('blank', 2, { name: '', example: true }), app('Dice', 1, { example: true })] });
    try {
      h.eq(tiles(tree).length, 2, 'both apps have a tile');
      await layOut(tree, { Dice: 1 });
      h.ok(gridShown(tree), 'with Dice laid out, the grid shows, with no wait');
    } finally { clock.restore(); await unmountScreen(tree); }
  });

  await h.test('home layout: a name the platform never reports on holds the grid back only briefly; within a quarter second it shows anyway (#218)', async () => {
    await resetPhone();
    const clock = captureTimeouts();
    const tree = await renderHome({ apps: examples(['Water Counter', 'Dice']) });
    try {
      await layOut(tree, { Dice: 1 });
      h.ok(!gridShown(tree), 'while Water Counter has not reported, the grid waits');
      await TestRenderer.act(async () => { clock.fireWithin(250); });
      h.ok(gridShown(tree), 'past the wait it shows, Water Counter unreported');
      h.eq(nameBlock(tree, 'Water Counter'), line(1), 'its row keeps the one-line block until it reports');
    } finally { clock.restore(); await unmountScreen(tree); }
  });

  await h.test('home layout: a grid label’s side padding and the list at 200% are untouched by the name block (no measuring in the list)', async () => {
    await resetPhone();
    windowMetrics.fontScale = 2;
    const tree = await renderHome({ apps: examples(['Water Counter', 'Dice']) });
    try {
      h.eq([nameOf(tree, 'Water Counter').props.onTextLayout, flat(nameOf(tree, 'Water Counter')).minHeight], [undefined, undefined], 'a list row’s name is not measured and has no block');
      const list = tree.root.findAll((n) => hostType(n) === 'View' && flat(n).flexDirection === 'column' && flat(n).opacity === 0);
      h.eq(list.length, 0, 'and nothing in the list waits for one');
    } finally { await unmountScreen(tree); windowMetrics.fontScale = 1; }
  });

  await h.test('home layout: a grid label keeps the side padding system.md §3.2 gives it at every text size, large text included', async () => {
    const documented = Number(/(\d{1,2}) pt side padding, then ellipsis/.exec(fs.readFileSync(path.join(process.cwd(), 'docs/design/system.md'), 'utf8'))?.[1]);
    h.ok(Number.isFinite(documented), 'the doc states a side padding for the label');
    for (const scale of [1, 1.35]) {
      await resetPhone();
      windowMetrics.fontScale = scale;
      const tree = await renderHome({ apps: [TIMER] });
      try {
        const column = tile(tree, 'Timer').find((n) => hostType(n) === 'View' && flat(n).alignItems === 'center' && flat(n).paddingHorizontal !== undefined);
        h.eq(flat(column).paddingHorizontal, documented, `at ${scale * 100}% text`);
      } finally { await unmountScreen(tree); windowMetrics.fontScale = 1; }
    }
  });

  await h.test('long-press lift: the shadow is on the plate, with the plate’s corner, and never on the rectangular cell around it', async () => {
    await resetPhone();
    const tree = await renderHome({ apps: [TIMER] });
    try {
      const shadowed = () => tile(tree, 'Timer').findAll((n) => hostType(n) === 'View' && flat(n).boxShadow !== undefined);
      h.eq(shadowed().length, 0, 'no shadow at rest');
      await longPress(tree, 'Timer');
      const cell = frameOf(tile(tree, 'Timer'));
      h.eq(flat(cell).boxShadow, undefined, 'the cell frame carries none while the menu is open');
      const lifted = shadowed();
      h.eq(lifted.length, 1, 'one shadowed shape');
      h.eq(flat(lifted[0]).borderRadius, SHAPE.tileCorner * TILE_SIDE.grid, 'with the plate’s corner');
      h.ok(paths(lifted[0]).some((p) => p.props.d === squirclePath(TILE_SIDE.grid)), 'and it wraps the plate');
    } finally { await unmountScreen(tree); }
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

  await h.test('home grid: an entry made with Make a copy and the continuation a change to an older version lands on both read "Copy", whether or not they share the original’s data', async () => {
    await resetPhone();
    const store = createMemoryStore({ autoCompact: false });
    const index = new AppIndex(new MapKVBackend());
    const access = new StoreAccess({ store, index });
    const water = await access.install({ id: 'Water', name: 'Water', record: { appId: 'Water', name: 'Water', manifest: { capabilities: [] } }, bundleSource: 'V1', prompt: 'p1' });
    await store.snapshot('Water', { 'bundle.js': 'V2' }, 'p2');
    const copy = await access.fork(water);
    const [, v1] = await listVersions(access, water);
    await access.rollback(water, v1.id);
    const wire: WireAppRecord = { name: 'Water', source: 'export default () => null;', bundle: 'var __WHIM_APP_MODULE__ = (() => ({}))();', manifest: {}, schema: {} };
    const continuation = await deliverResult({ access, appId: 'unused', editing: index.get('Water')!, text: 'p3', wire });
    h.ok(continuation.id !== water.id && continuation.id !== copy.id && access.engineAppId(continuation) === access.engineAppId(water),
      'setup: the change landed on a continuation that shares the original’s data');
    h.ok(access.engineAppId(copy) !== access.engineAppId(water), 'setup: the copy has data of its own');
    const tree = await renderHome({ apps: index.list() });
    try {
      h.eq(tileLabels(tree).sort((a, b) => a.localeCompare(b)), ['Water', 'Water, copy', 'Water, copy'], 'the original reads nothing; the copy and the continuation both read "Copy"');
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

  await h.test('home grid: a stream with no progress event for 40 s makes its tile’s light stuck — a making tile’s ember and a changing tile’s ring ease to the stuck level over the stuck time and hold; bytes resume and each burns as before', async () => {
    await resetPhone();
    const stuckDoc = /`I` eases to ([\d.]+) over ([\d.]+) s and holds still/.exec(fs.readFileSync(path.join(process.cwd(), 'docs/design/system.md'), 'utf8'));
    const [level, ms] = [Number(stuckDoc?.[1]), Number(stuckDoc?.[2]) * 1000];
    const pending = attempts([
      { id: 'p-making', prompt: 'A pour over timer', state: 'building' },
      { id: 'p-other', prompt: 'A dice roller game', state: 'building' },
      { id: 'Timer', prompt: 'Add laps', state: 'building', editingAppId: 'Timer' },
    ]);
    const live = { apps: [TIMER], pending, activity: { 'p-making': 0.8, 'p-other': 0.8, Timer: 0.8 } };
    const tree = await renderHome(live);
    const body = (name: string) => tile(tree, name).findByType(Ember).find(isEmberBody);
    const ring = (name: string) => tile(tree, name).find(isRing);
    const burning = { making: flat(body('Pour over timer')).opacity, ring: flat(ring('Timer')).opacity };
    try {
      animations.splice(0);
      await updateHome(tree, { ...live, stalled: new Set(['p-making', 'Timer']) });
      const eases = animations.filter(isStep).filter((a) => a.kind === 'timing' && a.to === level && (a.config as Style | undefined)?.duration === ms);
      h.ok(eases.length >= 2, `the ember and the ring each ease to ${level} over ${ms} ms (${eases.length} eases)`);
      h.eq(animations.some((a) => a.kind === 'repeat'), false, 'nothing loops');
      h.eq([tile(tree, 'Pour over timer').findByType(Ember).props.state, flat(body('Pour over timer')).opacity, flat(ring('Timer')).opacity], ['stuck', level, level], 'they hold there, the ember stuck');
      h.eq(tile(tree, 'Dice roller game').findByType(Ember).props.state, 'working', 'a run that did not stall burns on');
      await updateHome(tree, { ...live, stalled: new Set() });
      h.eq([flat(body('Pour over timer')).opacity, flat(ring('Timer')).opacity], [burning.making, burning.ring], 'bytes again: each burns as it did');
    } finally { await unmountScreen(tree); }
  });

  await h.test('home grid: a stuck tile says so in words, not by its dimmed light alone (#239) — a making or changing tile whose stream stalled reads “No progress”, to the eye and to a screen reader, and “making” again once the stalled flag clears', async () => {
    await resetPhone();
    const pending = attempts([
      { id: 'p-making', prompt: 'A pour over timer', state: 'building' },
      { id: 'p-other', prompt: 'A dice roller game', state: 'building' },
      { id: 'p-queued', prompt: 'A coin flip app', state: 'building' },
      { id: 'Timer', prompt: 'Add laps', state: 'building', editingAppId: 'Timer' },
    ]);
    const live = { apps: [TIMER], pending, queued: new Set(['p-queued']), activity: { 'p-making': 0.8, 'p-other': 0.8, Timer: 0.8 } };
    const tree = await renderHome(live);
    const lineUnder = (name: string) => tile(tree, name).findAll((n) => hostType(n) === 'Text' && textOf(n) !== name).map(textOf);
    const working = ['Pour over timer, making', 'Dice roller game, making', 'Coin flip app, waiting', 'Timer, changing'];
    try {
      h.eq([...tileLabels(tree)].sort((a, b) => a.localeCompare(b)), [...working].sort((a, b) => a.localeCompare(b)), 'setup: every stream runs');
      await updateHome(tree, { ...live, stalled: new Set(['p-making', 'Timer', 'p-queued']) });
      h.eq([...tileLabels(tree)].sort((a, b) => a.localeCompare(b)), ['Coin flip app, waiting', 'Dice roller game, making', 'Pour over timer, no progress', 'Timer, no progress'],
        'the stalled make and change read “no progress”; the run that did not stall still reads “making”, and one in line still “waiting”');
      const stuckLine = lineUnder('Pour over timer');
      h.eq([stuckLine, lineUnder('Timer')], [['No progress'], ['No progress']], 'the line under each stuck tile says it too, in place of “Making…” and “Changing…”');
      h.ok(makingStallLine(40).startsWith(`${stuckLine[0]} `), `in the words the Making page’s stall line starts with (“${makingStallLine(40)}”)`);
      const stuckColor = flat(tile(tree, 'Pour over timer').findAll((n) => hostType(n) === 'Text' && textOf(n) === 'No progress')[0]).color;
      const makingColor = flat(tile(tree, 'Dice roller game').findAll((n) => hostType(n) === 'Text' && textOf(n) === COPY.tileMaking)[0]).color;
      h.ok(stuckColor !== makingColor, 'and the line is no longer the working ember’s colour');
      await updateHome(tree, { ...live, stalled: new Set() });
      h.eq([...tileLabels(tree)].sort((a, b) => a.localeCompare(b)), [...working].sort((a, b) => a.localeCompare(b)), 'bytes again: each reads as before');
      h.eq(lineUnder('Pour over timer'), [COPY.tileMaking], 'and says “Making…” again');
    } finally { await unmountScreen(tree); }
  });

  await h.test('home grid: a change waiting in line is not stuck (#239) — the queue is the reason it is still, so it reads “changing”, as the Making page shows the queue line before the stall line', async () => {
    await resetPhone();
    const pending = attempts([{ id: 'Timer', prompt: 'Add laps', state: 'building', editingAppId: 'Timer' }]);
    const live = { apps: [TIMER], pending, activity: { Timer: 0.8 } };
    const tree = await renderHome({ ...live, queued: new Set(['Timer']), stalled: new Set(['Timer']) });
    try {
      h.eq(tileLabels(tree), ['Timer, changing'], 'in line and silent for 40 s: still “changing”, not “no progress”');
      h.eq(tile(tree, 'Timer').findAll((n) => hostType(n) === 'Text' && textOf(n) === COPY.tileChanging).length, 1, 'and its line says “Changing…”');
      h.eq(tile(tree, 'Timer').findByType(TilePlate).props.stuck, false, 'and its light is not stuck: the ring keeps burning');
      await updateHome(tree, { ...live, stalled: new Set(['Timer']) });
      h.eq(tileLabels(tree), ['Timer, no progress'], 'out of the queue and still silent: now it is stuck');
      h.eq(tile(tree, 'Timer').findByType(TilePlate).props.stuck, true, 'and so is its light');
    } finally { await unmountScreen(tree); }
  });

  await h.test('home grid: a state line is never cut (#240) — it takes no line cap, so it wraps as far as its column needs; the name keeps its two-line cut', async () => {
    await resetPhone();
    const pending = attempts([
      { id: 'p-making', prompt: 'A pour over timer', state: 'building' },
      { id: 'p-failed', prompt: 'A dice roller game', state: 'failed' },
      { id: 'p-update', prompt: 'The garden planner', state: 'failed', remedy: true },
      { id: 'Timer', prompt: 'Add laps', state: 'failed', editingAppId: 'Timer' },
    ]);
    const tree = await renderHome({ apps: [TIMER], pending });
    try {
      const cells: [string, string][] = [
        ['Pour over timer', COPY.tileMaking], ['Dice roller game', COPY.tileFailed], ['Garden planner', COPY.tileNeedsUpdate], ['Timer', COPY.tileChangeFailed],
      ];
      for (const [name, state] of cells) {
        const stateText = tile(tree, name).findAll((n) => hostType(n) === 'Text' && textOf(n) === state)[0];
        const title = tile(tree, name).findAll((n) => hostType(n) === 'Text' && textOf(n) === name)[0];
        h.eq([stateText?.props.numberOfLines, title?.props.numberOfLines], [undefined, 2], `${name}: “${state}” takes as many lines as it needs; the name is still cut at two`);
      }
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

  await h.test('tile menu: the card sits 8 pt under the cell as measured from the top of the root, where the menu’s own window starts, and not from below the status bar', async () => {
    await resetPhone();
    const tree = await renderHome({ apps: [TIMER] });
    try {
      await longPress(tree, 'Timer');
      await TestRenderer.act(async () => menuCard(tree)!.props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: MENU.width, height: 300 } } }));
      const top = flat(menuCard(tree)!).top as number;
      h.eq(top, CELL_RECT.y + CELL_RECT.height + MENU.gap, `${MENU.gap} pt under the cell, the way the root measures it (a status bar of ${STATUS_BAR_OFFSET} pt would put it that much too high)`);
      h.ok(top >= CELL_RECT.y + CELL_RECT.height, 'so never over its own name or its neighbours’');
    } finally { await unmountScreen(tree); }
  });

  await h.test('empty Home: the big ember and the composer’s mark both rest at full strength, not at the ember’s own default of none', async () => {
    await resetPhone();
    const tree = await renderHome({ apps: [] });
    try {
      const embers = tree.root.findAllByType(Ember);
      h.eq(embers.map((e) => e.props.size).sort((a, b) => b - a), [128, 24], 'the empty state’s and the composer’s');
      h.ok(embers.every((e) => e.props.activity === RESTING_ACTIVITY), 'each is given the resting activity');
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

  await h.test('Make a copy: an app that has saved nothing is copied fresh at once, unasked; while the app is busy nothing happens; the read is asked of the long-pressed app', async () => {
    await resetPhone();
    const forks: string[] = [];
    const asked: string[] = [];
    let saved: boolean | null = false;
    const tree = await renderHome({
      apps: [TIMER],
      canCopyData: true,
      hasSavedData: async (a) => { asked.push(a.id); return saved; },
      onFork: async (a, opts) => { forks.push(`${a.id}:${opts.data}`); return { ...a, id: 'copy' }; },
    });
    try {
      await longPress(tree, 'Timer');
      await chooseRow(tree, COPY.actionMakeCopy);
      h.eq([forks, sheetTitled(tree, COPY.copyQuestionTitle)], [['Timer:fresh'], undefined], 'nothing saved: a fresh copy, no question');
      saved = null;
      await longPress(tree, 'Timer');
      await chooseRow(tree, COPY.actionMakeCopy);
      h.eq([forks.length, sheetTitled(tree, COPY.copyQuestionTitle)], [1, undefined], 'busy: no question and no copy');
      saved = true;
      await longPress(tree, 'Timer');
      await chooseRow(tree, COPY.actionMakeCopy);
      h.ok(sheetTitled(tree, COPY.copyQuestionTitle) !== undefined && forks.length === 1, 'saved data: asked, nothing made yet');
      h.eq(asked, ['Timer', 'Timer', 'Timer'], 'each time, of the app whose menu it was');
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

  await h.test('composer bar: “Make an app…” until a description is in progress, then the words; either way it opens the describe sheet', async () => {
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
      const mark = () => bar().findAll((n) => hostType(n) === 'Path' && n.props.d === EMBER_PATH);
      h.eq(mark().length, 1, 'the ember leads while a description waits');
      await updateHome(tree, { apps: [TIMER], onCreate: () => { opened += 1; } });
      const emberSvg = bar().find((n) => hostType(n) === 'Svg' && n.findAll((m) => hostType(m) === 'Path' && m.props.d === EMBER_PATH).length > 0);
      h.eq(emberSvg.props.width, 24, 'and the ember leads the empty bar, 24 pt');
      h.ok(bar().findAll((n) => hostType(n) === 'Path' && n.props.d === ICON_PATHS.plus).length === 0, 'in place of the plus');
    } finally { await unmountScreen(tree); }
  });

  await h.test('live text size: a size changed while Home shows builds its title, grid and composer again, and Home keeps what it holds — the search words and the open menu', async () => {
    await resetPhone();
    const apps = Array.from({ length: 13 }, (_, i) => app(`App ${String(i + 1).padStart(2, '0')}`, i + 1));
    const tree = await renderHome({ apps });
    try {
      const field = () => tree.root.find((n) => hostType(n) === 'TextInput');
      const bar = () => tree.root.find((n) => hostType(n) === 'Pressable' && n.props.accessibilityHint === COPY.homeComposerHint);
      const title = () => tree.root.find((n) => hostType(n) === 'Text' && textOf(n) === COPY.homeTitle);
      await TestRenderer.act(async () => field().props.onChangeText('app 07'));
      await longPress(tree, 'App 07');
      h.ok(menuLabels(tree).length > 0, 'setup: the tile’s menu is open');
      const built = { bar: bar(), title: title(), tile: tile(tree, 'App 07') };
      await updateHome(tree, { apps });
      h.ok(bar() === built.bar && title() === built.title && tile(tree, 'App 07') === built.tile, 'setup: a render at the same text size keeps what is drawn');
      windowMetrics.fontScale = 2;
      await updateHome(tree, { apps });
      h.ok(bar() !== built.bar && title() !== built.title && tile(tree, 'App 07') !== built.tile, 'the size changed: the title, the tiles and the composer are built again, so iOS measures every text at the new size');
      h.eq([field().props.value, tileLabels(tree)], ['app 07', ['App 07']], 'the search words are still in the field and still filter the grid');
      h.ok(menuLabels(tree).length > 0, 'and the menu that was open is still open');
      const rebuilt = bar();
      await updateHome(tree, { apps });
      h.ok(bar() === rebuilt, 'built again once per size, not on every render');
    } finally { await unmountScreen(tree); windowMetrics.fontScale = 1; }
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

  await h.test('tile plate: given captured tokens it draws with them whatever the phone does; without them it follows the phone', async () => {
    await resetPhone();
    const pinned = resolveTokens({ scheme: 'dark', fontScale: 1, platform: 'ios', reduceMotion: false, increaseContrast: true });
    const rim = mixHex(TINTS.stone.dark, TINTS.stone.light, TILE_RIM.mix);
    const tree = await plate(<>
      <TilePlate size="grid" state="ready" tint="stone" glyph="coffee" tokens={pinned} />
      <TilePlate size="menu" state="ready" tint="stone" glyph="coffee" />
    </>);
    const strokes = (side: number) => paths(svgs(tree.root).find((s) => s.props.width === side)!).map((p) => p.props.stroke).filter(Boolean);
    try {
      h.eq(strokes(TILE_SIDE.grid).filter((s) => s === rim || s === COLORS.dark.border).length, 2, 'on a light phone the captured plate has the dark rim and the contrast outline');
      h.eq(strokes(TILE_SIDE.menu).filter((s) => s === rim).length, 0, 'the live plate has no rim in light');
      await TestRenderer.act(async () => setColorScheme('dark'));
      h.eq(strokes(TILE_SIDE.grid).filter((s) => s === rim || s === COLORS.dark.border).length, 2, 'the captured plate is unchanged');
      h.eq(strokes(TILE_SIDE.menu).filter((s) => s === rim).length, 1, 'the live plate takes the dark rim');
    } finally { await unmountScreen(tree); await resetPhone(); }
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
}
