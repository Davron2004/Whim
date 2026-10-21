/** The Ready page's moment (system.md §4.4 M10) with its Reduce Motion pair (§4.5): delivered with the
 *  sheet open, the ember flares on spark and settles into the 96 tile rising from 0.6; the name, the
 *  words and the buttons fade in 80 ms apart, text never moving; Done jumps to the end. In the making
 *  sheet the Making page's ember travels to the tile's place first (`TravelLayer`), and closing the
 *  sheet ends the moment. What the page shows is `flow-screens-ui.suite.tsx`. */
import fs from 'node:fs';
import path from 'node:path';
import React, { useState } from 'react';
import TestRenderer from 'react-test-renderer';
import { Harness } from './harness';
import { COPY } from '../copy';
import type { InstalledApp } from '../app-index';
import ReadyPage from '../ReadyPage';
import MakingPage from '../MakingPage';
import { MakingSheet } from '../MakingSheet';
import { TilePlate } from '../../ui/AppTile';
import { TILE_SIDE } from '../../ui/AppTile-geometry';
import { Ember } from '../../ui/Ember';
import { useTokens } from '../../ui/tokens';
import { READY_RISE_FROM, READY_STAGGER_MS, SPARK_PEAK, springConfig, springReachMs, timingOf } from '../../ui/tokens-pure';
import { StyleSheet, accessibilitySettings, emitAccessibility } from './native-host';
import { animations, elapseSprings, holdAnimations, isStep, measuring, ReduceMotion, type Animation } from './native-reanimated';
import { button, hostType, press, renderScreen, textOf, unmountScreen } from './react-screen';
import { hasInstalled, resultEvent, waitFor, withLauncher, type sseStream } from './rendered-launcher';
import { startBuild, streamingServer } from './prompt-flow-ui.suite';

type Tree = TestRenderer.ReactTestRenderer;
type Node = TestRenderer.ReactTestInstance;
type Style = Record<string, unknown>;
const flat = (node: Node): Style => (StyleSheet.flatten(node.props.style) ?? {}) as Style;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

const SPARK = springConfig('spark');
const FADE_IN = timingOf('fadeIn');
/** When the ember settles: once its flare has covered 95% of its way to the peak, the time
 *  system.md's table gives the spark spring (checked against the table in `home-motion-ui.suite`). */
const SETTLE = springReachMs('spark', 0.95);

const APP: InstalledApp = { id: 'tea', name: 'Tea Timer', createdAt: 1, lineageId: 'main', record: { appId: 'tea', name: 'Tea Timer', manifest: { capabilities: [] } } };
const WORDS = 'A tea timer that rings';

/** The phone's Reduce Motion, as the OS reports it to a running app. */
async function reduceMotion(on: boolean): Promise<void> {
  accessibilitySettings.reduceMotion = on;
  await TestRenderer.act(async () => emitAccessibility('reduceMotionChanged', on));
}

/** The sheet's page slot: nothing until the delivery lands, then the Ready page. It follows the
 *  phone's settings from before, as the shell does. */
function Slot({ ready, acted }: Readonly<{ ready: boolean; acted: string[] }>) {
  useTokens();
  return ready ? <ReadyPage app={APP} words={WORDS} changed={false} onOpen={() => acted.push('open')} onDone={() => acted.push('done')} /> : null;
}

/** The Ready page as the delivery lands (with Reduce Motion `reduced` on the phone), its motion held
 *  at its first frame; resolves the tree, what Open it and Done did, and the release. */
async function deliver(reduced = false): Promise<{ tree: Tree; acted: string[]; release: () => void }> {
  const acted: string[] = [];
  const tree = await renderScreen(<Slot ready={false} acted={acted} />);
  await reduceMotion(reduced);
  animations.splice(0);
  const release = holdAnimations();
  await TestRenderer.act(async () => tree.update(<Slot ready acted={acted} />));
  return { tree, acted, release };
}
const run = (fn: () => void) => TestRenderer.act(async () => { fn(); });

