// ─────────────────────────────────────────────────────────────────────────────
// Bridge-provenance desktop verification (webview-bridge-provenance, design D4/D7).
// ─────────────────────────────────────────────────────────────────────────────
// Loads the runtime page the product ships (RUNTIME_HTML) in headless Chromium with a stand-in
// native message bridge injected into every sub-frame before any of its scripts run, the way a
// platform that puts `ReactNativeWebView` / `webkit.messageHandlers` into every frame would. Then it
// delivers a mini-app and reads the containment verdict the outer page relays to RN:
//   - neutralize.js removes the bridge and the three `reach` probes pass;
//   - a bridge that cannot be removed (non-configurable, non-writable, own or inherited) makes the
//     matching probe fail and the verdict `contained: false`;
//   - the verdict's `bridge` side field reports present/removed from neutralize's own record, and
//     app code that rewrites `__WHIM_NEUTRALIZE_REPORT__` cannot change it;
//   - app code that deletes the loader stub and reads again gets nothing native back.
// The page cases (webview-message-provenance) drive the outer page as RN does after load:
//   - `auth` takes one well-formed token, once; from then on every post to RN is `W1.<token>.<JSON>`,
//     load-time log lines are flushed signed and in order, and the overflow is counted;
//   - without `auth` the page creates no probe frame and posts what a signed session posts, unsigned;
//   - the exposure probe reports `navigated` / `refused` / `timedOut`, posts the canary to the
//     stand-in bridges, is removed afterwards, and reads reports only from its own frame;
//   - the token reaches no frame, and the bridge-reach fixture's navigated document finds none.
// It never touches `invariants/` (feature agents do not author invariants).
//
//   npm run build && npm run runtime:provenance-verify
//
// Harness entry points (later cases reuse them): `openRuntimePage(browser, frameBridge)` opens the
// shipped page with per-frame stubs, `deliverApp(page, source)` launches an app by source and waits
// for its verdict, `rnPosts(page)` is every raw post to RN, `relayedFrames(page)` / `verdictOf(page)`
// read them with any envelope stripped, `realmFrame(page)` resolves to the mini-app frame.
import { chromium } from 'playwright';
import { build as esbuild } from 'esbuild';
import assert from 'node:assert';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..');

const { bundles } = JSON.parse(await readFile(join(ROOT, 'src/runtime/generated/runtime-artifacts.json'), 'utf8'));
const TIP_SPLITTER = bundles['tip-splitter'];

