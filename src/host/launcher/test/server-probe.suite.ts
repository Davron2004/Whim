/**
 * server-probe Node suite (server-connectivity chain-2, tasks 2.1-2.2) — `probeServer` against
 * canned `fetchImpl` doubles, no real HTTP server. Mirrors `generation-client.suite.ts`'s
 * `fetchImpl`-double idiom (`hangingFetch` in particular).
 *
 * Scenarios (spec `server-connectivity/spec.md` "A shared probe classifies a server address as
 * verified, unverified, or unreachable"):
 *   - a 200 response carrying the Whim health identity stamp classifies verified.
 *   - a 200 response with an unrelated or unparseable body classifies unverified, not verified
 *     and not unreachable.
 *   - a non-200 response, a thrown network error, and a request that never resolves within the
 *     timeout all classify unreachable.
 *   - the timeout actually aborts the in-flight request (the signal handed to `fetchImpl` fires),
 *     rather than merely giving up client-side while the request keeps running underneath.
 *   - health-probe-path: `/health` is asked first; only a 404 on it falls back to `/healthz` (a
 *     server from before `/health`), every other outcome is final, and both requests share one
 *     deadline.
 */

import { Harness } from './harness';
import { APP_VERSION_HEADER, BUILD_HEADER, CONSENT_HEADER, PLATFORM_HEADER } from '@whim/contract';
import { probeServer, probeServerHealth } from '../server-probe';

const BASE_URL = 'https://example.invalid';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** Hono's answer for a path it has no route for — what a server from before `/health` sends. */
function honoNotFound(): Response {
  return new Response('404 Not Found', { status: 404, headers: { 'content-type': 'text/plain' } });
}

/** A `fetch` double answering by path, recording every request (url and signal) in order. A path
 *  with no entry is a test bug and throws, which the probe would otherwise swallow as unreachable. */
function routedFetch(routes: Record<string, () => Response | Promise<Response>>): {
  fetchImpl: typeof fetch;
  urls: string[];
  signals: (AbortSignal | undefined)[];
} {
  const urls: string[] = [];
  const signals: (AbortSignal | undefined)[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    urls.push(url);
    signals.push(init?.signal ?? undefined);
    const route = routes[new URL(url).pathname];
    if (route === undefined) throw new Error(`unexpected request ${url}`);
    return route();
  }) as typeof fetch;
  return { fetchImpl, urls, signals };
}

/** A `fetch` double that never resolves on its own — it settles only when the request's signal
 *  aborts, exactly as a real `fetch` does, so a fired timeout is observable (mirrors
 *  `generation-client.suite.ts`'s `hangingFetch`). */
function hangingFetch(record: { signal?: AbortSignal } = {}): typeof fetch {
  return (async (_url: string, init?: RequestInit) => {
    record.signal = init?.signal ?? undefined;
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')));
    });
  }) as typeof fetch;
}

/** Await `promise`, resolving to `'hung'` instead of hanging the whole suite if it never settles
 *  within `ms` — a bare `await` on a regressed timeout here would be an exit-13 hang, not a
 *  failed check. */
function withHungGuard<T>(promise: Promise<T>, ms: number): Promise<T | 'hung'> {
  return Promise.race([
    promise,
    new Promise<'hung'>((resolve) => {
      setTimeout(() => resolve('hung'), ms);
    }),
  ]);
}

