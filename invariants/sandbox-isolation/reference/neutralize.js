// ─────────────────────────────────────────────────────────────────────────────
// Whim Spike 1 — forbidden-globals neutralization shim (runs FIRST in the iframe)
// ─────────────────────────────────────────────────────────────────────────────
// Layer-3 escape hatches (decisions.md #12) are stripped from the runtime here.
// Technique is layered, because no single trick covers every case on the engine:
//
//   (a) CSP `script-src` WITHOUT 'unsafe-eval'  → kills eval() and the Function
//       constructor at the ENGINE level. This is the only thing that also closes
//       the `({}).constructor.constructor('…')` prototype-walk hole, which value
//       replacement on `window` cannot reach. (Set in the iframe's <meta> CSP.)
//   (b) Value replacement on `window`           → named globals (fetch, XHR, …)
//       become stubs that throw when invoked.   Done below.
//   (c) Lexical shadowing in the bundle scope    → handled in runner.js for any
//       global the engine marks non-configurable so (b)'s delete/redefine fails.
//
// Design choice: stubs throw when INVOKED (not when read). Reading stays safe so
// benign feature-detection (`typeof fetch`) never explodes — we strip the
// dangerous *effect*, surgically, not the identifier (spec: "neutralization does
// not break the runtime itself").
(function neutralizeForbiddenGlobals() {
  'use strict';

  function throwingFn(name) {
    return function whimForbidden() {
      throw new TypeError(name + ' is disabled in the Whim sandbox (Layer-3 escape hatch)');
    };
  }

  // Replace a global with `replacement`, defeating non-writable/accessor props by
  // delete-then-redefine, falling back to plain assignment. Returns the technique
  // that actually stuck, so the harness can report HOW each global was neutralized.
  function neutralize(name, replacement) {
    try { delete window[name]; } catch (e) {}
    try {
      Object.defineProperty(window, name, {
        value: replacement, writable: false, configurable: false, enumerable: false,
      });
      return 'redefined';
    } catch (e) {}
    try {
      window[name] = replacement;
      return 'assigned';
    } catch (e) {}
    return 'non-configurable'; // could not touch it on window → runner.js shadows it
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

  // Network primitives
  report.fetch = neutralize('fetch', throwingFn('fetch'));
  report.XMLHttpRequest = neutralize('XMLHttpRequest', throwingFn('XMLHttpRequest'));
  report.WebSocket = neutralize('WebSocket', throwingFn('WebSocket'));
  report.EventSource = neutralize('EventSource', throwingFn('EventSource'));
  report.RTCPeerConnection = neutralize('RTCPeerConnection', throwingFn('RTCPeerConnection'));

  // Dynamic code execution — DELIBERATELY NOT value-replaced here.
  //   • `eval` / `Function` are killed at the engine level by the iframe CSP
  //     (`script-src` without 'unsafe-eval'), which ALSO closes the
  //     `({}).constructor.constructor('…')` constructor-walk hole that value
  //     replacement can never reach.
  //   • Replacing the `Function` global by value would over-strip (D3): React's
  //     internals do `x instanceof Function` / touch `Function.prototype`, so a
  //     stub would break the render path. We strip the *capability* (codegen via
  //     CSP), not the *identifier*. The probe checklist verifies the call throws.
  report.eval = 'csp (script-src has no unsafe-eval)';
  report.Function = 'csp (script-src has no unsafe-eval)';

  // Ambient persistence + threading
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

  // Expose how each global was neutralized so the spike can record the technique.
  window.__WHIM_NEUTRALIZE_REPORT__ = report;
})();
