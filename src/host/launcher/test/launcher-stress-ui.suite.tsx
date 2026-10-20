/** Opening and closing apps fast, in any order, through the real shell (design-system-v1 19f: an app
 *  seen stuck on its opening plate after a quick close and reopen, once on each platform). Random
 *  sequences, from a fixed 32-bit generator, of what a person does — open an app, the orb's Whim sheet,
 *  Back to your apps, Android back, a swipe that closes the sheet, reopening the same app or another, a
 *  flung orb, Reload from the crash screen, Report a problem and back — interleaved with what the
 *  WebViews do meanwhile (a page finishing its load, answering the warm probe, a realm's first paint).
 *  After every step: one launch bound while an app shows and none on Home, a loaded page bound to the
 *  launch holds that launch's delivery so its paint can open it, a painted app is not covered, and no
 *  overlay is left on screen or holding the screen once nothing wants it. */
import TestRenderer from 'react-test-renderer';
import { StyleSheet } from 'react-native';
import { Harness } from './harness';
import { COPY } from '../copy';
import HomeScreen from '../HomeScreen';
import MiniAppView from '../MiniAppView';
import { AppCrashed } from '../AppCrashed';
import type { InstalledApp } from '../app-index';
import { WARM_ANSWER, WARM_PROBE_JS } from '../webview-pool';
import { DISMISS_REPORT_MS } from '../../ui/OverlayModal';
import { hardwareBack, modalPresentations, Platform } from './native-host';
import type { PanConfig } from './native-gesture-handler';
import { pan } from './native-gesture-handler';
import { androidBack, button, hostType, isHost, press } from './react-screen';
import { makingSheetOpen, settle, tap, waitFor, withLauncher, type Tree } from './rendered-launcher';
import { hasButton, home, orb, showing } from './whim-sheet-ui.suite';
import { opening, paint, send } from './changing-in-use-ui.suite';
import RENDER_ERROR_FRAME from './render-error-frame.json';

type Node = TestRenderer.ReactTestInstance;

/** A 32-bit generator (mulberry32): the same seed, the same sequence, on every machine. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const STEP_KINDS = ['open', 'sheet', 'backToApps', 'androidBack', 'swipeClose', 'reopen', 'fling', 'reload', 'report'] as const;
type StepKind = (typeof STEP_KINDS)[number];
const PAGE_EVENTS = ['load', 'answer', 'paint'] as const;
type PageEvent = (typeof PAGE_EVENTS)[number];

const isWebView = isHost('WebView');
/** A WebView's own record of the scripts it was handed: the same array for its whole life. */
const scriptsOf = (web: Node): string[] => web.props.injected as string[];
const deliveriesInto = (web: Node) => scriptsOf(web).filter((s) => s.includes('__whimControl.reinject('));
const generationIn = (web: Node) => Number(/,generation:(\d+)/.exec(deliveriesInto(web).at(-1) ?? '')?.[1]);

/** Whether a touch can reach `web`: no view around it takes none. */
function reachable(web: Node): boolean {
  for (let n: Node | null = web.parent; n !== null; n = n.parent) {
    if (hostType(n) === 'View' && n.props.pointerEvents === 'none') return false;
  }
  return true;
}
/** The WebViews bound to a launch (the ones an open app's touches reach). */
const boundWebViews = (tree: Tree) => tree.root.findAll(isWebView).filter(reachable);

