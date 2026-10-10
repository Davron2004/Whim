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

  await runRequestEvidenceTests(h);
}

/** The network the launcher's fake server sits behind. */
interface Network {
  /** False: every request fails at the network level, as with airplane mode on. */
  up: boolean;
  /** True: the health route answers but every other request fails at the network level. */
  requestsDown: boolean;
  /** The status the server answers a `/v1` request with while the network is up. */
  answer: number;
}

/** Runs `body` with `Date.now` under the test's control, so the foreground floor (ten seconds
 *  between probes asked for by returns to the foreground) passes without waiting. Installed before
 *  the launcher renders, because the loop reads the clock it finds then. */
async function withSkewedClock(body: (pass: (ms: number) => void) => Promise<void>): Promise<void> {
  const realNow = Date.now;
  let skew = 0;
  Date.now = () => realNow() + skew;
  try {
    await body((ms) => { skew += ms; });
  } finally {
    Date.now = realNow;
  }
}

/** A consented launcher on Home with a healthy server whose startup probe has answered, so the
 *  session is online. `net` steers the network from then on; `pass` lets time go by. */
async function onlineLauncher(
  run: (launcher: Launcher, net: Network, pass: (ms: number) => void) => Promise<void>,
): Promise<void> {
  const net: Network = { up: true, requestsDown: false, answer: 503 };
  const reach = <T,>(answer: () => T): T => {
    if (!net.up) throw new TypeError('Network request failed');
    return answer();
  };
  await withSkewedClock((pass) => withLauncher(
    {
      health: () => reach(() => json({ service: 'whim-server' })),
      server: () => {
        if (net.requestsDown) throw new TypeError('Network request failed');
        return reach(() => new Response('', { status: net.answer }));
      },
    },
    async (launcher) => {
      await settle();
      try {
        await run(launcher, net, pass);
      } finally {
        await TestRenderer.act(async () => setAppState('active'));
      }
    },
  ));
}

async function advance(launcher: Launcher, delay: number): Promise<void> {
  await TestRenderer.act(async () => launcher.clock.fire(delay));
  await settle();
}

/** Every timer the connectivity loop could have pending: the confirmation and the backoff steps. */
const loopTimers = (launcher: Launcher) =>
  [2000, 4000, 8000, 16000, 30000].reduce((sum, delay) => sum + launcher.clock.count(delay), 0);

/** The app goes to the background and comes back `away` ms later. */
async function leaveAndReturn(pass: (ms: number) => void, away: number): Promise<void> {
  await TestRenderer.act(async () => setAppState('background'));
  pass(away);
  await TestRenderer.act(async () => setAppState('active'));
  await settle();
}

async function typeAndContinue(launcher: Launcher): Promise<void> {
  const { tree } = launcher;
  await press(createButton(tree));
  const field = tree.root.find(isHost('TextInput'));
  await TestRenderer.act(async () => field.props.onChangeText('A tea timer'));
  await press(button(tree, COPY.flowContinue));
  await waitFor(() => launcher.paths().includes('/v1/clarify'), 'the plan request');
  await settle();
}

