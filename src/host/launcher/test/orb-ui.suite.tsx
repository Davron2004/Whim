/** The orb over a running app (`app-launcher` "The orb is an opaque, draggable disc that opens the
 *  Whim sheet"; system.md §7.1 Orb, §4.3 rule 6, M16, M23): its disc and target, both corners inside
 *  the inset the app pads by, the projected snap between them, the corner each app remembers, hiding
 *  on the host's keyboard signal, the state dots, its accessibility name and action, and that it
 *  draws nothing but itself, visible on `bg` and on a card in both schemes. */
import React from 'react';
import TestRenderer from 'react-test-renderer';
import { Harness } from './harness';
import Orb, { type OrbProps } from '../Orb';
import { chromeInsetBottom, orbBounds, orbReleaseX, orbSettleVelocity } from '../orb-geometry';
import { projectRelease } from '../../ui/Sheet';
import { loadOrbCorner } from '../orb-corner';
import { AppIndex } from '../app-index';
import { createMmkvBackend } from '../../version-store/fs/mmkv-backend';
import { COLORS, SHADOWS } from '../../../design/tokens';
import { contrastRatio } from '../../../design/tints';
import { springConfig } from '../../ui/tokens-pure';
import { resetNativeStorage } from './native-storage';
import {
  accessibilitySettings,
  emitAccessibility,
  hapticCalls,
  setColorScheme,
  StyleSheet,
  useSafeAreaInsets as safeAreaOf,
  useWindowDimensions as windowOf,
} from './native-host';
import { moveKeyboard, resetKeyboard } from './native-keyboard-controller';
import { animations, isStep, type Animation } from './native-reanimated';
import type { PanConfig, PanPoint } from './native-gesture-handler';
import { hostType, press, renderScreen, unmountScreen } from './react-screen';

type Tree = TestRenderer.ReactTestRenderer;
type Node = TestRenderer.ReactTestInstance;
type Style = Record<string, unknown> & { transform?: Record<string, number>[] };

const flat = (node: Node): Style => StyleSheet.flatten(node.props.style) as Style;
const noop = () => {};
/** The window and safe area the host double reports to every component. */
const SCREEN = windowOf();
const SAFE = safeAreaOf();

/** The orb as a screen reader and a finger find it: the one button named "Whim menu…". */
function orbOf(tree: Tree): Node {
  const found = tree.root.findAll((n) => hostType(n) === 'Pressable' && String(n.props.accessibilityLabel ?? '').startsWith('Whim menu'));
  if (found.length !== 1) throw new Error(`expected one orb, got ${found.length}`);
  return found[0];
}

/** The view that places the orb on the screen: its nearest absolutely positioned ancestor. */
function frameOf(tree: Tree): Node {
  for (let up: Node | null = orbOf(tree); up; up = up.parent) if (typeof up.type === 'string' && flat(up).position === 'absolute') return up;
  throw new Error('the orb has no positioned frame');
}

/** The orb's target on the screen: left and bottom edges, and its size. */
function targetRect(tree: Tree): { left: number; bottom: number; width: number; height: number } {
  const frame = flat(frameOf(tree));
  const target = flat(orbOf(tree));
  const shift = (key: string) => frame.transform?.find((t) => key in t)?.[key] ?? 0;
  return {
    left: Number(frame.left ?? 0) + shift('translateX'),
    bottom: Number(frame.bottom ?? 0) - shift('translateY'),
    width: Number(target.width),
    height: Number(target.height),
  };
}

const opaque = (c: unknown) => typeof c === 'string' && c !== 'transparent' && !/^rgba\(.*,\s*0(\.\d+)?\)$/.test(c) && !(c.startsWith('#') && c.length === 9);

/** The disc: the widest opaque fill inside the orb's target. */
function discOf(tree: Tree): Node {
  const fills = orbOf(tree).findAll((n) => typeof n.type === 'string' && opaque(flat(n).backgroundColor));
  const disc = fills.sort((a, b) => Number(flat(b).width ?? 0) - Number(flat(a).width ?? 0))[0];
  if (!disc) throw new Error('the orb draws no opaque disc');
  return disc;
}

/** The small round fills on the disc: its state dots. */
const dotsOf = (tree: Tree) => discOf(tree).findAll((n) => n !== discOf(tree) && typeof n.type === 'string' && opaque(flat(n).backgroundColor) && Number(flat(n).width) <= 12);

