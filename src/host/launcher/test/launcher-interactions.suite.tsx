import React from 'react';
import TestRenderer from 'react-test-renderer';
import { Harness } from './harness';
import LauncherRoot from '../LauncherRoot';
import HomeScreen from '../HomeScreen';
import ComposeStep from '../ComposeStep';
import PlanStep from '../PlanStep';
import BuildStep from '../BuildStep';
import SettingsScreen from '../SettingsScreen';
import ConsentScreen from '../ConsentScreen';
import { createMmkvBackend } from '../../version-store/fs/mmkv-backend';
import { AppIndex } from '../app-index';
import { SEED_VERSION } from '../seed';
import { grantConsent } from '../ai-consent';
import { acceptTerms } from '../terms-acceptance';
import { saveServerUrl } from '../server-address';
import { resetNativeStorage } from './native-storage';
import { renderScreen, unmountScreen, captureTimeouts } from './react-screen';
import { testAppInfo } from './client-fixtures';

export async function runLauncherInteractionTests(h: Harness): Promise<void> {
  for (const change of ['server', 'consent', 'same'] as const) {
    for (const responseKind of ['refusal', 'result'] as const) {
    await h.test(`launcher: detached ${responseKind}, ${change} configuration`, async () => {
    resetNativeStorage();
    const kv = createMmkvBackend('whim.launcher');
    new AppIndex(kv).markSeeded(SEED_VERSION);
    acceptTerms(kv, '2026-09-18T12:00:00.000Z');
    grantConsent(kv, '2026-09-18T12:00:00.000Z');
    saveServerUrl(kv, 'https://s1.example');
    const clock = captureTimeouts();
    const originalFetch = globalThis.fetch;
    let finish!: (response: Response) => void;
    const generation = new Promise<Response>(resolve => { finish = resolve; });
    globalThis.fetch = (async (url: string) => {
      if (String(url).endsWith('/healthz')) return new Response('', { status: 503 });
      if (String(url).endsWith('/clarify')) return new Response(JSON.stringify({ questions: [] }));
      if (String(url).endsWith('/rewrite')) return new Response(JSON.stringify({ rewrittenPrompt: 'A timer', plan: [] }));
      return generation;
    }) as typeof fetch;
    let tree: TestRenderer.ReactTestRenderer | undefined;
    try {
      tree = await renderScreen(<LauncherRoot appInfo={testAppInfo} internalBuild deviceLocale={() => 'en-US'} />);
      await TestRenderer.act(async () => tree!.root.findByType(HomeScreen).props.onCreate());
      await TestRenderer.act(async () => tree!.root.findByType(ComposeStep).props.onChangeText('A timer'));
      await TestRenderer.act(async () => tree!.root.findByType(ComposeStep).props.onContinue());
      let attempt!: Promise<void>;
      await TestRenderer.act(async () => { attempt = tree!.root.findByType(PlanStep).props.onBuild(); });
      await TestRenderer.act(async () => tree!.root.findByType(BuildStep).props.onBack());
      await TestRenderer.act(async () => tree!.root.findByType(HomeScreen).props.onSettings());
      if (change === 'server') {
        await TestRenderer.act(async () => tree!.root.findByType(SettingsScreen).props.onServerUrlChange('https://s2.example'));
      } else if (change === 'consent') {
        await TestRenderer.act(async () => tree!.root.findByType(SettingsScreen).props.onOpenAIFeatures());
        await TestRenderer.act(async () => tree!.root.findByType(ConsentScreen).props.onTurnOff());
        h.eq(clock.count(2000), 0, 'revoking consent cancels retries');
        await TestRenderer.act(async () => tree!.root.findByType(SettingsScreen).props.onOpenAIFeatures());
        await TestRenderer.act(async () => tree!.root.findByType(ConsentScreen).props.onAgree());
      } else {
        await TestRenderer.act(async () => tree!.root.findByType(SettingsScreen).props.onServerUrlChange('https://s1.example/'));
        await TestRenderer.act(async () => tree!.root.findByType(SettingsScreen).props.onHighlightingChange(false));
      }
      await TestRenderer.act(async () => tree!.root.findByType(SettingsScreen).props.onBack());
      h.eq(tree.root.findByType(HomeScreen).props.offline, change !== 'same', 'new session starts offline; unchanged session stays online');
      h.eq(clock.count(2000), change === 'same' ? 0 : 1, 'only a new offline session has a retry');
      await TestRenderer.act(async () => {
        finish(responseKind === 'refusal'
          ? new Response(JSON.stringify({ error: 'server_busy', hint: 'Try again later' }), { status: 429 })
          : new Response('data: ' + JSON.stringify({ type: 'result', app: {
            name: 'Timer', source: 'export default {}', bundle: 'window.__WHIM_APP_MODULE__ = {};',
            manifest: { capabilities: [] }, schema: { collections: [] },
          } }) + '\n\n', { headers: { 'Content-Type': 'text/event-stream' } }));
        await attempt;
      });
      h.eq(tree.root.findByType(HomeScreen).props.offline, change !== 'same', 'late response cannot validate a different configuration');
      h.eq(clock.count(2000), change === 'same' ? 0 : 1, 'late response preserves the new session retry');
    } finally {
      if (tree) await unmountScreen(tree);
      globalThis.fetch = originalFetch;
      clock.restore();
    }
    });
    }
  }
  await h.test('launcher: current rewrite success cancels retries and beats an in-flight failed probe', async () => {
    resetNativeStorage();
    const kv = createMmkvBackend('whim.launcher');
    new AppIndex(kv).markSeeded(SEED_VERSION);
    acceptTerms(kv, '2026-09-18T12:00:00.000Z');
    grantConsent(kv, '2026-09-18T12:00:00.000Z');
    saveServerUrl(kv, 'https://current.example');
    const clock = captureTimeouts();
    const originalFetch = globalThis.fetch;
    let finishProbe!: (response: Response) => void;
    const probe = new Promise<Response>(resolve => { finishProbe = resolve; });
    let probes = 0;
    globalThis.fetch = (async (url: string) => {
      if (String(url).endsWith('/healthz')) return ++probes === 1 ? new Response('', { status: 503 }) : probe;
      if (String(url).endsWith('/clarify')) return new Response('{}', { status: 502 });
      if (String(url).endsWith('/rewrite')) return new Response(JSON.stringify({ rewrittenPrompt: 'A timer' }));
      throw new Error(`Unexpected request ${url}`);
    }) as typeof fetch;
    let tree: TestRenderer.ReactTestRenderer | undefined;
    try {
      tree = await renderScreen(<LauncherRoot appInfo={testAppInfo} internalBuild deviceLocale={() => 'en-US'} />);
      h.eq(tree.root.findByType(HomeScreen).props.offline, true, 'startup probe reports offline');
      await TestRenderer.act(async () => clock.fire(2000));
      h.eq(probes, 2, 'retry probe is now in flight');
      await TestRenderer.act(async () => tree!.root.findByType(HomeScreen).props.onCreate());
      await TestRenderer.act(async () => tree!.root.findByType(ComposeStep).props.onChangeText('A timer'));
      await TestRenderer.act(async () => tree!.root.findByType(ComposeStep).props.onContinue());
      await TestRenderer.act(async () => tree!.root.findByType(PlanStep).props.onBack());
      await TestRenderer.act(async () => tree!.root.findByType(ComposeStep).props.onBack());
      h.eq(tree.root.findByType(HomeScreen).props.offline, false, 'successful current rewrite proves connectivity');
      await TestRenderer.act(async () => { finishProbe(new Response('', { status: 503 })); await probe; });
      h.eq(tree.root.findByType(HomeScreen).props.offline, false, 'late failed probe cannot undo current request success');
      h.eq(clock.count(4000), 0, 'no retry or probe timeout survives');
    } finally {
      if (tree) await unmountScreen(tree);
      globalThis.fetch = originalFetch;
      clock.restore();
    }
  });

  await h.test('launcher: typing a server address in Settings probes the finished address once typing pauses, never a half-typed one', async () => {
    resetNativeStorage();
    const kv = createMmkvBackend('whim.launcher');
    new AppIndex(kv).markSeeded(SEED_VERSION);
    acceptTerms(kv, '2026-09-18T12:00:00.000Z');
    grantConsent(kv, '2026-09-18T12:00:00.000Z');
    saveServerUrl(kv, 'https://s1.example');
    const clock = captureTimeouts();
    const originalFetch = globalThis.fetch;
    const probed: string[] = [];
    globalThis.fetch = (async (url: string) => {
      if (!String(url).endsWith('/healthz')) throw new Error(`Unexpected request ${url}`);
      probed.push(String(url));
      return new Response(JSON.stringify({ service: 'whim-server' }));
    }) as typeof fetch;
    let tree: TestRenderer.ReactTestRenderer | undefined;
    try {
      tree = await renderScreen(<LauncherRoot appInfo={testAppInfo} internalBuild deviceLocale={() => 'en-US'} />);
      await TestRenderer.act(async () => tree!.root.findByType(HomeScreen).props.onSettings());
      h.eq(probed, ['https://s1.example/healthz'], 'the saved address was probed once, at startup');
      const addressField = () => tree!.root.findByType(SettingsScreen).find(node => String(node.type) === 'TextInput');
      for (const keystroke of ['https://s', 'https://s2', 'https://s2.', 'https://s2.example']) {
        await TestRenderer.act(async () => addressField().props.onChangeText(keystroke));
      }
      h.eq(probed.length, 1, 'typing probes nothing');
      await TestRenderer.act(async () => clock.fire(600));
      h.eq(probed.slice(1), ['https://s2.example/healthz', 'https://s2.example/healthz'], 'the pause probes the finished address: the session’s connectivity and Settings’ own check');
      await TestRenderer.act(async () => tree!.root.findByType(SettingsScreen).props.onBack());
      h.eq(tree.root.findByType(HomeScreen).props.offline, false, 'the new address is the one the session is online with');
    } finally {
      if (tree) await unmountScreen(tree);
      globalThis.fetch = originalFetch;
      clock.restore();
    }
  });
}
