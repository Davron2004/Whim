/**
 * transport-shared Node suite (store-launch-compliance chain-2, task 2.3) — `consentedClientOptions`,
 * the one gate `clarifyPrompt`/`rewritePrompt`/`generateApp` require their options through (design
 * D2; spec ai-data-consent "Nothing is sent to the server before consent is granted"; spec
 * terms-acceptance "The send gate requires both a terms acceptance and a consent grant").
 */
import { Harness } from './harness';
import { APP_VERSION_HEADER, BUILD_HEADER, CONSENT_HEADER, PLATFORM_HEADER, REQUEST_ID_HEADER } from '@whim/contract';
import { MapKVBackend } from '../../version-store';
import { GenerationClientError, consentedClientOptions, httpErrorFrom, reportClientOptions, requestHeaders } from '../transport-shared';
import { consentStatus, grantConsent } from '../ai-consent';
import type { ConsentStatus } from '../ai-consent';
import { acceptTerms, termsStatus } from '../terms-acceptance';
import type { TermsStatus } from '../terms-acceptance';
import { appInfoFrom, appInfoReader } from '../app-info';
import { log } from '../../logging';
import { CHANNELS } from '../../logging/channels';
import { testAppInfo } from './client-fixtures';

const CONSENT_KEY = 'whim.ai-consent:v1';
const TERMS_KEY = 'whim.terms:v1';
const GRANTED_AT = '2026-09-14T00:00:00.000Z';

/** A current terms acceptance, read back through the real terms store. */
function acceptedTerms(): TermsStatus {
  const kv = new MapKVBackend();
  acceptTerms(kv, GRANTED_AT);
  return termsStatus(kv);
}

/** The terms stores a phone can be in, each built through the real terms store: a fresh
 *  acceptance, one of another terms version, a corrupted record, and none at all. */
function termsStores(): Array<{ name: string; kv: MapKVBackend }> {
  const accepted = new MapKVBackend();
  acceptTerms(accepted, GRANTED_AT);
  const outdated = new MapKVBackend();
  acceptTerms(outdated, GRANTED_AT);
  const acceptance = JSON.parse(outdated.getString(TERMS_KEY) ?? 'null') as { version: number };
  outdated.set(TERMS_KEY, JSON.stringify({ ...acceptance, version: acceptance.version + 1 }));
  const corrupted = new MapKVBackend();
  corrupted.set(TERMS_KEY, '{not json');
  return [
    { name: 'accepted', kv: accepted },
    { name: 'outdated', kv: outdated },
    { name: 'corrupted', kv: corrupted },
    { name: 'absent', kv: new MapKVBackend() },
  ];
}

/** The consent stores a phone can be in, each built through the real consent store: a fresh grant,
 *  a grant from an earlier consent version, a corrupted record, and none at all. */
function consentStores(): Array<{ name: string; kv: MapKVBackend }> {
  const granted = new MapKVBackend();
  grantConsent(granted, GRANTED_AT);
  const outdated = new MapKVBackend();
  grantConsent(outdated, GRANTED_AT);
  const grant = JSON.parse(outdated.getString(CONSENT_KEY) ?? 'null') as { version: number };
  outdated.set(CONSENT_KEY, JSON.stringify({ ...grant, version: grant.version - 1 }));
  const corrupted = new MapKVBackend();
  corrupted.set(CONSENT_KEY, '{not json');
  return [
    { name: 'granted', kv: granted },
    { name: 'outdated', kv: outdated },
    { name: 'corrupted', kv: corrupted },
    { name: 'absent', kv: new MapKVBackend() },
  ];
}

