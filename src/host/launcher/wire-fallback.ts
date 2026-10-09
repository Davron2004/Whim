/**
 * wire-fallback — what the prompt flow does with a message this build can't use (beta-1 design
 * D16, layer 3; `prompt-flow` spec "Messages the app can't use follow their fallback").
 *
 * The decoder (`wire-compat.ts`) turns such a message into a fallback, and the client throws the
 * two that end a flow as `GenerationClientError{kind:'fallback'}`. This module is the caller's
 * side: recognising one, and the notice as the screen shows it. `fail` ends on the failure screen
 * and `update` on the update screen, each with its notice as plain text; neither installs or
 * updates anything. RN-free, so the decisions are watchable under Node.
 */
import { GenerationClientError } from './transport-shared';
import { COMPAT_NOTICE_MAX_CHARS, type TerminalFallback } from './wire-compat';

/** The fallback a thrown error carries — `fail` or `update` — or `undefined` for every other error
 *  (a fallback is never a service refusal: it names no refusal code). */
export function terminalFallbackOf(err: unknown): TerminalFallback | undefined {
  return err instanceof GenerationClientError && err.kind === 'fallback' ? err.fallback : undefined;
}

/** The fallback's notice as a screen shows it: plain text, never longer than the contract allows
 *  (`COMPAT_NOTICE_MAX_CHARS`), or `undefined` when the message sent none. */
export function fallbackNotice(fallback: TerminalFallback): string | undefined {
  const notice = fallback.notice;
  return notice ? notice.slice(0, COMPAT_NOTICE_MAX_CHARS) : undefined;
}
