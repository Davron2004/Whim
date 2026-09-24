/**
 * device-locale — the phone's preferred locale, for the legal language (legal-surface-v2 design
 * D6): `Intl`'s default under Hermes, with the platform's locale constant as the fallback. Android's
 * constant is `I18nManager`'s `localeIdentifier` (the first configured locale, e.g. `fr_CA`); iOS's
 * I18nManager has none, so it is the first of the user's `AppleLanguages` (e.g. `fr-CA`).
 */
import { I18nManager, Platform, Settings } from 'react-native';
import { intlLocale, preferredLocale } from './legal-language';

function platformLocale(): string | undefined {
  if (Platform.OS === 'ios') {
    const languages: unknown = Settings.get('AppleLanguages');
    const first: unknown = Array.isArray(languages) ? languages[0] : undefined;
    return typeof first === 'string' ? first : undefined;
  }
  return I18nManager.getConstants().localeIdentifier ?? undefined;
}

/** The phone's preferred locale identifier, or `undefined` when neither source has one. */
export function deviceLocale(): string | undefined {
  return preferredLocale(intlLocale(), platformLocale());
}
