/**
 * legal-language — which language the legal screens and links speak (legal-surface-v2 design D6;
 * spec legal-text-localization). The launcher resolves the active legal language once with
 * `activeLegalLanguage` and hands it to every legal surface, which reads its copy from
 * `LEGAL_COPY[language]` and its links from `privacyPolicyUrl(language)` / `termsUrl(language)`.
 *
 * A choice the user made (the terms step's or consent screen's language switch) wins, persisted
 * under `whim.legal-language:v1` in the shared `whim.launcher` KVBackend. Without one, a phone
 * whose preferred language is French, in any region, gets French; every other phone gets English.
 *
 * No React Native import — this module must load under the Node acceptance suite. The platform's
 * locale constant is read by `device-locale.ts` and passed in.
 */
import type { KVBackend } from '../version-store/fs/kv-fs';
import { RELEASE } from './release-config';

/** A language the legal text exists in. */
export type LegalLanguage = 'en' | 'fr';

const LEGAL_LANGUAGE_KEY = 'whim.legal-language:v1';

function isLegalLanguage(value: unknown): value is LegalLanguage {
  return value === 'en' || value === 'fr';
}

/** The locale `Intl` resolves by default — under Hermes, the device's — or `undefined` when this
 *  runtime has no `Intl`. */
export function intlLocale(): string | undefined {
  if (typeof Intl === 'undefined' || typeof Intl.DateTimeFormat !== 'function') return undefined;
  return Intl.DateTimeFormat().resolvedOptions().locale;
}

/** The device's preferred locale: `Intl`'s answer, else the platform's locale constant. */
export function preferredLocale(intl: string | undefined, platform: string | undefined): string | undefined {
  if (intl !== undefined && intl.trim() !== '') return intl;
  if (platform !== undefined && platform.trim() !== '') return platform;
  return undefined;
}

/** The language a locale identifier asks for: French for any `fr` language subtag (`fr-CA`,
 *  `fr_FR`, `fr`), English for anything else or nothing. */
function localeLanguage(locale: string | undefined): LegalLanguage {
  const language = (locale ?? '').split(/[-_]/)[0].toLowerCase();
  return language === 'fr' ? 'fr' : 'en';
}

/** The language the legal screens and links use: the stored choice when there is a readable one,
 *  else the language of `deviceLocale` (`preferredLocale`'s answer). */
export function activeLegalLanguage(kv: KVBackend, deviceLocale: string | undefined): LegalLanguage {
  const stored = kv.getString(LEGAL_LANGUAGE_KEY);
  if (isLegalLanguage(stored)) return stored;
  return localeLanguage(deviceLocale);
}

/** Persist the user's choice of legal language; it wins over the device's language from now on. */
export function chooseLegalLanguage(kv: KVBackend, language: LegalLanguage): void {
  kv.set(LEGAL_LANGUAGE_KEY, language);
}

/** The language the one-tap switch on a legal screen offers: the other one. */
export function otherLegalLanguage(language: LegalLanguage): LegalLanguage {
  return language === 'fr' ? 'en' : 'fr';
}

const PRIVACY_POLICY_URLS: Readonly<Record<LegalLanguage, string>> = {
  en: RELEASE.privacyPolicyUrl,
  fr: RELEASE.privacyPolicyUrlFr,
};

/** The privacy policy page written in `language`. */
export function privacyPolicyUrl(language: LegalLanguage): string {
  return PRIVACY_POLICY_URLS[language];
}

const TERMS_URLS: Readonly<Record<LegalLanguage, string>> = { en: RELEASE.termsUrl, fr: RELEASE.termsUrlFr };

/** The terms of use page written in `language`. */
export function termsUrl(language: LegalLanguage): string {
  return TERMS_URLS[language];
}
