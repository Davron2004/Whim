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
//   npm run build && node src/host/launcher/test/deliver-by-source.desktop.mjs
import { chromium } from 'playwright';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
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

async function run(browser, file, drive) {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e?.message || e)));
  await page.goto(pathToFileURL(file).href, { waitUntil: 'load', timeout: 20000 });
  if (drive) await drive(page);
  await page.waitForFunction(() => (document.title || '') !== 'WHIM:pending', { timeout: 12000 }).catch(() => {});
  await page.waitForTimeout(400);
  const dom = await page.evaluate(() => ({
    title: document.title || '',
    probes: (document.getElementById('probes') || {}).textContent || '',
    delivery: (document.getElementById('delivery') || {}).textContent || '',
    paint: (document.getElementById('paint') || {}).textContent || '',
  }));
  let iframeText = '';
  for (const f of page.frames()) {
    try { const t = await f.evaluate(() => { const r = document.getElementById('whim-root'); return r ? r.innerText : null; }); if (t) iframeText = t; } catch {}
  }
  await page.close();
  return { dom, errors, iframeText };
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

console.log('deliver-by-source desktop parity (tip-splitter):');
console.log(`  baked    : contained=${A.contained} painted=${A.painted} accepted=${A.accepted}${A.errors.length ? ' ERR=' + A.errors.join('|') : ''}`);
console.log(`  by-source: contained=${B.contained} painted=${B.painted} accepted=${B.accepted}${B.errors.length ? ' ERR=' + B.errors.join('|') : ''}`);
console.log('deliver-by-source non-default app (water-counter over tip-splitter initial):');
console.log(`  non-default: contained=${C.contained} painted=${C.painted} accepted=${C.accepted}${C.errors.length ? ' ERR=' + C.errors.join('|') : ''}`);
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
  C.contained === 'true' && C.painted && C.errors.length === 0;

if (!ok) {
  console.error('\n❌ by-source delivery verification failed.');
  if (!(A.contained === 'true' && B.contained === A.contained && A.painted && B.painted === A.painted && A.errors.length === 0 && B.errors.length === 0)) {
    console.error('   tip-splitter parity check failed.');
  }
  if (!(C.contained === 'true' && C.painted && C.errors.length === 0)) {
    console.error('   non-default source (water-counter) did NOT render when initial=tip-splitter (B1 regression).');
  }
  process.exit(1);
}
console.log('\n✅ by-source delivery renders + contains identically to its baked twin.');
console.log('✅ non-default source (water-counter) renders correctly over tip-splitter initial (B1 guard green).');
