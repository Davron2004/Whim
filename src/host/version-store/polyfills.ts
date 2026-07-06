/**
 * Hermes polyfills for isomorphic-git (task 1.2, Decision #36 D2 — the load-bearing recipe).
 *
 * This module MUST be imported (for its side effect) BEFORE isomorphic-git, because
 * isomorphic-git touches `TextDecoder` at *module-load* time — without it the app
 * crashes at load with `ReferenceError: Property 'TextDecoder' doesn't exist`. Every
 * module in this package that imports isomorphic-git imports this FIRST; ES module
 * evaluation order then guarantees the polyfills run before isomorphic-git's body.
 *
 * The minimal set the spike proved on-device (Pixel_9_Pro_XL, RN 0.85.3 / Hermes /
 * new arch):
 *   - `Buffer`        — Hermes ships none; isomorphic-git uses it ~70×.
 *   - `TextDecoder`   — Hermes ships the ENCODER but NOT the decoder (the surprise).
 *   - `process` shim  — Hermes' `process` is partial; fill `env`/`platform`.
 * `pako` (zlib), `sha.js`, `crc-32` are pure JS and need nothing.
 *
 * On Node every capability is native, so each branch is a guarded no-op.
 */

import { Buffer as BufferPolyfill } from 'buffer';

let installed = false;

export function installHermesPolyfills(): void {
  if (installed) return;
  installed = true;
  const g = globalThis as any;

  if (typeof g.Buffer === 'undefined') {
    g.Buffer = BufferPolyfill;
  }

  // 3-line process shim — Hermes provides a partial `process`; fill the gaps.
  if (typeof g.process === 'undefined') g.process = {};
  if (typeof g.process.env === 'undefined') g.process.env = {};
  if (typeof g.process.platform === 'undefined') g.process.platform = 'android';

  // Hermes has TextEncoder but not TextDecoder. text-encoding-polyfill installs both.
  if (typeof g.TextDecoder === 'undefined') {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('text-encoding-polyfill');
  }
}

// Install on import so a bare `import './polyfills'` is sufficient.
installHermesPolyfills();
