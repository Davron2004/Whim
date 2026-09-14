/**
 * app-link Node suite (task 1.4) — locks app-links spec "App links have one grammar, built and
 * parsed in one module": round-trip over every launcher id shape, the four rejection cases, a
 * case-insensitive host, and query/fragment ignored. URLs are built from `RELEASE`/`appLinkFor`
 * rather than hardcoded, so this suite never types the domain literal itself
 * (`release-config.suite.ts` locks that as a repo-wide rule).
 */

import { Harness } from './harness';
import { RELEASE } from '../release-config';
import { appLinkFor, parseAppLink } from '../app-link';
import { freshAppId } from '../build-lifecycle';

export async function runAppLinkTests(h: Harness): Promise<void> {
  // ── round trip over the three real launcher id shapes ──────────────────────────────────────

  await h.test('app-link: a fresh-install id round-trips', () => {
    const id = freshAppId();
    h.eq(parseAppLink(appLinkFor(id)), id, 'freshAppId() round-trips through build then parse');
  });

  await h.test('app-link: a seed fixture id round-trips', () => {
    const id = 'tip-splitter';
    h.eq(parseAppLink(appLinkFor(id)), id, 'a seed fixture id round-trips');
  });

  await h.test('app-link: a repo__lineage fork id round-trips', () => {
    const id = `tip-splitter__${freshAppId()}`;
    h.ok(id.includes('__'), 'the fixture actually contains the fork separator');
    h.eq(parseAppLink(appLinkFor(id)), id, 'a fork id containing "__" round-trips');
  });

  await h.test('app-link: appLinkFor starts with the release app-link base', () => {
    h.ok(appLinkFor('x').startsWith(RELEASE.appLinkBase), 'built link is RELEASE.appLinkBase + the encoded id');
  });

  // ── the four rejection cases ────────────────────────────────────────────────────────────────

  await h.test('app-link: wrong scheme is rejected', () => {
    const link = appLinkFor('x').replace('https://', 'http://');
    h.eq(parseAppLink(link), null, 'http scheme must not parse');
  });

  await h.test('app-link: wrong host is rejected', () => {
    const link = `https://evil.example/a/${encodeURIComponent('x')}`;
    h.eq(parseAppLink(link), null, 'a foreign host must not parse');
  });

  await h.test('app-link: an empty path segment is rejected', () => {
    h.eq(parseAppLink(RELEASE.appLinkBase), null, 'no id segment at all must not parse');
  });

  await h.test('app-link: more than one path segment is rejected', () => {
    h.eq(parseAppLink(`${RELEASE.appLinkBase}x/y`), null, 'a second path segment must not parse');
  });

  // ── case-insensitive host, query and fragment ignored ───────────────────────────────────────

  await h.test('app-link: an uppercase host is accepted', () => {
    const upper = `https://${RELEASE.webHost.toUpperCase()}/a/${encodeURIComponent('x')}`;
    h.eq(parseAppLink(upper), 'x', 'host comparison is case-insensitive');
  });

  await h.test('app-link: query and fragment are ignored', () => {
    const withExtras = `${appLinkFor('x')}?ref=share#section`;
    h.eq(parseAppLink(withExtras), 'x', 'query and fragment do not affect the parsed id');
  });

  await h.test('app-link: a single trailing slash is tolerated, a double one is not', () => {
    h.eq(parseAppLink(`${RELEASE.appLinkBase}x/`), 'x', 'one trailing slash is allowed');
    h.eq(parseAppLink(`${RELEASE.appLinkBase}x//`), null, 'a second trailing slash reads as an extra empty segment');
  });
}
