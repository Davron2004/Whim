// ─────────────────────────────────────────────────────────────────────────────
// Whim Spike 1 — forbidden-globals + escape PROBE CHECKLIST  (the durable artifact)
// ─────────────────────────────────────────────────────────────────────────────
// This is the seed of the §16.2 network/native-isolation invariant and the Spike 6
// headless CI suite. Every entry is a runnable assertion: invoke the dangerous
// thing, PASS iff it throws (or is provably inert / unreachable). It runs INSIDE
// the bundle's shadowed execution scope (spliced by runner.js), so bare identifiers
// (`fetch`, `eval`, …) resolve exactly as the mini-app would see them.
//
// Defines `__whimRunProbes()` → Promise<Result>. The Promise exists only because
// dynamic `import()` is inherently async (it rejects rather than sync-throws).
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
  function record(category, name, ok, detail) {
    results.push({ category: category, name: name, ok: ok, detail: detail });
  }
  // PASS iff fn() throws. (How a bundle's invocation of a stripped global must behave.)
  function expectThrow(category, name, fn) {
    try {
      var v = fn();
      record(category, name, false, 'DID NOT THROW → returned ' + describe(v));
    } catch (e) {
      record(category, name, true, 'threw ' + (e && e.name ? e.name : 'Error') + ': ' + (e && e.message ? String(e.message).slice(0, 80) : ''));
    }
  }
  // PASS iff reading the expression is blocked (throws) or yields a provably-unusable
  // value (null / cross-origin opaque that can't be dereferenced).
  function expectUnreachable(category, name, fn) {
    try {
      var v = fn();
      if (v === null || v === undefined) {
        record(category, name, true, 'unreachable → ' + describe(v));
      } else {
        record(category, name, false, 'REACHED a usable value → ' + describe(v));
      }
    } catch (e) {
      record(category, name, true, 'blocked: ' + (e && e.name ? e.name : 'Error'));
    }
  }

  // ── 1. Forbidden globals: network ──────────────────────────────────────────
  expectThrow('network', 'fetch', function () { return fetch('https://example.com/whim-probe'); });
  expectThrow('network', 'XMLHttpRequest', function () { return new XMLHttpRequest(); });
  expectThrow('network', 'WebSocket', function () { return new WebSocket('wss://example.com'); });
  expectThrow('network', 'window.fetch (stub)', function () { return window.fetch('https://example.com'); });
  expectThrow('network', 'navigator.sendBeacon', function () { return navigator.sendBeacon('https://example.com', 'x'); });

  // ── 2. Forbidden globals: dynamic code execution ────────────────────────────
  // These are NOT lexically shadowed — they prove the CSP `script-src` (no
  // 'unsafe-eval') is doing the work at the engine level.
  expectThrow('codegen', 'eval', function () { return eval('1+1'); });
  expectThrow('codegen', 'new Function', function () { return new Function('return 1')(); });
  expectThrow('codegen', 'Function (call form)', function () { return Function('return 1')(); });

  // ── 3. Forbidden globals: ambient persistence + threading ───────────────────
  expectThrow('ambient', 'localStorage', function () { return localStorage.setItem('a', 'b'); });
  expectThrow('ambient', 'sessionStorage', function () { return sessionStorage.setItem('a', 'b'); });
  expectThrow('ambient', 'indexedDB', function () { return indexedDB.open('whim'); });
  expectThrow('ambient', 'Worker', function () { return new Worker('data:application/javascript,1'); });

  // ── 4. Prototype-chain / constructor-walk escape (the canonical sandbox break)─
  // value-replacement on `window` can NEVER close this — only CSP does. If any of
  // these returns a value, dynamic code execution is live and H1 has leaked.
  expectThrow('escape', '({}).constructor.constructor', function () { return ({}).constructor.constructor('return this')(); });
  expectThrow('escape', '[].constructor.constructor', function () { return [].constructor.constructor('return globalThis')(); });
  expectThrow('escape', 'function*(){}.ctor walk', function () { return (function () {}).constructor('return 1')(); });

  // ── 5. Host / native reach (4.3 / 4.4) ──────────────────────────────────────
  // window.parent.postMessage stays reachable on purpose (the one-way transport);
  // everything else that would yield the host document or the REAL native bridge
  // must be blocked by the cross-origin (no allow-same-origin) boundary.
  expectUnreachable('reach', 'window.frameElement', function () { return window.frameElement; });
  expectUnreachable('reach', 'window.parent.document', function () { return window.parent.document; });
  expectUnreachable('reach', 'window.top.document', function () { return window.top.document; });
  expectUnreachable('reach', 'window.parent.location.href', function () { return window.parent.location.href; });
  expectUnreachable('reach', 'window.parent.ReactNativeWebView (real bridge)', function () { return window.parent.ReactNativeWebView; });
  expectUnreachable('reach', 'window.top.ReactNativeWebView', function () { return window.top.ReactNativeWebView; });

  // ── 6. Module isolation (task 3.4): only the injected SDK resolves ───────────
  // `require` is the runner's resolver, in scope here. Anything but '@whim/sdk'
  // must throw, and there must be no ambient CommonJS/host module system.
  expectThrow('module', "require('react')", function () { return require('react'); });
  expectThrow('module', "require('react-native')", function () { return require('react-native'); });
  expectThrow('module', "require('fs')", function () { return require('fs'); });
  expectUnreachable('module', 'ambient module/exports/process', function () {
    return (typeof module !== 'undefined' ? module : null) ||
      (typeof exports !== 'undefined' ? exports : null) ||
      (typeof process !== 'undefined' ? process : null) || null;
  });

  // ── 7. NEGATIVE CONTROL (4.5): the checklist must FAIL LOUDLY on a real breach ─
  // Plant a working "leaked native capability" and run the same kind of assertion
  // against it. expectThrow MUST record ok:false here — proving the suite reports
  // breaches as failures rather than silently passing. (Removed immediately after.)
  window.__WHIM_PLANTED_LEAK__ = function () { return 'simulated native reach'; };
  var beforeLen = results.length;
  expectThrow('negative-control', 'planted leak (should be flagged)', function () {
    return window.__WHIM_PLANTED_LEAK__();
  });
  var negativeControlCaughtBreach = results[beforeLen].ok === false;
  try { delete window.__WHIM_PLANTED_LEAK__; } catch (e) {}

  // ── 8. Async: dynamic import() must reject (no module loads) ─────────────────
  var importProbe = new Promise(function (resolve) {
    var p;
    try {
      // eslint-disable-next-line no-eval -- this is the literal thing under test
      p = import('data:text/javascript,export default 1');
    } catch (e) {
      record('codegen', 'import()', true, 'threw synchronously: ' + (e && e.name));
      return resolve();
    }
    Promise.resolve(p).then(
      function (m) { record('codegen', 'import()', false, 'RESOLVED a module → ' + describe(m)); resolve(); },
      function (e) { record('codegen', 'import()', true, 'rejected: ' + (e && e.name ? e.name : 'Error')); resolve(); }
    );
  });

  return importProbe.then(function () {
    // The negative control is expected to fail; exclude it from the containment tally.
    var real = results.filter(function (r) { return r.category !== 'negative-control'; });
    var failed = real.filter(function (r) { return !r.ok; });
    return {
      neutralizeReport: window.__WHIM_NEUTRALIZE_REPORT__ || null,
      probes: results,
      total: real.length,
      passed: real.length - failed.length,
      failed: failed.length,
      failures: failed,
      negativeControlCaughtBreach: negativeControlCaughtBreach,
      // The single invariant bit §16.2 cares about:
      contained: failed.length === 0 && negativeControlCaughtBreach === true,
    };
  });
}
