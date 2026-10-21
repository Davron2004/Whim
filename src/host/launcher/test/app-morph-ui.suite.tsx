/** M2 Open an app and M3 Close an app (system.md §4.4), with their Reduce Motion pairs (§4.5), in the
 *  rendered launcher: a tapped tile's app grows its `bg` out of that tile's measured rect to the screen
 *  on `morph`, the tint a tile-sized plate on the tile, Home under it until the `bg` covers the screen;
 *  leaving covers the page first and shrinks back into the tile on `smooth`; back mid-open turns it
 *  round from where it is, a tap on the tile mid-close turns it back out; the WebView is only ever
 *  covered, never resized or hidden; an open held by History's pop grows only once the pop is over. */
import React from 'react';
import TestRenderer from 'react-test-renderer';
import { Harness } from './harness';
import HomeScreen from '../HomeScreen';
import HistoryScreen from '../HistoryScreen';
import LauncherRoot from '../LauncherRoot';
import MiniAppView from '../MiniAppView';
import { StoreAccess } from '../store-access';
import { AppIndex, type InstalledApp } from '../app-index';
import { createMmkvBackend } from '../../version-store/fs/mmkv-backend';
import { SEED_VERSION } from '../seed';
import { COPY } from '../copy';
import { COLORS, TINTS } from '../../../design/tokens';
import { TilePlate } from '../../ui/AppTile';
import { TILE, TILE_SIDE } from '../../ui/AppTile-geometry';
import { springConfig, timingOf } from '../../ui/tokens-pure';
import { resetNativeStorage } from './native-storage';
import { accessibilitySettings, emitAccessibility, hardwareBack, injectedScripts, setColorScheme, StyleSheet } from './native-host';
import { animations, elapse, elapseSprings, holdAnimations, isStep, measuring, ReduceMotion, type Step } from './native-reanimated';
import { stackMoveEnds, stackUnmountsMidMove } from './native-screens';
import { boundWebView, button, captureTimeouts, hostType, press, renderScreen, unmountScreen } from './react-screen';
import { settle, waitFor } from './rendered-launcher';
import { SYSCALL_VERSION } from '../../bridge/contract';
import { STARTUP_DEADLINE_MS } from '../boot-state';
import { AppCrashed } from '../AppCrashed';
import { log } from '../../logging';
import { Dispatcher } from '../../bridge/dispatcher';

type Tree = TestRenderer.ReactTestRenderer;
type Node = TestRenderer.ReactTestInstance;
type Style = Record<string, unknown>;
type Rect = { x: number; y: number; width: number; height: number; pageX: number; pageY: number };
const flat = (node: Node): Style => (StyleSheet.flatten(node.props.style) ?? {}) as Style;

const MORPH = springConfig('morph');
const SMOOTH = springConfig('smooth');
const FADE_IN_MS = timingOf('fadeIn').duration;
const FADE_OUT_MS = timingOf('fadeOut').duration;

const rect = (pageX: number, pageY: number, width: number, height: number): Rect => ({ x: 0, y: 0, width, height, pageX, pageY });
/** The stage: below the 20 pt status-bar strip (`useSafeAreaInsets` in the double), to the window's bottom. */
const STAGE = rect(0, 20, 390, 824);
/** Two tiles where a phone draws them on Home's grid: the second row's second cell, and the first cell. */
const TIMER_TILE = rect(112, 260, 64, 64);
const DICE_TILE = rect(24, 140, 64, 64);

const timer: InstalledApp = { id: 'timer', name: 'Timer', createdAt: 2, lineageId: 'main', tint: 'ocean', icon: 'timer', record: { appId: 'timer', name: 'Timer', manifest: { capabilities: ['diag'] } } };
const dice: InstalledApp = { id: 'dice', name: 'Dice', createdAt: 1, lineageId: 'main', tint: 'rose', icon: 'dice-5', record: { appId: 'dice', name: 'Dice', manifest: { capabilities: [] } } };

/** Every host view's ref holds its element, so `measure` can tell the stage and each tile apart. */
const nodeMock = (element: React.ReactElement) => ({ element });
function placeOf(node: unknown): Rect | undefined {
  const { props } = (node as { element: React.ReactElement<Record<string, unknown>> }).element;
  const kids = React.Children.toArray(props.children as React.ReactNode) as React.ReactElement<Record<string, unknown>>[];
  if (props.collapsable === false && kids.some((kid) => React.isValidElement(kid) && kid.props.pointerEvents === 'box-none')) return STAGE;
  const plate = kids.find((kid) => React.isValidElement(kid) && kid.type === TilePlate);
  if (props.collapsable === false && typeof props.onLayout === 'function' && plate) return plate.props.tint === 'ocean' ? TIMER_TILE : DICE_TILE;
  return undefined;
}

async function reduceMotion(on: boolean): Promise<void> {
  accessibilitySettings.reduceMotion = on;
  await TestRenderer.act(async () => emitAccessibility('reduceMotionChanged', on));
}

interface Rig {
  tree: Tree;
  clock: ReturnType<typeof captureTimeouts>;
}

/** The launcher with the two apps on Home, measured where a phone draws them; Reduce Motion `reduced`. */
async function withLauncher(body: (rig: Rig) => Promise<void>, reduced = false): Promise<void> {
  resetNativeStorage();
  injectedScripts.length = 0;
  const index = new AppIndex(createMmkvBackend('whim.launcher'));
  index.markSeeded(SEED_VERSION);
  index.put(dice);
  index.put(timer);
  const { activeLaunch } = StoreAccess.prototype;
  StoreAccess.prototype.activeLaunch = async (target) => ({ app: target, source: `window.__WHIM_APP_MODULE__ = { id: "${target.id}" };`, versionId: 'g1' });
  measuring.rectOf = placeOf;
  const clock = captureTimeouts();
  const tree = await renderScreen(<LauncherRoot deviceLocale={() => 'en-US'} />, { createNodeMock: nodeMock });
  try {
    await reduceMotion(reduced);
    await waitFor(() => tree.root.findAllByType(HomeScreen).length === 1 && tree.root.findByType(HomeScreen).props.apps.length === 2, 'Home with both apps');
    await body({ tree, clock });
  } finally {
    await reduceMotion(false);
    await unmountScreen(tree);
    clock.restore();
    measuring.rectOf = null;
    StoreAccess.prototype.activeLaunch = activeLaunch;
  }
}

