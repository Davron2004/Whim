/**
 * legal-language — which language the legal screens and links speak (legal-surface-v2 design D6;
 * spec legal-text-localization). Every legal surface asks `activeLegalLanguage()` and reads its
 * copy from `LEGAL_COPY[language]` and its links from `privacyPolicyUrl(language)`, so resolving
 * the language is this one function's job. English is the only language until the French table
 * lands.
 *
 * No React Native import — this module must load under the Node acceptance suite.
 */
import { RELEASE } from './release-config';

/** A language the legal text exists in. */
export type LegalLanguage = 'en';

/** The language the legal screens and links use right now. */
export function activeLegalLanguage(): LegalLanguage {
  return 'en';
}

const PRIVACY_POLICY_URLS: Readonly<Record<LegalLanguage, string>> = { en: RELEASE.privacyPolicyUrl };

/** The privacy policy page written in `language`. */
export function privacyPolicyUrl(language: LegalLanguage): string {
  return PRIVACY_POLICY_URLS[language];
}
