// ─────────────────────────────────────────────────────────────────────────────
// Whim §16.2 isolation suite — runs the RETAINED runtime (the productionized
// neutralize/resolver/probes/loader + the real SDK + the real esbuild bundles) under
// headless Chromium (which enforces the #35 CSP + the iframe sandbox) and asserts the
// never-regress containment invariants. THIS is the promotion (task 7.1): the spike's
// probe checklist + adversarial T1–T7/F4, now exercised against THIS build — not the
// spike's self-contained copies. Desktop is the FAST FILTER, not the acceptance (no native
// bridge; different engine) — the authoritative pass is on-device (§8).
//
// Run: `npm run build && npm run invariants`. Exit 0 = all invariants held, 1 = regression.
import { chromium } from 'playwright';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { buildSrcdoc, buildOuterHtml } from '../../build/assemble.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const PAGES = join(HERE, '.build-pages');

const artifacts = JSON.parse(await readFile(join(ROOT, 'src/runtime/generated/runtime-artifacts.json'), 'utf8'));
const { parts, bundles } = artifacts;

const failures = [];
const notes = [];
const pick = (t, re) => { const m = (t || '').match(re); return m ? m[1] : null; };

async function writePage(name, html) {
  await mkdir(PAGES, { recursive: true });
  const p = join(PAGES, name + '.html');
  await writeFile(p, html);
  return p;
}

// Load a page, optionally drive a re-injection after generation 1, return DOM + console + iframe text.
async function run(browser, file, { drive } = {}) {
  const page = await browser.newPage();
  const console_ = [];
  const errors = [];
  page.on('console', (m) => console_.push(m.text()));
  page.on('pageerror', (e) => errors.push(String((e && e.message) || e)));
  await page.goto(pathToFileURL(file).href, { waitUntil: 'load', timeout: 20000 });
  // wait for the first verdict (or a delivery resolution for the blob/refusal case)
  await page.waitForFunction(() => {
    const t = document.title || '';
    const d = (document.getElementById('delivery') || {}).textContent || '—';
    return t !== 'WHIM:pending' || /refus|REJECTED|BLOB/i.test(d);
  }, { timeout: 12000 }).catch(() => {});
  if (drive) { await drive(page); }
  await page.waitForTimeout(500);
  const dom = await page.evaluate(() => ({
    title: document.title || '',
    status: (document.getElementById('status') || {}).textContent || '',
    probes: (document.getElementById('probes') || {}).textContent || '',
    delivery: (document.getElementById('delivery') || {}).textContent || '',
    paint: (document.getElementById('paint') || {}).textContent || '',
  }));
  let iframeText = '';
  for (const f of page.frames()) {
    try { const t = await f.evaluate(() => { const r = document.getElementById('whim-root'); return r ? r.innerText : null; }); if (t) iframeText = t; } catch {}
  }
  await page.close();
  return { dom, console: console_, errors, iframeText };
}

function record(ok, label, detail) {
  (ok ? notes : failures).push(`${ok ? 'PASS' : 'FAIL'} ${label}: ${detail}`);
}

// ── assemble the scenario pages from THIS runtime ──────────────────────────────
const srcdocB = buildSrcdoc({ parts, channel: 'b' });
const srcdocA = buildSrcdoc({ parts, channel: 'a', bakedBundle: bundles['tip-splitter'] });
const srcdocBroken = srcdocB.replace("script-src 'unsafe-inline'", "script-src 'unsafe-inline' 'unsafe-eval'");

const pages = {
  'b-tip': buildOuterHtml({ srcdoc: srcdocB, bundles: { 'tip-splitter': bundles['tip-splitter'] }, initial: 'tip-splitter', channel: 'b' }),
  'a-tip': buildOuterHtml({ srcdoc: srcdocA, bundles: {}, initial: 'tip-splitter', channel: 'a', autostart: false }),
  'b-evil': buildOuterHtml({ srcdoc: srcdocB, bundles: { evil: bundles['evil'] }, initial: 'evil', channel: 'b' }),
  'b-reinject': buildOuterHtml({ srcdoc: srcdocB, bundles: { poison: bundles['poison'], victim: bundles['victim'] }, initial: 'poison', channel: 'b' }),
  'b-timer': buildOuterHtml({ srcdoc: srcdocB, bundles: { 'timer-ticker': bundles['timer-ticker'], victim: bundles['victim'] }, initial: 'timer-ticker', channel: 'b' }),
  'c-blob': buildOuterHtml({ srcdoc: srcdocB, bundles: { 'tip-splitter': bundles['tip-splitter'] }, initial: 'tip-splitter', channel: 'c' }),
  'broken': buildOuterHtml({ srcdoc: srcdocBroken, bundles: { 'tip-splitter': bundles['tip-splitter'] }, initial: 'tip-splitter', channel: 'b' }),
};
const files = {};
for (const [name, html] of Object.entries(pages)) files[name] = await writePage(name, html);

