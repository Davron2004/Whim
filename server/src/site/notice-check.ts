/**
 * server/src/site/notice-check.ts — the signup page's consent-wording check (beta-waitlist design
 * D5; spec "Consent wording is recorded"). The site build refuses to publish `/beta` unless the
 * text of its `data-notice` elements hashes to the notice id the server records with each signup.
 *
 * Pure: the caller reads the page source. The text is read with placeholders unrendered.
 */
import { CURRENT_NOTICE_ID, NOTICES, noticeFingerprint, noticeIdFor, normalizeNoticeText } from '../waitlist/notices';
import { pageText } from './legal-pages';

/** The page whose `data-notice` wording the server records. */
export const SIGNUP_PAGE = 'beta.html';

/** The reading text of every element carrying a `data-notice` attribute, in document order. An
 *  element's text runs to the first closing tag of its own name, so it must not nest its own tag. */
export function noticeTexts(html: string): string[] {
  const texts: string[] = [];
  for (let open = html.indexOf('<'); open !== -1; open = html.indexOf('<', open + 1)) {
    const close = html.indexOf('>', open);
    if (close === -1) break;
    const tag = html.slice(open, close + 1);
    const name = /^<([a-z][a-z0-9-]*)/i.exec(tag)?.[1];
    if (name === undefined || !/\sdata-notice(?=[\s=/>])/.test(tag)) continue;
    const end = html.toLowerCase().indexOf(`</${name.toLowerCase()}>`, close);
    texts.push(pageText(html.slice(close + 1, end === -1 ? undefined : end)));
  }
  return texts;
}

/** Why the signup page may not be published; empty when its wording is the current notice's. */
export function signupNoticeFindings(
  html: string,
  notices: Readonly<Record<string, string>> = NOTICES,
  currentId: string = CURRENT_NOTICE_ID,
): string[] {
  const texts = noticeTexts(html);
  if (texts.length === 0) return [`${SIGNUP_PAGE}: no element carries data-notice, so a signup can't record what it agreed to.`];
  const wording = normalizeNoticeText(texts.join(' '));
  const fingerprint = noticeFingerprint(wording);
  const id = noticeIdFor(fingerprint, notices);
  if (id === undefined) {
    return [
      `${SIGNUP_PAGE}: the data-notice wording is not registered (sha256 ${fingerprint}): ${JSON.stringify(wording)}. Register it as a new id in server/src/waitlist/notices.ts and make that id CURRENT_NOTICE_ID.`,
    ];
  }
  if (id !== currentId) {
    return [`${SIGNUP_PAGE}: the data-notice wording is notice ${id}, but signups record ${currentId}: restore ${currentId}'s wording, or make ${id} CURRENT_NOTICE_ID.`];
  }
  return [];
}
