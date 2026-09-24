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
// · forged-sysret inertness · sql-injector end-to-end · trusted paint forwarding · INV-CUEGATE
// · INV-ERRFRAME (post-paint handler throw / unhandled rejection → trusted error frame) · + a NEGATIVE
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

// Suite-local fixtures (owner-authored, under ./fixtures): compiled here with the SAME options
// as build/build.mjs's bundleApp (single IIFE, classic JSX, `tsconfigRaw: '{}'`, vc-sdk/react
// externals) so they obey the bundle contract without joining the product build's APPS.
async function bundleLocalFixture(appId, file, name) {
  const out = await esbuild({
    entryPoints: [join(HERE, 'fixtures', file)],
    bundle: true, format: 'iife', globalName: '__WHIM_APP_MODULE__',
    platform: 'browser', target: 'es2019',
    tsconfigRaw: '{}',
    jsx: 'transform', jsxFactory: 'React.createElement', jsxFragment: 'React.Fragment',
    inject: [join(ROOT, 'build/react-inject-shim.ts')],
    external: ['vc-sdk', 'react', 'react-dom', 'react-dom/client'],
    minify: false, write: false, logLevel: 'warning',
  });
  bundles[appId] = out.outputFiles[0].text;
  appRecords[appId] = { appId, name, manifest: { capabilities: [] }, schemaArtifact: undefined };
}
await bundleLocalFixture('error-raiser', 'error-raiser.app.tsx', 'Error Raiser');

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
    try { if (await f.evaluate(() => globalThis.__WHIM_VC_SDK__ !== undefined)) return f; } catch {}
  }
  return null;
}
async function iframeText(page) {
  for (const f of page.frames()) {
    try { const t = await f.evaluate(() => { const r = document.getElementById('whim-root'); return r ? r.innerText : null; }); if (t) return t; } catch {}
  }
  return '';
}

/** Waits until the app has rendered and the host has answered no new syscall for 250 ms (or
 *  `until(text)` holds), bounded by `budgetMs`. Replaces a fixed settle sleep. */
async function settled(page, host, budgetMs, until) {
  const deadline = Date.now() + budgetMs;
  let seen = -1;
  let quietSince = Date.now();
  while (Date.now() < deadline) {
    if (host.sysrets.length !== seen) {
      seen = host.sysrets.length;
      quietSince = Date.now();
    }
    const text = await iframeText(page);
    if (until ? until(text) : text.length > 0 && Date.now() - quietSince >= 250) return;
    await page.waitForTimeout(50);
  }
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
  // Record what the outer page forwards to the RN host, as the WebView would receive it.
  await page.addInitScript(() => {
    globalThis.__rnFrames = [];
    globalThis.ReactNativeWebView = { postMessage: (s) => globalThis.__rnFrames.push(s) };
  });
  // `exposeBinding`, never `exposeFunction` (synthrun/observe.ts, the same hole): the binding is
  // installed in every frame, the sandbox realm included, so only calls from the outer page — the
  // relay that checks `ev.source` first — may reach the host.
  let foreignCalls = 0;
  await page.exposeBinding('whimHostDispatch', (source, raw) => {
    if (source.frame !== page.mainFrame()) {
      foreignCalls++;
      return null;
    }
    return host.dispatch(raw);
  });
  const html = buildOuterHtml({ srcdoc: srcdocB, bundles: { [appName]: bundles[appName] }, initial: appName, channel: 'b', syscallSink: 'exposed' });
  const file = await writePage(name, html);
  await page.goto(pathToFileURL(file).href, { waitUntil: 'load', timeout: 20000 });
  await settled(page, host, opts.settle ?? 5000, opts.until);
  if (opts.drive) await opts.drive(page, host);
  const text = await iframeText(page);
  const extra = opts.evaluate ? await opts.evaluate(page) : null;
  const rnFrames = await page.evaluate(() => globalThis.__rnFrames.map((s) => JSON.parse(s)));
  await page.close();
  return { text, console: console_, extra, host, rnFrames, foreignCalls };
}

