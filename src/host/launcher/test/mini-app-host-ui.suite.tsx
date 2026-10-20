/** A rendered mini-app container (`MiniAppView` over `useMiniAppHost`) driven the way its WebView
 *  drives it: page-load events and frames from the sandbox page. Covers the boot surface and the
 *  startup deadline, which frames it trusts, delivering once per WebView mount, the recovery screen
 *  for a bundle that fails, launch refusal, and releasing the app's storage on unmount. */
import React from 'react';
import TestRenderer from 'react-test-renderer';
import { Harness } from './harness';
import { COPY, appCrashedTitle } from '../copy';
import { MiniAppStage, type MiniAppLaunch } from '../MiniAppView';
import { STARTUP_DEADLINE_MS } from '../boot-state';
import type { InstalledApp } from '../app-index';
import type { AppRecord } from '../../bridge';
import { createStorageEngine } from '../../storage-engine';
import { DEFAULT_THEME, sanitizeTheme } from '../../../sdk/theme';
import { COLORS, ON_TINT, TILE_RIM, TINTS } from '../../../design/tokens';
import { buttonColors, resolveTokens } from '../../ui/tokens-pure';
import { APP_BUNDLES } from '../../../runtime/generated/app-bundles';
import { APP_RECORDS } from '../../../runtime/generated/app-records';
import { DiagnosticsBatch } from '@whim/contract';
import { log } from '../../logging';
import { accessibilitySettings, emitAccessibility, hardwareBack, injectedScripts, Platform, setColorScheme, StyleSheet, windowMetrics } from './native-host';
import { keyboardWindow, moveKeyboard, resetKeyboard } from './native-keyboard-controller';
import RENDER_ERROR_FRAME from './render-error-frame.json';
import { closedDatabases, resetNativeStorage } from './native-storage';
import { button, captureTimeouts, press, renderScreen, textOf, unmountScreen, hostType } from './react-screen';
import { animations, isStep } from './native-reanimated';
import { TilePlate } from '../../ui/AppTile';
import { SHELL_PALETTE } from '../theme';
import { WARM_ANSWER, WARM_PROBE_JS } from '../webview-pool';
import { RUNTIME_HTML } from '../../../runtime/generated/runtime-html';
import { SYSCALL_VERSION } from '../../bridge/contract';

type Tree = TestRenderer.ReactTestRenderer;

const TIP: AppRecord = APP_RECORDS['tip-splitter'];
const WATER: AppRecord = APP_RECORDS['water-counter'];
const LATENCY: AppRecord = APP_RECORDS['latency-probe'];

interface Mounted {
  tree: Tree;
  exits: () => number;
  clock: ReturnType<typeof captureTimeouts>;
  webView: () => TestRenderer.ReactTestInstance | undefined;
  loadEnd: () => Promise<void>;
  frame: (frame: unknown) => Promise<void>;
  shown: () => string;
  /** The opening state is up: the progress element that announces the app is opening. */
  opening: () => boolean;
  /** Nothing opaque is drawn over the app's page. */
  pageShown: () => boolean;
}

type Style = { backgroundColor?: string; opacity?: number; color?: string; position?: string; top?: number; bottom?: number; left?: number; right?: number };
const flat = (node: TestRenderer.ReactTestInstance): Style => StyleSheet.flatten(node.props.style) as Style;

/** The view that holds the WebViews: the container's own background (the outermost such view). */
const containerOf = (tree: Tree) => tree.root.findAll((n) => hostType(n) === 'View' && n.findAll(isWebView).length > 0)[0];

/** A layer laid over the whole container (all four insets 0). */
function spansContainer(node: TestRenderer.ReactTestInstance): boolean {
  const s = flat(node);
  return s.top === 0 && s.bottom === 0 && s.left === 0 && s.right === 0;
}

/** What `container` draws, bottom first: a component that only groups views (no style of its own)
 *  stands for the views it renders. */
function layersOf(container: TestRenderer.ReactTestInstance): TestRenderer.ReactTestInstance[] {
  const drawn = (node: TestRenderer.ReactTestInstance): TestRenderer.ReactTestInstance[] =>
    typeof node.type !== 'string' && node.props.style === undefined
      ? node.children.filter((c): c is TestRenderer.ReactTestInstance => typeof c !== 'string').flatMap(drawn)
      : [node];
  return container.children.filter((c): c is TestRenderer.ReactTestInstance => typeof c !== 'string').flatMap(drawn);
}

/** The container's layers that hold a WebView (one per WebView), bottom first. */
const slotsOf = (tree: Tree) => layersOf(containerOf(tree)).filter((layer) => layer.findAll(isWebView).length > 0);

/** The native view a layer puts into the container: itself, or the first host view it renders. */
const nativeOf = (layer: TestRenderer.ReactTestInstance) =>
  typeof layer.type === 'string' ? layer : layer.findAll((n) => typeof n.type === 'string')[0];

/** Whether a touch on the container can reach the WebView in `slot`, the way Android picks a touch
 *  target: a React Native view with `pointerEvents` `none` takes no touch and passes none to what is
 *  inside it, but the WebView's own `pointerEvents` is never read (react-native-webview's view
 *  manager has no such prop, and `TouchTargetHelper` treats a view it cannot read as `auto`). */
function takesTouches(slot: TestRenderer.ReactTestInstance): boolean {
  const web = slot.findAll(isWebView)[0];
  for (let n = web.parent; n !== null; n = n === slot ? null : n.parent) {
    if (hostType(n) === 'View' && n.props.pointerEvents === 'none') return false;
  }
  return true;
}

/** The container's layer that holds `web`. */
const slotOf = (tree: Tree, web: TestRenderer.ReactTestInstance) => slotsOf(tree).find((slot) => slot.findAll((n) => n === web).length > 0)!;

/** The WebView a touch on the open app lands on: the top-most slot that takes touches. */
const touchedWebView = (tree: Tree) => slotsOf(tree).filter(takesTouches).at(-1)?.findAll(isWebView)[0];

/** Whether the page shows: no layer drawn after the WebView in its container spans the whole
 *  container with an opaque background at a visible opacity (the orb, a small control, does not). */
function pageIsShown(tree: Tree): boolean {
  const layers = layersOf(containerOf(tree));
  const web = touchedWebView(tree);
  const after = layers.slice(layers.findIndex((layer) => web !== undefined && layer.findAll((n) => n === web).length > 0) + 1);
  return !after.some((layer) => {
    const s = flat(layer);
    return spansContainer(layer) && s.backgroundColor !== undefined && s.backgroundColor !== 'transparent' && s.opacity !== 0;
  });
}

/** Where the orb's target is drawn: its left edge and bottom (from its positioned frame and that
 *  frame's slide) and its height. */
function orbPlace(tree: Tree): { left: number; bottom: number; height: number } {
  const orb = button(tree, COPY.orbMenuOpenLabel);
  let frame: TestRenderer.ReactTestInstance | null = orb;
  while (frame && !(typeof frame.type === 'string' && flat(frame).position === 'absolute')) frame = frame.parent;
  if (!frame) throw new Error('the orb has no positioned frame');
  const style = StyleSheet.flatten(frame.props.style) as { left?: number; bottom?: number; transform?: Record<string, number>[] };
  const slide = style.transform?.find((t) => 'translateX' in t)?.translateX ?? 0;
  return { left: (style.left ?? 0) + slide, bottom: style.bottom ?? 0, height: Number((StyleSheet.flatten(orb.props.style) as { height?: number }).height) };
}

/** The orb is drawn: one control whose name starts "Whim menu". */
const orbShown = (tree: Tree) =>
  tree.root.findAll((n) => hostType(n) === 'Pressable' && String(n.props.accessibilityLabel).startsWith(COPY.orbMenuOpenLabel)).length === 1;

const isOpening = (tree: Tree) =>
  tree.root.findAll((n) => typeof n.type === 'string' && n.props.accessibilityRole === 'progressbar' && n.props.accessibilityLabel === COPY.appBootA11yLabel).length > 0;


/** The container's place on its root's page, which fills an 844-high window: below the status
 *  bar, down to the window's bottom edge. */
const MINI_APP_FRAME = { pageY: 47, height: 797 };

/** Hands every view that is measured (`collapsable={false}`) the container's place. */
const measuredAsContainer = (node: React.ReactElement<{ collapsable?: boolean }>) =>
  node.props.collapsable === false
    ? { measure: (cb: (x: number, y: number, w: number, h: number, pageX: number, pageY: number) => void) => cb(0, 0, 390, MINI_APP_FRAME.height, 0, MINI_APP_FRAME.pageY) }
    : null;

const isWebView = (n: TestRenderer.ReactTestInstance) => hostType(n) === 'WebView';

/** How far above the container's bottom edge the page (the WebView) ends. */
function pageInset(tree: Tree): number {
  const container = containerOf(tree);
  const web = touchedWebView(tree)!;
  const pad = (StyleSheet.flatten(container.props.style) as { paddingBottom?: number }).paddingBottom ?? 0;
  return pad + ((StyleSheet.flatten(web.props.style) as { marginBottom?: number }).marginBottom ?? 0);
}

