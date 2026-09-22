/**
 * transport-shared Node suite (store-launch-compliance chain-2, task 2.3) — `consentedClientOptions`,
 * the one gate `clarifyPrompt`/`rewritePrompt`/`generateApp` require their options through (design
 * D2; spec ai-data-consent "Nothing is sent to the server before consent is granted").
 */
import { Harness } from './harness';
import { consentedClientOptions, httpErrorFrom } from '../transport-shared';
import type { ConsentStatus } from '../ai-consent';

/** A `429 server_busy` response carrying the given raw `Retry-After` header value (or none). */
function refusalResponse(retryAfter?: string): Response {
  return new Response(JSON.stringify({ error: 'server_busy', hint: 'Try again soon' }), {
    status: 429,
    headers: retryAfter === undefined ? {} : { 'Retry-After': retryAfter },
  });
}

export async function runTransportSharedTests(h: Harness): Promise<void> {
  await h.test('consentedClientOptions: absent consent yields null', () => {
    const status: ConsentStatus = { kind: 'absent' };
    h.eq(consentedClientOptions(status, 'https://example.invalid', 'device-1'), null, 'no options without a grant');
  });

  await h.test('consentedClientOptions: outdated consent yields null', () => {
    const status: ConsentStatus = { kind: 'outdated' };
    h.eq(consentedClientOptions(status, 'https://example.invalid', 'device-1'), null, 'a stale grant is no grant');
  });

  await h.test('consentedClientOptions: a granted, current consent yields options carrying baseUrl and deviceId', () => {
    const status: ConsentStatus = { kind: 'granted', grantedAt: '2026-09-14T00:00:00.000Z' };
    const opts = consentedClientOptions(status, 'https://example.invalid', 'device-1');
    h.ok(opts !== null, 'options are produced');
    if (opts) {
      h.eq(opts.baseUrl, 'https://example.invalid', 'baseUrl carries through');
      h.eq(opts.deviceId, 'device-1', 'deviceId carries through');
    }
  });

  // httpErrorFrom's Retry-After parsing (design D8/D11), shared by the fetch, XHR and unary paths:
  // only a bare positive integer (delta-seconds) is read. `Number()` alone would also accept
  // scientific notation and hex, which HTTP's grammar does not allow, and the HTTP-date form is
  // deliberately never parsed. An unreadable value is dropped without disturbing anything else.
  await h.test('httpErrorFrom: Retry-After is read only as a bare positive integer; anything else leaves it absent', async () => {
    const cases: Array<[string, number | undefined]> = [
      ['120', 120], ['5', 5],
      ['0', undefined], ['-5', undefined], ['3.5', undefined], ['soon', undefined],
      ['1e3', undefined], ['0x10', undefined], [new Date(Date.now() + 120_000).toUTCString(), undefined],
    ];
    for (const [header, seconds] of cases) {
      const e = await httpErrorFrom(refusalResponse(header), '/v1/generate', 'https://example.invalid');
      h.ok(e.retryAfterSeconds === seconds, `Retry-After "${header}" reads as ${seconds} (got ${e.retryAfterSeconds})`);
      h.eq([e.kind, e.status, e.code, e.hint], ['http', 429, 'server_busy', 'Try again soon'], `and "${header}" leaves the rest of the error intact`);
    }
  });

}
