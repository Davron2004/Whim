/** Home's grid moments (system.md §4.4), each with its Reduce Motion pair (§4.5, §4.7): M17 the grid's
 *  first appearance rises in, staggered, and a touch finishes it; M18 a deleted tile leaves, its
 *  neighbours reflow and Undo plays it back; M4 a ghost delivered with the grid in view turns into its
 *  tile. Also the nameless older cell keeping its row's name block. The grid itself is
 *  `home-grid-ui.suite.tsx`. */
import TestRenderer from 'react-test-renderer';
import { Harness } from './harness';
import { COPY, tileOlderLine } from '../copy';
import MiniAppView from '../MiniAppView';
import { PendingBuildStore, type PendingBuildRecord } from '../pending-builds';
import type { HomeScreenProps } from '../HomeScreen';
import { MapKVBackend } from '../../version-store';
import type { InstalledApp } from '../app-index';
import { tileOf } from '../tile-identity';
import { REFLOW, REFLOW_REDUCED } from '../../ui/AppTile';
import { GRID, TILE, TILE_SIDE } from '../../ui/AppTile-geometry';
import { resolveTokens, SPARK_PEAK, springConfig, staggerDelay, timingOf } from '../../ui/tokens-pure';
import { TINTS, TYPE_SCALE } from '../../../design/tokens';
import { StyleSheet, accessibilitySettings, emitAccessibility } from './native-host';
import { animations, elapseSprings, holdAnimations, isStep, playedUnder, ReduceMotion, type Animation, type LayoutAnimation } from './native-reanimated';
import { button, hostType, press, textOf, unmountScreen } from './react-screen';
import { chooseRow, longPress, pressToastAction, renderHome, tile, tileLabels, updateHome, type Tree } from './home-rig';
import { json, resultEvent, waitFor, withLauncher, hasInstalled, type sseStream } from './rendered-launcher';
import { startBuild, streamingServer } from './prompt-flow-ui.suite';

type Node = TestRenderer.ReactTestInstance;
type Style = Record<string, unknown>;
const flat = (node: Node): Style => (StyleSheet.flatten(node.props.style) ?? {}) as Style;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

const SMOOTH = springConfig('smooth');
const MORPH = springConfig('morph');
const SPARK = springConfig('spark');

function app(id: string, createdAt: number, extra: Partial<InstalledApp> = {}): InstalledApp {
  return { id, name: id, createdAt, lineageId: 'main', record: { appId: id, name: id, manifest: { capabilities: [] } }, ...extra };
}
/** Seeded apps the grid shows in the order given (newest first); each says "Example" under its name. */
const examples = (names: string[]) => names.map((n, i) => app(n, names.length - i, { example: true }));
const nameOfLabel = (label: string) => label.split(',')[0];

/** The animated frame around a tile: its cell, which rises, leaves and reflows. */
function cellOf(tree: Tree, name: string): Node {
  let up = tile(tree, name).parent;
  while (up && hostType(up) !== 'Animated.View') up = up.parent;
  if (!up) throw new Error(`"${name}" has no cell`);
  return up;
}
/** Where a cell is drawn: its opacity, how far it sits below its place, its scale. */
function motion(tree: Tree, name: string) {
  const style = flat(cellOf(tree, name));
  const transform = (style.transform as Record<string, number>[] | undefined) ?? [];
  const pick = (key: string) => transform.find((step) => key in step)?.[key];
  return { opacity: style.opacity as number, y: pick('translateY') ?? 0, scale: pick('scale') ?? 1 };
}
const atRest = (tree: Tree, name: string) => same(motion(tree, name), { opacity: 1, y: 0, scale: 1 });

/** Names reporting their lines, as the platform does after laying them out. */
const layOut = (tree: Tree, lines: Record<string, number>) =>
  TestRenderer.act(async () => {
    for (const [name, count] of Object.entries(lines)) {
      const label = tile(tree, name).findAll((n) => hostType(n) === 'Text' && textOf(n) === name)[0];
      label.props.onTextLayout({ nativeEvent: { lines: Array.from({ length: count }, (_, i) => ({ text: `${name} ${i}` })) } });
    }
  });
