/** Offline notices remain advisory; consent and refusal retry windows keep their own gates. */
import React from 'react';
import TestRenderer from 'react-test-renderer';
import { Harness } from './harness';
import HomeScreen from '../HomeScreen';
import ComposeStep from '../ComposeStep';
import ConsentScreen from '../ConsentScreen';
import LauncherRoot from '../LauncherRoot';
import { COPY } from '../copy';
import { AppIndex, type InstalledApp } from '../app-index';
import { SEED_VERSION } from '../seed';
import { grantConsent } from '../ai-consent';
import { acceptTerms } from '../terms-acceptance';
import { createMmkvBackend } from '../../version-store/fs/mmkv-backend';
import { resetNativeStorage } from './native-storage';
import { button, press, renderScreen, unmountScreen, textOf, captureTimeouts } from './react-screen';

const noop = () => {};
const app: InstalledApp = {
  id: 'timer', name: 'Timer', createdAt: 1, lineageId: 'main',
  record: { appId: 'timer', name: 'Timer', manifest: { capabilities: [] } },
};

function visibleTextCount(tree: TestRenderer.ReactTestRenderer, text: string): number {
  return tree.root.findAll(node => node.type === 'Text' && textOf(node) === text).length;
}
function createButton(tree: TestRenderer.ReactTestRenderer): TestRenderer.ReactTestInstance {
  return tree.root.find(node => node.type === 'TouchableOpacity' &&
    node.findAll(child => child.type === 'Text' && textOf(child) === COPY.homeComposerPlaceholder).length === 1);
}

export async function runConnectivityUxTests(h: Harness): Promise<void> {

  for (const offline of [true, false]) {
    await h.test(`Home: offline=${offline} shows the matching notice and keeps app/create controls enabled`, async () => {
      const opened: string[] = [];
      let creates = 0;
      const tree = await renderScreen(<HomeScreen apps={[app]} offline={offline}
        onOpen={target => opened.push(target.id)} onCreate={() => { creates++; }}
        onFork={noop} onDelete={noop} onHistory={noop} onPromptAgain={noop} onSettings={noop} />);
      try {
        h.eq(visibleTextCount(tree, COPY.homeOfflineIndicator), offline ? 1 : 0, 'the home notice follows connectivity');
        const tile = tree.root.find(node => node.type === 'TouchableOpacity' &&
          typeof node.props.onLongPress === 'function' && textOf(node).includes(app.name));
        await press(tile);
        await press(createButton(tree));
        h.eq(opened, [app.id], 'the visible installed tile opens its app');
        h.eq(creates, 1, 'the visible create control starts creation');
      } finally { await unmountScreen(tree); }
    });

    await h.test(`Compose: offline=${offline} shows the matching notice without blocking editing or Continue`, async () => {
      const edits: string[] = [];
      let continues = 0;
      const tree = await renderScreen(<ComposeStep text="Timer" editing={false} serverUnreachable={offline}
        onChangeText={text => edits.push(text)} onContinue={() => { continues++; }} onBack={noop} />);
      try {
        h.eq(visibleTextCount(tree, COPY.promptServerUnreachable), offline ? 1 : 0, 'the compose notice follows connectivity');
        const field = tree.root.findByType('TextInput');
        h.ok(field.props.editable !== false, 'the prompt remains editable');
        await TestRenderer.act(async () => field.props.onChangeText('A tea timer'));
        await press(button(tree, COPY.flowContinue));
        h.eq(edits, ['A tea timer'], 'typing reaches the edit callback');
        h.eq(continues, 1, 'Continue submits while offline as well as online');
      } finally { await unmountScreen(tree); }
    });
  }

  await h.test('Compose: an active refusal window disables Continue even when offline is only advisory', async () => {
    const clock = captureTimeouts();
    let continues = 0;
    let tree: TestRenderer.ReactTestRenderer | undefined;
    try {
      tree = await renderScreen(<ComposeStep text="Timer" editing={false} serverUnreachable
        notice={{ hint: 'Try again later', tone: 'neutral', retryAt: Date.now() + 60_000 }}
        onChangeText={noop} onContinue={() => { continues++; }} onBack={noop} />);
      h.eq(visibleTextCount(tree, COPY.promptServerUnreachable), 1, 'offline notice is still visible');
      h.eq(visibleTextCount(tree, 'Try again later'), 1, 'the refusal remains visible too');
      h.eq(button(tree, COPY.flowContinue).props.disabled, true, 'the retry window disables the actual Continue control');
      h.eq(continues, 0, 'rendering a retry window never sends automatically');
    } finally {
      if (tree) await unmountScreen(tree);
      clock.restore();
    }
  });

  for (const consented of [false, true]) {
    await h.test(`Launcher: consent=${consented} controls probing and propagates offline notices to Home and Compose`, async () => {
      resetNativeStorage();
      const kv = createMmkvBackend('whim.launcher');
      new AppIndex(kv).markSeeded(SEED_VERSION);
      acceptTerms(kv, '2026-09-19T12:00:00.000Z');
      if (consented) grantConsent(kv, '2026-09-19T12:00:00.000Z');
      const clock = captureTimeouts();
      const originalFetch = globalThis.fetch;
      const requested: string[] = [];
      globalThis.fetch = (async (url: string) => {
        requested.push(String(url));
        return new Response('', { status: 503 });
      }) as typeof fetch;
      let tree: TestRenderer.ReactTestRenderer | undefined;
      try {
        tree = await renderScreen(<LauncherRoot deviceLocale={() => 'en-US'} />);
        h.eq(requested.map(url => new URL(url).pathname), consented ? ['/healthz'] : [], 'only a current grant starts the failed health probe');
        h.eq(visibleTextCount(tree, COPY.homeOfflineIndicator), consented ? 1 : 0, 'failed probe is visible at Home; no consent stays unknown');
        await press(createButton(tree));
        h.eq(tree.root.findAllByType(ComposeStep).length, consented ? 1 : 0, 'creation opens compose only with consent');
        h.eq(tree.root.findAllByType(ConsentScreen).length, consented ? 0 : 1, 'absent consent opens the disclosure');
        h.eq(visibleTextCount(tree, COPY.promptServerUnreachable), consented ? 1 : 0, 'root passes the failed probe into the visible compose notice');
        if (consented) {
          const field = tree.root.findByType('TextInput');
          await TestRenderer.act(async () => field.props.onChangeText('A tea timer'));
          h.eq(button(tree, COPY.flowContinue).props.disabled, false, 'root-managed compose enables Continue after typing while offline');
        } else {
          await press(button(tree, COPY.consentDecline));
          h.eq(tree.root.findAllByType(HomeScreen).length, 1, 'declining returns to Home');
          h.eq(visibleTextCount(tree, COPY.homeOfflineIndicator), 0, 'declining does not invent offline state');
          h.eq(requested, [], 'entering and declining consent send no requests');
        }
      } finally {
        if (tree) await unmountScreen(tree);
        globalThis.fetch = originalFetch;
        clock.restore();
      }
    });
  }
}
