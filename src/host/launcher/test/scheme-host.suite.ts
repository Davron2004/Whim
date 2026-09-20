/**
 * scheme-host Node suite (review fix N5) — spec app-links "URLs that aren't app links are
 * ignored" / "the log record names only the scheme and host". `schemeAndHostOf` must be anchored
 * regex only, never `new URL`: React Native's regex-based `URL` polyfill (the only `URL` that
 * exists on-device) can let a query string bleed into the parsed host on a hostile link — this
 * suite pins the reviewer's exact repro alongside a normal link.
 */
import { Harness } from './harness';
import { schemeAndHostOf } from '../scheme-host';

export async function runSchemeHostTests(h: Harness): Promise<void> {
  await h.test('schemeAndHostOf: a normal link resolves its scheme and host, dropping the path', () => {
    h.eq(
      schemeAndHostOf('https://whim.example/a/some-id'),
      { scheme: 'https', host: 'whim.example' },
      'a well-formed app link reads its own scheme and host',
    );
  });

  await h.test('schemeAndHostOf: a query string never bleeds into the host (the reviewer\'s repro)', () => {
    h.eq(
      schemeAndHostOf('https://x.example/p?email=jane.doe@corp-internal'),
      { scheme: 'https', host: 'x.example' },
      'the "@" inside the query string must not be mistaken for userinfo separating a different host',
    );
  });

  await h.test('schemeAndHostOf: userinfo in the authority is stripped from the logged host', () => {
    h.eq(
      schemeAndHostOf('https://user:pass@evil.example/a/x'),
      { scheme: 'https', host: 'evil.example' },
      'userinfo is discarded, leaving only the real host',
    );
  });

  await h.test('schemeAndHostOf: a port is dropped from the logged host', () => {
    h.eq(
      schemeAndHostOf('https://whim.example:8443/a/x'),
      { scheme: 'https', host: 'whim.example' },
      'a port is not part of the host the log record names',
    );
  });

  await h.test('schemeAndHostOf: scheme and host are lower-cased', () => {
    h.eq(
      schemeAndHostOf('HTTPS://Whim.Example/a/x'),
      { scheme: 'https', host: 'whim.example' },
      'case is normalized, matching the original new-URL-based behavior',
    );
  });

  await h.test('schemeAndHostOf: an unparseable string reads as unknown/unknown, never throws', () => {
    h.eq(
      schemeAndHostOf('not a url at all'),
      { scheme: 'unknown', host: 'unknown' },
      'a malformed URL is still just a rejection, logged without a crash',
    );
  });
}
