/** RN drops every unsigned message before reading it (webview-bridge-provenance, spec "RN drops every
 *  unsigned message before reading it", "Each hosting WebView instance has its own secret
 *  token"): the rendered dev probe screen, the product pool (its waiting slot's router and the
 *  launch's host) and the network-deny probe screen, driven the way their WebViews drive them. The
 *  token every signed frame here carries is the one the host handed the page (`pageToken`). */
import React from 'react';
import TestRenderer from 'react-test-renderer';
import type { DiagnosticsBatch } from '@whim/contract';
import { Harness } from './harness';
import DevProbeScreen from '../DevProbeScreen';
import { MiniAppStage, type MiniAppLaunch } from '../MiniAppView';
import NetworkDenyProbeScreen from '../../NetworkDenyProbeScreen';
import { COPY } from '../copy';
import { STARTUP_DEADLINE_MS } from '../boot-state';
import { WARM_ANSWER } from '../webview-pool';
import { EXPOSURE_CANARY } from '../runtime-message-auth';
import type { AppRecord } from '../../bridge';
import { SYSCALL_VERSION } from '../../bridge/contract';
import { APP_BUNDLES } from '../../../runtime/generated/app-bundles';
import { APP_RECORDS } from '../../../runtime/generated/app-records';
import { log } from '../../logging';
import type { PostDiagnostics } from '../../logging/diagnostics';
import { authInjections, hardwareBack, injectedScripts, nativeLoadStart, pageToken, secureRandom, signed } from './native-host';
import { resetNativeStorage } from './native-storage';
import { button, captureTimeouts, hostType, isHost, press, renderScreen, textOf, unmountScreen } from './react-screen';
import RENDER_ERROR_FRAME from './render-error-frame.json';

type Tree = TestRenderer.ReactTestRenderer;
type Node = TestRenderer.ReactTestInstance;

const TIP: AppRecord = APP_RECORDS['tip-splitter'];

/** Lets a dispatched syscall's reply come back. */
const settle = () => TestRenderer.act(async () => { await new Promise((resolve) => setImmediate(resolve)); });

/** Counts every startup deadline armed from now on (`setTimeout` of `STARTUP_DEADLINE_MS`). */
function countArmedDeadlines(): { armed: () => number; restore: () => void } {
  const set = globalThis.setTimeout;
  let armed = 0;
  globalThis.setTimeout = ((callback: () => void, ms: number) => {
    if (ms === STARTUP_DEADLINE_MS) armed += 1;
    return set(callback, ms);
  }) as typeof setTimeout;
  return { armed: () => armed, restore: () => { globalThis.setTimeout = set; } };
}

/** The eleven kinds the outer page sends RN (page-envelope §3), each as the page forwards it for a
 *  realm bound at `generation`, with what a signed one does to the dev probe screen. */
function elevenKinds(generation: number): Record<string, unknown> {
  return {
    'host-log': { __whimHostLog: true, line: 'PAINT {"generation":1}' },
    'warm-answer': JSON.parse(WARM_ANSWER),
    'ui-event': { kind: 'ui-event', trusted: false, payload: { __whimUiEvent: true, type: 'press', label: 'Split' } },
    'rejected-forgery': { kind: 'rejected-forgery', trusted: false, forgedKind: 'paint', payload: null },
    probes: { kind: 'probes', trusted: true, payload: { contained: false, passed: 0, total: 52, generation, bridge: { android: { present: true, removed: false }, ios: { present: false, removed: false } } } },
    'nav-depth': { kind: 'nav-depth', trusted: false, payload: { depth: 2, generation } },
    syscall: { kind: 'syscall', trusted: false, payload: { whim: 'syscall', v: SYSCALL_VERSION, id: 1, gen: generation, method: 'diag.echo', params: { payload: 1 } } },
    delivery: { kind: 'delivery', trusted: true, payload: { accepted: true, generation: 1 } },
    'bridge-exposure': { kind: 'bridge-exposure', payload: { outcome: 'refused', visible: { android: false, ios: false }, webview: 'webkit' } },
    paint: { kind: 'paint', trusted: true, payload: { generation, mountToFirstPaintMs: 42 } },
    error: RENDER_ERROR_FRAME,
  };
}

