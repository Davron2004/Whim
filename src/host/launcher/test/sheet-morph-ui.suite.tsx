/** M6 Composer → Describe and M5 Leave it running (system.md §4.4), with their Reduce Motion pairs
 *  (§4.5): the making sheet grows out of a place on Home and goes back into it (`SheetAnchor`), its
 *  plate set out from and landing on the place's measured rect, the place's face still where it is,
 *  the card fading in only once the plate covers it and out before the plate shrinks inside it; a close mid-way turns back from where it is, a
 *  tap on the place mid-close reopens it; the Making page's ember leads it into the tile's ember, one
 *  ember on every frame, in the light it had. */
import React, { useState } from 'react';
import TestRenderer from 'react-test-renderer';
import { View } from 'react-native';
import { Harness } from './harness';
import { COPY } from '../copy';
import { COMPOSER_ANCHOR, COMPOSER_BAR, ComposerBar } from '../ComposerBar';
import MakingPage from '../MakingPage';
import { MakingSheet } from '../MakingSheet';
import { AppTile } from '../../ui/AppTile';
import { gridLayout } from '../../ui/AppTile-geometry';
import { Ember } from '../../ui/Ember';
import { SheetAnchors, tileAnchor } from '../../ui/SheetAnchor';
import { Text } from '../../ui/Text';
import { useTokens } from '../../ui/tokens';
import { emberLook, springConfig, timingOf } from '../../ui/tokens-pure';
import { StyleSheet, accessibilitySettings, emitAccessibility } from './native-host';
import { pan } from './native-gesture-handler';
import { animations, elapse, elapseSprings, holdAnimations, isStep, measuring, ReduceMotion } from './native-reanimated';
import { androidBack, button, hostType, isHost, press, renderScreen, textOf, unmountScreen } from './react-screen';

type Tree = TestRenderer.ReactTestRenderer;
type Node = TestRenderer.ReactTestInstance;
type Style = Record<string, unknown>;
type Rect = { x: number; y: number; width: number; height: number; pageX: number; pageY: number };
const flat = (node: Node): Style => (StyleSheet.flatten(node.props.style) ?? {}) as Style;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const close = (a: number, b: number) => Math.abs(a - b) < 1e-6;
const run = (fn: () => void) => TestRenderer.act(async () => { fn(); });

const MORPH = springConfig('morph');
const SMOOTH = springConfig('smooth');
const FADE_OUT_MS = timingOf('fadeOut').duration;

const RUN = 'run-1';
const rect = (pageX: number, pageY: number, width: number, height: number): Rect => ({ x: 0, y: 0, width, height, pageX, pageY });
/** The sheet's frame fills the window; the capsule, the tile, its ember and the Making page's 128 sit
 *  where a phone draws them. */
const FRAME = rect(0, 0, 390, 844);
const CAPSULE = rect(16, 760, 358, COMPOSER_BAR.height);
const TILE = rect(40, 120, 64, 64);
const TILE_EMBER = rect(60, 140, 24, 24);
const MAKING_EMBER = rect(131, 150, 128, 128);

/** Every host view's ref holds its element, so `measure` can tell the places apart. */
const nodeMock = (element: React.ReactElement) => ({ element });
function placeOf(node: unknown): Rect | undefined {
  const { props } = (node as { element: React.ReactElement<Record<string, unknown>> }).element;
  const style = (StyleSheet.flatten(props.style) ?? {}) as Style;
  if (style.justifyContent === 'flex-end' && style.flex === 1) return FRAME;
  if (style.minHeight === COMPOSER_BAR.height) return CAPSULE;
  if (props.collapsable === false && React.isValidElement(props.children) && props.children.type === Ember) return TILE_EMBER;
  if (props.collapsable === false && typeof props.onLayout === 'function' && props.style == null) return TILE;
  if (style.width === 128 && style.height === 128) return MAKING_EMBER;
  return undefined;
}

/** Home's composer and one tile being made, and the making sheet over them: Describe begun from the
 *  composer, or the run's Making page. */