type Style = { backgroundColor?: string; opacity?: number; top?: number; bottom?: number; left?: number; right?: number };
const flat = (node: Node): Style => (StyleSheet.flatten(node.props.style) ?? {}) as Style;
/** The nearest view above `node` that keeps its own native view (`collapsable={false}`). */
function keptViewAbove(node: Node): Node {
  for (let n = node.parent; n !== null; n = n.parent) if (hostType(n) === 'View' && n.props.collapsable === false) return n;
  throw new Error('no kept view above');
}
/** What `container` draws, bottom first; a component without a style of its own stands for its views. */
function layersOf(container: Node): Node[] {
  const drawn = (node: Node): Node[] =>
    typeof node.type !== 'string' && node.props.style === undefined
      ? node.children.filter((c): c is Node => typeof c !== 'string').flatMap(drawn)
      : [node];
  return container.children.filter((c): c is Node => typeof c !== 'string').flatMap(drawn);
}
/** Whether an opaque layer spanning the whole app area is drawn over the bound WebView `web`. */
function covered(web: Node): boolean {
  const slot = keptViewAbove(web);
  const layers = layersOf(keptViewAbove(slot));
  const after = layers.slice(layers.findIndex((layer) => layer === slot || layer.findAll((n) => n === slot).length > 0) + 1);
  return after.some((layer) => {
    const s = flat(layer);
    const spans = s.top === 0 && s.bottom === 0 && s.left === 0 && s.right === 0;
    return spans && s.backgroundColor !== undefined && s.backgroundColor !== 'transparent' && s.opacity !== 0;
  });
}

/** The drag of the gesture detector holding `inside`. */
function dragAround(tree: Tree, inside: (n: Node) => boolean): PanConfig {
  const detectors = tree.root.findAll((n) => hostType(n) === 'GestureDetector' && n.findAll(inside).length > 0);
  const found = detectors.at(-1);
  if (!found) throw new Error('no gesture detector there');
  return found.props.gesture as PanConfig;
}
const isOrb = (n: Node) => hostType(n) === 'Pressable' && String(n.props.accessibilityLabel).startsWith(COPY.orbMenuOpenLabel);
const isSheetCard = (n: Node) => typeof n.type === 'string' && n.props.accessibilityViewIsModal === true;
/** The open sheet's drag: the gesture detector on its header, inside its card. */
function sheetDrag(tree: Tree): PanConfig {
  const card = tree.root.findAll(isSheetCard).at(-1);
  const detector = card?.findAll((n) => hostType(n) === 'GestureDetector')[0];
  if (!detector) throw new Error('no sheet to drag');
  return detector.props.gesture as PanConfig;
}

/** A horizontal fling of the orb toward the other corner, as the pan reports it. */
function flingOrb(config: PanConfig, dx: number): void {
  const at = (translationX: number, velocityX = 0) => ({ translationX, translationY: -8, velocityX, velocityY: 0 });
  config.onBegin?.(at(0));
  config.onActivate?.(at(Math.sign(dx) * 12));
  for (const step of [0.3, 0.7, 1]) config.onUpdate?.(at(dx * step, dx * 4));
  config.onDeactivate?.(at(dx, dx * 6));
  config.onFinalize?.(at(dx, dx * 6));
}

interface Run {
  seed: number;
  platform: 'ios' | 'android';
  steps: number;
}

/** What a run did, for its checks and the record of which step kinds ran. */
interface Ran {
  kinds: Record<StepKind, number>;
  events: Record<PageEvent, number>;
  violations: string[];
}

