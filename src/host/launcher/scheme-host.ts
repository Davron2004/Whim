/**
 * scheme-host (review fix N5) — the scheme and host a rejected app link is logged with (spec
 * app-links "URLs that aren't app links are ignored" — "the log record names only the scheme and
 * host"), never the full URL. Anchored regex only, the same discipline `app-link.ts` documents:
 * Node's WHATWG `URL` and React Native's regex-based polyfill (the only `URL` that exists
 * on-device) disagree on hostile authorities — a `new URL(...)` here would let a query string like
 * `?email=jane.doe@corp-internal` bleed into the logged host on-device even though it never would
 * under Node. RN-free: this must load under the launcher's Node acceptance suite.
 */

/** Group 1 = scheme, group 2 = the authority up to the first `/`, `?`, or `#` — the same cut point
 *  `app-link.ts`'s `APP_LINK_PATTERN` uses, so a query or fragment can never be mistaken for part
 *  of the authority. The authority may still carry `userinfo@` and/or a trailing `:port`. */
const SCHEME_HOST_PATTERN = /^([a-zA-Z][a-zA-Z0-9+.-]*):\/\/([^/?#]+)/;

/** An unparseable string reads as `'unknown'`/`'unknown'` rather than throwing — a malformed URL
 *  is still just a rejection. */
export function schemeAndHostOf(url: string): { scheme: string; host: string } {
  const match = SCHEME_HOST_PATTERN.exec(url);
  if (!match) return { scheme: 'unknown', host: 'unknown' };
  const [, scheme, authority] = match;
  const hostAndPort = authority.includes('@') ? authority.slice(authority.lastIndexOf('@') + 1) : authority;
  const host = hostAndPort.includes(':') ? hostAndPort.slice(0, hostAndPort.indexOf(':')) : hostAndPort;
  return { scheme: scheme.toLowerCase(), host: host.toLowerCase() };
}
