/** A rendered launcher opening an installed app injects that app's bundle into its WebView. */
import React from 'react';
import TestRenderer from 'react-test-renderer';
import { Harness } from './harness';
import HomeScreen from '../HomeScreen';
import LauncherRoot from '../LauncherRoot';
import { StoreAccess } from '../store-access';
import { AppIndex, type InstalledApp } from '../app-index';
import { createMmkvBackend } from '../../version-store/fs/mmkv-backend';
import { SEED_VERSION } from '../seed';
import { log } from '../../logging';
import { resetNativeStorage } from './native-storage';
import { injectedScripts, setColorScheme, StyleSheet } from './native-host';
import { boundWebView, button, press, renderScreen, unmountScreen, hostType } from './react-screen';
import { COPY } from '../copy';
import { COLORS } from '../../../design/tokens';

const app: InstalledApp = { id: 'timer', name: 'Timer', createdAt: 1, lineageId: 'main', record: { appId: 'timer', name: 'Timer', manifest: { capabilities: [] } } };

/** Render the launcher with `app` installed, its stored bundle read by `activeBundle`; run `body`. */
async function withLauncher(activeBundle: () => Promise<string>, body: (tree: TestRenderer.ReactTestRenderer) => Promise<void>): Promise<void> {
  resetNativeStorage();
  injectedScripts.length = 0;
  const index = new AppIndex(createMmkvBackend('whim.launcher'));
  index.markSeeded(SEED_VERSION);
  index.put(app);
  const originalActiveBundle = StoreAccess.prototype.activeBundle;
  StoreAccess.prototype.activeBundle = activeBundle;
  const tree = await renderScreen(<LauncherRoot deviceLocale={() => 'en-US'} />);
  try {
    await body(tree);
  } finally {
    await unmountScreen(tree);
    StoreAccess.prototype.activeBundle = originalActiveBundle;
  }
}

const webViews = (tree: TestRenderer.ReactTestRenderer) => tree.root.findAll((node) => hostType(node) === 'WebView');

const bg = (node: TestRenderer.ReactTestInstance) => (StyleSheet.flatten(node.props.style) as { backgroundColor?: string }).backgroundColor;
const strip = (tree: TestRenderer.ReactTestRenderer) => bg(tree.root.findAll((node) => hostType(node) === 'SafeAreaView')[0]);
const barStyle = (tree: TestRenderer.ReactTestRenderer) => tree.root.find((node) => hostType(node) === 'StatusBar').props.barStyle;
const webViewsIn = (node: TestRenderer.ReactTestInstance) => node.findAll((n) => hostType(n) === 'WebView');
const holdsWebView = (node: TestRenderer.ReactTestInstance) => hostType(node) === 'View' && webViewsIn(node).length > 0 && bg(node) !== undefined;
/** Everything painted behind the open app's page: the container and the WebView's own background. */
const behindPage = (tree: TestRenderer.ReactTestRenderer) => [...tree.root.findAll(holdsWebView), boundWebView(tree)].map(bg);

