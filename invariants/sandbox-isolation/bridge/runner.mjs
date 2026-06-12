// ─────────────────────────────────────────────────────────────────────────────
// capability-bridge invariant suite (Decision #41, D8 / tasks 5.2 / 5.3). The per-push gate
// for the BRIDGE security properties, alongside the sandbox-containment suite. Headless
// Chromium runs the REAL sandbox delivering a REAL hostile bundle over the REAL syscall
// transport; the host end is a Node shim built from the SAME gate/dispatcher/registry modules
// the RN host uses, over a REAL node:sqlite :memory: engine (host-shim.ts), exposed to the page
// via Playwright. So these are genuinely end-to-end — the bundle is real, the sandbox is real,
// the bridge is real, the engine is real; only "RN host" is stood in for by "Node host".
//
// Scenarios: storage-reachable round-trip · undeclared-capability denial · stub-authority probe
// · forged-sysret inertness · stale-generation drop · sql-injector end-to-end · + a NEGATIVE
// CONTROL (a deliberately misconfigured gate that grants undeclared capabilities MUST be flagged
// red — proving the suite is not vacuously green).
//
// Run: `npm run build && npm run bridge:invariants`. Exit 0 = all held, 1 = regression.
import { chromium } from 'playwright';
import { build as esbuild } from 'esbuild';
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { buildSrcdoc, buildOuterHtml } from '../../../build/assemble.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..');
const PAGES = join(HERE, '.build-pages');

// Bundle the TS host shim to a temp ESM and import it (the storage:test runner idiom — keeps
// the real gate/dispatcher/engine modules as the host, no re-implementation).
const shimOut = join(ROOT, `.bridge-host-shim.${process.pid}.tmp.mjs`);
await esbuild({
  entryPoints: [join(HERE, 'host-shim.ts')],
  outfile: shimOut, bundle: true, platform: 'node', format: 'esm', target: 'node20', logLevel: 'warning',
});
const { makeHost } = await import(pathToFileURL(shimOut).href);

const artifacts = JSON.parse(await readFile(join(ROOT, 'src/runtime/generated/runtime-artifacts.json'), 'utf8'));
const { parts, bundles, appRecords } = artifacts;
const srcdocB = buildSrcdoc({ parts, channel: 'b' });

const failures = [];
const notes = [];
const record = (ok, label, detail) => (ok ? notes : failures).push(`${ok ? 'PASS' : 'FAIL'} ${label}: ${detail}`);

async function writePage(name, html) {
  await mkdir(PAGES, { recursive: true });
  const p = join(PAGES, name + '.html');
  await writeFile(p, html);
  return p;
}
async function appFrame(page) {
  for (const f of page.frames()) {
    try { if (await f.evaluate(() => typeof window.__WHIM_VC_SDK__ !== 'undefined')) return f; } catch {}
  }
  return null;
}
async function iframeText(page) {
  for (const f of page.frames()) {
    try { const t = await f.evaluate(() => { const r = document.getElementById('whim-root'); return r ? r.innerText : null; }); if (t) return t; } catch {}
  }
  return '';
}

/** Build a fresh page + Node host for one app, deliver it (syscalls routed to the exposed host),
 *  let it settle, optionally drive/evaluate, and return what was observed. */
async function scenario(name, appName, opts = {}) {
  const app = appRecords[appName];
  if (!app) throw new Error(`no app record for ${appName} (rebuild?)`);
  const host = makeHost(app, opts.manifestOverride);
  const page = await chromiumBrowser.newPage();
  const console_ = [];
  page.on('console', (m) => console_.push(m.text()));
  await page.exposeFunction('whimHostDispatch', host.dispatch);
  const html = buildOuterHtml({ srcdoc: srcdocB, bundles: { [appName]: bundles[appName] }, initial: appName, channel: 'b', syscallSink: 'exposed' });
  const file = await writePage(name, html);
  await page.goto(pathToFileURL(file).href, { waitUntil: 'load', timeout: 20000 });
  await page.waitForTimeout(opts.settle ?? 900); // let the bundle mount + run its useEffect syscalls
  if (opts.drive) await opts.drive(page);
  const text = await iframeText(page);
  const extra = opts.evaluate ? await opts.evaluate(page) : null;
  await page.close();
  return { text, console: console_, extra, host };
}

