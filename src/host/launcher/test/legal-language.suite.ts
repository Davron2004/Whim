/**
 * legal-language Node suite (legal-surface-v2 task 6.1; spec legal-text-localization "Legal text
 * is French first on a French-language phone, with an express choice of English"): a stored
 * choice wins and is kept under `whim.legal-language:v1`; without one, any French locale gives
 * French and everything else English; the locale comes from the user's preferred languages on
 * iOS and from `Intl` on Android, each with the other source as the fallback; and a legal date is
 * written unambiguously in the phone's locale, or Canadian French with the French legal text.
 */

import { Harness } from './harness';
import { MapKVBackend } from '../../version-store';
import { activeLegalLanguage, chooseLegalLanguage, intlLocale, legalDateLabel, preferredLocale } from '../legal-language';
import { deviceLocale } from '../device-locale';
import { I18nManager, Platform, Settings } from './native-host';

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

/** What a phone reports besides `Intl`: its OS, the iOS user's preferred languages, and Android's
 *  first configured locale. */
interface PhonePlatform {
  os: 'ios' | 'android';
  appleLanguages?: string[];
  localeIdentifier?: string;
}

/** Runs `body` as a phone reporting `phone`, restoring the react-native shims after. */
function onPhone<T>(phone: PhonePlatform, body: () => T): T {
  const saved = { os: Platform.OS, get: Settings.get, getConstants: I18nManager.getConstants };
  const constants = I18nManager as unknown as { getConstants: () => { localeIdentifier?: string } };
  Platform.OS = phone.os;
  Settings.get = (key: string): unknown => (key === 'AppleLanguages' ? phone.appleLanguages : undefined);
  constants.getConstants = () => ({ ...saved.getConstants(), localeIdentifier: phone.localeIdentifier });
  try {
    return body();
  } finally {
    Platform.OS = saved.os;
    Settings.get = saved.get;
    I18nManager.getConstants = saved.getConstants;
  }
}

/** Noon, local time, on 24 September 2026: the same calendar day in every time zone's formatting. */
const SEPT_24 = new Date(2026, 8, 24, 12).toISOString();

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

  await h.test('legal-language: the first source wins, and the fallback only when the first has none', () => {
    h.eq(withIntl(intlResolving('fr-CA'), intlLocale), 'fr-CA', 'Intl’s resolved default locale is read');
    h.eq(withIntl(undefined, intlLocale), undefined, 'a runtime without Intl reads nothing');
    h.eq(preferredLocale('en-US', 'fr_CA'), 'en-US', 'the first source wins over the fallback');
    h.eq(preferredLocale(undefined, 'fr_CA'), 'fr_CA', 'without a first answer, the fallback is used');
    h.eq(preferredLocale('', 'fr_CA'), 'fr_CA', 'an empty answer counts as none');
    h.eq(preferredLocale(undefined, undefined), undefined, 'neither source: no locale');
  });

  await h.test('device-locale: a French iPhone gets French even when Intl follows the app’s English-only localizations', () => {
    const locale = withIntl(intlResolving('en-CA'), () => onPhone({ os: 'ios', appleLanguages: ['fr-CA', 'en-CA'] }, deviceLocale));
    h.eq(locale, 'fr-CA', 'the first of the user’s preferred languages, not Intl’s en-CA');
    h.eq(activeLegalLanguage(new MapKVBackend(), locale), 'fr', 'so the legal text is French');
    const noList = withIntl(intlResolving('fr-FR'), () => onPhone({ os: 'ios' }, deviceLocale));
    h.eq(noList, 'fr-FR', 'without a preferred-languages list, Intl answers');
  });

  await h.test('device-locale: Android asks Intl first, and I18nManager’s locale only when Intl has none', () => {
    const android: PhonePlatform = { os: 'android', appleLanguages: ['de-DE'], localeIdentifier: 'fr_CA' };
    h.eq(withIntl(intlResolving('en-CA'), () => onPhone(android, deviceLocale)), 'en-CA', 'Intl follows the phone on Android');
    const withoutIntl = withIntl(undefined, () => onPhone(android, deviceLocale));
    h.eq(withoutIntl, 'fr_CA', 'without Intl, the first configured locale');
    h.eq(activeLegalLanguage(new MapKVBackend(), withoutIntl), 'fr', 'so a French Android phone without Intl still gets French');
  });

  await h.test('legal-language: a legal date names its month, in the phone’s locale or Canadian French with the French text', () => {
    h.eq(legalDateLabel(SEPT_24, 'en', 'en-CA'), 'Sep 24, 2026', 'a Canadian English phone');
    h.eq(legalDateLabel(SEPT_24, 'en', 'en-US'), 'Sep 24, 2026', 'a US phone reads the same, never 9/24/2026');
    h.ok(legalDateLabel(SEPT_24, 'en', 'en-GB').startsWith('24 Sep'), 'a British phone puts the day first');
    h.eq(legalDateLabel(SEPT_24, 'fr', 'en-US'), '24 sept. 2026', 'the French legal text writes it in Canadian French, whatever the phone');
    h.eq(legalDateLabel(SEPT_24, 'en', 'fr_CA'), '24 sept. 2026', 'an Android-style fr_CA identifier is read');
  });

  await h.test('legal-language: without Intl, or with a locale it rejects, a legal date is the ISO day', () => {
    h.eq(withIntl(undefined, () => legalDateLabel(SEPT_24, 'en', 'en-CA')), '2026-09-24', 'no Intl');
    h.eq(legalDateLabel(SEPT_24, 'en', 'not a locale!'), '2026-09-24', 'a locale Intl cannot read');
  });
}