interface Probe {
  tree: Tree;
  web: () => Node;
  /** A raw string through the WebView's `onMessage`. */
  post: (raw: string) => Promise<void>;
  loadEnd: () => Promise<void>;
  /** The bar's text, without its drop counter. */
  state: () => string;
  dropped: () => number;
  exits: () => number;
}

/** The dev probe screen, rendered, its WebView's page started loading (the mock reports it). */
async function withDevProbe(body: (p: Probe) => Promise<void>): Promise<void> {
  resetNativeStorage();
  injectedScripts.length = 0;
  authInjections.length = 0;
  const clock = captureTimeouts();
  let exits = 0;
  const tree = await renderScreen(<DevProbeScreen onExit={() => { exits += 1; }} />);
  const web = () => tree.root.findAll(isHost('WebView'))[0];
  try {
    await body({
      tree,
      web,
      post: async (raw) => { await TestRenderer.act(async () => web().props.onMessage({ nativeEvent: { data: raw } })); },
      loadEnd: async () => { await TestRenderer.act(async () => web().props.onLoadEnd()); },
      state: () => textOf(tree.root).replace(/dropped: \d+/, ''),
      dropped: () => Number(/dropped: (\d+)/.exec(textOf(tree.root))?.[1]),
      exits: () => exits,
    });
  } finally {
    await unmountScreen(tree);
    clock.restore();
  }
}

/** The generation the latest delivery bound its realm at. */
const boundGeneration = () => Number(/,generation:(\d+)/.exec(injectedScripts.filter((s) => s.includes('__whimControl.reinject(')).at(-1) ?? '')?.[1]);
const relays = () => injectedScripts.filter((s) => s.includes('__whimRelaySysret(')).length;
const navBacks = () => injectedScripts.filter((s) => s.includes('__whimControl.navBack(')).length;
const pageLogs = () => log.buffer.snapshot().filter((r) => r.message === 'relayed page log').length;

function launchOf(record: AppRecord): MiniAppLaunch {
  return {
    record, bundleSource: APP_BUNDLES[record.appId], engineAppId: record.appId, tappedAt: Date.now(),
    onExit: () => {}, onOpenSheet: () => {}, sheetOpen: false, onCloseSheet: () => {},
    installedApp: { id: record.appId, name: record.name, createdAt: 1, lineageId: 'main', record },
    orb: { state: 'rest', activity: 0 }, onReload: () => {}, onAskFix: () => {}, behind: false,
  };
}

const measured = (node: React.ReactElement<{ collapsable?: boolean }>) =>
  node.props.collapsable === false
    ? { measure: (cb: (x: number, y: number, w: number, h: number, pageX: number, pageY: number) => void) => cb(0, 0, 390, 797, 0, 47) }
    : null;

interface Stage {
  tree: Tree;
  show: (launch: MiniAppLaunch | null) => Promise<void>;
  webViews: () => Node[];
  post: (web: Node, raw: string) => Promise<void>;
  /** The app's opening state is up. */
  opening: () => boolean;
}

/** The product container with no app open, one WebView waiting (its page started loading). */
async function withStage(body: (s: Stage) => Promise<void>): Promise<void> {
  resetNativeStorage();
  injectedScripts.length = 0;
  authInjections.length = 0;
  const clock = captureTimeouts();
  const tree = await renderScreen(<MiniAppStage launch={null} onFrame={() => {}} />, { createNodeMock: measured });
  try {
    await body({
      tree,
      show: async (launch) => { await TestRenderer.act(async () => { tree.update(<MiniAppStage launch={launch} onFrame={() => {}} />); }); },
      webViews: () => tree.root.findAll(isHost('WebView')),
      post: async (web, raw) => { await TestRenderer.act(async () => web.props.onMessage({ nativeEvent: { data: raw } })); },
      opening: () => tree.root.findAll((n) => hostType(n) !== undefined && n.props.accessibilityRole === 'progressbar' && n.props.accessibilityLabel === COPY.appBootA11yLabel).length > 0,
    });
  } finally {
    await unmountScreen(tree);
    clock.restore();
  }
}