console.log('Whim capability-bridge invariant suite — headless Chromium + Node host shim\n');
const chromiumBrowser = await chromium.launch();

// 1. STORAGE REACHABLE ONLY AS SYSCALLS — water-counter round-trips a tap through the bridge.
{
  const r = await scenario('wc-roundtrip', 'water-counter', {
    drive: async (page, host) => {
      const before = host.sysrets.length;
      for (const f of page.frames()) { try { const b = await f.$('button'); if (b) { await b.click(); break; } } catch {} }
      await settled(page, host, 5000, () => host.sysrets.length >= before + 2);
    },
  });
  // Judged on the host side: what the engine holds after the tap, and that every syscall was
  // answered ok. The rendered count only shows the answers made it back into the realm.
  const engine = r.host.realm.engine;
  const stored = engine ? engine.kv.get('total') : undefined;
  const drinks = engine ? engine.records.list('Drinks').length : -1;
  const allOk = r.host.sysrets.length > 0 && r.host.sysrets.every((s) => s.ok);
  const counted = /Glasses[\s\S]*\b1\b/.test(r.text);
  const ok = stored === 1 && drinks === 1 && allOk && counted;
  record(ok, 'storage reachable as syscalls (water-counter)', `engine total=${JSON.stringify(stored)} drinks=${drinks} sysrets=${r.host.sysrets.length} allOk=${allOk} rendered count→1=${counted}`);
}

// 2. UNDECLARED-CAPABILITY DENIAL — cap-intruder (declares nothing) is refused, structured.
{
  const r = await scenario('cap-denial', 'cap-intruder');
  const denied = r.host.sysrets.some((s) => s.error?.kind === 'undeclared_capability');
  const granted = r.host.sysrets.filter((s) => s.ok && s.method?.startsWith('storage.')).length;
  record(denied && granted === 0, 'undeclared-capability denial (structured)', `host answered undeclared_capability=${denied} storage calls granted=${granted} (must be 0)`);
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
        const sdk = globalThis.__WHIM_VC_SDK__ || {};
        const storage = sdk.storage;
        const sys = globalThis.__whimSyscall || {};
        // Walk own-property closure of the facade + the transport; flag anything that smells
        // like an escalation (an engine handle, a host object, a native bridge, a raw window).
        const SUSPECT = /engine|^host$|native|sqlite|ReactNativeWebView|contentWindow|require|process/i;
        const findLeak = (root, rootPath) => {
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
              try { v = obj[k]; } catch { continue; }
              if (v === globalThis || v === globalThis.parent || v === globalThis.top) { leak = path + '.' + k + ' (window ref)'; return; }
              walk(v, path + '.' + k, depth + 1);
            }
          })(root, rootPath, 0);
          return leak;
        };
        const leak = findLeak(storage, 'storage');
        // Negative control: the same walk over the facade with an engine handle planted two levels
        // down must find it, or a clean result above proves nothing.
        const planted = findLeak({ ...storage, kv: { ...storage.kv, _h: { engine: {} } } }, 'planted');
        const verbsAreFns = typeof storage.kv.get === 'function' && typeof storage.records.append === 'function';
        return { storageType: typeof storage, syscallKeys: Object.keys(sys).sort((a, b) => a.localeCompare(b)), verbsAreFns, leak, planted };
      }) : null;
    },
  });
  const e = r.extra || {};
  const ok = e.storageType === 'object' && JSON.stringify(e.syscallKeys) === '["call"]' && e.verbsAreFns === true && !e.leak && e.planted === 'planted.kv._h.engine';
  record(ok, 'stub-authority (no escalation beyond the transport)', JSON.stringify(e));
}

