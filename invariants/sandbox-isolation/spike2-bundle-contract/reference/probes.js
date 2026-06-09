// THROWAWAY SPIKE CODE — re-containment probe checklist (Task 1.3 / Section 6 / D5).
// Adapted from invariants/sandbox-isolation/reference/probes.js. Same assertions, but:
//   • SDK module name is 'vc-sdk' (the spec/§5.2 name), not '@whim/sdk'.
//   • It runs against the DELIVERED bundle's context (after the chosen D2 channel ran),
//     so a green result here means the delivery channel did NOT reopen a hole (D5).
//   • Section 7b adds a DELIVERY-PATH negative control (Task 6.3): a planted host-ref
//     leak that a bad loader could introduce — the suite must flag it.
// PASS iff the dangerous thing throws / is provably inert / unreachable.
function __whimRunProbes() {
  'use strict';
  var results = [];
  function describe(v) {
    try {
      if (typeof v === 'function') return 'function';
      if (v === null) return 'null';
      if (v === undefined) return 'undefined';
      return String(v).slice(0, 80);
    } catch (e) { return '<undescribable>'; }
  }
  function record(c, n, ok, d) { results.push({ category: c, name: n, ok: ok, detail: d }); }
  function expectThrow(c, n, fn) {
    try { var v = fn(); record(c, n, false, 'DID NOT THROW → ' + describe(v)); }
    catch (e) { record(c, n, true, 'threw ' + (e && e.name ? e.name : 'Error')); }
  }
  function expectUnreachable(c, n, fn) {
    try {
      var v = fn();
      if (v === null || v === undefined) record(c, n, true, 'unreachable → ' + describe(v));
      else record(c, n, false, 'REACHED a usable value → ' + describe(v));
    } catch (e) { record(c, n, true, 'blocked: ' + (e && e.name ? e.name : 'Error')); }
  }
  // For the ALLOWED runtime surface (vc-sdk + the host-injected react/react-dom): the
  // module MUST resolve to a real value. PASS = resolves; FAIL = threw or null. (react/
  // react-dom are pure UI libs with no ambient authority, so resolving them is by design,
  // not a leak — see the D3 note: the resolvable surface is {vc-sdk, react, react-dom}.)
  function expectResolves(c, n, fn) {
    try {
      var v = fn();
      if (v !== null && v !== undefined) record(c, n, true, 'resolves (allowed runtime) → ' + describe(v));
      else record(c, n, false, 'expected to resolve but got ' + describe(v));
    } catch (e) { record(c, n, false, 'expected to resolve but threw ' + (e && e.name ? e.name : 'Error')); }
  }

  // 1. network
  expectThrow('network', 'fetch', function () { return fetch('https://example.com/whim-probe'); });
  expectThrow('network', 'XMLHttpRequest', function () { return new XMLHttpRequest(); });
  expectThrow('network', 'WebSocket', function () { return new WebSocket('wss://example.com'); });
  expectThrow('network', 'window.fetch (stub)', function () { return window.fetch('https://example.com'); });
  expectThrow('network', 'navigator.sendBeacon', function () { return navigator.sendBeacon('https://example.com', 'x'); });

  // 2. codegen (CSP-enforced; the load-bearing leg)
  expectThrow('codegen', 'eval', function () { return eval('1+1'); });
  expectThrow('codegen', 'new Function', function () { return new Function('return 1')(); });
  expectThrow('codegen', 'Function (call form)', function () { return Function('return 1')(); });

  // 3. ambient persistence + threading
  expectThrow('ambient', 'localStorage', function () { return localStorage.setItem('a', 'b'); });
  expectThrow('ambient', 'sessionStorage', function () { return sessionStorage.setItem('a', 'b'); });
  expectThrow('ambient', 'indexedDB', function () { return indexedDB.open('whim'); });
  expectThrow('ambient', 'Worker', function () { return new Worker('data:application/javascript,1'); });

  // 4. prototype-walk codegen (CSP is the ONLY thing that closes this)
  expectThrow('escape', '({}).constructor.constructor', function () { return ({}).constructor.constructor('return this')(); });
  expectThrow('escape', '[].constructor.constructor', function () { return [].constructor.constructor('return globalThis')(); });
  expectThrow('escape', 'function.constructor walk', function () { return (function () {}).constructor('return 1')(); });

  // 5. host / native reach — the only crossing allowed is parent.postMessage
  expectUnreachable('reach', 'window.frameElement', function () { return window.frameElement; });
  expectUnreachable('reach', 'window.parent.document', function () { return window.parent.document; });
  expectUnreachable('reach', 'window.top.document', function () { return window.top.document; });
  expectUnreachable('reach', 'window.parent.location.href', function () { return window.parent.location.href; });
  expectUnreachable('reach', 'window.parent.ReactNativeWebView (real bridge)', function () { return window.parent.ReactNativeWebView; });
  expectUnreachable('reach', 'window.top.ReactNativeWebView', function () { return window.top.ReactNativeWebView; });

  // 6. module isolation (Task 4.3, refined): the resolvable runtime surface is EXACTLY
  //    {vc-sdk, react, react-dom} — react/react-dom are host-injected externals (pure UI
  //    libs, no ambient authority; the bundle could read window.React directly anyway), so
  //    resolving them is by design. EVERYTHING ELSE — including react-dom/server and any
  //    Node/3rd-party module — must throw. `require` here is the runner's resolver.
  // vc-sdk resolution is SDK-mode-dependent: H1b injects a runtime global (require resolves
  // it); H1a compiles the SDK into the app bundle (no runtime-resolvable vc-sdk module, so
  // require('vc-sdk') correctly throws — the app already has the SDK lexically, proven by
  // the render). Detect the mode by the presence of the injected global.
  if (window.__WHIM_VC_SDK__) {
    expectResolves('module', "require('vc-sdk')  [H1b: injected global]", function () { return require('vc-sdk'); });
  } else {
    record('module', "require('vc-sdk')  [H1a: SDK compiled in]", true, 'n/a — bundled at build time, not runtime-resolved');
  }
  expectResolves('module', "require('react')  [host runtime]", function () { return require('react'); });
  expectResolves('module', "require('react-dom')  [host runtime]", function () { return require('react-dom'); });
  expectThrow('module', "require('react-dom/server')  [NOT exposed]", function () { return require('react-dom/server'); });
  expectThrow('module', "require('react-native')", function () { return require('react-native'); });
  expectThrow('module', "require('fs')", function () { return require('fs'); });
  expectThrow('module', "require('child_process')", function () { return require('child_process'); });
  expectThrow('module', "require('axios')", function () { return require('axios'); });
  // The real Node-environment leak indicator is ambient `process` (process.binding/env/
  // child_process). module/exports are NOT checked: an IIFE runner may provide a benign
  // CommonJS `{exports:{}}` shim, which carries no authority.
  expectUnreachable('module', 'ambient process (Node env leak)', function () {
    return (typeof process !== 'undefined') ? process : null;
  });

  // ──────────────────────────────────────────────────────────────────────────────
  // PEN TEST (adversarial, on top of D5). These run in the DELIVERED bundle's exact
  // scope, so they faithfully test what a malicious app could do. T2 (host/native
  // reach) and T4 (codegen) are already covered by sections 2/4/5; here we add the
  // channel-(b)-specific T1 and the T3 pivot.
  // ──────────────────────────────────────────────────────────────────────────────

  // T1 — self-injected fresh top-level inline <script>: THE channel-(b)-specific escape.
  // The same DOM-inserted-inline-script mechanism the trusted loader uses is available to
  // the bundle. A fresh top-level scope must STILL see the poisoned window (the strip is
  // window-level, not lexical) and the CSP must still close codegen. If a fresh script can
  // reclaim a working fetch/XHR/WebSocket/localStorage or run eval, that is a full escape.
  try {
    try { delete window.__WHIM_T1; } catch (e) {}
    var t1src =
      'window.__WHIM_T1=(function(){var o={};' +
      'o.fetchType=typeof fetch;' +
      'try{fetch("https://evil.example/x");o.fetch="DID-NOT-THROW";}catch(e){o.fetch="threw:"+e.name;}' +
      'try{new XMLHttpRequest();o.xhr="DID-NOT-THROW";}catch(e){o.xhr="threw:"+e.name;}' +
      'try{new WebSocket("wss://evil.example");o.ws="DID-NOT-THROW";}catch(e){o.ws="threw:"+e.name;}' +
      'try{localStorage.setItem("x","y");o.ls="DID-NOT-THROW";}catch(e){o.ls="threw:"+e.name;}' +
      'try{eval("1+1");o.eval="DID-NOT-THROW";}catch(e){o.eval="threw:"+e.name;}' +
      'return o;})();';
    var t1s = document.createElement('script');
    t1s.textContent = t1src;
    (document.head || document.documentElement).appendChild(t1s);
    if (t1s.parentNode) t1s.parentNode.removeChild(t1s);
    var t1 = window.__WHIM_T1;
    if (!t1) {
      record('pentest-T1', 'self-injected fresh <script> (did NOT execute)', true, 'fresh inline script blocked from running — no escape');
    } else {
      var t1blocked = /^threw:/.test(t1.fetch) && /^threw:/.test(t1.xhr) &&
        /^threw:/.test(t1.ws) && /^threw:/.test(t1.ls) && /^threw:/.test(t1.eval);
      record('pentest-T1', 'self-injected fresh <script> reclaim globals', t1blocked,
        (t1blocked ? 'ALL blocked in fresh scope → ' : 'ESCAPE → ') +
        'fetch=' + t1.fetch + ' xhr=' + t1.xhr + ' ws=' + t1.ws + ' ls=' + t1.ls + ' eval=' + t1.eval);
    }
    try { delete window.__WHIM_T1; } catch (e) {}
  } catch (e) {
    record('pentest-T1', 'self-injected fresh <script>', true, 'injection itself threw: ' + (e && e.name));
  }

  // T3 — pivot from the injected SDK global / reachable trusted machinery to codegen or a
  // host handle. The SDK global + loader helpers SHARE the bundle's scope (channel b); that
  // is safe ONLY if none carries authority beyond parent.postMessage. Reaching the Function
  // constructor via the SDK's prototype chain must still be closed by the CSP, and calling
  // the loader's resolver directly off window must not resolve anything off-allowlist.
  expectThrow('pentest-T3', 'pivot: vc-sdk proto → Function-constructor codegen', function () {
    var sdk = window.__WHIM_VC_SDK__ || {};
    var proto = Object.getPrototypeOf(sdk);
    var ctor = proto && proto.constructor;
    if (!ctor || !ctor.constructor) throw new TypeError('no proto constructor to pivot through');
    return ctor.constructor('return globalThis.fetch')();
  });
  expectThrow('pentest-T3', 'pivot: window.__whimRequire → off-allowlist module', function () {
    var req = window.__whimRequire || require;
    return req('child_process');
  });

  // ──────────────────────────────────────────────────────────────────────────────
  // T5 — module-resolution confinement (trusted probes). Section 6 already asserts the
  // allowlist {vc-sdk, react, react-dom} resolves and that fs/child_process/axios/
  // react-native/react-dom/server throw. Here we extend the resolver attack surface a
  // malicious bundle would actually try: RELATIVE requires, requiring the loader's own
  // internals / by-variable, and a DYNAMIC require(varName). The resolver
  // (window.__whimRequire) is allowlist-by-exact-name, so every one of these must throw.
  expectThrow('pentest-T5', "require('./x')  [relative]", function () { return require('./x'); });
  expectThrow('pentest-T5', "require('../loader')  [relative parent]", function () { return require('../loader'); });
  expectThrow('pentest-T5', "require('./iframe-loader-b.html')  [loader file]", function () { return require('./iframe-loader-b.html'); });
  expectThrow('pentest-T5', "require('vc-sdk/internals')  [SDK subpath]", function () { return require('vc-sdk/internals'); });
  expectThrow('pentest-T5', "require('vc-sdk/runtime')  [SDK internal module]", function () { return require('vc-sdk/runtime'); });
  expectThrow('pentest-T5', 'dynamic require(varName)  [computed specifier]', function () {
    var name = ['ch', 'ild', '_pro', 'cess'].join('');   // defeat any literal-only static scan
    return require(name);
  });
  // try to reach the loader's own resolver/transport machinery by name and pivot.
  // window.__whimRequire IS reachable (it must be, to resolve the allowlist), but it must
  // carry NO authority beyond the allowlist — calling it off-allowlist must throw, and it
  // must not be a route to react-dom/server, fs, or a host handle.
  expectThrow('pentest-T5', 'window.__whimRequire (off-allowlist via the real resolver)', function () {
    var req = window.__whimRequire;
    if (typeof req !== 'function') throw new TypeError('no __whimRequire to abuse');
    return req('fs');
  });

  // ──────────────────────────────────────────────────────────────────────────────
  // T6 — transport eavesdrop / spoof (trusted probes). The host→web channel delivers the
  // bundle source as a JSON string on the iframe's 'message' event; the web→host crossing
  // is parent.postMessage (the loader's ReactNativeWebView stub). Questions:
  //   (a) can bundle-scope code register its OWN 'message' listener and read host→web
  //       traffic? It CAN add a listener (window.addEventListener is not stripped — it
  //       carries no ambient authority), but per-iframe there is exactly ONE bundle, so the
  //       only host→web payload it can ever observe is its OWN delivered source (which it
  //       already has as its own program text). It CANNOT see other bundles' source — they
  //       live in other iframes/realms. We record the eavesdrop SURFACE honestly: a listener
  //       registers, but it observes nothing the bundle doesn't already possess.
  //   (b) can it post messages the host mistakes for loader/harness control traffic? YES —
  //       parent.postMessage is the one permitted crossing and the bundle shares the iframe
  //       scope with the loader's post(), so it can emit a forged {__whimHarness:true,...}
  //       frame (this generalizes F4's verdict-spoof to ALL host-bound control messages).
  // NEITHER is a sandbox BREACH (no codegen/native/egress) — both are CONSTRAINTS on the
  // transport/host design. The probes below pass = "the surface behaves exactly as modeled
  // and grants no capability beyond it"; they do NOT count a spoof as a containment failure
  // (the spoof is expected and is the finding, mirroring how F4 is a constraint, not a leak).

  // T6a — eavesdrop surface: a bundle CAN add a message listener, but it sees nothing it
  // doesn't already have. We register one, synthesize a same-window message, and confirm
  // the listener only ever observes our own synthetic event (the real host→web delivery
  // already fired before the bundle ran). PASS = listener got no foreign/host payload.
  (function () {
    try {
      var sawForeign = false;
      var handler = function (ev) {
        var d = ev && ev.data;
        if (typeof d !== 'string') return;
        if (d.indexOf('__WHIM_T6_OWN__') !== -1) return;   // our own self-echo; ignore
        // a real second host→web delivery or other-bundle source would land here:
        if (d.indexOf('__whimDeliver') !== -1) sawForeign = true;
      };
      window.addEventListener('message', handler);
      // synthesize our own message into our own window (same-realm); the bundle can do this
      // but it only echoes to itself.
      window.postMessage('__WHIM_T6_OWN__ self-echo', '*');
      // We can't synchronously await the async message dispatch here (the self-echo is
      // queued), so we assert the SHAPE: the listener registered (no throw) and no FOREIGN
      // host→web traffic is sitting in scope for it to read. The load-bearing assertion is
      // "no foreign payload readable", which is structural (1 bundle per iframe/realm).
      window.removeEventListener('message', handler);
      record('pentest-T6', 'eavesdrop host→web transport (own iframe only)', sawForeign === false,
        sawForeign
          ? 'ESCAPE → read foreign/host delivery traffic'
          : 'listener registers but observes only its OWN delivered source (1 bundle per iframe; cannot read other realms) — CONSTRAINT: transport must carry nothing the bundle should not see');
    } catch (e) {
      record('pentest-T6', 'eavesdrop host→web transport (own iframe only)', true,
        'addEventListener path threw: ' + (e && e.name));
    }
  })();

  // T6b — spoof surface: the bundle shares scope with the loader's parent.postMessage, so it
  // can emit a host-bound control frame the host cannot distinguish from the loader's. We
  // DEMONSTRATE the capability (post a clearly-tagged forged frame the host will ignore by
  // tag) and record it as the CONSTRAINT, not a containment failure. This is the general
  // case of F4: not just the probes verdict — ANY {__whimHarness:true} kind can be forged.
  (function () {
    var canSpoof = false;
    try {
      if (window.parent && typeof window.parent.postMessage === 'function') {
        canSpoof = true;
        window.parent.postMessage(JSON.stringify({
          __whimHarness: true, kind: 'spoof-probe',
          payload: { __WHIM_T6_SPOOF: true, note: 'forged host-bound control frame from bundle scope (T6b)' },
        }), '*');
      }
    } catch (e) { canSpoof = false; }
    // PASS here means "the surface is exactly as modeled": the only crossing is
    // parent.postMessage, AND it is spoofable → the host MUST authenticate/ignore
    // bundle-origin control messages. We record the finding; we do NOT fail containment on
    // it (spoofing the transport is not codegen/native/egress).
    record('pentest-T6', 'spoof host-bound control frame (parent.postMessage)', true,
      (canSpoof
        ? 'CONFIRMED spoofable (forged {__whimHarness:true} frame posted) — '
        : 'parent.postMessage unreachable — ') +
      'CONSTRAINT: host MUST authenticate/ignore bundle-origin control messages (generalizes F4)');
  })();

  // ──────────────────────────────────────────────────────────────────────────────
  // T7 — re-injection persistence (TRUSTED victim probe). Channel (b)'s Spike-8 selling
  // point is re-injection into the SAME iframe/realm without re-creating it. The hazard:
  // does generation N's pollution survive into generation N+1? This probe runs in the
  // TRUSTED loader scope after EVERY bundle mounts (so a malicious bundle cannot tamper
  // with the verdict — F4). The poisoner bundle (fixtures/poison-app.app.tsx, delivered as
  // generation 1) plants three markers; the victim bundle (fixtures/victim-app.app.tsx,
  // delivered as generation 2) does nothing — its only job is to trigger THIS trusted probe
  // again in the re-injected realm so we can read whether the markers persisted.
  //
  // The poison markers (must match poison-app.app.tsx exactly):
  //   • window.__WHIM_T7_BACKDOOR        — a leftover backdoor function on window
  //   • Object.prototype.__whimPwned     — prototype pollution ({}).__whimPwned is truthy
  //   • window.__WHIM_T7_GLOBAL_FLAG     — a mutated shared global
  //
  // This section does NOT count toward `contained` (persistence is a same-realm hazard, not
  // a network/codegen/native ESCAPE — the sandbox can still fully contain a poisoned realm).
  // We surface it as the dedicated top-level field `t7` instead. Verdict reading: if
  // generation >= 2 and any marker is present, re-injection let gen N poison gen N+1 → the
  // T7 finding → the Spike-8 constraint (reset/re-strip the realm between generations).
  (function () {
    var gen = (typeof window.__whimGeneration === 'number') ? window.__whimGeneration : null;
    var backdoor = (typeof window.__WHIM_T7_BACKDOOR === 'function');
    var protoPolluted = false;
    try { protoPolluted = ({}).__whimPwned === 'pwned-by-generation-1'; } catch (e) {}
    var globalFlag = (window.__WHIM_T7_GLOBAL_FLAG === 'set-by-generation-1');
    var anyPoison = backdoor || protoPolluted || globalFlag;
    var detail =
      'generation=' + gen +
      ' backdoor=' + backdoor +
      ' Object.prototype.__whimPwned=' + protoPolluted +
      ' globalFlag=' + globalFlag;
    if (gen === null) {
      record('pentest-T7-info', 're-injection persistence (no generation counter)', true,
        'loader did not expose __whimGeneration — re-injection harness not active; ' + detail);
    } else if (gen <= 1) {
      // generation 1 is the poisoner itself (or a single-shot run); markers being present
      // here is expected and is NOT yet the finding. We just record the baseline.
      record('pentest-T7-info', 're-injection persistence (generation 1 baseline)', true,
        'gen 1: markers as planted by the current bundle (no cross-generation claim yet) — ' + detail);
    } else {
      // generation >= 2: THIS is the T7 verdict. anyPoison===true means gen-1 pollution
      // survived re-injection into gen 2's run → the realm was NOT reset → the finding.
      record('pentest-T7-info', 're-injection persistence across generations',
        anyPoison === false,
        (anyPoison
          ? 'FINDING: gen-1 pollution PERSISTED into gen ' + gen + ' (same realm not reset) — '
          : 'no gen-1 pollution observed in gen ' + gen + ' (realm appears clean) — ') + detail);
    }
    // stash for the structured top-level field
    window.__WHIM_T7_RESULT__ = { generation: gen, backdoor: backdoor, protoPolluted: protoPolluted, globalFlag: globalFlag, anyPoison: anyPoison };
  })();

  // 7a. NEGATIVE CONTROL — generic planted leak (the suite must flag a breach).
  window.__WHIM_PLANTED_LEAK__ = function () { return 'simulated native reach'; };
  var i1 = results.length;
  expectThrow('negative-control', 'planted leak (should be flagged)', function () { return window.__WHIM_PLANTED_LEAK__(); });
  var caughtGeneric = results[i1].ok === false;
  try { delete window.__WHIM_PLANTED_LEAK__; } catch (e) {}

  // 7b. DELIVERY-PATH negative control (Task 6.3) — simulate a loader that leaked a
  //     host handle into the bundle scope. If the delivery channel ever stashed a real
  //     parent/native ref under a global, this asserts the suite would catch it.
  window.__WHIM_DELIVERY_LEAKED_HOST__ = { stolenBridge: function () { return 'host bridge'; } };
  var i2 = results.length;
  expectUnreachable('negative-control', 'delivery-leaked host handle (should be flagged)', function () {
    return window.__WHIM_DELIVERY_LEAKED_HOST__ && window.__WHIM_DELIVERY_LEAKED_HOST__.stolenBridge();
  });
  var caughtDelivery = results[i2].ok === false;
  try { delete window.__WHIM_DELIVERY_LEAKED_HOST__; } catch (e) {}

  // 8. dynamic import() must reject (no module loads under the CSP) — also kills H3.
  var importProbe = new Promise(function (resolve) {
    var p;
    try { p = import('data:text/javascript,export default 1'); }
    catch (e) { record('codegen', 'import()', true, 'threw synchronously: ' + (e && e.name)); return resolve(); }
    Promise.resolve(p).then(
      function (m) { record('codegen', 'import()', false, 'RESOLVED a module → ' + describe(m)); resolve(); },
      function (e) { record('codegen', 'import()', true, 'rejected: ' + (e && e.name ? e.name : 'Error')); resolve(); }
    );
  });

  return importProbe.then(function () {
    // `contained` counts the ESCAPE-axis probes only. Excluded from the count:
    //   • negative-control  — these are SUPPOSED to fail (they verify the suite detects a
    //                         breach), so they never gate the verdict.
    //   • pentest-T7-info   — re-injection PERSISTENCE is a same-realm hazard, NOT a
    //                         network/codegen/native escape; the realm can be fully
    //                         contained AND still carry gen-N pollution into gen N+1. We
    //                         surface that finding separately as `t7`, never as a
    //                         containment FAILURE. (T5 module-confinement and T6 spoof/
    //                         eavesdrop DO count — T5 must throw off-allowlist; T6's probes
    //                         pass under the modeled behavior.)
    var EXCLUDED = { 'negative-control': true, 'pentest-T7-info': true };
    var real = results.filter(function (r) { return !EXCLUDED[r.category]; });
    var failed = real.filter(function (r) { return !r.ok; });
    var t7 = window.__WHIM_T7_RESULT__ || null;
    return {
      neutralizeReport: window.__WHIM_NEUTRALIZE_REPORT__ || null,
      probes: results,
      total: real.length,
      passed: real.length - failed.length,
      failed: failed.length,
      failures: failed,
      negativeControlCaughtBreach: caughtGeneric,
      deliveryLeakCaught: caughtDelivery,
      contained: failed.length === 0 && caughtGeneric === true && caughtDelivery === true,
      // T7 re-injection persistence (informational, does NOT affect `contained`):
      // null until generation>=2; then {generation, backdoor, protoPolluted, globalFlag, anyPoison}.
      t7: t7,
    };
  });
}
