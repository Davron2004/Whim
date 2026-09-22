/**
 * scheme-host Node suite (review fix N5) — spec app-links "URLs that aren't app links are
 * ignored" / "the log record names only the scheme and host". `schemeAndHostOf` must be anchored
 * regex only, never `new URL`: React Native's regex-based `URL` polyfill (the only `URL` that
 * exists on-device) can let a query string bleed into the parsed host on a hostile link. Node's
 * own `URL` never bleeds, so the table runs with `globalThis.URL` replaced by a stand-in that
 * answers wrongly: an implementation that reaches for `URL` fails here as it would on-device.
 */
import { Harness } from './harness';
import { schemeAndHostOf } from '../scheme-host';

const CASES: Array<[string, { scheme: string; host: string }, string]> = [
  ['https://whim.example/a/some-id', { scheme: 'https', host: 'whim.example' }, 'a normal link reads its scheme and host, dropping the path'],
  ['https://x.example/p?email=jane.doe@corp-internal', { scheme: 'https', host: 'x.example' }, 'an "@" inside the query is not userinfo (the reviewer’s repro)'],
  ['https://x.example?email=jane.doe@corp-internal', { scheme: 'https', host: 'x.example' }, 'nor when the query follows the host directly'],
  ['https://user:pass@evil.example/a/x', { scheme: 'https', host: 'evil.example' }, 'userinfo is discarded'],
  ['https://whim.example:8443/a/x', { scheme: 'https', host: 'whim.example' }, 'a port is not part of the host'],
  ['HTTPS://Whim.Example/a/x', { scheme: 'https', host: 'whim.example' }, 'scheme and host are lower-cased'],
  ['not a url at all', { scheme: 'unknown', host: 'unknown' }, 'an unparseable string reads as unknown, never throws'],
];

export async function runSchemeHostTests(h: Harness): Promise<void> {
  await h.test('schemeAndHostOf: each link logs only its own scheme and host, without ever using URL', () => {
    const saved = globalThis.URL;
    // Parses "successfully" into the wrong answer, the way a bleeding polyfill does, so neither a
    // URL-first nor a URL-with-fallback implementation can pass.
    class HostileUrl {
      readonly protocol = 'hostile:';
      readonly hostname = 'bled.invalid';
      readonly host = 'bled.invalid';
    }
    try {
      // @ts-expect-error -- deliberately swapping in a hostile stand-in to prove `URL` is never used
      globalThis.URL = HostileUrl;
      for (const [url, expected, why] of CASES) {
        h.eq(schemeAndHostOf(url), expected, `${why}: ${url}`);
      }
    } finally {
      globalThis.URL = saved;
    }
  });
}