// 3b. A6 — the transport is installed NON-WRITABLE + NON-CONFIGURABLE (syscall.js, mirroring
//     neutralize.js), so a bundle sharing the realm cannot swap __whimSyscall for a shim that
//     captures the params/results flowing through it. We assert the descriptor flags AND that a
//     reassignment attempt leaves it unchanged (CDP's evaluate is sloppy-mode, so the write is a
//     silent no-op rather than a throw — `unchanged` is the robust signal, not `threw`).
{
  const r = await scenario('syscall-immutable', 'water-counter', {
    evaluate: async (page) => {
      const f = await appFrame(page);
      return f ? f.evaluate(() => {
        const before = globalThis.__whimSyscall;
        const d = Object.getOwnPropertyDescriptor(globalThis, '__whimSyscall') || {};
        let threw = false;
        try { globalThis.__whimSyscall = { call: function () { return Promise.resolve('HIJACKED'); } }; }
        catch { threw = true; }
        const unchanged = globalThis.__whimSyscall === before && typeof globalThis.__whimSyscall.call === 'function';
        return { nonWritable: d.writable === false, nonConfigurable: d.configurable === false, unchanged, threw };
      }) : null;
    },
  });
  const a = r.extra || {};
  const ok = a.nonWritable === true && a.nonConfigurable === true && a.unchanged === true;
  record(ok, 'A6 (__whimSyscall non-writable/non-configurable)',
    `writable:false=${a.nonWritable} configurable:false=${a.nonConfigurable} reassignInert=${a.unchanged} (threw=${a.threw}, sloppy CDP → false OK)`);
}

// 4. FORGED-SYSRET INERTNESS — a sysret the bundle posts to its OWN window cannot resolve a
//    stub promise; the real host answer wins (host-channel-only acceptance, ev.source check).
//    The `get` is issued first and stays pending while forged answers for ids 1..1000 are
//    queued, so whatever id it drew, a forgery for it is dispatched before the host's reply.
//    The check does not depend on how many syscalls the fixture made before it.
{
  const r = await scenario('forged-sysret', 'water-counter', {
    evaluate: async (page) => {
      const f = await appFrame(page);
      return f ? f.evaluate(async () => {
        await globalThis.__whimSyscall.call('storage.kv.set', { key: 'probe', value: 'REAL' });
        const pending = globalThis.__whimSyscall.call('storage.kv.get', { key: 'probe' });
        for (let id = 1; id <= 1000; id++) {
          globalThis.postMessage(JSON.stringify({ whim: 'sysret', v: 1, id, ok: true, result: { found: true, value: 'ATTACKER' } }), '*'); // NOSONAR - self-posted forged sysret must target this opaque sandbox frame.
        }
        return pending; // { found, value }
      }) : null;
    },
  });
  const value = r.extra?.value;
  const ok = value === 'REAL';
  record(ok, 'forged sysret is inert (host answer wins)', `resolved value=${JSON.stringify(value)} (want "REAL", not "ATTACKER")`);
}

