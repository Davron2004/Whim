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

  // ── the parser must not depend on any `URL` implementation (M5) ─────────────────────────────
  // React Native's regex `URL` polyfill parses these authorities differently from Node's WHATWG
  // `URL`, so a parser built on either would only be "exact host" in one environment.

  await h.test('app-link: a query-smuggled host is rejected (RN URL-polyfill regression)', () => {
    const link = `https://evil.example/a/x?@${RELEASE.webHost}`;
    h.eq(parseAppLink(link), null, "a foreign host followed by '?@' + the real host must not parse");
  });

  await h.test('app-link: a fragment-smuggled host is rejected (the #@ variant)', () => {
    const link = `https://evil.example/a/x#@${RELEASE.webHost}`;
    h.eq(parseAppLink(link), null, "a foreign host followed by '#@' + the real host must not parse");
  });

  await h.test('app-link: an uppercase scheme is accepted (RN URL-polyfill regression)', () => {
    const link = `HTTPS://${RELEASE.webHost}/a/x`;
    h.eq(parseAppLink(link), 'x', 'an uppercase scheme must parse the same as lowercase');
  });

  await h.test('app-link: an uppercase scheme and host together are accepted', () => {
    const link = `HTTPS://${RELEASE.webHost.toUpperCase()}/a/x`;
    h.eq(parseAppLink(link), 'x', 'an uppercase scheme and uppercase host must both be tolerated');
  });

  await h.test('app-link: a real host as a subdomain suffix is rejected', () => {
    const link = `https://${RELEASE.webHost}.evil.example/a/x`;
    h.eq(parseAppLink(link), null, 'the real host embedded as a prefix of a foreign host must not parse');
  });

  await h.test('app-link: a backslash-then-userinfo host is rejected', () => {
    const link = `https://evil.example\\@${RELEASE.webHost}/a/x`;
    h.eq(parseAppLink(link), null, 'a backslash/userinfo trick around the real host must not parse');
  });

  await h.test('app-link: a port-bearing host is rejected', () => {
    const link = `https://${RELEASE.webHost}:443/a/x`;
    h.eq(parseAppLink(link), null, 'a host with an explicit port must not parse');
  });

  await h.test('app-link: an encoded slash in the id is rejected', () => {
    const link = `${RELEASE.appLinkBase}a%2Fb`;
    h.eq(parseAppLink(link), null, 'a decoded id containing "/" must not parse, even from %2F');
  });

  await h.test('app-link: a double-encoded id is decoded exactly once', () => {
    const onceEncoded = encodeURIComponent('50%'); // '50%25'
    const twiceEncoded = encodeURIComponent(onceEncoded); // '50%2525'
    const link = `${RELEASE.appLinkBase}${twiceEncoded}`;
    h.eq(parseAppLink(link), onceEncoded, 'only one decode pass runs, so the result is still percent-encoded');
  });

  await h.test('app-link: a malformed percent-escape is rejected', () => {
    h.eq(parseAppLink(`${RELEASE.appLinkBase}%`), null, 'a bare "%" cannot be decoded and must not parse');
  });

  await h.test('app-link: parsing does not depend on globalThis.URL (discriminating proof)', () => {
    const saved = globalThis.URL;
    class HostileUrl {
      constructor() {
        throw new Error('hostile URL stub: parseAppLink must never construct URL');
      }
    }
    try {
      // @ts-expect-error -- deliberately swapping in a hostile stand-in to prove parseAppLink never calls `new URL`
      globalThis.URL = HostileUrl;
      h.eq(parseAppLink(appLinkFor('x')), 'x', 'a normal link still parses when URL is hostile');
      h.eq(
        parseAppLink(`https://evil.example/a/x?@${RELEASE.webHost}`),
        null,
        'the query-smuggled-host case is still rejected when URL is hostile',
      );
    } finally {
      globalThis.URL = saved;
    }
  });
}
