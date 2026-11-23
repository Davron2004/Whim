// ─────────────────────────────────────────────────────────────────────────────
// Whim runtime — forbidden-globals neutralization (runs FIRST inside the iframe).
// ─────────────────────────────────────────────────────────────────────────────
// Productionized from the proven Spike-1 shim (removed from invariants/ in 2026-09, see git
// history); behavior is kept verbatim — this is the retained #35 surgical strip.
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

  // ── Native message bridge (sandbox-isolation "The mini-app frame holds no native bridge
  // object", decision-log D4 of webview-bridge-provenance) ─────────────────────────────────
  // The FIRST act, before any other runtime script runs: a platform that injects its native
  // bridge into every frame (Android `ReactNativeWebView`, iOS every `webkit.messageHandlers`
  // entry) would otherwise hand app code a direct line to RN. Each is recorded as present, removed (deleted
  // wherever it sits on the window's prototype chain, else shadowed), and recorded as removed
  // only if nothing on the chain still yields it. The frozen record is handed to the loader on a
  // transient, read-only global the loader captures and erases before any app code runs; it never
  // passes through __WHIM_NEUTRALIZE_REPORT__, which app code can rewrite.
  const bridgeRecord = recordAndRemoveNativeBridges();
  Object.defineProperty(window, '__WHIM_BRIDGE_RECORD__', {
    value: bridgeRecord, writable: false, enumerable: false, configurable: true,
  });

  // Every object on `target`'s prototype chain (target first) holding `name` as an own property,
  // with the value a read of `target[name]` through that holder yields (a throwing read yields
  // nothing).
  function holdersOf(target, name) {
    const found = [];
    for (let o = target, depth = 0; o !== null && o !== undefined && depth < 64; depth++) {
      const desc = ownDescriptor(o, name);
      if (desc) found.push({ holder: o, value: readThrough(desc, target) });
      o = protoOf(o);
    }
    return found;
  }

  // `o`'s own descriptor for `name`; a throwing lookup (a hostile proxy) yields none.
  function ownDescriptor(o, name) {
    try { return Object.getOwnPropertyDescriptor(o, name); } catch (e) { return undefined; }
  }

  // The value a read of `target[name]` yields through descriptor `desc`; a throwing getter yields
  // nothing.
  function readThrough(desc, target) {
    if ('value' in desc) return desc.value;
    if (!desc.get) return undefined;
    try { return Reflect.apply(desc.get, target, []); } catch (e) { return undefined; }
  }

  // `o`'s prototype; a throwing lookup ends the chain.
  function protoOf(o) {
    try { return Object.getPrototypeOf(o); } catch (e) { return null; }
  }

  function reachable(target, name) {
    return holdersOf(target, name).some(function (h) { return h.value !== null && h.value !== undefined; });
  }

  // Delete `name` from every holder on the chain; if it is still reachable, shadow it with an own
  // `shadow` descriptor, then by plain assignment (the same delete-or-shadow order as neutralize()).
  function strip(target, name, shadow) {
    holdersOf(target, name).forEach(function (h) { try { delete h.holder[name]; } catch (e) { } });
    if (!reachable(target, name)) return;
    try { Object.defineProperty(target, name, shadow); } catch (e) { }
    if (!reachable(target, name)) return;
    try { target[name] = undefined; } catch (e) { }
  }

  // iOS's message handlers as app code would reach them: a `messageHandlers` through any `webkit` on
  // the window's chain.
  function webkitHandlerHolders() {
    const found = [];
    holdersOf(window, 'webkit').forEach(function (w) {
      try {
        const handlers = w.value && w.value.messageHandlers;
        if (handlers !== null && handlers !== undefined) found.push(handlers);
      } catch (e) {
        // A `webkit` whose `messageHandlers` read throws yields no handlers app code could use
        // either, so it is skipped rather than recorded.
      }
    });
    return found;
  }
  function webkitHandlersReachable() {
    return webkitHandlerHolders().length > 0;
  }

  function recordAndRemoveNativeBridges() {
    // Android (and react-native-webview's iOS shim): window.ReactNativeWebView, own or inherited.
    // The shadow stays writable and configurable: the loader installs its transport stub here.
    const androidPresent = reachable(window, 'ReactNativeWebView');
    if (androidPresent) {
      strip(window, 'ReactNativeWebView', { value: undefined, writable: true, configurable: true, enumerable: false });
    }
    const android = Object.freeze({
      present: androidPresent, removed: androidPresent && !reachable(window, 'ReactNativeWebView'),
    });

    // iOS: window.webkit.messageHandlers. WebKit hands every frame every handler the host registered
    // and does not enumerate them, so no list of names is complete: `webkit` itself goes, deleted
    // wherever it sits on the chain, else shadowed (nothing in the sandbox needs it). Where the
    // engine will not let go of it, the library's own handlers are stripped by name, and the record
    // says the reach was not removed: a handler nobody can name may still be there.
    const iosPresent = webkitHandlersReachable();
    if (iosPresent) {
      strip(window, 'webkit', { value: undefined, writable: false, configurable: false, enumerable: false });
      // The handlers react-native-webview registers (RNCWebViewImpl.m): its bridge, and its history
      // shim, whose message fires RN's onLoadEnd.
      webkitHandlerHolders().forEach(function (handlers) {
        ['ReactNativeWebView', 'ReactNativeHistoryShim'].forEach(function (name) {
          strip(handlers, name, { value: undefined, writable: false, configurable: false, enumerable: false });
        });
      });
    }
    const ios = Object.freeze({ present: iosPresent, removed: iosPresent && !webkitHandlersReachable() });

    return Object.freeze({ android: android, ios: ios });
  }

  function throwingFn(name) {
    return function whimForbidden() {
      throw new TypeError(name + ' is disabled in the Whim sandbox (Layer-3 escape hatch)');
    };
  }

  // Replace a global with `replacement`, defeating non-writable/accessor props by
  // delete-then-redefine, falling back to plain assignment. Returns the technique that
  // actually stuck, so the probe report can show HOW each global was neutralized.
  function neutralize(name, replacement) {
    try { delete window[name]; } catch (e) { }
    try {
      Object.defineProperty(window, name, {
        value: replacement, writable: false, configurable: false, enumerable: false,
      });
      return 'redefined';
    } catch (e) { }
    try { window[name] = replacement; return 'assigned'; } catch (e) { }
    return 'non-configurable'; // could not touch it on window → loader.js lexically shadows it
  }

  // An object whose every property access/call throws — for ambient stores.
  function inertStore(name) {
    const handler = {
      get: function () { throw new TypeError(name + ' is disabled in the Whim sandbox'); },
      set: function () { throw new TypeError(name + ' is disabled in the Whim sandbox'); },
      apply: function () { throw new TypeError(name + ' is disabled in the Whim sandbox'); },
    };
    try { return new Proxy(function () { }, handler); } catch (e) { return undefined; }
  }

  const report = {};

  // Network primitives. RTCPeerConnection is load-bearing here: WebRTC is NOT covered by
  // `connect-src 'none'`, so the value-strip is the only thing that closes it.
  report.fetch = neutralize('fetch', throwingFn('fetch'));
  report.XMLHttpRequest = neutralize('XMLHttpRequest', throwingFn('XMLHttpRequest'));
  report.WebSocket = neutralize('WebSocket', throwingFn('WebSocket'));
  report.EventSource = neutralize('EventSource', throwingFn('EventSource'));
  report.RTCPeerConnection = neutralize('RTCPeerConnection', throwingFn('RTCPeerConnection'));
  // Prefixed WebRTC aliases open the SAME transport (STUN/TURN/ICE = UDP/TCP egress) and are
  // equally uncovered by `connect-src 'none'`, so each one is its own value-strip-only vector.
  // Chromium — and therefore the Android System WebView, where neutralization is the only
  // barrier — still exposes `webkitRTCPeerConnection`; leaving it un-stripped was a live egress
  // channel that the CONTAINED verdict never caught (docs/security/2026-09-14-webrtc-alias.md).
  // Strip only the aliases the engine actually defines, so we never mint a phantom throwing
  // global on an engine that lacks one (WebKit/iOS: `webkitRTCPeerConnection` is absent — a
  // `typeof` feature-detect there must keep reading `undefined`, not our stub).
  for (const rtcAlias of ['webkitRTCPeerConnection', 'mozRTCPeerConnection']) {
    if (rtcAlias in window) report[rtcAlias] = neutralize(rtcAlias, throwingFn(rtcAlias));
  }

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