function Rig({ start, activity }: Readonly<{ start: 'describe' | 'making' | null; activity: number }>) {
  useTokens();
  const [page, setPage] = useState(start);
  const node =
    page === 'making' ? (
      <MakingPage name="Tea" changing={false} words="A tea timer" stage="generate" delivering={false} signals={null} now={0} activity={activity} onStop={() => {}} />
    ) : (
      <View>
        <Text type="body">Describe it</Text>
      </View>
    );
  return (
    <SheetAnchors>
      <AppTile layout={gridLayout(390, 1)} name="Tea" state="making" tint="slate" glyph="circle" activity={activity} onPress={() => setPage('making')} onLongPress={() => {}} anchor={tileAnchor(RUN)} />
      <ComposerBar onPress={() => setPage('describe')} />
      <MakingSheet content={page ? { key: page, node } : null} onClose={() => setPage(null)} anchor={page === 'making' ? tileAnchor(RUN) : COMPOSER_ANCHOR} />
    </SheetAnchors>
  );
}

async function reduceMotion(on: boolean): Promise<void> {
  accessibilitySettings.reduceMotion = on;
  await TestRenderer.act(async () => emitAccessibility('reduceMotionChanged', on));
}

/** Home under `start` (Reduce Motion `reduced`), every motion so far at rest, then motion held. */
async function rig(start: 'describe' | 'making' | null, reduced = false, activity = 0.5) {
  measuring.rectOf = placeOf;
  const tree = await renderScreen(<Rig start={start} activity={activity} />, { createNodeMock: nodeMock });
  await reduceMotion(reduced);
  animations.splice(0);
  const release = holdAnimations();
  return { tree, release };
}
/** The capsule laid out at its resting size, as the phone reports it once. */
async function laidOut(tree: Tree): Promise<void> {
  const capsule = tree.root.findAll((n) => typeof n.type === 'string' && typeof n.props.onLayout === 'function' && flat(n).minHeight === COMPOSER_BAR.height)[0];
  await TestRenderer.act(async () => capsule.props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: CAPSULE.width, height: CAPSULE.height } } }));
}
async function leave(tree: Tree, release: () => void): Promise<void> {
  await run(release);
  await reduceMotion(false);
  await unmountScreen(tree);
  measuring.rectOf = null;
}