/** The page the product ships, compiled from its generated module. */
const { RUNTIME_HTML } = await (async () => {
  const out = await esbuild({
    stdin: {
      contents: `export { RUNTIME_HTML } from './src/runtime/generated/runtime-html';`,
      loader: 'ts', resolveDir: ROOT, sourcefile: 'runtime-page.ts',
    },
    bundle: true, format: 'esm', platform: 'browser', write: false, logLevel: 'warning',
  });
  return import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString('base64')}`);
})();

/** A mini-app written here, compiled with build/build.mjs's app-bundle options (`bundleApp`). */
async function bundleSource(contents) {
  const out = await esbuild({
    stdin: { contents, loader: 'tsx', resolveDir: ROOT, sourcefile: 'provenance-check.app.tsx' },
    bundle: true, format: 'iife', globalName: '__WHIM_APP_MODULE__',
    platform: 'browser', target: 'es2019',
    tsconfigRaw: '{}',
    jsx: 'transform', jsxFactory: 'React.createElement', jsxFragment: 'React.Fragment',
    inject: [join(ROOT, 'build/react-inject-shim.ts')],
    external: ['vc-sdk', 'react', 'react-dom', 'react-dom/client'],
    minify: false, write: false, logLevel: 'warning',
  });
  return out.outputFiles[0].text;
}

const PAGES = await mkdtemp(join(tmpdir(), 'whim-bridge-provenance-'));
const RUNTIME_PAGE = join(PAGES, 'runtime.html');
await writeFile(RUNTIME_PAGE, RUNTIME_HTML);

/** Poll `ready` until it holds or `timeoutMs` passes; returns whether it held. */
async function until(ready, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await ready()) return true;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return false;
}

/**
 * Runs in every frame before its first script. The top frame (the outer page, the bridge's
 * intended consumer) gets a recording `ReactNativeWebView`. Every other frame gets the stand-in
 * native bridge `frameBridge` describes:
 *   android: 'own' | 'own-locked' | 'inherited' | 'inherited-locked' (window.ReactNativeWebView,
 *            on window or on Window.prototype; "locked" = non-configurable and non-writable)
 *   ios:     'handler' | 'handler-locked' | 'locked' | 'shim' | 'shim-locked' (window.webkit.messageHandlers
 *            holding react-native-webview's two handlers, ReactNativeWebView and ReactNativeHistoryShim,
 *            or only the shim; like WebKit's, the entries do not enumerate; "handler-locked" pins the
 *            handlers only, "locked" and "shim-locked" pin `webkit` too)
 * Posts through a stand-in land on the frame's own `__nativePosts`, and are logged to the console
 * as `whim-native-post <string>` (NATIVE_POST), so posts from a frame that is gone stay visible.
 */
function installFrameStubs(frameBridge) {
  if (window.top === window) {
    const posts = [];
    Object.defineProperty(window, '__rnPosts', { value: posts });
    window.ReactNativeWebView = { postMessage: (s) => posts.push(String(s)) };
    return;
  }
  if (!frameBridge) return;
  const nativePosts = [];
  Object.defineProperty(window, '__nativePosts', { value: nativePosts });
  const record = (s) => {
    nativePosts.push(String(s));
    console.debug('whim-native-post ' + String(s));
  };
  const native = () => ({ nativeBridge: true, postMessage: record });
  const locked = (value) => ({ value, writable: false, configurable: false, enumerable: true });
  const loose = (value) => ({ value, writable: true, configurable: true, enumerable: true });
  const android = {
    own: [window, loose],
    'own-locked': [window, locked],
    inherited: [Object.getPrototypeOf(window), loose],
    'inherited-locked': [Object.getPrototypeOf(window), locked],
  }[frameBridge.android];
  if (android) Object.defineProperty(android[0], 'ReactNativeWebView', android[1](native()));
  if (frameBridge.ios) {
    const handlers = {};
    const pinned = frameBridge.ios !== 'handler' && frameBridge.ios !== 'shim';
    const names = frameBridge.ios.startsWith('shim') ? ['ReactNativeHistoryShim'] : ['ReactNativeWebView', 'ReactNativeHistoryShim'];
    for (const name of names) Object.defineProperty(handlers, name, { ...(pinned ? locked : loose)(native()), enumerable: false });
    const webkitPinned = frameBridge.ios === 'locked' || frameBridge.ios === 'shim-locked';
    Object.defineProperty(window, 'webkit', (webkitPinned ? locked : loose)({ messageHandlers: handlers }));
  }
}

const NATIVE_POST = 'whim-native-post ';
/** Where the `refuse` probe mode points the exposure probe's navigation; answered with a 204, so
 *  the navigation never commits and the probe frame's realm survives, as under a platform refusal. */
const REFUSE_URL = 'https://whim-exposure-refused.invalid/';
/** Where the `slow` probe mode points the exposure probe's navigation; answered late with the
 *  navigated document itself, so the navigation commits well after the probe's `still-here`. */
const SLOW_URL = 'https://whim-exposure-slow.invalid/';

/**
 * Runs in every frame before its first script; test instrumentation, not a bridge.
 * Top frame: records every `srcdoc` the outer page sets (`__srcdocSets`: element id, sandbox,
 * the srcdoc as written) and, for a frame other than the mini-app iframe (the exposure probe), can
 * rewrite it: `probe: 'refuse'` points its navigation at REFUSE_URL, `probe: 'slow'` at SLOW_URL,
 * `probe: 'inert'` replaces it with a document that never reports. Sub-frames: records every message the frame receives
 * (`__framesReceived`).
 */
function installPageProbes({ probe, refuseUrl, slowUrl }) {
  if (window.top === window) {
    const sets = [];
    Object.defineProperty(window, '__srcdocSets', { value: sets });
    const proto = window.HTMLIFrameElement.prototype;
    const native = Object.getOwnPropertyDescriptor(proto, 'srcdoc');
    Object.defineProperty(proto, 'srcdoc', {
      configurable: true,
      enumerable: native.enumerable,
      get() { return native.get.call(this); },
      set(value) {
        const written = String(value);
        let v = written;
        const isProbe = this.id !== 'whim-iframe';
        if (isProbe && probe === 'refuse') v = written.replace(/"data:text\/html[^"]*"/, JSON.stringify(refuseUrl));
        if (isProbe && probe === 'slow') v = written.replace(/"data:text\/html[^"]*"/, JSON.stringify(slowUrl));
        if (isProbe && probe === 'inert') v = '<!DOCTYPE html><title>inert</title>';
        sets.push({ id: this.id, sandbox: this.getAttribute('sandbox'), written, rewritten: v !== written });
        native.set.call(this, v);
      },
    });
    return;
  }
  const received = [];
  Object.defineProperty(window, '__framesReceived', { value: received });
  window.addEventListener('message', (e) => received.push(String(e.data)), true);
}

/**
 * Open the shipped runtime page with `frameBridge` stand-ins in every sub-frame. `probe` is the
 * exposure-probe mode (installPageProbes): 'live' (default), 'refuse', 'slow' or 'inert'. `nativePosts`
 * collects every post any sub-frame made to a stand-in native bridge.
 */
async function openRuntimePage(browser, frameBridge, { probe = 'live' } = {}) {
  const page = await browser.newPage();
  const pageErrors = [];
  const nativePosts = [];
  page.on('pageerror', (e) => pageErrors.push(String(e?.message || e)));
  page.on('console', (msg) => {
    const text = msg.text();
    if (text.startsWith(NATIVE_POST)) nativePosts.push(text.slice(NATIVE_POST.length));
  });
  await page.addInitScript(installFrameStubs, frameBridge ?? null);
  await page.addInitScript(installPageProbes, { probe, refuseUrl: REFUSE_URL, slowUrl: SLOW_URL });
  await page.goto(pathToFileURL(RUNTIME_PAGE).href, { waitUntil: 'load', timeout: 20000 });
  return { page, pageErrors, nativePosts };
}

/** Every raw string the outer page posted to RN, in order. */
async function rnPosts(page) {
  return page.evaluate(() => window.__rnPosts.slice());
}

const ENVELOPE = /^W1\.([0-9a-f]{32})\.([\s\S]*)$/;

/** A post's token (null when unsigned) and its JSON body. */
function unwrap(post) {
  const m = ENVELOPE.exec(post);
  return m ? { token: m[1], body: m[2] } : { token: null, body: post };
}

/** Every message the outer page posted to RN, envelope stripped and parsed (unparsable ones dropped). */
async function relayedFrames(page) {
  const frames = [];
  for (const s of await rnPosts(page)) {
    try {
      frames.push(JSON.parse(unwrap(s).body));
      // eslint-disable-next-line no-restricted-syntax -- intentional: a post that is not JSON is dropped by RN's parser too, so it is not a frame to read
    } catch {}
  }
  return frames;
}

/** The last containment verdict the outer page relayed to RN, or null. */
async function verdictOf(page) {
  const verdicts = (await relayedFrames(page)).filter((f) => f.kind === 'probes');
  return verdicts.length ? verdicts[verdicts.length - 1].payload : null;
}

/** The mini-app frame: the child frame whose element is the outer page's `#whim-iframe`. */
async function realmFrame(page) {
  for (const f of page.frames()) {
    if (f === page.mainFrame()) continue;
    const el = await f.frameElement();
    if ((await el.getAttribute('id')) === 'whim-iframe') return f;
  }
  return null;
}

/** Launch `source` by source into a fresh realm, as the host does, and wait for its verdict. */
async function deliverApp(page, source) {
  await page.evaluate((src) => globalThis.__whimControl.reinject({
    reset: true, bundle: 'provenance-check', bundleSource: src, generation: 2,
  }), source);
  await until(async () => (await verdictOf(page)) !== null);
  return verdictOf(page);
}

const PROBE_STUB = 'frame bridge is the loader stub';
const PROBE_CHAIN = 'no native bridge on the window prototype chain';
const PROBE_WEBKIT = 'webkit.messageHandlers unreachable';
const BRIDGE_PROBES = [PROBE_STUB, PROBE_CHAIN, PROBE_WEBKIT];

/** ok/fail of each bridge probe in `verdict`, by name (missing = undefined). */
function bridgeProbeResults(verdict) {
  const out = {};
  for (const name of BRIDGE_PROBES) {
    const p = (verdict?.probes ?? []).find((x) => x.category === 'reach' && x.name === name);
    out[name] = p ? p.ok : undefined;
  }
  return out;
}

const ABSENT = { present: false, removed: false };
const REMOVED = { present: true, removed: true };
const STUCK = { present: true, removed: false };
const allPass = Object.fromEntries(BRIDGE_PROBES.map((n) => [n, true]));
const failing = (...names) => Object.fromEntries(BRIDGE_PROBES.map((n) => [n, !names.includes(n)]));

/** What app code in the realm reaches through `ReactNativeWebView` (it posts one UI event through
 *  it), and after deleting it and reading again. */
function uncoverAttempt() {
  const before = window.ReactNativeWebView;
  before?.postMessage(JSON.stringify({ __whimUiEvent: true, type: 'press', label: 'provenance-uncover' }));
  Reflect.deleteProperty(window, 'ReactNativeWebView');
  const reread = window.ReactNativeWebView;
  const onChain = [];
  for (let o = Object.getPrototypeOf(window); o; o = Object.getPrototypeOf(o)) {
    const d = Object.getOwnPropertyDescriptor(o, 'ReactNativeWebView');
    if (d) onChain.push(d.value ?? null);
  }
  const handler = window.webkit?.messageHandlers?.ReactNativeWebView;
  const shim = window.webkit?.messageHandlers?.ReactNativeHistoryShim;
  return {
    beforeNative: before?.nativeBridge === true,
    rereadNative: reread?.nativeBridge === true,
    chainNative: onChain.some((v) => v?.nativeBridge === true),
    webkitNative: handler?.nativeBridge === true,
    shimNative: shim?.nativeBridge === true,
    nativePosts: window.__nativePosts ? window.__nativePosts.length : 0,
  };
}

const FORGER = await bundleSource(`import { defineApp, Screen, Text } from 'vc-sdk';
const w = window as unknown as Record<string, unknown>;
const nothing = { present: false, removed: false };
w.__WHIM_NEUTRALIZE_REPORT__ = { forgedByApp: true, bridge: { android: nothing, ios: nothing } };
w.__WHIM_BRIDGE_RECORD__ = Object.freeze({ android: nothing, ios: nothing });
function Home() { return <Screen><Text>Forger</Text></Screen>; }
export default defineApp({ name: 'Forger', initial: 'Home', screens: { Home }, capabilities: [] });
`);

const CASES = [
  {
    name: 'no bridge in the frame',
    frameBridge: null,
    want: { contained: true, probes: allPass, bridge: { android: ABSENT, ios: ABSENT } },
  },
  {
    name: 'removable bridges (own ReactNativeWebView + webkit handler) are removed',
    frameBridge: { android: 'own', ios: 'handler' },
    want: { contained: true, probes: allPass, bridge: { android: REMOVED, ios: REMOVED } },
    uncover: true,
  },
  {
    name: 'removable inherited ReactNativeWebView is removed from the prototype',
    frameBridge: { android: 'inherited' },
    want: { contained: true, probes: allPass, bridge: { android: REMOVED, ios: ABSENT } },
  },
  {
    name: 'pinned iOS handlers are cut off by shadowing webkit',
    frameBridge: { ios: 'handler-locked' },
    want: { contained: true, probes: allPass, bridge: { android: ABSENT, ios: REMOVED } },
  },
  {
    name: 'an iOS history shim handler alone (no ReactNativeWebView) is removed too',
    frameBridge: { ios: 'shim' },
    want: { contained: true, probes: allPass, bridge: { android: ABSENT, ios: REMOVED } },
    uncover: true,
  },
  {
    name: 'sabotage: non-configurable, non-writable own ReactNativeWebView',
    frameBridge: { android: 'own-locked' },
    want: { contained: false, probes: failing(PROBE_STUB), bridge: { android: STUCK, ios: ABSENT } },
  },
  {
    name: 'sabotage: non-configurable, non-writable inherited ReactNativeWebView',
    frameBridge: { android: 'inherited-locked' },
    want: { contained: false, probes: failing(PROBE_STUB, PROBE_CHAIN), bridge: { android: STUCK, ios: ABSENT } },
  },
  {
    name: 'sabotage: pinned webkit and handlers',
    frameBridge: { ios: 'locked' },
    want: { contained: false, probes: failing(PROBE_WEBKIT), bridge: { android: ABSENT, ios: STUCK } },
  },
  {
    name: 'sabotage: pinned webkit and history shim handler',
    frameBridge: { ios: 'shim-locked' },
    want: { contained: false, probes: failing(PROBE_WEBKIT), bridge: { android: ABSENT, ios: STUCK } },
  },
  {
    name: 'app code rewrites __WHIM_NEUTRALIZE_REPORT__ and the record global',
    frameBridge: { android: 'own', ios: 'handler' },
    source: FORGER,
    want: { contained: true, probes: allPass, bridge: { android: REMOVED, ios: REMOVED } },
    forged: true,
  },
];

// ── The outer page: token, signed envelope, exposure probe (webview-message-provenance) ──────────

const TOKEN = '0123456789abcdef0123456789abcdef';
const OTHER_TOKEN = 'fedcba9876543210fedcba9876543210';
const CANARY = 'WHIM-EXPOSURE-CANARY-1';
const BRIDGE_REACH = bundles['bridge-reach'];

/** The kind RN would file a parsed frame under. */
function kindOf(frame) {
  if (frame?.__whimHostLog === true) return 'host-log';
  if (frame?.__whimWarm === true) return 'warm-answer';
  return frame?.kind;
}

/** Hand the page a token the way RN injects it; returns what `auth` returned. */
function authorize(page, token) {
  return page.evaluate((t) => globalThis.__whimControl.auth(t), token);
}

/** Every `bridge-exposure` report the page sent, parsed. */
async function exposureReports(page) {
  return (await relayedFrames(page)).filter((f) => f.kind === 'bridge-exposure').map((f) => f.payload);
}

/** The iframe elements in the outer page: [{ id, sandbox }]. */
function iframesIn(page) {
  return page.evaluate(() => [...document.querySelectorAll('iframe')].map((f) => ({ id: f.id, sandbox: f.getAttribute('sandbox') })));
}

/** The CSP a srcdoc declares in its meta tag. */
function cspOf(srcdoc) {
  return /http-equiv="Content-Security-Policy" content="([^"]*)"/.exec(srcdoc)?.[1] ?? null;
}