/** The launch of `record` as the launcher hands it over (installed with `tile`, tapped at `tappedAt`). */
function launchOf(
  record: AppRecord,
  opts: { tile?: Pick<InstalledApp, 'tint' | 'icon'>; tappedAt?: number; onExit?: () => void; onReload?: () => void } = {},
): MiniAppLaunch {
  return {
    record,
    bundleSource: APP_BUNDLES[record.appId],
    engineAppId: record.appId,
    tappedAt: opts.tappedAt ?? Date.now(),
    onExit: opts.onExit ?? (() => {}),
    onOpenSheet: () => {},
    sheetOpen: false,
    onCloseSheet: () => {},
    installedApp: { id: record.appId, name: record.name, createdAt: 1, lineageId: 'main', record, ...opts.tile },
    orb: { state: 'rest', activity: 0 },
    onReload: opts.onReload ?? (() => {}),
    onAskFix: () => {},
  };
}

/** The launcher's end of the container's frame, where a test does not read it. */
const ignoreFrame = () => {};

/** Mount the container for `record` (installed with `tile`, if given, and tapped at `tappedAt`), run
 *  `body`, and unmount. The crash screen's Reload opens the app again in place, as the launcher does:
 *  a new launch, tapped now. */
async function withMiniApp(
  record: AppRecord,
  body: (m: Mounted) => Promise<void>,
  tile?: Pick<InstalledApp, 'tint' | 'icon'>,
  tappedAt = Date.now(),
): Promise<void> {
  resetNativeStorage();
  injectedScripts.length = 0;
  const clock = captureTimeouts();
  let exits = 0;
  let launchedAt = tappedAt;
  const stage = (): React.ReactElement => (
    <MiniAppStage launch={launchOf(record, { tile, tappedAt: launchedAt, onExit: () => { exits++; }, onReload: reload })} onFrame={ignoreFrame} />
  );
  const reload = () => {
    launchedAt = Math.max(Date.now(), launchedAt + 1);
    tree.update(stage());
  };
  const tree = await renderScreen(stage(), { createNodeMock: measuredAsContainer });
  // The launch's own WebView, the one a touch reaches: not the one waiting unseen beside it.
  const webView = () => touchedWebView(tree);
  try {
    await body({
      tree,
      exits: () => exits,
      clock,
      webView,
      loadEnd: async () => { await TestRenderer.act(async () => webView()!.props.onLoadEnd()); },
      frame: async (frame) => {
        await TestRenderer.act(async () => webView()!.props.onMessage({ nativeEvent: { data: JSON.stringify(frame) } }));
      },
      shown: () => textOf(tree.root),
      opening: () => isOpening(tree),
      pageShown: () => pageIsShown(tree),
    });
  } finally {
    await unmountScreen(tree);
    clock.restore();
  }
}

/** The generation the latest delivery script bound its realm at (`deliverBySourceJs` writes it into
 *  `reinject({…, generation: N})`); the outer page stamps exactly that onto the realm's `paint`. */
function boundGeneration(): number {
  const delivery = injectedScripts.filter((s) => s.includes('__whimControl.reinject(')).at(-1);
  return Number(/,generation:(\d+)/.exec(delivery ?? '')?.[1]);
}

/** A realm's first paint as the outer page forwards it: nonce-authenticated, stamped with the
 *  generation of the delivery that bound it (the latest one unless given) — the stamp
 *  `npm run launcher:deliver-verify` checks the real page applies. */
function firstPaint(generation = boundGeneration()) {
  return { kind: 'paint', trusted: true, payload: { generation, mountToFirstPaintMs: 42, appName: 'Tip Splitter' } };
}

/** Uncaught realm errors exactly as the outer page forwards them to RN, copied from the frames
 *  `npm run bridge:invariants` (INV-ERRFRAME) records for the error-raiser fixture. */
const RUNTIME_ERROR_FRAME = { kind: 'error', trusted: true, payload: { where: 'runtime', name: 'LedgerError' } };
const REJECTION_ERROR_FRAME = { kind: 'error', trusted: true, payload: { where: 'rejection', name: 'SettleError' } };
// RENDER_ERROR_FRAME (render-error-frame.json) is a render error no boundary in the app caught,
// as the outer page forwards it; `npm run launcher:deliver-verify` asserts the built loader and
// page emit exactly that frame for a mini-app whose re-render throws a `LedgerError`.

/** The theme a delivery script hands the realm (`deliverBySourceJs` appends it last, just before
 *  the `reinject({...})` call closes). */
function deliveredTheme(script: string | undefined): Record<string, unknown> & { colors?: Record<string, unknown>; chromeInsetBottom?: unknown } {
  const json = /,theme:(\{.*\})\}\)/.exec(script ?? '')?.[1];
  return json ? JSON.parse(json) : {};
}

/** A delivered theme without the orb inset, which the loader keeps out of the bundle-visible theme. */
function withoutInset(theme: ReturnType<typeof deliveredTheme>): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...theme };
  delete copy.chromeInsetBottom;
  return copy;
}

const byName = (a: string, b: string) => a.localeCompare(b);

interface ErrorRecordFields { where?: unknown; errorClass?: unknown; appId?: unknown }

/** The `error`-level records the seam holds for mini-app failures, oldest first. */
function miniAppErrorRecords(): { message: string; fields: ErrorRecordFields }[] {
  return log.buffer
    .snapshot()
    .filter((r) => r.level === 'error' && r.channel === 'whim:page')
    .map((r) => ({ message: r.message, fields: (r.fields ?? {}) as ErrorRecordFields }));
}

/** Counts the startup deadlines armed from now on: every `setTimeout` of `STARTUP_DEADLINE_MS`. */
function countArmedDeadlines(): { armed: () => number; restore: () => void } {
  const set = globalThis.setTimeout;
  let armed = 0;
  const counting = (callback: () => void, ms: number) => {
    if (ms === STARTUP_DEADLINE_MS) armed += 1;
    return set(callback, ms);
  };
  globalThis.setTimeout = counting as typeof setTimeout;
  return { armed: () => armed, restore: () => { globalThis.setTimeout = set; } };
}

type Instance = TestRenderer.ReactTestInstance;
type OnMessage = (e: { nativeEvent: { data: string } }) => void;

/** A frame through a WebView's `onMessage` handler as RN holds it, even after the WebView is gone. */
const frameThrough = (onMessage: OnMessage, frame: unknown) =>
  TestRenderer.act(async () => onMessage({ nativeEvent: { data: JSON.stringify(frame) } }));

interface Stage {
  tree: Tree;
  /** What the launcher shows: an app's launch, or none (Home). */
  show: (launch: MiniAppLaunch | null) => Promise<void>;
  /** Every WebView the container holds, waiting or bound. */
  webViews: () => Instance[];
  /** A frame (or a raw string) from `web`'s page, through the handler the WebView was rendered with. */
  send: (web: Instance, frame: unknown) => Promise<void>;
  /** Lets a dispatched syscall's reply come back. */
  settle: () => Promise<void>;
}

/** Mount the container with no app open (as the launcher keeps it under Home), run `body`, unmount. */
async function withStage(body: (s: Stage) => Promise<void>): Promise<void> {
  resetNativeStorage();
  injectedScripts.length = 0;
  const clock = captureTimeouts();
  const tree = await renderScreen(<MiniAppStage launch={null} onFrame={ignoreFrame} />, { createNodeMock: measuredAsContainer });
  try {
    await body({
      tree,
      show: async (launch) => { await TestRenderer.act(async () => { tree.update(<MiniAppStage launch={launch} onFrame={ignoreFrame} />); }); },
      webViews: () => tree.root.findAll(isWebView),
      send: async (web, frame) => {
        const data = typeof frame === 'string' ? frame : JSON.stringify(frame);
        await TestRenderer.act(async () => web.props.onMessage({ nativeEvent: { data } }));
      },
      settle: async () => { await TestRenderer.act(async () => { await new Promise((resolve) => setImmediate(resolve)); }); },
    });
  } finally {
    await unmountScreen(tree);
    clock.restore();
  }
}