const modal = (tree: Tree) => tree.root.findAll(isHost('Modal'))[0] as Node | undefined;
const inside = (node: Node, ancestor: Node) => {
  for (let up: Node | null = node; up; up = up.parent) if (up === ancestor) return true;
  return false;
};
/** How a node is drawn: every view above it fades it, and the scales above it. */
function seen(node: Node) {
  let opacity = 1;
  const scales: Record<string, number>[] = [];
  for (let up: Node | null = node; up; up = up.parent) {
    if (typeof up.type !== 'string') continue;
    const style = flat(up);
    opacity *= (style.opacity as number | undefined) ?? 1;
    for (const step of (style.transform as Record<string, number>[] | undefined) ?? []) if ('scale' in step || 'scaleX' in step || 'scaleY' in step) scales.push(step);
  }
  return { opacity, scales };
}
const transformOf = (node: Node) => Object.assign({}, ...((flat(node).transform as Record<string, number>[] | undefined) ?? [])) as Record<string, number>;
/** The leaf plate: the one childless view in the sheet painted as the card is, shadow and all. */
const plate = (tree: Tree) => tree.root.findAll((n) => hostType(n) === 'Animated.View' && n.children.length === 0 && 'width' in flat(n) && 'boxShadow' in flat(n))[0] ?? null;
/** The place's face, which takes the place's tap while the sheet goes back into it. */
const faceTap = (tree: Tree) => tree.root.findAll((n) => hostType(n) === 'Pressable' && n.props.importantForAccessibility === 'no-hide-descendants')[0] ?? null;
const face = (tree: Tree) => {
  for (let up = faceTap(tree)?.parent ?? null; up; up = up.parent) if (hostType(up) === 'Animated.View') return up;
  return null;
};
const card = (tree: Tree) => tree.root.findAll((n) => hostType(n) === 'Animated.View' && n.props.accessibilityViewIsModal === true)[0];
/** How far the plate is from the place (0) to the card (1), read off its width. */
const grownOf = (tree: Tree, from: Rect) => ((flat(plate(tree)!).width as number) - from.width) / (FRAME.width - from.width);
const embersIn = (tree: Tree) => {
  const m = modal(tree);
  return tree.root.findAll((n) => hostType(n) === 'RadialGradient' && n.props.cy === '74%').filter((n) => m !== undefined && inside(n, m) && seen(n).opacity > 0);
};
/** The ember the sheet leads with, as drawn, if it draws one. */
function lead(tree: Tree) {
  const view = tree.root.findAll((n) => hostType(n) === 'Animated.View' && flat(n).position === 'absolute' && flat(n).top === 0 && flat(n).left === 0 && n.props.pointerEvents === 'none' && n.findAll((c) => hostType(c) === 'RadialGradient').length > 0)[0];
  if (view === undefined) return null;
  const at = transformOf(view);
  return { node: view, opacity: flat(view).opacity as number, translateX: at.translateX, scale: at.scale };
}
const springsTo = (to: number, config: object) => animations.filter((a) => isStep(a) && a.kind === 'spring' && a.to === to && same({ ...a.config, velocity: undefined }, { ...config, velocity: undefined }));
const composerButton = (tree: Tree) => tree.root.findAll((n) => hostType(n) === 'Pressable' && n.props.accessibilityLabel === COPY.homeComposerPlaceholder)[0];
const sheetDrag = (tree: Tree) => tree.root.findAll((n) => hostType(n) === 'GestureDetector')[0].props.gesture;
/** No transform in the sheet's window stretches a shape one way more than the other. */
const uniform = (tree: Tree) => {
  const m = modal(tree);
  return m === undefined || m.findAll((n) => typeof n.type === 'string').every((n) => !('scaleX' in transformOf(n)) && !('scaleY' in transformOf(n)));
};

/** The card as the phone lays it out, `CARD_HEIGHT` tall at the bottom of the window. */
const CARD_HEIGHT = 600;
async function cardLaidOut(tree: Tree): Promise<void> {
  await TestRenderer.act(async () => card(tree).props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: FRAME.width, height: CARD_HEIGHT } } }));
}
/** One frame of the sheet as drawn: how much of the card shows, and whether a drawn plate covers the
 *  card's rect (where its translation puts it), read off the plate's own style. */
function frameOf(tree: Tree) {
  const shown = seen(card(tree)).opacity;
  const p = plate(tree);
  const ps = p ? flat(p) : null;
  const drawn = ps !== null && ((ps.opacity as number | undefined) ?? 1) > 0 && ((ps.width as number | undefined) ?? 0) > 0;
  const top = FRAME.height - CARD_HEIGHT + ((transformOf(card(tree)).translateY as number | undefined) ?? 0);
  let covers = false;
  if (drawn && p) {
    const at = transformOf(p);
    const [x, y, w, hgt] = [at.translateX, at.translateY, ps.width as number, ps.height as number];
    covers = ps.opacity === 1 && x <= 1e-6 && y <= top + 1e-6 && x + w >= FRAME.width - 1e-6 && y + hgt >= top + CARD_HEIGHT - 1e-6;
  }
  return { shown, drawn, covers };
}
/** Runs 16 ms frames (springs and timings alike) until `until` holds or `frames` have passed, calling
 *  `each` on every frame. */
async function frames(tree: Tree, count: number, each: (f: ReturnType<typeof frameOf>) => void, until: () => boolean = () => false): Promise<void> {
  for (let i = 0; i < count && !until(); i++) {
    await run(() => { elapseSprings(16); elapse(16); });
    if (modal(tree) === undefined) return;
    each(frameOf(tree));
  }
}

/** Checks every frame: wherever any of the card shows over a plate, or shows only in part, the plate
 *  covers it. Counts the frames the card showed in part and the plate was smaller than the card. */