/** Why the page's recorded srcdocs do not show exactly one probe frame with the mini-app frame's
 *  sandbox and CSP, or null when they do. */
function probeFrameMismatch(sets) {
  const probe = sets.filter((s) => s.id !== 'whim-iframe');
  const realm = sets.filter((s) => s.id === 'whim-iframe').pop();
  if (probe.length !== 1) return `${probe.length} probe frames were created, want 1`;
  const csp = cspOf(realm.written);
  if (probe[0].sandbox === realm.sandbox && csp && cspOf(probe[0].written) === csp) return null;
  return `the probe frame does not match the mini-app frame: sandbox ${probe[0].sandbox} vs ${realm.sandbox}, CSP ${cspOf(probe[0].written)} vs ${csp}`;
}

/** A mini-app that makes the outer page relay one frame of each relayed kind: a UI event through the
 *  loader stub, a nav-depth hint, a forged harness frame (rejected-forgery), a syscall, and an
 *  uncaught runtime error. */
const KINDS_APP = await bundleSource(`import { defineApp, Screen, Text } from 'vc-sdk';
const w = window as unknown as Record<string, any>;
w.ReactNativeWebView.postMessage(JSON.stringify({ __whimUiEvent: true, type: 'press', label: 'kinds' }));
w.parent.postMessage(JSON.stringify({ __whimNavDepth: true, depth: 1 }), '*');
w.parent.postMessage(JSON.stringify({ __whimHarness: true, kind: 'probes', nonce: 'not-the-nonce', payload: {} }), '*');
w.parent.postMessage(JSON.stringify({ whim: 'syscall', v: 1, id: 1, gen: 2, method: 'storage.list', params: {} }), '*');
setTimeout(() => { throw new Error('kinds-app runtime error'); }, 0);
function Home() { return <Screen><Text>Kinds</Text></Screen>; }
export default defineApp({ name: 'Kinds', initial: 'Home', screens: { Home }, capabilities: [] });
`);

