/** Opening and closing apps fast, in any order, through the real shell (design-system-v1 19f: an app
 *  seen stuck on its opening plate after a quick close and reopen, once on each platform). Random
 *  sequences, from a fixed 32-bit generator, of what a person does — open an app, the orb's Whim sheet,
 *  Back to your apps, Android back, a swipe that closes the sheet, reopening the same app or another, a
 *  flung orb, Reload from the crash screen, Report a problem and back, History from the app or from
 *  Home and leaving it (Back, system back, an iOS swipe, a quick double tap, or Back with an app link
 *  arriving during the pop) — interleaved with what
 *  the WebViews do meanwhile (a page finishing its load, answering the warm probe, a realm's first
 *  paint). After every step: one launch bound while an app shows and none on Home, a loaded page bound
 *  to the launch holds that launch's delivery so its paint can open it, a painted app is not covered,
 *  no overlay is left on screen or holding the screen once nothing wants it, and the native stack was
 *  not unmounted while a push or pop of it ran (iOS shows a blank Home next, design-system-v1 19f3). */
import TestRenderer from 'react-test-renderer';
import { StyleSheet } from 'react-native';
import { Harness } from './harness';
import { COPY } from '../copy';
import HomeScreen from '../HomeScreen';
import HistoryScreen from '../HistoryScreen';
import MiniAppView from '../MiniAppView';
import { AppCrashed } from '../AppCrashed';
import type { InstalledApp } from '../app-index';
import { WARM_ANSWER, WARM_PROBE_JS } from '../webview-pool';
import { DISMISS_REPORT_MS } from '../../ui/OverlayModal';
import { appLinkFor } from '../app-link';
import { hardwareBack, modalPresentations, openLink, Platform } from './native-host';
import type { PanConfig } from './native-gesture-handler';
import { pan } from './native-gesture-handler';
import { iosPop, stackMoveEnds, stackUnmountsMidMove } from './native-screens';
import { androidBack, button, hostType, isHost, press } from './react-screen';
import { makingSheetOpen, settle, tap, waitFor, withLauncher, type Tree } from './rendered-launcher';
import { hasButton, home, orb, showing } from './whim-sheet-ui.suite';
import { opening, paint, send } from './changing-in-use-ui.suite';
import RENDER_ERROR_FRAME from './render-error-frame.json';
import { mulberry32 } from './mulberry32';
import { log } from '../../logging';

type Node = TestRenderer.ReactTestInstance;

const STEP_KINDS = ['open', 'sheet', 'backToApps', 'androidBack', 'swipeClose', 'reopen', 'fling', 'reload', 'report', 'history', 'historyBack', 'historyDoubleBack', 'linkDuringHistoryPop'] as const;
type StepKind = (typeof STEP_KINDS)[number];
const PAGE_EVENTS = ['load', 'answer', 'paint'] as const;
type PageEvent = (typeof PAGE_EVENTS)[number];
/** How often, over all runs, each step kind and page event must have run for the runs to count. */
const MIN_EACH = 15;
/** Steps in one run: long enough that the kinds which need a particular state first (a report needs
 *  the Whim sheet open, a double Back needs History) still reach `MIN_EACH` at the fixed seeds. */
const STEPS_PER_RUN = 250;

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

/** What the test has made each page do, by the WebView's own scripts array. */
interface PageLog {
  loaded: WeakSet<string[]>;
  answered: WeakSet<string[]>;
  painted: WeakSet<string[]>;
}

const crashedIn = (tree: Tree) => tree.root.findAllByType(AppCrashed).length > 0;

/** Where the launches break a promise: one launch shown at most, Home exactly when no app is, no
 *  WebView bound on Home and exactly one under a running app. */
function launchViolations(tree: Tree): string[] {
  const found: string[] = [];
  const shown = showing(tree, MiniAppView);
  if (tree.root.findAllByType(MiniAppView).length > 1) found.push('two launches shown');
  if (showing(tree, HomeScreen) === shown) found.push(shown ? 'Home drawn under the open app' : 'neither Home nor an app');
  const bound = boundWebViews(tree);
  if (!shown && bound.length > 0) found.push(`${bound.length} WebView(s) bound on Home`);
  if (shown && !crashedIn(tree) && bound.length !== 1) found.push(`${bound.length} WebViews bound to the open app`);
  return found;
}

/** Where the WebViews break a promise: none delivered into twice or kept after its launch, a loaded
 *  page bound to a running app holding its delivery, a painted app uncovered. */