const loadEnd = (web: Node) => TestRenderer.act(async () => web.props.onLoadEnd());
const errorRecords = (errorClass: string) => log.buffer.snapshot().filter((r) => r.level === 'error' && (r.fields as { errorClass?: unknown }).errorClass === errorClass);

export async function runRuntimeMessageAuthUiTests(h: Harness): Promise<void> {
  await h.test('verifier: each of the eleven kinds unsigned changes nothing on the dev probe screen and counts one drop; signed, each is read', async () => {
    await withDevProbe(async ({ tree, post, loadEnd: loaded, state, dropped, exits, web }) => {
      await loaded();
      await press(button(tree, 'tip-splitter'));
      const generation = boundGeneration();
      h.ok(Number.isFinite(generation), 'precondition: tip-splitter is delivered into the authorized page');
      const kinds = elevenKinds(generation);
      log.buffer.clear();
      const before = state();
      const deadlines = countArmedDeadlines();
      try {
        for (const frame of Object.values(kinds)) await post(JSON.stringify(frame));
        await settle();
        h.eq(dropped(), 11, 'the drop counter rises by one per message');
        h.eq(state(), before, 'no verdict, paint, error, tap, forgery count, syscall, bridge field or exposure record');
        h.eq([relays(), pageLogs(), deadlines.armed()], [0, 0, 0], 'no syscall dispatched, no log line relayed, no startup deadline restarted');
        await TestRenderer.act(async () => { hardwareBack(); });
        h.eq([navBacks(), exits()], [0, 1], 'no back-policy change: back at the app’s root still leaves');

        const token = pageToken(web());
        const read = async (kind: string) => post(signed(token, kinds[kind]));
        await read('host-log');
        h.eq(pageLogs(), 1, 'signed: the page’s log line is relayed');
        await read('ui-event');
        await read('rejected-forgery');
        await read('probes');
        await read('bridge-exposure');
        h.ok(/last tap: press "Split"/.test(state()) && /forged rejected: 1/.test(state()), 'signed: the tap and the forgery count');
        h.ok(/LEAK ✗ 0\/52/.test(state()) && /bridge: android present\/NOT removed, ios absent/.test(state()), 'signed: the verdict and its bridge field');
        h.ok(/exposure: refused/.test(state()), 'signed: the exposure record');
        await read('nav-depth');
        await TestRenderer.act(async () => { hardwareBack(); });
        h.eq(navBacks(), 1, 'signed: back is forwarded into the app at depth 2');
        await read('syscall');
        await settle();
        h.ok(relays() === 1 && /syscalls: 1/.test(state()), 'signed: the syscall is dispatched and answered');
        await read('delivery');
        h.eq(deadlines.armed(), 1, 'signed: an accepted delivery restarts the startup deadline');
        await read('paint');
        h.ok(/paint 42ms/.test(state()), 'signed: the paint');
        await read('error');
        h.ok(/err: /.test(state()), 'signed: the error');
        await read('warm-answer');
        h.eq(dropped(), 11, 'no signed message was dropped');
      } finally {
        deadlines.restore();
      }
    });
  });

  await h.test('verifier: a well-formed envelope with any other token is dropped like an unsigned one', async () => {
    await withDevProbe(async ({ tree, post, loadEnd: loaded, state, dropped, web }) => {
      await loaded();
      await press(button(tree, 'tip-splitter'));
      const generation = boundGeneration();
      const token = pageToken(web());
      const other = token.replace(/^./, (c) => (c === 'a' ? 'b' : 'a'));
      const verdict = { kind: 'probes', trusted: true, payload: { contained: true, passed: 52, total: 52, generation } };
      await post(signed(other, verdict));
      await post(signed('0'.repeat(32), verdict));
      h.ok(/running…/.test(state()) && dropped() === 2, 'no verdict; two drops');
      await post(signed(token, verdict));
      h.ok(/CONTAINED ✓ 52\/52/.test(state()), 'the page load’s own token is read');
    });
  });

  await h.test('token: load starts after the page loaded (iOS sub-frames, Android history updates) change nothing: launches go out and the page’s signed frames are read', async () => {
    await withDevProbe(async ({ tree, post, loadEnd: loaded, state, dropped, web }) => {
      await loaded();
      const token = pageToken(web());
      // The exposure probe's frame, then the launch's new mini-app frame: each an about:blank load.
      await TestRenderer.act(async () => { nativeLoadStart(web()); });
      await press(button(tree, 'tip-splitter'));
      await TestRenderer.act(async () => { nativeLoadStart(web()); });
      const generation = boundGeneration();
      h.ok(Number.isFinite(generation) && !/no bridge token/.test(state()), 'the launch is delivered into the page');
      await post(signed(token, { kind: 'paint', trusted: true, payload: { generation, mountToFirstPaintMs: 42 } }));
      await post(signed(token, { kind: 'probes', trusted: true, payload: { contained: true, passed: 52, total: 52, generation } }));
      await post(signed(token, { kind: 'bridge-exposure', payload: { outcome: 'refused', visible: { android: false, ios: false }, webview: 'webkit' } }));
      h.ok(/paint 42ms/.test(state()) && /CONTAINED ✓ 52\/52/.test(state()) && /exposure: refused/.test(state()), 'its paint, verdict and exposure report are read');
      h.eq([dropped(), authInjections.length], [0, 1], 'nothing dropped, and no other token handed over');
    });
    await withStage(async ({ tree, show, webViews, post, opening }) => {
      await show(launchOf(TIP));
      const [web] = webViews();
      await loadEnd(web);
      await TestRenderer.act(async () => { nativeLoadStart(web); });
      await post(web, signed(web, { kind: 'paint', trusted: true, payload: { generation: boundGeneration(), mountToFirstPaintMs: 42 } }));
      h.ok(!opening() && !textOf(tree.root).includes(COPY.appCrashedBody), 'the product launch’s paint opens the app');
    });
  });

  await h.test('token: a repeated load end hands the page the same token again, and nothing the page signs is dropped', async () => {
    for (const between of ['nothing', 'a load start'] as const) {
      await withDevProbe(async ({ tree, post, loadEnd: loaded, state, dropped, web }) => {
        await loaded();
        // The page takes the first token it is handed and keeps it (page-envelope §1).
        const held = pageToken(web());
        await press(button(tree, 'tip-splitter'));
        const generation = boundGeneration();
        await post(signed(held, { kind: 'paint', trusted: true, payload: { generation, mountToFirstPaintMs: 42 } }));
        if (between === 'a load start') await TestRenderer.act(async () => { nativeLoadStart(web()); });
        await loaded();
        h.eq(authInjections.map((js) => /'([0-9a-f]{32})'/.exec(js)?.[1]), [held, held], `${between} between: the same token, handed over again`);
        await post(signed(held, { kind: 'probes', trusted: true, payload: { contained: true, passed: 52, total: 52, generation } }));
        h.ok(/paint 42ms/.test(state()) && /CONTAINED ✓ 52\/52/.test(state()) && dropped() === 0, `${between} between: the page’s frames before and after are read, none dropped`);
      });
    }
  });

  await h.test('token: a new WebView instance gets a token of its own, and the previous instance’s token is refused', async () => {
    await withStage(async ({ tree, show, webViews, post, opening }) => {
      await show(launchOf(TIP));
      const [first] = webViews();
      await loadEnd(first);
      const old = pageToken(first);
      await TestRenderer.act(async () => first.props.onContentProcessDidTerminate({ nativeEvent: {} }));
      h.ok(textOf(tree.root).includes(COPY.appCrashedBody) && !webViews().includes(first), 'precondition: the dead WebView is gone, the crash screen up');
      h.ok(textOf(tree.root).includes(COPY.appCrashedAskFix), 'a WebView that died offers "Ask Whim to fix it" (only a missing bridge token is a host fault)');
      await press(button(tree, COPY.actionReload));
      await show(null);
      await show(launchOf(TIP));
      const fresh = webViews()[0];
      await loadEnd(fresh);
      h.ok(fresh !== first && pageToken(fresh) !== old, 'the fresh WebView is handed a token of its own');
      const paint = { kind: 'paint', trusted: true, payload: { generation: boundGeneration(), mountToFirstPaintMs: 42 } };
      await post(fresh, signed(old, paint));
      h.ok(opening(), 'a frame carrying the previous instance’s token opens nothing');
      await post(fresh, signed(fresh, paint));
      h.ok(!opening(), 'the fresh instance’s own token is read');
    });
  });

  await h.test('canary: recorded for the page load and dropped, then joined to its exposure record, which is logged', async () => {
    await withDevProbe(async ({ post, loadEnd: loaded, state, dropped, web }) => {
      await loaded();
      log.buffer.clear();
      await post(EXPOSURE_CANARY);
      h.ok(/exposure: pending \(canary reached native\)/.test(state()) && dropped() === 1, 'the canary is recorded, and dropped like any unsigned message');
      await post(signed(web(), { kind: 'bridge-exposure', payload: { outcome: 'navigated', visible: { android: true, ios: false }, webview: 'chrome-131' } }));
      h.ok(/exposure: navigated:android\+canary · visible android=true ios=false · canary=true · chrome-131/.test(state()), 'the report joins the canary in one record, shown on the screen');
      h.eq(log.buffer.snapshot().filter((r) => r.message === 'bridge-exposure').map((r) => r.fields),
        [{ exposure: 'navigated:android+canary', webview: 'chrome-131', canaryReachedNative: true, surface: 'dev-probe' }], 'and logged once on the host’s log');
    });
  });

  await h.test('exposure upload: the WebView’s result is queued for the diagnostics upload as its info-level record; one whose engine the page cannot name is not', async () => {
    const bodies: string[] = [];
    const post: PostDiagnostics = async (_url, _headers, body) => {
      bodies.push(body);
      return { ok: true, status: 204 };
    };
    const tokens: string[] = [];
    log.diagnostics.configure({ target: () => ({ baseUrl: 'http://127.0.0.1:8787', headers: {} }), post });
    try {
      await withDevProbe(async ({ post: postToPage, loadEnd: loaded, web }) => {
        await loaded();
        tokens.push(pageToken(web()));
        await postToPage(signed(web(), { kind: 'bridge-exposure', payload: { outcome: 'navigated', visible: { android: true, ios: false }, webview: 'chrome-131' } }));
        await loaded();
        tokens.push(pageToken(web()));
        await postToPage(signed(web(), { kind: 'bridge-exposure', payload: { outcome: 'refused', visible: { android: false, ios: false }, webview: 'unknown' } }));
      });
      await log.diagnostics.flush();
    } finally {
      log.diagnostics.stop();
      log.diagnostics.configure({ target: () => null });
    }
    const exposures = bodies.flatMap((body) => (JSON.parse(body) as DiagnosticsBatch).records).filter((r) => r.message === 'bridge-exposure');
    h.eq(exposures.map((r) => Object.keys(r).sort((a, b) => a.localeCompare(b))), [['at', 'channel', 'count', 'exposure', 'level', 'message', 'webview']], 'one record is uploaded, carrying the base fields, its count, the code and the engine only');
    h.eq(exposures.map((r) => [r.level, r.channel, r.exposure, r.webview, r.count]), [['info', 'whim', 'navigated:android', 'chrome-131', 1]], 'the result whose engine the page named, at info, on the host’s channel');
    h.ok(tokens.length === 2 && bodies.every((body) => tokens.every((token) => !body.includes(token)) && !body.includes('dev-probe')), 'no page token and no surface reach any body');
  });

  await h.test('consumers: the waiting slot’s router reads only a signed warm answer', async () => {
    await withStage(async ({ show, webViews, post }) => {
      const [waiting] = webViews();
      await loadEnd(waiting);
      await post(waiting, WARM_ANSWER);
      await show(launchOf(TIP));
      h.ok(webViews()[0] !== waiting && !webViews().includes(waiting), 'an unsigned warm answer warms nothing: the launch gets a cold WebView');
    });
    await withStage(async ({ show, webViews, post }) => {
      const [waiting] = webViews();
      await loadEnd(waiting);
      await post(waiting, signed(waiting, WARM_ANSWER));
      await show(launchOf(TIP));
      h.ok(webViews()[0] === waiting, 'a signed one does: the launch takes the waiting WebView');
    });
  });

  await h.test('consumers: the launch’s host drops every unsigned kind with zero host-state change, and its WebView counts them', async () => {
    await withStage(async ({ tree, show, webViews, post, opening }) => {
      await show(launchOf(TIP));
      const [web] = webViews();
      await loadEnd(web);
      const generation = boundGeneration();
      log.buffer.clear();
      const deadlines = countArmedDeadlines();
      try {
        for (const frame of Object.values(elevenKinds(generation))) await post(web, JSON.stringify(frame));
        await settle();
        h.ok(opening() && !textOf(tree.root).includes(COPY.appCrashedBody), 'no opening released, no crash screen');
        h.eq([relays(), pageLogs(), deadlines.armed(), navBacks()], [0, 0, 0, 0], 'no syscall, no relayed log line, no deadline restarted, no back forwarded');
        await post(web, signed(web, { kind: 'paint', trusted: true, payload: { generation, mountToFirstPaintMs: 42 } }));
        h.ok(!opening(), 'the signed paint opens the app');
      } finally {
        deadlines.restore();
      }
    });
    h.eq(log.buffer.snapshot().filter((r) => r.message === 'runtime webview dropped unsigned messages').map((r) => (r.fields as { count?: unknown }).count), [11],
      'the launch’s WebView counted all eleven, and says so when it goes');
  });

  await h.test('consumers: the network-deny probe screen lists only signed frames', async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => ({ ok: true, status: 200, text: async () => APP_BUNDLES['tip-splitter'] })) as unknown as typeof fetch;
    resetNativeStorage();
    injectedScripts.length = 0;
    authInjections.length = 0;
    const clock = captureTimeouts();
    const tree = await renderScreen(<NetworkDenyProbeScreen />);
    try {
      for (let i = 0; i < 20 && tree.root.findAll(isHost('WebView')).length === 0; i++) await settle();
      const web = tree.root.findAll(isHost('WebView'))[0];
      h.ok(web !== undefined, 'precondition: the first variant’s WebView is up');
      await loadEnd(web);
      h.ok(injectedScripts.some((s) => s.includes('__whimControl.reinject(')) && authInjections.length === 1, 'its page is handed its token, then the variant’s bundle');
      const handed = pageToken(web);
      await loadEnd(web);
      h.ok(authInjections.length === 2 && pageToken(web) === handed, 'a repeated load end hands the page the same token again');
      h.eq(injectedScripts.filter((s) => s.includes('__whimControl.reinject(')).length, 1, 'and the variant’s bundle is delivered once');
      const verdict = { kind: 'probes', trusted: true, payload: { contained: true } };
      const previous = pageToken(web);
      log.buffer.clear();
      await TestRenderer.act(async () => web.props.onMessage({ nativeEvent: { data: JSON.stringify(verdict) } }));
      await TestRenderer.act(async () => web.props.onMessage({ nativeEvent: { data: signed(web, { ...verdict, payload: { contained: false } }) } }));
      // The variant's dwell ends: its row is shown and logged with every message it listed.
      await TestRenderer.act(async () => clock.fire(5000));
      await settle();
      h.eq(log.buffer.snapshot().filter((r) => r.message === 'netdeny variant finished').map((r) => (r.fields as { messages?: unknown }).messages),
        [['probes trusted=true contained=false']], 'the unsigned frame is not listed; the signed one is');
      h.ok(textOf(tree.root).includes('messages: probes trusted=true contained=false'), 'and the screen shows it');

      // The next variant mounts a WebView of its own: its own token, and the last one's is refused.
      for (let i = 0; i < 20 && tree.root.findAll(isHost('WebView'))[0] === web; i++) await settle();
      const next = tree.root.findAll(isHost('WebView'))[0];
      h.ok(next !== undefined && next !== web, 'precondition: the next variant’s WebView is up');
      await loadEnd(next);
      h.ok(authInjections.length === 3 && pageToken(next) !== previous, 'the next variant’s page is handed a token of its own');
      log.buffer.clear();
      await TestRenderer.act(async () => next.props.onMessage({ nativeEvent: { data: signed(previous, { ...verdict, payload: { contained: false } }) } }));
      await TestRenderer.act(async () => next.props.onMessage({ nativeEvent: { data: signed(next, verdict) } }));
      await TestRenderer.act(async () => clock.fire(5000));
      await settle();
      h.eq(log.buffer.snapshot().filter((r) => r.message === 'netdeny variant finished').map((r) => (r.fields as { messages?: unknown }).messages),
        [['probes trusted=true contained=true']], 'the frame carrying the previous WebView’s token is not listed; the one with its own is');
    } finally {
      await unmountScreen(tree);
      clock.restore();
      globalThis.fetch = realFetch;
    }
  });

  await h.test('no secure source, no channel: no token is handed over, nothing is delivered, every message is dropped, and the failure is logged', async () => {
    for (const mode of ['fails', 'throws'] as const) {
      secureRandom.mode = mode;
      try {
        log.buffer.clear();
        await withDevProbe(async ({ tree, post, loadEnd: loaded, state, dropped }) => {
          await loaded();
          h.eq(authInjections, [], `${mode}: no auth is injected`);
          h.eq(errorRecords('NoSecureRandom').length, 1, `${mode}: the failure is on the error channel`);
          await press(button(tree, 'tip-splitter'));
          h.ok(!injectedScripts.some((s) => s.includes('__whimControl.reinject(')) && /err: no bridge token/.test(state()), `${mode}: nothing is delivered to the page`);
          const verdict = { kind: 'probes', trusted: true, payload: { contained: true, passed: 52, total: 52 } };
          await post(JSON.stringify(verdict));
          await post(signed('0'.repeat(32), verdict));
          h.ok(/running…/.test(state()) && dropped() === 2, `${mode}: every message is dropped and counted`);
        });
        await withStage(async ({ tree, show, webViews }) => {
          await show(launchOf(TIP));
          await loadEnd(webViews()[0]);
          h.ok(textOf(tree.root).includes(COPY.appCrashedBody), `${mode}: a launch fails at once instead of opening forever`);
          h.ok(textOf(tree.root).includes(COPY.actionReload) && !textOf(tree.root).includes(COPY.appCrashedAskFix),
            `${mode}: a host fault offers Reload and no "${COPY.appCrashedAskFix}": there is no error of the app’s to attach`);
          h.eq([authInjections.length, injectedScripts.length], [0, 0], `${mode}: and nothing reached its page`);
        });
      } finally {
        secureRandom.mode = 'ok';
      }
    }
  });
}