const SIGNED_KINDS = ['paint', 'error', 'probes', 'delivery', 'syscall', 'ui-event', 'nav-depth', 'rejected-forgery', 'host-log', 'warm-answer', 'bridge-exposure'];

const PAGE_CASES = [
  {
    name: 'auth accepts one well-formed token, once',
    async run(browser, problems) {
      const { page, pageErrors } = await openRuntimePage(browser, null);
      const malformed = [TOKEN.toUpperCase(), TOKEN.slice(1), TOKEN + '0', ' ' + TOKEN, 42, null];
      for (const bad of malformed) {
        if ((await authorize(page, bad)) !== false) problems.push(`auth accepted the malformed token ${JSON.stringify(bad)}`);
      }
      await page.evaluate(() => globalThis.__whimControl.warm());
      const afterMalformed = await rnPosts(page);
      if (!isDeepStrictEqual(afterMalformed, ['{"__whimWarm":true}'])) problems.push(`before a valid auth, warm posted ${JSON.stringify(afterMalformed)} (want one unsigned answer)`);
      if ((await authorize(page, TOKEN)) !== true) problems.push('auth refused a well-formed token');
      if ((await authorize(page, OTHER_TOKEN)) !== false) problems.push('a second auth was accepted');
      await page.evaluate(() => globalThis.__whimControl.warm());
      await until(async () => (await exposureReports(page)).length > 0, 5000);
      const posts = (await rnPosts(page)).slice(afterMalformed.length);
      if (!posts.includes(`W1.${TOKEN}.{"__whimWarm":true}`)) problems.push(`warm after auth did not post the answer signed with the first token: ${JSON.stringify(posts)}`);
      if (posts.some((p) => p.includes(OTHER_TOKEN))) problems.push('a post carries the second, ignored token');
      if (posts.some((p) => unwrap(p).token !== TOKEN)) problems.push(`a post after auth is not signed with the first token: ${JSON.stringify(posts)}`);
      if (pageErrors.length) problems.push(`page errors: ${pageErrors.join(' | ')}`);
      await page.close();
    },
  },
  {
    name: 'every post after auth is signed, for every kind',
    async run(browser, problems) {
      const { page, pageErrors } = await openRuntimePage(browser, null);
      const before = (await rnPosts(page)).length;
      await authorize(page, TOKEN);
      await deliverApp(page, KINDS_APP);
      await page.evaluate(() => globalThis.__whimControl.warm());
      const seen = async () => new Set((await relayedFrames(page)).map(kindOf));
      await until(async () => { const s = await seen(); return SIGNED_KINDS.every((k) => s.has(k)); }, 10000);
      const kinds = await seen();
      const missing = SIGNED_KINDS.filter((k) => !kinds.has(k));
      if (missing.length) problems.push(`no ${missing.join(', ')} frame was posted, so its signing is unproven`);
      const posts = (await rnPosts(page)).slice(before);
      const unsigned = posts.filter((p) => unwrap(p).token !== TOKEN);
      if (unsigned.length) problems.push(`${unsigned.length} post(s) after auth are not signed: ${unsigned.slice(0, 3).map((p) => p.slice(0, 80)).join(' | ')}`);
      for (const p of posts) {
        try {
          JSON.parse(unwrap(p).body);
        } catch (e) {
          problems.push(`a signed post's body is not JSON (${e.message}): ${p.slice(0, 80)}`);
        }
      }
      if (pageErrors.filter((e) => !e.includes('kinds-app runtime error')).length) problems.push(`page errors: ${pageErrors.join(' | ')}`);
      await page.close();
    },
  },
  {
    name: 'load-time log lines are flushed signed, in order, with the overflow counted',
    async run(browser, problems) {
      for (const lines of [70, 3]) {
        const { page } = await openRuntimePage(browser, null);
        const names = Array.from({ length: lines }, (_, i) => `missing-${i}`);
        await page.evaluate((ns) => { for (const n of ns) globalThis.__whimControl.deliver(n); }, names);
        const loadTime = await rnPosts(page);
        const logged = loadTime.map((p) => JSON.parse(p).line);
        if (loadTime.some((p) => unwrap(p).token !== null) || logged.length !== lines) {
          problems.push(`[${lines}] before auth the page should post each line unsigned, as today; got ${loadTime.length} posts`);
        }
        await authorize(page, TOKEN);
        await until(async () => (await exposureReports(page)).length > 0, 5000);
        const flushed = (await rnPosts(page)).slice(loadTime.length)
          .map(unwrap).filter((u) => u.token === TOKEN).map((u) => JSON.parse(u.body)).filter((f) => f.__whimHostLog === true);
        const kept = Math.min(lines, 64);
        if (!isDeepStrictEqual(flushed.slice(0, kept).map((f) => f.line), logged.slice(0, kept))) {
          problems.push(`[${lines}] the first ${kept} load-time lines were not flushed signed and in order`);
        }
        const extra = flushed.slice(kept);
        if (lines > 64) {
          const dropped = String(lines - 64);
          if (extra.length !== 1 || !new RegExp(`\\b${dropped}\\b`).test(extra[0].line)) {
            problems.push(`[${lines}] want one summary line counting ${dropped} lines not kept, got ${JSON.stringify(extra)}`);
          }
        } else if (extra.length) {
          problems.push(`[${lines}] nothing overflowed, yet more host-log lines followed the flush: ${JSON.stringify(extra)}`);
        }
        await page.close();
      }
    },
  },
  {
    name: 'without auth: no probe frame, and the posts are the authorized session\'s minus the envelope',
    async run(browser, problems) {
      const session = async (token) => {
        const { page, pageErrors } = await openRuntimePage(browser, null);
        if (token) await authorize(page, token);
        await deliverApp(page, TIP_SPLITTER);
        if (token) await until(async () => (await exposureReports(page)).length > 0, 5000);
        else await new Promise((resolve) => setTimeout(resolve, 3500));
        const out = { posts: await rnPosts(page), sets: await page.evaluate(() => window.__srcdocSets.slice()), frames: await iframesIn(page), pageErrors };
        await page.close();
        return out;
      };
      const plain = await session(null);
      const signed = await session(TOKEN);
      if (plain.sets.some((s) => s.id !== 'whim-iframe')) problems.push('a frame other than the mini-app iframe was created without auth');
      if (plain.frames.length !== 1) problems.push(`without auth the page holds ${plain.frames.length} iframes`);
      if (plain.posts.some((p) => p.startsWith('W1.'))) problems.push('a post without auth carries an envelope');
      if (plain.posts.some((p) => JSON.parse(p).kind === 'bridge-exposure')) problems.push('an exposure report was sent without auth');
      // The paint's mount-to-first-paint time is the one measured value in a session; it is masked.
      const unmeasured = (post) => post.replace(/(mountToFirstPaintMs\\*":)[0-9.]+/g, '$1#');
      const stripped = signed.posts.map((p) => unwrap(p).body).filter((b) => JSON.parse(b).kind !== 'bridge-exposure').map(unmeasured);
      const plainPosts = plain.posts.map(unmeasured);
      const firstDiff = plainPosts.findIndex((p, i) => p !== stripped[i]);
      if (plainPosts.length !== stripped.length || firstDiff !== -1) {
        problems.push(`the unsigned session differs from the signed one beyond the envelope (${plainPosts.length} vs ${stripped.length} posts), first at #${firstDiff}:\n       plain  ${plainPosts[firstDiff]?.slice(0, 300)}\n       signed ${stripped[firstDiff]?.slice(0, 300)}`);
      }
      if (plain.posts.length < 4) problems.push(`only ${plain.posts.length} posts in the session, so the comparison proves little`);
      for (const s of [plain, signed]) if (s.pageErrors.length) problems.push(`page errors: ${s.pageErrors.join(' | ')}`);
    },
  },
  {
    name: 'a navigated probe frame reports what it sees, posts the canary, and is removed',
    async run(browser, problems) {
      const webview = 'chrome-' + browser.version().split('.')[0];
      const wants = [
        { frameBridge: { android: 'own', ios: 'handler' }, visible: { android: true, ios: true }, canaries: 2 },
        { frameBridge: null, visible: { android: false, ios: false }, canaries: 0 },
      ];
      for (const w of wants) {
        const { page, pageErrors, nativePosts } = await openRuntimePage(browser, w.frameBridge);
        const tag = JSON.stringify(w.frameBridge);
        await deliverApp(page, TIP_SPLITTER);
        const beforeAuth = (await rnPosts(page)).length;
        await authorize(page, TOKEN);
        await until(async () => (await exposureReports(page)).length > 0, 5000);
        const reports = await exposureReports(page);
        const want = { outcome: 'navigated', visible: w.visible, webview };
        if (!isDeepStrictEqual(reports, [want])) problems.push(`[${tag}] reports ${JSON.stringify(reports)} want [${JSON.stringify(want)}]`);
        const canaries = nativePosts.filter((p) => p === CANARY).length;
        if (canaries !== w.canaries) problems.push(`[${tag}] ${canaries} canary posts reached the stand-in bridges, want ${w.canaries}`);
        if ((await rnPosts(page)).some((p) => p.includes(CANARY))) problems.push(`[${tag}] the canary reached the outer page's RN channel`);
        const mismatch = probeFrameMismatch(await page.evaluate(() => window.__srcdocSets.slice()));
        if (mismatch) problems.push(`[${tag}] ${mismatch}`);
        const left = await iframesIn(page);
        if (left.length !== 1 || left[0].id !== 'whim-iframe') problems.push(`[${tag}] after the report the page still holds ${JSON.stringify(left)}`);
        if ((await relayedFrames(page)).slice(beforeAuth).some((f) => f.kind === 'rejected-forgery')) problems.push(`[${tag}] the probe touched the forgery tally`);
        if (pageErrors.length) problems.push(`[${tag}] page errors: ${pageErrors.join(' | ')}`);
        await page.close();
      }
    },
  },
  {
    name: 'a refused navigation reports refused, not timedOut',
    async run(browser, problems) {
      const { page, pageErrors } = await openRuntimePage(browser, { android: 'own', ios: 'handler' }, { probe: 'refuse' });
      let refusals = 0;
      await page.route(REFUSE_URL + '**', (route) => { refusals++; return route.fulfill({ status: 204, body: '' }); });
      const startedAt = Date.now();
      await authorize(page, TOKEN);
      await until(async () => (await exposureReports(page)).length > 0, 5000);
      const elapsed = Date.now() - startedAt;
      const reports = await exposureReports(page);
      if (elapsed < 2900) problems.push(`the refused report came after ${elapsed} ms, before the 3 s deadline (a slower navigation could still have committed)`);
      if (refusals === 0) problems.push('the probe frame never tried to navigate, so the refusal was not exercised');
      const outcome = reports[0]?.outcome;
      if (reports.length !== 1 || outcome !== 'refused') problems.push(`reports ${JSON.stringify(reports)} want exactly one with outcome refused`);
      else if (!isDeepStrictEqual(reports[0].visible, { android: false, ios: false })) problems.push(`a refused probe claims visibility ${JSON.stringify(reports[0].visible)}`);
      const left = await iframesIn(page);
      if (left.length !== 1) problems.push(`after the report the page still holds ${JSON.stringify(left)}`);
      if (pageErrors.length) problems.push(`page errors: ${pageErrors.join(' | ')}`);
      await page.close();
    },
  },
  {
    name: 'a navigation that commits after the probe\'s still-here reports navigated, not refused',
    async run(browser, problems) {
      const { page, pageErrors } = await openRuntimePage(browser, { android: 'own', ios: 'handler' }, { probe: 'slow' });
      let served = 0;
      await page.route(SLOW_URL + '**', async (route) => {
        // The navigated document the probe would have loaded from its data: URL, decoded.
        const written = await page.evaluate(() => window.__srcdocSets.find((s) => s.id !== 'whim-iframe').written);
        const html = decodeURIComponent(/"data:text\/html;charset=utf-8,([^"]*)"/.exec(written)[1]);
        await new Promise((resolve) => setTimeout(resolve, 1200));
        served++;
        return route.fulfill({ status: 200, contentType: 'text/html', body: html });
      });
      await authorize(page, TOKEN);
      await until(async () => (await exposureReports(page)).length > 0, 5000);
      await new Promise((resolve) => setTimeout(resolve, 300));
      const reports = await exposureReports(page);
      const want = [{ outcome: 'navigated', visible: { android: true, ios: true }, webview: 'chrome-' + browser.version().split('.')[0] }];
      if (served !== 1) problems.push(`the slow navigation was served ${served} times, want 1`);
      if (!isDeepStrictEqual(reports, want)) problems.push(`reports ${JSON.stringify(reports)} want ${JSON.stringify(want)}`);
      const left = await iframesIn(page);
      if (left.length !== 1 || left[0].id !== 'whim-iframe') problems.push(`after the report the page still holds ${JSON.stringify(left)}`);
      if (pageErrors.length) problems.push(`page errors: ${pageErrors.join(' | ')}`);
      await page.close();
    },
  },
  {
    name: 'a silent probe times out and is removed; exposure-shaped posts from the mini-app frame or the page itself are ignored',
    async run(browser, problems) {
      const { page, pageErrors } = await openRuntimePage(browser, null, { probe: 'inert' });
      await deliverApp(page, TIP_SPLITTER);
      const beforeAuth = (await rnPosts(page)).length;
      const startedAt = Date.now();
      await authorize(page, TOKEN);
      const during = await iframesIn(page);
      if (during.length !== 2) problems.push(`while the probe runs the page holds ${JSON.stringify(during)}, want the mini-app frame and the probe frame`);
      await (await realmFrame(page)).evaluate(() => {
        window.parent.postMessage(JSON.stringify({ __whimExposure: true, phase: 'report', visible: { android: 'object', ios: 'object' } }), '*');
        window.parent.postMessage(JSON.stringify({ __whimExposure: true, phase: 'still-here' }), '*');
      });
      await page.evaluate(() => {
        window.postMessage(JSON.stringify({ __whimExposure: true, phase: 'report', visible: { android: 'object', ios: 'object' } }), '*');
        window.postMessage(JSON.stringify({ __whimExposure: true, phase: 'still-here' }), '*');
      });
      await until(async () => (await exposureReports(page)).length > 0, 5000);
      const elapsed = Date.now() - startedAt;
      await new Promise((resolve) => setTimeout(resolve, 300));
      const reports = await exposureReports(page);
      const want = [{ outcome: 'timedOut', visible: { android: false, ios: false }, webview: 'chrome-' + browser.version().split('.')[0] }];
      if (!isDeepStrictEqual(reports, want)) problems.push(`reports ${JSON.stringify(reports)} want ${JSON.stringify(want)}`);
      if (elapsed < 2900) problems.push(`the report came after ${elapsed} ms, before the 3 s limit`);
      const left = await iframesIn(page);
      if (left.length !== 1 || left[0].id !== 'whim-iframe') problems.push(`after the timeout the page still holds ${JSON.stringify(left)}`);
      if ((await relayedFrames(page)).slice(beforeAuth).some((f) => f.kind === 'rejected-forgery')) problems.push('the mini-app frame\'s exposure-shaped posts reached the forgery tally');
      if (pageErrors.length) problems.push(`page errors: ${pageErrors.join(' | ')}`);
      await page.close();
    },
  },
  {
    name: 'the token reaches no frame: nothing sent to the iframe carries it, and a navigated frame finds none',
    async run(browser, problems) {
      const { page, pageErrors, nativePosts } = await openRuntimePage(browser, { android: 'own', ios: 'handler' });
      await authorize(page, TOKEN);
      await deliverApp(page, TIP_SPLITTER);
      await page.evaluate(() => {
        globalThis.__whimRelaySysret(JSON.stringify({ whim: 'sysret', v: 1, id: 1, ok: true, result: null }));
        globalThis.__whimControl.navBack();
      });
      const realm = await realmFrame(page);
      await until(async () => (await realm.evaluate(() => window.__framesReceived.length)) >= 4, 5000);
      const received = await realm.evaluate(() => window.__framesReceived.slice());
      if (received.length < 4) problems.push(`the mini-app frame received only ${received.length} messages (init, delivery, sysret, nav-back), so the check proves little`);
      if (received.some((m) => m.includes(TOKEN))) problems.push('a message sent to the mini-app frame carries the token');
      const sets = await page.evaluate(() => window.__srcdocSets.slice());
      if (sets.some((s) => s.written.includes(TOKEN))) problems.push('a srcdoc carries the token');

      // The bridge-reach fixture navigates its frame to a data: document that hunts for the token.
      await deliverApp(page, BRIDGE_REACH);
      const label = async () => (await relayedFrames(page))
        .map((f) => (f.kind === 'ui-event' ? String(f.payload?.label ?? '') : ''))
        .find((l) => l.startsWith('bridge-reach:'));
      await until(async () => (await label()) !== undefined, 10000);
      const found = await label();
      const report = found ? JSON.parse(found.slice('bridge-reach:'.length)) : null;
      const wantSeen = { android: 'object', ios: 'object', control: 'undefined', parentControl: 'blocked', topControl: 'blocked' };
      if (!report) problems.push('the bridge-reach fixture\'s navigated document never reported');
      else {
        if (!isDeepStrictEqual(report.seen, wantSeen)) problems.push(`the navigated document saw ${JSON.stringify(report.seen)} want ${JSON.stringify(wantSeen)}`);
        if (report.tokenLike !== 0) problems.push(`the navigated document found ${report.tokenLike} token-shaped strings`);
        if (!isDeepStrictEqual(report.forgedPosted, { android: 4, ios: 4 })) problems.push(`forged posts ${JSON.stringify(report.forgedPosted)} want 4 per stand-in bridge`);
      }
      const forged = nativePosts.filter((p) => p.includes('bridge-reach-forged'));
      if (forged.length !== 8) problems.push(`${forged.length} forged frames reached the stand-in bridges, want 8`);
      if ((await rnPosts(page)).some((p) => p.includes('bridge-reach-forged'))) problems.push('a forged frame reached the outer page\'s RN channel');
      if (pageErrors.length) problems.push(`page errors: ${pageErrors.join(' | ')}`);
      await page.close();
    },
  },
];

const failures = [];
const browser = await chromium.launch();
try {
  for (const c of CASES) {
    const { page, pageErrors } = await openRuntimePage(browser, c.frameBridge);
    const verdict = await deliverApp(page, c.source ?? TIP_SPLITTER);
    const got = {
      contained: verdict?.contained,
      probes: bridgeProbeResults(verdict),
      bridge: verdict?.bridge,
    };
    const problems = [];
    if (!verdict) problems.push('no verdict reached RN');
    if (!isDeepStrictEqual(got, c.want)) problems.push(`got ${JSON.stringify(got)} want ${JSON.stringify(c.want)}`);
    // `bridge` is a side field: the counted total is exactly the counted probe entries.
    const counted = (verdict?.probes ?? []).filter((p) => p.category !== 'negative-control' && p.category !== 'pentest-T7-info');
    if (verdict && verdict.total !== counted.length) problems.push(`total=${verdict.total} but ${counted.length} counted probes`);
    if (c.forged && verdict?.neutralizeReport?.forgedByApp !== true) {
      problems.push(`the app's rewrite of __WHIM_NEUTRALIZE_REPORT__ did not take (neutralizeReport=${JSON.stringify(verdict?.neutralizeReport)}), so the case proves nothing`);
    }
    if (c.uncover) {
      const u = await (await realmFrame(page)).evaluate(uncoverAttempt);
      const want = { beforeNative: false, rereadNative: false, chainNative: false, webkitNative: false, shimNative: false, nativePosts: 0 };
      if (!isDeepStrictEqual(u, want)) problems.push(`uncover attempt ${JSON.stringify(u)} want ${JSON.stringify(want)}`);
      // The app's post went through the loader stub: the outer page relayed it as a UI event.
      const relayedEvent = await until(async () => (await relayedFrames(page))
        .some((f) => f.kind === 'ui-event' && f.payload?.label === 'provenance-uncover'), 5000);
      if (!relayedEvent) problems.push('a post through the realm\'s ReactNativeWebView never reached the outer page');
    }
    if (pageErrors.length) problems.push(`page errors: ${pageErrors.join(' | ')}`);
    const score = verdict ? verdict.passed + '/' + verdict.total : 'no verdict';
    console.log(`${problems.length ? 'FAIL' : 'PASS'} ${c.name}: contained=${got.contained} ${score} bridge=${JSON.stringify(got.bridge)}`);
    for (const p of problems) console.log(`     ${p}`);
    if (problems.length) failures.push(c.name);
    await page.close();
  }
  for (const c of PAGE_CASES) {
    const problems = [];
    await c.run(browser, problems);
    console.log(`${problems.length ? 'FAIL' : 'PASS'} ${c.name}`);
    for (const p of problems) console.log(`     ${p}`);
    if (problems.length) failures.push(c.name);
  }
} finally {
  await browser.close();
  await rm(PAGES, { recursive: true, force: true });
}

try {
  assert.deepStrictEqual(failures, [], `bridge-provenance cases failed: ${failures.join('; ')}`);
} catch (e) {
  console.error(`\n✗ ${e.message}`);
  process.exit(1);
}
console.log(`\n✅ bridge provenance: native bridges are removed and recorded, an unremovable one fails containment, app code cannot rewrite the record, and the outer page signs every post once authorized and measures what a navigated frame reaches (${CASES.length + PAGE_CASES.length} cases).`);
