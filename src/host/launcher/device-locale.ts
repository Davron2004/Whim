/**
 * device-locale — the phone's preferred locale, for the legal language (legal-surface-v2 design
 * D6). On iOS it is the first of the user's `AppleLanguages` (e.g. `fr-CA`), with `Intl`'s default
 * as the fallback: Hermes's `Intl` there follows the languages the app declares (only English), so
 * a French iPhone can resolve `en-CA`. On Android it is `Intl`'s default, with `I18nManager`'s
 * `localeIdentifier` (the first configured locale, e.g. `fr_CA`) as the fallback.
 */
import { I18nManager, Platform, Settings } from 'react-native';
import { intlLocale, preferredLocale } from './legal-language';

/** The first of the iOS user's preferred languages, independent of the app's localizations. */
function appleLanguage(): string | undefined {
  const languages: unknown = Settings.get('AppleLanguages');
  const first: unknown = Array.isArray(languages) ? languages[0] : undefined;
  return typeof first === 'string' ? first : undefined;
}

/** The phone's preferred locale identifier, or `undefined` when neither source has one. */
export function deviceLocale(): string | undefined {
  if (Platform.OS === 'ios') return preferredLocale(appleLanguage(), intlLocale());
  return preferredLocale(intlLocale(), I18nManager.getConstants().localeIdentifier ?? undefined);
}