const tileOf = (tree: Tree, name: string) => tree.root.findAll((n) => hostType(n) === 'Pressable' && String(n.props.accessibilityLabel).startsWith(name))[0];
/** A tap on the tile, then the bundle read it starts. */
async function tapTile(tree: Tree, name: string): Promise<void> {
  await TestRenderer.act(async () => tileOf(tree, name).props.onPress());
  await settle();
}
const homeShown = (tree: Tree) => tree.root.findAllByType(HomeScreen).length === 1;
const appOpen = (tree: Tree) => tree.root.findAllByType(MiniAppView).length === 1;
/** The app's `bg`: the one childless, absolutely placed view in the app's layers with corners. */
/** The views the app's `bg` is drawn with: two bars over the whole stage and four corner discs, each
 *  moved and scaled from its top-left. */
const shapeViews = (tree: Tree) => tree.root.findByType(MiniAppView).findAll((n) => hostType(n) === 'Animated.View' && n.children.length === 0 && flat(n).transformOrigin === 'left top' && n.props.pointerEvents === 'none');
const transformOf = (node: Node) => Object.assign({}, ...((flat(node).transform as Record<string, number>[] | undefined) ?? [])) as Record<string, number>;
const round = (v: number) => Math.round(v * 1000) / 1000;
/** The rounded rect the `bg` is drawn as, in the stage, read off its two bars (`BgShape`): the bar
 *  across spans its width, the bar down its height, and the corner radius is how far in it starts. */
function shapeOf(tree: Tree) {
  const [across, down] = shapeViews(tree).filter((n) => flat(n).bottom === 0);
  const a = transformOf(across);
  const d = transformOf(down);
  const opacity = flat(across).opacity as number;
  if (flat(down).opacity === 0) return { x: 0, y: 0, w: STAGE.width, h: STAGE.height, r: 0, opacity };
  return { x: a.translateX, y: d.translateY, w: a.scaleX * STAGE.width, h: d.scaleY * STAGE.height, r: d.translateX - a.translateX, opacity };
}
const insetsOf = (tree: Tree) => {
  const { x, y, w, h } = shapeOf(tree);
  return { top: round(y), left: round(x), right: round(STAGE.width - x - w), bottom: round(STAGE.height - y - h) };
};
/** Where `tile` is, as insets in the stage. */
const insetsAt = (tile: Rect) => ({ top: tile.pageY - STAGE.pageY, left: tile.pageX, right: STAGE.width - tile.pageX - tile.width, bottom: STAGE.pageY + STAGE.height - tile.pageY - tile.height });
const FULL = { top: 0, left: 0, right: 0, bottom: 0 };
/** How far the `bg` has grown from `tile` (0) to the stage (1), read off its left inset. */
const grownFrom = (tree: Tree, tile: Rect) => 1 - shapeOf(tree).x / tile.pageX;
/** The app's plate: the view that places the opening's tile-sized plate. */
const plateBox = (tree: Tree) => tree.root.findByType(MiniAppView).findByType(TilePlate).parent!;
/** Where the plate is drawn in the stage: its centre and side, from its centred place and its move. */
function plateRect(tree: Tree) {
  const t = Object.assign({}, ...((flat(plateBox(tree)).transform as Record<string, number>[] | undefined) ?? [])) as Record<string, number>;
  const side = TILE_SIDE.grid * (t.scale ?? 1);
  return { cx: STAGE.width / 2 + (t.translateX ?? 0), cy: STAGE.height / 2 + (t.translateY ?? 0), side, opacity: flat(plateBox(tree)).opacity };
}
/** How much of the plate shows: its place's opacity times the opening layer's that holds it. */
function plateShown(tree: Tree): number {
  const layer = tree.root.findByType(MiniAppView).findAll((n) => hostType(n) === 'Animated.View' && n.props.accessibilityElementsHidden !== undefined && n.findAllByType(TilePlate).length === 1)[0];
  return (plateRect(tree).opacity as number) * (flat(layer).opacity as number);
}
/** Every view between the bound WebView and the stage that holds it, the WebView included. */
function webViewLine(tree: Tree): Node[] {
  const line: Node[] = [];
  for (let n: Node | null = boundWebView(tree); n && !(typeof n.type === 'string' && placeOf({ element: { props: n.props } }) === STAGE); n = n.parent) {
    if (typeof n.type === 'string') line.push(n);
  }
  return line;
}
/** What the WebView and the views holding it are laid out and drawn with: never a size, a move or a fade. */
const SIZE_KEYS = ['width', 'height', 'top', 'left', 'right', 'bottom', 'opacity', 'transform', 'display', 'position'];
const webViewDrawn = (tree: Tree) => webViewLine(tree).map((n) => Object.fromEntries(Object.entries(flat(n)).filter(([k]) => SIZE_KEYS.includes(k))));
/** The springs and timings assigned since `from`. */
const stepsSince = (from: number) => animations.slice(from).filter(isStep) as Step[];
const isConfig = (step: Step, config: object) => Object.entries(config).every(([k, v]) => step.config?.[k] === v);

/** The generation the last delivery bound its realm at. */
const deliveredGeneration = () => Number(/,generation:(\d+)/.exec(injectedScripts.at(-1) ?? '')?.[1]);
/** The bound WebView's page loads, and the app is delivered into it. */
async function deliver(tree: Tree): Promise<number> {
  await TestRenderer.act(async () => boundWebView(tree).props.onLoadEnd());
  return deliveredGeneration();
}
/** A trusted first paint through the bound WebView, stamped `generation` (by default the last delivery's). */
async function paintAt(tree: Tree, generation: number): Promise<void> {
  const frame = { kind: 'paint', trusted: true, payload: { generation, mountToFirstPaintMs: 12, appName: 'Timer' } };
  await TestRenderer.act(async () => boundWebView(tree).props.onMessage({ nativeEvent: { data: JSON.stringify(frame) } }));
}
async function paint(tree: Tree): Promise<void> {
  await paintAt(tree, await deliver(tree));
}
const crashed = (tree: Tree) => tree.root.findAllByType(AppCrashed).length === 1;
const paintTimeouts = () => log.buffer.snapshot().filter((r) => r.level === 'error' && (r.fields as { where?: string } | undefined)?.where === 'paint-timeout').length;
/** Opened from its tile, delivered, grown, but not painted; then left (Android back at depth 0) and
 *  caught mid-way back into the tile, animations held: `release` lets them run. */
