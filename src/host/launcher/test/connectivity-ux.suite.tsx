/** Offline notices remain advisory; consent and refusal retry windows keep their own gates. */
import React from 'react';
import TestRenderer from 'react-test-renderer';
import { Harness } from './harness';
import HomeScreen from '../HomeScreen';
import { DescribePage } from '../DescribePage';
import { FirstRunSheet } from '../FirstRunSheet';
import LauncherRoot from '../LauncherRoot';
import UpdateRequiredScreen from '../UpdateRequiredScreen';
import { COPY } from '../copy';
import { AppIndex, type InstalledApp } from '../app-index';
import { SEED_VERSION } from '../seed';
import { grantConsent } from '../ai-consent';
import { acceptTerms } from '../terms-acceptance';
import { createMmkvBackend } from '../../version-store/fs/mmkv-backend';
import { resetNativeStorage } from './native-storage';
import { button, press, renderScreen, unmountScreen, textOf, captureTimeouts, hostType, isHost } from './react-screen';
import { renderHome, tile } from './home-rig';
import { setAppState } from './native-host';
import { json, settle, waitFor, withLauncher, type Launcher } from './rendered-launcher';

const noop = () => {};
const app: InstalledApp = {
  id: 'timer', name: 'Timer', createdAt: 1, lineageId: 'main',
  record: { appId: 'timer', name: 'Timer', manifest: { capabilities: [] } },
};

function visibleTextCount(tree: TestRenderer.ReactTestRenderer, text: string): number {
  return tree.root.findAll(node => hostType(node) === 'Text' && textOf(node) === text).length;
}
function createButton(tree: TestRenderer.ReactTestRenderer): TestRenderer.ReactTestInstance {
  return tree.root.find(node => hostType(node) === 'Pressable' && node.props.accessibilityLabel === COPY.homeComposerPlaceholder);
}
/** How many offline notices Home shows. */
function noticeCount(tree: TestRenderer.ReactTestRenderer): number {
  return tree.root.findAll(node => hostType(node) === 'View' && node.props.accessibilityLabel === COPY.homeOfflineNotice).length;
}

