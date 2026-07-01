// ─────────────────────────────────────────────────────────────────────────────
// Whim runtime — containment probe checklist (the retained §16.2 isolation oracle).
// ─────────────────────────────────────────────────────────────────────────────
// Productionized from the proven adversarial suite (invariants/sandbox-isolation/
// spike2-bundle-contract/reference/probes.js); the assertions are kept verbatim — this is
// THE never-regress oracle (§16.2: "a bundle cannot reach the network or any native
// capability except through the SDK"). It defines `__whimRunProbes()` → Promise<Result>.
//
// CONSTRAINT #3 (trusted vantage): a bundle sharing the iframe scope can OVERWRITE
// `window.__whimRunProbes` (the evil fixture does, posting a forged 999/999). So the loader
// captures a reference to THIS genuine function in its closure BEFORE delivering any bundle,
// and calls the captured ref — never `window.__whimRunProbes`. The verdict is therefore
// computed from code the bundle cannot tamper with. PASS iff the dangerous thing throws / is
// provably inert / unreachable; a "DID NOT THROW" is a containment failure.
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
  // For the ALLOWED runtime surface ({vc-sdk, react, react-dom}): the module MUST resolve.
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
  // RTCPeerConnection is load-bearing: WebRTC bypasses connect-src 'none', so the value-strip is
  // the ONLY thing that closes this vector — CSP does not help here (see neutralize.js).
  expectThrow('network', 'RTCPeerConnection', function () { return new RTCPeerConnection(); });
  expectThrow('network', 'EventSource', function () { return new EventSource('https://evil.example'); });
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
  expectThrow('ambient', 'caches.open', function () { return caches.open('test'); });
  expectThrow('ambient', 'SharedWorker', function () { return new SharedWorker('data:application/javascript,1'); });
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

  // 6. module isolation: the resolvable runtime surface is EXACTLY {vc-sdk, react, react-dom};
  //    react/react-dom are host-injected externals (pure UI libs, no ambient authority), so
  //    resolving them is by design. EVERYTHING ELSE must throw. `require` is the H1b resolver.
  if (window.__WHIM_VC_SDK__) {
    expectResolves('module', "require('vc-sdk')  [H1b: injected global]", function () { return require('vc-sdk'); });
  } else {
    record('module', "require('vc-sdk')  [H1a: SDK compiled in]", true, 'n/a — bundled at build time, not runtime-resolved');
  }
  expectResolves('module', "require('react')  [host runtime]", function () { return require('react'); });
  expectResolves('module', "require('react-dom')  [host runtime]", function () { return require('react-dom'); });
  expectThrow('module', "require('react-dom/server')  [NOT exposed]", function () { return require('react-dom/server'); });
  expectThrow('module', "require('react-dom/client')  [subpath NOT exposed]", function () { return require('react-dom/client'); });
  expectThrow('module', "require('react-native')", function () { return require('react-native'); });
  expectThrow('module', "require('fs')", function () { return require('fs'); });
  expectThrow('module', "require('child_process')", function () { return require('child_process'); });
  expectThrow('module', "require('axios')", function () { return require('axios'); });
  expectUnreachable('module', 'ambient process (Node env leak)', function () {
    return (typeof process !== 'undefined') ? process : null;
  });

  // ── Adversarial pen test (T1, T3, T5, T6, T7) — runs in the DELIVERED bundle's exact scope.

  // T1 — self-injected fresh top-level inline <script>: THE channel-(b)-specific escape. The
  // same DOM-inserted-inline-script mechanism the loader uses is available to the bundle. A
  // fresh top-level scope must STILL see the poisoned window (the strip is window-level, not
  // lexical) and the CSP must still close codegen.
  try {
    try { delete window.__WHIM_T1; } catch (e) {}
    var t1src =
      'window.__WHIM_T1=(function(){var o={};' +
      'o.fetchType=typeof fetch;' +
      'try{fetch("https://evil.example/x");o.fetch="DID-NOT-THROW";}catch(e){o.fetch="threw:"+e.name;}' +
      'try{new XMLHttpRequest();o.xhr="DID-NOT-THROW";}catch(e){o.xhr="threw:"+e.name;}' +
      'try{new WebSocket("wss://evil.example");o.ws="DID-NOT-THROW";}catch(e){o.ws="threw:"+e.name;}' +
      'try{localStorage.setItem("x","y");o.ls="DID-NOT-THROW";}catch(e){o.ls="threw:"+e.name;}' +
      'try{new RTCPeerConnection();o.rtc="DID-NOT-THROW";}catch(e){o.rtc="threw:"+e.name;}' +
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
        /^threw:/.test(t1.ws) && /^threw:/.test(t1.ls) &&
        /^threw:/.test(t1.rtc) && /^threw:/.test(t1.eval);
      record('pentest-T1', 'self-injected fresh <script> reclaim globals', t1blocked,
        (t1blocked ? 'ALL blocked in fresh scope → ' : 'ESCAPE → ') +
        'fetch=' + t1.fetch + ' xhr=' + t1.xhr + ' ws=' + t1.ws +
        ' ls=' + t1.ls + ' rtc=' + t1.rtc + ' eval=' + t1.eval);
    }
    try { delete window.__WHIM_T1; } catch (e) {}
  } catch (e) {
    record('pentest-T1', 'self-injected fresh <script>', true, 'injection itself threw: ' + (e && e.name));
  }

  // T3 — pivot from the injected SDK global / reachable loader machinery to codegen/host.
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

  // T5 — module-resolution confinement: relative / loader-internal / subpath / dynamic require.
  expectThrow('pentest-T5', "require('./x')  [relative]", function () { return require('./x'); });
  expectThrow('pentest-T5', "require('../loader')  [relative parent]", function () { return require('../loader'); });
  expectThrow('pentest-T5', "require('vc-sdk/internals')  [SDK subpath]", function () { return require('vc-sdk/internals'); });
  expectThrow('pentest-T5', "require('vc-sdk/runtime')  [SDK internal module]", function () { return require('vc-sdk/runtime'); });
  expectThrow('pentest-T5', 'dynamic require(varName)  [computed specifier]', function () {
    var name = ['ch', 'ild', '_pro', 'cess'].join('');
    return require(name);
  });
  expectThrow('pentest-T5', 'window.__whimRequire (off-allowlist via the real resolver)', function () {
    var req = window.__whimRequire;
    if (typeof req !== 'function') throw new TypeError('no __whimRequire to abuse');
    return req('fs');
  });

  // T6 — transport eavesdrop / spoof. NEITHER is a sandbox BREACH; both are CONSTRAINTS on
  // the host/transport design (the host must authenticate/ignore bundle-origin control frames).
  (function () {
    try {
      var sawForeign = false;
      var handler = function (ev) {
        var d = ev && ev.data;
        if (typeof d !== 'string') return;
        if (d.indexOf('__WHIM_T6_OWN__') !== -1) return;
        if (d.indexOf('__whimDeliver') !== -1) sawForeign = true;
      };
      window.addEventListener('message', handler);
      window.postMessage('__WHIM_T6_OWN__ self-echo', '*');
      window.removeEventListener('message', handler);
      record('pentest-T6', 'eavesdrop host→web transport (own iframe only)', sawForeign === false,
        sawForeign
          ? 'ESCAPE → read foreign/host delivery traffic'
          : 'listener registers but observes only its OWN delivered source (1 bundle per iframe) — CONSTRAINT: transport must carry nothing the bundle should not see');
    } catch (e) {
      record('pentest-T6', 'eavesdrop host→web transport (own iframe only)', true,
        'addEventListener path threw: ' + (e && e.name));
    }
  })();
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
    record('pentest-T6', 'spoof host-bound control frame (parent.postMessage)', true,
      (canSpoof
        ? 'CONFIRMED spoofable (forged {__whimHarness:true} frame posted) — '
        : 'parent.postMessage unreachable — ') +
      'CONSTRAINT: host MUST authenticate/ignore bundle-origin control messages (generalizes F4)');
  })();

  // T7 — re-injection persistence (informational; does NOT gate `contained`). Reads whether
  // a prior generation's pollution survived into this realm. With the realm-reset seam
  // (re-create the iframe per generation, constraint #5) a re-injected generation sees a
  // clean realm; without it, gen-1 markers persist. The trusted loader sets __whimGeneration.
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
        'loader did not expose __whimGeneration; ' + detail);
    } else if (gen <= 1) {
      record('pentest-T7-info', 're-injection persistence (generation 1 baseline)', true,
        'gen 1: markers as planted by the current bundle (no cross-generation claim yet) — ' + detail);
    } else {
      record('pentest-T7-info', 're-injection persistence across generations',
        anyPoison === false,
        (anyPoison
          ? 'FINDING: gen-1 pollution PERSISTED into gen ' + gen + ' (same realm not reset) — '
          : 'realm reset between generations — no gen-1 pollution observed in gen ' + gen + ' — ') + detail);
    }
    window.__WHIM_T7_RESULT__ = { generation: gen, backdoor: backdoor, protoPolluted: protoPolluted, globalFlag: globalFlag, anyPoison: anyPoison };
  })();

  // 7a. NEGATIVE CONTROL — generic planted leak (the suite must flag a breach).
  window.__WHIM_PLANTED_LEAK__ = function () { return 'simulated native reach'; };
  var i1 = results.length;
  expectThrow('negative-control', 'planted leak (should be flagged)', function () { return window.__WHIM_PLANTED_LEAK__(); });
  var caughtGeneric = results[i1].ok === false;
  try { delete window.__WHIM_PLANTED_LEAK__; } catch (e) {}

  // 7b. DELIVERY-PATH negative control — simulate a loader that leaked a host handle.
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
    // `contained` counts the ESCAPE-axis probes only. Excluded: negative-control (supposed to
    // fail), pentest-T7-info (same-realm persistence is not a network/codegen/native escape).
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
      t7: t7,
    };
  });
}