/** How a node is drawn: every view above it fades and moves it. */
function seen(node: Node) {
  let opacity = 1;
  let scale = 1;
  let moved = false;
  for (let up: Node | null = node; up; up = up.parent) {
    if (typeof up.type !== 'string') continue;
    const style = flat(up);
    opacity *= (style.opacity as number | undefined) ?? 1;
    for (const step of (style.transform as Record<string, number>[] | undefined) ?? []) {
      if ('scale' in step) scale *= step.scale;
      if (('translateX' in step && step.translateX !== 0) || ('translateY' in step && step.translateY !== 0)) moved = true;
    }
  }
  return { opacity, scale, moved };
}
const tileOn = (tree: Tree) => tree.root.findByType(TilePlate);
const embers = (tree: Tree) => tree.root.findAll((n) => hostType(n) === 'RadialGradient' && n.props.cy === '74%');
const textNode = (tree: Tree, text: string) => tree.root.findAll((n) => hostType(n) === 'Text' && textOf(n) === text)[0];
/** The page's words in the order M10 fades them in: the name, the words with the line under them, the buttons. */
const TEXTS = [APP.name, `“${WORDS}”`, COPY.readyOnHome, COPY.readyOpen, COPY.readyDone];
const textsSeen = (tree: Tree) => TEXTS.map((text) => seen(textNode(tree, text)));
/** `node` is `ancestor` or under it. */
function inside(node: Node, ancestor: Node): boolean {
  for (let up: Node | null = node; up; up = up.parent) if (up === ancestor) return true;
  return false;
}

const isSpark = (a: Animation) =>
  a.kind === 'sequence' && a.animations.length === 2 && a.animations.every((s, i) => isStep(s) && s.kind === 'spring' && s.to === [SPARK_PEAK, 1][i] && same(s.config, SPARK));
const isFadeIn = (a: Animation, reduced: boolean) =>
  a.kind === 'timing' && a.to === 1 && same(a.config, { duration: FADE_IN.duration, easing: { bezier: FADE_IN.bezier }, ...(reduced ? { reduceMotion: ReduceMotion.Never } : {}) });
/** The springs on `spark` toward 1 assigned since the log was cleared, with the delay each waits. */
const sparkRises = () => animations.flatMap((a) => {
  const inner = a.kind === 'delay' ? a.animation : a;
  return inner.kind === 'spring' && inner.to === 1 && same(inner.config, SPARK) ? [a.kind === 'delay' ? a.delay : 0] : [];
});
/** The fade-ins assigned since the log was cleared, with the delay each waits. */
const fadeIns = (reduced: boolean) => animations.flatMap((a) => {
  const inner = a.kind === 'delay' ? a.animation : a;
  return isFadeIn(inner, reduced) ? [a.kind === 'delay' ? a.delay : 0] : [];
});


// ── The ember's travel from the Making page (TravelLayer) ─────────────────────

const MORPH = springConfig('morph');
type Rect = { x: number; y: number; width: number; height: number; pageX: number; pageY: number };
/** Where the Making page's 128 ember, the Ready page's 96 tile and the sheet's travel layer are drawn. */
const SOURCE: Rect = { x: 0, y: 0, width: 128, height: 128, pageX: 136, pageY: 120 };
const TARGET: Rect = { x: 0, y: 0, width: 96, height: 96, pageX: 152, pageY: 200 };
const LAYER: Rect = { x: 0, y: 0, width: 400, height: 800, pageX: 0, pageY: 10 };
const places = { source: SOURCE, target: TARGET, layer: LAYER };

/** Every host view's ref holds its element, so `measure` can tell the three places apart. */
const nodeMock = (element: React.ReactElement) => ({ element });
function placeOf(node: unknown): Rect | undefined {
  const { props } = (node as { element: React.ReactElement<Record<string, unknown>> }).element;
  if (props.pointerEvents === 'none' && props.collapsable === false) return places.layer;
  const child = props.children;
  if (React.isValidElement<{ size?: number }>(child) && child.type === Ember && child.props.size === 128) return places.source;
  if ((StyleSheet.flatten(props.style) ?? {}).width === TILE_SIDE.hero) return places.target;
  return undefined;
}

