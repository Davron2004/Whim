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
 * Parse an incoming URL, returning the decoded id or `null`. Accepts only: scheme `https`, host
 * equal to `RELEASE.webHost` case-insensitively, and a path that is `/a/` followed by exactly one
 * non-empty segment with at most one trailing slash. Query and fragment are ignored.
 */
export function parseAppLink(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  // eslint-disable-next-line no-restricted-syntax -- intentional: an unparseable URL is simply not an app link, so it returns null like every other rejection case
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:') return null;
  if (parsed.hostname.toLowerCase() !== RELEASE.webHost.toLowerCase()) return null;

  const prefix = '/a/';
  if (!parsed.pathname.startsWith(prefix)) return null;
  let segment = parsed.pathname.slice(prefix.length);
  if (segment.endsWith('/')) {
    segment = segment.slice(0, -1);
  }
  if (segment.length === 0 || segment.includes('/')) return null;

  try {
    return decodeURIComponent(segment);
  // eslint-disable-next-line no-restricted-syntax -- intentional: a malformed percent-encoding is simply not a valid app link, so it returns null like every other rejection case
  } catch {
    return null;
  }
}