const gestureOf = (tree: Tree): PanConfig => {
  const detectors = tree.root.findAll((n) => hostType(n) === 'GestureDetector' && n.findAll((c) => c === orbOf(tree)).length > 0);
  return detectors[0].props.gesture as PanConfig;
};

const at = (translationX: number, translationY = 0, velocityX = 0, velocityY = 0): PanPoint => ({ translationX, translationY, velocityX, velocityY });

/** A drag on the orb as the pan reports it: activation past the slop, one update per point, release
 *  at `velocityX` (pt/s, positive rightward). */
async function drag(tree: Tree, xs: readonly number[], velocityX: number, velocityY = 0): Promise<void> {
  const g = gestureOf(tree);
  await TestRenderer.act(async () => {
    g.onBegin?.(at(0));
    g.onActivate?.(at(xs[0] ?? 0));
    for (const x of xs) g.onUpdate?.(at(x, 0, velocityX));
    const last = xs.at(-1) ?? 0;
    g.onDeactivate?.(at(last, 0, velocityX, velocityY));
    g.onFinalize?.(at(last, 0, velocityX, velocityY));
  });
}

const springs = (from: number): Animation[] => animations.slice(from).filter((a) => a.kind === 'spring');

const render = (props: Partial<OrbProps> = {}) =>
  renderScreen(<Orb appId="app-a" onExit={noop} onVersions={noop} onChangeIt={noop} onReport={noop} {...props} />);

async function withOrb(props: Partial<OrbProps>, body: (tree: Tree) => Promise<void>): Promise<void> {
  const tree = await render(props);
  try {
    await body(tree);
  } finally {
    await unmountScreen(tree);
  }
}

const stored = (appId: string) => loadOrbCorner(createMmkvBackend('whim.launcher'), appId);

