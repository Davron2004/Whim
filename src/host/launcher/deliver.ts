/**
 * deliver — the host-side bundle-by-source delivery helper (launcher-shell / #5 D3).
 *
 * Builds the `injectJavaScript` string that hands a host-held bundle SOURCE to the outer page's
 * control surface (`__whimControl.reinject({bundleSource})`). The iframe-side contract is
 * untouched — the outer page delivers the source over the identical channel-(b) path it uses for
 * baked bundles. `JSON.stringify` escapes the source exactly once for safe embedding in the
 * injected script; a size guard refuses pathologically large inputs before they reach the
 * injectJavaScript pipe (the design risk note).
 */

/** Refuse a bundle source larger than this (the injectJavaScript guard, D3). H1b bundles are
 *  ~4.5 KiB; 512 KiB is a generous ceiling that still rejects a runaway future input. */
export const MAX_BUNDLE_SOURCE_BYTES = 512 * 1024;

export class BundleTooLargeError extends Error {
  readonly bytes: number;
  constructor(bytes: number) {
    super(`bundle source is ${bytes} bytes, over the ${MAX_BUNDLE_SOURCE_BYTES}-byte delivery limit`);
    this.name = 'BundleTooLargeError';
    this.bytes = bytes;
  }
}

/** UTF-8 byte length. Hermes ships TextEncoder (but not TextDecoder); fall back to char count. */
function byteLength(s: string): number {
  try {
    return new TextEncoder().encode(s).length;
  } catch {
    return s.length;
  }
}

export interface DeliverBySourceArgs {
  /** Display name for diagnostics only (the bytes come from `source`). */
  name: string;
  source: string;
  /** The realm generation the host bound this delivery at (stamped into the init frame). */
  generation: number;
}

/**
 * The control-surface call that delivers a bundle by source. Throws `BundleTooLargeError` before
 * building the string if the source exceeds the guard. The outer page recreates the iframe
 * (reset) and delivers `source` once the new realm is ready — same reset-then-deliver path as a
 * baked launch.
 */
export function deliverBySourceJs(args: DeliverBySourceArgs): string {
  const bytes = byteLength(args.source);
  if (bytes > MAX_BUNDLE_SOURCE_BYTES) throw new BundleTooLargeError(bytes);
  return (
    'window.__whimControl.reinject({reset:true,bundle:' +
    JSON.stringify(args.name) +
    ',bundleSource:' +
    JSON.stringify(args.source) +
    ',generation:' +
    String(args.generation) +
    '})'
  );
}