/** The making sheet on the Making page, then on Ready once the delivery lands; its close closes it. */
function Flow({ ready, acted }: Readonly<{ ready: boolean; acted: string[] }>) {
  useTokens();
  const [open, setOpen] = useState(true);
  const node = ready ? (
    <ReadyPage app={APP} words={WORDS} changed={false} onOpen={() => acted.push('open')} onDone={() => acted.push('done')} />
  ) : (
    <MakingPage name={APP.name} changing={false} words={WORDS} stage={null} delivering signals={null} now={0} activity={0.5} onStop={() => {}} />
  );
  return <MakingSheet content={open ? { key: 'run:tea', node } : null} onClose={() => { acted.push('close'); setOpen(false); }} />;
}

/** The making sheet open on Making (Reduce Motion `reduced`), then the delivery landing with motion
 *  held at its first frame. */
async function land(reduced = false): Promise<{ tree: Tree; acted: string[]; release: () => void }> {
  places.source = SOURCE;
  places.target = TARGET;
  measuring.rectOf = placeOf;
  const acted: string[] = [];
  const tree = await renderScreen(<Flow ready={false} acted={acted} />, { createNodeMock: nodeMock });
  await reduceMotion(reduced);
  animations.splice(0);
  const release = holdAnimations();
  await TestRenderer.act(async () => tree.update(<Flow ready acted={acted} />));
  return { tree, acted, release };
}
async function leave(tree: Tree, release: () => void): Promise<void> {
  await run(release);
  await reduceMotion(false);
  await unmountScreen(tree);
  measuring.rectOf = null;
}

/** The travelling element as the layer draws it: where it is moved to and how it is scaled. */
function flying(tree: Tree) {
  const views = tree.root.findAll((n) => hostType(n) === 'Animated.View' && ((flat(n).transform as Style[] | undefined) ?? []).some((step) => 'translateX' in step));
  if (views.length === 0) return null;
  const style = flat(views[0]);
  const steps = style.transform as Record<string, number>[];
  const at = Object.assign({}, ...steps) as Record<string, number>;
  return { opacity: style.opacity as number, x: at.translateX, y: at.translateY, scale: at.scale, steps: steps.flatMap((step) => Object.keys(step)), node: views[0] };
}
/** The embers a person sees. */
const seenEmbers = (tree: Tree) => embers(tree).filter((ember) => seen(ember).opacity > 0);
/** Where the element's centre is, in the layer, at progress `p` between two places. */
const centre = (from: Rect, to: Rect, p: number) => ({
  x: from.pageX + from.width / 2 + (to.pageX + to.width / 2 - from.pageX - from.width / 2) * p - LAYER.pageX,
  y: from.pageY + from.height / 2 + (to.pageY + to.height / 2 - from.pageY - from.height / 2) * p - LAYER.pageY,
});
/** The progress a uniform scale from 128 to 96 stands for. */
const progressOf = (scale: number) => (scale - SOURCE.width / TARGET.width) / (1 - SOURCE.width / TARGET.width);
const close = (a: number, b: number) => Math.abs(a - b) < 1e-6;
const travels = () => animations.filter((a) => isStep(a) && a.kind === 'spring' && a.to === 1 && same(a.config, MORPH));