export async function runOrbUiTests(h: Harness): Promise<void> {
  const bounds = orbBounds(SCREEN.width, SAFE);
  const middle = (bounds.leading + bounds.trailing) / 2;

  await h.test('orb: a release snaps to the corner its projected end is nearer, from either corner; a release whose velocity points back stays', async () => {
    const { leading, trailing } = bounds;
    h.eq(orbReleaseX(trailing, trailing - 40, -1200, leading, trailing), leading, 'a fling toward leading from 40 pt out lands bottom-leading');
    h.eq(orbReleaseX(leading, leading + 40, 1200, leading, trailing), trailing, 'a fling toward trailing from 40 pt out lands bottom-trailing');
    h.eq(orbReleaseX(trailing, trailing - 30, -100, leading, trailing), trailing, 'a short slow drag projects short of the middle and falls back');
    h.eq(orbReleaseX(trailing, middle - 20, 0, leading, trailing), leading, 'released at rest past the middle, it goes on to the other corner');
    h.eq(orbReleaseX(trailing, middle - 60, 20, leading, trailing), trailing, 'past the middle but moving back toward where it came from, however slowly, it goes back');
    h.eq(orbReleaseX(trailing, middle - 60, 80, leading, trailing), trailing, 'even when that motion would still end nearer the other corner');
    h.eq(orbReleaseX(leading, middle + 60, -80, leading, trailing), leading, 'the same from the other corner');
    h.eq(orbReleaseX(trailing, trailing + 20, 3000, leading, trailing), trailing, 'flung outward past its own corner, it stays in it');
  });

  await h.test('orb: the settling spring keeps a gentle release’s velocity but not a hard fling’s excess, so it lands in the corner rather than past it', async () => {
    const { leading, trailing } = bounds;
    const x = trailing - 100;
    const hard = orbSettleVelocity(x, leading, -3000);
    h.ok(hard < 0 && hard > -3000, `a hard fling hands on less than it was released with (${hard})`);
    h.ok(Math.abs(projectRelease(x, hard) - leading) < 0.5, 'exactly what carries it to the corner');
    h.eq(orbSettleVelocity(x, leading, -100), -100, 'a gentle release keeps its own velocity');
    h.eq(orbSettleVelocity(x, trailing, -300), -300, 'a release moving away from the corner it settles in keeps its velocity, for the spring to turn round');
  });

  await h.test('orb: dragged and flung, it settles into each corner with the fling spring and the release velocity, plays one commit haptic as the release would cross, and remembers the corner', async () => {
    resetNativeStorage();
    await withOrb({}, async (tree) => {
      h.eq(targetRect(tree).left, bounds.trailing, 'it starts bottom-trailing');
      const before = animations.length;
      hapticCalls.length = 0;
      await drag(tree, [-10, -60, -120], -1500);
      const xSpring = springs(before).find((a) => isStep(a) && a.to === bounds.leading);
      h.ok(xSpring !== undefined, 'a spring carries it to bottom-leading');
      const config = (xSpring && isStep(xSpring) ? xSpring.config : {}) ?? {};
      h.eq({ stiffness: config.stiffness, damping: config.damping, mass: config.mass }, springConfig('fling'), 'with the fling spring');
      const handed = Number(config.velocity);
      const released = bounds.trailing - 110;
      h.ok(handed < 0 && handed >= -1500, `handed the release velocity toward the corner (${handed}), never more than the release's own`);
      h.ok(projectRelease(released, handed) >= bounds.leading - 0.5, 'and never so much that it would carry the orb past the corner, off the screen’s edge');
      h.eq(targetRect(tree).left, bounds.leading, 'and it rests there');
      h.eq(hapticCalls.filter((c) => c.startsWith('impact:rigid')).length, 1, 'the commit haptic plays once, as the release starts to land in the other corner');
      h.eq(stored('app-a'), 'leading', 'the corner is remembered for this app');

      await drag(tree, [10, 60, 120], 1500);
      h.eq(targetRect(tree).left, bounds.trailing, 'flung back, it rests bottom-trailing');
      h.eq(stored('app-a'), 'trailing', 'and that is remembered');

      await drag(tree, [-10, -30], 400);
      h.eq(targetRect(tree).left, bounds.trailing, 'a drag released moving back stays where it was');
      h.eq(targetRect(tree).bottom, flat(frameOf(tree)).bottom, 'and comes back down to the bottom');
    });
  });

  await h.test('orb: under Reduce Motion a drag still tracks, and the release settles by a cross-fade, not a spring', async () => {
    resetNativeStorage();
    accessibilitySettings.reduceMotion = true;
    try {
      await withOrb({}, async (tree) => {
        await TestRenderer.act(async () => { emitAccessibility('reduceMotionChanged', true); });
        const g = gestureOf(tree);
        await TestRenderer.act(async () => { g.onBegin?.(at(0)); g.onActivate?.(at(-10)); g.onUpdate?.(at(-90)); });
        h.eq(targetRect(tree).left, bounds.trailing - 80, 'the drag follows the finger 1:1 after the slop');
        const before = animations.length;
        await TestRenderer.act(async () => { g.onDeactivate?.(at(-90, 0, -1500)); g.onFinalize?.(at(-90, 0, -1500)); });
        h.eq(springs(before).length, 0, 'no spring plays');
        h.eq(targetRect(tree).left, bounds.leading, 'it lands bottom-leading');
        h.eq(flat(frameOf(tree)).opacity, 1, 'faded back in');
        h.eq(stored('app-a'), 'leading', 'and the corner is remembered');
      });
    } finally {
      accessibilitySettings.reduceMotion = false;
      emitAccessibility('reduceMotionChanged', false);
    }
  });

  await h.test('orb: each app remembers its own corner across a close and reopen; deleting the app forgets it', async () => {
    resetNativeStorage();
    await withOrb({ appId: 'app-a' }, async (tree) => { await drag(tree, [-10, -120], -1500); });
    await withOrb({ appId: 'app-a' }, async (tree) => {
      h.eq(targetRect(tree).left, bounds.leading, 'reopened, app A’s orb is bottom-leading where it was left');
    });
    await withOrb({ appId: 'app-b' }, async (tree) => {
      h.eq(targetRect(tree).left, bounds.trailing, 'app B’s orb is in its own default corner');
    });
    new AppIndex(createMmkvBackend('whim.launcher')).remove('app-a');
    h.eq(stored('app-a'), 'trailing', 'deleting app A leaves no corner of it behind');
    await withOrb({ appId: 'app-a' }, async (tree) => {
      h.eq(targetRect(tree).left, bounds.trailing, 'an app installed again under that id starts bottom-trailing');
    });
  });

  await h.test('orb: in either corner its whole target lies inside the screen and inside the bottom inset the app pads by', async () => {
    resetNativeStorage();
    await withOrb({}, async (tree) => {
      for (const corner of ['trailing', 'leading'] as const) {
        const r = targetRect(tree);
        h.ok(r.left >= 0 && r.left + r.width <= SCREEN.width, `${corner}: inside the screen's width (${r.left}–${r.left + r.width} of ${SCREEN.width})`);
        h.ok(r.bottom >= SAFE.bottom, `${corner}: above the bottom safe area (${r.bottom} ≥ ${SAFE.bottom})`);
        h.ok(r.bottom + r.height <= chromeInsetBottom(SAFE.bottom), `${corner}: its top (${r.bottom + r.height}) is within chromeInsetBottom (${chromeInsetBottom(SAFE.bottom)})`);
        const discInset = (r.width - Number(flat(discOf(tree)).width)) / 2;
        const edge = corner === 'trailing' ? SCREEN.width - SAFE.right - (r.left + r.width - discInset) : r.left + discInset - SAFE.left;
        h.eq([edge, r.bottom + discInset - SAFE.bottom], [16, 16], `${corner}: the disc sits 16 pt from the edge and from the bottom safe area`);
        await TestRenderer.act(async () => { orbOf(tree).props.onAccessibilityAction({ nativeEvent: { actionName: orbOf(tree).props.accessibilityActions[0].name } }); });
      }
    });
  });

  await h.test('orb: it fades out while the host keyboard is up, takes no touch and is out of the accessibility tree, and comes back when the keyboard falls', async () => {
    resetNativeStorage();
    resetKeyboard();
    try {
      await withOrb({}, async (tree) => {
        const shown = () => {
          const f = frameOf(tree);
          return { opacity: flat(f).opacity, touch: f.props.pointerEvents !== 'none', a11y: f.props.accessibilityElementsHidden !== true };
        };
        h.eq(shown(), { opacity: 1, touch: true, a11y: true }, 'with no keyboard, it is there');
        const before = animations.length;
        await TestRenderer.act(async () => { moveKeyboard(320, [120, 240]); });
        h.eq(shown(), { opacity: 0, touch: false, a11y: false }, 'with the keyboard up it is gone, untouchable and unannounced');
        h.ok(animations.slice(before).some((a) => a.kind === 'timing' && a.to === 0), 'it faded out rather than vanishing');
        await h.throws(() => press(orbOf(tree)), 'Cannot press a disabled control', 'a tap where it was does nothing');
        await TestRenderer.act(async () => { moveKeyboard(0, [160]); });
        h.eq(shown(), { opacity: 1, touch: true, a11y: true }, 'when the keyboard falls it is back');
      });
      await TestRenderer.act(async () => { moveKeyboard(300); });
      await withOrb({}, async (tree) => {
        h.eq(frameOf(tree).props.pointerEvents, 'none', 'an app opened with the keyboard already up starts with the orb hidden');
      });
    } finally {
      await TestRenderer.act(async () => { moveKeyboard(0); });
      resetKeyboard();
    }
  });

  await h.test('orb: an opaque round 44 pt disc in a 52 pt target, floating on the shadow-floating shadow', async () => {
    resetNativeStorage();
    await withOrb({}, async (tree) => {
      const target = flat(orbOf(tree));
      h.eq([target.width, target.height], [52, 52], 'the target is 52 × 52');
      const disc = flat(discOf(tree));
      h.eq([disc.width, disc.height, disc.borderRadius], [44, 44, 22], 'the disc is 44 pt and round');
      h.eq(disc.boxShadow, SHADOWS['shadow-floating'].light, 'with the floating shadow, which both platforms draw');
    });
  });

  await h.test('orb: its edge stands 3:1 off bg and off a card in both schemes, its dark fill is lighter than bg, and it follows the phone’s scheme live', async () => {
    resetNativeStorage();
    try {
      await withOrb({}, async (tree) => {
        for (const scheme of ['light', 'dark'] as const) {
          await TestRenderer.act(async () => { setColorScheme(scheme); });
          const disc = flat(discOf(tree));
          const c = COLORS[scheme];
          h.eq(disc.backgroundColor, c.raised, `${scheme}: the disc is the scheme's raised fill`);
          const edge = String(disc.borderColor);
          h.ok(Number(disc.borderWidth) >= 1, `${scheme}: the disc has an edge`);
          for (const under of ['bg', 'surface'] as const) {
            const ratio = contrastRatio(edge, c[under]);
            h.ok(ratio >= 3, `${scheme}: its edge is ${ratio.toFixed(2)}:1 on ${under}, at least 3:1`);
          }
        }
        const dark = flat(discOf(tree));
        h.ok(contrastRatio(String(dark.backgroundColor), COLORS.dark.bg) > 1.2, 'in dark the fill itself is lighter than bg, never the same dark');
      });
    } finally {
      setColorScheme('light');
    }
  });

  await h.test('orb: an ember dot when a new version is ready, a danger dot when a change failed, none at rest or while changing; the label names the state', async () => {
    resetNativeStorage();
    const cases = [
      { state: 'rest', dot: null, label: 'Whim menu' },
      { state: 'changing', dot: null, label: 'Whim menu, making a change' },
      { state: 'ready', dot: COLORS.light.ember, label: 'Whim menu, new version ready' },
      { state: 'failed', dot: COLORS.light.danger, label: 'Whim menu, change failed' },
    ] as const;
    for (const c of cases) {
      await withOrb({ state: c.state }, async (tree) => {
        const dots = dotsOf(tree);
        h.eq(dots.map((d) => [flat(d).backgroundColor, flat(d).width, flat(d).height]), c.dot === null ? [] : [[c.dot, 8, 8]], `${c.state}: ${c.dot === null ? 'no dot' : 'one 8 pt dot'}`);
        h.eq(orbOf(tree).props.accessibilityLabel, c.label, `${c.state}: read as "${c.label}"`);
      });
    }
  });

  await h.test('orb: a screen reader reads "Whim menu" with the one action "Move to the other corner", which moves it and is remembered', async () => {
    resetNativeStorage();
    await withOrb({}, async (tree) => {
      const orb = orbOf(tree);
      h.eq(orb.props.accessibilityRole, 'button', 'announced as a button');
      h.eq(orb.props.accessibilityLabel, 'Whim menu', 'named "Whim menu"');
      const actions = (orb.props.accessibilityActions ?? []) as { name: string; label?: string }[];
      h.eq(actions.map((a) => a.label), ['Move to the other corner'], 'with one action, "Move to the other corner"');
      await TestRenderer.act(async () => { orbOf(tree).props.onAccessibilityAction({ nativeEvent: { actionName: actions[0].name } }); });
      h.eq(targetRect(tree).left, bounds.leading, 'the action moves it bottom-leading');
      h.eq(stored('app-a'), 'leading', 'and is remembered');
      await TestRenderer.act(async () => { orbOf(tree).props.onAccessibilityAction({ nativeEvent: { actionName: actions[0].name } }); });
      h.eq(targetRect(tree).left, bounds.trailing, 'again, back bottom-trailing');
    });
  });

  await h.test('orb: at rest it draws its disc and nothing around it: no dim layer, no shape outside its target, no elevation (#105)', async () => {
    resetNativeStorage();
    for (const state of ['rest', 'ready'] as const) {
      await withOrb({ state }, async (tree) => {
        const views = tree.root.findAll((n) => typeof n.type === 'string');
        h.eq(views.filter((n) => hostType(n) === 'Modal').length, 0, `${state}: no overlay is up`);
        const oversized = views.filter((n) => Number(flat(n).width ?? 0) > 52 || Number(flat(n).height ?? 0) > 52 || (flat(n).top === 0 && flat(n).bottom === 0));
        h.eq(oversized.map((n) => hostType(n)), [], `${state}: nothing larger than the 52 pt target, and nothing spanning the screen`);
        const fills = views.filter((n) => flat(n).backgroundColor !== undefined && flat(n).backgroundColor !== 'transparent');
        h.ok(fills.every((n) => opaque(flat(n).backgroundColor)), `${state}: every fill is opaque, so nothing dims what is under it`);
        h.ok(views.every((n) => !('elevation' in flat(n))), `${state}: no elevation anywhere (it drew a grey disc on Android)`);
      });
    }
  });
}