export async function runMiniAppDeliveryTests(h: Harness): Promise<void> {
  await h.test('delivery: opening an installed app injects its stored bundle once the page has loaded', async () => {
    await withLauncher(async () => 'window.__WHIM_APP_MODULE__ = { marker: "timer-bundle-7f3a" };', async (tree) => {
      h.eq(webViews(tree).length, 1, 'one WebView waits on Home');
      const [waiting] = webViews(tree);
      await TestRenderer.act(async () => tree.root.findByType(HomeScreen).props.onOpen(app));
      h.ok(boundWebView(tree) === waiting, 'the app opens in the WebView that was waiting on Home');
      h.eq(injectedScripts.length, 0, 'nothing is injected before the page reports it has loaded');
      await TestRenderer.act(async () => boundWebView(tree).props.onLoadEnd());
      h.eq(injectedScripts.length, 1, 'one script is injected on load');
      h.ok(injectedScripts[0]?.includes('timer-bundle-7f3a') ?? false, 'the injected script carries the stored bundle');
      await press(button(tree, COPY.orbMenuOpenLabel));
      await press(button(tree, COPY.whimSheetBackToApps));
      h.ok(!webViews(tree).includes(waiting), 'closing it through the orb’s Whim sheet ends its realm with its WebView');
      h.eq(tree.root.findAllByType(HomeScreen).length, 1, 'and returns to Home');
      h.eq(injectedScripts.length, 1, 'over a fresh WebView waiting, which nothing was injected into');
    });
  });

  await h.test('delivery: tap to first paint is timed from the tap itself, so reading the stored bundle counts', async () => {
    const realNow = Date.now;
    let now = 5_000_000;
    Date.now = () => now;
    try {
      await withLauncher(async () => {
        now += 120;
        return 'window.__WHIM_APP_MODULE__ = {};';
      }, async (tree) => {
        log.buffer.clear();
        await TestRenderer.act(async () => tree.root.findByType(HomeScreen).props.onOpen(app));
        now += 30;
        await TestRenderer.act(async () => boundWebView(tree).props.onLoadEnd());
        const generation = Number(/,generation:(\d+)/.exec(injectedScripts[0] ?? '')?.[1]);
        now += 50;
        const paint = { kind: 'paint', trusted: true, payload: { generation, mountToFirstPaintMs: 18, appName: 'Timer' } };
        await TestRenderer.act(async () => boundWebView(tree).props.onMessage({ nativeEvent: { data: JSON.stringify(paint) } }));
        const timed = log.buffer.snapshot().filter((r) => r.message === 'tap to first paint').map((r) => r.fields);
        h.eq(timed, [{ tapToPaintMs: 200, paintMs: 18, webView: 'loading' }],
          'the 120 ms bundle read, the page load and the paint, from the tap, in the WebView that was still loading on Home');
      });
    } finally {
      Date.now = realNow;
    }
  });

  await h.test('delivery: once the open app has painted and a second WebView waits beside it, the bound WebView is still the one that takes touches', async () => {
    await withLauncher(async () => 'window.__WHIM_APP_MODULE__ = {};', async (tree) => {
      await TestRenderer.act(async () => tree.root.findByType(HomeScreen).props.onOpen(app));
      const [opened] = webViews(tree);
      await TestRenderer.act(async () => boundWebView(tree).props.onLoadEnd());
      const generation = Number(/,generation:(\d+)/.exec(injectedScripts[0] ?? '')?.[1]);
      const paint = { kind: 'paint', trusted: true, payload: { generation, mountToFirstPaintMs: 18, appName: 'Timer' } };
      await TestRenderer.act(async () => opened.props.onMessage({ nativeEvent: { data: JSON.stringify(paint) } }));
      h.eq(webViews(tree).length, 2, 'a replacement WebView waits beside the open app');
      h.ok(boundWebView(tree) === opened, 'the helper picks the app’s own WebView, not the one waiting');
    });
  });

  await h.test('frame: over an open app the status-bar strip is the app’s own bg and the status bar reads on it, light and dark', async () => {
    try {
      for (const scheme of ['light', 'dark'] as const) {
        setColorScheme(scheme);
        await withLauncher(async () => 'window.__WHIM_APP_MODULE__ = {};', async (tree) => {
          await TestRenderer.act(async () => tree.root.findByType(HomeScreen).props.onOpen(app));
          const frame = tree.root.findAll((node) => hostType(node) === 'SafeAreaView')[0];
          h.eq((StyleSheet.flatten(frame.props.style) as { backgroundColor?: string }).backgroundColor, COLORS[scheme].bg,
            `${scheme}: the strip above the app is the bg the app’s container and page paint, with no edge between them`);
          h.eq(tree.root.find((node) => hostType(node) === 'StatusBar').props.barStyle, scheme === 'dark' ? 'light-content' : 'dark-content',
            `${scheme}: and the status bar’s content contrasts with it`);
        });
      }
    } finally {
      setColorScheme('light');
    }
  });

  await h.test('frame: an app opened in dark keeps its dark strip, status bar, container and page background when the phone turns light; Home and the next open are light', async () => {
    const open = async (tree: TestRenderer.ReactTestRenderer) => {
      await TestRenderer.act(async () => tree.root.findByType(HomeScreen).props.onOpen(app));
      await TestRenderer.act(async () => boundWebView(tree).props.onLoadEnd());
    };
    try {
      setColorScheme('dark');
      await withLauncher(async () => 'window.__WHIM_APP_MODULE__ = {};', async (tree) => {
        await open(tree);
        await TestRenderer.act(async () => { setColorScheme('light'); });
        h.eq([strip(tree), barStyle(tree)], [COLORS.dark.bg, 'light-content'], 'the strip and the status bar stay as the app opened');
        const behind = behindPage(tree);
        h.ok(behind.length >= 2 && behind.every((c) => c === COLORS.dark.bg), `the container and the page background stay dark (${behind.join(', ')})`);

        await press(button(tree, COPY.orbMenuOpenLabel));
        await press(button(tree, COPY.whimSheetBackToApps));
        h.eq(tree.root.findAllByType(HomeScreen).length, 1, 'closed to Home');
        h.eq([strip(tree), barStyle(tree)], [COLORS.light.bg, 'dark-content'], 'Home follows the phone: light');

        injectedScripts.length = 0;
        await open(tree);
        h.ok(injectedScripts.at(-1)?.includes('"scheme":"light"') ?? false, 'the next open is delivered light');
        h.eq([strip(tree), barStyle(tree)], [COLORS.light.bg, 'dark-content'], 'and framed light');
        h.ok(behindPage(tree).every((c) => c === COLORS.light.bg), 'over a light container and page background');
      });
    } finally {
      setColorScheme('light');
    }
  });
}