export async function runReadyMotionUiTests(h: Harness): Promise<void> {
  await h.test('M10: delivered with the sheet open, the ember flares 1 → 1.18 → 1 on spark, and once the flare has reached its peak it settles into the 96 tile, which rises from 0.6 to 1 on spark', async () => {
    const { tree, release } = await deliver();
    try {
      h.ok(animations.some(isSpark), 'the ember flares to the peak and back on spark');
      h.eq(embers(tree).length, 1, 'over the tile’s place, one ember');
      h.eq(seen(embers(tree)[0]).opacity, 1, 'whole while it flares');
      const tile = seen(tileOn(tree));
      h.eq([tile.opacity, tile.scale], [0, READY_RISE_FROM], 'the tile waits unseen at 0.6');
      h.eq(sparkRises(), [SETTLE], 'it rises on spark once the flare has covered 95% of its way to the peak');
    } finally { await run(release); }
    try {
      const tile = seen(tileOn(tree));
      h.eq([tile.opacity, tile.scale], [1, 1], 'risen: the tile is whole at its size');
      h.eq(embers(tree).length, 0, 'and the ember has gone into it');
    } finally { await unmountScreen(tree); }
  });

  await h.test('M10: the name, the words and the buttons fade in on fade-in 80 ms apart as the ember settles; text only fades, it never moves', async () => {
    const { tree, release } = await deliver();
    try {
      h.ok(textsSeen(tree).every((t) => t.opacity === 0), 'held at the first frame, no text is seen yet');
      h.eq(fadeIns(false), [SETTLE, SETTLE + READY_STAGGER_MS, SETTLE + 2 * READY_STAGGER_MS], 'three fades, 80 ms apart, from when the ember settles');
      h.ok(textsSeen(tree).every((t) => !t.moved && t.scale === 1), 'no text is moved or scaled on its way in');
    } finally { await run(release); }
    try {
      h.ok(textsSeen(tree).every((t) => same(t, { opacity: 1, scale: 1, moved: false })), 'faded in, every text is whole in its place');
    } finally { await unmountScreen(tree); }
  });

  await h.test('M10: the name fades on its own, the words with the line under them, and the two buttons together', async () => {
    const { tree, release } = await deliver();
    try {
      const order = TEXTS.map((text) => {
        let up: Node | null = textNode(tree, text);
        while (up && !(typeof up.type === 'string' && flat(up).opacity === 0)) up = up.parent;
        return up;
      });
      h.ok(order.every((n) => n !== null), 'each text sits under a view that holds it unseen');
      h.eq(order[0] === order[1], false, 'the name fades on its own');
      h.eq([order[1] === order[2], order[2] === order[3]], [true, false], 'the words and their line fade together, apart from the buttons');
      h.eq(order[3] === order[4], true, 'and the two buttons together');
    } finally { await run(release); await unmountScreen(tree); }
  });

  await h.test('M10: Done jumps to the end — a tap mid-flare shows the tile, the words and the buttons whole at once, and still goes home', async () => {
    const { tree, acted, release } = await deliver();
    try {
      h.eq(seen(tileOn(tree)).opacity, 0, 'mid-moment');
      await press(button(tree, COPY.readyDone));
      const tile = seen(tileOn(tree));
      h.eq([tile.opacity, tile.scale, embers(tree).length], [1, 1, 0], 'the tap shows the tile whole and the ember gone');
      h.ok(textsSeen(tree).every((t) => t.opacity === 1), 'every text whole');
      h.eq(acted, ['done'], 'and Done went home');
    } finally { await run(release); await unmountScreen(tree); }
  });

  await h.test('M10: Open it mid-flare also ends the moment at once and opens the app', async () => {
    const { tree, acted, release } = await deliver();
    try {
      await press(button(tree, COPY.readyOpen));
      h.eq([seen(tileOn(tree)).opacity, embers(tree).length], [1, 0], 'the tile whole, the ember gone');
      h.eq(acted, ['open'], 'and the app opens');
    } finally { await run(release); await unmountScreen(tree); }
  });

  await h.test('M10 under Reduce Motion (pair): off, a flare, a rise and a stagger; on, no flare and no rise — the ember cross-fades into the whole tile over fade-in as everything fades in with it', async () => {
    const play = async (on: boolean) => {
      const { tree, release } = await deliver(on);
      try {
        const tile = seen(tileOn(tree));
        return {
          flare: animations.some(isSpark),
          rises: sparkRises().length,
          waits: animations.flatMap((a) => (a.kind === 'delay' ? [a.delay] : [])),
          ember: embers(tree).length === 1 ? seen(embers(tree)[0]).opacity : null,
          tile: [tile.opacity, tile.scale],
          texts: textsSeen(tree).map((t) => t.opacity),
          plainFades: fadeIns(false).length,
        };
      } finally {
        await run(release);
        await reduceMotion(false);
        await unmountScreen(tree);
      }
    };
    const unseen = TEXTS.map(() => 0);
    h.eq(
      await play(false),
      { flare: true, rises: 1, waits: [SETTLE, SETTLE, SETTLE + READY_STAGGER_MS, SETTLE + 2 * READY_STAGGER_MS], ember: 1, tile: [0, READY_RISE_FROM], texts: unseen, plainFades: 3 },
      'off: the flare, the tile rising from 0.6 once it peaks and the words 80 ms apart after it',
    );
    h.eq(
      await play(true),
      { flare: false, rises: 0, waits: [], ember: 1, tile: [0, 1], texts: unseen, plainFades: 0 },
      'on: the ember and the whole tile cross-fade, the words fading in with them, every fade the reduced one the root ReducedMotionConfig plays; nothing flares, rises or waits',
    );
  });

  await h.test('Making → Ready: one ember travels on morph from where the Making page draws its 128 to the tile’s place, scaled uniformly 128 → 96, and only it is seen on the way', async () => {
    const { tree, release } = await land();
    try {
      h.eq(travels().length, 1, 'one travel, on the morph spring');
      const start = flying(tree);
      h.ok(start !== null, 'the layer draws the travelling ember');
      const at = centre(SOURCE, TARGET, 0);
      h.eq([start!.x + TARGET.width / 2, start!.y + TARGET.height / 2, start!.scale, start!.opacity], [at.x, at.y, SOURCE.width / TARGET.width, 1], 'it sets out over the Making page’s ember, at its size');
      h.eq(start!.steps, ['translateX', 'translateY', 'scale'], 'a move and one uniform scale: never a width and a height of their own');
      h.eq(seenEmbers(tree).length, 1, 'one ember seen: the Making page’s and the tile’s own are hidden');
      h.ok(inside(seenEmbers(tree)[0], start!.node), 'and it is the travelling one');
      h.eq([animations.some(isSpark), seen(tileOn(tree)).opacity], [false, 0], 'nothing flares and the tile waits while it travels');
      await run(() => elapseSprings(120));
      const mid = flying(tree)!;
      const p = progressOf(mid.scale);
      const there = centre(SOURCE, TARGET, p);
      h.ok(p > 0.1 && p < 0.9 && close(mid.x + TARGET.width / 2, there.x) && close(mid.y + TARGET.height / 2, there.y), `on its way, between the two places (${p.toFixed(2)})`);
      h.eq(seenEmbers(tree).length, 1, 'still one ember seen');
      await run(() => elapseSprings(3000));
      h.eq(flying(tree), null, 'landed, the layer draws nothing');
      h.eq(seenEmbers(tree).length, 1, 'one ember seen, the tile’s own');
      h.ok(animations.some(isSpark), 'and it flares from where the travel left it');
      h.eq(tree.root.findAllByType(MakingPage).length, 0, 'the Making page has gone');
    } finally { await leave(tree, release); }
  });

  await h.test('Making → Ready: every frame measures both places, so a target that moves mid-flight is retargeted and a sheet dragged mid-flight carries the ember with it', async () => {
    const { tree, release } = await land();
    try {
      await run(() => elapseSprings(100));
      places.target = { ...TARGET, pageY: TARGET.pageY + 60 };
      await run(() => elapseSprings(40));
      const moved = flying(tree)!;
      const p = progressOf(moved.scale);
      h.ok(close(moved.y + TARGET.height / 2, centre(SOURCE, places.target, p).y), 'heading for where the tile is now');
      const before = flying(tree)!;
      places.source = { ...SOURCE, pageY: SOURCE.pageY + 40 };
      places.target = { ...places.target, pageY: places.target.pageY + 40 };
      await TestRenderer.act(async () => tree.update(<Flow ready acted={[]} />));
      const dragged = flying(tree)!;
      h.eq([dragged.scale, close(dragged.y - before.y, 40), close(dragged.x, before.x)], [before.scale, true, true], 'both places 40 pt lower, the ember is 40 pt lower at the same progress');
    } finally { await leave(tree, release); }
  });

  await h.test('Making → Ready under Reduce Motion (pair): off, the ember travels; on, nothing travels and the Making page goes at once, the tile’s ember cross-fading in with no flare', async () => {
    const play = async (on: boolean) => {
      const { tree, release } = await land(on);
      try {
        return { travels: travels().length, flying: flying(tree) !== null, making: tree.root.findAllByType(MakingPage).length, seen: seenEmbers(tree).length, flare: animations.some(isSpark), tileFades: seen(tileOn(tree)).scale };
      } finally { await leave(tree, release); }
    };
    h.eq(await play(false), { travels: 1, flying: true, making: 1, seen: 1, flare: false, tileFades: READY_RISE_FROM }, 'off: one ember travels while the Making page stays, unseen, as its place');
    h.eq(await play(true), { travels: 0, flying: false, making: 0, seen: 1, flare: false, tileFades: 1 }, 'on: the tile’s own ember, cross-fading; no travel, no flare');
  });

  for (const moment of ['mid-travel', 'mid-flare'] as const) {
    await h.test(`Ready: closing the sheet ${moment} ends the moment at once — the tile, the words and the buttons whole, the ember gone, nothing travelling`, async () => {
      const { tree, acted, release } = await land();
      try {
        if (moment === 'mid-flare') await run(() => elapseSprings(3000));
        h.eq([seen(tileOn(tree)).opacity, seenEmbers(tree).length], [0, 1], `${moment}: the tile not yet there, one ember`);
        await press(button(tree, COPY.sheetClose));
        h.eq(acted, ['close'], 'the close closed the sheet');
        const tile = seen(tileOn(tree));
        h.eq([tile.opacity, tile.scale, seenEmbers(tree).length, flying(tree)], [1, 1, 0, null], 'the tile whole, no ember, nothing travelling');
        h.ok(textsSeen(tree).every((t) => t.opacity === 1), 'every text whole as the sheet leaves');
      } finally { await leave(tree, release); }
    });
  }

  await h.test('M10: the flare’s peak, the rise from 0.6 and the 80 ms between the words are system.md’s M10', async () => {
    const doc = fs.readFileSync(path.join(process.cwd(), 'docs/design/system.md'), 'utf8');
    const row = doc.split('\n').find((line) => line.startsWith('| M10 Ready |'));
    h.ok(row !== undefined, 'system.md has the M10 row');
    const cells = row!.split('|').map((cell) => cell.trim());
    h.ok(cells[3].includes(`1 → ${SPARK_PEAK} → 1`), `the flare peaks at ${SPARK_PEAK}: ${cells[3]}`);
    h.ok(cells[3].includes(`rising ${READY_RISE_FROM} → 1`), `the tile rises from ${READY_RISE_FROM}`);
    h.ok(cells[3].includes(`${READY_STAGGER_MS} ms apart`), `the words fade in ${READY_STAGGER_MS} ms apart`);
    h.eq(cells[4], '`spark`', 'on spark');
  });

  await h.test('M10 in the shell: a build delivered with the making sheet open lands on Ready with the flare and the tile rising', async () => {
    const streams: ReturnType<typeof sseStream>[] = [];
    await withLauncher({ server: streamingServer(streams) }, async ({ tree }) => {
      await startBuild(tree, 'A tea timer');
      animations.splice(0);
      streams[0].push(resultEvent('Tea Timer'));
      streams[0].end();
      await waitFor(() => hasInstalled(tree, 'Tea Timer') && tree.root.findAllByType(ReadyPage).length === 1, 'the build to deliver on Ready');
      h.ok(animations.some(isSpark), 'the ember flared');
      h.eq(sparkRises(), [SETTLE], 'and the tile rose on spark after it');
    });
  });
}
