/**
 * ai-consent Node suite (task 1.3) — locks ai-data-consent spec "Consent grants are versioned":
 * a fresh store reads `absent`, `grantConsent` round-trips to `granted`, a stored grant under a
 * different version reads `outdated`, `revokeConsent` deletes the grant, and a missing,
 * unreadable, or malformed record all fail closed to `absent`.
 */

import { Harness } from './harness';
import { MapKVBackend } from '../../version-store';
import { AI_CONSENT_VERSION } from '../release-config';
import { consentStatus, grantConsent, revokeConsent } from '../ai-consent';

const CONSENT_KEY = 'whim.ai-consent:v1';
const GRANTED_AT = '2026-09-14T00:00:00.000Z';

export async function runAiConsentTests(h: Harness): Promise<void> {
  await h.test('ai-consent: a fresh store reads absent', () => {
    const kv = new MapKVBackend();
    h.eq(consentStatus(kv), { kind: 'absent' }, 'no key stored -> absent');
  });

  await h.test('ai-consent: grantConsent round-trips to granted at the compiled version', () => {
    const kv = new MapKVBackend();
    grantConsent(kv, GRANTED_AT);
    const stored = JSON.parse(kv.getString(CONSENT_KEY) ?? 'null') as { version: number };
    h.eq(consentStatus(kv), { kind: 'granted', version: stored.version, grantedAt: GRANTED_AT }, 'granted, carrying the stored grant’s version and grantedAt');
  });

  await h.test('ai-consent: a stored grant under a lower version reads outdated', () => {
    const kv = new MapKVBackend();
    kv.set(CONSENT_KEY, JSON.stringify({ version: AI_CONSENT_VERSION - 1, grantedAt: GRANTED_AT }));
    h.eq(consentStatus(kv), { kind: 'outdated' }, 'version below the compiled version -> outdated, never granted');
  });

  await h.test('ai-consent: a stored grant under a higher version also reads outdated', () => {
    const kv = new MapKVBackend();
    kv.set(CONSENT_KEY, JSON.stringify({ version: AI_CONSENT_VERSION + 1, grantedAt: GRANTED_AT }));
    h.eq(consentStatus(kv), { kind: 'outdated' }, 'version compared for exact equality, not a range');
  });

  await h.test('ai-consent: revokeConsent deletes the grant, returning to absent', () => {
    const kv = new MapKVBackend();
    grantConsent(kv, GRANTED_AT);
    h.eq(consentStatus(kv).kind, 'granted', 'granted before revoking');
    revokeConsent(kv);
    h.eq(consentStatus(kv), { kind: 'absent' }, 'absent after revoking');
  });

  await h.test('ai-consent: malformed JSON reads as absent (fails closed)', () => {
    const kv = new MapKVBackend();
    kv.set(CONSENT_KEY, 'not json at all {');
    h.eq(consentStatus(kv), { kind: 'absent' }, 'unparseable record -> absent, not a thrown error');
  });

  await h.test('ai-consent: a well-formed but wrong-shaped record reads as absent', () => {
    const cases: unknown[] = [
      { version: '1', grantedAt: GRANTED_AT }, // version not a number
      { version: AI_CONSENT_VERSION, grantedAt: 12345 }, // grantedAt not a string
      { grantedAt: GRANTED_AT }, // missing version
      { version: AI_CONSENT_VERSION }, // missing grantedAt
      null,
      'a bare string',
      [1, 2, 3],
    ];
    for (const value of cases) {
      const kv = new MapKVBackend();
      kv.set(CONSENT_KEY, JSON.stringify(value));
      h.eq(consentStatus(kv), { kind: 'absent' }, `malformed record ${JSON.stringify(value)} -> absent`);
    }
  });
}
