/**
 * app-link — the one grammar for a Whim app link, built and parsed in this module only (design
 * D15; spec app-links "App links have one grammar, built and parsed in one module"). A link is
 * `RELEASE.appLinkBase` (`https://<RELEASE.webHost>/a/`) followed by the launcher id encoded as
 * one URI path segment.
 *
 * No React Native import — this module must load under the Node acceptance suite.
 */

import { RELEASE } from './release-config';

/** Build the link for a launcher id (a fresh-install id, a seed fixture id, or a `repo__lineage`
 *  fork id — every shape round-trips through `parseAppLink`). */
export function appLinkFor(id: string): string {
  return `${RELEASE.appLinkBase}${encodeURIComponent(id)}`;
}

/**
 * Anchored regex only — this parser must never depend on any `URL` implementation. Node's WHATWG
 * `URL` and React Native's regex-based polyfill (`Libraries/Blob/URL.js`, the only `URL` that
 * exists on-device) disagree on hostile authorities (e.g. a `?`/`#`-smuggled host reads as part of
 * the hostname under the polyfill but not under Node's `URL`), which would let the host check pass
 * on one and fail on the other. Groups: 1 = scheme, 2 = the authority up to the first `/`, `?`, or
 * `#` (a port, userinfo, or backslash there simply fails the exact host-equality check below —
 * there is no interpretation step to exploit), 3 = the still-percent-encoded id segment.
 */
const APP_LINK_PATTERN = /^([a-zA-Z][a-zA-Z0-9+.-]*):\/\/([^/?#]+)\/a\/([^/?#]+)\/?(?:[?#].*)?$/;

/**
 * Parse an incoming URL, returning the decoded id or `null`. Accepts only: scheme `https`
 * (case-insensitive), host equal to `RELEASE.webHost` case-insensitively, and a path that is `/a/`
 * followed by exactly one non-empty segment with at most one trailing slash. Query and fragment
 * are ignored.
 */
export function parseAppLink(url: string): string | null {
  const match = APP_LINK_PATTERN.exec(url);
  if (!match) return null;
  const [, scheme, host, rawId] = match;

  if (scheme.toLowerCase() !== 'https') return null;
  if (host.toLowerCase() !== RELEASE.webHost.toLowerCase()) return null;

  let id: string;
  try {
    id = decodeURIComponent(rawId);
  // eslint-disable-next-line no-restricted-syntax -- intentional: a malformed percent-encoding is simply not a valid app link, so it returns null like every other rejection case
  } catch {
    return null;
  }
  if (id.length === 0 || id.includes('/')) return null;

  return id;
}