const oneLine = (names: string[]) => Object.fromEntries(names.map((n) => [n, 1]));
const gridShown = (tree: Tree) => flat(tree.root.findAll((n) => hostType(n) === 'View' && flat(n).flexWrap === 'wrap')[0]).opacity !== 0;
const line = TYPE_SCALE.caption.lineHeight;

/** UI-thread time and releases run inside act: the motions they end report back to React. */
const run = (fn: () => void) => TestRenderer.act(async () => { fn(); });
const pass = (ms: number) => run(() => elapseSprings(ms));

/** The phone's Reduce Motion, as the OS reports it to a running app. */
async function reduceMotion(on: boolean): Promise<void> {
  accessibilitySettings.reduceMotion = on;
  await TestRenderer.act(async () => emitAccessibility('reduceMotionChanged', on));
}

/** A touch anywhere on Home, as the platform delivers its start to every view under the finger. */
async function touchHome(tree: Tree): Promise<void> {
  const root = tree.root.findAll((n) => hostType(n) === 'View' && typeof n.props.onTouchStart === 'function')[0];
  if (!root) throw new Error('nothing on Home hears a touch start');
  await TestRenderer.act(async () => root.props.onTouchStart({ nativeEvent: {} }));
}

/** Where the `smooth` spring (critically damped) brings a value from 1 toward 0 after `ms`. */
const smoothFromWhole = (ms: number) => {
  const omegaT = (Math.sqrt(SMOOTH.stiffness / SMOOTH.mass) * ms) / 1000;
  return (1 + omegaT) * Math.exp(-omegaT);
};
const isSmoothTo = (a: Animation, to: number) => a.kind === 'spring' && a.to === to && same(a.config, SMOOTH);
/** The M17 rises assigned since the log was cleared: a delayed `smooth` spring to 1, in order. */
const rises = () => animations.flatMap((a) => (a.kind === 'delay' && isSmoothTo(a.animation, 1) ? [a.delay] : []));

/** The Delete stores as the shell keeps them: an armed delete hides the app until Undo. */
function deletable(): Partial<HomeScreenProps> {
  const hidden = new Set<string>();
  return {
    purges: { has: (_kind, id) => hidden.has(id), hidesAttempt: () => false },
    onDelete: (a) => { hidden.add(a.id); },
    onUndoDelete: (a) => hidden.delete(a.id),
  };
}
async function deleteTile(tree: Tree, name: string): Promise<void> {
  await longPress(tree, name);
  await chooseRow(tree, COPY.actionDelete);
}
/** Delete, and hold the motion it starts: the menu runs Delete once it has closed, so its close plays
 *  out and every motion after it is held. Resolves the release. */
async function deleteHeld(tree: Tree, name: string): Promise<() => void> {
  let release = holdAnimations();
  await deleteTile(tree, name);
  await TestRenderer.act(async () => {
    release();
    release = holdAnimations();
  });
  return () => release();
}

/** A tile's reflow as built: the preset and the spring its builder calls add up to. */
const reflowOf = (tree: Tree, name: string) => cellOf(tree, name).props.layout as LayoutAnimation;
const springOf = (layout: LayoutAnimation) => ({ mass: layout.config.mass, stiffness: layout.config.stiffness, damping: layout.config.damping });

/** Attempts as the store writes them. */
function building(id: string, prompt: string): PendingBuildRecord {
  const store = new PendingBuildStore(new MapKVBackend());
  store.create({ id, prompt, workingTitle: prompt.slice(0, 20) });
  return store.get(id)!;
}
function failedLongAgo(id: string, prompt: string, age: number): PendingBuildRecord {
  const store = new PendingBuildStore(new MapKVBackend());
  store.create({ id, prompt, workingTitle: prompt.slice(0, 20) });
  store.setFailed(id, { reason: 'It did not build.' });
  return { ...store.get(id)!, createdAt: Date.now() - age };
}