async function leaveWhileBooting(tree: Tree): Promise<{ generation: number; release: () => void }> {
  const grow = holdAnimations();
  await tapTile(tree, 'Timer');
  const generation = await deliver(tree);
  await TestRenderer.act(async () => grow());
  const release = holdAnimations();
  await TestRenderer.act(async () => { hardwareBack(); });
  await TestRenderer.act(async () => elapseSprings(150));
  return { generation, release };
}
/** The page shows: the `bg` over it is fully faded. */
const pageShown = (tree: Tree) => shapeOf(tree).opacity === 0;

/** Where a view of the app's layers is drawn in the stage: laid out over the whole stage, moved and
 *  scaled from its top-left. */
function drawnRect(node: Node) {
  const t = transformOf(node);
  return { x: t.translateX ?? 0, y: t.translateY ?? 0, w: (t.scaleX ?? 1) * STAGE.width, h: (t.scaleY ?? 1) * STAGE.height };
}
/** What a touch at (`x`, `y`) in the stage lands on while Home is drawn under the app (the app's
 *  layers are drawn over it): the topmost view of the app's layers that takes touches and is drawn
 *  there, else Home. */
function touchAt(tree: Tree, x: number, y: number): Node | 'home' {
  const app = tree.root.findByType(MiniAppView);
  const untouchable = (n: Node) => {
    for (let up: Node | null = n; up && up !== app; up = up.parent) if (up.props.pointerEvents === 'none') return true;
    return false;
  };
  const takers = app.findAll((n) => typeof n.type === 'string' && n.props.onStartShouldSetResponder?.() === true && !untouchable(n));
  for (const n of takers.reverse()) {
    const r = drawnRect(n);
    if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return n;
  }
  return 'home';
}
/** The centre of the app's `bg` as drawn. */
const shapeCentre = (tree: Tree): [number, number] => {
  const { x, y, w, h } = shapeOf(tree);
  return [x + w / 2, y + h / 2];
};
/** Whether the orb can be touched and is in the accessibility tree: no view holding it says otherwise. */
function orbReach(tree: Tree) {
  let touch = true;
  let a11y = true;
  for (let up: Node | null = button(tree, COPY.orbMenuOpenLabel); up; up = up.parent) {
    if (up.props.pointerEvents === 'none') touch = false;
    if (up.props.accessibilityElementsHidden === true || up.props.importantForAccessibility === 'no-hide-descendants') a11y = false;
  }
  return { touch, a11y };
}
/** The bundle reads, held: each app's read waits until `answer(appId)` lets it through. */
function holdReads(): (appId: string) => Promise<void> {
  const waiting = new Map<string, () => void>();
  const read = StoreAccess.prototype.activeLaunch;
  StoreAccess.prototype.activeLaunch = function (target) {
    return new Promise((resolve) => waiting.set(target.id, () => resolve(read.call(this, target))));
  };
  return async (appId) => {
    const go = waiting.get(appId);
    waiting.delete(appId);
    await TestRenderer.act(async () => go?.());
    await settle();
  };
}
/** Every syscall's answer held back until the returned call lets them all through. */
function holdSyscalls(): () => void {
  const { handle } = Dispatcher.prototype;
  let open!: () => void;
  const gate = new Promise<void>((resolve) => { open = resolve; });
  Dispatcher.prototype.handle = async function held(raw) {
    await gate;
    return handle.call(this, raw);
  };
  return () => {
    Dispatcher.prototype.handle = handle;
    open();
  };
}
/** A call into the host from the realm bound at `generation`. */
const syscallAt = (generation: number, id: number) => JSON.stringify({ kind: 'syscall', trusted: false, payload: { whim: 'syscall', v: SYSCALL_VERSION, id, gen: generation, method: 'diag.echo', params: { payload: id } } });
/** Answers relayed into any WebView so far. */
const relayed = () => injectedScripts.filter((js) => js.includes('__whimRelaySysret(')).length;
/** Leaves the open app (Android back at depth 0) and lets it shrink until `k` of it is left. */
async function shrinkTo(tree: Tree, k: number): Promise<void> {
  await TestRenderer.act(async () => { hardwareBack(); });
  await TestRenderer.act(async () => elapse(FADE_OUT_MS));
  for (let i = 0; i < 40 && grownFrom(tree, TIMER_TILE) > k; i++) await TestRenderer.act(async () => elapseSprings(20));
}

