/** Real Home/sheet/root interactions; URL parsing and routing policy have their own suites. */
import React from 'react';
import TestRenderer from 'react-test-renderer';
import { Harness } from './harness';
import { COPY } from '../copy';
import HomeScreen from '../HomeScreen';
import LauncherRoot from '../LauncherRoot';
import MiniAppView from '../MiniAppView';
import ComposeStep from '../ComposeStep';
import { StoreAccess } from '../store-access';
import { grantConsent } from '../ai-consent';
import { acceptTerms } from '../terms-acceptance';
import { log } from '../../logging';
import AppLinkMissingScreen from '../AppLinkMissingScreen';
import FailureScreen from '../FailureScreen';
import { appLinkFor } from '../app-link';
import { AppIndex, type InstalledApp } from '../app-index';
import { PendingBuildStore } from '../pending-builds';
import { createMmkvBackend } from '../../version-store/fs/mmkv-backend';
import { SEED_VERSION } from '../seed';
import { resetNativeStorage } from './native-storage';
import { Linking, linkListenerCount, openLink } from './native-host';
import { button, press, renderScreen, unmountScreen, textOf } from './react-screen';
import { testAppInfo } from './client-fixtures';

const app: InstalledApp = { id: 'timer', name: 'Timer', createdAt: 1, lineageId: 'main', record: { appId: 'timer', name: 'Timer', manifest: { capabilities: [] } } };
const noop = () => {};
export async function runAppLinkUiTests(h: Harness): Promise<void> {
  await h.test('App link: installed tile reveals selectable link and Close dismisses it', async () => {
    const tree = await renderScreen(<HomeScreen apps={[app]} onOpen={noop} onFork={noop} onDelete={noop} onHistory={noop} onPromptAgain={noop} onCreate={noop} onSettings={noop} />);
    try {
      await TestRenderer.act(async () => tree.root.find(node => node.type === 'TouchableOpacity' && typeof node.props.onLongPress === 'function').props.onLongPress());
      await press(button(tree, COPY.actionAppLink));
      const link = tree.root.find(node => node.type === 'Text' && node.props.selectable === true);
      h.eq(textOf(link), appLinkFor(app.id), 'sheet exposes this app’s link as selectable text');
      await press(button(tree, COPY.appLinkSheetClose));
      h.eq(tree.root.findAll(node => node.type === 'Text' && node.props.selectable === true).length, 0, 'close removes the link from the rendered tree');
    } finally { await unmountScreen(tree); }
  });
  await h.test('App link: pending tile actions never offer a shareable link', async () => {
    resetNativeStorage();
    const pending = new PendingBuildStore(createMmkvBackend('whim.launcher'));
    pending.create({ id: 'building', prompt: 'Timer', workingTitle: 'Timer' });
    const tree = await renderScreen(<HomeScreen apps={[]} pending={pending.list()} onOpen={noop} onFork={noop} onDelete={noop} onHistory={noop} onPromptAgain={noop} onCreate={noop} onSettings={noop} onOpenPending={noop} onCancelPending={noop} onDismissPending={noop} />);
    try {
      await TestRenderer.act(async () => tree.root.find(node => node.type === 'TouchableOpacity' && typeof node.props.onLongPress === 'function').props.onLongPress());
      h.eq(tree.root.findAll(node => node.type === 'Text' && node.children.includes(COPY.actionAppLink)).length, 0, 'ghost quick actions contain no App link');
    } finally { await unmountScreen(tree); }
  });
  for (const cold of [false, true]) {
    await h.test(`App link: ${cold ? 'cold' : 'warm'} URL reaches missing and persisted-failure screens`, async () => {
      resetNativeStorage();
      const kv = createMmkvBackend('whim.launcher');
      new AppIndex(kv).markSeeded(SEED_VERSION);
      const pending = new PendingBuildStore(kv);
      pending.create({ id: 'failed', prompt: 'Timer', workingTitle: 'Timer' });
      pending.setFailed('failed', { reason: 'Server stopped', diagnostics: '' });
      Linking.initialURL = cold ? appLinkFor('missing') : null;
      const tree = await renderScreen(<LauncherRoot />);
      try {
        h.eq(linkListenerCount(), 1, 'launcher owns one native URL subscription');
        if (!cold) await TestRenderer.act(async () => openLink(appLinkFor('missing')));
        h.eq(tree.root.findAllByType(AppLinkMissingScreen).length, 1, 'missing link renders its friendly screen');
        await press(button(tree, COPY.appLinkMissingBack));
        h.eq(tree.root.findAllByType(HomeScreen).length, 1, 'visible action returns to the grid');
        await TestRenderer.act(async () => openLink(appLinkFor('failed')));
        h.eq(tree.root.findByType(FailureScreen).props.reason, 'Server stopped', 'warm link hydrates the saved failure');
        await press(button(tree, COPY.failureBack));
        h.eq(pending.list().length, 1, 'leaving preserves the failed attempt');
        await TestRenderer.act(async () => openLink('https://untrusted.example/path?secret=keep-private'));
        h.eq(tree.root.findAllByType(HomeScreen).length, 1, 'unsupported link does not navigate');
        const rejected = log.buffer.snapshot().filter(record => record.message === 'app link rejected').at(-1);
        h.eq(rejected?.fields, { scheme: 'https', host: 'untrusted.example' }, 'rejection logs only scheme and host');
      } finally { await unmountScreen(tree); Linking.initialURL = null; }
      h.eq(linkListenerCount(), 0, 'unmount removes the native URL subscription');
    });
  }
  await h.test('App link: installed target opens and a second link leaves its mounted app unchanged', async () => {
    resetNativeStorage();
    const index = new AppIndex(createMmkvBackend('whim.launcher'));
    index.markSeeded(SEED_VERSION);
    index.put(app);
    const originalActiveBundle = StoreAccess.prototype.activeBundle;
    const opened: string[] = [];
    StoreAccess.prototype.activeBundle = async target => { opened.push(target.id); return 'window.__WHIM_APP_MODULE__ = {};'; };
    const tree = await renderScreen(<LauncherRoot />);
    try {
      await TestRenderer.act(async () => openLink(appLinkFor(app.id)));
      const running = tree.root.findByType(MiniAppView);
      h.eq(running.props.installedApp.id, app.id, 'link opened the installed app');
      await TestRenderer.act(async () => openLink(appLinkFor(app.id)));
      h.ok(tree.root.findByType(MiniAppView) === running, 'same-app link preserves the mounted instance');
      h.eq(opened, [app.id], 'same-app link does not reload the stored bundle');
    } finally { await unmountScreen(tree); StoreAccess.prototype.activeBundle = originalActiveBundle; }
  });
  await h.test('App link: leaving clarify aborts its request and its late response cannot navigate', async () => {
    resetNativeStorage();
    const kv = createMmkvBackend('whim.launcher');
    new AppIndex(kv).markSeeded(SEED_VERSION);
    acceptTerms(kv, '2026-09-18T12:00:00.000Z');
    grantConsent(kv, '2026-09-18T12:00:00.000Z');
    const originalFetch = globalThis.fetch;
    let signal: AbortSignal | undefined;
    let finish!: (response: Response) => void;
    const response = new Promise<Response>(resolve => { finish = resolve; });
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      if (String(url).endsWith('/healthz')) return new Response(JSON.stringify({ service: 'whim-server' }));
      signal = init?.signal ?? undefined;
      return response;
    }) as typeof fetch;
    let tree: TestRenderer.ReactTestRenderer | undefined;
    try {
      tree = await renderScreen(<LauncherRoot appInfo={testAppInfo} />);
      await TestRenderer.act(async () => tree!.root.findByType(HomeScreen).props.onCreate());
      await TestRenderer.act(async () => tree!.root.findByType(ComposeStep).props.onChangeText('Timer'));
      let request!: Promise<void>;
      await TestRenderer.act(async () => { request = tree!.root.findByType(ComposeStep).props.onContinue(); });
      await TestRenderer.act(async () => openLink(appLinkFor('missing')));
      h.eq(signal?.aborted, true, 'arriving link aborts the request of the screen it leaves');
      await TestRenderer.act(async () => { finish(new Response(JSON.stringify({ questions: [] }))); await request; });
      h.eq(tree.root.findAllByType(AppLinkMissingScreen).length, 1, 'cancelled request cannot take over the linked screen');
    } finally {
      if (tree) await unmountScreen(tree);
      globalThis.fetch = originalFetch;
    }
  });

}
