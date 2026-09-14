/**
 * Hermes polyfills for isomorphic-git (Decision #36 D2 / #39 — the load-bearing recipe).
 * Moved here from `src/host/version-store/polyfills.ts` (design D8) so any module that
 * reaches Hermes-missing globals first — not just the version store — can install them.
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

/** The slice of a global object this installer reads and fills. No React Native import. */
export interface HermesGlobal {
  Buffer?: unknown;
  TextEncoder?: unknown;
  TextDecoder?: unknown;
  process?: {
    env?: Record<string, string | undefined>;
    platform?: string;
  };
}

/**
 * Installs `TextEncoder`, `TextDecoder`, `Buffer` and `process.env` on `target` wherever
 * each is missing, and never replaces a value already there. Checked on every call — there
 * is no module-level "installed" flag, so a platform-less call never locks out a later
 * call that does pass one. `platform` is written to `process.platform` only when it is
 * passed AND `process.platform` is currently missing; an existing value is never
 * overwritten, and a call made without a platform simply leaves it as it was.
 */
export function installHermesPolyfills(target: HermesGlobal = globalThis, platform?: 'ios' | 'android'): void {
  if (target.Buffer === undefined) {
    target.Buffer = BufferPolyfill;
  }

  if (target.TextEncoder === undefined || target.TextDecoder === undefined) {
    // Hermes ships TextEncoder but not TextDecoder. Take the constructors from the
    // package's own exports (its native one where the runtime already has it) rather
    // than relying on the package writing to the real global itself.
    const codec = require('text-encoding-polyfill');
    if (target.TextEncoder === undefined) target.TextEncoder = codec.TextEncoder;
    if (target.TextDecoder === undefined) target.TextDecoder = codec.TextDecoder;
  }

  if (target.process === undefined) target.process = {};
  if (target.process.env === undefined) target.process.env = {};
  if (platform !== undefined && target.process.platform === undefined) target.process.platform = platform;
}

// Install on import so a bare `import './hermes-polyfills'` is sufficient.
installHermesPolyfills(globalThis);