// 6. SQL INJECTOR END-TO-END — a hostile bundle drives the real verbs with adversarial input
//    over the real path; values are inert, crafted identifiers rejected, only its own store.
{
  const r = await scenario('sql-injector', 'sql-injector', { until: (text) => /INJECTIONS LANDED/.test(text) });
  // Judged on the host side (the bundle's own summary line is a self-report, finding F4): the
  // tables the fixture must not be able to drop are still there, no table name carries injected
  // text, every value round-trip was answered ok and then removed, and the crafted identifiers
  // were refused by the engine.
  const tables = r.host.tables();
  const tablesIntact = tables.includes('c1') && tables.includes('kv');
  const namesClean = tables.every((t) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(t));
  const kinds = r.host.sysrets.filter((s) => !s.ok).map((s) => s.error?.kind);
  const appends = r.host.sysrets.filter((s) => s.ok && s.method === 'storage.records.append').length;
  const rowsLeft = r.host.realm.engine ? r.host.realm.engine.records.list('Notes').length : -1;
  const collRejected = kinds.includes('unknown_collection');
  const fieldRejected = kinds.includes('unknown_field');
  const ok = tablesIntact && namesClean && appends === 5 && rowsLeft === 0 && collRejected && fieldRejected;
  record(ok, 'sql-injector end-to-end (values inert, identifiers rejected)', `tables=${JSON.stringify(tables)} appends ok=${appends} (want 5) rows left=${rowsLeft} (want 0) refused kinds=${JSON.stringify([...new Set(kinds)])}`);
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

// 7b. PAINT IS FORWARDED AS TRUSTED — the launcher's boot state ends on a `paint` frame the RN host
//     receives with `trusted: true` (boot-state.ts accepts only trusted paints). The outer page
//     marks a frame trusted only after its nonce check, so this is the end-to-end half of that
//     fence; the forged-frame half is the F4 checks in run-against-build.mjs.
{
  const r = await scenario('paint-forwarded', 'water-counter');
  const paints = r.rnFrames.filter((f) => f.kind === 'paint');
  const ok = paints.length > 0 && paints.every((f) => f.trusted === true) && r.foreignCalls === 0;
  record(ok, 'paint reaches the RN host as a trusted frame', `paint frames=${paints.length} all trusted=${paints.every((f) => f.trusted === true)} host calls from inside the sandbox=${r.foreignCalls}`);
}

// 8. INV-CUEGATE (effects-and-cues task 7.2) — a hostile bundle cannot cue past the gate. The
//    cue-intruder (declares NO capabilities) tries valid-token haptic+sound, an off-set token,
//    and a forged self-posted sysret, end-to-end through the REAL sandbox → syscall → host. The
//    TRUSTED VANTAGE is the host: a recording-fake CueBackend (host-shim) must log ZERO device
//    invocations while undeclared, and the gate must answer with STRUCTURED denials. (Whether a
//    forged sysret is inert is check 4's job; this fixture only reports that it posted one.)
//    A GRANTED sub-run is the non-vacuity control: once the manifest grants
//    `cues`, the valid-token calls DO fire the backend (and the off-set one is still rejected
//    `invalid_params`) — so the undeclared denials are a real gate, not a dead path.
{
  // (a) UNDECLARED — valid-token cues must be denied `undeclared_capability`; backend untouched.
  const undeclared = await scenario('cue-denial', 'cue-intruder');
  const hapticDenied = /cues\.haptic\(double\): ✓ denied: undeclared_capability/.test(undeclared.text);
  const soundDenied = /cues\.sound\(chime\): ✓ denied: undeclared_capability/.test(undeclared.text);
  const offsetWhileUndeclared = /cues\.sound\(siren\) \[off-set\]: ✓ denied: \w+/.test(undeclared.text); // cap gate trips first
  const noFire = undeclared.host.cueLog.length === 0;
  const undeclaredOk = hapticDenied && soundDenied && offsetWhileUndeclared && noFire;
  record(undeclaredOk, 'INV-CUEGATE undeclared (hostile cue denied end-to-end, backend untouched)',
    `haptic→undeclared_capability=${hapticDenied} sound→undeclared_capability=${soundDenied} off-set-denied=${offsetWhileUndeclared} ` +
    `backend-invocations=${undeclared.host.cueLog.length} (must be 0)`);

  // (b) OFF-SET while GRANTED — the off-set token is rejected `invalid_params` even with the cap.
  //     This is BOTH the invalid_params arm of the invariant AND the non-vacuity control: the two
  //     VALID-token cues now FIRE the backend (the gate is a live path, not vacuously closed), and
  //     the recording log holds EXACTLY those two — the forged self-sysret added no phantom cue.
  const granted = await scenario('cue-offset-granted', 'cue-intruder', { manifestOverride: ['cues'] });
  const offsetInvalidParams = /cues\.sound\(siren\) \[off-set\]: ✓ denied: invalid_params/.test(granted.text);
  const validFired = /cues\.haptic\(double\): ⚠ NOT DENIED/.test(granted.text) && /cues\.sound\(chime\): ⚠ NOT DENIED/.test(granted.text);
  const log = granted.host.cueLog.slice().sort();
  const exactlyTheTwoValid = JSON.stringify(log) === JSON.stringify(['haptic:double', 'sound:chime']);
  const grantedOk = offsetInvalidParams && validFired && exactlyTheTwoValid;
  record(grantedOk, 'INV-CUEGATE off-set+non-vacuity (invalid_params rejected; granted cues DO fire — exactly the valid two)',
    `off-set→invalid_params=${offsetInvalidParams} valid-cues-fired=${validFired} backend-log=${JSON.stringify(granted.host.cueLog)} ` +
    `(must be exactly haptic:double+sound:chime — proves the gate is a live path AND the forged sysret added no phantom cue)`);
}

// 9. INV-ERRFRAME (developer-observability task 3.4, device-diagnostics "Mini-app failures reach
//    the seam as error records") — after the app has painted, a throw in a button handler and an
//    unhandled rejection each reach the RN host as the EXISTING nonce-authenticated `error`
//    frame: `trusted: true`, `payload.where` exactly `runtime` / `rejection`, `payload.name` the
//    error's own class name, and NONE of the message text anywhere in what the host receives (the
//    message can carry user data). Judged on the frames the outer page forwards to RN, never on
//    the bundle's own report. Guards against a vacuous pass:
//      • the frame must arrive within ERRFRAME_BUDGET_MS of the tap; no frame is a FAIL;
//      • a trusted `paint` must precede the tap (post-paint, not a mount failure);
//      • the tap must be observed (its `press` ui-event) so a missed click is named as such;
//      • a benign tap first must produce NO `error` frame (the frame is caused by the throw);
//      • the leak detector is checked against a planted frame carrying the message.
//    The forged half: the bundle posts `error` frames with no nonce and with a guessed nonce; the
//    host page must forward both as `rejected-forgery` and never as a trusted `error`.
{
  const ERRFRAME_BUDGET_MS = 3000;
  const NEEDLES = ['Alice', 'owes 40', 'Lisbon'];
  const leaks = (frames) => frames.some((f) => { const s = JSON.stringify(f); return NEEDLES.some((n) => s.includes(n)); });
  const plantedCaught = leaks([{ kind: 'error', trusted: true, payload: { where: 'runtime', name: 'LedgerError', message: 'Alice owes 40 for the Lisbon trip' } }]);

  const framesNow = (page) => page.evaluate(() => globalThis.__rnFrames.map((s) => JSON.parse(s)));
  async function waitFrames(page, pred, budgetMs) {
    const deadline = Date.now() + budgetMs;
    let frames = await framesNow(page);
    while (!pred(frames) && Date.now() < deadline) {
      await page.waitForTimeout(50);
      frames = await framesNow(page);
    }
    return { frames, met: pred(frames) };
  }
  async function tap(page, label) {
    for (const f of page.frames()) {
      try { const b = await f.$(`button:text-is("${label}")`); if (b) { await b.click(); return true; } } catch {}
    }
    return false;
  }
  const isPaint = (f) => f.kind === 'paint' && f.trusted === true;
  const isErr = (f) => f.kind === 'error';
  const pressed = (label) => (fs) => fs.some((f) => f.kind === 'ui-event' && f.payload?.type === 'press' && f.payload?.label === label);

  /** Paint, tap Calm (must stay error-free), tap `label`, then wait for a trusted error frame
   *  with `where`. Returns everything the checks judge. */
  async function errorCase(name, label, where) {
    let seen = null;
    const r = await scenario(name, 'error-raiser', {
      drive: async (page) => {
        const painted = await waitFrames(page, (fs) => fs.some(isPaint), 5000);
        await tap(page, 'Calm');
        const calm = await waitFrames(page, pressed('Calm'), ERRFRAME_BUDGET_MS);
        await page.waitForTimeout(300);
        const calmErrors = (await framesNow(page)).filter(isErr).length;
        const tapped = await tap(page, label);
        const hit = await waitFrames(page, (fs) => fs.some((f) => isErr(f) && f.trusted === true && f.payload?.where === where), ERRFRAME_BUDGET_MS);
        await page.waitForTimeout(300); // let any duplicate or wrongly-classified frame land too
        seen = { painted: painted.met, calmSeen: calm.met, calmErrors, tapped, pressSeen: pressed(label)(await framesNow(page)), arrived: hit.met };
      },
    });
    const frames = r.rnFrames;
    const paintIdx = frames.findIndex(isPaint);
    const errIdx = frames.findIndex((f) => isErr(f) && f.trusted === true && f.payload?.where === where);
    const errFrame = errIdx >= 0 ? frames[errIdx] : null;
    const otherErrors = frames.filter((f) => isErr(f) && f.payload?.where !== where);
    return { s: seen || {}, frames, paintIdx, errIdx, errFrame, otherErrors, foreignCalls: r.foreignCalls };
  }

  for (const [name, label, where, errName] of [
    ['errframe-runtime', 'Throw', 'runtime', 'LedgerError'],
    ['errframe-rejection', 'Reject', 'rejection', 'SettleError'],
  ]) {
    const c = await errorCase(name, label, where);
    const s = c.s;
    const postPaint = c.paintIdx >= 0 && c.errIdx > c.paintIdx;
    const nameOk = c.errFrame?.payload?.name === errName;
    const leaked = leaks(c.frames);
    const ok = s.painted === true && s.calmSeen === true && s.calmErrors === 0 && s.tapped === true && s.pressSeen === true &&
      s.arrived === true && postPaint && nameOk && c.otherErrors.length === 0 && !leaked && plantedCaught && c.foreignCalls === 0;
    record(ok, `INV-ERRFRAME ${where} (post-paint ${label} tap → trusted error frame, name, no message text)`,
      `painted=${s.painted} calm-tap seen=${s.calmSeen} errors after calm tap=${s.calmErrors} (want 0) ${label} tapped=${s.tapped} press seen=${s.pressSeen} ` +
      `trusted error where=${where} within ${ERRFRAME_BUDGET_MS}ms=${s.arrived} after paint=${postPaint} name=${JSON.stringify(c.errFrame?.payload?.name)} (want ${errName}) ` +
      `other-where error frames=${JSON.stringify(c.otherErrors.map((f) => f.payload?.where))} (want []) message text reached host=${leaked} ` +
      `detector catches planted message=${plantedCaught} frame=${JSON.stringify(c.errFrame)}`);
  }

  // Forged half — must hold before and after chain 3.
  {
    let seen = null;
    const r = await scenario('errframe-forged', 'error-raiser', {
      drive: async (page) => {
        const painted = await waitFrames(page, (fs) => fs.some(isPaint), 5000);
        const tapped = await tap(page, 'Forge');
        const rej = await waitFrames(page, (fs) => fs.filter((f) => f.kind === 'rejected-forgery' && f.forgedKind === 'error').length >= 2, ERRFRAME_BUDGET_MS);
        await page.waitForTimeout(300);
        seen = { painted: painted.met, tapped, rejectedBoth: rej.met };
      },
    });
    const s = seen || {};
    const rejected = r.rnFrames.filter((f) => f.kind === 'rejected-forgery' && f.forgedKind === 'error');
    const acceptedForged = r.rnFrames.filter((f) => isErr(f) && (f.trusted === true || f.payload?.name === 'ForgedError'));
    const ok = s.painted === true && s.tapped === true && s.rejectedBoth === true && rejected.every((f) => f.trusted === false) && acceptedForged.length === 0;
    record(ok, 'INV-ERRFRAME forged (nonce-less + guessed-nonce error frames rejected)',
      `painted=${s.painted} Forge tapped=${s.tapped} rejected-forgery(error) frames=${rejected.length} (want 2, all trusted:false) ` +
      `error frames forwarded as real=${acceptedForged.length} (want 0)`);
  }
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
