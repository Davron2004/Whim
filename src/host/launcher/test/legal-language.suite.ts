/**
 * legal-language Node suite (legal-surface-v2 task 6.1; spec legal-text-localization "Legal text
 * is French first on a French-language phone, with an express choice of English"): a stored
 * choice wins and is kept under `whim.legal-language:v1`; without one, any French locale gives
 * French and everything else English; the locale comes from `Intl`, with the platform constant
 * as the fallback.
 */

import { Harness } from './harness';
import { MapKVBackend } from '../../version-store';
import { activeLegalLanguage, chooseLegalLanguage, intlLocale, preferredLocale } from '../legal-language';

const CHOICE_KEY = 'whim.legal-language:v1';

/** Runs `body` with `globalThis.Intl` replaced by `replacement`, restoring it after. */
function withIntl<T>(replacement: unknown, body: () => T): T {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'Intl');
  Object.defineProperty(globalThis, 'Intl', { value: replacement, configurable: true, writable: true });
  try {
    return body();
  } finally {
    if (original) Object.defineProperty(globalThis, 'Intl', original);
  }
}

/** An `Intl` whose default date format resolves to `locale`, as Hermes's does on a phone. */
function intlResolving(locale: string): unknown {
  return { DateTimeFormat: () => ({ resolvedOptions: () => ({ locale }) }) };
}

export async function runLegalLanguageTests(h: Harness): Promise<void> {
  await h.test('legal-language: with no choice, a French phone in any region gets French', () => {
    for (const locale of ['fr-CA', 'fr-FR', 'fr', 'fr_CA', 'FR-ca']) {
      h.eq(activeLegalLanguage(new MapKVBackend(), locale), 'fr', `${locale} -> fr`);
    }
  });

  await h.test('legal-language: with no choice, any other phone gets English', () => {
    // `frr` (North Frisian) and `fy` share letters with `fr` but are other languages.
    for (const locale of ['en-US', 'en-CA', 'es-MX', 'frr-DE', 'fy-NL', undefined]) {
      h.eq(activeLegalLanguage(new MapKVBackend(), locale), 'en', `${String(locale)} -> en`);
    }
  });

  await h.test('legal-language: a choice wins over the phone’s language and is kept under whim.legal-language:v1', () => {
    const kv = new MapKVBackend();
    chooseLegalLanguage(kv, 'en');
    h.eq(activeLegalLanguage(kv, 'fr-CA'), 'en', 'English chosen on a fr-CA phone stays English');
    h.eq(kv.getString(CHOICE_KEY), 'en', 'the choice is stored under the spec’s key');
    chooseLegalLanguage(kv, 'fr');
    h.eq(activeLegalLanguage(kv, 'en-US'), 'fr', 'French chosen on an en-US phone stays French');
  });

  await h.test('legal-language: an unreadable stored choice is ignored, and the phone’s language decides', () => {
    for (const stored of ['de', 'FR', '{"language":"en"}', '']) {
      const kv = new MapKVBackend();
      kv.set(CHOICE_KEY, stored);
      h.eq(activeLegalLanguage(kv, 'fr-CA'), 'fr', `stored ${JSON.stringify(stored)} on fr-CA -> fr`);
      h.eq(activeLegalLanguage(kv, 'en-US'), 'en', `stored ${JSON.stringify(stored)} on en-US -> en`);
    }
  });

  await h.test('legal-language: the locale comes from Intl, and the platform constant only when Intl has none', () => {
    h.eq(withIntl(intlResolving('fr-CA'), intlLocale), 'fr-CA', 'Intl’s resolved default locale is read');
    h.eq(withIntl(undefined, intlLocale), undefined, 'a runtime without Intl reads nothing');
    h.eq(preferredLocale('en-US', 'fr_CA'), 'en-US', 'Intl wins over the platform constant');
    h.eq(preferredLocale(undefined, 'fr_CA'), 'fr_CA', 'without Intl, the platform constant is used');
    h.eq(preferredLocale('', 'fr_CA'), 'fr_CA', 'an empty Intl answer counts as none');
    h.eq(preferredLocale(undefined, undefined), undefined, 'neither source: no locale');
    const withoutIntl = withIntl(undefined, () => preferredLocale(intlLocale(), 'fr_CA'));
    h.eq(activeLegalLanguage(new MapKVBackend(), withoutIntl), 'fr', 'a French Android phone without Intl still gets French');
  });
}