export async function runConnectivityUxTests(h: Harness): Promise<void> {

  for (const offline of [true, false]) {
    await h.test(`Home: offline=${offline} shows the matching notice and keeps app/create controls enabled`, async () => {
      const opened: string[] = [];
      let creates = 0;
      const tree = await renderHome({ apps: [app], offline, onOpen: target => opened.push(target.id), onCreate: () => { creates++; } });
      try {
        h.eq(noticeCount(tree), offline ? 1 : 0, 'the home notice follows connectivity');
        await press(tile(tree, app.name));
        await press(createButton(tree));
        h.eq(opened, [app.id], 'the visible installed tile opens its app');
        h.eq(creates, 1, 'the visible create control starts creation');
      } finally { await unmountScreen(tree); }
    });

    await h.test(`Describe: offline=${offline} shows the matching notice without blocking editing or Continue`, async () => {
      const edits: string[] = [];
      let continues = 0;
      const tree = await renderScreen(<DescribePage text="Timer" serverUnreachable={offline}
        onChangeText={(text: string) => edits.push(text)} onContinue={() => { continues++; }} />);
      try {
        h.eq(visibleTextCount(tree, COPY.promptServerUnreachable), offline ? 1 : 0, 'the describe notice follows connectivity');
        const field = tree.root.find(isHost('TextInput'));
        h.ok(field.props.editable !== false, 'the prompt remains editable');
        await TestRenderer.act(async () => field.props.onChangeText('A tea timer'));
        await press(button(tree, COPY.flowContinue));
        h.eq(edits, ['A tea timer'], 'typing reaches the edit callback');
        h.eq(continues, 1, 'Continue submits while offline as well as online');
      } finally { await unmountScreen(tree); }
    });
  }

  await h.test('Describe: an active refusal window disables Continue even when offline is only advisory', async () => {
    const clock = captureTimeouts();
    let continues = 0;
    let tree: TestRenderer.ReactTestRenderer | undefined;
    try {
      tree = await renderScreen(<DescribePage text="Timer" serverUnreachable
        notice={{ hint: 'Try again later', tone: 'neutral', retryAt: Date.now() + 60_000 }}
        onChangeText={noop} onContinue={() => { continues++; }} />);
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
    await h.test(`Launcher: consent=${consented} controls probing and propagates offline notices to Home and Describe`, async () => {
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
        h.eq(requested.map(url => new URL(url).pathname), consented ? ['/health'] : [], 'only a current grant starts the failed health probe');
        h.eq(noticeCount(tree), consented ? 1 : 0, 'failed probe is visible at Home; no consent stays unknown');
        await press(createButton(tree));
        h.eq(tree.root.findAllByType(DescribePage).length, consented ? 1 : 0, 'creation opens describe only with consent');
        h.eq(tree.root.findAllByType(FirstRunSheet).length, consented ? 0 : 1, 'absent consent opens the first-run sheet');
        h.eq(visibleTextCount(tree, COPY.promptServerUnreachable), consented ? 1 : 0, 'root passes the failed probe into the visible describe notice');
        if (consented) {
          const field = tree.root.find(isHost('TextInput'));
          await TestRenderer.act(async () => field.props.onChangeText('A tea timer'));
          h.eq(button(tree, COPY.flowContinue).props.disabled, false, 'root-managed describe enables Continue after typing while offline');
        } else {
          await press(button(tree, COPY.consentDecline));
          h.eq(tree.root.findAllByType(HomeScreen).length, 1, 'declining returns to Home');
          h.eq(noticeCount(tree), 0, 'declining does not invent offline state');
          h.eq(requested, [], 'entering and declining consent send no requests');
        }
      } finally {
        if (tree) await unmountScreen(tree);
        globalThis.fetch = originalFetch;
        clock.restore();
      }
    });
  }

  await runFollowsConnectivityTests(h);
}

/** The network the launcher's fake server sits behind. */
interface Network {
  /** False: every request fails at the network level, as with airplane mode on. */
  up: boolean;
  /** The status the server answers a `/v1` request with while the network is up. */
  answer: number;
}

/** A consented launcher on Home with a healthy server whose startup probe has answered, so the
 *  session is online. `net` steers the network from then on. */
async function onlineLauncher(
  run: (launcher: Launcher, net: Network) => Promise<void>,
): Promise<void> {
  const net: Network = { up: true, answer: 503 };
  const reach = <T,>(answer: () => T): T => {
    if (!net.up) throw new TypeError('Network request failed');
    return answer();
  };
  await withLauncher(
    {
      health: () => reach(() => json({ service: 'whim-server' })),
      server: () => reach(() => new Response('', { status: net.answer })),
    },
    async (launcher) => {
      await settle();
      try {
        await run(launcher, net);
      } finally {
        await TestRenderer.act(async () => setAppState('active'));
      }
    },
  );
}

const advance = (launcher: Launcher, delay: number) => TestRenderer.act(async () => launcher.clock.fire(delay));

async function typeAndContinue(launcher: Launcher): Promise<void> {
  const { tree } = launcher;
  await press(createButton(tree));
  const field = tree.root.find(isHost('TextInput'));
  await TestRenderer.act(async () => field.props.onChangeText('A tea timer'));
  await press(button(tree, COPY.flowContinue));
  await waitFor(() => launcher.paths().includes('/v1/clarify'), 'the plan request');
  await settle();
}

async function runFollowsConnectivityTests(h: Harness): Promise<void> {
  await h.test('Launcher: Home follows the connection going away and coming back while the app stays open', () =>
    onlineLauncher(async (launcher, net) => {
      const { tree, clock } = launcher;
      h.eq(noticeCount(tree), 0, 'a reachable server shows no notice');
      h.eq(clock.count(30000), 1, 'an online Home re-checks every 30s');

      net.up = false;
      await advance(launcher, 30000);
      h.eq(noticeCount(tree), 0, 'one failed check is not an outage');
      await advance(launcher, 2000);
      h.eq(noticeCount(tree), 1, 'the second failed check shows the notice, with no restart and no navigation');

      net.up = true;
      await advance(launcher, 2000);
      h.eq(noticeCount(tree), 0, 'the next successful probe clears it');
      h.eq(clock.count(30000), 1, 'and Home goes back to its 30s re-check');
    }));

  await h.test('Launcher: nothing is probed while the app is in the background; coming back probes at once', () =>
    onlineLauncher(async (launcher, net) => {
      await TestRenderer.act(async () => setAppState('background'));
      h.eq(launcher.clock.count(30000), 0, 'backgrounding cancels the 30s re-check');
      const before = launcher.probes.length;

      net.up = false;
      await TestRenderer.act(async () => setAppState('active'));
      await settle();
      h.eq(launcher.probes.length - before, 1, 'the return sends exactly one probe');
      h.eq(noticeCount(launcher.tree), 0, 'whose single failure is not yet an outage');
      h.eq(launcher.clock.count(2000), 1, 'it is confirmed by the next probe');
    }));

  await h.test('Launcher: a screen other than Home does not re-check an online session', () =>
    onlineLauncher(async ({ tree, clock }) => {
      await press(createButton(tree));
      h.eq(tree.root.findAllByType(DescribePage).length, 1, 'Describe is open');
      h.eq(clock.count(30000), 0, 'no 30s re-check while Home is not showing');
    }));

  await h.test('Launcher: a plan request that gets no answer turns the offline notice on at once', () =>
    onlineLauncher(async (launcher, net) => {
      const probesBefore = launcher.probes.length;
      net.up = false;
      await typeAndContinue(launcher);
      h.eq(launcher.probes.length - probesBefore, 1, 'the failed request was confirmed by one probe');
      h.eq(noticeCount(launcher.tree), 1, 'and the notice shows without waiting for the 30s interval');
    }));

  await h.test('Launcher: Home re-checks never bring back an update screen the person dismissed', () =>
    withLauncher(
      {
        health: () => json({ ok: true, service: 'whim-server', minBuild: { ios: Number.MAX_SAFE_INTEGER, android: Number.MAX_SAFE_INTEGER } }),
        server: () => new Response('', { status: 503 }),
      },
      async (launcher) => {
        const { tree } = launcher;
        await waitFor(() => tree.root.findAllByType(UpdateRequiredScreen).length === 1, 'the launch-time update screen');
        await press(button(tree, COPY.updateNotNow));
        const probesBefore = launcher.probes.length;
        await advance(launcher, 30000);
        await settle();
        h.eq(launcher.probes.length - probesBefore, 1, 'Home did re-check');
        h.eq(tree.root.findAllByType(UpdateRequiredScreen).length, 0, 'and the dismissed update screen stayed away');
      },
    ));

  await h.test('Launcher: a plan request the server answered with an error does not mean offline', () =>
    onlineLauncher(async (launcher, net) => {
      const probesBefore = launcher.probes.length;
      net.answer = 500;
      await typeAndContinue(launcher);
      h.eq(launcher.probes.length - probesBefore, 0, 'no probe was asked for');
      h.eq(noticeCount(launcher.tree), 0, 'a server that answered is online');
    }));
}
