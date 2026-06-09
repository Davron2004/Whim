// ─────────────────────────────────────────────────────────────────────────────
// Spike-2 adversarial sandbox suite — standalone headless runner (Spike-6 CI seed).
//
// Loads each self-contained page in `pages/` under headless Chromium (which enforces the
// #35 CSP + the iframe sandbox) and asserts the containment invariants. Exit 0 = all held,
// 1 = a regression. NO build step needed — the pages inline CSP + iframe + neutralize +
// probes + react + bundle. Run: `npm install && node runner.mjs`.
//
// IMPORTANT (finding F4): a generated mini-app shares the iframe scope and can FORGE its
// self-reported verdict (the `evil` page does — it posts a fake 999/999). So for the evil
// page this runner does NOT trust the container verdict; it reads the iframe's honest
// on-screen attack report instead. For the legit pages (b/a/reinject) the bundle does not
// tamper, so the trusted in-page probe verdict is authoritative. Desktop Chromium ≠ the
// Android System WebView — this is the per-push fast gate; keep an on-device run on a
// slower cadence (the engine-specific gating was confirmed on-device in Spike 2).
// ─────────────────────────────────────────────────────────────────────────────
import { chromium } from 'playwright';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const PAGES = dirname(fileURLToPath(import.meta.url)) + '/pages';
const pick = (t, re) => { const m = (t || '').match(re); return m ? m[1] : null; };

const browser = await chromium.launch();
const failures = [];
const notes = [];

async function load(file) {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e && e.message || e)));
  await page.goto(pathToFileURL(join(PAGES, file)).href, { waitUntil: 'load', timeout: 20000 });
  await page.waitForFunction(() => {
    const t = document.title || '';
    const d = (document.getElementById('delivery') || {}).textContent || '—';
    return t !== 'WHIM_SPIKE2:pending' || d !== '—';
  }, { timeout: 12000 }).catch(() => {});
  await page.waitForTimeout(1200);
  const dom = await page.evaluate(() => ({
    status: (document.getElementById('status') || {}).textContent || '',
    probes: (document.getElementById('probes') || {}).textContent || '',
    delivery: (document.getElementById('delivery') || {}).textContent || '',
  }));
  // honest report lives INSIDE the cross-origin iframe (the app's render)
  let iframeText = '';
  for (const f of page.frames()) {
    try { const t = await f.evaluate(() => { const r = document.getElementById('whim-root'); return r ? r.innerText : null; }); if (t) iframeText = t; } catch {}
  }
  await page.close();
  return { dom, iframeText, errors };
}

function expectContained(label, r) {
  const contained = pick(r.dom.probes, /contained=(true|false)/);
  const negCtl = pick(r.dom.probes, /negativeControlCaughtBreach=(true|false)/);
  const delivLeak = pick(r.dom.probes, /deliveryLeakCaught=(true|false)/);
  const frac = pick(r.dom.status, /(\d+\/\d+) probes pass/);
  const ok = contained === 'true' && negCtl === 'true' && delivLeak === 'true' && !r.errors.length;
  (ok ? notes : failures).push(`${ok ? 'PASS' : 'FAIL'} ${label}: contained=${contained} ${frac || '?'} negCtl=${negCtl} delivLeak=${delivLeak}${r.errors.length ? ' ERRORS=' + r.errors.join('|') : ''}`);
  return { contained, frac };
}

console.log('Spike-2 adversarial suite (headless Chromium)\n');

// 1. channel (b) lead + 2. channel (a) fallback — full T1–T7 trusted probe suite must pass
expectContained('b-h1b (lead, T1–T7)', await load('channel-b.h1b.html'));
expectContained('a-h1b (fallback)', await load('channel-a.h1b.html'));

// 3. T7 re-injection: containment must still hold; persistence is a documented FINDING
const re = await load('channel-b.reinject.html');
expectContained('reinject (T7, gen 2)', re);
const t7 = pick(re.dom.probes, /T7[^]*?anyPoison=(true|false)/) || pick(re.dom.status, /anyPoison=(true|false)/);
notes.push(`NOTE reinject T7: anyPoison=${t7 ?? '?'} (finding — gen-1 pollution persists into gen-2 → re-injection must reset/re-harden the realm, Spike 8)`);

// 4. F4 demo: the evil app FORGES the verdict — do NOT trust the container; read its honest
//    on-screen report and assert no attack actually succeeded ("DID-NOT-THROW").
const evil = await load('channel-b.evil.html');
const forged = pick(evil.dom.status, /(\d+\/\d+) probes pass/);
const escaped = /DID-NOT-THROW/.test(evil.iframeText);
(escaped ? failures : notes).push(`${escaped ? 'FAIL' : 'PASS'} evil (F4): honest report shows ${escaped ? 'AN ESCAPE' : 'all attacks blocked'}; container verdict ${forged} is FORGED (ignore) — proves the harness must not trust bundle self-reports`);

// 5. blob-refusal invariant: under the unmodified CSP the blob: script must be REFUSED
const c = await load('channel-c.unmodified.html');
const refused = /accepted":\s*false/.test(c.dom.delivery) || /refus/i.test(c.dom.delivery);
const ranProbes = pick(c.dom.probes, /contained=(true|false)/);
(refused && !ranProbes ? notes : failures).push(`${refused && !ranProbes ? 'PASS' : 'FAIL'} c-unmodified: blob ${refused ? 'REFUSED (CSP held)' : 'NOT refused'}${ranProbes ? ' — bundle RAN (CSP breach!)' : ''}`);

await browser.close();

console.log(notes.join('\n'));
if (failures.length) { console.log('\n' + failures.join('\n')); console.log(`\n❌ ${failures.length} invariant regression(s).`); process.exit(1); }
console.log('\n✅ All Spike-2 containment invariants held.');
