// ─────────────────────────────────────────────────────────────────────────────
// deliver-by-source desktop verification (launcher-shell / #5 D3 — task 3.3).
// ─────────────────────────────────────────────────────────────────────────────
// Proves that a fixture delivered BY SOURCE (the launcher's host-record path) renders and
// contains IDENTICALLY to its baked twin, under the same headless Chromium the invariant suite
// uses. This is a STANDALONE verify — it never touches `invariants/` (§16.4: feature agents do
// not author invariants). It builds the SAME outer page the runtime ships and drives
// `__whimControl.reinject({ bundleSource })` against an EMPTY baked map, so the bytes can only
// have come from the host-supplied source.
//
// Render + verdict parity is checked here on desktop; syscall parity is the on-device
// acceptance (water-counter by source, task 7.2 — the desktop syscall sink is the RN host).
//
// It also checks what a by-source realm does with what it is handed (beta-1 D3/D4/D5), reading
// the frames the outer page relays to RN: a render error the app never caught is ONE trusted
// `render` frame (the one render-error-frame.json holds for the launcher suite), the orb inset
// pads the app's Screen without reaching the theme global, and a focused field is scrolled back
// into view when the viewport shrinks.
//
//   npm run build && node src/host/launcher/test/deliver-by-source.desktop.mjs
import { chromium } from 'playwright';
import { build as esbuild } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { buildSrcdoc, buildOuterHtml } from '../../../../build/assemble.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..', '..');
const PAGES = join(HERE, '.deliver-pages');

const artifacts = JSON.parse(await readFile(join(ROOT, 'src/runtime/generated/runtime-artifacts.json'), 'utf8'));
const { parts, bundles } = artifacts;
const SRC = bundles['tip-splitter'];
const WATER_SRC = bundles['water-counter'];
const pick = (t, re) => { const m = (t || '').match(re); return m ? m[1] : null; };

async function writePage(name, html) {
  await mkdir(PAGES, { recursive: true });
  const p = join(PAGES, name + '.html');
  await writeFile(p, html);
  return p;
}

/** Poll `ready` until it holds or `timeoutMs` passes. A condition that never holds just lets the
 *  run continue, and the verdict below reports what was actually on the page. */
