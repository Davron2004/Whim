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
import { resetNativeStorage } from './native-storage';
import { injectedScripts } from './native-host';
import { renderScreen, unmountScreen } from './react-screen';

const app: InstalledApp = { id: 'timer', name: 'Timer', createdAt: 1, lineageId: 'main', record: { appId: 'timer', name: 'Timer', manifest: { capabilities: [] } } };

export async function runMiniAppDeliveryTests(h: Harness): Promise<void> {
  await h.test('delivery: opening an installed app injects its stored bundle once the page has loaded', async () => {
    resetNativeStorage();
    injectedScripts.length = 0;
    const index = new AppIndex(createMmkvBackend('whim.launcher'));
    index.markSeeded(SEED_VERSION);
    index.put(app);
    const originalActiveBundle = StoreAccess.prototype.activeBundle;
    StoreAccess.prototype.activeBundle = async () => 'window.__WHIM_APP_MODULE__ = { marker: "timer-bundle-7f3a" };';
    const tree = await renderScreen(<LauncherRoot />);
    try {
      await TestRenderer.act(async () => tree.root.findByType(HomeScreen).props.onOpen(app));
      h.eq(injectedScripts.length, 0, 'nothing is injected before the page reports it has loaded');
      await TestRenderer.act(async () => tree.root.find((node) => node.type === 'WebView').props.onLoadEnd());
      h.eq(injectedScripts.length, 1, 'one script is injected on load');
      h.ok(injectedScripts[0]?.includes('timer-bundle-7f3a') ?? false, 'the injected script carries the stored bundle');
    } finally {
      await unmountScreen(tree);
      StoreAccess.prototype.activeBundle = originalActiveBundle;
    }
  });
}
