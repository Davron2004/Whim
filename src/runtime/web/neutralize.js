// ─────────────────────────────────────────────────────────────────────────────
// Whim runtime — forbidden-globals neutralization (runs FIRST inside the iframe).
// ─────────────────────────────────────────────────────────────────────────────
// Productionized from the proven Spike-1 shim (invariants/sandbox-isolation/reference/
// neutralize.js); behavior is kept verbatim — this is the retained #35 surgical strip.
//
// One of the three load-bearing security legs (none sufficient alone — docs/spike2-findings):
//   (a) the cross-origin sandboxed iframe (no allow-same-origin) denies host/native reach;
//   (b) the CSP `script-src` WITHOUT 'unsafe-eval' kills eval()/Function AND the
//       `({}).constructor.constructor('…')` codegen walk — the one hole no value-strip reaches;
//   (c) THIS file: a window-level, non-configurable value-strip of the network/storage/
//       threading globals.
//
// CONSTRAINT #1 (load-bearing): the strip is WINDOW-LEVEL and non-configurable — never a
// lexical/closure shadow. Channel (b) runs the bundle, and any <script> it self-injects, in
// GLOBAL scope; only a window-level strip survives a fresh top-level script (this is exactly
// what blocks pen-test T1). Lexical shadowing (loader.js) is kept ONLY as belt-and-suspenders
// for a global the engine happens to mark non-configurable so delete/redefine here fails.
//
// Stubs throw when INVOKED, not when read — benign feature-detection (`typeof fetch`) stays
// safe; we strip the dangerous EFFECT surgically, not the identifier ("neutralization does
// not break the runtime itself"). `eval`/`Function` are deliberately NOT value-replaced: the
// CSP kills them at the engine level, and value-replacing `Function` would break React's
// `x instanceof Function` (over-strip — D5).
(function neutralizeForbiddenGlobals() {
  'use strict';

  function throwingFn(name) {
    return function whimForbidden() {
      throw new TypeError(name + ' is disabled in the Whim sandbox (Layer-3 escape hatch)');
    };
  }

  // Replace a global with `replacement`, defeating non-writable/accessor props by
  // delete-then-redefine, falling back to plain assignment. Returns the technique that
  // actually stuck, so the probe report can show HOW each global was neutralized.
  function neutralize(name, replacement) {
    try { delete window[name]; } catch (e) {}
    try {
      Object.defineProperty(window, name, {
        value: replacement, writable: false, configurable: false, enumerable: false,
      });
      return 'redefined';
    } catch (e) {}
    try { window[name] = replacement; return 'assigned'; } catch (e) {}
    return 'non-configurable'; // could not touch it on window → loader.js lexically shadows it
  }

  // An object whose every property access/call throws — for ambient stores.
  function inertStore(name) {
    var handler = {
      get: function () { throw new TypeError(name + ' is disabled in the Whim sandbox'); },
      set: function () { throw new TypeError(name + ' is disabled in the Whim sandbox'); },
      apply: function () { throw new TypeError(name + ' is disabled in the Whim sandbox'); },
    };
    try { return new Proxy(function () {}, handler); } catch (e) { return undefined; }
  }

  var report = {};

  // Network primitives. RTCPeerConnection is load-bearing here: WebRTC is NOT covered by
  // `connect-src 'none'`, so the value-strip is the only thing that closes it.
  report.fetch = neutralize('fetch', throwingFn('fetch'));
  report.XMLHttpRequest = neutralize('XMLHttpRequest', throwingFn('XMLHttpRequest'));
  report.WebSocket = neutralize('WebSocket', throwingFn('WebSocket'));
  report.EventSource = neutralize('EventSource', throwingFn('EventSource'));
  report.RTCPeerConnection = neutralize('RTCPeerConnection', throwingFn('RTCPeerConnection'));

  // Dynamic code execution — CSP-handled, deliberately NOT value-replaced (over-strip risk).
  report.eval = 'csp (script-src has no unsafe-eval)';
  report.Function = 'csp (script-src has no unsafe-eval)';

  // Ambient persistence + threading.
  report.localStorage = neutralize('localStorage', inertStore('localStorage'));
  report.sessionStorage = neutralize('sessionStorage', inertStore('sessionStorage'));
  report.indexedDB = neutralize('indexedDB', inertStore('indexedDB'));
  report.caches = neutralize('caches', inertStore('caches'));
  report.Worker = neutralize('Worker', throwingFn('Worker'));
  report.SharedWorker = neutralize('SharedWorker', throwingFn('SharedWorker'));

  // Belt-and-suspenders: kill the obvious network exfil method on navigator too.
  try {
    if (window.navigator && 'sendBeacon' in window.navigator) {
      Object.defineProperty(window.navigator, 'sendBeacon', {
        value: throwingFn('navigator.sendBeacon'), writable: false, configurable: false,
      });
      report.sendBeacon = 'redefined';
    }
  } catch (e) { report.sendBeacon = 'non-configurable'; }

  window.__WHIM_NEUTRALIZE_REPORT__ = report;
})();