async function stress({ seed, platform, steps }: Run, ran: Ran): Promise<void> {
  const random = mulberry32(seed);
  const pick = <T,>(list: readonly T[]): T => list[Math.floor(random() * list.length)];
  // Every tap is a launch of its own: two taps never share a millisecond, as no person's do.
  const realNow = Date.now;
  let tick = 0;
  Date.now = () => realNow() + ++tick;
  const previousOs = Platform.OS;
  Platform.OS = platform;
  const refusedBefore = modalPresentations.refused;
  try {
    await withLauncher({ examples: true, server: () => new Promise<Response>(() => {}) }, async ({ tree, clock }) => {
      await waitFor(() => showing(tree, HomeScreen) && home(tree).props.apps.length > 1, 'the example apps');
      const apps = home(tree).props.apps as InstalledApp[];
      // Which pages the test has finished loading or had answer the probe (by the WebView's own scripts).
      const loaded = new WeakSet<string[]>();
      const answered = new WeakSet<string[]>();
      // The launch whose paint the test has sent, by its WebView.
      const painted = new WeakSet<string[]>();
      let last: InstalledApp | null = null;
      const trail: string[] = [];
      const fail = (what: string) => {
        ran.violations.push(`${platform} seed ${seed}, after ${trail.slice(-8).join(' → ')}: ${what}`);
      };

      const appShown = () => showing(tree, MiniAppView);
      const crashed = () => tree.root.findAllByType(AppCrashed).length > 0;
      const sheetUp = () => tree.root.findAll(isSheetCard).length > 0;
      const menuUp = () => sheetUp() && hasButton(tree, COPY.whimSheetBackToApps);

      const pageEvent = async (): Promise<boolean> => {
        const webs = tree.root.findAll(isWebView);
        const bound = boundWebViews(tree);
        const choices: [PageEvent, Node][] = [
          ...webs.filter((w) => !loaded.has(scriptsOf(w))).map((w): [PageEvent, Node] => ['load', w]),
          ...webs.filter((w) => scriptsOf(w).includes(WARM_PROBE_JS) && !answered.has(scriptsOf(w))).map((w): [PageEvent, Node] => ['answer', w]),
          ...bound.filter((w) => deliveriesInto(w).length > 0 && !painted.has(scriptsOf(w))).map((w): [PageEvent, Node] => ['paint', w]),
        ];
        if (choices.length === 0) return false;
        const [event, web] = pick(choices);
        const scripts = scriptsOf(web);
        if (event === 'load') {
          loaded.add(scripts);
          await TestRenderer.act(async () => web.props.onLoadEnd());
        } else if (event === 'answer') {
          answered.add(scripts);
          await TestRenderer.act(async () => web.props.onMessage({ nativeEvent: { data: WARM_ANSWER } }));
        } else {
          painted.add(scripts);
          await send(web.props.onMessage, paint(generationIn(web)));
          if (opening(tree)) fail('the bound launch’s own paint did not open it');
        }
        ran.events[event] += 1;
        trail.push(event);
        return true;
      };

      const openFromHome = async (app: InstalledApp) => {
        last = app;
        await tap(() => home(tree).props.onOpen(app));
        // The page may do something while the bundle is read.
        if (random() < 0.5) await pageEvent();
        await waitFor(() => appShown(), `${app.name} to open`);
      };

      const steps_: Record<StepKind, { can: () => boolean; run: () => Promise<void> }> = {
        open: {
          can: () => !appShown(),
          run: () => openFromHome(pick(apps.filter((a) => a.id !== last?.id))),
        },
        reopen: {
          can: () => !appShown() && last !== null,
          run: () => openFromHome(random() < 0.6 && last ? last : pick(apps)),
        },
        sheet: {
          can: () => appShown() && !sheetUp(),
          run: async () => {
            await press(orb(tree));
            await waitFor(() => menuUp(), 'the Whim sheet');
          },
        },
        backToApps: {
          can: () => menuUp(),
          run: () => press(button(tree, COPY.whimSheetBackToApps)),
        },
        androidBack: {
          can: () => appShown(),
          run: async () => {
            if (sheetUp()) await androidBack(tree);
            else await TestRenderer.act(async () => { hardwareBack(); });
          },
        },
        swipeClose: {
          can: () => sheetUp(),
          run: () => TestRenderer.act(async () => pan(sheetDrag(tree), [100, 220, 330], 600)),
        },
        fling: {
          can: () => appShown() && !sheetUp(),
          run: () => TestRenderer.act(async () => flingOrb(dragAround(tree, isOrb), pick([-260, 260]))),
        },
        reload: {
          can: () => appShown() && !sheetUp() && (crashed() || boundWebViews(tree).some((w) => deliveriesInto(w).length > 0)),
          run: async () => {
            const launch = tree.root.findByType(MiniAppView).props.tappedAt;
            if (!crashed()) await send(boundWebViews(tree)[0].props.onMessage, RENDER_ERROR_FRAME);
            await waitFor(() => crashed(), 'the crash screen');
            await press(button(tree, COPY.actionReload));
            await waitFor(() => appShown() && tree.root.findByType(MiniAppView).props.tappedAt !== launch, 'Reload to open the app again');
          },
        },
        report: {
          can: () => menuUp(),
          run: async () => {
            await press(button(tree, COPY.reportScreenTitle));
            await waitFor(() => hasButton(tree, COPY.reportSend), 'the report form');
            await press(button(tree, COPY.backLabel));
          },
        },
      };

      const check = () => {
        const shown = appShown();
        if (tree.root.findAllByType(MiniAppView).length > 1) fail('two launches shown');
        if (showing(tree, HomeScreen) === shown) fail(shown ? 'Home drawn under the open app' : 'neither Home nor an app');
        const bound = boundWebViews(tree);
        if (!shown && bound.length > 0) fail(`${bound.length} WebView(s) bound on Home`);
        if (shown && !crashed() && bound.length !== 1) fail(`${bound.length} WebViews bound to the open app`);
        for (const web of tree.root.findAll(isWebView)) {
          const delivered = deliveriesInto(web).length;
          if (delivered > 1) fail('a WebView delivered into twice');
          if (delivered > 0 && !bound.includes(web)) fail('a delivered WebView kept after its launch');
        }
        if (shown && !crashed() && bound.length === 1) {
          const web = bound[0];
          if (loaded.has(scriptsOf(web)) && deliveriesInto(web).length !== 1) fail('the bound page has loaded but holds no delivery: its paint can never come');
          if (painted.has(scriptsOf(web)) && (opening(tree) || covered(web))) fail('a painted app is covered');
        }
        const modals = tree.root.findAll(isHost('Modal'));
        if (!makingSheetOpen(tree) && modals.length > 0) fail(`${modals.length} Modal(s) left mounted with no sheet wanted`);
        if (makingSheetOpen(tree) && !(modals.length === 1 && modals[0].props.visible === true)) fail('the wanted sheet is not presented');
        if (modalPresentations.refused !== refusedBefore) fail('a presentation was refused');
      };

      for (let i = 0; i < steps; i++) {
        if (random() < 0.35 && (await pageEvent())) {
          check();
          continue;
        }
        const possible = STEP_KINDS.filter((k) => steps_[k].can());
        const kind = pick(possible);
        trail.push(kind);
        await steps_[kind].run();
        ran.kinds[kind] += 1;
        await settle(4);
        // Time a dismissal may take to be reported passes (iOS).
        await TestRenderer.act(async () => { clock.fireWithin(DISMISS_REPORT_MS); });
        check();
        if (ran.violations.length > 0) return;
      }
    });
  } finally {
    Date.now = realNow;
    Platform.OS = previousOs;
  }
}