/** The version a stored, readable grant record names. */
function storedVersion(kv: MapKVBackend): number | undefined {
  return (JSON.parse(kv.getString(CONSENT_KEY) ?? 'null') as { version?: number } | null)?.version;
}

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
    h.eq(consentedClientOptions(acceptedTerms(), status, 'https://example.invalid', 'device-1', testAppInfo), null, 'no options without a grant');
  });

  await h.test('consentedClientOptions: outdated consent yields null', () => {
    const status: ConsentStatus = { kind: 'outdated', version: 1 };
    h.eq(consentedClientOptions(acceptedTerms(), status, 'https://example.invalid', 'device-1', testAppInfo), null, 'a stale grant is no grant');
  });

  await h.test('consentedClientOptions: a granted, current consent yields options carrying baseUrl and deviceId', () => {
    const kv = new MapKVBackend();
    grantConsent(kv, GRANTED_AT);
    const opts = consentedClientOptions(acceptedTerms(), consentStatus(kv), 'https://example.invalid', 'device-1', testAppInfo);
    h.ok(opts !== null, 'options are produced');
    if (opts) {
      h.eq(opts.baseUrl, 'https://example.invalid', 'baseUrl carries through');
      h.eq(opts.deviceId, 'device-1', 'deviceId carries through');
    }
  });

  // request-envelope risk: the server's consent backstop would block a real user only if the phone
  // sent `none` to an AI route. Every consent store the phone can be in either yields no gated
  // options at all, or options whose consent header is the stored grant's own version.
  await h.test('consentedClientOptions: gated options always carry the granted version, never none', () => {
    for (const { name, kv } of consentStores()) {
      const opts = consentedClientOptions(acceptedTerms(), consentStatus(kv), 'https://example.invalid', 'device-1', testAppInfo);
      if (opts === null) {
        h.ok(name !== 'granted', `${name}: no options, so nothing can be sent`);
        continue;
      }
      const consent = requestHeaders(opts, '/v1/clarify')[CONSENT_HEADER];
      h.ok(name === 'granted', `${name}: only a current grant yields options`);
      h.eq(consent, String(storedVersion(kv)), `${name}: the consent header is the stored grant’s version`);
      h.ok(/^[1-9]\d*$/.test(consent), `${name}: a positive version, never none (got ${consent})`);
    }
  });

  // terms-acceptance "A grant without terms sends nothing": a current grant alone is not enough —
  // every terms store other than a current acceptance yields no options, even beside a fresh grant.
  await h.test('consentedClientOptions: a current grant yields options only beside a current terms acceptance', () => {
    const granted = new MapKVBackend();
    grantConsent(granted, GRANTED_AT);
    for (const { name, kv } of termsStores()) {
      const opts = consentedClientOptions(termsStatus(kv), consentStatus(granted), 'https://example.invalid', 'device-1', testAppInfo);
      h.eq(opts !== null, name === 'accepted', `${name} terms beside a current grant: ${name === 'accepted' ? 'options' : 'no options'}`);
    }
  });

  await h.test('consentedClientOptions: a current terms acceptance alone yields nothing either', () => {
    for (const { name, kv } of consentStores()) {
      const opts = consentedClientOptions(acceptedTerms(), consentStatus(kv), 'https://example.invalid', 'device-1', testAppInfo);
      h.eq(opts !== null, name === 'granted', `accepted terms beside a ${name} grant: ${name === 'granted' ? 'options' : 'no options'}`);
    }
  });

  await h.test('reportClientOptions: a report without a grant says none; with a current grant, that grant’s version', () => {
    for (const { name, kv } of consentStores()) {
      const opts = reportClientOptions(consentStatus(kv), 'https://example.invalid', 'device-1', testAppInfo);
      const consent = requestHeaders(opts, '/v1/report')[CONSENT_HEADER];
      h.eq(consent, name === 'granted' ? String(storedVersion(kv)) : 'none', `${name}: the report’s consent header`);
    }
  });

  await h.test('requestHeaders: the platform, version and build come from the installed app, read per request', () => {
    const status: ConsentStatus = { kind: 'absent' };
    let reads = 0;
    const build = (value: string) => () => {
      reads++;
      return appInfoFrom('android', { version: '2.1.0-beta.3', build: value });
    };
    const first = reportClientOptions(status, 'https://example.invalid', 'device-1', build('380642'));
    const second = reportClientOptions(status, 'https://example.invalid', 'device-1', build('380643'));
    h.eq(reads, 0, 'making the options reads nothing');
    const a = requestHeaders(first, '/v1/report');
    const b = requestHeaders(second, '/v1/report');
    h.eq(reads, 2, 'each request reads the installed app when it is built');
    h.eq([a[PLATFORM_HEADER], a[APP_VERSION_HEADER], a[BUILD_HEADER]], ['android', '2.1.0-beta.3', '380642'], 'one build sends its own values');
    h.eq(b[BUILD_HEADER], '380643', 'and another build of the same source sends its own build number');
    h.eq(a['x-whim-device'], 'device-1', 'next to the device id');
  });

  await h.test('requestHeaders: an unreadable installed app fails the request as a client error, with no partial envelope', async () => {
    const missingModule = appInfoReader('ios', () => null);
    const kv = new MapKVBackend();
    grantConsent(kv, GRANTED_AT);
    const opts = consentedClientOptions(acceptedTerms(), consentStatus(kv), 'https://example.invalid', 'device-1', missingModule);
    h.ok(opts !== null, 'making the options does not read the installed app, so it cannot fail there');
    if (!opts) return;
    const before = log.buffer.snapshot().length;
    let caught: unknown;
    try {
      requestHeaders(opts, '/v1/clarify');
    } catch (err) {
      caught = err;
    }
    h.ok(caught instanceof GenerationClientError, 'building the request throws a GenerationClientError, not a crash');
    h.eq((caught as GenerationClientError | undefined)?.kind, 'client', 'classified client: nothing was sent');
    h.eq((caught as GenerationClientError | undefined)?.hint, 'WhimAppInfo: the native module is missing from this build', 'carrying the reader’s own message');
    const logged = log.buffer.snapshot().slice(before).find((r) => r.channel === CHANNELS.gen && r.fields.route === '/v1/clarify');
    h.eq(logged?.fields.kind, 'client', 'and it is recorded on the generation channel');
  });

  await h.test('httpErrorFrom: the refusal and device-id errors carry the response’s request id; none without the header', async () => {
    const withId = (body: unknown, status: number) =>
      new Response(JSON.stringify(body), { status, headers: { [REQUEST_ID_HEADER]: 'req-7' } });
    const refused = await httpErrorFrom(withId({ error: 'server_busy', hint: 'Try again soon' }, 429), '/v1/generate', 'https://example.invalid');
    const device = await httpErrorFrom(withId({ error: 'missing_device_id', hint: 'Include a UUID.' }, 400), '/v1/clarify', 'https://example.invalid');
    h.eq([refused.kind, refused.requestId], ['http', 'req-7'], 'a refusal exposes the id');
    h.eq([device.kind, device.requestId], ['device_id', 'req-7'], 'so does a device-id rejection');
    const bare = await httpErrorFrom(refusalResponse(), '/v1/generate', 'https://example.invalid');
    h.eq(bare.requestId, undefined, 'a response without the header has no id');
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
