// ─────────────────────────────────────────────────────────────────────────────
// Whim Spike 1 — sandbox runner (LAST script in the iframe; orchestrates everything)
// ─────────────────────────────────────────────────────────────────────────────
// Build order is D4: make-it-run, THEN prove-it-contained. The runner owns both,
// plus the transport shim, the `require` resolver, and the shadowed scope (D3).
(function whimRunner() {
  'use strict';
  var T0 = (window.performance && window.performance.now) ? window.performance.now() : Date.now();

  // ── Transport shim (spec §5.6) ──────────────────────────────────────────────
  // The bundle calls `window.ReactNativeWebView.postMessage`. Inside this opaque-
  // origin iframe that is OUR shim, which forwards the string cross-origin to the
  // host window; the host relays it to the REAL native bridge. The bundle can't
  // tell it isn't talking to the bridge directly, and the iframe never holds one.
  window.ReactNativeWebView = {
    postMessage: function (s) {
      try { window.parent.postMessage(String(s), '*'); } catch (e) {}
    },
  };

  // Structured channel the harness uses to ship paint timing + probe results out.
  function post(kind, payload) {
    try {
      window.parent.postMessage(JSON.stringify({ __whimHarness: true, kind: kind, payload: payload }), '*');
    } catch (e) {}
  }

  // ── Module resolution: ONLY the injected SDK resolves (task 3.4) ─────────────
  function require(name) {
    if (name === '@whim/sdk') return window.__WHIM_SDK__;
    throw new Error("Cannot find module '" + name + "' — the Whim sandbox exposes only '@whim/sdk'");
  }

  var React = window.React;
  var ReactDOM = window.ReactDOM;
  var rootEl = document.getElementById('whim-root');

  // ── Shadowed execution scope (D3) ───────────────────────────────────────────
  // Lexically shadow the value-type forbidden globals so that even one the engine
  // marked non-configurable (where neutralize.js's delete/redefine failed) reads as
  // `undefined` to the bundle. eval/Function are absent on purpose: `eval` is a
  // reserved binding (can't be shadowed in strict mode) and `Function` is reachable
  // via constructor-walk regardless — CSP is what neutralizes those.
  function runInShadowedScope() {
    'use strict';
    var fetch = void 0, XMLHttpRequest = void 0, WebSocket = void 0, EventSource = void 0,
        Worker = void 0, SharedWorker = void 0, localStorage = void 0, sessionStorage = void 0,
        indexedDB = void 0, caches = void 0, RTCPeerConnection = void 0, importScripts = void 0;
    // reference them once so minifiers/strict-mode "unused" checks stay quiet and
    // the shadow bindings provably exist in this scope:
    void [fetch, XMLHttpRequest, WebSocket, EventSource, Worker, SharedWorker,
      localStorage, sessionStorage, indexedDB, caches, RTCPeerConnection, importScripts];

    /*__WHIM_BUNDLE__*/   // hand-written mini-app → defines function App()
    /*__WHIM_PROBES__*/   // probe checklist       → defines function __whimRunProbes()

    // 1) make-it-run (D4 step 1 — sandbox-rendering)
    var root = ReactDOM.createRoot(rootEl);
    root.render(React.createElement(App));

    // Measure mount→first-paint with a double rAF (fires after the first paint).
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        var T1 = (window.performance && window.performance.now) ? window.performance.now() : Date.now();
        post('paint', { mountToFirstPaintMs: Math.round((T1 - T0) * 100) / 100 });

        // 2) prove-it-contained (D4 step 2 — sandbox-isolation)
        __whimRunProbes().then(function (result) {
          post('probes', result);
        }, function (err) {
          post('error', { where: 'probes', name: err && err.name, message: err && String(err.message) });
        });
      });
    });
  }

  try {
    runInShadowedScope();
  } catch (e) {
    post('error', { where: 'runInShadowedScope', name: e && e.name, message: e && String(e && e.message) });
  }
})();