export async function runServerProbeTests(h: Harness): Promise<void> {
  await h.test('probeServer: a 200 response carrying the Whim health identity stamp classifies verified, with no /healthz request', async () => {
    const { fetchImpl, urls } = routedFetch({ '/health': () => jsonResponse({ ok: true, service: 'whim-server' }) });
    const result = await probeServer(BASE_URL, { fetchImpl });
    h.eq(urls, [`${BASE_URL}/health`], 'requests GET <baseUrl>/health, once');
    h.eq(result, 'verified', 'classifies verified');
  });

  await h.test('probeServer: a 200 response with an unrelated service identity classifies unverified', async () => {
    const fetchImpl = (async () => jsonResponse({ ok: true, service: 'some-other-thing' })) as typeof fetch;
    const result = await probeServer(BASE_URL, { fetchImpl });
    h.eq(result, 'unverified', 'classifies unverified, not verified and not unreachable');
  });

  await h.test('probeServer: a 200 response with an unparseable (non-JSON) body classifies unverified', async () => {
    const fetchImpl = (async () => new Response('not json', { status: 200 })) as typeof fetch;
    const result = await probeServer(BASE_URL, { fetchImpl });
    h.eq(result, 'unverified', 'classifies unverified rather than throwing past the probe');
  });

  await h.test('probeServer: a non-200 response classifies unreachable', async () => {
    const fetchImpl = (async () => jsonResponse({ error: 'boom' }, 500)) as typeof fetch;
    const result = await probeServer(BASE_URL, { fetchImpl });
    h.eq(result, 'unreachable', 'classifies unreachable');
  });

  await h.test('probeServer: a thrown network error classifies unreachable', async () => {
    const fetchImpl = (async () => {
      throw new TypeError('fetch failed');
    }) as typeof fetch;
    const result = await probeServer(BASE_URL, { fetchImpl });
    h.eq(result, 'unreachable', 'classifies unreachable, does not throw past the probe');
  });

  await h.test(
    'probeServer: a request that never resolves within the timeout classifies unreachable, and the timeout actually ' +
      'aborts the in-flight request',
    async () => {
      const record: { signal?: AbortSignal } = {};
      const result = await withHungGuard(probeServer(BASE_URL, { fetchImpl: hangingFetch(record), timeoutMs: 20 }), 1000);
      h.ok(result !== 'hung', 'the probe settles instead of hanging forever');
      h.eq(result, 'unreachable', 'classifies unreachable rather than hanging forever');
      h.ok(record.signal !== undefined, 'the signal is threaded into the fetch call');
      h.ok(record.signal?.aborted === true, 'the timeout actually aborted the in-flight request, not just gave up client-side');
    },
  );

  // request-envelope: the server now reports its minimum builds on the same body; Settings'
  // save-time check must still recognise it (handoff/min-build.md, the default configuration).
  await h.test('probeServer: the /health body that reports minBuild still classifies verified', async () => {
    const fetchImpl = (async () => jsonResponse({ ok: true, service: 'whim-server', minBuild: { ios: 0, android: 0 } })) as typeof fetch;
    h.eq(await probeServer(BASE_URL, { fetchImpl }), 'verified', 'classifies verified');
  });

  // request-envelope: only `/v1` requests carry the envelope; the health routes are outside `/v1`.
  await h.test('probeServer: neither the /health probe nor its /healthz fallback carries any of the envelope headers', async () => {
    const sent: Headers[] = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      sent.push(new Headers(init?.headers));
      return new URL(url).pathname === '/health' ? honoNotFound() : jsonResponse({ ok: true, service: 'whim-server' });
    }) as typeof fetch;
    h.eq(await probeServer(BASE_URL, { fetchImpl }), 'verified', 'the probe ran, through the fallback');
    h.eq(sent.length, 2, 'both requests were made');
    const carried = sent.flatMap((headers) => [PLATFORM_HEADER, APP_VERSION_HEADER, BUILD_HEADER, CONSENT_HEADER].filter((name) => headers.has(name)));
    h.eq(carried, [], 'no envelope header rides on either');
  });

  // ── health-probe-path: /health first, /healthz only on a 404 ────────────────────────────────

  const WHIM = { ok: true, service: 'whim-server' };

  await h.test('probeServer: a server without /health (404) verifies through /healthz and its minimums are read from there', async () => {
    const minBuild = { ios: 12, android: 34 };
    const { fetchImpl, urls } = routedFetch({
      '/health': honoNotFound,
      '/healthz': () => jsonResponse({ ...WHIM, minBuild }),
    });
    h.eq(await probeServerHealth(BASE_URL, { fetchImpl }), { result: 'verified', minBuild }, 'verified, with the /healthz minimums');
    h.eq(urls, [`${BASE_URL}/health`, `${BASE_URL}/healthz`], '/health first, then /healthz');
  });

  await h.test('probeServer: minimums come from /health when it answers, not from /healthz', async () => {
    const { fetchImpl, urls } = routedFetch({ '/health': () => jsonResponse({ ...WHIM, minBuild: { ios: 5, android: 6 } }) });
    h.eq(await probeServerHealth(BASE_URL, { fetchImpl }), { result: 'verified', minBuild: { ios: 5, android: 6 } }, 'the /health minimums');
    h.eq(urls.length, 1, 'one request');
  });

  await h.test('probeServer: a 404 on both routes classifies unreachable after exactly the two requests', async () => {
    const { fetchImpl, urls } = routedFetch({ '/health': honoNotFound, '/healthz': honoNotFound });
    h.eq(await probeServer(BASE_URL, { fetchImpl }), 'unreachable', 'the final answer is a non-200');
    h.eq(urls, [`${BASE_URL}/health`, `${BASE_URL}/healthz`], 'no third request');
  });

  await h.test('probeServer: a /health network error is unreachable after exactly one request, with no /healthz fallback', async () => {
    const { fetchImpl, urls } = routedFetch({
      '/health': () => {
        throw new TypeError('fetch failed');
      },
      '/healthz': () => jsonResponse(WHIM),
    });
    h.eq(await probeServer(BASE_URL, { fetchImpl }), 'unreachable', 'classifies unreachable');
    h.eq(urls, [`${BASE_URL}/health`], 'a down server costs one request');
  });

  await h.test('probeServer: a /health that times out is unreachable after exactly one request, with no /healthz fallback', async () => {
    const urls: string[] = [];
    const hanging = hangingFetch();
    const fetchImpl = ((url: string, init?: RequestInit) => {
      urls.push(url);
      return hanging(url, init);
    }) as typeof fetch;
    const result = await withHungGuard(probeServer(BASE_URL, { fetchImpl, timeoutMs: 20 }), 1000);
    h.eq(result, 'unreachable', 'classifies unreachable');
    h.eq(urls, [`${BASE_URL}/health`], 'the timeout does not buy a second request');
  });

  await h.test('probeServer: a /health 500 is final — unreachable with no /healthz fallback', async () => {
    const { fetchImpl, urls } = routedFetch({ '/health': () => jsonResponse({ error: 'boom' }, 500), '/healthz': () => jsonResponse(WHIM) });
    h.eq(await probeServer(BASE_URL, { fetchImpl }), 'unreachable', 'classifies unreachable although /healthz would have verified');
    h.eq(urls, [`${BASE_URL}/health`], 'one request');
  });

  await h.test('probeServer: a /health 200 with a non-Whim body is unverified with no /healthz fallback', async () => {
    const { fetchImpl, urls } = routedFetch({
      '/health': () => jsonResponse({ ok: true, service: 'some-other-thing' }),
      '/healthz': () => jsonResponse(WHIM),
    });
    h.eq(await probeServer(BASE_URL, { fetchImpl }), 'unverified', 'classifies unverified although /healthz would have verified');
    h.eq(urls, [`${BASE_URL}/health`], 'one request');
  });

  await h.test('probeServer: the fallback is classified like any answer — a 200 non-Whim /healthz body is unverified', async () => {
    const { fetchImpl } = routedFetch({ '/health': honoNotFound, '/healthz': () => new Response('<html>nope</html>', { status: 200 }) });
    h.eq(await probeServer(BASE_URL, { fetchImpl }), 'unverified', 'classifies unverified');
  });

  await h.test('probeServer: both requests share one deadline — a slow /healthz fallback is aborted by the same timeout', async () => {
    const urls: string[] = [];
    const signals: (AbortSignal | undefined)[] = [];
    const hanging = hangingFetch();
    const fetchImpl = ((url: string, init?: RequestInit) => {
      urls.push(url);
      signals.push(init?.signal ?? undefined);
      return new URL(url).pathname === '/health' ? Promise.resolve(honoNotFound()) : hanging(url, init);
    }) as typeof fetch;
    const result = await withHungGuard(probeServer(BASE_URL, { fetchImpl, timeoutMs: 20 }), 1000);
    h.ok(result !== 'hung', 'the probe settles instead of hanging on the fallback');
    h.eq(result, 'unreachable', 'the aborted fallback classifies unreachable');
    h.eq(urls, [`${BASE_URL}/health`, `${BASE_URL}/healthz`], 'the fallback was attempted');
    h.ok(signals[0] !== undefined && signals[0] === signals[1], 'one signal covers both requests');
    h.ok(signals[1]?.aborted === true, 'the deadline aborted the fallback');
  });
}
