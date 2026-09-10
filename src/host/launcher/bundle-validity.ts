/**
 * bundle-validity — the one guard between a delivered bundle and the version store
 * (launcher-shell; the stub-bundle incident: a rewrite delivered the generation server's
 * `(()=>{ /* stub bundle *\/ })();` placeholder, which the launcher stored without complaint,
 * and the failure only surfaced at MOUNT time — after the previous good version had already
 * been overwritten. This module moves that check to DELIVERY time, where the previous version
 * is still the active one and refusing the write is free.
 *
 * The check is deliberately shallow: it does not parse or execute the bundle (that is the
 * sandboxed realm's job), it only confirms the bundle assigns the global the runtime loader
 * actually reads (`src/runtime/web/loader.js`'s `window.__WHIM_APP_MODULE__`, emitted by
 * `build/build.mjs`'s esbuild `globalName` as `var __WHIM_APP_MODULE__ = (() => { ... })();`).
 * A bundle that never assigns it cannot define an `AppSpec` default export by construction.
 */

/** Matches loosely on purpose: `var __WHIM_APP_MODULE__ = ...` is the real shape, but this also
 *  accepts a bare `__WHIM_APP_MODULE__ = ...` assignment without caring about `var`/whitespace
 *  variants a future esbuild version might emit. A `// __WHIM_APP_MODULE__ = ...` comment ALSO
 *  matches — deliberately: distinguishing code from comments needs a parser, and the one bundle
 *  this guard exists to catch (the stub) mentions the name nowhere at all, in code or comment. A
 *  bundle that references the name only in a comment while assigning nothing real is not a case
 *  this shallow guard is built to catch.
 */
const ASSIGNS_APP_MODULE = /\b__WHIM_APP_MODULE__\s*=/;

/**
 * True when `bundle` is non-empty and assigns `__WHIM_APP_MODULE__` somewhere in its text. False
 * for an empty string, whitespace-only text, or the generation server's stub bundle
 * (`(()=>{ /* stub bundle *\/ })();`, 30 bytes, no assignment at all).
 */
export function bundleDefinesApp(bundle: string): boolean {
  return bundle.trim().length > 0 && ASSIGNS_APP_MODULE.test(bundle);
}