/** M4's reveal on a tile: the clipping circle as wide as the plate's diagonal, if the tile is arriving. */
const revealOf = (tree: Tree, name: string): Node | undefined =>
  tile(tree, name).findAll((n) => hostType(n) === 'Animated.View' && flat(n).overflow === 'hidden' && flat(n).borderRadius === (flat(n).width as number) / 2)[0];
/** The glyph as a tile draws it: white, half the plate. */
const GLYPH_SIDE = TILE_SIDE.grid * TILE.glyph;
const glyphs = (root: Node) => root.findAll((n) => hostType(n) === 'Svg' && n.props.width === GLYPH_SIDE);
/** M4's glyph layer: the faded layer holding the glyph and no plate. */
const glyphLayerOf = (tree: Tree, name: string): Node | undefined =>
  tile(tree, name).findAll((n) => hostType(n) === 'Animated.View' && flat(n).opacity !== undefined && glyphs(n).length === 1 && n.findAll((m) => hostType(m) === 'Svg' && m.props.width === TILE_SIDE.grid).length === 0)[0];
const scaleOf = (node: Node) => ((flat(node).transform as Record<string, number>[] | undefined) ?? []).find((s) => 'scale' in s)?.scale;
const embers = (tree: Tree, name: string) => tile(tree, name).findAll((n) => hostType(n) === 'RadialGradient' && n.props.cy === '74%').length;
const isSpark = (a: Animation) =>
  a.kind === 'sequence' && a.animations.length === 2 && a.animations.every((s, i) => isStep(s) && s.kind === 'spring' && s.to === [SPARK_PEAK, 1][i] && same(s.config, SPARK));
const isMorphTo1 = (a: Animation) => a.kind === 'spring' && a.to === 1 && same(a.config, MORPH);

const TEA = app('tea-1', 10, { name: 'Tea Timer' });
const TEA_GHOST = building('tea-1', 'A tea timer that rings');

/** Home showing the tea timer's ghost, delivered while animations are held; resolves the release. */
async function deliverOnHome(tree: Tree, props: Partial<HomeScreenProps> = {}): Promise<() => void> {
  await layOut(tree, { 'Tea timer that': 1 });
  animations.splice(0);
  const release = holdAnimations();
  await updateHome(tree, { ...props, pending: [], apps: [TEA] });
  return release;
}

