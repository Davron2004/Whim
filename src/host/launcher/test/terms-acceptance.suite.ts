/**
 * terms-acceptance Node suite (legal-surface-v2 task 4.1) — locks spec terms-acceptance "Terms
 * acceptance is versioned apart from consent": the record lives under `whim.terms:v1` as
 * `{ version, acceptedAt }`, counts only at the compiled terms version, fails closed on anything
 * unreadable, and neither record's version moves the other. Also the legal page URLs: each French
 * twin is its English page under `/fr`, on the Whim web origin.
 */

import { Harness } from './harness';
import { MapKVBackend } from '../../version-store';
import { RELEASE } from '../release-config';
import { acceptTerms, termsStatus } from '../terms-acceptance';
import { consentStatus, grantConsent } from '../ai-consent';

const TERMS_KEY = 'whim.terms:v1';
const CONSENT_KEY = 'whim.ai-consent:v1';
const ACCEPTED_AT = '2026-09-24T09:30:00.000Z';

/** A store holding a real acceptance whose version is moved by `shift`: what a build shipping
 *  another terms version would find. */
function shiftedAcceptance(shift: number): { kv: MapKVBackend; version: number } {
  const kv = new MapKVBackend();
  acceptTerms(kv, ACCEPTED_AT);
  const stored = JSON.parse(kv.getString(TERMS_KEY) ?? 'null') as { version: number; acceptedAt: string };
  const version = stored.version + shift;
  kv.set(TERMS_KEY, JSON.stringify({ ...stored, version }));
  return { kv, version };
}

export async function runTermsAcceptanceTests(h: Harness): Promise<void> {
  await h.test('terms-acceptance: a fresh store has no acceptance', () => {
    h.eq(termsStatus(new MapKVBackend()), { kind: 'absent' }, 'no record -> absent');
  });

  await h.test('terms-acceptance: accepting stores { version, acceptedAt } under whim.terms:v1 and reads back accepted', () => {
    const kv = new MapKVBackend();
    acceptTerms(kv, ACCEPTED_AT);
    const stored = JSON.parse(kv.getString(TERMS_KEY) ?? 'null') as Record<string, unknown>;
    h.eq(Object.keys(stored).sort((a, b) => a.localeCompare(b)), ['acceptedAt', 'version'], 'exactly the two fields');
    h.eq(stored.acceptedAt, ACCEPTED_AT, 'acceptedAt is the time given');
    h.eq(termsStatus(kv), { kind: 'accepted', version: stored.version, acceptedAt: ACCEPTED_AT }, 'reads back as a current acceptance');
  });

  for (const shift of [-1, 1]) {
    await h.test(`terms-acceptance: an acceptance of another terms version (${shift > 0 ? 'newer' : 'older'}) is outdated, carrying its version`, () => {
      const { kv, version } = shiftedAcceptance(shift);
      h.eq(termsStatus(kv), { kind: 'outdated', version }, 'compared for exact equality, never accepted');
      acceptTerms(kv, ACCEPTED_AT);
      h.eq(termsStatus(kv).kind, 'accepted', 'accepting again replaces it with a current acceptance');
    });
  }

  await h.test('terms-acceptance: a record that is not valid JSON counts as not accepted', () => {
    const kv = new MapKVBackend();
    kv.set(TERMS_KEY, '{"version":1,"acceptedAt":');
    h.eq(termsStatus(kv), { kind: 'absent' }, 'a corrupted acceptance fails closed, without throwing');
  });

  await h.test('terms-acceptance: a well-formed but wrongly shaped record counts as not accepted', () => {
    const accepted = new MapKVBackend();
    acceptTerms(accepted, ACCEPTED_AT);
    const good = JSON.parse(accepted.getString(TERMS_KEY) ?? 'null') as { version: number; acceptedAt: string };
    const cases: unknown[] = [
      { ...good, version: String(good.version) },
      { ...good, acceptedAt: 20260924 },
      { acceptedAt: good.acceptedAt },
      { version: good.version },
      null,
      'accepted',
      [good.version, good.acceptedAt],
    ];
    for (const value of cases) {
      const kv = new MapKVBackend();
      kv.set(TERMS_KEY, JSON.stringify(value));
      h.eq(termsStatus(kv), { kind: 'absent' }, `${JSON.stringify(value)} -> absent`);
    }
  });

  await h.test('terms-acceptance: accepting the terms grants no consent, and granting consent accepts no terms', () => {
    const termsOnly = new MapKVBackend();
    acceptTerms(termsOnly, ACCEPTED_AT);
    h.eq(consentStatus(termsOnly), { kind: 'absent' }, 'an acceptance leaves consent absent');
    const consentOnly = new MapKVBackend();
    grantConsent(consentOnly, ACCEPTED_AT);
    h.eq(termsStatus(consentOnly), { kind: 'absent' }, 'a grant leaves the terms unaccepted');
  });

  await h.test('terms-acceptance: a consent version bump leaves a current acceptance current', () => {
    const kv = new MapKVBackend();
    acceptTerms(kv, ACCEPTED_AT);
    // The consent grant exactly as the version-1 build stored it, under a build asking for a newer one.
    kv.set(CONSENT_KEY, '{"version":1,"grantedAt":"2026-09-01T12:00:00.000Z"}');
    h.eq(consentStatus(kv).kind, 'outdated', 'consent must be asked again');
    h.eq(termsStatus(kv).kind, 'accepted', 'the terms need no new acceptance');
    const before = kv.getString(TERMS_KEY);
    grantConsent(kv, ACCEPTED_AT);
    h.eq(kv.getString(TERMS_KEY), before, 'agreeing to the new consent leaves the terms record untouched');
  });

  await h.test('terms-acceptance: a terms version bump leaves a current consent grant current', () => {
    const { kv } = shiftedAcceptance(-1);
    grantConsent(kv, ACCEPTED_AT);
    h.eq(termsStatus(kv).kind, 'outdated', 'the terms must be accepted again');
    const grant = consentStatus(kv);
    h.eq(grant.kind, 'granted', 'the grant still stands');
    const before = kv.getString(CONSENT_KEY);
    acceptTerms(kv, ACCEPTED_AT);
    h.eq(kv.getString(CONSENT_KEY), before, 'accepting the new terms leaves the consent record untouched');
  });

  await h.test('release-config: each legal page has a French twin, the same page under /fr on the Whim web origin', () => {
    for (const [english, french] of [
      [RELEASE.privacyPolicyUrl, RELEASE.privacyPolicyUrlFr],
      [RELEASE.termsUrl, RELEASE.termsUrlFr],
    ]) {
      const en = new URL(english);
      const fr = new URL(french);
      h.eq([en.origin, fr.origin], [RELEASE.webOrigin, RELEASE.webOrigin], `${english} and its twin are on the web origin`);
      h.eq(fr.pathname, `/fr${en.pathname}`, `${french} is ${en.pathname} in French`);
    }
    h.ok(RELEASE.termsUrl !== RELEASE.privacyPolicyUrl, 'the terms and the privacy policy are different pages');
  });
}