function deliveryViolations(tree: Tree, pages: PageLog): string[] {
  const found: string[] = [];
  const bound = boundWebViews(tree);
  for (const web of tree.root.findAll(isWebView)) {
    const delivered = deliveriesInto(web).length;
    if (delivered > 1) found.push('a WebView delivered into twice');
    if (delivered > 0 && !bound.includes(web)) found.push('a delivered WebView kept after its launch');
  }
  if (!showing(tree, MiniAppView) || crashedIn(tree) || bound.length !== 1) return found;
  const web = bound[0];
  if (pages.loaded.has(scriptsOf(web)) && deliveriesInto(web).length !== 1) {
    found.push('the bound page has loaded but holds no delivery: its paint can never come');
  }
  if (pages.painted.has(scriptsOf(web)) && (opening(tree) || covered(web))) found.push('a painted app is covered');
  return found;
}

/** Where the overlays break a promise: a Modal mounted with no sheet wanted, the wanted sheet not the
 *  one visible Modal, or a presentation refused since `refusedBefore`. */
function overlayViolations(tree: Tree, refusedBefore: number): string[] {
  const found: string[] = [];
  const modals = tree.root.findAll(isHost('Modal'));
  const wanted = makingSheetOpen(tree);
  if (!wanted && modals.length > 0) found.push(`${modals.length} Modal(s) left mounted with no sheet wanted`);
  if (wanted && !(modals.length === 1 && modals[0].props.visible === true)) found.push('the wanted sheet is not presented');
  if (modalPresentations.refused !== refusedBefore) found.push('a presentation was refused');
  return found;
}

/** One thing a page could do now, picked with `pick`: a WebView finishing its load, a probed one
 *  answering, a delivered bound one painting; `null` when none can. */
function pickPageEvent(tree: Tree, pages: PageLog, pick: <T>(list: readonly T[]) => T): [PageEvent, Node] | null {
  const webs = tree.root.findAll(isWebView);
  const choices: [PageEvent, Node][] = [
    ...webs.filter((w) => !pages.loaded.has(scriptsOf(w))).map((w): [PageEvent, Node] => ['load', w]),
    ...webs.filter((w) => scriptsOf(w).includes(WARM_PROBE_JS) && !pages.answered.has(scriptsOf(w))).map((w): [PageEvent, Node] => ['answer', w]),
    ...boundWebViews(tree).filter((w) => deliveriesInto(w).length > 0 && !pages.painted.has(scriptsOf(w))).map((w): [PageEvent, Node] => ['paint', w]),
  ];
  return choices.length === 0 ? null : pick(choices);
}

/** `web`'s page does `event`; a bound launch's own paint must open it. */
async function firePageEvent(tree: Tree, pages: PageLog, event: PageEvent, web: Node, fail: (what: string) => void): Promise<void> {
  const scripts = scriptsOf(web);
  if (event === 'load') {
    pages.loaded.add(scripts);
    await TestRenderer.act(async () => web.props.onLoadEnd());
  } else if (event === 'answer') {
    pages.answered.add(scripts);
    await TestRenderer.act(async () => web.props.onMessage({ nativeEvent: { data: WARM_ANSWER } }));
  } else {
    pages.painted.add(scripts);
    await send(web.props.onMessage, paint(generationIn(web)));
    if (opening(tree)) fail('the bound launch’s own paint did not open it');
  }
}

/** `taps` in one act: a second tap lands before anything the first started has finished. */
const tapsInOneAct = (...taps: (() => void)[]): Promise<void> =>
  TestRenderer.act(async () => {
    for (const tapOnce of taps) tapOnce();
  });