console.log('Whim capability-bridge invariant suite — headless Chromium + Node host shim\n');
const chromiumBrowser = await chromium.launch();

// 1. STORAGE REACHABLE ONLY AS SYSCALLS — water-counter round-trips a tap through the bridge.
{
  const r = await scenario('wc-roundtrip', 'water-counter', {
    drive: async (page) => {
      for (const f of page.frames()) { try { const b = await f.$('button'); if (b) { await b.click(); break; } } catch {} }
      await page.waitForTimeout(500);
    },
  });
  const loaded = /loaded from storage|saved/.test(r.text);
  const saved = /saved/.test(r.text);
  const noFail = !/load failed|save failed/.test(r.text);
  const counted = /Glasses[\s\S]*\b1\b/.test(r.text);
  const ok = loaded && saved && noFail && counted;
  record(ok, 'storage reachable as syscalls (water-counter)', `loaded=${loaded} saved=${saved} count→1=${counted} noFail=${noFail}`);
}

// 2. UNDECLARED-CAPABILITY DENIAL — cap-intruder (declares nothing) is refused, structured.
{
  const r = await scenario('cap-denial', 'cap-intruder');
  const denied = /undeclared_capability/.test(r.text);
  const notWritten = !/NOT DENIED/.test(r.text);
  record(denied && notWritten, 'undeclared-capability denial (structured)', `kind-shown=${denied} notWritten=${notWritten}`);
}

// 3. STUB-AUTHORITY PROBE — nothing reachable from the storage facade / __whimSyscall grants
//    more than the ability to post a string (constraint #2, extended to the new surface). NB:
//    the CSP/codegen leg is covered in-page by probes.js — here we can't test it via Playwright
//    evaluate (CDP runs outside the page CSP), so this probe is strictly about REACHABILITY: a
//    walk of everything reachable from the facade must surface no engine/host/native reference.
{
  const r = await scenario('stub-authority', 'water-counter', {
    evaluate: async (page) => {
      const f = await appFrame(page);
      return f ? f.evaluate(() => {
        const sdk = window.__WHIM_VC_SDK__ || {};
        const storage = sdk.storage;
        const sys = window.__whimSyscall || {};
        // Walk own-property closure of the facade + the transport; flag anything that smells
        // like an escalation (an engine handle, a host object, a native bridge, a raw window).
        const SUSPECT = /engine|^host$|native|sqlite|ReactNativeWebView|contentWindow|require|process/i;
        const seen = new Set();
        let leak = null;
        (function walk(obj, path, depth) {
          if (leak || obj === null || depth > 4) return;
          const t = typeof obj;
          if (t !== 'object' && t !== 'function') return;
          if (seen.has(obj)) return;
          seen.add(obj);
          for (const k of Object.getOwnPropertyNames(obj)) {
            if (SUSPECT.test(k)) { leak = path + '.' + k; return; }
            let v;
            try { v = obj[k]; } catch (e) { continue; }
            if (v === window || v === window.parent || v === window.top) { leak = path + '.' + k + ' (window ref)'; return; }
            walk(v, path + '.' + k, depth + 1);
          }
        })(storage, 'storage', 0);
        const verbsAreFns = typeof storage.kv.get === 'function' && typeof storage.records.append === 'function';
        return { storageType: typeof storage, syscallKeys: Object.keys(sys).sort(), verbsAreFns, leak };
      }) : null;
    },
  });
  const e = r.extra || {};
  const ok = e.storageType === 'object' && JSON.stringify(e.syscallKeys) === '["call"]' && e.verbsAreFns === true && !e.leak;
  record(ok, 'stub-authority (no escalation beyond the transport)', JSON.stringify(e));
}

