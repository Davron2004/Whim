/**
 * crash-report — what "Ask Whim to fix it" attaches of a crashed app's error (`app-launcher` "A crashed
 * app keeps the orb and offers a way forward"; system.md §9 App crashed).
 *
 * Pure and RN-free, so the launcher's Node suites drive it directly.
 *
 * A crashed realm is still untrusted: the class name of what it threw is the realm's own string (a
 * bundle can name an error anything, of any length). The attachment is therefore plain text, made
 * from the failure's site (one of the host's own words) and the class name, the class kept to one
 * line with every control, format and separator character replaced and its length capped. No message
 * or stack is attached: the loader never lets them out of the realm (developer-observability D6), and
 * the attachment is sent with the change request.
 */

/** Where a launch failed after its delivery, in the host's own words. */
export type CrashSite = 'bundle' | 'mount' | 'deliver' | 'render' | 'paint-timeout' | 'webview-gone';

/** A launch's failure, as the crash screen hands it on. */
export interface AppCrash {
  readonly where: CrashSite;
  /** The error's class name: the realm's own string for `bundle`, `mount`, `render` and a `deliver`
   *  throw; the host's own for a startup deadline or a WebView that went. */
  readonly errorClass: string;
}

/** The most characters of the class name an attachment carries. */
export const CRASH_CLASS_MAX = 120;

/** Code point ranges never carried: C0 and C1 controls, the soft hyphen, Arabic letter mark, Mongolian
 *  vowel separator, zero-width and directional marks, line and paragraph separators, bidi embeddings,
 *  overrides and isolates, invisible operators, lone surrogates, the byte-order mark and interlinear
 *  annotation characters. */
const UNSAFE: readonly (readonly [number, number])[] = [
  [0x00, 0x1f], [0x7f, 0x9f], [0xad, 0xad], [0x61c, 0x61c], [0x180e, 0x180e], [0x200b, 0x200f], [0x2028, 0x202e],
  [0x2060, 0x206f], [0xd800, 0xdfff], [0xfeff, 0xfeff], [0xfff9, 0xfffb],
];

function unsafe(ch: string): boolean {
  const code = ch.codePointAt(0) ?? 0;
  return UNSAFE.some(([from, to]) => code >= from && code <= to);
}

/** `raw` as one line of plain text of at most `max` characters: the unsafe characters are spaces,
 *  runs of space are one, and a longer text is cut with an ellipsis, never inside a character. */
function oneLine(raw: string, max: number): string {
  const line = Array.from(raw, (ch) => (unsafe(ch) ? ' ' : ch)).join('').replace(/\s+/g, ' ').trim();
  const chars = Array.from(line);
  return chars.length <= max ? line : `${chars.slice(0, max - 1).join('').trimEnd()}…`;
}

/** The error a fix request carries: "Error: <class> (<site>)". */
export function crashAttachment(crash: AppCrash): string {
  return `Error: ${oneLine(crash.errorClass, CRASH_CLASS_MAX) || 'Error'} (${crash.where})`;
}