console.log('Whim §16.2 isolation suite — headless Chromium, against the RETAINED build\n');
const browser = await chromium.launch();

// 1. channel (b) lead — tip splitter CONTAINED + rendered + paint measured + TAP round-trips
//    to the host (§5.2): clicking the in-iframe button posts a UI-event string the host relays.
{
  const r = await run(browser, files['b-tip'], {
    drive: async (page) => {
      for (const f of page.frames()) {
        try { const btn = await f.$('button'); if (btn) { await btn.click(); break; } } catch {}
      }
      await page.waitForTimeout(200);
    },
  });
  const contained = pick(r.dom.probes, /contained=([a-z]+)/);
  const frac = pick(r.dom.status, /([0-9]+\/[0-9]+) probes/);
  const negCtl = pick(r.dom.probes, /negCtl=([a-z]+)/);
  const delivLeak = pick(r.dom.probes, /deliveryLeakCaught=([a-z]+)/);
  const painted = /Tip Splitter/.test(r.iframeText) && /Per person/.test(r.iframeText);
  const paintMs = pick(r.dom.paint, /mountToFirstPaintMs"?\s*:?\s*([\d.]+)/);
  const tapReached = r.console.some((l) => /UI-EVENT press/.test(l)); // the round-trip
  const ok = contained === 'true' && negCtl === 'true' && delivLeak === 'true' && painted && tapReached && !r.errors.length;
  record(ok, 'b-tip (channel b: render + contain + tap round-trip)', `contained=${contained} ${frac} negCtl=${negCtl} delivLeak=${delivLeak} painted=${painted} tap→host=${tapReached} paint≈${paintMs}ms${r.errors.length ? ' ERRORS=' + r.errors.join('|') : ''}`);
}

// 2. channel (a) fallback — pre-baked parser-inserted bundle still CONTAINED + rendered.
{
  const r = await run(browser, files['a-tip']);
  const contained = pick(r.dom.probes, /contained=(true|false)/);
  const painted = /Tip Splitter/.test(r.iframeText);
  const ok = contained === 'true' && painted && !r.errors.length;
  record(ok, 'a-tip (channel a fallback)', `contained=${contained} painted=${painted}${r.errors.length ? ' ERRORS=' + r.errors.join('|') : ''}`);
}

// 3. F4 — a malicious bundle forges its verdict + spoofs control frames. The host must REJECT
//    the unauthenticated frame (nonce auth, constraint #4) and the TRUSTED-vantage verdict
//    (closure-captured probes, constraint #3) must still show CONTAINED.
{
  const r = await run(browser, files['b-evil']);
  const contained = pick(r.dom.probes, /contained=(true|false)/);
  const rejectedForgery = r.console.some((l) => /REJECTED-FORGERY kind=probes/.test(l));
  const rejectedSpoof = r.console.some((l) => /REJECTED-FORGERY kind=spoof-probe/.test(l));
  const honestBlocked = !/DID-NOT-THROW/.test(r.iframeText); // the app's own honest report shows attacks blocked
  const ok = contained === 'true' && rejectedForgery && rejectedSpoof && honestBlocked && !r.errors.length;
  record(ok, 'b-evil (F4 verdict-spoof)', `trusted-verdict contained=${contained} forgedProbesRejected=${rejectedForgery} forgedSpoofRejected=${rejectedSpoof} honestReportBlocked=${honestBlocked}`);
}

// 3b. A1 — loader.js host-channel-only acceptance (ev.source guard). A bundle sharing the realm
//     can window.postMessage a forged __whimDeliver: WITHOUT the guard the loader bumps
//     __whimGeneration, injects the payload as a DOM <script>, and posts a 'delivery' frame
//     carrying the closure-captured REAL nonce (indistinguishable to the host) — a host-state
//     integrity violation (no escape, but the generation machine is corrupted). The self-post
//     comes from the iframe's OWN window (ev.source === window, not window.parent), so the guard
//     must drop it. NON-VACUITY: a legitimate host re-injection (posted by the parent, ev.source
//     === parent) MUST still be accepted and bump the generation — proving the guard discriminates
//     by source, not a dead "drop everything" that would also pass the blocked-assertions.
{
  const page = await browser.newPage();
  const aerr = [];
  page.on('pageerror', (e) => aerr.push(String(e?.message || e)));
  await page.goto(pathToFileURL(files['b-tip']).href, { waitUntil: 'load', timeout: 20000 });
  await page.waitForFunction(() => (document.title || '') !== 'WHIM:pending', { timeout: 12000 }).catch(() => {});
  // The sandboxed app frame runs the loader → it is the frame exposing window.__whimGeneration.
  const appFrame = async () => {
    for (const fr of page.frames()) {
      try { if (await fr.evaluate(() => typeof globalThis.__whimGeneration === 'number')) return fr; } catch {}
    }
    return null;
  };
  let f = await appFrame();
  const genBefore = f ? await f.evaluate(() => globalThis.__whimGeneration) : null;
  // ATTACK: from bundle/iframe scope (ev.source === window) self-post a forged delivery + host-init.
  if (f) await f.evaluate(() => {
    globalThis.postMessage(JSON.stringify({ __whimDeliver: true, bundle: 'globalThis.__WHIM_SELFPOST_RAN=true;' }), '*'); // NOSONAR - deliberate self-post inside an opaque srcdoc iframe.
    globalThis.postMessage(JSON.stringify({ __whimHostInit: true, nonce: 'evil' }), '*'); // NOSONAR - deliberate self-post inside an opaque srcdoc iframe.
  });
  await page.waitForTimeout(300);
  f = await appFrame();
  const after = f ? await f.evaluate(() => ({ gen: globalThis.__whimGeneration, ran: !!globalThis.__WHIM_SELFPOST_RAN })) : { gen: null, ran: true };
  // CONTROL: a real host re-injection (parent → ev.source === parent) must still bump the generation.
  await page.evaluate(() => globalThis.__whimControl.reinject({ reset: false, bundle: 'tip-splitter' })).catch(() => {});
  await page.waitForTimeout(400);
  f = await appFrame();
  const genAfterLegit = f ? await f.evaluate(() => globalThis.__whimGeneration) : null;
  await page.close();

  const selfPostBlocked = genBefore !== null && after.gen === genBefore && after.ran === false;
  const legitStillWorks = genAfterLegit !== null && genBefore !== null && genAfterLegit > genBefore;
  const ok = selfPostBlocked && legitStillWorks && !aerr.length;
  record(ok, 'A1 (self-posted __whimDeliver/__whimHostInit ignored; ev.source guard)',
    `selfPost: genBefore=${genBefore} genAfter=${after.gen} (must be equal) selfpostScriptRan=${after.ran} (must be false) · legit reinject genAfter=${genAfterLegit} (must be > ${genBefore}, proves the guard is not a dead drop-all)${aerr.length ? ' ERRORS=' + aerr.join('|') : ''}`);
}

// 4. realm-reset seam (constraint #5) — re-create the iframe between generations → gen-2 sees
//    a CLEAN realm (no gen-1 poison). Drive a RESET re-injection of the victim after poison.
{
  const r = await run(browser, files['b-reinject'], {
    drive: async (page) => {
      // G6 (deterministic reset-seam sync): wait for the PRE-reset (poison) verdict to land, snapshot
      // the PARENT-owned verdict counter, then reset+reinject the victim and wait for a NEW verdict —
      // the victim's own post-reset probes. verdictSeq lives in the outer page so it survives the
      // iframe recreation; the realm-local "gen N" display resets to 1 and can't distinguish pre- from
      // post-reset (why the old `/gen 1/` wait + fixed 1200ms sleep were an ambiguous race). No sleep now.
      await page.waitForFunction(() => globalThis.__whimControl && globalThis.__whimControl.verdictSeq >= 1, { timeout: 8000 }).catch(() => {});
      const v0 = await page.evaluate(() => globalThis.__whimControl?.verdictSeq || 0);
      await page.evaluate(() => globalThis.__whimControl.reinject({ reset: true, bundle: 'victim' }));
      await page.waitForFunction((n) => globalThis.__whimControl && globalThis.__whimControl.verdictSeq > n, { timeout: 8000 }, v0).catch(() => {});
    },
  });
  const anyPoison = pick(r.dom.probes, /anyPoison=(true|false)/);
  const contained = pick(r.dom.probes, /contained=(true|false)/);
  // after a reset the realm is fresh → gen counter restarts at 1; the key assertion is the
  // victim sees NO gen-1 poison.
  const cleanRealm = /realm appears clean|no generation-1 pollution|backdoor visible: false/i.test(r.iframeText) || anyPoison === 'false';
  const ok = contained === 'true' && cleanRealm;
  record(ok, 'reset re-injection (constraint #5 seam)', `contained=${contained} gen-2 realm clean=${cleanRealm} (anyPoison=${anyPoison})`);
}

// 5. T7 finding (informational) — SAME-realm re-injection WITHOUT reset lets gen-1 poison
//    persist into gen-2. This is a FINDING, not a containment failure (persistence ≠ escape):
//    contained must still be true; anyPoison documents why the reset path above is required.
{
  const r = await run(browser, files['b-reinject'], {
    drive: async (page) => {
      await page.waitForFunction(() => /gen 1/.test((document.getElementById('status') || {}).textContent || ''), { timeout: 8000 }).catch(() => {});
      await page.evaluate(() => globalThis.__whimControl.reinject({ reset: false, bundle: 'victim' }));
      await page.waitForFunction(() => /gen 2/.test((document.getElementById('status') || {}).textContent || ''), { timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(400);
    },
  });
  const anyPoison = pick(r.dom.probes, /anyPoison=(true|false)/);
  const contained = pick(r.dom.probes, /contained=(true|false)/);
  const ok = contained === 'true'; // containment holds even in a poisoned realm
  record(ok, 'same-realm re-injection (T7 finding)', `contained=${contained} (persistence ≠ escape); anyPoison=${anyPoison} → reset IS required (constraint #5)`);
  notes.push(`NOTE T7: same-realm gen-2 anyPoison=${anyPoison} (expected true; the reset seam above is what prevents it)`);
}

// 5b. INV-TIMER (effects-and-cues task 7.1, timer teardown) — a gen-1 SDK `interval` can never
//     tick into gen-2 after a realm reset. The timer-ticker fixture marks each tick observably by
//     posting `timertick:<n>` over the one-way transport; the OUTER PAGE relays it and logs
//     `UI-EVENT press timertick:<n>`, which we read HERE with a wall-clock timestamp — the TRUSTED
//     VANTAGE (F4), never the bundle's self-report. The bundle makes NO generation claim: the
//     parent owns the reset boundary and classifies ticks by arrival time.
//
//     Drive a RESET re-injection (iframe recreation, carry-forward #5) that delivers a DIFFERENT,
//     SILENT bundle (the victim) as gen-2. Destroying gen-1's browsing context destroys its timer
//     queue (design D2), so ZERO `timertick` frames may arrive past the boundary — any that did
//     would be a surviving gen-1 timer (gen-2 never ticks). A SAME-REALM, NO-RESET control proves
//     non-vacuity: there, ticks DO continue past the boundary, so the silence in the reset case is
//     genuine teardown, not a dead detector.
async function runTimerTeardown(reset) {
  const TICK = /UI-EVENT press timertick:(\d+)/;
  const ticks = []; // { n, t } in arrival order, each with a monotonic timestamp
  const page = await browser.newPage();
  page.on('console', (m) => { const mm = TICK.exec(m.text() || ''); if (mm) ticks.push({ n: Number(mm[1]), t: Date.now() }); });
  await page.goto(pathToFileURL(files['b-timer']).href, { waitUntil: 'load', timeout: 20000 });
  // Let the gen-1 ticker run (40 ms interval → ~10 ticks in 450 ms).
  await page.waitForFunction(() => /Timer Ticker|gen 1/.test(document.getElementById('status')?.textContent || ''), { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(500);
  const preResetBoundary = Date.now();
  // RESET → recreate the iframe, deliver the SILENT victim as gen-2 (the invariant case).
  // NO-RESET → re-inject the SAME ticker into the SAME realm (the non-vacuity control: ticks go on).
  await page.evaluate((doReset) => globalThis.__whimControl.reinject(doReset
    ? { reset: true, generation: 2, bundle: 'victim' }
    : { reset: false, bundle: 'timer-ticker' }), reset);
  // The reset boundary is after the host-side iframe recreation has synchronously completed.
  // A normal gen-1 tick can arrive between "decide to reset" and actual removal on slow CI;
  // do not classify that pre-removal tick as a teardown leak.
  const boundary = Date.now();
  const before = ticks.filter((x) => x.t <= preResetBoundary).length;
  // Give a surviving gen-1 timer ample time to fire (it must not, in the reset case).
  await page.waitForTimeout(700);
  await page.close();
  const after = ticks.filter((x) => x.t > boundary).length;
  return { before, after };
}
{
  const torn = await runTimerTeardown(true);   // the invariant: reset → silence
  const ctrl = await runTimerTeardown(false);  // non-vacuity: no reset → ticks continue
  const sawGen1 = torn.before > 0;             // detector observed gen-1 ticks at all
  const detectorLive = ctrl.after > 0;         // without a reset, ticks DO cross the boundary
  const cleanTeardown = torn.after === 0;      // with a reset, ZERO ticks cross it
  const ok = sawGen1 && cleanTeardown && detectorLive;
  let timerVerdict = 'LEAK — a gen-1 interval ticked past the reset boundary into gen-2';
  if (ok) timerVerdict = 'gen-1 timer torn down by iframe recreation; detector non-vacuous (no-reset control keeps ticking)';
  else if (!sawGen1) timerVerdict = 'VACUOUS — never observed a gen-1 tick (detector dead)';
  else if (!detectorLive) timerVerdict = 'VACUOUS — no-reset control did not keep ticking (cannot distinguish teardown from dead detector)';
  record(ok, 'INV-TIMER (gen-1 interval dead after realm reset)',
    `reset: ticks before=${torn.before} after=${torn.after} (must be 0) · no-reset control after=${ctrl.after} (must be >0) → ` +
    timerVerdict);
}

// 6. blob/data REFUSAL invariant (task 4.5) — a blob: <script src> stays REFUSED under the
//    locked CSP; the bundle never runs (no verdict). Never widen script-src to "fix" this.
{
  const r = await run(browser, files['c-blob']);
  const refused = /refused":\s*true|refused by CSP/i.test(r.dom.delivery);
  const ranProbes = pick(r.dom.probes, /contained=(true|false)/);
  const ok = refused && !ranProbes;
  record(ok, 'c-blob (CSP refusal invariant)', `blob ${refused ? 'REFUSED (CSP held)' : 'NOT refused'}${ranProbes ? ' — bundle RAN (CSP breach!)' : ' — bundle did not run'}`);
}

// 7. NEGATIVE CONTROL (task 8.3) — deliberately weaken the CSP (add 'unsafe-eval'). The suite
//    MUST flag it red. If this page reports CONTAINED, the suite is vacuously green and useless.
{
  const r = await run(browser, files['broken']);
  const contained = pick(r.dom.probes, /contained=(true|false)/);
  const flagged = contained === 'false';
  record(flagged, 'broken-CSP negative control (suite must FAIL it)', `contained=${contained} → suite ${flagged ? 'correctly FLAGGED the breach' : 'DID NOT flag it (suite is vacuous!)'}`);
}

await browser.close();

console.log(notes.join('\n'));
if (failures.length) {
  console.log('\n' + failures.join('\n'));
  console.log(`\n❌ ${failures.length} invariant regression(s).`);
  process.exit(1);
}
console.log(`\n✅ All §16.2 isolation invariants held against the retained build (${notes.filter((n) => n.startsWith('PASS')).length} checks).`);