export async function runHomeMotionUiTests(h: Harness): Promise<void> {
  // ── M17 grid appears ───────────────────────────────────────────────────────

  await h.test('M17: the grid’s first appearance keeps its tiles out of sight until the grid shows, then rises each 8 pt as it fades in on smooth, at the stagger token’s delay for its place; Home says it appeared once', async () => {
    const names = ['Dice', 'Timer', 'Plants', 'Tea', 'Coin', 'Mood', 'Notes', 'Water'];
    let appeared = 0;
    animations.splice(0);
    const tree = await renderHome({ apps: examples(names), firstAppearance: true, onAppeared: () => { appeared += 1; } });
    const release = holdAnimations();
    try {
      h.ok(names.every((n) => same(motion(tree, n), { opacity: 0, y: 8, scale: 1 })), 'until the grid shows, every tile is out of sight, 8 pt below its place');
      h.eq([appeared, rises().length], [0, 0], 'nothing has risen, nor been said to appear, while the names are being laid out');
      await layOut(tree, oneLine(names));
      const order = tileLabels(tree).map(nameOfLabel);
      h.eq(rises(), order.map((_, i) => staggerDelay(i, false)), 'once it shows, one smooth rise per tile in grid order, each after its place’s stagger delay');
      h.eq(appeared, 1, 'and Home tells the shell the grid has appeared');
      h.ok(names.every((n) => motion(tree, n).opacity === 0), 'held mid-flight, they have not landed yet');
    } finally { await run(release); }
    try {
      h.ok(names.every((n) => atRest(tree, n)), 'risen, every tile is whole and in its place');
      await updateHome(tree, { apps: examples([...names, 'Later']), firstAppearance: true });
      h.ok(atRest(tree, 'Later'), 'a tile that comes after the first appearance is simply there');
      h.eq(appeared, 1, 'and the grid is not said to appear again');
    } finally { await unmountScreen(tree); }
  });

  await h.test('M17: under the launch screen the grid waits; uncovered, it rises', async () => {
    const names = ['Dice', 'Timer'];
    const tree = await renderHome({ apps: examples(names), firstAppearance: true, covered: true });
    try {
      animations.splice(0);
      await layOut(tree, oneLine(names));
      h.ok(rises().length === 0 && names.every((n) => motion(tree, n).opacity === 0), 'laid out but still covered, nothing rises and nothing shows');
      await updateHome(tree, { apps: examples(names), firstAppearance: true, covered: false });
      h.eq(rises(), [0, 1].map((i) => staggerDelay(i, false)), 'uncovered, the tiles rise in');
    } finally { await unmountScreen(tree); }
  });

  await h.test('M17: a touch finishes it — mid-stagger every tile jumps to its place, and the tap that touched still lands', async () => {
    const names = ['Dice', 'Timer', 'Plants', 'Tea'];
    const opened: string[] = [];
    const tree = await renderHome({ apps: examples(names), firstAppearance: true, onOpen: (a) => opened.push(a.id) });
    const release = holdAnimations();
    try {
      await layOut(tree, oneLine(names));
      h.ok(names.every((n) => motion(tree, n).opacity === 0), 'mid-stagger, nothing has landed');
      await touchHome(tree);
      h.ok(names.every((n) => atRest(tree, n)), 'a touch puts every tile in its place at once');
      await press(tile(tree, 'Plants'));
      h.eq(opened, ['Plants'], 'and the tap lands on the tile it touched');
    } finally { await run(release); await unmountScreen(tree); }
  });

  await h.test('M17 under Reduce Motion (pair): off, the tiles rise in staggered; on, they are there at once, with no rise', async () => {
    const names = ['Dice', 'Timer', 'Plants'];
    const appear = async (on: boolean) => {
      const tree = await renderHome({ apps: examples(names), firstAppearance: true });
      await reduceMotion(on);
      animations.splice(0);
      const release = holdAnimations();
      try {
        await layOut(tree, oneLine(names));
        return { rises: rises().length, inPlace: names.every((n) => atRest(tree, n)) };
      } finally {
        await run(release);
        await reduceMotion(false);
        await unmountScreen(tree);
      }
    };
    h.eq(await appear(false), { rises: 3, inPlace: false }, 'off: three rises still under way');
    h.eq(await appear(true), { rises: 0, inPlace: true }, 'on: every tile in place the moment the grid shows, nothing rising');
  });

  await h.test('M17 in the shell: the grid rises in when it first shows after launch, once the launch screen has faded, and not when Home comes back from an open app', async () => {
    const examplesShown = (tree: Tree) => tileLabels(tree).length === 3;
    await withLauncher({ examples: true, server: () => json({}) }, async ({ tree, clock }) => {
      animations.splice(0);
      await waitFor(() => examplesShown(tree), 'the three example apps');
      const names = tileLabels(tree).map(nameOfLabel);
      await layOut(tree, oneLine(names));
      await waitFor(() => clock.count(timingOf('fadeIn').duration) > 0, 'the launch screen to be told to go');
      h.ok(rises().length === 0 && names.every((n) => motion(tree, n).opacity === 0), 'while the launch screen fades out over Home, the tiles wait out of sight');
      await TestRenderer.act(async () => { clock.fire(timingOf('fadeIn').duration); });
      h.eq(rises(), [0, 1, 2].map((i) => staggerDelay(i, false)), 'once it has gone, the three tiles rise in, staggered');
      await TestRenderer.act(async () => tile(tree, names[0]).props.onPress());
      await waitFor(() => tree.root.findAllByType(MiniAppView).length === 1, 'the app to open');
      animations.splice(0);
      await TestRenderer.act(async () => tree.root.findByType(MiniAppView).props.onExit());
      await waitFor(() => examplesShown(tree), 'Home again');
      await layOut(tree, oneLine(names));
      h.eq(rises(), [], 'back from the app, nothing rises');
      h.ok(names.every((n) => atRest(tree, n)), 'every tile is simply in its place');
    });
  });

  // ── M18 delete ─────────────────────────────────────────────────────────────

  await h.test('M18: a deleted tile shrinks toward 0.8 as it fades on smooth, untouchable and unread; once gone its neighbours reflow on the smooth spring; an Undo after that plays it back from nothing', async () => {
    const names = ['Dice', 'Timer', 'Plants', 'Tea', 'Coin'];
    const tree = await renderHome({ apps: examples(names), ...deletable() });
    await layOut(tree, oneLine(names));
    animations.splice(0);
    const release = await deleteHeld(tree, 'Timer');
    try {
      h.ok(tileLabels(tree).some((l) => nameOfLabel(l) === 'Timer'), 'the deleted tile keeps its cell while it leaves');
      const cell = cellOf(tree, 'Timer');
      h.eq([cell.props.pointerEvents, cell.props.accessibilityElementsHidden, cell.props.importantForAccessibility], ['none', true, 'no-hide-descendants'], 'it takes no touch and a screen reader skips it');
      await pass(120);
      const mid = motion(tree, 'Timer');
      h.ok(Math.abs(mid.opacity - smoothFromWhole(120)) < 0.01, `120 ms in it has faded as far as the smooth spring brings it (${mid.opacity.toFixed(3)} vs ${smoothFromWhole(120).toFixed(3)})`);
      h.ok(Math.abs(mid.scale - (0.8 + 0.2 * mid.opacity)) < 1e-9 && mid.y === 0, `and shrinking toward 0.8 in step, uniformly (${mid.scale.toFixed(3)})`);
      await pass(180);
      h.ok(tileLabels(tree).some((l) => nameOfLabel(l) === 'Timer') && motion(tree, 'Timer').opacity > 0.02, '300 ms in, still faintly there, it keeps its cell');
      await pass(100);
      h.ok(smoothFromWhole(400) > 0.001, 'the case under test: 400 ms in, the spring has not come to rest');
      h.eq(tileLabels(tree).map(nameOfLabel), ['Dice', 'Plants', 'Tea', 'Coin'], 'once it can no longer be seen it leaves the grid, without waiting out the spring');
      for (const n of ['Dice', 'Plants', 'Tea', 'Coin']) {
        const reflow = reflowOf(tree, n);
        h.ok(reflow.preset === 'LinearTransition' && reflow.config.springify === true && same(springOf(reflow), SMOOTH), `${n} reflows on the token module’s smooth spring`);
        h.ok(playedUnder(reflow, false) !== null, `${n}’s reflow plays`);
      }
      await pressToastAction(tree);
      h.eq(tileLabels(tree).map(nameOfLabel), names, 'Undo brings it back to its place');
      h.ok(same(motion(tree, 'Timer'), { opacity: 0, y: 0, scale: 0.8 }), 'from where it left off: nothing, at 0.8');
      await pass(3000);
      h.ok(atRest(tree, 'Timer'), 'and plays it back to whole');
      h.eq(cellOf(tree, 'Timer').props.pointerEvents, 'auto', 'touchable again');
    } finally { await run(release); await unmountScreen(tree); }
  });

  await h.test('M18: an Undo while the tile still leaves turns it back from where it is on screen, never from nothing or from whole, and it never leaves the grid', async () => {
    const names = ['Dice', 'Timer', 'Plants'];
    const tree = await renderHome({ apps: examples(names), ...deletable() });
    await layOut(tree, oneLine(names));
    const release = await deleteHeld(tree, 'Timer');
    try {
      await pass(100);
      const there = motion(tree, 'Timer');
      h.ok(there.opacity > 0.05 && there.opacity < 0.95, `mid-leave (${there.opacity.toFixed(2)})`);
      animations.splice(0);
      await pressToastAction(tree);
      h.ok(same(motion(tree, 'Timer'), there), 'Undo leaves it exactly where it was on screen');
      await pass(300);
      h.ok(motion(tree, 'Timer').opacity > there.opacity, 'and from there it turns back toward whole');
      await pass(3000);
      h.ok(atRest(tree, 'Timer'), 'and it comes back to whole');
      h.eq(tileLabels(tree).map(nameOfLabel), names, 'in its place, having never left the grid');
    } finally { await run(release); await unmountScreen(tree); }
  });

  await h.test('M18 under Reduce Motion (pair): off, the tile leaves and its neighbours reflow on smooth; on, it is removed at once and its neighbours cross-fade in place over fade-in', async () => {
    const names = ['Dice', 'Timer', 'Plants'];
    const removal = async (on: boolean) => {
      const tree = await renderHome({ apps: examples(names), ...deletable() });
      await reduceMotion(on);
      await layOut(tree, oneLine(names));
      animations.splice(0);
      const release = await deleteHeld(tree, 'Timer');
      try {
        const neighbour = playedUnder(reflowOf(tree, 'Plants'), on);
        const stillThere = tileLabels(tree).some((l) => nameOfLabel(l) === 'Timer');
        await pass(100);
        return { stillThere, fading: stillThere && motion(tree, 'Timer').opacity < 1, neighbour };
      } finally {
        await run(release);
        await reduceMotion(false);
        await unmountScreen(tree);
      }
    };
    const off = await removal(false);
    h.ok(off.stillThere && off.fading, 'off: the tile is still there, fading as it leaves');
    h.ok(off.neighbour?.preset === 'LinearTransition' && same(springOf(off.neighbour), SMOOTH), 'and its neighbours reflow on smooth');
    const on = await removal(true);
    h.ok(!on.stillThere, 'on: the tile is removed at once');
    h.ok(on.neighbour?.preset === 'FadingTransition' && on.neighbour.config.duration === timingOf('fadeIn').duration, 'and its neighbours cross-fade over fade-in');
    h.ok(on.neighbour?.config.reduceMotion === ReduceMotion.Never && playedUnder(REFLOW, true) === null && playedUnder(REFLOW_REDUCED, true) !== null, 'the cross-fade plays under the setting, where the reflow would be skipped');
  });

  await h.test('M18: a reflow that moves a wrapped name into another row gives that row the two-line block, and the grid stays shown throughout', async () => {
    const names = ['Dice', 'Timer', 'Plants', 'Tea', 'Water Counter'];
    const tree = await renderHome({ apps: examples(names), ...deletable() });
    try {
      await layOut(tree, { ...oneLine(names), 'Water Counter': 2 });
      const block = (n: string) => flat(tile(tree, n).findAll((m) => hostType(m) === 'Text' && textOf(m) === n)[0]).minHeight;
      h.eq(['Dice', 'Timer', 'Plants', 'Tea'].map(block), [line, line, line, line], 'the first row has no wrapped name');
      const shown: boolean[] = [];
      const release = await deleteHeld(tree, 'Dice');
      try {
        shown.push(gridShown(tree));
      } finally { await run(release); }
      shown.push(gridShown(tree));
      h.eq(tileLabels(tree).map(nameOfLabel), ['Timer', 'Plants', 'Tea', 'Water Counter'], 'Water Counter moves up into the first row');
      h.eq(['Timer', 'Plants', 'Tea', 'Water Counter'].map(block), [2, 2, 2, 2].map((n) => n * line), 'which now gives every name the two-line block');
      h.eq(shown, [true, true], 'the grid never went out of sight while it reflowed');
    } finally { await unmountScreen(tree); }
  });

  // ── M4 ghost → tile ────────────────────────────────────────────────────────

  await h.test('M4: a ghost delivered with the grid in view turns into its tile — the same ember flares on spark and goes out as a circle of the tint fills the squircle from the centre on morph, and the glyph fades in from 0.9', async () => {
    const tree = await renderHome({ pending: [TEA_GHOST] });
    const tint = TINTS[tileOf(TEA).tint].light;
    const ghostFill = resolveTokens({ scheme: 'light', fontScale: 1, reduceMotion: false, increaseContrast: false, platform: 'ios' }).colors['ember-soft'];
    const release = await deliverOnHome(tree);
    try {
      h.eq(tileLabels(tree), ['Tea Timer'], 'the tile is the app’s now');
      h.ok(animations.some(isSpark), 'the ghost’s own ember flares 1 → peak → 1 on spark (a new ember would not)');
      h.ok(animations.some(isMorphTo1), 'the tile arrives on morph');
      h.eq(embers(tree, 'Tea Timer'), 1, 'the ember is still there, going out');
      const fills = tile(tree, 'Tea Timer').findAll((n) => hostType(n) === 'Path' && typeof n.props.fill === 'string' && n.props.fill !== 'none').map((n) => n.props.fill);
      h.eq(fills[0], ghostFill, 'under it all, the ghost’s plate');
      const reveal = revealOf(tree, 'Tea Timer');
      h.ok(reveal !== undefined && (scaleOf(reveal) ?? 1) < 0.05, 'the tint is behind a circle that starts as a point');
      h.ok(reveal?.findAll((n) => hostType(n) === 'Path' && n.props.fill === tint).length === 1, 'the circle holds the whole tint squircle');
      const inner = reveal?.findAll((n) => hostType(n) === 'Animated.View')[1];
      h.ok(inner !== undefined && Math.abs((scaleOf(reveal!) ?? 0) * (scaleOf(inner) ?? 0) - 1) < 1e-9, 'the squircle inside counter-scales, so only the circle’s edge moves');
      const glyph = glyphLayerOf(tree, 'Tea Timer');
      h.ok(glyph !== undefined && flat(glyph).opacity === 0 && Math.abs((scaleOf(glyph) ?? 1) - 0.9) < 1e-9, 'the glyph waits unseen at 0.9');
    } finally { await run(release); }
    try {
      h.eq([revealOf(tree, 'Tea Timer') !== undefined, embers(tree, 'Tea Timer')], [false, 0], 'arrived: no reveal left and no ember');
      const fills = tile(tree, 'Tea Timer').findAll((n) => hostType(n) === 'Path' && n.props.fill === tint);
      h.eq(fills.length, 1, 'the plate is the tint');
      h.eq(glyphs(tile(tree, 'Tea Timer')).length, 1, 'with its glyph');
    } finally { await unmountScreen(tree); }
  });

  await h.test('M4: opening the tile finishes it — the arriving tile shows whole at once and the app opens', async () => {
    const opened: string[] = [];
    const onOpen = (a: InstalledApp) => { opened.push(a.id); };
    const tree = await renderHome({ pending: [TEA_GHOST], onOpen });
    const release = await deliverOnHome(tree, { onOpen });
    try {
      h.ok(revealOf(tree, 'Tea Timer') !== undefined, 'mid-arrival');
      await press(tile(tree, 'Tea Timer'));
      h.eq([revealOf(tree, 'Tea Timer') !== undefined, embers(tree, 'Tea Timer')], [false, 0], 'the tap shows the tile whole at once');
      h.eq(opened, [TEA.id], 'and opens the app');
    } finally { await run(release); await unmountScreen(tree); }
  });

  await h.test('M4 under Reduce Motion (pair): off, a flare and a morph; on, no flare, no morph — the tint plate and glyph cross-fade in over fade-in, whole', async () => {
    const arrive = async (on: boolean) => {
      const tree = await renderHome({ pending: [TEA_GHOST] });
      await reduceMotion(on);
      const release = await deliverOnHome(tree);
      try {
        const reveal = revealOf(tree, 'Tea Timer');
        const glyph = glyphLayerOf(tree, 'Tea Timer');
        const fade = animations.find((a) => a.kind === 'timing' && a.to === 1 && a.config?.duration === timingOf('fadeIn').duration && a.config?.reduceMotion === ReduceMotion.Never);
        return {
          spark: animations.some(isSpark),
          morph: animations.some(isMorphTo1),
          fade: fade !== undefined,
          masked: reveal === undefined ? null : scaleOf(reveal) !== undefined,
          fadedOut: reveal === undefined ? null : flat(reveal).opacity === 0,
          glyphScale: glyph === undefined ? null : scaleOf(glyph),
        };
      } finally {
        await run(release);
        await reduceMotion(false);
        await unmountScreen(tree);
      }
    };
    h.eq(await arrive(false), { spark: true, morph: true, fade: false, masked: true, fadedOut: false, glyphScale: 0.9 }, 'off: the flare, the morph, the circle from a point and the glyph from 0.9');
    h.eq(await arrive(true), { spark: false, morph: false, fade: true, masked: false, fadedOut: true, glyphScale: 1 }, 'on: a whole tint plate fading in with its glyph at full size, nothing flaring or growing');
  });

  await h.test('M4 in the shell: a build left running that delivers on Home turns its ghost into the tile, with the flare and the morph', async () => {
    const streams: ReturnType<typeof sseStream>[] = [];
    await withLauncher({ server: streamingServer(streams) }, async ({ tree }) => {
      await startBuild(tree, 'A tea timer');
      await press(button(tree, COPY.sheetClose));
      animations.splice(0);
      streams[0].push(resultEvent('Tea Timer'));
      streams[0].end();
      await waitFor(() => hasInstalled(tree, 'Tea Timer'), 'the build to deliver on Home');
      h.ok(animations.some(isSpark), 'the ghost’s ember flared: the tile on Home is the ghost’s own, not a new one');
      h.ok(animations.some(isMorphTo1), 'and it arrived on morph');
    });
  });

  // ── the older cell's name block ────────────────────────────────────────────

  await h.test('home layout: the nameless “N didn’t work” tile keeps its row’s name block, so its state line sits level with its neighbours’', async () => {
    const DAY = 24 * 60 * 60 * 1000;
    const older = [failedLongAgo('o1', 'A dice roller game', 2 * DAY), failedLongAgo('o2', 'Plant watering tracker', 3 * DAY)];
    const tree = await renderHome({ apps: examples(['Water Counter', 'Dice']), pending: older });
    try {
      await layOut(tree, { 'Water Counter': 2, Dice: 1 });
      const olderName = tileOlderLine(2);
      h.eq(tileLabels(tree).map(nameOfLabel), ['Water Counter', 'Dice', olderName], 'one row: two apps and the older tile');
      /** How far below the plate a tile's state line starts: every block between them, margins included. */
      const aboveStateLine = (name: string, stateText: string) => {
        const stateLine = tile(tree, name).findAll((n) => hostType(n) === 'Text' && textOf(n) === stateText).at(-1)!;
        let column = stateLine.parent;
        while (column && hostType(column) !== 'View') column = column.parent;
        const blocks = (column?.children ?? []).filter((c): c is Node => typeof c !== 'string');
        const at = blocks.map((b) => textOf(b)).lastIndexOf(stateText);
        const before = blocks.slice(1, at);
        return before.reduce((sum, block) => sum + ((flat(block).marginTop as number | undefined) ?? 0) + ((flat(block).minHeight ?? flat(block).height ?? 0) as number), 0);
      };
      const dice = aboveStateLine('Dice', COPY.exampleBadge);
      h.eq(dice, GRID.labelGap + 2 * line, 'Dice’s state line sits under its row’s two-line block');
      h.eq(aboveStateLine(olderName, olderName), dice, 'the older tile’s sits level with it');
    } finally { await unmountScreen(tree); }
  });
}
