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
const leaf = (tree: Tree) => tree.root.findByType(MiniAppView).findAll((n) => hostType(n) === 'Animated.View' && n.children.length === 0 && flat(n).position === 'absolute' && 'borderRadius' in flat(n))[0];
const insetsOf = (node: Node) => { const s = flat(node); return { top: s.top, left: s.left, right: s.right, bottom: s.bottom }; };
/** Where `tile` is, as insets in the stage. */
const insetsAt = (tile: Rect) => ({ top: tile.pageY - STAGE.pageY, left: tile.pageX, right: STAGE.width - tile.pageX - tile.width, bottom: STAGE.pageY + STAGE.height - tile.pageY - tile.height });
const FULL = { top: 0, left: 0, right: 0, bottom: 0 };
/** How far the `bg` has grown from `tile` (0) to the stage (1), read off its left inset. */
const grownFrom = (tree: Tree, tile: Rect) => 1 - (flat(leaf(tree)).left as number) / tile.pageX;
/** The app's plate: the view that places the opening's tile-sized plate. */
const plateBox = (tree: Tree) => tree.root.findByType(MiniAppView).findByType(TilePlate).parent!;
/** Where the plate is drawn in the stage: its centre and side, from its centred place and its move. */
function plateRect(tree: Tree) {
  const t = Object.assign({}, ...((flat(plateBox(tree)).transform as Record<string, number>[] | undefined) ?? [])) as Record<string, number>;
  const side = TILE_SIDE.grid * (t.scale ?? 1);
  return { cx: STAGE.width / 2 + (t.translateX ?? 0), cy: STAGE.height / 2 + (t.translateY ?? 0), side, opacity: flat(plateBox(tree)).opacity };
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
const isConfig = (step: Step, config: Record<string, unknown>) => Object.entries(config).every(([k, v]) => step.config?.[k] === v);

async function paint(tree: Tree): Promise<void> {
  await TestRenderer.act(async () => boundWebView(tree).props.onLoadEnd());
  const generation = Number(/,generation:(\d+)/.exec(injectedScripts.at(-1) ?? '')?.[1]);
  const frame = { kind: 'paint', trusted: true, payload: { generation, mountToFirstPaintMs: 12, appName: 'Timer' } };
  await TestRenderer.act(async () => boundWebView(tree).props.onMessage({ nativeEvent: { data: JSON.stringify(frame) } }));
}
/** The page shows: the `bg` over it is fully faded. */
const pageShown = (tree: Tree) => flat(leaf(tree)).opacity === 0;

export async function runAppMorphUiTests(h: Harness): Promise<void> {
  await h.test('M2: a tapped tile’s app grows its bg from that tile’s measured rect to the screen on morph, the plate stays on the tile, and Home stays under it until the bg covers the screen', async () => {
    await withLauncher(async ({ tree }) => {
      const from = animations.length;
      const release = holdAnimations();
      await tapTile(tree, 'Timer');
      h.ok(appOpen(tree) && homeShown(tree), 'the app opens over Home, which stays drawn under it');
      h.eq(insetsOf(leaf(tree)), insetsAt(TIMER_TILE), 'the bg sets out exactly on the tapped tile (the second tile, not the first)');
      h.eq(flat(leaf(tree)).borderRadius, TILE.corner * TIMER_TILE.width, 'with the tile’s corners');
      const plate = plateRect(tree);
      h.eq([plate.cx, plate.cy, plate.side], [TIMER_TILE.pageX + 32 - STAGE.pageX, TIMER_TILE.pageY + 32 - STAGE.pageY, 64], 'the tint plate sits on the tile at its size');
      const grow = stepsSince(from).filter((s) => s.kind === 'spring' && isConfig(s, MORPH));
      h.ok(grow.length === 1 && grow[0].to === 1, 'it grows on morph');
      await TestRenderer.act(async () => elapseSprings(160));
      const k = grownFrom(tree, TIMER_TILE);
      h.ok(k > 0.2 && k < 1 && homeShown(tree), `mid-way the bg is between the tile and the screen (${k.toFixed(2)}), Home still under it`);
      h.eq([plateRect(tree).cx, plateRect(tree).side], [plate.cx, plate.side], 'the plate stays where the tile is, at its size');
      await TestRenderer.act(async () => release());
      h.eq(insetsOf(leaf(tree)), FULL, 'grown, the bg is the screen');
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
      h.ok(flat(leaf(tree)).opacity === 1 && grownFrom(tree, TIMER_TILE) < 1, 'painted mid-growth, the page is still under the growing bg');
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
            h.eq(flat(leaf(tree)).backgroundColor, COLORS[scheme].bg, `${scheme}, +${ms} ms: the growing view is the bg`);
            const filled = tree.root.findByType(MiniAppView).findAll((n) => typeof n.type === 'string' && tints.has(flat(n).backgroundColor));
            h.eq(filled.length, 0, `${scheme}, +${ms} ms: no view is filled with the tint`);
            h.ok(plateRect(tree).side <= TIMER_TILE.width, `${scheme}, +${ms} ms: the tint is the tile-sized plate`);
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
      h.ok(homeShown(tree) && flat(leaf(tree)).opacity === 1, 'once covered, Home is drawn under the app');
      const shrink = stepsSince(from).filter((s) => s.kind === 'spring' && s.to === 0);
      h.ok(shrink.length === 1 && isConfig(shrink[0], SMOOTH), 'and it shrinks on smooth');
      await TestRenderer.act(async () => elapseSprings(200));
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

  await h.test('M2: back mid-open turns it round from where it is, on smooth, with no fade first; Android back at depth 0 leaves the same way', async () => {
    await withLauncher(async ({ tree }) => {
      const release = holdAnimations();
      await tapTile(tree, 'Timer');
      await TestRenderer.act(async () => elapseSprings(150));
      const before = insetsOf(leaf(tree));
      const k = grownFrom(tree, TIMER_TILE);
      const from = animations.length;
      await TestRenderer.act(async () => { hardwareBack(); });
      h.eq(insetsOf(leaf(tree)), before, `back leaves the bg where it was (${k.toFixed(2)}), no jump`);
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
      const before = insetsOf(leaf(tree));
      const k = grownFrom(tree, TIMER_TILE);
      h.ok(k > 0 && k < 1 && homeShown(tree), `mid-close (${k.toFixed(2)}) Home is under the app`);
      const from = animations.length;
      await tapTile(tree, 'Timer');
      h.eq(insetsOf(leaf(tree)), before, 'the tap leaves the bg where it was');
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

  await h.test('M2/M3 under Reduce Motion: the bg keeps the screen’s size and cross-fades over Home in 160 ms, in and out, and no spring runs; with motion, the same moments spring', async () => {
    for (const reduced of [false, true]) {
      await withLauncher(async ({ tree }) => {
        const from = animations.length;
        const release = holdAnimations();
        await tapTile(tree, 'Timer');
        const opening = { insets: insetsOf(leaf(tree)), opacity: flat(leaf(tree)).opacity };
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
      h.eq(insetsOf(leaf(tree)), insetsAt(DICE_TILE), 'it grows out of the tapped tile');
      h.ok(homeShown(tree), 'over Home, still drawn under it');
      h.eq(stackUnmountsMidMove(), midMove, 'no stack was unmounted while the pop ran');
      await TestRenderer.act(async () => release());
      h.ok(!homeShown(tree), 'Home goes once the app covers the screen');
      h.eq(stackUnmountsMidMove(), midMove, 'and no stack was unmounted mid-move then either');
    });
  });
}
