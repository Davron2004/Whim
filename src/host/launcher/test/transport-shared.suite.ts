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

  // httpErrorFrom's Retry-After parsing (design D8/D11): only a bare positive integer
  // (delta-seconds) is accepted — `Number()` alone would also accept scientific notation and hex,
  // neither of which is a delta-seconds value HTTP's grammar allows, and the HTTP-date form is
  // deliberately never parsed (see transport-shared.ts).
  await h.test('httpErrorFrom: Retry-After "1e3" (scientific notation) is rejected, not read as 1000', async () => {
    const e = await httpErrorFrom(refusalResponse('1e3'), '/v1/generate', 'https://example.invalid');
    h.eq(e.retryAfterSeconds, undefined, '"1e3" is not a bare digit string');
  });

  await h.test('httpErrorFrom: Retry-After "0x10" (hex) is rejected, not read as 16', async () => {
    const e = await httpErrorFrom(refusalResponse('0x10'), '/v1/generate', 'https://example.invalid');
    h.eq(e.retryAfterSeconds, undefined, '"0x10" is not a bare digit string');
  });

  await h.test('httpErrorFrom: Retry-After "-5" is rejected', async () => {
    const e = await httpErrorFrom(refusalResponse('-5'), '/v1/generate', 'https://example.invalid');
    h.eq(e.retryAfterSeconds, undefined, 'a negative value is treated as absent');
  });

  await h.test('httpErrorFrom: Retry-After "5" (plain delta-seconds) is accepted', async () => {
    const e = await httpErrorFrom(refusalResponse('5'), '/v1/generate', 'https://example.invalid');
    h.eq(e.retryAfterSeconds, 5, 'a bare positive integer is read as delta-seconds');
  });

  await h.test('httpErrorFrom: an HTTP-date Retry-After is treated as absent, not parsed', async () => {
    const futureDate = new Date(Date.now() + 120_000).toUTCString();
    const e = await httpErrorFrom(refusalResponse(futureDate), '/v1/generate', 'https://example.invalid');
    h.eq(e.retryAfterSeconds, undefined, 'only the delta-seconds form is accepted; an HTTP-date is absent');
  });
}
