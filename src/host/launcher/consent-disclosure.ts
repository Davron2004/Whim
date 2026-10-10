/**
 * consent-disclosure — the consent disclosure's body as data (spec ai-data-consent "The disclosure
 * names what is sent, what is never sent, and who receives it"), in the order the spec lists it, so
 * the review screen (`ConsentScreen.tsx`) and the first-run sheet's "Full details"
 * (`FirstRunSheet.tsx`) draw the same words from the same list and cannot drift apart.
 *
 * No React Native import — this module must load under the Node acceptance suite.
 */
import type { LegalCopyTable } from './copy';

/** One titled part of the disclosure: a bulleted list, or a paragraph. */
export interface DisclosureSection {
  readonly title: string;
  readonly bullets?: readonly string[];
  readonly body?: string;
}

/** The disclosure's sections, then its two closing paragraphs (the promise to ask first, and where
 *  AI features are turned off). */
export function disclosureOf(copy: LegalCopyTable): { readonly sections: readonly DisclosureSection[]; readonly closing: readonly string[] } {
  return {
    sections: [
      { title: copy.consentSentTitle, bullets: [copy.consentSentRequest, copy.consentSentEdit, copy.consentSentDevice, copy.consentSentErrors] },
      { title: copy.consentWhyTitle, body: copy.consentWhy },
      { title: copy.consentWhoTitle, body: `${copy.consentWho} ${copy.consentWhoPlatform} ${copy.consentWhoAuthorities}` },
      { title: copy.consentStaysTitle, body: copy.consentStays },
      { title: copy.consentNeverTitle, body: copy.consentNever },
    ],
    closing: [copy.consentAskFirst, copy.consentFootnote],
  };
}
