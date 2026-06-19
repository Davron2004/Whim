// ─────────────────────────────────────────────────────────────────────────────
// Whim runtime — channel-(b) trusted loader (decision #37 / docs/spike2-findings.md).
// ─────────────────────────────────────────────────────────────────────────────
// Runs LAST inside the iframe (after neutralize → react/react-dom inject → resolver →
// vc-sdk inject → probes). It owns: the one-way transport shim, the bundle DELIVERY
// (channel b: a DOM-inserted inline <script> via textContent — NOT eval, NOT a module), the
// React-to-DOM mount, the mount→first-paint measurement, and the TRUSTED-VANTAGE containment
// verdict.
//
// Carry-forward constraints honored here (D4):
//   #2 — the loader holds NO capability stronger than parent.postMessage. What it leaves
//        reachable on `window`: the postMessage stub, the allowlist resolver (resolver.js),
//        a number (__whimGeneration), and __whimAfterBundle (touches only React/ReactDOM —
//        pure UI libs). The trusted-probe ref and the host nonce live in THIS closure, never
//        on window.
//   #3 — TRUSTED VANTAGE: we capture the genuine `__whimRunProbes` into a closure var BEFORE
//        any bundle runs, and call the captured ref. A malicious bundle that overwrites
//        `window.__whimRunProbes` (the evil fixture does) cannot change the verdict we post.
//   #4 — every genuine loader→host frame is tagged with a per-realm secret NONCE the host
//        sent us before the first bundle was delivered (and which we never expose on window).
//        The bundle, delivered later, never saw it and cannot forge an authenticated frame.
(function whimLoaderChannelB() {
  'use strict';
  var T0 = (window.performance && window.performance.now) ? window.performance.now() : Date.now();

  // CONSTRAINT #3: snapshot the genuine probe fn before any untrusted code can overwrite it.
  var trustedRunProbes = (typeof __whimRunProbes === 'function') ? __whimRunProbes : null;

  // CONSTRAINT #4: the per-realm authentication nonce, sent by the host before delivery and
  // kept ONLY in this closure (never on window). null until the host's init frame arrives.
  var hostNonce = null;

  // ── Transport shim (§5.6 / D7) ──────────────────────────────────────────────
  // The bundle calls window.ReactNativeWebView.postMessage(string); inside this opaque-origin
  // iframe that is OUR stub, forwarding the string cross-origin to the host page. The bundle
  // can't tell it isn't the native bridge, and the iframe never holds one. UI events from the
  // SDK (and a forgeable spoof from a malicious bundle) both ride this — the host MUST treat
  // all inbound frames as untrusted data and authenticate by nonce (constraint #4).
  window.ReactNativeWebView = {
    postMessage: function (s) { try { window.parent.postMessage(String(s), '*'); } catch (e) {} },
  };

  // ── nav-depth seam anchor (launcher-shell / #5 D4 — the #3 SDK half's TODO) ──
  // The back-navigation contract rides THIS same one-way transport (no new capability):
  //   • SDK → host (hint): the SDK runtime (sdk-design-system / #3) posts, on every nav-stack
  //     depth change, `window.parent.postMessage(JSON.stringify({__whimNavDepth:true,
  //     depth:<n>, generation: window.__whimGeneration}), '*')`. The outer page source-verifies
  //     and relays it to RN as kind:'nav-depth'. Unauthenticated by design (F4): a hint, never
  //     authority — the host back-policy owns whether the user can leave.
  //   • host → realm (request): the host posts `{__whimNavBack:true}` into this iframe on
  //     system back when depth>0; #3's SDK message listener pops one screen and re-emits
  //     nav-depth. (No SDK nav exists yet, so nothing emits/consumes these in this change;
  //     depth is always 0 and back exits at the root. This block is the contract anchor only —
  //     it adds NO runtime behavior, keeping the iframe loader byte-stable for containment.)

  // Genuine, authenticated loader→host control frame (carries the secret nonce).
  function post(kind, payload) {
    try {
      window.parent.postMessage(
        JSON.stringify({ __whimHarness: true, nonce: hostNonce, kind: kind, payload: payload }),
        '*',
      );
    } catch (e) {}
  }

  // generation counter (T7 / constraint #5): how many bundles have run in THIS realm. The host
  // resets the realm (re-creates the iframe) per generation, so in practice this is 1 here;
  // the counter + the in-place re-injection path remain so the seam is real and measurable.
  window.__whimGeneration = 0;
  var whimRoot = null;      // reused across any same-realm re-injection
  var mountedGen = -1;      // guard: mount each generation at most once

  // ── Mount + paint + TRUSTED verdict (tasks 5.1 / 5.4 / 6.2) ──────────────────
  window.__whimAfterBundle = function () {
    if (mountedGen === window.__whimGeneration) return; // already mounted this generation
    mountedGen = window.__whimGeneration;
    var React = window.React, ReactDOM = window.ReactDOM;
    var appModule = (typeof window.__WHIM_APP_MODULE__ !== 'undefined') ? window.__WHIM_APP_MODULE__ : null;
    if (!appModule || !appModule.default) {
      post('error', { where: 'bundle', message: 'no AppSpec default export (did the inline script execute?)' });
      return;
    }
    var spec = appModule.default;
    var gen = window.__whimGeneration;
    try {
      if (!whimRoot) whimRoot = ReactDOM.createRoot(document.getElementById('whim-root'));
      // The bundle does not know it is in an iframe/WebView — it just described screens.
      whimRoot.render(React.createElement(spec.screens[spec.initial]));
    } catch (e) {
      post('error', { where: 'mount', name: e && e.name, message: e && String(e.message) });
      return;
    }
    // double rAF fires after the first paint → honest mount→first-paint.
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        var T1 = (window.performance && window.performance.now) ? window.performance.now() : Date.now();
        post('paint', { generation: gen, mountToFirstPaintMs: Math.round((T1 - T0) * 100) / 100, appName: spec.name });
        // CONSTRAINT #3: call the CLOSURE-CAPTURED probe fn, never window.__whimRunProbes.
        if (!trustedRunProbes) { post('error', { where: 'probes', message: 'trusted probe fn missing' }); return; }
        trustedRunProbes().then(
          function (r) { r.generation = gen; post('probes', r); },
          function (e) { post('error', { where: 'probes', name: e && e.name, message: e && String(e.message) }); }
        );
      });
    });
  };

  // ── Delivery (channel b) + host init (tasks 4.3 / 6.1) ───────────────────────
  var deliveryBusy = false;
  window.addEventListener('message', function (ev) {
    var data = ev.data;
    if (typeof data !== 'string') return;
    var msg;
    try { msg = JSON.parse(data); } catch (e) { return; }
    if (!msg) return;

    // Host-channel-only acceptance (A1 — mirrors syscall.js's ev.source guard): a frame posted by a
    // bundle sharing this realm has ev.source === window, not window.parent. Drop it. Without this, a
    // delivered bundle could self-post __whimDeliver on a later tick to forge a delivery — bumping
    // __whimGeneration, injecting its payload, and posting a host frame carrying the closure-captured
    // real nonce (indistinguishable to the host) — corrupting the host's generation state machine.
    if (ev.source !== window.parent) return;

    // Host init: the FIRST one wins and is locked in. It arrives before any bundle is
    // delivered, so a later (untrusted) bundle cannot re-set or read this nonce.
    if (msg.__whimHostInit === true && hostNonce === null) {
      hostNonce = msg.nonce || '';
      post('ready', { generation: window.__whimGeneration });
      // Channel (a) fallback: the bundle was baked into the srcdoc as a parser-inserted
      // <script> that already ran (proving the engine executes a parser-inserted inline
      // script under the locked CSP) and set window.__WHIM_APP_MODULE__. The host does NOT
      // deliver in channel (a); mount the pre-baked module now (after the nonce is set so the
      // verdict is authenticated). Channel (b) has no module yet here → this is a no-op.
      if (typeof window.__WHIM_APP_MODULE__ !== 'undefined' && window.__WHIM_APP_MODULE__) {
        window.__whimGeneration = window.__whimGeneration + 1;
        window.__whimAfterBundle();
      }
      return;
    }

    if (msg.__whimDeliver !== true || deliveryBusy) return;
    deliveryBusy = true;
    window.__whimGeneration = (window.__whimGeneration || 0) + 1;
    try {
      // Wrap the bundle so (a) its externalized `require` resolves through the H1b resolver,
      // (b) it gets a benign CommonJS {exports} shim, and (c) the value-type forbidden globals
      // are lexically shadowed in its scope (task 2.5 — belt-and-suspenders ONLY; the
      // window-level strip is the real defense and is what the probes/T1 exercise). eval/
      // Function are NOT shadowed: `eval` is a reserved binding in strict mode and `Function`
      // is reachable via constructor-walk regardless — the CSP neutralizes those.
      var wrapped =
        '(function(){ "use strict";\n' +
        '  var fetch=void 0, XMLHttpRequest=void 0, WebSocket=void 0, EventSource=void 0,\n' +
        '      Worker=void 0, SharedWorker=void 0, localStorage=void 0, sessionStorage=void 0,\n' +
        '      indexedDB=void 0, caches=void 0, RTCPeerConnection=void 0, importScripts=void 0;\n' +
        '  void [fetch,XMLHttpRequest,WebSocket,EventSource,Worker,SharedWorker,localStorage,\n' +
        '        sessionStorage,indexedDB,caches,RTCPeerConnection,importScripts];\n' +
        '  var require = window.__whimRequire;\n' +
        '  var module = { exports: {} }, exports = module.exports;\n' +
        msg.bundle + '\n' +
        '  if (typeof __WHIM_APP_MODULE__ !== "undefined") window.__WHIM_APP_MODULE__ = __WHIM_APP_MODULE__;\n' +
        '})();\n' +
        'window.__whimAfterBundle && window.__whimAfterBundle();';
      if (msg.viaBlob === true) {
        // Channel (c) REFUSAL invariant (task 4.5): a blob:/data: <script src> must stay
        // REFUSED under the locked CSP (`script-src 'unsafe-inline'` has no `blob:`). We try
        // it on purpose; it must NOT execute. Never widen script-src to make this "work" — an
        // attacker who can mint a same-origin blob would gain a script surface.
        var blobUrl = URL.createObjectURL(new Blob([wrapped], { type: 'application/javascript' }));
        var bs = document.createElement('script');
        bs.src = blobUrl;
        (document.head || document.documentElement).appendChild(bs);
        window.setTimeout(function () {
          var ran = (typeof window.__WHIM_APP_MODULE__ !== 'undefined') && !!window.__WHIM_APP_MODULE__;
          post('delivery', {
            accepted: ran, via: 'blob', refused: !ran, generation: window.__whimGeneration,
            note: ran ? 'BLOB SCRIPT RAN (CSP breach!)' : 'blob script refused by CSP (never widen script-src)',
          });
          try { URL.revokeObjectURL(blobUrl); } catch (e) {}
          deliveryBusy = false;
        }, 60);
        return; // do not fall through to the inline path
      }
      var s = document.createElement('script');
      s.textContent = wrapped; // DOM-inserted INLINE script (NOT eval) — runs synchronously on append
      (document.head || document.documentElement).appendChild(s);
      post('delivery', { accepted: true, generation: window.__whimGeneration, note: 'DOM-inserted inline script appended without throwing' });
    } catch (e) {
      post('delivery', { accepted: false, generation: window.__whimGeneration, name: e && e.name, message: e && String(e.message) });
      post('error', { where: 'deliver', name: e && e.name, message: e && String(e.message) });
    }
    deliveryBusy = false; // re-injection ready (a new generation in the SAME realm)
  });

  // Announce liveness so the host sends the init nonce, then the bundle.
  // (We post WITHOUT a nonce here on purpose — it is the only pre-auth frame; the host keys
  // off kind:'hello' and replies with the nonce. All later genuine frames carry the nonce.)
  try {
    window.parent.postMessage(JSON.stringify({ __whimHarness: true, kind: 'hello' }), '*');
  } catch (e) {}
})();
