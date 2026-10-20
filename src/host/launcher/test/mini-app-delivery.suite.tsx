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
import { finishAnimations, injectedScripts } from './native-host';
import { button, press, renderScreen, textOf, unmountScreen, hostType } from './react-screen';
import { COPY } from '../copy';

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

const webView = (tree: TestRenderer.ReactTestRenderer) => tree.root.find((node) => hostType(node) === 'WebView');

export async function runMiniAppDeliveryTests(h: Harness): Promise<void> {
  await h.test('delivery: opening an installed app injects its stored bundle once the page has loaded', async () => {
    await withLauncher(async () => 'window.__WHIM_APP_MODULE__ = { marker: "timer-bundle-7f3a" };', async (tree) => {
      await TestRenderer.act(async () => tree.root.findByType(HomeScreen).props.onOpen(app));
      h.eq(injectedScripts.length, 0, 'nothing is injected before the page reports it has loaded');
      await TestRenderer.act(async () => webView(tree).props.onLoadEnd());
      h.eq(injectedScripts.length, 1, 'one script is injected on load');
      h.ok(injectedScripts[0]?.includes('timer-bundle-7f3a') ?? false, 'the injected script carries the stored bundle');
      await press(button(tree, COPY.orbMenuOpenLabel));
      await TestRenderer.act(async () => { finishAnimations(); });
      await press(tree.root.find((node) => hostType(node) === 'Pressable' && textOf(node).endsWith(COPY.orbActionHome)));
      h.ok(tree.root.findAll((node) => hostType(node) === 'WebView').length === 0, 'closing it through the orb ends its realm');
      h.eq(tree.root.findAllByType(HomeScreen).length, 1, 'and returns to Home');
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
        await TestRenderer.act(async () => webView(tree).props.onLoadEnd());
        const generation = Number(/,generation:(\d+)/.exec(injectedScripts[0] ?? '')?.[1]);
        now += 50;
        const paint = { kind: 'paint', trusted: true, payload: { generation, mountToFirstPaintMs: 18, appName: 'Timer' } };
        await TestRenderer.act(async () => webView(tree).props.onMessage({ nativeEvent: { data: JSON.stringify(paint) } }));
        const timed = log.buffer.snapshot().filter((r) => r.message === 'tap to first paint').map((r) => r.fields);
        h.eq(timed, [{ tapToPaintMs: 200, paintMs: 18 }], 'the 120 ms bundle read, the page load and the paint, from the tap');
      });
    } finally {
      Date.now = realNow;
    }
  });
}