/** The delivery scripts `web` was handed (the mock records each WebView's own in `injected`). */
const deliveriesInto = (web: Instance): string[] => (web.props.injected as string[]).filter((s) => s.includes('__whimControl.reinject('));
/** The generation `web`'s realm was bound at. */
const generationIn = (web: Instance): number => Number(/,generation:(\d+)/.exec(deliveriesInto(web).at(-1) ?? '')?.[1]);
/** The syscall replies relayed into `web`, as the realm would receive them. */
const repliesIn = (web: Instance) => (web.props.injected as string[])
  .filter((s) => s.includes('__whimRelaySysret('))
  .map((s) => JSON.parse(JSON.parse(/__whimRelaySysret\(("(?:[^"\\]|\\.)*")\)/.exec(s)![1])) as { ok: boolean; result?: unknown });
/** A syscall as the outer page relays it: the realm's marshaller stamps its generation. */
const syscall = (gen: number, id: number, method: string, params: Record<string, unknown>) =>
  ({ kind: 'syscall', trusted: false, payload: { whim: 'syscall', v: SYSCALL_VERSION, id, gen, method, params } });
const timedRecords = () => log.buffer.snapshot().filter((r) => r.message === 'tap to first paint').map((r) => r.fields as { webView?: unknown });
/** The WebView settings that make it the sandbox host: page, origins, JavaScript, storage, windows. */
const settingsOf = (web: Instance) => {
  const { source, originWhitelist, javaScriptEnabled, domStorageEnabled, setSupportMultipleWindows } = web.props;
  return { source, originWhitelist, javaScriptEnabled, domStorageEnabled, setSupportMultipleWindows };
};

export async function runMiniAppHostUiTests(h: Harness): Promise<void> {
  await h.test('mini-app: on Android the app’s page ends above the keyboard, so the field it keeps in view is not under it; iOS’s WebView avoids the keyboard itself', async () => {
    const before = { OS: Platform.OS, Version: Platform.Version };
    const keyboardTop = 500;
    try {
      for (const [os, version] of [['android', 29], ['android', 34], ['android', 37]] as const) {
        Platform.OS = os;
        Platform.Version = version;
        await withMiniApp(TIP, async ({ tree }) => {
          await TestRenderer.act(async () => { moveKeyboard(keyboardWindow.height - keyboardTop); });
          h.eq(pageInset(tree), MINI_APP_FRAME.pageY + MINI_APP_FRAME.height - keyboardTop, `Android ${version}: the page ends at the keyboard’s top edge`);
          await TestRenderer.act(async () => { moveKeyboard(keyboardWindow.height - keyboardTop + 60); });
          h.eq(pageInset(tree), MINI_APP_FRAME.pageY + MINI_APP_FRAME.height - keyboardTop + 60, `Android ${version}: and follows a keyboard that grows while up`);
          await TestRenderer.act(async () => { moveKeyboard(0); });
          h.eq(pageInset(tree), 0, `Android ${version}: and reaches the bottom again once the keyboard goes`);
        });
      }
      Platform.OS = 'ios';
      Platform.Version = '26.0';
      await withMiniApp(TIP, async ({ tree }) => {
        await TestRenderer.act(async () => { moveKeyboard(keyboardWindow.height - keyboardTop); });
        h.eq(pageInset(tree), 0, 'iOS: the page keeps its size; WKWebView scrolls the field into view itself');
      });
    } finally {
      Object.assign(Platform, before);
      resetKeyboard();
    }
  });

  await h.test('mini-app: the opening state covers a WebView that is already mounted, until a trusted first paint', async () => {
    await withMiniApp(TIP, async ({ webView, loadEnd, frame, opening, pageShown, clock }) => {
      h.ok(webView() != null, 'the WebView is mounted from the start, so the page keeps loading');
      h.ok(opening() && !pageShown(), 'hidden under the opening state');
      await loadEnd();
      h.eq(injectedScripts.length, 1, 'the bundle is delivered once the page has loaded');
      h.eq(clock.count(STARTUP_DEADLINE_MS), 1, 'and the startup deadline is running');
      await frame({ ...firstPaint(), trusted: false });
      h.ok(opening() && !pageShown(), 'a paint frame that is not authenticated leaves the page hidden');
      h.eq(clock.count(STARTUP_DEADLINE_MS), 1, 'and does not disarm the deadline');
      await frame(firstPaint());
      h.ok(!opening() && pageShown(), 'the authenticated first paint stamped with this launch’s generation shows the page and ends the opening');
      h.eq(clock.count(STARTUP_DEADLINE_MS), 0, 'and completes startup');
    });
  });

  await h.test('mini-app: the launch logs tap to first paint once, from the tap to its own accepted paint, beside the realm’s mount-to-paint time', async () => {
    const realNow = Date.now;
    let now = 1_000_000;
    Date.now = () => now;
    const timed = () => log.buffer.snapshot().filter((r) => r.message === 'tap to first paint').map((r) => [r.channel, r.level, r.fields]);
    try {
      await withMiniApp(TIP, async ({ loadEnd, frame, tree }) => {
        log.buffer.clear();
        now += 40;
        await loadEnd();
        now += 200;
        await frame({ ...firstPaint(), trusted: false });
        await frame(firstPaint(boundGeneration() - 1));
        h.eq(timed(), [], 'a paint the launch refuses is not its first paint');
        now += 97;
        await frame(firstPaint());
        h.eq(timed(), [['whim', 'info', { tapToPaintMs: 337, paintMs: 42, webView: 'cold' }]],
          'the accepted paint is logged with the time since the tap, and a launch with no WebView waiting got a cold one');
        now += 500;
        await frame(firstPaint());
        h.eq(timed().length, 1, 'a later paint of the same realm is not logged again');
        await frame({ kind: 'error', trusted: true, payload: { where: 'mount', name: 'TypeError' } });
        await press(button(tree, COPY.actionReload));
        now += 60;
        await loadEnd();
        await frame(firstPaint());
        h.eq(timed().at(-1), ['whim', 'info', { tapToPaintMs: 60, paintMs: 42, webView: 'loading' }],
          'Reload is a launch of its own: its paint is logged from the Reload, with the WebView that was loading beside the first');
        h.eq(timed().length, 2, 'once');
      }, undefined, now);
    } finally {
      Date.now = realNow;
    }
  });

  await h.test('mini-app: a trusted paint stamped for another launch leaves the page hidden, and the startup deadline still fails it', async () => {
    await withMiniApp(TIP, async ({ loadEnd, frame, shown, opening, pageShown, clock }) => {
      await loadEnd();
      const bound = boundGeneration();
      await frame(firstPaint(bound - 1));
      h.ok(opening() && !pageShown(), 'a paint from the launch before this one does not show the page');
      await frame(firstPaint(bound + 1));
      h.ok(opening() && !pageShown(), 'nor does one claiming a launch that has not happened');
      h.eq(clock.count(STARTUP_DEADLINE_MS), 1, 'the startup deadline stays armed');
      await TestRenderer.act(async () => clock.fire(STARTUP_DEADLINE_MS));
      h.ok(shown().includes(COPY.appCrashedBody), 'and, with no paint of its own, the launch reaches the recovery screen');
    });
  });

  await h.test('mini-app: after Reload opens the app again in a new realm, the old realm’s late paint cannot open it', async () => {
    await withMiniApp(TIP, async ({ loadEnd, frame, opening, pageShown, clock, tree }) => {
      await loadEnd();
      const old = boundGeneration();
      await TestRenderer.act(async () => clock.fire(600));
      h.ok(pageShown(), 'the first realm’s page was shown at the cap');
      await frame({ kind: 'error', trusted: true, payload: { where: 'mount', name: 'TypeError' } });
      await press(button(tree, COPY.actionReload));
      await loadEnd();
      h.ok(boundGeneration() !== old, 'the recreated realm is bound at a new generation');
      await frame(firstPaint(old));
      h.ok(opening() && !pageShown(), 'the old realm’s paint, arriving late, leaves the new launch hidden, its cap restarted');
      h.eq(clock.count(STARTUP_DEADLINE_MS), 1, 'with its startup deadline armed');
      await frame(firstPaint());
      h.ok(!opening() && pageShown(), 'the new realm’s own paint opens it');
      h.eq(clock.count(STARTUP_DEADLINE_MS), 0, 'and completes startup');
    });
  });

  await h.test('mini-app: after Reload, an accepted delivery still queued from the failed realm’s WebView does not restart the new realm’s startup deadline', async () => {
    await withMiniApp(TIP, async ({ webView, loadEnd, frame, tree }) => {
      await loadEnd();
      const failedRealm = webView()!.props.onMessage as (e: { nativeEvent: { data: string } }) => void;
      await frame({ kind: 'error', trusted: true, payload: { where: 'mount', name: 'TypeError' } });
      await press(button(tree, COPY.actionReload));
      await loadEnd();
      // The loader's own acknowledgement, as the page forwards it: its generation is the realm's
      // own counter (1 in every fresh realm), so it cannot tell the two realms apart.
      const accepted = JSON.stringify({ kind: 'delivery', trusted: true, payload: { accepted: true, generation: 1 } });
      const deadlines = countArmedDeadlines();
      try {
        await TestRenderer.act(async () => failedRealm({ nativeEvent: { data: accepted } }));
        h.eq(deadlines.armed(), 0, 'the failed realm’s acknowledgement does not arm the deadline again');
        await frame(JSON.parse(accepted));
        h.eq(deadlines.armed(), 1, 'the new realm’s own does, for its full allowance');
      } finally {
        deadlines.restore();
      }
    });
  });

  await h.test('pool: with no app open one WebView waits, unseen and untouchable, holding the runtime page and only the warm probe', async () => {
    let cold: ReturnType<typeof settingsOf> | null = null;
    await withMiniApp(TIP, async ({ webView }) => { cold = settingsOf(webView()!); });
    await withStage(async ({ tree, webViews, send }) => {
      h.eq(webViews().length, 1, 'one WebView waits');
      const [waiting] = webViews();
      const container = containerOf(tree);
      h.eq([flat(container).opacity, container.props.pointerEvents, container.props.accessibilityElementsHidden, container.props.importantForAccessibility],
        [0, 'none', true, 'no-hide-descendants'], 'unseen, untouchable and out of the accessibility tree');
      h.eq(waiting.props.source, { html: RUNTIME_HTML }, 'it loads the runtime page');
      h.eq(settingsOf(waiting), cold, 'with exactly the settings of a WebView a launch creates cold');
      await TestRenderer.act(async () => waiting.props.onLoadEnd());
      await send(waiting, WARM_ANSWER);
      h.eq(waiting.props.injected, [WARM_PROBE_JS], 'the probe is all it is handed: no bundle, no theme, no generation');
      h.eq(injectedScripts.length, 1, 'and nothing else was injected anywhere');
    });
  });

  await h.test('pool: a warm WebView opens the app at once — delivered as it is handed over, under the opening state — and the timing says warm', async () => {
    await withStage(async ({ tree, show, webViews, send }) => {
      const [waiting] = webViews();
      await TestRenderer.act(async () => waiting.props.onLoadEnd());
      await send(waiting, WARM_ANSWER);
      log.buffer.clear();
      await show(launchOf(TIP));
      const [web] = webViews();
      h.ok(web === waiting, 'the app takes the waiting WebView');
      h.eq(deliveriesInto(web).length, 1, 'it is delivered into at once, with no load event to wait for');
      h.ok(isOpening(tree) && !pageIsShown(tree), 'under the opening state');
      await TestRenderer.act(async () => web.props.onLoadEnd());
      h.eq(deliveriesInto(web).length, 1, 'a late load event from its page does not deliver again');
      await send(web, firstPaint(generationIn(web)));
      h.ok(!isOpening(tree) && pageIsShown(tree), 'its own paint opens it');
      h.eq(timedRecords().map((f) => f.webView), ['warm'], 'and the timing record says the WebView was warm');
    });
  });

  await h.test('pool: once an app has opened a fresh WebView warms beside it — unseen, untouchable, handed only the probe, deaf to the launch — so opening again after a close is warm', async () => {
    await withStage(async ({ tree, show, webViews, send, settle }) => {
      const [first] = webViews();
      await TestRenderer.act(async () => first.props.onLoadEnd());
      await send(first, WARM_ANSWER);
      await show(launchOf(WATER));
      const [web] = webViews();
      h.ok(web === first && webViews().length === 1, 'the app has the warm WebView, and no other page loads while it opens');
      const gen = generationIn(web);
      await send(web, firstPaint(gen));
      h.ok(!isOpening(tree) && pageIsShown(tree), 'the app’s own paint opens it');
      const next = webViews().find((w) => w !== web)!;
      h.ok(next !== undefined && webViews().length === 2, 'and then a new WebView is there beside it');
      const nextSlot = nativeOf(slotOf(tree, next));
      h.eq([flat(nextSlot).opacity, spansContainer(nextSlot), flat(nextSlot).position, nextSlot.props.pointerEvents, nextSlot.props.accessibilityElementsHidden, nextSlot.props.importantForAccessibility],
        [0, true, 'absolute', 'none', true, 'no-hide-descendants'], 'unseen, untouchable and out of the accessibility tree, out of the layout');
      h.ok(pageIsShown(tree), 'so the app’s page stays shown under it');
      h.eq(settingsOf(next), settingsOf(web), 'with exactly the settings of the app’s own');
      await TestRenderer.act(async () => next.props.onLoadEnd());
      await send(next, { kind: 'error', trusted: true, payload: { where: 'mount', name: 'TypeError' } });
      await send(next, syscall(gen, 1, 'storage.kv.get', { key: 'note' }));
      await settle();
      h.ok(!textOf(tree.root).includes(COPY.appCrashedBody), 'a fatal error frame from the waiting WebView does not reach the running app');
      h.eq([...repliesIn(next), ...repliesIn(web)], [], 'and a syscall from it, stamped with the app’s generation, is answered nowhere');
      await send(next, WARM_ANSWER);
      h.eq(next.props.injected, [WARM_PROBE_JS], 'it is handed the probe and nothing else: no bundle, no theme, no generation');

      log.buffer.clear();
      await show(null);
      await show(launchOf(TIP));
      const [again] = webViews();
      h.ok(again === next && !webViews().includes(web), 'opening again takes the WebView that warmed while the app ran; the app’s own is gone');
      h.eq(deliveriesInto(again).length, 1, 'delivered into at once');
      await send(again, firstPaint(generationIn(again)));
      h.ok(generationIn(again) !== gen, 'at a generation of its own');
      h.eq(timedRecords().map((f) => f.webView), ['warm'], 'and the timing record says warm');
    });
  });

  await h.test('pool: app A then app B — B opens in a WebView A never had, at its own generation, and A’s late paint, syscall and storage never reach it', async () => {
    await withStage(async ({ tree, show, webViews, send, settle }) => {
      const [waiting] = webViews();
      await TestRenderer.act(async () => waiting.props.onLoadEnd());
      await send(waiting, WARM_ANSWER);
      await show(launchOf(WATER));
      const [a] = webViews();
      const genA = generationIn(a);
      await send(a, firstPaint(genA));
      await send(a, syscall(genA, 1, 'storage.kv.set', { key: 'note', value: 'A-secret' }));
      await settle();
      h.eq(repliesIn(a).map((r) => r.ok), [true], 'A writes a note to its own storage');
      // A's WebView's own handler, as RN still holds it for frames queued before A closed.
      const fromA = a.props.onMessage as OnMessage;

      await show(null);
      await show(launchOf(LATENCY));
      const [b] = webViews();
      h.ok(b !== a && !webViews().includes(a), 'B gets a new WebView; A’s is gone');
      await TestRenderer.act(async () => b.props.onLoadEnd());
      const genB = generationIn(b);
      h.ok(Number.isFinite(genB) && genB !== genA, 'B’s realm is bound at a generation of its own');
      h.eq([deliveriesInto(b).length, (b.props.injected as string[]).length], [1, 1], 'its WebView has received B’s delivery and nothing else');
      h.ok(!deliveriesInto(b)[0].includes(JSON.stringify(APP_BUNDLES[WATER.appId])), 'none of A’s code');

      await frameThrough(fromA, firstPaint(genA));
      await frameThrough(fromA, firstPaint(genB));
      await frameThrough(fromA, syscall(genB, 9, 'storage.kv.get', { key: 'note' }));
      await settle();
      h.ok(isOpening(tree) && !pageIsShown(tree), 'a paint still queued from A’s WebView opens nothing, even one claiming B’s generation');
      h.eq(repliesIn(b), [], 'and a syscall still queued from it is answered nowhere');

      await send(b, firstPaint(genA));
      await send(b, syscall(genA, 2, 'storage.kv.get', { key: 'note' }));
      await settle();
      h.ok(isOpening(tree), 'a paint stamped with A’s generation is refused even on B’s own channel');
      h.eq(repliesIn(b), [], 'so is a syscall stamped with it');

      await send(b, syscall(genB, 1, 'storage.kv.get', { key: 'note' }));
      await settle();
      h.eq(repliesIn(b).map((r) => [r.ok, r.result]), [[true, { found: false, value: null }]], 'B’s own read is answered, and A’s note is not in B’s storage');
      await send(b, firstPaint(genB));
      h.ok(!isOpening(tree), 'B’s own paint opens it');
    });
  });

  await h.test('pool: a waiting WebView that loaded but never answered, or whose page or web process died, is never handed out', async () => {
    await withStage(async ({ show, webViews }) => {
      const [silent] = webViews();
      const intoSilent = silent.props.injected as string[];
      await TestRenderer.act(async () => silent.props.onLoadEnd());
      await show(launchOf(TIP));
      const [web] = webViews();
      h.ok(web !== silent && !webViews().includes(silent), 'a page whose scripts never answered the probe is dropped; the app gets a cold WebView');
      h.eq(intoSilent, [WARM_PROBE_JS], 'the dropped one got nothing but the probe');
      await TestRenderer.act(async () => web.props.onLoadEnd());
      h.eq(deliveriesInto(web).length, 1, 'the cold one is delivered into once its page has loaded');
    });
    await withStage(async ({ show, webViews }) => {
      const dead: Instance[] = [];
      for (const failure of ['onContentProcessDidTerminate', 'onRenderProcessGone', 'onError'] as const) {
        const [waiting] = webViews();
        dead.push(waiting);
        await TestRenderer.act(async () => waiting.props[failure]({ nativeEvent: { description: 'gone' } }));
        h.ok(webViews().length === 1 && !dead.includes(webViews()[0]), `${failure}: a fresh WebView waits in its place`);
      }
      await show(launchOf(TIP));
      h.ok(!dead.includes(webViews()[0]), 'the app never gets one that died');
    });
  });

  await h.test('pool: a touch on the open app lands on its own WebView — the one warming beside it is drawn below it, in a slot that takes no touch and no space — and a hand-over only restyles that slot', async () => {
    await withStage(async ({ tree, show, webViews, send }) => {
      const [first] = webViews();
      await TestRenderer.act(async () => first.props.onLoadEnd());
      await send(first, WARM_ANSWER);
      await show(launchOf(WATER));
      const [web] = webViews();
      await send(web, firstPaint(generationIn(web)));
      const next = webViews().find((w) => w !== web)!;
      h.ok(next !== undefined, 'a WebView warms beside the open app');
      h.eq(slotsOf(tree).map((slot) => slot.findAll(isWebView)[0] === web), [false, true], 'the waiting WebView is drawn below the app’s');
      h.ok(!takesTouches(slotOf(tree, next)), 'its slot takes no touch, so nothing reaches it even where it would be on top');
      h.ok(touchedWebView(tree) === web, 'a touch on the app lands on the app’s own WebView');
      h.eq(slotsOf(tree).filter((slot) => flat(nativeOf(slot)).position !== 'absolute').map((slot) => slot.findAll(isWebView)[0] === web), [true],
        'and the app’s slot is the only one in the layout, so its page has the whole container');
      const waiting = nativeOf(slotOf(tree, next));
      h.ok(waiting.props.collapsable === false, 'the slot is a native view of its own, never flattened away');

      await show(null);
      await show(launchOf(TIP));
      const [again] = webViews();
      h.ok(again === next, 'the next launch takes the WebView that waited');
      const bound = nativeOf(slotOf(tree, again));
      h.ok(bound === waiting, 'in the very slot it waited in: the hand-over restyled it, nothing was remounted');
      h.ok(touchedWebView(tree) === again && flat(bound).position !== 'absolute' && flat(bound).opacity !== 0, 'which now takes touches, space and is seen');
      h.eq([bound.props.accessibilityElementsHidden, bound.props.importantForAccessibility], [false, 'auto'], 'and is back in the accessibility tree');
    });
  });

  await h.test('pool: a launch whose WebView fails to load while it opens gets the recovery screen, not an endless opening; Reload opens it again in a fresh WebView', async () => {
    await withStage(async ({ tree, show, webViews, send }) => {
      const [loading] = webViews();
      let reloads = 0;
      await show(launchOf(TIP, { tappedAt: 1, onReload: () => { reloads += 1; } }));
      const [web] = webViews();
      h.ok(web === loading, 'the app takes the waiting WebView while its page still loads');
      // react-native-webview follows a load error with a load end for the same page, in the same
      // event (`WebViewShared.tsx` `onLoadingError`).
      const { onError, onLoadEnd, injected } = web.props as { onError: (e: unknown) => void; onLoadEnd: () => void; injected: string[] };
      await TestRenderer.act(async () => {
        onError({ nativeEvent: { code: -6, description: 'net::ERR_CONNECTION_REFUSED' } });
        onLoadEnd();
      });
      h.ok(textOf(tree.root).includes(COPY.appCrashedBody) && !isOpening(tree), 'the recovery screen replaces the opening at once');
      h.eq(injected, [], 'nothing is delivered into the failed page');
      h.ok(!webViews().includes(web), 'and its WebView is gone');
      await press(button(tree, COPY.actionReload));
      h.eq(reloads, 1, 'Reload asks the launcher to open the app again');
      await show(launchOf(TIP, { tappedAt: 2 }));
      const fresh = touchedWebView(tree)!;
      h.ok(fresh !== undefined && fresh !== web, 'the new launch binds a fresh WebView');
      await TestRenderer.act(async () => fresh.props.onLoadEnd());
      h.eq(deliveriesInto(fresh).length, 1, 'delivered into once its page loads');
      await send(fresh, firstPaint(generationIn(fresh)));
      h.ok(!isOpening(tree) && pageIsShown(tree), 'and its own paint opens the app');
    });
  });

  await h.test('pool: an app whose web content process dies after it painted gets the recovery screen instead of a dead page; Reload opens it again in a fresh WebView', async () => {
    for (const death of ['onRenderProcessGone', 'onContentProcessDidTerminate'] as const) {
      await withStage(async ({ tree, show, webViews, send }) => {
        const [first] = webViews();
        await TestRenderer.act(async () => first.props.onLoadEnd());
        await send(first, WARM_ANSWER);
        let reloads = 0;
        await show(launchOf(WATER, { tappedAt: 1, onReload: () => { reloads += 1; } }));
        const [web] = webViews();
        await send(web, firstPaint(generationIn(web)));
        h.ok(!isOpening(tree) && pageIsShown(tree), `${death}: the app is open`);
        await TestRenderer.act(async () => web.props[death]({ nativeEvent: { didCrash: true } }));
        h.ok(textOf(tree.root).includes(appCrashedTitle(WATER.name)) && textOf(tree.root).includes(COPY.appCrashedBody), `${death}: the crash screen replaces the dead page`);
        h.ok(orbShown(tree), `${death}: with the orb over it`);
        h.ok(!webViews().includes(web), `${death}: and its WebView is gone`);
        await press(button(tree, COPY.actionReload));
        h.eq(reloads, 1, `${death}: Reload asks the launcher to open the app again`);
        await show(launchOf(WATER, { tappedAt: 2 }));
        const fresh = touchedWebView(tree)!;
        h.ok(fresh !== undefined && fresh !== web, `${death}: the new launch binds a fresh WebView`);
        await TestRenderer.act(async () => fresh.props.onLoadEnd());
        h.eq(deliveriesInto(fresh).length, 1, `${death}: delivered into once`);
        await send(fresh, firstPaint(generationIn(fresh)));
        h.ok(!isOpening(tree) && pageIsShown(tree), `${death}: and its own paint opens the app`);
      });
    }
  });

  await h.test('mini-app: with no paint the page is shown at 600 ms anyway, the plate stays, and "Opening…" appears only after 1.5 s', async () => {
    await withMiniApp(TIP, async ({ loadEnd, frame, shown, opening, pageShown, clock }) => {
      await loadEnd();
      await TestRenderer.act(async () => { clock.fireWithin(599); });
      h.ok(!pageShown() && !shown().includes(COPY.appBootLabel), 'before 600 ms the page is hidden and nothing is said');
      await TestRenderer.act(async () => clock.fire(600));
      h.ok(pageShown(), 'at 600 ms the page is shown without a signal');
      h.ok(opening() && !shown().includes(COPY.appBootLabel), 'the plate stays, still without words');
      await TestRenderer.act(async () => { clock.fireWithin(1_499); });
      h.ok(!shown().includes(COPY.appBootLabel), 'no words before 1.5 s');
      await TestRenderer.act(async () => clock.fire(1_500));
      h.ok(shown().includes(COPY.appBootLabel), '"Opening…" appears at 1.5 s');
      await frame(firstPaint());
      h.ok(!opening() && !shown().includes(COPY.appBootLabel), 'the paint ends the opening state, words and all');
    });
  });

  await h.test('mini-app: a page still loading is never shown before it has the theme: the 600 ms cap counts from the delivery, "Opening…" from the tap', async () => {
    await withMiniApp(TIP, async ({ loadEnd, shown, opening, pageShown, clock }) => {
      await TestRenderer.act(async () => { clock.fireWithin(1_500); });
      h.ok(!pageShown(), 'a WebView still loading its page 1.5 s after the tap stays covered: its page would paint the default light canvas first');
      h.ok(opening() && shown().includes(COPY.appBootLabel), 'while the plate says "Opening…" on time');
      await loadEnd();
      h.eq(injectedScripts.length, 1, 'the page loads and gets the bundle and the theme');
      await TestRenderer.act(async () => { clock.fireWithin(599); });
      h.ok(!pageShown(), 'still covered until 600 ms after that delivery');
      await TestRenderer.act(async () => clock.fire(600));
      h.ok(pageShown(), 'then shown, paint or not');
    });
  });

  await h.test('mini-app: the page fades in over 160 ms on its paint or at the cap; under Reduce Motion that fade is the replacement and is not skipped', async () => {
    const fadesOut = () => animations.filter(isStep).filter((a) => a.kind === 'timing' && a.to === 0).map((a) => a.config);
    try {
      for (const reduceMotion of [false, true]) {
        accessibilitySettings.reduceMotion = reduceMotion;
        const expected = reduceMotion ? 'never' : undefined;
        await withMiniApp(TIP, async ({ loadEnd, frame }) => {
          await loadEnd();
          animations.splice(0);
          await frame(firstPaint(boundGeneration() + 1));
          h.eq(fadesOut(), [], `reduceMotion ${reduceMotion}: nothing fades before this launch’s signal`);
          await frame(firstPaint());
          const fades = fadesOut();
          h.ok(fades.length > 0 && fades.every((c) => c?.duration === 160 && c.reduceMotion === expected),
            `reduceMotion ${reduceMotion}: the paint fades the page in over 160 ms${reduceMotion ? ', played even though the OS reduces motion' : ''}`);
        });
        await withMiniApp(TIP, async ({ loadEnd, clock }) => {
          await loadEnd();
          animations.splice(0);
          await TestRenderer.act(async () => clock.fire(600));
          const fades = fadesOut();
          h.ok(fades.length > 0 && fades.every((c) => c?.duration === 160 && c.reduceMotion === expected), `reduceMotion ${reduceMotion}: so does the cap`);
        });
      }
    } finally {
      accessibilitySettings.reduceMotion = false;
    }
  });

  await h.test('mini-app: the opening is the app’s tile-sized plate with its glyph on bg; in dark mode nothing behind or over the page is light or tinted full-screen', async () => {
    try {
      setColorScheme('dark');
      await withMiniApp(TIP, async ({ tree, webView, loadEnd, frame }) => {
        const plate = tree.root.findByType(TilePlate);
        h.eq([plate.props.size, plate.props.state, plate.props.tint, plate.props.glyph], ['grid', 'ready', 'ocean', 'glass-water'],
          'the Home grid’s ready plate, with the app’s tint and glyph');
        h.eq(plate.findAll((n) => hostType(n) === 'Path' && n.props.fill === TINTS.ocean.light).length, 1, 'drawn in the app’s tint');
        const container = containerOf(tree);
        h.eq(flat(container).backgroundColor, COLORS.dark.bg, 'the container behind the page is the dark bg');
        h.eq(flat(webView()!).backgroundColor, COLORS.dark.bg, 'so is the WebView’s own background');
        const layers = container.findAll((n) => typeof n.type === 'string' && spansContainer(n) && flat(n).backgroundColor !== undefined);
        h.ok(layers.length > 0 && layers.every((n) => flat(n).backgroundColor === COLORS.dark.bg), 'what covers the page while it opens is the dark bg');
        h.ok(!container.findAll((n) => typeof n.type === 'string').some((n) => [TINTS.ocean.light, TINTS.ocean.dark].includes(flat(n).backgroundColor ?? '')),
          'and no view is filled with the tint');
        const light = new Set<string | undefined>(Object.values(SHELL_PALETTE));
        await loadEnd();
        await frame({ kind: 'error', trusted: true, payload: { where: 'mount', name: 'TypeError' } });
        const screen = tree.root.findAll((n) => hostType(n) === 'ScrollView' && textOf(n).includes(COPY.appCrashedBody))[0];
        h.eq(flat(screen).backgroundColor, COLORS.dark.bg, 'the recovery screen is on the dark bg');
        const title = tree.root.findAll((n) => hostType(n) === 'Text' && textOf(n) === appCrashedTitle(TIP.name)).at(-1)!;
        h.eq(flat(title).color, COLORS.dark.text, 'with the dark text colour');
        const colours = screen.findAll((n) => typeof n.type === 'string').flatMap((n) => [flat(n).backgroundColor, flat(n).color, (flat(n) as { borderColor?: string }).borderColor]);
        h.ok(!colours.some((c) => light.has(c)), 'and none of its colours is the light shell palette');
      }, { tint: 'ocean', icon: 'glass-water' });
    } finally {
      setColorScheme('light');
    }
  });

  await h.test('mini-app: a second load event for the same WebView does not deliver the bundle again', async () => {
    await withMiniApp(TIP, async ({ loadEnd }) => {
      await loadEnd();
      await loadEnd();
      h.eq(injectedScripts.length, 1, 'one delivery per WebView mount, however many load events it reports');
    });
  });

  await h.test('mini-app: a bundle that fails shows the recovery screen; Reload opens it again in a fresh WebView and delivers again', async () => {
    await withMiniApp(TIP, async ({ webView, loadEnd, frame, shown, opening, pageShown, clock, tree }) => {
      await loadEnd();
      await frame(firstPaint());
      const first = webView();
      await frame({ kind: 'error', trusted: true, payload: { where: 'bundle', message: 'SENTINEL_TypeError: x is undefined' } });
      h.ok(shown().includes(COPY.appCrashedBody), 'the recovery screen replaces the app');
      h.ok(!shown().includes('SENTINEL'), 'without the raw error text');
      h.ok(webView() == null, 'the failed realm’s WebView is gone');
      const reload = StyleSheet.flatten(button(tree, COPY.actionReload).props.style) as { backgroundColor?: string; borderColor?: string };
      h.eq([reload.backgroundColor, reload.borderColor], [COLORS.light.ink, undefined], 'Reload is its primary action, filled ink edge to edge with no ring of another colour');
      await press(button(tree, COPY.actionReload));
      h.ok(webView() != null && webView() !== first, 'Reload mounts a new WebView');
      h.ok(!shown().includes(COPY.appCrashedBody), 'the recovery screen is gone');
      await loadEnd();
      h.ok(opening() && !pageShown(), 'the new realm starts from the opening state, not the old realm’s paint');
      h.eq(injectedScripts.length, 2, 'the new WebView gets its own delivery');
      h.eq(clock.count(STARTUP_DEADLINE_MS), 1, 'with its own startup deadline');
    });
  });

  await h.test('mini-app: the recovery screen’s Back leaves the app', async () => {
    await withMiniApp(TIP, async ({ loadEnd, frame, tree, exits }) => {
      await loadEnd();
      await frame({ kind: 'error', trusted: true, payload: { where: 'mount', message: 'boom' } });
      await press(button(tree, COPY.launchFailedBack));
      h.eq(exits(), 1, 'Back calls the exit once');
    });
  });

  await h.test('mini-app: an error the app survives is logged, not shown', async () => {
    await withMiniApp(TIP, async ({ webView, loadEnd, frame, shown }) => {
      await loadEnd();
      await frame(firstPaint());
      await frame({ kind: 'error', trusted: true, payload: { where: 'probes', message: 'probe hiccup' } });
      h.ok(webView() != null && !shown().includes(COPY.appCrashedBody), 'the app keeps running');
      h.ok(log.buffer.snapshot().some((r) => r.message === 'non-fatal error frame from the realm' && (r.fields as { detail?: unknown } | undefined)?.detail === 'probe hiccup'), 'and the error is recorded');
    });
  });

  await h.test('mini-app: a handler throw and an unhandled rejection after paint are error records, and the app keeps running', async () => {
    await withMiniApp(TIP, async ({ webView, loadEnd, frame, shown }) => {
      await loadEnd();
      await frame(firstPaint());
      log.buffer.clear();
      await frame(RUNTIME_ERROR_FRAME);
      await frame(REJECTION_ERROR_FRAME);
      h.ok(webView() != null && !shown().includes(COPY.appCrashedBody), 'neither takes the app down');
      h.eq(
        miniAppErrorRecords(),
        [
          { message: 'mini-app error', fields: { where: 'runtime', errorClass: 'LedgerError', appId: TIP.appId } },
          { message: 'mini-app error', fields: { where: 'rejection', errorClass: 'SettleError', appId: TIP.appId } },
        ],
        'each reaches the seam as one error record with its where, its class and the app',
      );
    });
  });

  await h.test('mini-app: a mount failure shows the recovery screen and is an error record without the message', async () => {
    await withMiniApp(TIP, async ({ loadEnd, frame, shown }) => {
      await loadEnd();
      log.buffer.clear();
      // loader.js's mount-failure frame carries the message; only the class may reach the seam.
      await frame({ kind: 'error', trusted: true, payload: { where: 'mount', name: 'TypeError', message: 'SENTINEL cannot read total' } });
      h.ok(shown().includes(COPY.appCrashedBody), 'the recovery screen shows');
      h.eq(
        miniAppErrorRecords(),
        [{ message: 'mini-app failed', fields: { where: 'mount', errorClass: 'TypeError', appId: TIP.appId } }],
        'one error record for the mount failure',
      );
      h.ok(!JSON.stringify(log.buffer.snapshot()).includes('SENTINEL'), 'and the message text is in no record');
    });
  });

  await h.test('mini-app: an unauthenticated error frame is neither a failure screen nor an error record', async () => {
    await withMiniApp(TIP, async ({ webView, loadEnd, frame, shown }) => {
      await loadEnd();
      await frame(firstPaint());
      log.buffer.clear();
      // The outer page's forward of a bundle-posted frame that failed the nonce check.
      await frame({ kind: 'rejected-forgery', trusted: false, forgedKind: 'error', payload: { where: 'runtime', name: 'ForgedError' } });
      // A frame claiming the `error` kind without the page's authentication.
      await frame({ kind: 'error', trusted: false, payload: { where: 'mount', name: 'ForgedError' } });
      h.ok(webView() != null && !shown().includes(COPY.appCrashedBody), 'the app keeps running');
      h.eq(miniAppErrorRecords(), [], 'and no mini-app error record is emitted');
    });
  });

  await h.test('mini-app: a render error after the first paint shows the recovery screen instead of a blank app', async () => {
    await withMiniApp(TIP, async ({ webView, loadEnd, frame, shown }) => {
      await loadEnd();
      await frame(firstPaint());
      log.buffer.clear();
      await frame(RENDER_ERROR_FRAME);
      h.ok(shown().includes(COPY.appCrashedBody), 'the recovery screen replaces the unmounted app');
      h.ok(webView() == null, 'and the failed realm’s WebView is gone, so Reload recreates it');
      h.eq(
        miniAppErrorRecords(),
        [{ message: 'mini-app failed', fields: { where: 'render', errorClass: 'LedgerError', appId: TIP.appId } }],
        'one error record, with the site and the class',
      );
    });
  });

  await h.test('mini-app: a render error before the first paint is one failure, not a boot surface that later times out', async () => {
    await withMiniApp(TIP, async ({ loadEnd, frame, shown, opening, clock }) => {
      await loadEnd();
      log.buffer.clear();
      await frame(RENDER_ERROR_FRAME);
      h.ok(shown().includes(COPY.appCrashedBody) && !opening(), 'the recovery screen replaces the opening state at once');
      h.eq(clock.count(STARTUP_DEADLINE_MS), 0, 'the startup deadline is disarmed, so it cannot report the same failure again');
      h.eq(miniAppErrorRecords().map((r) => r.fields.where), ['render'], 'one error record');
    });
  });

  await h.test('mini-app: a render error frame the page did not authenticate is ignored', async () => {
    await withMiniApp(TIP, async ({ webView, loadEnd, frame, shown }) => {
      await loadEnd();
      await frame(firstPaint());
      log.buffer.clear();
      // The outer page's forward of a bundle-posted render frame that failed the nonce check.
      await frame({ kind: 'rejected-forgery', trusted: false, forgedKind: 'error', payload: RENDER_ERROR_FRAME.payload });
      // Frames claiming a render failure without the page's authentication: marked untrusted, and
      // carrying no mark at all.
      await frame({ ...RENDER_ERROR_FRAME, trusted: false });
      await frame({ kind: RENDER_ERROR_FRAME.kind, payload: RENDER_ERROR_FRAME.payload });
      h.ok(webView() != null && !shown().includes(COPY.appCrashedBody), 'the app keeps running');
      h.eq(miniAppErrorRecords(), [], 'and no mini-app error record is emitted');
    });
  });

  await h.test('mini-app: every delivery tells the realm how much of its bottom edge the orb covers, bottom safe-area inset included', async () => {
    await withMiniApp(TIP, async ({ loadEnd, frame, tree }) => {
      await loadEnd();
      const orb = orbPlace(tree);
      const first = deliveredTheme(injectedScripts[0]);
      const footprint = Number(first.chromeInsetBottom);
      h.ok(footprint >= orb.bottom + orb.height, `the footprint (${footprint}) covers the orb's whole target as drawn over the inset (top at ${orb.bottom + orb.height})`);
      const theme = withoutInset(first);
      h.eq(theme, sanitizeTheme(theme), 'beside a theme the SDK keeps exactly as delivered');
      await frame({ kind: 'error', trusted: true, payload: { where: 'bundle' } });
      await press(button(tree, COPY.actionReload));
      await loadEnd();
      h.eq(deliveredTheme(injectedScripts[1]).chromeInsetBottom, footprint, 'the recreated realm is told again');
    });
  });

  await h.test('mini-app: the orb follows the phone’s scheme while the app keeps the theme it opened with', async () => {
    try {
      await withMiniApp(TIP, async ({ loadEnd, tree }) => {
        await loadEnd();
        await TestRenderer.act(async () => { setColorScheme('dark'); });
        h.eq(flat(containerOf(tree)).backgroundColor, COLORS.light.bg, 'the app’s area stays light');
        const fills = button(tree, COPY.orbMenuOpenLabel).findAll((n) => typeof n.type === 'string' && flat(n).backgroundColor !== undefined).map((n) => flat(n).backgroundColor);
        h.ok(fills.includes(COLORS.dark.raised) && !fills.includes(COLORS.light.raised), `the orb is drawn dark (${fills.join(', ')})`);
      });
    } finally {
      setColorScheme('light');
    }
  });

  await h.test('mini-app: the orb comes back in the corner each app left it in, across closing and reopening', async () => {
    const left = (tree: Tree) => orbPlace(tree).left;
    await withMiniApp(TIP, async ({ tree }) => {
      const right = left(tree);
      const orb = button(tree, COPY.orbMenuOpenLabel);
      await TestRenderer.act(async () => { orb.props.onAccessibilityAction({ nativeEvent: { actionName: orb.props.accessibilityActions[0].name } }); });
      h.ok(left(tree) < right, 'Tip Splitter’s orb moved bottom-leading');
    });
    const reopen = async (record: AppRecord, body: (tree: Tree) => void) => {
      // withMiniApp clears storage for a clean mount; reopen over what the first mount stored.
      const tree = await renderScreen(<MiniAppStage launch={launchOf(record)} onFrame={ignoreFrame} />, { createNodeMock: measuredAsContainer });
      try { body(tree); } finally { await unmountScreen(tree); }
    };
    await reopen(TIP, (tree) => { h.ok(left(tree) < 100, `reopened, it is still bottom-leading (left ${left(tree)})`); });
    await reopen(WATER, (tree) => { h.ok(left(tree) > 200, `Water Counter’s orb is bottom-trailing (left ${left(tree)})`); });
  });

  await h.test('mini-app: a launch hands the realm the theme for the phone’s settings and the app’s tint: dark, 135% text, ocean', async () => {
    const before = { OS: Platform.OS, fontScale: windowMetrics.fontScale, ...accessibilitySettings };
    try {
      Platform.OS = 'android';
      windowMetrics.fontScale = 1.35;
      accessibilitySettings.reduceMotion = true;
      accessibilitySettings.increaseContrast = true;
      setColorScheme('dark');
      await withMiniApp(TIP, async ({ loadEnd }) => {
        await loadEnd();
        const { colors, ...settings } = withoutInset(deliveredTheme(injectedScripts[0])) as { colors?: Record<string, unknown> };
        h.eq(settings, { scheme: 'dark', tint: 'ocean', fontScale: 1.35, reduceMotion: true, increaseContrast: true, platform: 'android' },
          'the scheme, the app’s tint, the text scale, Reduce Motion, Increase Contrast and the platform');
        h.eq(Object.keys(colors ?? {}).sort(byName), Object.keys(DEFAULT_THEME.colors).sort(byName),'every colour role the SDK reads');
        h.eq(colors?.primary, TINTS.ocean.dark, 'primary is ocean’s dark value');
        h.eq(colors?.['on-primary'], ON_TINT.dark, 'with the label colour that reads on it');
        for (const role of ['bg', 'surface', 'sheet', 'sheet-group', 'thumb', 'text', 'border', 'danger', 'positive', 'warning'] as const) {
          h.eq(colors?.[role], COLORS.dark[role], `${role} is the token module’s dark value`);
        }
        h.eq(colors?.['text-muted'], COLORS.dark.text, 'under Increase Contrast muted text is the full text colour, as in the shell');
        const delivered = { colors, ...settings };
        h.eq(delivered, sanitizeTheme(delivered), 'and the SDK keeps every field as delivered');
      }, { tint: 'ocean', icon: 'receipt' });
    } finally {
      Object.assign(accessibilitySettings, { reduceMotion: before.reduceMotion, increaseContrast: before.increaseContrast });
      windowMetrics.fontScale = before.fontScale;
      Platform.OS = before.OS;
      setColorScheme('light');
    }
  });

  await h.test('mini-app: a running app keeps the theme it opened with; the phone’s new settings apply the next time it opens', async () => {
    try {
      setColorScheme('dark');
      await withMiniApp(TIP, async ({ loadEnd }) => {
        await loadEnd();
        h.eq(deliveredTheme(injectedScripts[0]).scheme, 'dark', 'opened in dark');
        await TestRenderer.act(async () => { setColorScheme('light'); });
        windowMetrics.fontScale = 1.5;
        h.eq(injectedScripts.length, 1, 'switching to light while it runs delivers nothing new');
      }, { tint: 'rose', icon: 'receipt' });
      await withMiniApp(TIP, async ({ loadEnd }) => {
        await loadEnd();
        const theme = deliveredTheme(injectedScripts[0]);
        h.eq([theme.scheme, theme.fontScale, theme.colors?.bg, theme.colors?.primary], ['light', 1.5, COLORS.light.bg, TINTS.rose.light],
          'the next open is light, at the new text size');
      }, { tint: 'rose', icon: 'receipt' });
    } finally {
      windowMetrics.fontScale = 1;
      setColorScheme('light');
    }
  });

  await h.test('mini-app: an app opened in dark keeps a dark container, page background, cover, plate, "Opening…" and recovery screen when the phone turns light; Reload’s fresh realm takes the new scheme', async () => {
    const dark = resolveTokens({ scheme: 'dark', fontScale: 1, platform: Platform.OS, reduceMotion: false, increaseContrast: false });
    try {
      setColorScheme('dark');
      await withMiniApp(TIP, async ({ tree, webView, loadEnd, frame, clock }) => {
        await loadEnd();
        await TestRenderer.act(async () => { setColorScheme('light'); });
        await TestRenderer.act(async () => { clock.fireWithin(1_500); });
        const container = containerOf(tree);
        h.eq([flat(container).backgroundColor, flat(webView()!).backgroundColor], [COLORS.dark.bg, COLORS.dark.bg], 'the container and the page background stay dark');
        const covers = container.findAll((n) => typeof n.type === 'string' && spansContainer(n) && flat(n).backgroundColor !== undefined);
        h.ok(covers.length > 0 && covers.every((n) => flat(n).backgroundColor === COLORS.dark.bg), 'the cover stays dark');
        h.ok(tree.root.findByType(TilePlate).findAll((n) => hostType(n) === 'Path' && n.props.strokeWidth === TILE_RIM.width).length === 1, 'the plate keeps its dark-mode rim');
        const label = tree.root.findAll((n) => hostType(n) === 'Text' && textOf(n) === COPY.appBootLabel).at(-1)!;
        h.eq(flat(label).color, COLORS.dark['text-2'], '"Opening…" stays dark-mode text');

        await frame({ kind: 'error', trusted: true, payload: { where: 'mount', name: 'TypeError' } });
        const screen = tree.root.findAll((n) => hostType(n) === 'ScrollView' && textOf(n).includes(COPY.appCrashedBody))[0];
        const title = tree.root.findAll((n) => hostType(n) === 'Text' && textOf(n) === appCrashedTitle(TIP.name)).at(-1)!;
        const retry = flat(button(tree, COPY.actionReload)) as Style & { borderColor?: string };
        h.eq([flat(screen).backgroundColor, flat(title).color, retry.backgroundColor], [COLORS.dark.bg, COLORS.dark.text, buttonColors(dark, 'ink', false).fill],
          'the recovery screen that replaces it is still the dark one: bg, text and its primary button');

        await press(button(tree, COPY.actionReload));
        h.eq(flat(containerOf(tree)).backgroundColor, COLORS.light.bg, 'Reload’s fresh realm opens on the phone’s light bg');
        await loadEnd();
        h.eq(deliveredTheme(injectedScripts.at(-1)).scheme, 'light', 'and is delivered light');
        h.eq([flat(containerOf(tree)).backgroundColor, flat(webView()!).backgroundColor], [COLORS.light.bg, COLORS.light.bg], 'then held to light');
      }, { tint: 'ocean', icon: 'receipt' });
    } finally {
      setColorScheme('light');
    }
  });

  await h.test('pool: a warm hand-over delivers the theme for the phone’s settings at the open, not those it warmed under: dark, 135% text, ocean', async () => {
    const before = { OS: Platform.OS, fontScale: windowMetrics.fontScale, ...accessibilitySettings };
    const phone = async () => {
      windowMetrics.fontScale = 1.35;
      accessibilitySettings.reduceMotion = true;
      accessibilitySettings.increaseContrast = true;
      await TestRenderer.act(async () => {
        emitAccessibility('reduceMotionChanged', true);
        emitAccessibility('highTextContrastChanged', true);
        setColorScheme('dark');
      });
    };
    const ocean = { tint: 'ocean', icon: 'receipt' } as const;
    try {
      Platform.OS = 'android';
      await phone();
      let cold: Record<string, unknown> = {};
      await withMiniApp(TIP, async ({ loadEnd }) => {
        await loadEnd();
        cold = withoutInset(deliveredTheme(injectedScripts[0]));
      }, ocean);
      Object.assign(accessibilitySettings, { reduceMotion: false, increaseContrast: false });
      windowMetrics.fontScale = 1;
      setColorScheme('light');

      await withStage(async ({ show, webViews, send }) => {
        const [waiting] = webViews();
        await TestRenderer.act(async () => waiting.props.onLoadEnd());
        await send(waiting, WARM_ANSWER);
        await phone();
        await show(launchOf(TIP, { tile: ocean }));
        const [web] = webViews();
        h.ok(web === waiting, 'the app takes the WebView that warmed while the phone was light');
        const warm = withoutInset(deliveredTheme(deliveriesInto(web)[0])) as { colors?: Record<string, unknown> };
        const { colors, ...settings } = warm;
        h.eq(settings, { scheme: 'dark', tint: 'ocean', fontScale: 1.35, reduceMotion: true, increaseContrast: true, platform: 'android' },
          'the scheme, the app’s tint, the text scale, Reduce Motion, Increase Contrast and the platform at the open');
        h.eq([colors?.bg, colors?.primary], [COLORS.dark.bg, TINTS.ocean.dark], 'in the dark colours and ocean’s dark value');
        h.eq(warm, cold, 'exactly the theme a cold open under the same settings delivers');
      });
    } finally {
      Object.assign(accessibilitySettings, { reduceMotion: before.reduceMotion, increaseContrast: before.increaseContrast });
      windowMetrics.fontScale = before.fontScale;
      Platform.OS = before.OS;
      setColorScheme('light');
    }
  });

  await h.test('mini-app: an app’s errors are uploaded as their class and site only, so "Alice owes 40" never leaves the phone', async () => {
    const bodies: string[] = [];
    log.diagnostics.configure({
      target: () => ({ baseUrl: 'https://server.test', headers: {} }),
      osVersion: '15',
      post: async (_url, _headers, body) => {
        bodies.push(body);
        return { ok: true, status: 204 };
      },
    });
    try {
      await withMiniApp(TIP, async ({ loadEnd, frame }) => {
        await loadEnd();
        await frame(firstPaint());
        // A handler throws `new Error("Alice owes 40")`: loader.js reports the class, never the message.
        await frame({ kind: 'error', trusted: true, payload: { where: 'runtime', name: 'Error' } });
        // It throws `Object.assign(new Error("x"), { name: "Alice owes 40" })`: the name is the app's own.
        await frame({ kind: 'error', trusted: true, payload: { where: 'runtime', name: 'Alice owes 40' } });
        // A mount throw: loader.js's mount frame carries the message as well.
        await frame({ kind: 'error', trusted: true, payload: { where: 'mount', name: 'TypeError', message: 'Alice owes 40' } });
      });
      await log.diagnostics.flush();
    } finally {
      log.diagnostics.configure({ target: () => null });
    }
    const batches = bodies.map((body) => JSON.parse(body) as unknown);
    h.ok(batches.length > 0 && batches.every((batch) => DiagnosticsBatch.safeParse(batch).success), 'every upload is a batch the server accepts');
    h.eq(
      batches.flatMap((batch) => (batch as DiagnosticsBatch).records).map((r) => [r.message, r.where, r.errorClass]),
      [
        ['mini-app error', 'runtime', 'Error'],
        ['mini-app error', 'runtime', 'Other'],
        ['mini-app failed', 'mount', 'TypeError'],
      ],
      'each error is its site and a built-in class; a name the app made up is Other',
    );
    h.ok(!bodies.some((body) => body.includes('Alice')), '"Alice" appears nowhere in any batch');
    h.ok(!bodies.some((body) => body.includes(TIP.appId)), 'nor does the app’s id');
  });

  await h.test('mini-app: an app that never paints reaches the recovery screen when the startup deadline passes', async () => {
    await withMiniApp(TIP, async ({ loadEnd, shown, clock }) => {
      await loadEnd();
      log.buffer.clear();
      await TestRenderer.act(async () => clock.fire(STARTUP_DEADLINE_MS));
      h.ok(shown().includes(COPY.appCrashedBody), 'the recovery screen shows instead of an endless boot surface');
      h.eq(
        miniAppErrorRecords(),
        [{ message: 'mini-app failed', fields: { where: 'paint-timeout', errorClass: 'StartupDeadline', appId: TIP.appId } }],
        'and the timeout is an error record',
      );
    });
  });

  await h.test('mini-app: leaving through Android back at the app’s root, or unmounting, disarms the startup deadline', async () => {
    await withMiniApp(TIP, async ({ loadEnd, clock, exits }) => {
      await loadEnd();
      await TestRenderer.act(async () => { hardwareBack(); });
      h.eq(exits(), 1, 'back at the root leaves the app');
      h.eq(clock.count(STARTUP_DEADLINE_MS), 0, 'and no deadline outlives it');
    });
    await withMiniApp(TIP, async ({ loadEnd, clock, tree }) => {
      await loadEnd();
      await unmountScreen(tree);
      h.eq(clock.count(STARTUP_DEADLINE_MS), 0, 'unmounting leaves no deadline behind');
    });
  });

  await h.test('mini-app: unmounting a running storage app closes its database without calling exit', async () => {
    await withMiniApp(WATER, async ({ loadEnd, frame, tree, exits, shown }) => {
      await loadEnd();
      await frame(firstPaint());
      h.ok(!shown().includes(COPY.launchFailedTitle), 'the storage app launched');
      h.eq(closedDatabases.get(`${WATER.appId}.db`) ?? 0, 0, 'its database is open while it runs');
      await unmountScreen(tree);
      h.eq(closedDatabases.get(`${WATER.appId}.db`) ?? 0, 1, 'unmounting closes it');
      h.eq(exits(), 0, 'without the exit callback, which is for the user leaving');
    });
  });

  await h.test('mini-app: an app whose stored data cannot be opened with its schema gets the launch-failed screen, in plain words', async () => {
    // A previous version of the app stored `at` as a date; this version declares it as text. The
    // engine refuses to reinterpret existing data, so the launch is refused before delivery.
    const conflicting: AppRecord = JSON.parse(JSON.stringify(WATER));
    conflicting.schemaArtifact!.collections.Drinks.fields.at.type = 'text';
    await withMiniApp(conflicting, async ({ loadEnd, shown, opening, clock, tree, exits }) => {
      const earlier = createStorageEngine({ appId: WATER.appId, mode: "persistent" });
      earlier.open(WATER.schemaArtifact!);
      earlier.close();
      log.buffer.clear();
      await loadEnd();
      h.ok(shown().includes(COPY.launchFailedTitle) && !opening(), 'the launch-failed screen replaces the opening state');
      await TestRenderer.act(async () => { clock.fireWithin(1_500); });
      h.ok(!opening() && !shown().includes(COPY.appBootLabel), 'and no opening state or "Opening…" comes back over it');
      h.eq(
        miniAppErrorRecords(),
        [{ message: 'mini-app failed', fields: { where: 'launch', errorClass: 'type_change', appId: WATER.appId } }],
        'the refused launch is one error record, carrying the refusal kind and not the engine hint',
      );
      h.eq(injectedScripts.length, 0, 'and nothing was delivered');
      h.ok(!/type|schema|kind|hint|date|text/i.test(shown().replace(COPY.launchFailedBody, '').replace(COPY.launchFailedTitle, '').replace(COPY.launchFailedBack, '')),
        'no engine vocabulary or raw error detail is shown beside the copy');
      await press(button(tree, COPY.launchFailedBack));
      h.eq(exits(), 1, 'Back leaves the app');
    });
  });
}
