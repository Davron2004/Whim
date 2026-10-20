/** A rendered mini-app container (`MiniAppView` over `useMiniAppHost`) driven the way its WebView
 *  drives it: page-load events and frames from the sandbox page. Covers the boot surface and the
 *  startup deadline, which frames it trusts, delivering once per WebView mount, the recovery screen
 *  for a bundle that fails, launch refusal, and releasing the app's storage on unmount. */
import React from 'react';
import TestRenderer from 'react-test-renderer';
import { Harness } from './harness';
import { COPY } from '../copy';
import MiniAppView from '../MiniAppView';
import { STARTUP_DEADLINE_MS } from '../boot-state';
import type { InstalledApp } from '../app-index';
import type { StoreAccess } from '../store-access';
import type { AppRecord } from '../../bridge';
import { createStorageEngine } from '../../storage-engine';
import { DEFAULT_THEME, sanitizeTheme } from '../../../sdk/theme';
import { COLORS, ON_TINT, TINTS } from '../../../design/tokens';
import { APP_BUNDLES } from '../../../runtime/generated/app-bundles';
import { APP_RECORDS } from '../../../runtime/generated/app-records';
import { DiagnosticsBatch } from '@whim/contract';
import { log } from '../../logging';
import { accessibilitySettings, finishAnimations, injectedScripts, Platform, setColorScheme, StyleSheet, windowMetrics } from './native-host';
import { keyboardWindow, moveKeyboard, resetKeyboard } from './native-keyboard-controller';
import RENDER_ERROR_FRAME from './render-error-frame.json';
import { closedDatabases, resetNativeStorage } from './native-storage';
import { button, captureTimeouts, press, renderScreen, textOf, unmountScreen, hostType } from './react-screen';
import { grantedOptions } from './client-fixtures';

type Tree = TestRenderer.ReactTestRenderer;

const TIP: AppRecord = APP_RECORDS['tip-splitter'];
const WATER: AppRecord = APP_RECORDS['water-counter'];

interface Mounted {
  tree: Tree;
  exits: () => number;
  clock: ReturnType<typeof captureTimeouts>;
  webView: () => TestRenderer.ReactTestInstance | undefined;
  loadEnd: () => Promise<void>;
  frame: (frame: unknown) => Promise<void>;
  shown: () => string;
}

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
  const container = tree.root.findAll((n) => hostType(n) === 'View' && n.findAll(isWebView).length > 0).at(-1)!;
  const web = container.findAll(isWebView)[0];
  const pad = (StyleSheet.flatten(container.props.style) as { paddingBottom?: number }).paddingBottom ?? 0;
  return pad + ((StyleSheet.flatten(web.props.style) as { marginBottom?: number }).marginBottom ?? 0);
}

