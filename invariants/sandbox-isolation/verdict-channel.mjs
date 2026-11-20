// ─────────────────────────────────────────────────────────────────────────────
// Verdict-channel integrity (constraint #4) — the containment verdict is posted by the loader on a
// channel that app code can neither read nor write, and app code cannot keep it from posting by
// rebinding what the loader uses (docs/security/2026-11-19-verdict-channel.md).
// ─────────────────────────────────────────────────────────────────────────────
// Each scenario delivers a hostile bundle (attack code + the real tip-splitter app, so the app still
// renders) and reads what the RN host would receive, from the outer page's relay — the trusted
// vantage, never the realm's self-report. Every attack posts a forged contained:true verdict tagged
// `forgedByBundle` with whatever nonce it managed to obtain. A scenario holds when:
//   • no frame the host would trust carries that tag (no forgery accepted, none relabelled);
//   • the genuine paint and the genuine verdict (contained, 49-ish probes, untagged) still arrive
//     trusted, unless the attack legitimately ends the realm first (the self-navigation one);
//   • the attack really ran and really failed: it records in its realm whether it ever held a
//     nonce, and the hello-based attacks must show up at the host as a rejected `hello`.
// Two negative controls patch the fix back out (a host that answers every hello; a loader that
// posts through the live `window.parent`) and must be FLAGGED, so these checks are not vacuous.

import { pathToFileURL } from 'node:url';

const FORGED_PAYLOAD = "{contained:true, passed:999, total:999, probes:[], forgedByBundle:true}";
const forgeWith = (nonceExpr) =>
  `P.postMessage(JSON.stringify({__whimHarness:true, nonce:${nonceExpr}, kind:'probes', payload:${FORGED_PAYLOAD}}), '*');`;
// The realm-side record each attack keeps: whether it ran and whether it ever held a nonce.
const STATE = "var A = (window.__WHIM_ATTACK__ = { ran: true, stole: false });";
const ON_INIT_FORGE =
  "window.addEventListener('message', function (ev) { var m; try { m = JSON.parse(ev.data); } catch (e) { return; }" +
  "  if (m && m.__whimHostInit === true) { A.stole = A.stole || typeof m.nonce === 'string'; " + forgeWith('m.nonce') + ' } });';
const REHELLO = "P.postMessage(JSON.stringify({__whimHarness:true, kind:'hello'}), '*');";

const SCENARIOS = [
  // ── the nonce handshake (build/assemble.mjs) ──
  {
    name: 'rehello forge (audit finding)',
    attack: `${STATE} var P = window.parent; ${ON_INIT_FORGE} ${REHELLO}`,
    expectHelloRejected: true,
  },
  {
    name: 'rehello forge + window.parent swapped to a sink (audit finding)',
    attack: `${STATE} var P = window.parent; ${ON_INIT_FORGE} ${REHELLO}
      try { window.parent = { postMessage: function () {} }; } catch (e) {}`,
    expectHelloRejected: true,
  },
  {
    // A document the iframe navigates to is a fresh realm, so it would get a fresh hello answered.
    // It ends the app's realm, so no genuine verdict is required after it; only that no forgery is.
    name: 'self-navigation to a data: document that asks again',
    attack: `${STATE} setTimeout(function () {
      var d = '<script>var A = (window.__WHIM_ATTACK__ = { ran: true, stole: false }); var P = parent;' +
        'addEventListener("message", function (e) { var m; try { m = JSON.parse(e.data); } catch (x) { return; }' +
        ' if (m && m.__whimHostInit === true) { A.stole = typeof m.nonce === "string";' +
        ' P.postMessage(JSON.stringify({__whimHarness:true, nonce:m.nonce, kind:"probes", payload:${FORGED_PAYLOAD.replace(/'/g, '"')}}), "*"); } });' +
        'P.postMessage(JSON.stringify({__whimHarness:true, kind:"hello"}), "*");<\\/script>';
      location.href = 'data:text/html,' + encodeURIComponent(d); }, 300);`,
    expectHelloRejected: true,
    realmEnds: true,
  },
  {
    // Channel (a) bakes the bundle into the srcdoc; run at parse time it was listening when the
    // init frame arrived.
    name: 'channel (a): a baked bundle listening for the init frame',
    attack: `${STATE} var P = window.parent; ${ON_INIT_FORGE}`,
    channel: 'a',
  },
  // ── the loader's own path (src/runtime/web/loader.js) ──
  {
    name: 'window.parent swapped for a recorder that steals the nonce and drops the verdict',
    attack: `${STATE} var P = window.parent;
      try { window.parent = { postMessage: function (s, o) { var m; try { m = JSON.parse(s); } catch (e) {}
        if (m && typeof m.nonce === 'string' && m.nonce && !A.stole) { A.stole = true; ${forgeWith('m.nonce')} }
        if (m && m.kind === 'probes') return; P.postMessage(s, o); } }; } catch (e) {}`,
  },
  {
    name: 'JSON.stringify rebound to read the nonce off the loader frame',
    attack: `${STATE} var P = window.parent, S0 = JSON.stringify;
      JSON.stringify = function (v) { var s = S0.apply(JSON, arguments);
        if (!A.stole && v && typeof v === 'object' && typeof v.nonce === 'string' && v.nonce) {
          A.stole = true; P.postMessage(S0({__whimHarness:true, nonce:v.nonce, kind:'probes', payload:${FORGED_PAYLOAD}}), '*'); }
        return s; };`,
  },
  {
    name: 'Object.prototype.toJSON relabels the genuine paint frame as a verdict',
    attack: `${STATE} Object.defineProperty(Object.prototype, 'toJSON', { configurable: true, get: function () { var self = this;
        if (self && self.__whimHarness === true && typeof self.nonce === 'string' && self.kind === 'paint') {
          A.stole = true; return function () { return {__whimHarness:true, nonce:self.nonce, kind:'probes', payload:${FORGED_PAYLOAD}}; }; }
        return undefined; } });`,
  },
  {
    name: "Promise.prototype.then hands the loader's verdict callback to app code",
    attack: `${STATE} var T0 = Promise.prototype.then;
      Promise.prototype.then = function (f, r) {
        if (typeof f === 'function' && /post\\('probes'/.test(String(f))) { A.stole = true;
          return T0.call(this, function () { return f(${FORGED_PAYLOAD}); }, r); }
        return T0.apply(this, arguments); };`,
  },
  {
    // Inherited getters make a host navBack frame read as a delivery: a second generation, a second
    // genuine verdict on the attacker's schedule (A1 bypass).
    name: 'Object.prototype getters turn a host frame into a delivery',
    attack: `${STATE} Object.defineProperty(Object.prototype, '__whimDeliver', { configurable: true, get: function () { return this && this.__whimNavBack === true; } });
      Object.defineProperty(Object.prototype, 'bundle', { configurable: true, get: function () { return this && this.__whimNavBack === true ? 'window.__WHIM_REDELIVERED__ = true;' : undefined; } });`,
    drive: async (page) => { await page.evaluate(() => globalThis.__whimControl.navBack()); await page.waitForTimeout(400); },
    expectSingleDelivery: true,
  },
  // ── silence: rebinding what the loader calls must not stop the paint and the verdict ──
  { name: 'silence: window.__whimAfterBundle replaced', attack: `${STATE} try { window.__whimAfterBundle = function () {}; } catch (e) {}` },
  { name: 'silence: window.__whimGeneration rewritten', attack: `${STATE} try { window.__whimGeneration = -1; } catch (e) {}` },
  { name: 'silence: requestAnimationFrame replaced', attack: `${STATE} try { window.requestAnimationFrame = function () { return 0; }; } catch (e) {}` },
];