export async function runLauncherStressUiTests(h: Harness): Promise<void> {
  await h.test('launcher stress: random fast sequences of opening, closing and reopening apps, the Whim sheet, back, swipe, fling, Reload and Report keep one launch bound, its paint able to open it, nothing over a painted app and no overlay left behind', async () => {
    const ran: Ran = {
      kinds: Object.fromEntries(STEP_KINDS.map((k) => [k, 0])) as Record<StepKind, number>,
      events: Object.fromEntries(PAGE_EVENTS.map((k) => [k, 0])) as Record<PageEvent, number>,
      violations: [],
    };
    for (const platform of ['ios', 'android'] as const) {
      for (const seed of [0x19f, 0xc0ffee, 7, 0x5eed]) {
        await stress({ seed, platform, steps: 60 }, ran);
        if (ran.violations.length > 0) break;
      }
      if (ran.violations.length > 0) break;
    }
    h.eq(ran.violations, [], 'no step left the shell in a state a person could get stuck in');
    const idle = STEP_KINDS.filter((k) => ran.kinds[k] === 0);
    h.eq(idle, [], `every step kind ran (${STEP_KINDS.map((k) => `${k} ${ran.kinds[k]}`).join(', ')})`);
    const quiet = PAGE_EVENTS.filter((k) => ran.events[k] === 0);
    h.eq(quiet, [], `every page event ran (${PAGE_EVENTS.map((k) => `${k} ${ran.events[k]}`).join(', ')})`);
  });
}