export async function runAppMorphUiTests(h: Harness): Promise<void> {
  await h.test('M2: a tapped tile’s app grows its bg from that tile’s measured rect to the screen on morph, the plate stays on the tile, and Home stays under it until the bg covers the screen', async () => {
    await withLauncher(async ({ tree }) => {
      const from = animations.length;
      const release = holdAnimations();
      await tapTile(tree, 'Timer');
      h.ok(appOpen(tree) && homeShown(tree), 'the app opens over Home, which stays drawn under it');
      h.eq(insetsOf(tree), insetsAt(TIMER_TILE), 'the bg sets out exactly on the tapped tile (the second tile, not the first)');
      h.eq(round(shapeOf(tree).r), round(TILE.corner * TIMER_TILE.width), 'with the tile’s corners');
      const plate = plateRect(tree);
      h.eq([plate.cx, plate.cy, plate.side], [TIMER_TILE.pageX + 32 - STAGE.pageX, TIMER_TILE.pageY + 32 - STAGE.pageY, 64], 'the tint plate sits on the tile at its size');
      const grow = stepsSince(from).filter((s) => s.kind === 'spring' && isConfig(s, MORPH));
      h.ok(grow.length === 1 && grow[0].to === 1, 'it grows on morph');
      await TestRenderer.act(async () => elapseSprings(160));
      const k = grownFrom(tree, TIMER_TILE);
      h.ok(k > 0.2 && k < 1 && homeShown(tree), `mid-way the bg is between the tile and the screen (${k.toFixed(2)}), Home still under it`);
      h.eq([plateRect(tree).cx, plateRect(tree).side], [plate.cx, plate.side], 'the plate stays where the tile is, at its size');
      const { x, y, w, h: tall, r } = shapeOf(tree);
      const discs = shapeViews(tree).filter((n) => flat(n).bottom !== 0).map((n) => { const t = transformOf(n); return [round(t.translateX), round(t.translateY), round(t.scale * (flat(n).width as number))]; });
      h.eq(discs, [[x, y], [x + w - 2 * r, y], [x, y + tall - 2 * r], [x + w - 2 * r, y + tall - 2 * r]].map(([cx, cy]) => [round(cx), round(cy), round(2 * r)]),
        'its corners are discs of its radius, one in each corner');
      await TestRenderer.act(async () => release());
      h.eq(insetsOf(tree), FULL, 'grown, the bg is the screen');
      h.ok(!homeShown(tree), 'and Home goes once the bg covers it');
      h.ok(!pageShown(tree), 'the page stays covered until this launch paints');
      await paint(tree);
      h.ok(pageShown(tree), 'and shows once it has');
    });
  });

  await h.test('M2: the bg grows over Home only once covered; a paint during the growth does not show the page until the bg covers the screen', async () => {
    await withLauncher(async ({ tree }) => {
      const release = holdAnimations();
      await tapTile(tree, 'Timer');
      await paint(tree);
      await TestRenderer.act(async () => elapseSprings(120));
      await TestRenderer.act(async () => elapse(FADE_IN_MS));
      h.ok(shapeOf(tree).opacity === 1 && grownFrom(tree, TIMER_TILE) < 1, 'painted mid-growth, the page is still under the growing bg');
      await TestRenderer.act(async () => release());
      h.ok(pageShown(tree), 'then fades in once the bg covers the screen');
    });
  });

  await h.test('M2: the growing container is the bg in light and dark, never the tint: no frame shows the tint larger than the tile', async () => {
    try {
      for (const scheme of ['light', 'dark'] as const) {
        setColorScheme(scheme);
        await withLauncher(async ({ tree }) => {
          const release = holdAnimations();
          await tapTile(tree, 'Timer');
          const tints = new Set<unknown>([TINTS.ocean.light, TINTS.ocean.dark]);
          for (const ms of [0, 60, 160, 400]) {
            await TestRenderer.act(async () => elapseSprings(ms));
            h.eq([...new Set(shapeViews(tree).map((n) => flat(n).backgroundColor))], [COLORS[scheme].bg], `${scheme}, +${ms} ms: every view the growing shape is drawn with is the bg`);
            const filled = tree.root.findByType(MiniAppView).findAll((n) => typeof n.type === 'string' && tints.has(flat(n).backgroundColor));
            h.eq(filled.length, 0, `${scheme}, +${ms} ms: no view is filled with the tint`);
            h.ok(plateRect(tree).side <= TIMER_TILE.width, `${scheme}, +${ms} ms: the tint is the tile-sized plate`);
            h.ok(shapeViews(tree).every((n) => !flat(n).borderRadius || !('scaleX' in transformOf(n) || 'scaleY' in transformOf(n))), `${scheme}, +${ms} ms: no rounded view is scaled unevenly`);
          }
          await TestRenderer.act(async () => release());
        });
      }
    } finally {
      setColorScheme('light');
    }
  });

  await h.test('M2/M3: the WebView itself is never resized, moved or faded while the app grows, reveals, is covered and shrinks: only the bg over it moves', async () => {
    await withLauncher(async ({ tree }) => {
      const release = holdAnimations();
      await tapTile(tree, 'Timer');
      const still = webViewDrawn(tree);
      h.ok(still.length >= 2, 'the WebView and its slot are measured');
      const seen: unknown[] = [];
      for (const ms of [40, 200]) {
        await TestRenderer.act(async () => elapseSprings(ms));
        seen.push(webViewDrawn(tree));
      }
      await TestRenderer.act(async () => release());
      await paint(tree);
      seen.push(webViewDrawn(tree));
      const hold = holdAnimations();
      await press(button(tree, COPY.orbMenuOpenLabel));
      await press(button(tree, COPY.whimSheetBackToApps));
      await TestRenderer.act(async () => elapse(FADE_OUT_MS / 2));
      seen.push(webViewDrawn(tree));
      await TestRenderer.act(async () => elapse(FADE_OUT_MS));
      await TestRenderer.act(async () => elapseSprings(150));
      h.ok(homeShown(tree) && appOpen(tree), 'shrinking, the app is still drawn over Home');
      seen.push(webViewDrawn(tree));
      h.ok(seen.every((frame) => JSON.stringify(frame) === JSON.stringify(still)), `the WebView and its slot keep their layout and opacity on every frame: ${JSON.stringify(still)}`);
      await TestRenderer.act(async () => hold());
    });
  });

  await h.test('M3: leaving covers the page with the bg on fade-out before Home is drawn under it, then shrinks into the tile on smooth, the plate back on the tile, and ends the launch', async () => {
    await withLauncher(async ({ tree }) => {
      await tapTile(tree, 'Timer');
      await paint(tree);
      const web = boundWebView(tree);
      await press(button(tree, COPY.orbMenuOpenLabel));
      const from = animations.length;
      const release = holdAnimations();
      await press(button(tree, COPY.whimSheetBackToApps));
      const fade = stepsSince(from).filter((s) => s.kind === 'timing' && s.to === 1);
      h.ok(fade.length >= 1 && fade.every((s) => s.config?.duration === FADE_OUT_MS), 'the page goes under the bg on fade-out');
      h.ok(!homeShown(tree), 'with Home not drawn yet: nothing of Home shows over the page');
      await TestRenderer.act(async () => elapse(FADE_OUT_MS));
      h.ok(homeShown(tree) && shapeOf(tree).opacity === 1, 'once covered, Home is drawn under the app');
      const shrink = stepsSince(from).filter((s) => s.kind === 'spring' && s.to === 0);
      h.ok(shrink.length === 1 && isConfig(shrink[0], SMOOTH), 'and it shrinks on smooth');
      // Three frames: the plate fades in once the tile has held still on three of them.
      for (const ms of [70, 70, 60]) await TestRenderer.act(async () => elapseSprings(ms));
      const k = grownFrom(tree, TIMER_TILE);
      h.ok(k > 0 && k < 0.9, `mid-way it is between the screen and the tile (${k.toFixed(2)})`);
      await TestRenderer.act(async () => elapse(FADE_IN_MS));
      const plate = plateRect(tree);
      h.eq([plate.cx, plate.cy, plate.side, plate.opacity], [TIMER_TILE.pageX + 32 - STAGE.pageX, TIMER_TILE.pageY + 32 - STAGE.pageY, 64, 1], 'the plate is back on the tile');
      await TestRenderer.act(async () => release());
      h.ok(!appOpen(tree) && homeShown(tree), 'in the tile, the launch ends on Home');
      h.ok(!tree.root.findAll((n) => n === web).length, 'with its WebView');
    });
  });

  await h.test('M3: Home drawn afresh under the app can lay the tile out higher on its first two frames; the plate never shows anywhere but where the tile ends up, and fades in there once the tile holds still', async () => {
    await withLauncher(async ({ tree }) => {
      await tapTile(tree, 'Timer');
      await paint(tree);
      await press(button(tree, COPY.orbMenuOpenLabel));
      const release = holdAnimations();
      await press(button(tree, COPY.whimSheetBackToApps));
      // As measured on an iOS 27 simulator: the first two frames of a Home mounted afresh under an app
      // opened from History lay its grid out 108 pt higher (no status bar, no navigation bar yet).
      let lagging = 2;
      measuring.rectOf = (node) => {
        const at = placeOf(node);
        return at === TIMER_TILE && lagging > 0 ? { ...TIMER_TILE, pageY: TIMER_TILE.pageY - 108 } : at;
      };
      await TestRenderer.act(async () => elapse(FADE_OUT_MS));
      h.ok(homeShown(tree), 'covered, Home is drawn under the app');
      const onTile = TIMER_TILE.pageY + 32 - STAGE.pageY;
      const frames: { cy: number; shown: number }[] = [];
      for (let frame = 0; frame < 6; frame++) {
        await TestRenderer.act(async () => elapseSprings(16));
        await TestRenderer.act(async () => elapse(FADE_IN_MS / 6));
        const plate = plateRect(tree);
        frames.push({ cy: plate.cy, shown: plateShown(tree) });
        lagging -= 1;
      }
      h.eq(frames.filter((f) => f.shown > 0 && f.cy !== onTile), [], `no frame shows the plate off the tile: ${JSON.stringify(frames)}`);
      const last = frames.at(-1)!;
      h.ok(last.shown > 0 && last.cy === onTile, `once Home has settled, the plate shows on the tile: ${JSON.stringify(last)}`);
      await TestRenderer.act(async () => release());
      h.ok(!appOpen(tree) && homeShown(tree), 'and the launch ends on Home');
    });
  });

  await h.test('M2: back mid-open turns it round from where it is, on smooth, with no fade first; Android back at depth 0 leaves the same way', async () => {
    await withLauncher(async ({ tree }) => {
      const release = holdAnimations();
      await tapTile(tree, 'Timer');
      await TestRenderer.act(async () => elapseSprings(150));
      const before = insetsOf(tree);
      const k = grownFrom(tree, TIMER_TILE);
      const from = animations.length;
      await TestRenderer.act(async () => { hardwareBack(); });
      h.eq(insetsOf(tree), before, `back leaves the bg where it was (${k.toFixed(2)}), no jump`);
      const steps = stepsSince(from);
      h.ok(steps.some((s) => s.kind === 'spring' && s.to === 0 && isConfig(s, SMOOTH)), 'and turns it back toward the tile on smooth');
      h.ok(!steps.some((s) => s.kind === 'timing' && s.to === 1 && s.config?.duration === FADE_OUT_MS), 'with nothing to cover first: the page was never shown');
      await TestRenderer.act(async () => elapseSprings(60));
      h.ok(grownFrom(tree, TIMER_TILE) < k, 'it heads back into the tile');
      await TestRenderer.act(async () => release());
      h.ok(!appOpen(tree) && homeShown(tree), 'and the launch ends on Home');
    });
  });

  await h.test('M3: a tap on its tile mid-close turns the app back out from where it is on morph, the same launch in the same WebView', async () => {
    await withLauncher(async ({ tree }) => {
      await tapTile(tree, 'Timer');
      await paint(tree);
      const web = boundWebView(tree);
      const delivered = injectedScripts.length;
      const release = holdAnimations();
      await TestRenderer.act(async () => { hardwareBack(); });
      await TestRenderer.act(async () => elapse(FADE_OUT_MS));
      await TestRenderer.act(async () => elapseSprings(150));
      const before = insetsOf(tree);
      const k = grownFrom(tree, TIMER_TILE);
      h.ok(k > 0 && k < 1 && homeShown(tree), `mid-close (${k.toFixed(2)}) Home is under the app`);
      const from = animations.length;
      await tapTile(tree, 'Timer');
      h.eq(insetsOf(tree), before, 'the tap leaves the bg where it was');
      h.ok(stepsSince(from).some((s) => s.kind === 'spring' && s.to === 1 && isConfig(s, MORPH)), 'and turns it back out on morph');
      h.ok(boundWebView(tree) === web && injectedScripts.length === delivered, 'the same launch: its WebView kept, nothing delivered again');
      await TestRenderer.act(async () => release());
      h.ok(appOpen(tree) && !homeShown(tree), 'grown, the app covers the screen and Home goes');
      h.ok(pageShown(tree), 'and its page shows again');
      const generation = Number(/,generation:(\d+)/.exec(injectedScripts.at(-1) ?? '')?.[1]);
      const write = { kind: 'syscall', trusted: false, payload: { whim: 'syscall', v: SYSCALL_VERSION, id: 1, gen: generation, method: 'diag.echo', params: { payload: 1 } } };
      await TestRenderer.act(async () => web.props.onMessage({ nativeEvent: { data: JSON.stringify(write) } }));
      await settle();
      const replies = (web.props.injected as string[]).filter((s) => s.includes('__whimRelaySysret('));
      h.ok(replies.length === 1 && replies[0].includes('\\"ok\\":true'), `its realm was never torn down: a call after the reopen is still answered (${replies.join(' ').slice(0, 160)})`);
    });
  });

  await h.test('M3: an app turned back out while it boots still has its startup deadline: with no paint it fails to the crash screen; one that ends while it goes back in fails it only once it is back out', async () => {
    await withLauncher(async ({ tree, clock }) => {
      const { release } = await leaveWhileBooting(tree);
      h.eq(clock.count(STARTUP_DEADLINE_MS), 1, 'leaving, its startup deadline keeps running');
      await tapTile(tree, 'Timer');
      await TestRenderer.act(async () => release());
      h.ok(appOpen(tree) && !pageShown(tree) && !crashed(tree), 'turned back out, it is still booting');
      h.eq(clock.count(STARTUP_DEADLINE_MS), 1, 'with its startup deadline armed');
      await TestRenderer.act(async () => clock.fire(STARTUP_DEADLINE_MS));
      h.ok(crashed(tree), 'and with no paint, the deadline fails it to the crash screen');
    });
    await withLauncher(async ({ tree, clock }) => {
      const { release } = await leaveWhileBooting(tree);
      log.buffer.clear();
      await TestRenderer.act(async () => clock.fire(STARTUP_DEADLINE_MS));
      h.ok(appOpen(tree) && homeShown(tree) && !crashed(tree) && grownFrom(tree, TIMER_TILE) < 1, 'a deadline that ends while it goes back in leaves it going: no crash screen over Home');
      h.eq(paintTimeouts(), 0, 'and records no failure yet');
      await tapTile(tree, 'Timer');
      h.ok(crashed(tree), 'turned back out, it fails to the crash screen at once');
      h.eq(paintTimeouts(), 1, 'recorded once');
      await TestRenderer.act(async () => release());
    });
    await withLauncher(async ({ tree, clock }) => {
      const { release } = await leaveWhileBooting(tree);
      log.buffer.clear();
      await TestRenderer.act(async () => clock.fire(STARTUP_DEADLINE_MS));
      await TestRenderer.act(async () => release());
      h.ok(!appOpen(tree) && homeShown(tree) && !crashed(tree), 'left for good, it goes into its tile as any app does');
      h.eq(paintTimeouts(), 0, 'and an app the person left is not recorded as failed');
    });
  });

  await h.test('M3: an app turned back out while it boots is the same realm: a paint stamped at the generation it was delivered with opens it, and disarms the deadline', async () => {
    await withLauncher(async ({ tree, clock }) => {
      const { generation, release } = await leaveWhileBooting(tree);
      const delivered = injectedScripts.length;
      await tapTile(tree, 'Timer');
      await TestRenderer.act(async () => release());
      h.eq(injectedScripts.length, delivered, 'nothing is delivered again');
      await paintAt(tree, generation);
      await TestRenderer.act(async () => elapse(FADE_IN_MS));
      h.ok(pageShown(tree), 'the realm delivered before the close paints, and the page shows');
      h.eq(clock.count(STARTUP_DEADLINE_MS), 0, 'its paint ends the startup deadline');
    });
    await withLauncher(async ({ tree, clock }) => {
      const { generation, release } = await leaveWhileBooting(tree);
      log.buffer.clear();
      await TestRenderer.act(async () => clock.fire(STARTUP_DEADLINE_MS));
      await paintAt(tree, generation);
      await tapTile(tree, 'Timer');
      await TestRenderer.act(async () => release());
      await TestRenderer.act(async () => elapse(FADE_IN_MS));
      h.ok(pageShown(tree) && !crashed(tree), 'a paint after a deadline that ended while it went back in still opens it');
      h.eq(paintTimeouts(), 0, 'and no failure is recorded');
    });
  });

  await h.test('M3: a close that ends unmounts the realm: the next open is a new realm in a new WebView, and a paint stamped for the closed one cannot open it', async () => {
    await withLauncher(async ({ tree, clock }) => {
      await tapTile(tree, 'Timer');
      const first = await deliver(tree);
      const web = boundWebView(tree);
      const release = holdAnimations();
      await TestRenderer.act(async () => { hardwareBack(); });
      await TestRenderer.act(async () => release());
      h.ok(!appOpen(tree) && homeShown(tree), 'the close ends on Home');
      await tapTile(tree, 'Timer');
      const second = await deliver(tree);
      h.ok(boundWebView(tree) !== web, 'the next open is in another WebView');
      h.ok(second > first, `delivered at a later generation (${first} → ${second})`);
      await paintAt(tree, first);
      await TestRenderer.act(async () => elapse(FADE_IN_MS));
      h.ok(!pageShown(tree) && clock.count(STARTUP_DEADLINE_MS) === 1, 'a paint stamped for the closed realm opens nothing, and the deadline stays armed');
      await paintAt(tree, second);
      await TestRenderer.act(async () => elapse(FADE_IN_MS));
      h.ok(pageShown(tree) && clock.count(STARTUP_DEADLINE_MS) === 0, 'the new realm’s own paint does');
    });
  });

  await h.test('M2/M3 under Reduce Motion: the bg keeps the screen’s size and cross-fades over Home in 160 ms, in and out, and no spring runs; with motion, the same moments spring', async () => {
    for (const reduced of [false, true]) {
      await withLauncher(async ({ tree }) => {
        const from = animations.length;
        const release = holdAnimations();
        await tapTile(tree, 'Timer');
        const opening = { insets: insetsOf(tree), opacity: shapeOf(tree).opacity };
        await TestRenderer.act(async () => release());
        const opened = stepsSince(from);
        await paint(tree);
        await press(button(tree, COPY.orbMenuOpenLabel));
        const leaving = animations.length;
        await press(button(tree, COPY.whimSheetBackToApps));
        h.ok(!appOpen(tree) && homeShown(tree), `${reduced ? 'reduced' : 'motion'}: open and closed, Home again`);
        const steps = [...opened, ...stepsSince(leaving)];
        // The open's growth, and the close's shrink (the sheet over the app leaves downward, never to 0).
        const springs = [...opened.filter((s) => s.kind === 'spring' && s.to === 1 && isConfig(s, MORPH)), ...stepsSince(leaving).filter((s) => s.kind === 'spring' && s.to === 0 && isConfig(s, SMOOTH))];
        if (reduced) {
          h.eq(opening, { insets: FULL, opacity: 0 }, 'reduced: the bg is the screen from the start, unseen, and fades in');
          h.eq(springs.length, 0, 'reduced: no morph or smooth spring');
          const fades = steps.filter((s) => s.kind === 'timing');
          h.ok(fades.length > 0 && fades.every((s) => s.config?.reduceMotion === ReduceMotion.Never), 'reduced: every fade is played, not skipped by the system setting');
          h.ok(fades.some((s) => s.to === 1 && s.config?.duration === FADE_IN_MS), 'reduced: the cross-fade in takes 160 ms');
        } else {
          h.eq(opening, { insets: insetsAt(TIMER_TILE), opacity: 1 }, 'motion: the bg sets out on the tile');
          h.eq(springs.map((s) => s.to), [1, 0], 'motion: it grows on a spring and shrinks on one');
        }
      }, reduced);
    }
  });

  await h.test('M3 under Reduce Motion: going back is the cross-fade alone; the plate never shows on the tile, however long the tile holds still', async () => {
    await withLauncher(async ({ tree }) => {
      await tapTile(tree, 'Timer');
      await paint(tree);
      await press(button(tree, COPY.orbMenuOpenLabel));
      const release = holdAnimations();
      await press(button(tree, COPY.whimSheetBackToApps));
      await TestRenderer.act(async () => elapse(FADE_OUT_MS));
      h.ok(homeShown(tree) && appOpen(tree), 'covered, Home is drawn under the app, which fades');
      const shown: number[] = [];
      for (let frame = 0; frame < 6; frame++) {
        await TestRenderer.act(async () => elapse(FADE_IN_MS / 8));
        shown.push(plateShown(tree));
      }
      h.eq(shown.filter((o) => o > 0), [], `no frame of the fade shows the plate: ${JSON.stringify(shown)}`);
      await TestRenderer.act(async () => release());
      h.ok(!appOpen(tree) && homeShown(tree), 'and the launch ends on Home');
    }, true);
  });

  await h.test('M2: a tile tapped during History’s pop to Home grows only once the pop has finished, over the same Home, and no stack is unmounted mid-move', async () => {
    await withLauncher(async ({ tree }) => {
      await TestRenderer.act(async () => tree.root.findByType(HomeScreen).props.onHistory(timer));
      await waitFor(() => tree.root.findAllByType(HistoryScreen).length === 1, 'History');
      await stackMoveEnds();
      const midMove = stackUnmountsMidMove();
      await TestRenderer.act(async () => button(tree, COPY.backLabel).props.onPress());
      await settle();
      const release = holdAnimations();
      await tapTile(tree, 'Dice');
      h.ok(!appOpen(tree), 'the tap waits while the pop runs');
      await stackMoveEnds();
      await waitFor(() => appOpen(tree), 'the app once the pop finished');
      h.eq(insetsOf(tree), insetsAt(DICE_TILE), 'it grows out of the tapped tile');
      h.ok(homeShown(tree), 'over Home, still drawn under it');
      h.eq(stackUnmountsMidMove(), midMove, 'no stack was unmounted while the pop ran');
      await TestRenderer.act(async () => release());
      h.ok(!homeShown(tree), 'Home goes once the app covers the screen');
      h.eq(stackUnmountsMidMove(), midMove, 'and no stack was unmounted mid-move then either');
    });
  });

  await h.test('M2/M3: while Home is drawn under the app, a touch inside its bg lands on the app on every frame, never on Home: coming out it does nothing, going back in it turns the app back out', async () => {
    await withLauncher(async ({ tree }) => {
      const release = holdAnimations();
      await tapTile(tree, 'Timer');
      const growing: string[] = [];
      for (let frame = 0; frame < 4; frame++) {
        await TestRenderer.act(async () => elapseSprings(50));
        const at = touchAt(tree, ...shapeCentre(tree));
        const shape = shapeOf(tree);
        const spansBg = at !== 'home' && JSON.stringify(Object.values(drawnRect(at)).map(round)) === JSON.stringify([shape.x, shape.y, shape.w, shape.h].map(round));
        if (at === 'home') growing.push('home');
        else growing.push(spansBg ? 'app' : 'app, off the bg');
      }
      h.ok(homeShown(tree) && grownFrom(tree, TIMER_TILE) < 1, 'mid-open, over Home');
      h.eq(growing, ['app', 'app', 'app', 'app'], 'coming out, a touch inside the bg lands on the app, which spans the bg as drawn');
      const from = animations.length;
      const inside = touchAt(tree, ...shapeCentre(tree)) as Node;
      await TestRenderer.act(async () => inside.props.onResponderRelease());
      h.ok(stepsSince(from).length === 0 && appOpen(tree) && homeShown(tree), 'and does nothing: it goes on growing');
      await TestRenderer.act(async () => release());
      await paint(tree);
      const web = boundWebView(tree);
      const held = holdAnimations();
      await shrinkTo(tree, 0.6);
      const k = grownFrom(tree, TIMER_TILE);
      h.ok(homeShown(tree) && k > 0 && k < 1, `mid-close (${k.toFixed(2)}), over Home`);
      const back = touchAt(tree, ...shapeCentre(tree));
      h.ok(back !== 'home', 'going back in, a touch inside the bg lands on the app');
      const before = insetsOf(tree);
      const turned = animations.length;
      await TestRenderer.act(async () => (back as Node).props.onResponderRelease());
      h.eq(insetsOf(tree), before, 'the touch leaves the bg where it was');
      h.ok(stepsSince(turned).some((st) => st.kind === 'spring' && st.to === 1 && isConfig(st, MORPH)), 'and turns it back out on morph');
      await TestRenderer.act(async () => held());
      h.ok(appOpen(tree) && !homeShown(tree) && boundWebView(tree) === web, 'the same launch covers the screen again');
    });
  });

  await h.test('M3: a touch on Home where the shrinking bg is not drawn reaches Home: a tile tapped there opens its app, the closing one torn down, its answer still in flight dropped, the new one at a later generation', async () => {
    await withLauncher(async ({ tree }) => {
      await tapTile(tree, 'Timer');
      await paint(tree);
      const first = deliveredGeneration();
      const release = holdAnimations();
      await shrinkTo(tree, 0.3);
      const diceCentre = [DICE_TILE.pageX + DICE_TILE.width / 2, DICE_TILE.pageY + DICE_TILE.height / 2 - STAGE.pageY] as const;
      h.ok(touchAt(tree, ...diceCentre) === 'home', `the Dice tile, outside the bg (${JSON.stringify(shapeOf(tree))}), takes the touch`);
      const answers = holdSyscalls();
      try {
        await TestRenderer.act(async () => boundWebView(tree).props.onMessage({ nativeEvent: { data: syscallAt(first, 7) } }));
        const before = relayed();
        await tapTile(tree, 'Dice');
        await waitFor(() => appOpen(tree) && tree.root.findByType(MiniAppView).props.installedApp.id === 'dice', 'Dice open');
        const second = await deliver(tree);
        h.ok(second > first, `Dice is a new realm at a later generation (${first} → ${second})`);
        h.eq(insetsOf(tree), insetsAt(DICE_TILE), 'growing out of its tile');
        answers();
        await settle();
        h.eq(relayed(), before, 'the closing app’s call, answered after it was torn down, reaches no WebView');
        await TestRenderer.act(async () => release());
        h.ok(appOpen(tree) && tree.root.findByType(MiniAppView).props.installedApp.id === 'dice', 'and the closing app’s shrink, ending after, ends nothing: Dice stays open');
      } finally {
        answers();
        await TestRenderer.act(async () => release());
      }
    });
  });

  await h.test('M3: a call the app makes while it goes back into its tile, answered once the close has ended, reaches no WebView', async () => {
    await withLauncher(async ({ tree }) => {
      await tapTile(tree, 'Timer');
      await paint(tree);
      const generation = deliveredGeneration();
      const web = boundWebView(tree);
      const release = holdAnimations();
      await shrinkTo(tree, 0.6);
      const answers = holdSyscalls();
      try {
        const before = relayed();
        await TestRenderer.act(async () => web.props.onMessage({ nativeEvent: { data: syscallAt(generation, 9) } }));
        await TestRenderer.act(async () => release());
        h.ok(!appOpen(tree) && homeShown(tree), 'the close ends on Home');
        answers();
        await settle();
        h.eq(relayed(), before, 'no answer is relayed');
      } finally {
        answers();
      }
    });
  });

  await h.test('M3: a Reload whose bundle is read while the app goes back into its tile opens nothing: the close goes on and ends on Home', async () => {
    await withLauncher(async ({ tree }) => {
      await tapTile(tree, 'Timer');
      await paint(tree);
      const { tappedAt } = tree.root.findByType(MiniAppView).props;
      const answer = holdReads();
      await TestRenderer.act(async () => tree.root.findByType(MiniAppView).props.onReload());
      const release = holdAnimations();
      await shrinkTo(tree, 0.6);
      await answer('timer');
      const still = tree.root.findByType(MiniAppView).props;
      h.ok(still.tappedAt === tappedAt && still.morph.leaving === true, 'the read lands while the same launch goes on going back in');
      await TestRenderer.act(async () => release());
      await settle();
      h.ok(!appOpen(tree) && homeShown(tree), 'and the close ends on Home, nothing reopened');
    });
  });

  await h.test('M2/M3: the orb, faded while the app comes out and from the moment it leaves, takes no touch and is out of the accessibility tree', async () => {
    await withLauncher(async ({ tree }) => {
      const release = holdAnimations();
      await tapTile(tree, 'Timer');
      await TestRenderer.act(async () => elapseSprings(150));
      h.eq(orbReach(tree), { touch: false, a11y: false }, 'coming out, before it covers the screen');
      await h.throws(() => press(button(tree, COPY.orbMenuOpenLabel)), 'Cannot press a disabled control', 'a tap where it is drawn does nothing');
      await TestRenderer.act(async () => release());
      await paint(tree);
      h.eq(orbReach(tree), { touch: true, a11y: true }, 'once the app covers the screen, it is there');
      holdAnimations();
      await TestRenderer.act(async () => { hardwareBack(); });
      h.eq(orbReach(tree), { touch: false, a11y: false }, 'leaving, it is gone at once');
    });
  });

  await h.test('M2: of two tiles tapped quickly, the later tap’s app shows, growing out of its tile over Home; the earlier read landing after it, or once an app covers Home, opens nothing', async () => {
    await withLauncher(async ({ tree }) => {
      const answer = holdReads();
      const release = holdAnimations();
      await tapTile(tree, 'Timer');
      await tapTile(tree, 'Dice');
      await answer('dice');
      await answer('timer');
      const shown = tree.root.findByType(MiniAppView).props;
      h.eq(shown.installedApp.id, 'dice', 'the later tap’s app shows');
      h.ok(shown.morph.homeUnder === true && homeShown(tree), 'over Home');
      h.eq(insetsOf(tree), insetsAt(DICE_TILE), 'growing out of its own tile');
      await TestRenderer.act(async () => release());
      await paint(tree);
      await TestRenderer.act(async () => { hardwareBack(); });
      await settle();
      h.ok(!appOpen(tree) && homeShown(tree), 'closed again');
      const grow = holdAnimations();
      await tapTile(tree, 'Timer');
      await tapTile(tree, 'Dice');
      await answer('timer');
      await TestRenderer.act(async () => grow());
      h.ok(!homeShown(tree) && tree.root.findByType(MiniAppView).props.installedApp.id === 'timer', 'the earlier tap’s app landed first and covers Home');
      await answer('dice');
      h.eq(tree.root.findByType(MiniAppView).props.installedApp.id, 'timer', 'the later read, landing once Home has gone, opens nothing');
    });
  });
}