const coveredOnly = (h: Harness, where: string, parts: { partly: number; grew: number }) => (f: ReturnType<typeof frameOf>) => {
  if (f.shown > 0 && f.shown < 1) parts.partly += 1;
  if (f.drawn && !f.covers) parts.grew += 1;
  h.ok(!(f.shown > 0 && (f.drawn || f.shown < 1) && !f.covers), `${where}: the card (${f.shown.toFixed(2)}) shows only over a plate that covers it`);
};
const fadesOn = (to: number, token: 'fadeIn' | 'fadeOut') => animations.some((a) => isStep(a) && a.kind === 'timing' && a.to === to && a.config?.duration === timingOf(token).duration);

/** M5 by X, checked frame by frame: all the way into the tile (`none`), or turned back by a tap on the
 *  tile while the card fades out (`fading`) or while the plate shrinks (`shrinking`). */
async function closeIntoTile(h: Harness, turn: 'none' | 'fading' | 'shrinking'): Promise<void> {
  const { tree, release } = await rig('making');
  try {
    await run(release);
    await cardLaidOut(tree);
    animations.splice(0);
    const hold = holdAnimations();
    await press(button(tree, COPY.sheetClose));
    const parts = { partly: 0, grew: 0 };
    const check = coveredOnly(h, `M5 ${turn}`, parts);
    check(frameOf(tree));
    if (turn === 'none') {
      await frames(tree, 120, check);
      h.ok(fadesOn(0, 'fadeOut') && parts.partly > 0 && parts.grew > 5, `M5: the card faded out on fade-out (${parts.partly} frames), then the plate shrank (${parts.grew} frames)`);
      h.eq(modal(tree), undefined, 'M5: in the tile, the sheet has left');
    } else {
      await frames(tree, turn === 'fading' ? 3 : Math.ceil(FADE_OUT_MS / 16) + 8, check);
      const at = frameOf(tree);
      const caught = turn === 'fading' ? at.shown > 0 && at.shown < 1 : at.shown === 0 && at.drawn && !at.covers;
      h.ok(caught, `M5 ${turn}: caught where the turn is meant (${at.shown.toFixed(2)})`);
      await press(faceTap(tree)!);
      await frames(tree, 120, check, () => seen(card(tree)).opacity === 1 && !frameOf(tree).drawn);
      h.ok(modal(tree) !== undefined && seen(card(tree)).opacity === 1, `M5 ${turn}: turned back, the card shows whole`);
    }
    await run(hold);
  } finally { await leave(tree, release); }
}