/** Mount the container for `record` (installed with `tile`, if given), run `body`, and unmount. */
async function withMiniApp(record: AppRecord, body: (m: Mounted) => Promise<void>, tile?: Pick<InstalledApp, 'tint' | 'icon'>): Promise<void> {
  resetNativeStorage();
  injectedScripts.length = 0;
  const clock = captureTimeouts();
  let exits = 0;
  const app: InstalledApp = { id: record.appId, name: record.name, createdAt: 1, lineageId: 'main', record, ...tile };
  const tree = await renderScreen(
    <MiniAppView
      record={record}
      bundleSource={APP_BUNDLES[record.appId]}
      engineAppId={record.appId}
      onExit={() => { exits++; }}
      onVersions={() => {}}
      onChangeIt={() => {}}
      installedApp={app}
      access={{} as StoreAccess}
      reportOptions={grantedOptions('https://server.test', 'device')}
      onUpdateRequired={() => {}}
      legalLanguage="en"
    />,
    { createNodeMock: measuredAsContainer },
  );
  const webView = () => tree.root.findAll((n) => hostType(n) === 'WebView')[0];
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

  await h.test('mini-app: the boot surface covers a WebView that is already mounted, until a trusted first paint', async () => {
    await withMiniApp(TIP, async ({ webView, loadEnd, frame, shown, clock }) => {
      h.ok(webView() != null, 'the WebView is mounted from the start, so the page keeps loading');
      h.ok(shown().includes(COPY.appBootLabel), 'under the boot surface');
      await loadEnd();
      h.eq(injectedScripts.length, 1, 'the bundle is delivered once the page has loaded');
      h.eq(clock.count(STARTUP_DEADLINE_MS), 1, 'and the startup deadline is running');
      await frame({ ...firstPaint(), trusted: false });
      h.ok(shown().includes(COPY.appBootLabel), 'a paint frame that is not authenticated leaves the boot surface up');
      h.eq(clock.count(STARTUP_DEADLINE_MS), 1, 'and does not disarm the deadline');
      await frame(firstPaint());
      h.ok(!shown().includes(COPY.appBootLabel), 'the authenticated first paint stamped with this launch’s generation ends the boot surface');
      h.eq(clock.count(STARTUP_DEADLINE_MS), 0, 'and completes startup');
    });
  });

  await h.test('mini-app: a trusted paint stamped for another launch leaves the boot surface up, and the startup deadline still fails it', async () => {
    await withMiniApp(TIP, async ({ loadEnd, frame, shown, clock }) => {
      await loadEnd();
      const bound = boundGeneration();
      await frame(firstPaint(bound - 1));
      h.ok(shown().includes(COPY.appBootLabel), 'a paint from the launch before this one does not end the boot surface');
      await frame(firstPaint(bound + 1));
      h.ok(shown().includes(COPY.appBootLabel), 'nor does one claiming a launch that has not happened');
      h.eq(clock.count(STARTUP_DEADLINE_MS), 1, 'the startup deadline stays armed');
      await TestRenderer.act(async () => clock.fire(STARTUP_DEADLINE_MS));
      h.ok(shown().includes(COPY.appErrorTitle), 'and, with no paint of its own, the launch reaches the recovery screen');
    });
  });

  await h.test('mini-app: after Retry recreates the realm, the old realm’s late paint cannot open the new one', async () => {
    await withMiniApp(TIP, async ({ loadEnd, frame, shown, clock, tree }) => {
      await loadEnd();
      const old = boundGeneration();
      await frame({ kind: 'error', trusted: true, payload: { where: 'mount', name: 'TypeError' } });
      await press(button(tree, COPY.appErrorRetry));
      await loadEnd();
      h.ok(boundGeneration() !== old, 'the recreated realm is bound at a new generation');
      await frame(firstPaint(old));
      h.ok(shown().includes(COPY.appBootLabel), 'the old realm’s paint, arriving late, leaves the new launch booting');
      h.eq(clock.count(STARTUP_DEADLINE_MS), 1, 'with its startup deadline armed');
      await frame(firstPaint());
      h.ok(!shown().includes(COPY.appBootLabel), 'the new realm’s own paint opens it');
      h.eq(clock.count(STARTUP_DEADLINE_MS), 0, 'and completes startup');
    });
  });

  await h.test('mini-app: a second load event for the same WebView does not deliver the bundle again', async () => {
    await withMiniApp(TIP, async ({ loadEnd }) => {
      await loadEnd();
      await loadEnd();
      h.eq(injectedScripts.length, 1, 'one delivery per WebView mount, however many load events it reports');
    });
  });

  await h.test('mini-app: a bundle that fails shows the recovery screen; Retry mounts a fresh WebView and delivers again', async () => {
    await withMiniApp(TIP, async ({ webView, loadEnd, frame, shown, clock, tree }) => {
      await loadEnd();
      await frame(firstPaint());
      const first = webView();
      await frame({ kind: 'error', trusted: true, payload: { where: 'bundle', message: 'SENTINEL_TypeError: x is undefined' } });
      h.ok(shown().includes(COPY.appErrorTitle), 'the recovery screen replaces the app');
      h.ok(!shown().includes('SENTINEL'), 'without the raw error text');
      h.ok(webView() == null, 'the failed realm’s WebView is gone');
      const retry = StyleSheet.flatten(button(tree, COPY.appErrorRetry).props.style) as { backgroundColor?: string; borderColor?: string };
      h.eq(retry.borderColor, retry.backgroundColor, 'Retry is its primary action, filled edge to edge with no ring of another colour');
      await press(button(tree, COPY.appErrorRetry));
      h.ok(webView() != null && webView() !== first, 'Retry mounts a new WebView');
      h.ok(!shown().includes(COPY.appErrorTitle), 'the recovery screen is gone');
      await loadEnd();
      h.ok(shown().includes(COPY.appBootLabel), 'the new realm starts from the boot surface, not the old realm’s paint');
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
      h.ok(webView() != null && !shown().includes(COPY.appErrorTitle), 'the app keeps running');
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
      h.ok(webView() != null && !shown().includes(COPY.appErrorTitle), 'neither takes the app down');
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
      h.ok(shown().includes(COPY.appErrorTitle), 'the recovery screen shows');
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
      h.ok(webView() != null && !shown().includes(COPY.appErrorTitle), 'the app keeps running');
      h.eq(miniAppErrorRecords(), [], 'and no mini-app error record is emitted');
    });
  });

  await h.test('mini-app: a render error after the first paint shows the recovery screen instead of a blank app', async () => {
    await withMiniApp(TIP, async ({ webView, loadEnd, frame, shown }) => {
      await loadEnd();
      await frame(firstPaint());
      log.buffer.clear();
      await frame(RENDER_ERROR_FRAME);
      h.ok(shown().includes(COPY.appErrorTitle), 'the recovery screen replaces the unmounted app');
      h.ok(webView() == null, 'and the failed realm’s WebView is gone, so Retry recreates it');
      h.eq(
        miniAppErrorRecords(),
        [{ message: 'mini-app failed', fields: { where: 'render', errorClass: 'LedgerError', appId: TIP.appId } }],
        'one error record, with the site and the class',
      );
    });
  });

  await h.test('mini-app: a render error before the first paint is one failure, not a boot surface that later times out', async () => {
    await withMiniApp(TIP, async ({ loadEnd, frame, shown, clock }) => {
      await loadEnd();
      log.buffer.clear();
      await frame(RENDER_ERROR_FRAME);
      h.ok(shown().includes(COPY.appErrorTitle) && !shown().includes(COPY.appBootLabel), 'the recovery screen shows at once');
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
      h.ok(webView() != null && !shown().includes(COPY.appErrorTitle), 'the app keeps running');
      h.eq(miniAppErrorRecords(), [], 'and no mini-app error record is emitted');
    });
  });

  await h.test('mini-app: every delivery tells the realm how much of its bottom edge the orb covers, bottom safe-area inset included', async () => {
    await withMiniApp(TIP, async ({ loadEnd, frame, tree }) => {
      await loadEnd();
      const orb = StyleSheet.flatten(button(tree, COPY.orbMenuOpenLabel).props.style) as { bottom: number; height: number };
      const first = deliveredTheme(injectedScripts[0]);
      h.eq(first.chromeInsetBottom, orb.bottom + orb.height, 'the footprint reaches exactly the top of the orb as drawn over the inset');
      const theme = withoutInset(first);
      h.eq(theme, sanitizeTheme(theme), 'beside a theme the SDK keeps exactly as delivered');
      await frame({ kind: 'error', trusted: true, payload: { where: 'bundle' } });
      await press(button(tree, COPY.appErrorRetry));
      await loadEnd();
      h.eq(deliveredTheme(injectedScripts[1]).chromeInsetBottom, orb.bottom + orb.height, 'the recreated realm is told again');
    });
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
      h.ok(shown().includes(COPY.appErrorTitle), 'the recovery screen shows instead of an endless boot surface');
      h.eq(
        miniAppErrorRecords(),
        [{ message: 'mini-app failed', fields: { where: 'paint-timeout', errorClass: 'StartupDeadline', appId: TIP.appId } }],
        'and the timeout is an error record',
      );
    });
  });

  await h.test('mini-app: leaving through the orb, or unmounting, disarms the startup deadline', async () => {
    await withMiniApp(TIP, async ({ loadEnd, clock, tree, exits }) => {
      await loadEnd();
      await press(button(tree, COPY.orbMenuOpenLabel));
      await TestRenderer.act(async () => { finishAnimations(); });
      const home = tree.root.findAll((n) => hostType(n) === 'Pressable' && textOf(n).endsWith(COPY.orbActionHome));
      await press(home[0]);
      h.eq(exits(), 1, 'Home leaves the app');
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
    await withMiniApp(conflicting, async ({ loadEnd, shown, tree, exits }) => {
      const earlier = createStorageEngine({ appId: WATER.appId, mode: "persistent" });
      earlier.open(WATER.schemaArtifact!);
      earlier.close();
      log.buffer.clear();
      await loadEnd();
      h.ok(shown().includes(COPY.launchFailedTitle), 'the launch-failed screen shows');
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
