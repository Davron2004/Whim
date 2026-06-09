// THROWAWAY SPIKE CODE — #35 surgical global strip, copied from
// invariants/sandbox-isolation/reference/neutralize.js (the proven Spike-1 shim) and
// kept verbatim in behavior. Runs FIRST inside the iframe, before any bundle delivery.
// eval/Function are NOT value-replaced — the CSP (script-src without unsafe-eval) kills
// them at the engine level, including the ({}).constructor.constructor walk.
(function neutralizeForbiddenGlobals() {
  'use strict';

  function throwingFn(name) {
    return function whimForbidden() {
      throw new TypeError(name + ' is disabled in the Whim sandbox (Layer-3 escape hatch)');
    };
  }

  function neutralize(name, replacement) {
    try { delete window[name]; } catch (e) {}
    try {
      Object.defineProperty(window, name, {
        value: replacement, writable: false, configurable: false, enumerable: false,
      });
      return 'redefined';
    } catch (e) {}
    try { window[name] = replacement; return 'assigned'; } catch (e) {}
    return 'non-configurable';
  }

  function inertStore(name) {
    var handler = {
      get: function () { throw new TypeError(name + ' is disabled in the Whim sandbox'); },
      set: function () { throw new TypeError(name + ' is disabled in the Whim sandbox'); },
      apply: function () { throw new TypeError(name + ' is disabled in the Whim sandbox'); },
    };
    try { return new Proxy(function () {}, handler); } catch (e) { return undefined; }
  }

  var report = {};
  report.fetch = neutralize('fetch', throwingFn('fetch'));
  report.XMLHttpRequest = neutralize('XMLHttpRequest', throwingFn('XMLHttpRequest'));
  report.WebSocket = neutralize('WebSocket', throwingFn('WebSocket'));
  report.EventSource = neutralize('EventSource', throwingFn('EventSource'));
  report.RTCPeerConnection = neutralize('RTCPeerConnection', throwingFn('RTCPeerConnection'));

  // eval/Function: CSP-handled, deliberately not value-replaced (D3 over-strip risk).
  report.eval = 'csp (script-src has no unsafe-eval)';
  report.Function = 'csp (script-src has no unsafe-eval)';

  report.localStorage = neutralize('localStorage', inertStore('localStorage'));
  report.sessionStorage = neutralize('sessionStorage', inertStore('sessionStorage'));
  report.indexedDB = neutralize('indexedDB', inertStore('indexedDB'));
  report.caches = neutralize('caches', inertStore('caches'));
  report.Worker = neutralize('Worker', throwingFn('Worker'));
  report.SharedWorker = neutralize('SharedWorker', throwingFn('SharedWorker'));

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
