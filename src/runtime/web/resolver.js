// ─────────────────────────────────────────────────────────────────────────────
// Whim runtime — H1b module resolver (decision #37 / docs/spike2-findings.md).
// ─────────────────────────────────────────────────────────────────────────────
// The resolvable runtime surface is EXACTLY {vc-sdk, react, react-dom} — a CLOSED
// ALLOWLIST, never a dynamic resolver. The bundle is an esbuild IIFE whose externalized
// `require("vc-sdk"|"react"|"react-dom")` calls land here; EVERY other specifier throws.
//
//   • `vc-sdk`      → the host-injected SDK global (the one capability surface, #7).
//   • `react` / `react-dom` → the ONE shared host instance (mixed React instances break
//     hooks across the loader↔bundle boundary — D3). They are pure UI libs with no ambient
//     authority, so resolving them is by design, not a leak.
//   • everything else — `react-dom/server`, `fs`, `child_process`, relative paths, SDK
//     subpaths, any 3rd-party — throws (sandbox-rendering: "the SDK is the only import
//     surface"; pen-test T5: confinement against relative/dynamic/subpath requires).
//
// Runs BEFORE the SDK inject (vc-sdk's external `require("react")` resolves through here) and
// before the loader. `window.require` is exposed because the channel-(b) bundle runs in
// GLOBAL scope, so its bare `require(...)` must resolve to a global; the probe checklist's
// bare `require(...)` calls resolve here too.
(function whimResolver() {
  'use strict';

  window.__whimRequire = function whimRequire(name) {
    if (name === 'vc-sdk') {
      if (window.__WHIM_VC_SDK__) return window.__WHIM_VC_SDK__;
      throw new Error('vc-sdk global not injected (H1b needs the host-injected SDK global)');
    }
    if (name === 'react') {
      if (window.React) return window.React;
      throw new Error('react global not injected');
    }
    if (name === 'react-dom' || name === 'react-dom/client') {
      if (window.ReactDOM) return window.ReactDOM;
      throw new Error('react-dom global not injected');
    }
    // CLOSED allowlist — exact-name match only. No prefix/subpath/relative resolution, ever.
    throw new Error(
      "Cannot find module '" + name + "' — the Whim sandbox resolves only {vc-sdk, react, react-dom}",
    );
  };

  // esbuild's externalized `require(...)` and the probe checklist read a bare/global `require`.
  window.require = window.__whimRequire;
})();