// The fix, patched back out. Each patch must apply, or the control is void and fails.
const HOST_ANSWERS_EVERY_HELLO = ['if(!fromIframe || helloAnswered || !nonce){ rejectForgery(m); return; }', 'if(!nonce){ rejectForgery(m); return; }'];
const LOADER_POSTS_VIA_LIVE_PARENT = ["apply(parentPost, PARENT, [frame, '*']);", "window.parent.postMessage(frame, '*');"];
function patched(text, [from, to]) {
  return text.includes(from) ? text.split(from).join(to) : null;
}

// Load one page and collect every frame the outer page relays to the RN host (main frame only:
// a binding call from the sandboxed realm is not the host's relay and is dropped).
async function relayedFrames(browser, file, scenario) {
  const page = await browser.newPage();
  const relayed = [];
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e?.message || e)));
  await page.exposeBinding('__whimRelayCapture', (source, raw) => {
    if (source.frame !== page.mainFrame()) {
      return null;
    }
    relayed.push(raw);
    return null;
  });
  await page.addInitScript(() => {
    if (globalThis === globalThis.top) globalThis.ReactNativeWebView = { postMessage: (s) => globalThis.__whimRelayCapture(s) };
  });
  await page.goto(pathToFileURL(file).href, { waitUntil: 'load', timeout: 20000 });
  const frames = () => relayed.map((s) => { try { return JSON.parse(s); } catch { return null; } }).filter((m) => m && !m.__whimHostLog);
  const settled = () => {
    const f = frames();
    if (f.some(isForgedTrusted)) return true;
    if (scenario.realmEnds) return f.some((m) => m.kind === 'rejected-forgery' && m.forgedKind === 'hello');
    return f.some(isGenuineVerdict) && (!scenario.expectHelloRejected || f.some((m) => m.kind === 'rejected-forgery' && m.forgedKind === 'hello'));
  };
  const deadline = Date.now() + 8000;
  while (!settled() && Date.now() < deadline) await page.waitForTimeout(50);
  if (scenario.drive) await scenario.drive(page);
  await page.waitForTimeout(300); // a forgery posted after the verdict would land within this
  let realm = null;
  for (const fr of page.frames()) {
    if (fr === page.mainFrame()) continue;
    try { const s = await fr.evaluate(() => globalThis.__WHIM_ATTACK__ ? { ...globalThis.__WHIM_ATTACK__, redelivered: !!globalThis.__WHIM_REDELIVERED__ } : null); if (s) realm = s; } catch {}
  }
  await page.close();
  return { frames: frames(), realm, errors };
}

