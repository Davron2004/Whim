/** The Ready page's moment (system.md §4.4 M10) with its Reduce Motion pair (§4.5): delivered with the
 *  sheet open, the ember flares on spark and settles into the 96 tile rising from 0.6; the name, the
 *  words and the buttons fade in 80 ms apart, text never moving; Done jumps to the end. What the page
 *  shows is `flow-screens-ui.suite.tsx`. */
import fs from 'node:fs';
import path from 'node:path';
import TestRenderer from 'react-test-renderer';
import { Harness } from './harness';
import { COPY } from '../copy';
import type { InstalledApp } from '../app-index';
import ReadyPage from '../ReadyPage';
import { TilePlate } from '../../ui/AppTile';
import { useTokens } from '../../ui/tokens';
import { READY_RISE_FROM, READY_STAGGER_MS, SPARK_PEAK, springConfig, springReachMs, timingOf } from '../../ui/tokens-pure';
import { StyleSheet, accessibilitySettings, emitAccessibility } from './native-host';
import { animations, holdAnimations, isStep, ReduceMotion, type Animation } from './native-reanimated';
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
