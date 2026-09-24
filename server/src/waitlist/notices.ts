/**
 * server/src/waitlist/notices.ts — which consent wording a waitlist signup agreed to (beta-waitlist
 * design D5; spec "Consent wording is recorded"). The signup page marks its consent line and its
 * opt-out label with `data-notice`. The site build reads their text, normalizes and hashes it, and
 * refuses to publish a page whose hash isn't the current notice's; the signup route stores the
 * current notice id with every row. So a stored `notice_id` always names wording that was published.
 *
 * The fingerprint is taken over the page SOURCE, placeholders unrendered, so a deploy value (the
 * support address inside the consent line) can never change it.
 *
 * Changing the wording: add a new id with the new fingerprint (the site build names both), and make
 * it `CURRENT_NOTICE_ID`. Never edit or remove an id: stored rows keep naming the wording they saw.
 *
 * Pure apart from `node:crypto`: the server and the site build both import it.
 */
import { createHash } from 'node:crypto';

/** Notice id → sha256 (hex) of its normalized text. APPEND-ONLY. */
export const NOTICES: Readonly<Record<string, string>> = Object.freeze({
  'beta-1': 'd6ff49dee231490c1f296fdc2200198956cc32e1d5f7905257795bc88957b63e',
});

/** The notice the published signup page carries, and every new signup records. */
export const CURRENT_NOTICE_ID = 'beta-1';

/** Whitespace runs collapse to one space, and the ends are trimmed. */
export function normalizeNoticeText(text: string): string {
  return text.replaceAll(/\s+/g, ' ').trim();
}

/** The sha256 (hex) of the normalized text. */
export function noticeFingerprint(text: string): string {
  return createHash('sha256').update(normalizeNoticeText(text), 'utf8').digest('hex');
}

/** The id registered for `fingerprint`, if any. */
export function noticeIdFor(fingerprint: string, notices: Readonly<Record<string, string>> = NOTICES): string | undefined {
  return Object.entries(notices).find(([, registered]) => registered === fingerprint)?.[0];
}