// 4. FORGED-SYSRET INERTNESS — a sysret the bundle posts to its OWN window cannot resolve a
//    stub promise; the real host answer wins (host-channel-only acceptance, ev.source check).
{
  const r = await scenario('forged-sysret', 'water-counter', {
    evaluate: async (page) => {
      const f = await appFrame(page);
      return f ? f.evaluate(async () => {
        for (let id = 1; id <= 8; id++) {
          window.postMessage(JSON.stringify({ whim: 'sysret', v: 1, id, ok: true, result: { found: true, value: 'ATTACKER' } }), '*');
        }
        await window.__whimSyscall.call('storage.kv.set', { key: 'probe', value: 'REAL' });
        const got = await window.__whimSyscall.call('storage.kv.get', { key: 'probe' });
        return got; // { found, value }
      }) : null;
    },
  });
  const value = r.extra && r.extra.value;
  const ok = value === 'REAL';
  record(ok, 'forged sysret is inert (host answer wins)', `resolved value=${JSON.stringify(value)} (want "REAL", not "ATTACKER")`);
}

// 5. STALE-GENERATION DROP — over the real exposed dispatcher: a frame stamped with a prior
//    generation is dropped (null); a current-generation frame answers.
{
  const r = await scenario('stale-gen', 'water-counter', {
    evaluate: async (page) => page.evaluate(async () => {
      const stale = JSON.stringify({ whim: 'syscall', v: 1, id: 9101, gen: 0, method: 'storage.kv.get', params: { key: 'total' } });
      const fresh = JSON.stringify({ whim: 'syscall', v: 1, id: 9102, gen: 1, method: 'storage.kv.get', params: { key: 'total' } });
      return { stale: await window.whimHostDispatch(stale), fresh: await window.whimHostDispatch(fresh) };
    }),
  });
  const e = r.extra || {};
  const ok = e.stale === null && typeof e.fresh === 'string' && /"whim":"sysret"/.test(e.fresh);
  record(ok, 'stale-generation frame dropped', `stale=${e.stale === null ? 'dropped' : 'NOT dropped'} fresh=${typeof e.fresh === 'string' ? 'answered' : 'no answer'}`);
}

// 6. SQL INJECTOR END-TO-END — a hostile bundle drives the real verbs with adversarial input
//    over the real path; values are inert, crafted identifiers rejected, only its own store.
{
  const r = await scenario('sql-injector', 'sql-injector', { settle: 1500 });
  const zero = /INJECTIONS LANDED: 0/.test(r.text);
  const collRejected = /crafted collection: rejected: unknown_collection/.test(r.text);
  const fieldRejected = /crafted (append|where|orderBy) field: rejected: unknown_field/.test(r.text);
  const ok = zero && collRejected && fieldRejected;
  record(ok, 'sql-injector end-to-end (values inert, identifiers rejected)', `landed0=${zero} collRej=${collRejected} fieldRej=${fieldRejected}`);
}

// 7. NEGATIVE CONTROL — a deliberately MISCONFIGURED gate (host-held manifest grants `storage`
//    to the cap-intruder, which declares nothing) MUST let the undeclared write through. The
//    suite "passes" the control iff it OBSERVES that breach — proving scenario 2 is not vacuous.
{
  const r = await scenario('neg-control', 'cap-intruder', { manifestOverride: ['storage'] });
  const breachObserved = /NOT DENIED/.test(r.text);
  record(breachObserved, 'negative control (broken gate must be flagged)', breachObserved
    ? 'correctly FLAGGED: a misconfigured gate let an undeclared capability through'
    : 'did NOT observe the breach (the suite would be vacuous!)');
}

await chromiumBrowser.close();
await rm(shimOut, { force: true });

console.log(notes.join('\n'));
if (failures.length) {
  console.log('\n' + failures.join('\n'));
  console.log(`\n❌ ${failures.length} capability-bridge invariant regression(s).`);
  process.exit(1);
}
console.log(`\n✅ All capability-bridge invariants held (${notes.filter((n) => n.startsWith('PASS')).length} checks).`);