/** `kind count, …` for a pass or failure message. */
const tally = (counts: Record<string, number>): string =>
  Object.entries(counts)
    .map(([kind, n]) => `${kind} ${n}`)
    .join(', ');

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
      const pages: PageLog = { loaded: new WeakSet(), answered: new WeakSet(), painted: new WeakSet() };
      let last: InstalledApp | null = null;
      const trail: string[] = [];
      const fail = (what: string) => {
        ran.violations.push(`${platform} seed ${seed}, after ${trail.slice(-8).join(' → ')}: ${what}`);
      };

      const appShown = () => showing(tree, MiniAppView);
      const crashed = () => crashedIn(tree);
      const sheetUp = () => tree.root.findAll(isSheetCard).length > 0;
      const menuUp = () => sheetUp() && hasButton(tree, COPY.whimSheetBackToApps);
      const historyUp = () => showing(tree, HistoryScreen);
      // Where History was opened from, so where leaving it lands: the app it was opened over, or Home.
      let historyOver: 'app' | 'home' = 'home';
      const historyLeft = (how: string) =>
        waitFor(() => !historyUp() && (historyOver === 'app' ? appShown() : showing(tree, HomeScreen)), `${how} to leave History for ${historyOver}`);
      // History's own Back and system back, as a person's single tap on each delivers it.
      const historyTaps = (): (() => void)[] => {
        const back = button(tree, COPY.backLabel);
        return [() => back.props.onPress(), () => { hardwareBack(); }];
      };

      const pageEvent = async (): Promise<boolean> => {
        const choice = pickPageEvent(tree, pages, pick);
        if (choice === null) return false;
        const [event, web] = choice;
        await firePageEvent(tree, pages, event, web, fail);
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
          can: () => !appShown() && !historyUp(),
          run: () => openFromHome(pick(apps.filter((a) => a.id !== last?.id))),
        },
        reopen: {
          can: () => !appShown() && !historyUp() && last !== null,
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
        history: {
          can: () => menuUp() || (!appShown() && !historyUp()),
          run: async () => {
            historyOver = menuUp() ? 'app' : 'home';
            if (historyOver === 'app') await press(button(tree, COPY.actionHistory));
            else await TestRenderer.act(async () => home(tree).props.onHistory(pick(apps)));
            await waitFor(() => historyUp(), 'History');
          },
        },
        historyBack: {
          can: () => historyUp(),
          run: async () => {
            const [back, system] = historyTaps();
            const leaves = [() => tapsInOneAct(back), () => tapsInOneAct(system)];
            if (platform === 'ios') leaves.push(() => iosPop(tree));
            await pick(leaves)();
            await historyLeft('a Back');
          },
        },
        historyDoubleBack: {
          can: () => historyUp(),
          run: async () => {
            const taps = historyTaps();
            await tapsInOneAct(pick(taps), pick(taps));
            await historyLeft('a double Back');
          },
        },
        linkDuringHistoryPop: {
          can: () => historyUp() && historyOver === 'home',
          run: async () => {
            const app = pick(apps);
            last = app;
            await tapsInOneAct(pick(historyTaps()), () => openLink(appLinkFor(app.id)));
            await settle(4);
            // The platform finishes the pop; the link lands after it.
            await stackMoveEnds();
            await waitFor(() => appShown(), `the link to ${app.name} to open after the pop`);
          },
        },
      };

      const check = () => {
        for (const what of [...launchViolations(tree), ...deliveryViolations(tree, pages),...overlayViolations(tree, refusedBefore)]) fail(what);
      };

      for (let i = 0; i < steps; i++) {
        if (random() < 0.35 && (await pageEvent())) {
          check();
          continue;
        }
        const possible = STEP_KINDS.filter((k) => steps_[k].can());
        const kind = pick(possible);
        trail.push(kind);
        const midMove = stackUnmountsMidMove();
        await steps_[kind].run();
        ran.kinds[kind] += 1;
        await settle(4);
        // Time a dismissal may take to be reported passes (iOS).
        await TestRenderer.act(async () => { clock.fireWithin(DISMISS_REPORT_MS); });
        check();
        if (stackUnmountsMidMove() !== midMove) fail('the native stack was unmounted while a push or pop of it ran (iOS shows a blank Home next)');
        if (ran.violations.length > 0) return;
        // The person's next tap comes once the platform's push or pop has ended.
        await stackMoveEnds();
      }
    });
  } finally {
    Date.now = realNow;
    Platform.OS = previousOs;
    // Hundreds of steps fill the log ring (500 records); a later suite that reads what it logged by the
    // ring's size before it started would then miss its own records.
    log.buffer.clear();
  }
}

export async function runLauncherStressUiTests(h: Harness): Promise<void> {
  await h.test('launcher stress: random fast sequences of opening, closing and reopening apps, the Whim sheet, back, swipe, fling, Reload, Report and History keep one launch bound, its paint able to open it, nothing over a painted app, no overlay left behind and no native stack unmounted mid-move', async () => {
    const ran: Ran = {
      kinds: Object.fromEntries(STEP_KINDS.map((k) => [k, 0])) as Record<StepKind, number>,
      events: Object.fromEntries(PAGE_EVENTS.map((k) => [k, 0])) as Record<PageEvent, number>,
      violations: [],
    };
    for (const platform of ['ios', 'android'] as const) {
      for (const seed of [0x19f, 0xc0ffee, 7, 0x5eed]) {
        await stress({ seed, platform, steps: STEPS_PER_RUN }, ran);
        if (ran.violations.length > 0) break;
      }
      if (ran.violations.length > 0) break;
    }
    h.eq(ran.violations, [], 'no step left the shell in a state a person could get stuck in');
    // Coverage, printed with every run: a step kind or page event that ran only a few times tests little.
    console.log(`  steps: ${tally(ran.kinds)}; page events: ${tally(ran.events)}`);
    const rare = STEP_KINDS.filter((k) => ran.kinds[k] < MIN_EACH);
    h.eq(rare, [], `every step kind ran at least ${MIN_EACH} times (${tally(ran.kinds)})`);
    const quiet = PAGE_EVENTS.filter((k) => ran.events[k] < MIN_EACH);
    h.eq(quiet, [], `every page event ran at least ${MIN_EACH} times (${tally(ran.events)})`);
  });
}
