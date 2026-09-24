/**
 * server-probe Node suite (server-connectivity chain-2, tasks 2.1-2.2) — `probeServer` against
 * canned `fetchImpl` doubles, no real HTTP server. Mirrors `generation-client.suite.ts`'s
 * `fetchImpl`-double idiom (`hangingFetch` in particular).
 *
 * Scenarios (spec `server-connectivity/spec.md` "A shared probe classifies a server address as
 * verified, unverified, or unreachable"):
 *   - a 200 response carrying the Whim healthz identity stamp classifies verified.
 *   - a 200 response with an unrelated or unparseable body classifies unverified, not verified
 *     and not unreachable.
 *   - a non-200 response, a thrown network error, and a request that never resolves within the
 *     timeout all classify unreachable.
 *   - the timeout actually aborts the in-flight request (the signal handed to `fetchImpl` fires),
 *     rather than merely giving up client-side while the request keeps running underneath.
 */

import { Harness } from './harness';
import { APP_VERSION_HEADER, BUILD_HEADER, CONSENT_HEADER, PLATFORM_HEADER } from '@whim/contract';
import { probeServer } from '../server-probe';

const BASE_URL = 'https://example.invalid';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
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
  await h.test('probeServer: a 200 response carrying the Whim healthz identity stamp classifies verified', async () => {
    let requestedUrl: string | undefined;
    const fetchImpl = (async (url: string) => {
      requestedUrl = url;
      return jsonResponse({ ok: true, service: 'whim-server' });
    }) as typeof fetch;
    const result = await probeServer(BASE_URL, { fetchImpl });
    h.eq(requestedUrl, `${BASE_URL}/healthz`, 'requests GET <baseUrl>/healthz');
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
  await h.test('probeServer: the /healthz body that reports minBuild still classifies verified', async () => {
    const fetchImpl = (async () => jsonResponse({ ok: true, service: 'whim-server', minBuild: { ios: 0, android: 0 } })) as typeof fetch;
    h.eq(await probeServer(BASE_URL, { fetchImpl }), 'verified', 'classifies verified');
  });

  // request-envelope: only `/v1` requests carry the envelope; `/healthz` is outside `/v1`.
  await h.test('probeServer: the /healthz probe carries none of the envelope headers', async () => {
    let sent: Headers | undefined;
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      sent = new Headers(init?.headers);
      return jsonResponse({ ok: true, service: 'whim-server' });
    }) as typeof fetch;
    h.eq(await probeServer(BASE_URL, { fetchImpl }), 'verified', 'the probe ran');
    const carried = [PLATFORM_HEADER, APP_VERSION_HEADER, BUILD_HEADER, CONSENT_HEADER].filter((name) => sent?.has(name));
    h.eq(carried, [], 'no envelope header rides on it');
  });
}
