/**
 * transport-shared Node suite (store-launch-compliance chain-2, task 2.3) — `consentedClientOptions`,
 * the one gate `clarifyPrompt`/`rewritePrompt`/`generateApp` require their options through (design
 * D2; spec ai-data-consent "Nothing is sent to the server before consent is granted").
 */
import { Harness } from './harness';
import { consentedClientOptions } from '../transport-shared';
import type { ConsentStatus } from '../ai-consent';

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
}
