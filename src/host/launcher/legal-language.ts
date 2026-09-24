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

/** The device's preferred locale: the platform's first-choice source, else its fallback. Which is
 *  which differs by platform (`device-locale.ts`); an empty answer counts as none. */
export function preferredLocale(first: string | undefined, fallback: string | undefined): string | undefined {
  if (first !== undefined && first.trim() !== '') return first;
  if (fallback !== undefined && fallback.trim() !== '') return fallback;
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

const DATE_FORMAT: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'short', day: 'numeric' };

/** The local day of `date` as `2026-09-24`: unambiguous in any language. */
function isoDay(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * A date on a legal surface (the consent grant's in Settings), written so no reader can mistake
 * the day for the month: `Sep 24, 2026` on an English phone, `24 sept. 2026` with the French legal
 * text (Canadian French, whatever the phone's region). Without `Intl`, or with a locale it can't
 * read, `2026-09-24`.
 */
export function legalDateLabel(iso: string, language: LegalLanguage, deviceLocale: string | undefined): string {
  const date = new Date(iso);
  if (typeof Intl === 'undefined' || typeof Intl.DateTimeFormat !== 'function') return isoDay(date);
  const locale = language === 'fr' ? 'fr-CA' : deviceLocale?.replaceAll('_', '-');
  try {
    return new Intl.DateTimeFormat(locale, DATE_FORMAT).format(date);
    // eslint-disable-next-line no-restricted-syntax -- intentional: a platform locale Intl rejects falls back to the unambiguous ISO day
  } catch {
    return isoDay(date);
  }
}