const isForgedTrusted = (m) => m.trusted === true && (m.payload?.forgedByBundle === true || (m.kind === 'probes' && m.payload?.total === 999));
const isGenuineVerdict = (m) => m.trusted === true && m.kind === 'probes' && m.payload?.contained === true && !m.payload?.forgedByBundle && m.payload?.total > 0 && m.payload?.total < 999;

function judge(scenario, run) {
  const f = run.frames;
  const forged = f.filter(isForgedTrusted).length;
  const genuinePaint = f.some((m) => m.trusted === true && m.kind === 'paint' && !m.payload?.forgedByBundle);
  const genuineVerdict = f.some(isGenuineVerdict);
  const helloRejected = f.some((m) => m.kind === 'rejected-forgery' && m.forgedKind === 'hello');
  const deliveries = f.filter((m) => m.trusted === true && m.kind === 'delivery').length;
  const ran = run.realm?.ran === true;
  const stole = run.realm?.stole === true;
  let ok = forged === 0 && ran && !stole;
  if (!scenario.realmEnds) ok = ok && genuinePaint && genuineVerdict;
  if (scenario.expectHelloRejected) ok = ok && helloRejected;
  if (scenario.expectSingleDelivery) ok = ok && deliveries <= 1 && run.realm?.redelivered === false;
  const detail =
    `forged-trusted=${forged} (want 0) attack-ran=${ran} attack-held-nonce=${stole} (want false)` +
    (scenario.realmEnds ? '' : ` genuine paint=${genuinePaint} genuine verdict=${genuineVerdict}`) +
    (scenario.expectHelloRejected ? ` re-hello rejected=${helloRejected}` : '') +
    (scenario.expectSingleDelivery ? ` trusted deliveries=${deliveries} (want 1) redelivered=${run.realm?.redelivered}` : '');
  return { ok, forged, stole, detail };
}

/**
 * @param {object} o
 * @param {import('playwright').Browser} o.browser
 * @param {Record<string,string>} o.parts runtime parts from runtime-artifacts.json
 * @param {Record<string,string>} o.bundles built bundles (tip-splitter is the carrier app)
 * @param {(srcdocOpts: object) => string} o.buildSrcdoc
 * @param {(outerOpts: object) => string} o.buildOuterHtml
 * @param {(name: string, html: string) => Promise<string>} o.writePage
 * @param {(ok: boolean, label: string, detail: string) => void} o.record
 */
export async function verdictChannelChecks({ browser, parts, bundles, buildSrcdoc, buildOuterHtml, writePage, record }) {
  const carrier = bundles['tip-splitter'];
  const pageFor = (scenario, { srcdocPatch, hostPatch } = {}) => {
    const source = scenario.attack + '\n' + carrier;
    const channelA = scenario.channel === 'a';
    let p = parts;
    if (srcdocPatch) {
      const loader = patched(parts.loader, srcdocPatch);
      if (loader === null) return null;
      p = { ...parts, loader };
    }
    const srcdoc = channelA ? buildSrcdoc({ parts: p, channel: 'a', bakedBundle: source }) : buildSrcdoc({ parts: p, channel: 'b' });
    const html = buildOuterHtml({ srcdoc, bundles: channelA ? {} : { app: source }, initial: 'app', channel: channelA ? 'a' : 'b', autostart: !channelA });
    return hostPatch ? patched(html, hostPatch) : html;
  };

  let i = 0;
  for (const scenario of SCENARIOS) {
    const file = await writePage(`verdict-${++i}`, pageFor(scenario));
    const run = await relayedFrames(browser, file, scenario);
    const verdict = judge(scenario, run);
    record(verdict.ok, `verdict channel: ${scenario.name}`, verdict.detail + (run.errors.length ? ' ERRORS=' + run.errors.join('|') : ''));
  }

  // NEGATIVE CONTROLS — with the fix patched out, the matching attack must be caught.
  const controls = [
    { label: 'host answers every hello', scenario: SCENARIOS[0], patch: { hostPatch: HOST_ANSWERS_EVERY_HELLO } },
    { label: 'loader posts through the live window.parent', scenario: SCENARIOS[4], patch: { srcdocPatch: LOADER_POSTS_VIA_LIVE_PARENT } },
  ];
  for (const control of controls) {
    const html = pageFor(control.scenario, control.patch);
    if (html === null) {
      record(false, `verdict channel negative control (${control.label})`, 'the patch did not apply — the control is void; update it to the current source');
      continue;
    }
    const file = await writePage(`verdict-control-${++i}`, html);
    const run = await relayedFrames(browser, file, control.scenario);
    const verdict = judge(control.scenario, run);
    const flagged = !verdict.ok && verdict.forged > 0 && verdict.stole;
    record(flagged, `verdict channel negative control (${control.label}; suite must FAIL it)`,
      `forged-trusted=${verdict.forged} attack-held-nonce=${verdict.stole} → ${flagged ? 'correctly FLAGGED the forgery' : 'DID NOT flag it (the checks above are vacuous!)'}`);
  }
}