export async function runSheetMorphUiTests(h: Harness): Promise<void> {
  await h.test('M6: tapping the composer grows the sheet out of the capsule on morph, from its measured rect to the card, the placeholder still where it was, the card fading in at the end', async () => {
    const { tree, release } = await rig(null);
    try {
      await press(composerButton(tree));
      await run(() => elapseSprings(0));
      h.eq(springsTo(1, MORPH).length, 1, 'one growth, on the morph spring');
      const at = transformOf(plate(tree)!);
      h.eq([at.translateX, at.translateY, flat(plate(tree)!).width, flat(plate(tree)!).height], [CAPSULE.pageX, CAPSULE.pageY, CAPSULE.width, CAPSULE.height], 'the plate sets out on the capsule’s measured rect');
      h.eq(flat(plate(tree)!).borderBottomLeftRadius, CAPSULE.height / 2, 'with the capsule’s round ends');
      h.ok(textOf(face(tree)!).includes(COPY.homeComposerPlaceholder) && seen(face(tree)!).opacity === 1, 'the capsule’s face, placeholder and all, is drawn over it');
      h.eq(seen(card(tree)).opacity, 0, 'the card waits unseen');
      const still = [transformOf(face(tree)!).translateX, transformOf(face(tree)!).translateY];
      h.eq(still, [CAPSULE.pageX, CAPSULE.pageY], 'the face sits on the capsule');
      for (const ms of [60, 60, 120]) {
        await run(() => elapseSprings(ms));
        const k = grownOf(tree, CAPSULE);
        h.ok(k > 0 && k < 1, `the plate grows between the capsule and the card (${k.toFixed(2)})`);
        h.eq([transformOf(face(tree)!).translateX, transformOf(face(tree)!).translateY], still, 'the placeholder does not move');
        h.ok(seen(face(tree)!).scales.every((step) => step.scale === 1), 'nor scale');
        h.ok(uniform(tree), 'nothing is stretched');
      }
      await run(release);
      h.ok(flat(plate(tree)!).opacity === 0 && seen(face(tree)!).opacity === 0, 'grown: the plate and the face have gone');
      h.eq(seen(card(tree)).opacity, 1, 'the card shows');
    } finally { await leave(tree, release); }
  });

  await h.test('M6: tapped, the capsule is drawn pressed and Android measures it so; the face, laid out at the capsule’s size, sits exactly on the capsule as drawn', async () => {
    const { tree, release } = await rig(null);
    const scale = 0.97;
    const pressed = rect(CAPSULE.pageX + (CAPSULE.width * (1 - scale)) / 2, CAPSULE.pageY + (CAPSULE.height * (1 - scale)) / 2, CAPSULE.width * scale, CAPSULE.height * scale);
    try {
      await laidOut(tree);
      measuring.rectOf = (node) => (placeOf(node) === CAPSULE ? pressed : placeOf(node));
      await press(composerButton(tree));
      await run(() => elapseSprings(0));
      const at = transformOf(face(tree)!);
      const drawn = [at.translateX, at.translateY, CAPSULE.width * at.scale, CAPSULE.height * at.scale];
      h.ok(flat(face(tree)!).transformOrigin === 'left top' && drawn.every((v, i) => close(v, [pressed.pageX, pressed.pageY, pressed.width, pressed.height][i])), `the face covers the pressed capsule (${drawn.map((v) => v.toFixed(2)).join(', ')})`);
    } finally { await leave(tree, release); }
  });

  await h.test('M6: a swipe down mid-growth turns it back into the bar on smooth, from where it has got to', async () => {
    const { tree, release } = await rig(null);
    try {
      await press(composerButton(tree));
      await run(() => elapseSprings(120));
      const was = grownOf(tree, CAPSULE);
      await TestRenderer.act(async () => pan(sheetDrag(tree), [40, 120, 200], 1500));
      h.eq(springsTo(0, SMOOTH).length, 1, 'back into the bar on smooth');
      await run(() => elapseSprings(16));
      const now = grownOf(tree, CAPSULE);
      h.ok(now < was + 0.05 && now > was - 0.25, `from where it was (${was.toFixed(2)} → ${now.toFixed(2)}), not from either end`);
      await run(release);
      h.eq(modal(tree), undefined, 'the sheet has left once it is back in the bar');
    } finally { await leave(tree, release); }
  });

  await h.test('M6: mid-growth, before any of the card shows (a view not seen takes no touch), the plate, the shape seen, takes the drag: a swipe down on it turns the sheet back into the bar', async () => {
    const { tree, release } = await rig(null);
    try {
      await press(composerButton(tree));
      await run(() => elapseSprings(120));
      const was = grownOf(tree, CAPSULE);
      h.ok(was > 0.05 && was < 0.95 && seen(card(tree)).opacity === 0, `mid-growth, the card not seen yet (${was.toFixed(2)})`);
      const shape = plate(tree)!;
      let detector: Node | null = null;
      for (let up = shape.parent; up && detector === null; up = up.parent) if (hostType(up) === 'GestureDetector') detector = up;
      h.ok(detector !== null && shape.props.pointerEvents !== 'none' && detector.props.gesture.enabled !== false, 'the plate takes touches, in a drag of its own');
      await TestRenderer.act(async () => pan(detector!.props.gesture, [40, 120, 200], 1500));
      h.eq(springsTo(0, SMOOTH).length, 1, 'a swipe down on it goes back into the bar on smooth');
      await run(release);
      h.eq(modal(tree), undefined, 'and the sheet has left');
    } finally { await leave(tree, release); }
  });

  await h.test('M6 and M5: nothing of the card draws outside the plate — it fades in on fade-in only once the plate covers it, and out on fade-out before the plate shrinks inside it, turns mid-way included', async () => {
    // M6 open, then a swipe down mid-growth.
    {
      const { tree, release } = await rig(null);
      try {
        await press(composerButton(tree));
        await cardLaidOut(tree);
        const parts = { partly: 0, grew: 0 };
        await frames(tree, 120, coveredOnly(h, 'M6 open', parts), () => seen(card(tree)).opacity === 1 && !frameOf(tree).drawn);
        h.ok(parts.grew > 5 && parts.partly > 0, `M6 open: the plate grew over frames (${parts.grew}) and the card faded in over frames (${parts.partly})`);
        h.ok(fadesOn(1, 'fadeIn') && seen(card(tree)).opacity === 1, 'M6 open: the card faded in on fade-in and shows whole');
      } finally { await leave(tree, release); }
    }
    {
      const { tree, release } = await rig(null);
      try {
        await press(composerButton(tree));
        await cardLaidOut(tree);
        await frames(tree, 6, coveredOnly(h, 'M6 growing', { partly: 0, grew: 0 }));
        await TestRenderer.act(async () => pan(sheetDrag(tree), [40, 120, 200], 1500));
        await frames(tree, 120, coveredOnly(h, 'M6 swiped back mid-growth', { partly: 0, grew: 0 }));
        h.eq(modal(tree), undefined, 'M6 swiped back: in the bar, the sheet has left');
      } finally { await leave(tree, release); }
    }
    // M5 close by X, then turns: a tap on the tile while the card fades out, and while the plate shrinks.
    for (const turn of ['none', 'fading', 'shrinking'] as const) await closeIntoTile(h, turn);
  });

  await h.test('M6 under Reduce Motion: the composer cross-fades the sheet in, nothing grows (the pair: without it, it grows on morph)', async () => {
    for (const reduced of [false, true]) {
      const { tree, release } = await rig(null, reduced);
      try {
        await press(composerButton(tree));
        await run(() => elapseSprings(0));
        h.eq([springsTo(1, MORPH).length > 0, plate(tree) !== null], [!reduced, !reduced], reduced ? 'Reduce Motion: no growth, no plate' : 'motion: it grows');
        if (reduced) h.ok(animations.some((a) => isStep(a) && a.kind === 'timing' && a.to === 1 && a.config?.duration === timingOf('fadeIn').duration && a.config?.reduceMotion === ReduceMotion.Never), 'it fades in over fade-in');
      } finally { await leave(tree, release); }
    }
  });

  await h.test('M5: closing the Making sheet by X or by back shrinks it on smooth into its tile’s measured rect, the ember first, one ember on every frame', async () => {
    for (const route of ['x', 'back'] as const) {
      const { tree, release } = await rig('making');
      try {
        await run(release);
        animations.splice(0);
        const hold = holdAnimations();
        if (route === 'x') await press(button(tree, COPY.sheetClose));
        else await androidBack(tree);
        await run(() => elapseSprings(0));
        h.eq(springsTo(0, SMOOTH).length, 0, `${route}: the plate waits while the card fades out`);
        await run(() => elapse(FADE_OUT_MS));
        h.eq(springsTo(0, SMOOTH).length, 1, `${route}: then goes back into the tile on smooth`);
        for (const ms of [16, 50, 80, 120, 200]) {
          await run(() => elapseSprings(ms));
          const k = grownOf(tree, TILE);
          const l = lead(tree)!;
          const e = Math.min(1, (1 - k) / 0.6);
          const cx = MAKING_EMBER.pageX + MAKING_EMBER.width / 2 + (TILE_EMBER.pageX + TILE_EMBER.width / 2 - MAKING_EMBER.pageX - MAKING_EMBER.width / 2) * e;
          h.ok(l !== null && close(l.translateX + MAKING_EMBER.width / 2, cx) && close(l.scale, 1 + (TILE_EMBER.width / MAKING_EMBER.width - 1) * e), `${route}: the ember is ${(e * 100).toFixed(0)}% of the way to the tile’s ember while the sheet is ${((1 - k) * 100).toFixed(0)}% of the way`);
          h.ok(e > 1 - k || e === 1, `${route}: the ember leads`);
          h.eq(embersIn(tree).length, 1, `${route}: one ember seen`);
          h.ok(uniform(tree), `${route}: nothing is stretched`);
        }
        await run(hold);
        h.eq(modal(tree), undefined, `${route}: in the tile, the sheet has left`);
      } finally { await leave(tree, release); }
    }
  });

  await h.test('M5: tapping the tile while the sheet shrinks into it reverses it on morph, from where it has got to', async () => {
    const { tree, release } = await rig('making');
    try {
      await run(release);
      animations.splice(0);
      const hold = holdAnimations();
      await press(button(tree, COPY.sheetClose));
      await run(() => elapse(FADE_OUT_MS));
      await run(() => elapseSprings(150));
      const was = grownOf(tree, TILE);
      h.ok(was > 0.05 && was < 0.95, `mid-way (${was.toFixed(2)})`);
      await press(faceTap(tree)!);
      h.eq(springsTo(1, MORPH).length, 1, 'it grows back on morph');
      await run(() => elapseSprings(16));
      const now = grownOf(tree, TILE);
      h.ok(now > was - 0.25 && now < was + 0.25, `from where it was (${was.toFixed(2)} → ${now.toFixed(2)})`);
      await run(hold);
      h.ok(modal(tree) !== undefined && seen(card(tree)).opacity === 1, 'open again');
      h.eq(embersIn(tree).length, 1, 'the Making page’s own ember is back, alone');
    } finally { await leave(tree, release); }
  });

  await h.test('M5: the ember leaves the Making page in the light it is drawn in there, so it neither brightens nor dims on the way', async () => {
    const { tree, release } = await rig('making', false, 0.1);
    try {
      await run(release);
      animations.splice(0);
      const hold = holdAnimations();
      // The stream picks up: the Making ember's light is on its way up, part way along its spring.
      await TestRenderer.act(async () => tree.update(<Rig start="making" activity={1} />));
      await run(() => elapseSprings(150));
      // The body's own layer: the nearest animated view above its gradient.
      const body = (n: Node) => {
        for (let up = n.parent; up; up = up.parent) if (hostType(up) === 'Animated.View') return flat(up).opacity as number;
        return NaN;
      };
      const own = embersIn(tree)[0];
      const drawn = body(own);
      h.ok(drawn < emberLook('working', 1).body - 0.05, `the Making ember is still on its way up (${drawn.toFixed(3)})`);
      await press(button(tree, COPY.sheetClose));
      await run(() => { elapse(1); elapseSprings(1); });
      const led = embersIn(tree)[0];
      h.ok(inside(led, lead(tree)!.node), 'the ember seen is the one leading');
      h.ok(Math.abs(body(led) - drawn) < 1e-3, `it sets out in the light it had (${drawn.toFixed(3)} → ${body(led).toFixed(3)})`);
      await run(hold);
    } finally { await leave(tree, release); }
  });

  await h.test('M5 under Reduce Motion: a close cross-fades the sheet away, no shrink and no ember travel (the pair: without it, it shrinks on smooth)', async () => {
    for (const reduced of [false, true]) {
      const { tree, release } = await rig('making', reduced);
      try {
        await run(release);
        animations.splice(0);
        const hold = holdAnimations();
        await press(button(tree, COPY.sheetClose));
        await run(() => { elapse(reduced ? 16 : FADE_OUT_MS); elapseSprings(16); });
        const fadeOut = animations.some((a) => isStep(a) && a.kind === 'timing' && a.to === 0 && a.config?.duration === timingOf('fadeOut').duration);
        h.eq([springsTo(0, SMOOTH).length > 0, lead(tree) !== null && lead(tree)!.opacity === 1, fadeOut], [!reduced, !reduced, true], reduced ? 'Reduce Motion: it fades out where it is' : 'motion: the card fades out, then it shrinks, the ember leading');
        await run(hold);
      } finally { await leave(tree, release); }
    }
  });
}