async function runRequestEvidenceTests(h: Harness): Promise<void> {
  await h.test('Launcher: an online Home with nothing happening schedules no probe', () =>
    onlineLauncher(async (launcher) => {
      h.eq(launcher.probes.length, 1, 'only the startup probe was sent');
      h.eq(loopTimers(launcher), 0, 'and no timer waits to send another');
      h.eq(noticeCount(launcher.tree), 0, 'a reachable server shows no notice');
    }));

  await h.test('Launcher: a plan request that gets no answer, with the probe failing too, turns the offline notice on at once', () =>
    onlineLauncher(async (launcher, net) => {
      const probesBefore = launcher.probes.length;
      net.up = false;
      await typeAndContinue(launcher);
      h.eq(launcher.probes.length - probesBefore, 1, 'the failed request was confirmed by one probe');
      h.eq(noticeCount(launcher.tree), 1, 'and the notice shows without waiting for anything else');
    }));

  await h.test('Launcher: a plan request that gets no answer while the server answers the probe does not turn the notice on', () =>
    onlineLauncher(async (launcher, net) => {
      const probesBefore = launcher.probes.length;
      net.requestsDown = true;
      await typeAndContinue(launcher);
      h.eq(launcher.probes.length - probesBefore, 1, 'the failed request was checked by one probe');
      h.eq(noticeCount(launcher.tree), 0, 'a server that answers the probe is online');
      h.eq(loopTimers(launcher), 0, 'and nothing is left scheduled');
    }));

  await h.test('Launcher: a plan request the server answered with an error does not mean offline', () =>
    onlineLauncher(async (launcher, net) => {
      const probesBefore = launcher.probes.length;
      net.answer = 500;
      await typeAndContinue(launcher);
      h.eq(launcher.probes.length - probesBefore, 0, 'no probe was asked for');
      h.eq(noticeCount(launcher.tree), 0, 'a server that answered is online');
    }));

  await h.test('Launcher: returns to the foreground probe at most once per ten seconds', () =>
    onlineLauncher(async (launcher, _net, pass) => {
      const before = launcher.probes.length;
      await leaveAndReturn(pass, 4000);
      h.eq(launcher.probes.length - before, 0, 'a return soon after the startup probe sends none');

      await leaveAndReturn(pass, 7000);
      h.eq(launcher.probes.length - before, 1, 'a return after the floor sends one');

      await leaveAndReturn(pass, 3000);
      await leaveAndReturn(pass, 3000);
      h.eq(launcher.probes.length - before, 1, 'two more inside the floor send none');

      await leaveAndReturn(pass, 5000);
      h.eq(launcher.probes.length - before, 2, 'the next one after the floor sends another');
    }));

  await h.test('Launcher: one failed probe on return does not flash the notice; the second confirms it and a success clears it', () =>
    onlineLauncher(async (launcher, net, pass) => {
      net.up = false;
      await leaveAndReturn(pass, 20000);
      h.eq(noticeCount(launcher.tree), 0, 'one failed probe is not an outage');
      h.eq(launcher.clock.count(2000), 1, 'it is confirmed after the first backoff step');

      await advance(launcher, 2000);
      h.eq(noticeCount(launcher.tree), 1, 'the second failure shows the notice');

      await TestRenderer.act(async () => setAppState('background'));
      h.eq(loopTimers(launcher), 0, 'no backoff probe waits in the background');

      pass(20000);
      net.up = true;
      await TestRenderer.act(async () => setAppState('active'));
      await settle();
      h.eq(noticeCount(launcher.tree), 0, 'the return found the server and cleared the notice');
      h.eq(loopTimers(launcher), 0, 'and nothing is left scheduled');
    }));

  await h.test('Launcher: offline in the foreground, the backoff probe clears the notice on its first success', () =>
    onlineLauncher(async (launcher, net) => {
      net.up = false;
      await typeAndContinue(launcher);
      h.eq(noticeCount(launcher.tree), 1, 'precondition: the notice is on');
      h.eq(launcher.clock.count(2000), 1, 'the backoff probe is waiting');

      net.up = true;
      await advance(launcher, 2000);
      await settle();
      h.eq(launcher.probes.length, 3, 'the backoff probe was sent');
      h.eq(noticeCount(launcher.tree), 0, 'and its success cleared the notice');
      h.eq(loopTimers(launcher), 0, 'with nothing scheduled after it');
    }));

  await h.test('Launcher: a return to the foreground never brings back an update screen the person dismissed', () =>
    outdatedBuildLauncher(async (launcher, pass) => {
      const { tree } = launcher;
      await waitFor(() => tree.root.findAllByType(UpdateRequiredScreen).length === 1, 'the launch-time update screen');
      await press(button(tree, COPY.updateNotNow));
      const probesBefore = launcher.probes.length;
      await leaveAndReturn(pass, 20000);
      h.eq(launcher.probes.length - probesBefore, 1, 'the return did probe');
      h.eq(tree.root.findAllByType(UpdateRequiredScreen).length, 0, 'and the dismissed update screen stayed away');
    }));
}

/** A launcher whose server demands a build newer than any installed one. */
const outdatedBuildLauncher = (run: (launcher: Launcher, pass: (ms: number) => void) => Promise<void>) =>
  withSkewedClock((pass) => withLauncher(
    {
      health: () => json({ ok: true, service: 'whim-server', minBuild: { ios: Number.MAX_SAFE_INTEGER, android: Number.MAX_SAFE_INTEGER } }),
      server: () => new Response('', { status: 503 }),
    },
    (launcher) => run(launcher, pass),
  ));