async function until(ready, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await ready()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

/** How many children each frame's `#whim-root` has (frames without one are skipped). */
async function rootChildCounts(page) {
  const counts = [];
  for (const f of page.frames()) {
    const n = await f.evaluate(() => document.getElementById('whim-root')?.childNodes.length ?? null).catch(() => null);
    if (n !== null) counts.push(n);
  }
  return counts;
}

async function run(browser, file, drive, waitForVerdict = true) {
  const page = await browser.newPage();
  const errors = [];
  const errorDetails = [];
  page.on('pageerror', (e) => {
    errors.push(String(e?.message || e));
    errorDetails.push({ name: String(e?.name || ''), message: String(e?.message || e) });
  });
  await page.goto(pathToFileURL(file).href, { waitUntil: 'load', timeout: 20000 });
  if (drive) await drive(page);
  if (waitForVerdict) {
    await page.waitForFunction(() => (document.title || '') !== 'WHIM:pending', { timeout: 12000 }).catch(() => {});
    // Then until the sandboxed app has actually rendered into its root.
    await until(async () => (await rootChildCounts(page)).some((n) => n > 0));
  } else {
    // A bootstrap that fails closed reports itself as a page error.
    await until(async () => errors.length > 0);
  }
  const dom = await page.evaluate(() => ({
    title: document.title || '',
    probes: document.getElementById('probes')?.textContent || '',
    delivery: document.getElementById('delivery')?.textContent || '',
    paint: document.getElementById('paint')?.textContent || '',
  }));
  let iframeState = null;
  for (const f of page.frames()) {
    try {
      const state = await f.evaluate(() => {
        const root = document.getElementById('whim-root');
        if (!root) return null;
        const own = Object.prototype.hasOwnProperty;
        let publicSdk = null;
        try {
          publicSdk = typeof window.__whimRequire === 'function'
            ? window.__whimRequire('vc-sdk')
            : null;
          // eslint-disable-next-line no-restricted-syntax -- intentional: the probe is READING whether vc-sdk is reachable; a throw here is the "absent" answer, and logging it inside a headless-Chromium probe is noise, not signal
        } catch {}
        return {
          text: root.innerText,
          rootChildren: root.childNodes.length,
          publicNavRoot: !!publicSdk && own.call(publicSdk, 'NavRoot'),
          publicNavRootProps: !!publicSdk && own.call(publicSdk, 'NavRootProps'),
          bootstrap: own.call(window, '__WHIM_VC_SDK_INTERNAL__'),
          loaderInstalled: typeof window.__whimAfterBundle === 'function',
          generation: own.call(window, '__whimGeneration'),
          appModule: own.call(window, '__WHIM_APP_MODULE__'),
        };
      });
      if (state) iframeState = state;
      // eslint-disable-next-line no-restricted-syntax -- intentional: a non-sandbox frame refusing evaluate is not the frame being probed; the probe skips it and reports on the frames it could read
    } catch {}
  }
  await page.close();
  return { dom, errors, errorDetails, iframeState, iframeText: iframeState?.text || '' };
}

const srcdocB = buildSrcdoc({ parts, channel: 'b' });
// Baked twin: tip-splitter in the baked map, autostarted by name.
const bakedPage = await writePage('baked', buildOuterHtml({
  srcdoc: srcdocB, bundles: { 'tip-splitter': SRC }, initial: 'tip-splitter', channel: 'b',
}));
// By-source: EMPTY baked map; the bytes can only come from the host-supplied bundleSource.
const sourcePage = await writePage('by-source', buildOuterHtml({
  srcdoc: srcdocB, bundles: {}, initial: 'tip-splitter', channel: 'b', autostart: false,
}));
// Non-default source: initial/baked-map defaults to tip-splitter, but we inject water-counter by
// source. Proves the selected card's bundle overrides the baked initial (B1 regression guard).
const nonDefaultPage = await writePage('non-default-source', buildOuterHtml({
  srcdoc: srcdocB, bundles: { 'tip-splitter': SRC }, initial: 'tip-splitter', channel: 'b', autostart: false,
}));

const bootstrapVariants = {
  missing: parts.sdkInject + '\ndelete globalThis.__WHIM_VC_SDK_INTERNAL__;',
  invalid: parts.sdkInject + `
Object.defineProperty(globalThis, '__WHIM_VC_SDK_INTERNAL__', {
  value: Object.freeze({ NavRoot: null }),
  enumerable: false,
  writable: false,
  configurable: true,
});`,
  undeletable: parts.sdkInject + `
(function makeBootstrapUndeletableAfterValidation() {
  var realGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
  Object.getOwnPropertyDescriptor = function (target, key) {
    var descriptor = realGetOwnPropertyDescriptor(target, key);
    if (target === globalThis && key === '__WHIM_VC_SDK_INTERNAL__' && descriptor) {
      Object.defineProperty(target, key, {
        value: descriptor.value,
        enumerable: descriptor.enumerable,
        writable: descriptor.writable,
        configurable: false,
      });
    }
    return descriptor;
  };
})();`,
};

// ── Realm behavior (beta-1 D3/D4/D5) ─────────────────────────────────────────
const RENDER_ERROR_FRAME = JSON.parse(await readFile(join(HERE, 'render-error-frame.json'), 'utf8'));

/** A mini-app written here, compiled with build/build.mjs's app-bundle options (`bundleApp`). */
async function bundleSource(contents) {
  const out = await esbuild({
    stdin: { contents, loader: 'tsx', resolveDir: ROOT, sourcefile: 'realm-check.app.tsx' },
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

const LEDGER_ERROR = `class LedgerError extends Error {
  constructor(message: string) { super(message); this.name = 'LedgerError'; }
}`;
const BREAKS_AFTER_PAINT = await bundleSource(`import { defineApp, Screen, Button, useState } from 'vc-sdk';
${LEDGER_ERROR}
function Home() {
  const [broken, setBroken] = useState(false);
  if (broken) throw new LedgerError('Alice owes 40');
  return <Screen><Button label="Break" onPress={() => setBroken(true)} /></Screen>;
}
export default defineApp({ name: 'Breaks', initial: 'Home', screens: { Home }, capabilities: [] });
`);
const BREAKS_BEFORE_PAINT = await bundleSource(`import { defineApp } from 'vc-sdk';
${LEDGER_ERROR}
function Home(): never { throw new LedgerError('Alice owes 40'); }
export default defineApp({ name: 'Breaks at once', initial: 'Home', screens: { Home }, capabilities: [] });
`);
const INPUT_AT_THE_BOTTOM = await bundleSource(`import { defineApp, Screen, Stack, Text, TextInput, useState } from 'vc-sdk';
function Home() {
  const [note, setNote] = useState('');
  const rows = Array.from({ length: 40 }, (_, i) => <Text key={i}>Row {i + 1}</Text>);
  return <Screen><Stack>{rows}<TextInput label="Note" value={note} onChange={setNote} /></Stack></Screen>;
}
export default defineApp({ name: 'Note', initial: 'Home', screens: { Home }, capabilities: [] });
`);

// Full-height iframe (no diagnostics panel), nothing baked: every realm gets its bytes by source.
const realmPage = await writePage('realm', buildOuterHtml({
  srcdoc: srcdocB, bundles: {}, initial: 'realm-check', channel: 'b', autostart: false, showDiagnostics: false,
}));

/** Deliver `source` (with `theme`) into a fresh realm and wait for its first paint. `relayed()`
 *  is every frame the outer page handed RN, as RN would parse it; `realm()` is the sandbox frame. */
async function openRealm(browser, source, theme, viewport = { width: 400, height: 2000 }) {
  const page = await browser.newPage({ viewport });
  await page.addInitScript(() => {
    if (window.top !== window) return; // the outer page only: the realm keeps the loader's own stub
    const frames = [];
    Object.defineProperty(window, '__relayed', { value: frames });
    window.ReactNativeWebView = { postMessage: (s) => frames.push(JSON.parse(s)) };
  });
  await page.goto(pathToFileURL(realmPage).href, { waitUntil: 'load', timeout: 20000 });
  await page.evaluate(({ src, th }) => globalThis.__whimControl.reinject({
    reset: true, bundle: 'realm-check', bundleSource: src, generation: 2, theme: th,
  }), { src: source, th: theme });
  const relayed = () => page.evaluate(() => window.__relayed.slice());
  await until(async () => (await relayed()).some((f) => f.kind === 'paint'));
  const realm = () => page.frames().find((f) => f !== page.mainFrame());
  return { page, relayed, realm };
}

/** Frames the outer page relays that report an error, after a pause long enough for a second
 *  report of the same failure (the loader would post it in the same task) to have arrived. */
async function errorFramesSettled(relayed) {
  await until(async () => (await relayed()).some((f) => f.kind === 'error'), 5000);
  await new Promise((resolve) => setTimeout(resolve, 250));
  const frames = await relayed();
  return {
    errors: frames.filter((f) => f.kind === 'error' || (f.kind === 'rejected-forgery' && f.forgedKind === 'error')),
    leaked: JSON.stringify(frames).includes('Alice'),
  };
}

/** The Screen's resolved padding, and whether the inset reached anything a mini-app can read. */
function screenAndReachableInset() {
  const screen = document.getElementById('whim-root')?.firstElementChild;
  const style = screen ? window.getComputedStyle(screen) : null;
  return {
    paddingTop: style?.paddingTop ?? null,
    paddingBottom: style?.paddingBottom ?? null,
    themeKeys: Object.keys(window.__WHIM_THEME__ ?? {}),
    sdkInsetExports: Object.keys(window.__whimRequire('vc-sdk')).filter((k) => /inset|chrome/i.test(k)),
  };
}

async function realmChecks(browser) {
  const checks = {};
  const detail = {};

  {
    const { page, relayed, realm } = await openRealm(browser, BREAKS_AFTER_PAINT);
    await realm().getByText('Break').click();
    const { errors, leaked } = await errorFramesSettled(relayed);
    checks['render error after paint'] = isDeepStrictEqual(errors, [RENDER_ERROR_FRAME]) && !leaked;
    detail['render error after paint'] = `errors=${JSON.stringify(errors)} message-leaked=${leaked}`;
    await page.close();
  }
  {
    const { page, relayed } = await openRealm(browser, BREAKS_BEFORE_PAINT);
    const { errors, leaked } = await errorFramesSettled(relayed);
    checks['render error before paint'] = isDeepStrictEqual(errors, [RENDER_ERROR_FRAME]) && !leaked;
    detail['render error before paint'] = `errors=${JSON.stringify(errors)} message-leaked=${leaked}`;
    await page.close();
  }

  // tip-splitter's Screen pads with the lg token (20px). The loader sanitizes what the host sent,
  // and installs the rest of the theme as the global the SDK reads its colours from.
  const colors = { primary: '#123456' };
  for (const [name, chromeInsetBottom, paddingBottom] of [
    ['inset 106', 106, '126px'],
    ['inset over the cap', 5000, '220px'],
    ['negative inset', -40, '20px'],
    ['inset that is not a number', '84', '20px'],
    ['no inset', undefined, '20px'],
  ]) {
    const theme = chromeInsetBottom === undefined ? { colors } : { colors, chromeInsetBottom };
    const { page, realm } = await openRealm(browser, SRC, theme);
    const seen = await realm().evaluate(screenAndReachableInset);
    checks[name] = seen.paddingTop === '20px' && seen.paddingBottom === paddingBottom &&
      isDeepStrictEqual(seen.themeKeys, ['colors']) && seen.sdkInsetExports.length === 0;
    detail[name] = `padding top=${seen.paddingTop} bottom=${seen.paddingBottom} (want ${paddingBottom}) theme keys=${JSON.stringify(seen.themeKeys)} sdk inset exports=${JSON.stringify(seen.sdkInsetExports)}`;
    await page.close();
  }

  {
    const { page, realm } = await openRealm(browser, INPUT_AT_THE_BOTTOM, undefined);
    const field = () => realm().evaluate(() => {
      const r = document.querySelector('input').getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, viewport: window.innerHeight, focused: document.activeElement?.tagName ?? null };
    });
    const before = await field();
    await realm().focus('input');
    // The keyboard opening: the viewport shrinks until the focused field is entirely below it.
    await page.setViewportSize({ width: 400, height: Math.floor(before.top / 2) });
    // Layout is fractional: a field scrolled flush with the bottom edge can overhang it by <1px.
    const inView = (f) => f.top >= 0 && f.bottom <= f.viewport + 1;
    await until(async () => inView(await field()), 3000);
    const after = await field();
    checks['focused field after a resize'] = inView(before) && after.focused === 'INPUT' &&
      after.viewport < before.top && inView(after);
    detail['focused field after a resize'] = `before=${JSON.stringify(before)} after=${JSON.stringify(after)}`;
    await page.close();
  }
  return { checks, detail };
}

const bootstrapFailurePages = {};
for (const [name, sdkInject] of Object.entries(bootstrapVariants)) {
  bootstrapFailurePages[name] = await writePage(`bootstrap-${name}`, buildOuterHtml({
    srcdoc: buildSrcdoc({ parts: { ...parts, sdkInject }, channel: 'b' }),
    bundles: { 'tip-splitter': SRC },
    initial: 'tip-splitter',
    channel: 'b',
  }));
}

const browser = await chromium.launch();
const baked = await run(browser, bakedPage);
const bySource = await run(browser, sourcePage, async (page) => {
  await page.evaluate((src) => globalThis.__whimControl.reinject({ reset: true, bundle: 'tip-splitter', bundleSource: src, generation: 2 }), SRC);
});
// Inject water-counter by source into a page whose initial/baked map defaults to tip-splitter.
// The rendered iframe MUST show Water Counter, not Tip Splitter (B1 regression guard).
const nonDefault = await run(browser, nonDefaultPage, async (page) => {
  await page.evaluate((src) => globalThis.__whimControl.reinject({ reset: true, bundle: 'water-counter', bundleSource: src, generation: 2 }), WATER_SRC);
});
const bootstrapFailures = {};
for (const [name, file] of Object.entries(bootstrapFailurePages)) {
  bootstrapFailures[name] = await run(browser, file, null, false);
}
const realm = await realmChecks(browser);
await browser.close();

const verdict = (r, paintedCheck) => ({
  contained: pick(r.dom.probes, /contained=(true|false)/),
  accepted: /"accepted":\s*true/.test(r.dom.delivery),
  painted: paintedCheck(r.iframeText),
  errors: r.errors,
});
const A = verdict(baked, (t) => /Tip Splitter/.test(t) && /Per person/.test(t));
const B = verdict(bySource, (t) => /Tip Splitter/.test(t) && /Per person/.test(t));
// C: water-counter injected by source when initial/baked-map defaults to tip-splitter.
// Must render Water Counter, NOT Tip Splitter (B1 regression guard).
const C = verdict(nonDefault, (t) => /Water Counter/.test(t) && !/Tip Splitter/.test(t));

const normalRuntimeSurfaceOk = (result) =>
  result.iframeState?.publicNavRoot === false &&
  result.iframeState?.publicNavRootProps === false &&
  result.iframeState?.bootstrap === false &&
  result.iframeState?.loaderInstalled === true &&
  result.iframeState?.rootChildren > 0;

const expectedBootstrapFailure = (name, result) => {
  const typeError = result.errorDetails.some((error) =>
    error.name === 'TypeError' && (
      name === 'undeletable'
        ? /delete|erase/i.test(error.message)
        : /bootstrap is missing or invalid/.test(error.message)
    ));
  return typeError &&
    result.iframeState?.loaderInstalled === false &&
    result.iframeState?.generation === false &&
    result.iframeState?.appModule === false &&
    result.iframeState?.rootChildren === 0 &&
    result.dom.title === 'WHIM:pending' &&
    result.dom.delivery === '—' &&
    result.dom.paint === '—' &&
    result.dom.probes === '—';
};

const bootstrapFailureChecks = Object.fromEntries(
  Object.entries(bootstrapFailures).map(([name, result]) => [name, expectedBootstrapFailure(name, result)]),
);

console.log('deliver-by-source desktop parity (tip-splitter):');
console.log(`  baked    : contained=${A.contained} painted=${A.painted} accepted=${A.accepted}${A.errors.length ? ' ERR=' + A.errors.join('|') : ''}`);
console.log(`  by-source: contained=${B.contained} painted=${B.painted} accepted=${B.accepted}${B.errors.length ? ' ERR=' + B.errors.join('|') : ''}`);
console.log('deliver-by-source non-default app (water-counter over tip-splitter initial):');
console.log(`  non-default: contained=${C.contained} painted=${C.painted} accepted=${C.accepted}${C.errors.length ? ' ERR=' + C.errors.join('|') : ''}`);
console.log('vc-sdk loader-only navigation bootstrap:');
console.log(`  normal: public-root=${baked.iframeState?.publicNavRoot} public-props=${baked.iframeState?.publicNavRootProps} bootstrap=${baked.iframeState?.bootstrap} loader=${baked.iframeState?.loaderInstalled} rendered=${baked.iframeState?.rootChildren > 0}`);
for (const [name, result] of Object.entries(bootstrapFailures)) {
  const errors = result.errorDetails.map((error) => `${error.name}: ${error.message}`).join('|');
  console.log(`  ${name}: fail-closed=${bootstrapFailureChecks[name]}${errors ? ' ERR=' + errors : ''}`);
}
console.log('realm behavior of a by-source delivery:');
for (const [name, passed] of Object.entries(realm.checks)) {
  console.log(`  ${name}: ${passed ? 'ok' : 'FAILED'} — ${realm.detail[name]}`);
}
// Page B was built with an EMPTY baked map, so a rendered + contained tip-splitter proves the
// bytes came ONLY from the host-supplied bundleSource — identical verdict to the baked twin.
// Page C proves the selected source overrides the baked initial: water-counter renders,
// not the tip-splitter that would have run under the fallback path (B1 regression guard).

// Parity = same containment verdict + same render, with page B's bytes proven to be the
// host-supplied source (empty baked map). `accepted` is logged but not gated (the #delivery
// diagnostic is transient and reads the same on the known-good baked twin).
const ok =
  A.contained === 'true' &&
  B.contained === A.contained &&
  A.painted && B.painted === A.painted &&
  A.errors.length === 0 && B.errors.length === 0 &&
  C.contained === 'true' && C.painted && C.errors.length === 0 &&
  normalRuntimeSurfaceOk(baked) &&
  Object.values(bootstrapFailureChecks).every(Boolean) &&
  Object.values(realm.checks).every(Boolean);

if (!ok) {
  console.error('\n❌ by-source delivery verification failed.');
  if (!(A.contained === 'true' && B.contained === A.contained && A.painted && B.painted === A.painted && A.errors.length === 0 && B.errors.length === 0)) {
    console.error('   tip-splitter parity check failed.');
  }
  if (!(C.contained === 'true' && C.painted && C.errors.length === 0)) {
    console.error('   non-default source (water-counter) did NOT render when initial=tip-splitter (B1 regression).');
  }
  if (!normalRuntimeSurfaceOk(baked)) {
    console.error('   public vc-sdk/root-bootstrap surface was visible or the trusted loader did not render.');
  }
  for (const [name, passed] of Object.entries(bootstrapFailureChecks)) {
    if (!passed) console.error(`   ${name} bootstrap did not fail closed before delivery/mount.`);
  }
  for (const [name, passed] of Object.entries(realm.checks)) {
    if (!passed) console.error(`   realm check failed: ${name}.`);
  }
  process.exit(1);
}
console.log('\n✅ by-source delivery renders + contains identically to its baked twin.');
console.log('✅ non-default source (water-counter) renders correctly over tip-splitter initial (B1 guard green).');
console.log('✅ navigation bootstrap stays loader-only and missing/invalid/undeletable states fail closed.');
console.log('✅ a by-source realm reports an uncaught render error once, pads Screen by the sanitized orb inset without exposing it, and keeps a focused field in view.');
