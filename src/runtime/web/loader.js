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
//        a read-only number (__whimGeneration), and a read-only __whimAfterBundle (touches only
//        React/ReactDOM — pure UI libs). The trusted-probe ref and the host nonce live in THIS
//        closure, never on window.
//   #3 — TRUSTED VANTAGE: we capture the genuine `__whimRunProbes` into a closure var BEFORE
//        any bundle runs, and call the captured ref. A malicious bundle that overwrites
//        `window.__whimRunProbes` (the evil fixture does) cannot substitute its own verdict.
//        The probes still run in the realm the bundle ran in and measure it as the bundle left
//        it (docs/security/2026-11-19-verdict-channel.md, "What stays out of reach").
//   #4 — every genuine loader→host frame is tagged with a per-realm secret NONCE the host
//        sent us before the first bundle was delivered (and which we never expose on window).
//        The bundle, delivered later, never saw it and cannot forge an authenticated frame.
//        "Never exposed" covers more than `window`: once a bundle runs, every global and every
//        built-in prototype in this realm is its to rewrite, so the nonce, the frame envelope and
//        the transport must never pass through anything read live (see "Captured before any app
//        code runs" below). The host hands the nonce out once per iframe (build/assemble.mjs).
(function whimLoaderChannelB() {
  'use strict';

  // ── Captured before any app code runs (constraint #4) ───────────────────────
  // A bundle shares this realm. `window.parent` is a [Replaceable] attribute, JSON, Promise and
  // requestAnimationFrame are writable globals, and a getter or a toJSON planted on a prototype
  // runs inside any code that reads through it. Read live, each let app code read the nonce off
  // a loader frame, relabel or reroute one, feed the loader's verdict callback, start a delivery
  // from an unrelated host frame, or keep the paint and the verdict from ever posting. So the
  // loader takes what its trusted path needs now; this script runs before any bundle can.
  const PARENT = window.parent;
  const apply = Reflect.apply;
  const parentPost = PARENT.postMessage;
  const stringify = JSON.stringify;
  const parse = JSON.parse;
  const hasOwn = Object.prototype.hasOwnProperty;
  const ownKeys = Reflect.ownKeys;
  const ownDescriptor = Reflect.getOwnPropertyDescriptor;
  const defineOwn = Reflect.defineProperty;
  const setPrototype = Reflect.setPrototypeOf;
  const isArray = Array.isArray;
  const promiseThen = Promise.prototype.then;
  const nextFrame = window.requestAnimationFrame;
  const eventSource = ownDescriptor(MessageEvent.prototype, 'source').get;
  const eventData = ownDescriptor(MessageEvent.prototype, 'data').get;
  const React = window.React;
  const ReactDOM = window.ReactDOM;
  const rootElement = document.getElementById('whim-root');

  // An own property of a parsed host frame, never an inherited one (a getter on Object.prototype
  // must not be able to answer for a field the host did not send).
  function own(obj, key) {
    return apply(hasOwn, obj, [key]) ? obj[key] : undefined;
  }

  function now() {
    return window.performance?.now ? window.performance.now() : Date.now();
  }
  const T0 = now();

  // Capture the repository-internal mount root before any bundle can run, then erase the
  // transient bootstrap seam. Mini-apps can resolve only the public `vc-sdk` namespace.
  const internalSdkDescriptor = Object.getOwnPropertyDescriptor(
    window,
    '__WHIM_VC_SDK_INTERNAL__',
  );
  const internalSdk = window.__WHIM_VC_SDK_INTERNAL__;
  if (
    !internalSdkDescriptor ||
    internalSdkDescriptor.enumerable !== false ||
    internalSdkDescriptor.writable !== false ||
    internalSdkDescriptor.configurable !== true ||
    !internalSdk ||
    Object.isFrozen(internalSdk) !== true ||
    typeof internalSdk.NavRoot !== 'function'
  ) {
    throw new TypeError('trusted vc-sdk navigation bootstrap is missing or invalid');
  }
  const trustedNavRoot = internalSdk.NavRoot;
  if (!delete window.__WHIM_VC_SDK_INTERNAL__ || '__WHIM_VC_SDK_INTERNAL__' in window) {
    throw new TypeError('trusted vc-sdk navigation bootstrap could not be erased');
  }

  // CONSTRAINT #3: snapshot the genuine probe fn before any untrusted code can overwrite it.
  const trustedRunProbes = (typeof __whimRunProbes === 'function') ? __whimRunProbes : null;

  // Neutralization's native-bridge record (neutralize.js): which native bridges were in this frame
  // when the runtime started and whether they were removed. Captured here and the transient global
  // erased, so the verdict's `bridge` field comes from this closure, never from anything app code
  // can write. A record that is missing or not neutralize's frozen one reports as null.
  const bridgeRecordDescriptor = Object.getOwnPropertyDescriptor(window, '__WHIM_BRIDGE_RECORD__');
  const bridgeRecord = (
    bridgeRecordDescriptor &&
    bridgeRecordDescriptor.writable === false &&
    bridgeRecordDescriptor.configurable === true &&
    bridgeRecordDescriptor.value !== null &&
    typeof bridgeRecordDescriptor.value === 'object' &&
    Object.isFrozen(bridgeRecordDescriptor.value)
  ) ? bridgeRecordDescriptor.value : null;
  try { delete window.__WHIM_BRIDGE_RECORD__; } catch (e) {}

  // CONSTRAINT #4: the head of every authenticated frame, `{"__whimHarness":true,"nonce":"…","kind":`,
  // built once from the host's init frame (which arrives before any app code runs) and kept ONLY
  // in this closure. The nonce exists nowhere else, and frames are assembled by concatenation, so
  // it never passes through a function app code could have replaced. null until init arrives.
  let envelopeHead = null;
  const UNAUTHENTICATED_HEAD = '{"__whimHarness":true,"nonce":null,"kind":';

  // ── Transport shim (§5.6 / D7) ──────────────────────────────────────────────
  // The bundle calls window.ReactNativeWebView.postMessage(string); inside this opaque-origin
  // iframe that is OUR stub, forwarding the string cross-origin to the host page. The bundle
  // can't tell it isn't the native bridge, and the iframe never holds one. UI events from the
  // SDK (and a forgeable spoof from a malicious bundle) both ride this — the host MUST treat
  // all inbound frames as untrusted data and authenticate by nonce (constraint #4).
  // neutralize.js already removed any native bridge the platform put here. If one could not be
  // removed (a non-writable property), the assignment fails without aborting the loader, and the
  // `reach` probe "frame bridge is the loader stub" reports the frame as not contained. The stub's
  // identity is kept in this closure for that probe.
  const transportStub = {
    postMessage: function (s) { try { apply(parentPost, PARENT, [String(s), '*']); } catch (e) {} },
  };
  try { window.ReactNativeWebView = transportStub; } catch (e) {}

  // ── nav-depth seam anchor (launcher-shell / #5 D4 — consumed by SDK navigation) ────────
  // The back-navigation contract rides THIS same one-way transport (no new capability):
  //   • SDK → host (hint): the SDK navigation root posts, on every nav-stack
  //     depth change, `window.parent.postMessage(JSON.stringify({__whimNavDepth:true,
  //     depth:<n>, generation: window.__whimGeneration}), '*')`. The outer page source-verifies
  //     and relays it to RN as kind:'nav-depth'. Unauthenticated by design (F4): a hint, never
  //     authority — the host back-policy owns whether the user can leave.
  //   • host → realm (request): the host posts `{__whimNavBack:true}` into this iframe on
  //     system back when depth>0; the SDK navigation root's message listener pops one screen
  //     and re-emits nav-depth. The loader only anchors the frame seam; the SDK emits and
  //     consumes the frames without adding a capability to this trusted closure.

  // A payload copied as plain data before it is serialized: own, enumerable, string-keyed data
  // properties only, into prototype-less objects and arrays, so serializing the copy runs no getter
  // and no inherited toJSON. The loader then reports exactly the values it was handed. A cycle, a
  // value nested deeper than MAX_DEPTH, and everything past the first MAX_NODES objects become null.
  const MAX_DEPTH = 32;
  const MAX_NODES = 20000;
  function plainCopy(value) {
    const path = { __proto__: null }; // the objects on the current path, by depth
    let nodes = 0;
    function copyOf(v, depth) {
      if (v === null) return null;
      const type = typeof v;
      if (type === 'string' || type === 'number' || type === 'boolean') return v;
      if (type !== 'object') return undefined; // undefined, function, symbol, bigint: no JSON value
      if (depth >= MAX_DEPTH || ++nodes > MAX_NODES) return null;
      for (let i = 0; i < depth; i++) if (path[i] === v) return null;
      path[depth] = v;
      const array = isArray(v);
      const copy = array ? [] : { __proto__: null };
      const keys = ownKeys(v);
      for (let i = 0; i < keys.length; i++) {
        const key = keys[i];
        if (typeof key !== 'string') continue;
        const desc = ownDescriptor(v, key);
        if (!desc || desc.enumerable !== true || !apply(hasOwn, desc, ['value'])) continue;
        const item = copyOf(desc.value, depth + 1);
        if (item === undefined && !array) continue;
        defineOwn(copy, key, { __proto__: null, value: item, writable: true, enumerable: true, configurable: true });
      }
      if (array) setPrototype(copy, null);
      return copy;
    }
    return copyOf(value, 0);
  }

  // Genuine, authenticated loader→host control frame (carries the secret nonce). Same JSON as
  // `{__whimHarness:true, nonce, kind, payload}`, assembled by concatenation: `kind` is always one
  // of this file's literals, so app code can neither read the nonce nor change the kind.
  function post(kind, payload) {
    try {
      const body = payload === undefined ? undefined : stringify(plainCopy(payload));
      const frame = (envelopeHead === null ? UNAUTHENTICATED_HEAD : envelopeHead) + stringify(kind) +
        (typeof body === 'string' ? ',"payload":' + body : '') + '}';
      apply(parentPost, PARENT, [frame, '*']);
    } catch (e) {}
  }

  // ── Uncaught realm errors (developer-observability D6) ───────────────────────
  // A throw in an event handler or a timer and an unhandled rejection surface on this window.
  // Each is reported as the SAME nonce-authenticated `error` frame with the error's NAME only:
  // the message and stack can carry user data and never leave the realm. Installed before any
  // bundle runs; the listener refs live in this closure, so a bundle cannot remove them. A
  // render error that escapes the app is reported by the root instead (below), as `render`.
  function errorName(x) {
    try {
      const n = x !== null && typeof x === 'object' ? x.name : undefined;
      return typeof n === 'string' && n ? n : 'NonError';
    } catch {
      // deliberately silent: x is a hostile thrown value from the mini-app realm, so reading
      // `.name` off it (e.g. via a throwing getter) must never throw out of this listener.
      return 'NonError';
    }
  }
  // The render error the root is passing on to reportError right now: already reported as
  // `render`, so the window listener must not report it a second time as `runtime`.
  let forwardingRenderError = false;
  window.addEventListener('error', function (ev) {
    if (forwardingRenderError) return;
    post('error', { where: 'runtime', name: errorName(ev.error) });
  });
  window.addEventListener('unhandledrejection', function (ev) {
    post('error', { where: 'rejection', name: errorName(ev.reason) });
  });

  // ── A focused input stays visible (beta-1 D3) ────────────────────────────────
  // The keyboard opening shrinks the viewport (on Android because the host ends the WebView at the
  // keyboard's top edge, `MiniAppView`), which can leave the field the user just tapped underneath
  // it. The focused editable element is scrolled into view when it gains focus, and
  // again one frame after each viewport resize while it keeps focus (the frame lets the resized
  // layout settle first). The listeners live in this closure: nothing new is reachable on window.
  function isEditable(el) {
    return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable === true);
  }
  function reveal(el) {
    if (!isEditable(el)) return;
    try {
      el.scrollIntoView({ block: 'nearest' });
    } catch {
      // deliberately silent: `el` is an element the mini-app rendered; failing to scroll it must
      // never throw out of this listener.
    }
  }
  document.addEventListener('focusin', function (ev) { reveal(ev.target); });
  (window.visualViewport || window).addEventListener('resize', function () {
    requestAnimationFrame(function () { reveal(document.activeElement); });
  });

  // generation counter (T7 / constraint #5): how many bundles have run in THIS realm. The host
  // resets the realm (re-creates the iframe) per generation, so in practice this is 1 here;
  // the counter + the in-place re-injection path remain so the seam is real and measurable.
  // The count lives in this closure; `window.__whimGeneration` is a read-only view of it, so app
  // code can read it (the SDK and the T7 probe do) but cannot rewrite it to skip the mount.
  let generation = 0;
  Object.defineProperty(window, '__whimGeneration', {
    get: function () { return generation; }, enumerable: true, configurable: false,
  });
  let whimRoot = null;      // reused across any same-realm re-injection
  let mountedGen = -1;      // guard: mount each generation at most once

  // ── Render failures (beta-1 D4) ───────────────────────────────────────────────
  // The runtime-owned root boundary: React hands this root option every error that no boundary
  // inside the app caught, during render, a commit or an effect, and unmounts the app, which
  // leaves the realm blank. It lives in this closure and is passed to createRoot, so a bundle
  // can neither reach nor replace it. The host treats `render` as fatal, so it is posted once per
  // realm, name only. The error is then passed on to reportError, as React does by default, so
  // developer tooling still sees its message and stack; the window listener above skips it.
  let renderFailureReported = false;
  function onUncaughtRenderError(error) {
    if (!renderFailureReported) {
      renderFailureReported = true;
      post('error', { where: 'render', name: errorName(error) });
    }
    if (typeof window.reportError !== 'function') return;
    forwardingRenderError = true;
    try {
      window.reportError(error);
    } finally {
      forwardingRenderError = false;
    }
  }

  // ── Mount + paint + TRUSTED verdict (tasks 5.1 / 5.4 / 6.2) ──────────────────
  // Called by the wrapped bundle's last line. Installed read-only and non-configurable: a bundle
  // that could swap it would decide whether, and when, its own paint and verdict get posted.
  function afterBundle() {
    if (mountedGen === generation) return; // already mounted this generation
    mountedGen = generation;
    const appModule = (typeof window.__WHIM_APP_MODULE__ !== 'undefined') ? window.__WHIM_APP_MODULE__ : null;
    if (!appModule || !appModule.default) {
      post('error', { where: 'bundle', message: 'no AppSpec default export (did the inline script execute?)' });
      return;
    }
    const spec = appModule.default;
    const gen = generation;
    try {
      if (!whimRoot) {
        whimRoot = ReactDOM.createRoot(rootElement, { onUncaughtError: onUncaughtRenderError });
      }
      // The bundle does not know it is in an iframe/WebView — it just described screens.
      whimRoot.render(React.createElement(trustedNavRoot, { spec: spec, chromeInsetBottom: chromeInsetBottom }));
    } catch (e) {
      post('error', { where: 'mount', name: e && e.name, message: e && String(e.message) });
      return;
    }
    // double rAF fires after the first paint → honest mount→first-paint.
    apply(nextFrame, window, [function () {
      apply(nextFrame, window, [function () {
        const T1 = now();
        post('paint', { generation: gen, mountToFirstPaintMs: Math.round((T1 - T0) * 100) / 100, appName: spec.name });
        // CONSTRAINT #3: call the CLOSURE-CAPTURED probe fn, never window.__whimRunProbes, and
        // settle it through the captured `then`, so app code never holds the callbacks below.
        if (!trustedRunProbes) { post('error', { where: 'probes', message: 'trusted probe fn missing' }); return; }
        apply(promiseThen, trustedRunProbes({ stub: transportStub }), [
          function (r) {
            const verdict = plainCopy(r);
            if (verdict !== null && typeof verdict === 'object') {
              defineOwn(verdict, 'generation', { __proto__: null, value: gen, writable: true, enumerable: true, configurable: true });
              // A side field like t7: reported, never counted in `total` or `contained`.
              defineOwn(verdict, 'bridge', { __proto__: null, value: plainCopy(bridgeRecord), writable: true, enumerable: true, configurable: true });
            }
            post('probes', verdict);
          },
          function (e) { post('error', { where: 'probes', name: e && e.name, message: e && String(e.message) }); },
        ]);
      }]);
    }]);
  }
  Object.defineProperty(window, '__whimAfterBundle', {
    value: afterBundle, writable: false, enumerable: true, configurable: false,
  });

  // ── Delivery (channel b) + host init (tasks 4.3 / 6.1) ───────────────────────
  let deliveryBusy = false;

  // How much of the realm's bottom edge the host's orb covers (beta-1 D5), from the init frame's
  // theme. It stays in this closure and reaches the SDK only as a prop of its trusted root: it is
  // kept off `window` and out of the theme global, so no global or SDK API hands it to generated
  // code. The host already clamps it; it is sanitized again here because the frame is data.
  let chromeInsetBottom = 0;
  function sanitizeChromeInset(value) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
    return Math.min(200, Math.max(0, Math.round(value)));
  }

  function installTheme(theme) {
    if (theme === null || typeof theme !== 'object') return false;
    try {
      const { chromeInsetBottom: inset, ...colorTheme } = theme;
      chromeInsetBottom = sanitizeChromeInset(inset);
      globalThis.__WHIM_THEME__ = Object.freeze(colorTheme);
      return true;
    } catch {
      // A malformed or non-extensible theme must leave the SDK fallback available for delivery.
      return false;
    }
  }

  function handleHostInit(msg) {
    if (own(msg, '__whimHostInit') !== true || envelopeHead !== null) return false;

    const nonce = own(msg, 'nonce');
    envelopeHead = '{"__whimHarness":true,"nonce":' + stringify(typeof nonce === 'string' ? nonce : '') + ',"kind":';
    // Optional inert theme payload (sdk-design-system D1): installed as a frozen global
    // BEFORE any bundle mount can occur (hostInit always precedes delivery). Invalid input
    // leaves no usable global, so the SDK falls back to its own defaults.
    installTheme(own(msg, 'theme'));
    post('ready', { generation: generation });

    // Channel (a) fallback: the bundle was baked into the srcdoc as a parser-inserted
    // <script> (proving the engine executes one under the locked CSP) that only defined it.
    // The host does NOT deliver in channel (a); run and mount the baked bundle now, after the
    // nonce is set, so no app code was listening when the init frame arrived and the verdict
    // is authenticated. Channel (b) has nothing baked → this is a no-op.
    const baked = window.__whimBakedBundle;
    if (typeof baked === 'function') {
      delete window.__whimBakedBundle;
      generation = generation + 1;
      baked();
      afterBundle();
    }
    return true;
  }

  function wrappedBundleSource(bundle) {
    // Wrap the bundle so (a) its externalized `require` resolves through the H1b resolver,
    // (b) it gets a benign CommonJS {exports} shim, and (c) the value-type forbidden globals
    // are lexically shadowed in its scope (task 2.5 — belt-and-suspenders ONLY; the
    // window-level strip is the real defense and is what the probes/T1 exercise). eval/
    // Function are NOT shadowed: `eval` is a reserved binding in strict mode and `Function`
    // is reachable via constructor-walk regardless — the CSP neutralizes those.
    return (
      '(function(){ "use strict";\n' +
      '  var fetch=void 0, XMLHttpRequest=void 0, WebSocket=void 0, EventSource=void 0,\n' +
      '      Worker=void 0, SharedWorker=void 0, localStorage=void 0, sessionStorage=void 0,\n' +
      '      indexedDB=void 0, caches=void 0, RTCPeerConnection=void 0, importScripts=void 0;\n' +
      '  void [fetch,XMLHttpRequest,WebSocket,EventSource,Worker,SharedWorker,localStorage,\n' +
      '        sessionStorage,indexedDB,caches,RTCPeerConnection,importScripts];\n' +
      '  var require = window.__whimRequire;\n' +
      '  var module = { exports: {} }, exports = module.exports;\n' +
      bundle + '\n' +
      '  if (typeof __WHIM_APP_MODULE__ !== "undefined") window.__WHIM_APP_MODULE__ = __WHIM_APP_MODULE__;\n' +
      '})();\n' +
      'window.__whimAfterBundle && window.__whimAfterBundle();'
    );
  }

  function deliverBlob(wrapped) {
    // Channel (c) REFUSAL invariant (task 4.5): a blob:/data: <script src> must stay
    // REFUSED under the locked CSP (`script-src 'unsafe-inline'` has no `blob:`). We try
    // it on purpose; it must NOT execute. Never widen script-src to make this "work" — an
    // attacker who can mint a same-origin blob would gain a script surface.
    const blobUrl = URL.createObjectURL(new Blob([wrapped], { type: 'application/javascript' }));
    const bs = document.createElement('script');
    bs.src = blobUrl;
    (document.head || document.documentElement).appendChild(bs);
    window.setTimeout(function () {
      const ran = (typeof window.__WHIM_APP_MODULE__ !== 'undefined') && !!window.__WHIM_APP_MODULE__;
      post('delivery', {
        accepted: ran, via: 'blob', refused: !ran, generation: generation,
        note: ran ? 'BLOB SCRIPT RAN (CSP breach!)' : 'blob script refused by CSP (never widen script-src)',
      });
      try { URL.revokeObjectURL(blobUrl); } catch (e) {}
      deliveryBusy = false;
    }, 60);
  }

  function deliverInline(wrapped) {
    const s = document.createElement('script');
    s.textContent = wrapped; // DOM-inserted INLINE script (NOT eval) — runs synchronously on append
    (document.head || document.documentElement).appendChild(s);
    post('delivery', { accepted: true, generation: generation, note: 'DOM-inserted inline script appended without throwing' });
    deliveryBusy = false; // re-injection ready (a new generation in the SAME realm)
  }

  function deliverBundle(msg) {
    deliveryBusy = true;
    generation = generation + 1;
    try {
      const wrapped = wrappedBundleSource(own(msg, 'bundle'));
      if (own(msg, 'viaBlob') === true) {
        deliverBlob(wrapped);
        return;
      }
      deliverInline(wrapped);
    } catch (e) {
      post('delivery', { accepted: false, generation: generation, name: e && e.name, message: e && String(e.message) });
      post('error', { where: 'deliver', name: e && e.name, message: e && String(e.message) });
      deliveryBusy = false;
    }
  }

  window.addEventListener('message', function (ev) {
    let source, data;
    try {
      source = apply(eventSource, ev, []);
      data = apply(eventData, ev, []);
    } catch (e) { return; }

    // Host-channel-only acceptance (A1 — mirrors syscall.js's ev.source guard): a frame posted by a
    // bundle sharing this realm has ev.source === window, not the parent. Drop it. Without this, a
    // delivered bundle could self-post __whimDeliver on a later tick to forge a delivery — bumping
    // __whimGeneration, injecting its payload, and posting a host frame carrying the closure-captured
    // real nonce (indistinguishable to the host) — corrupting the host's generation state machine.
    // Both sides of the comparison were captured before any bundle ran: the event's own `source`
    // getter and the parent as it was at load (a bundle can reassign `window.parent`).
    if (source !== PARENT) return;
    if (typeof data !== 'string') return;
    let msg;
    try { msg = parse(data); } catch (e) { return; }
    if (msg === null || typeof msg !== 'object') return;

    // Host init: the FIRST one wins and is locked in. It arrives before any bundle is
    // delivered, so a later (untrusted) bundle cannot re-set or read this nonce.
    if (handleHostInit(msg)) return;

    // No delivery before the handshake: a bundle running before the init frame arrived would be
    // listening when the nonce did.
    if (envelopeHead === null || own(msg, '__whimDeliver') !== true || deliveryBusy) return;
    deliverBundle(msg);
  });

  // Announce liveness so the host sends the init nonce, then the bundle.
  // (We post WITHOUT a nonce here on purpose — it is the only pre-auth frame; the host keys
  // off kind:'hello' and replies with the nonce, to this first hello only. All later genuine
  // frames carry the nonce.)
  try {
    apply(parentPost, PARENT, ['{"__whimHarness":true,"kind":"hello"}', '*']);
  } catch (e) {}
})();
