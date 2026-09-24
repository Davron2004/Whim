/**
 * report-send — `ReportSheet`'s send-button state machine and log outcome, pulled out RN-free so
 * the draft/sending/thanks transitions and the disabled-send predicate are watchable under Node
 * (design D13/D14; spec `content-reporting`).
 *
 * `ReportSheet.tsx` owns the notice VALUE (`ReportNotice`, and the refusal → notice mapping) —
 * this module only sequences phases around whatever notice the caller already built, and decides
 * the log outcome class for a non-refusal failure.
 */
import type { ReportRequest } from '@whim/contract';
import { GenerationClientError } from './transport-shared';

export type ReportPhase = 'draft' | 'sending' | 'thanks';

export type SendOutcome<TNotice> =
  | { kind: 'sent' }
  | { kind: 'refused'; notice: TNotice }
  | { kind: 'failed'; notice: TNotice };

export interface SendSettlement<TNotice> {
  readonly phase: ReportPhase;
  readonly notice: TNotice | null;
}

/** What `handleSend`'s `try`/`catch` decides once the request settles (spec "A report that
 *  doesn't go through keeps the draft and says why"): success moves to `thanks` with no notice; a
 *  recognised refusal OR any other failure returns to `draft` — never stuck `sending` — so the
 *  SAME draft (reason, note, switches all untouched) is ready to resend right away, e.g. a
 *  `payload_too_large` refusal with the source switch turned off. */
export function settleSend<TNotice>(outcome: SendOutcome<TNotice>): SendSettlement<TNotice> {
  if (outcome.kind === 'sent') return { phase: 'thanks', notice: null };
  return { phase: 'draft', notice: outcome.notice };
}

/** Whether Send is disabled (design D14): no reason chosen yet (`request === null`, spec "The
 *  report sheet collects a reason"), a send already in flight, or the retry window from a
 *  recognised sender-side refusal still gates it. */
export function sendDisabled(request: ReportRequest | null, phase: ReportPhase, gated: boolean): boolean {
  return request === null || phase === 'sending' || gated;
}

/** The outcome class `reportLogFields` records for a failed send (spec "Report content never
 *  reaches device logs": "the outcome (status class or refusal code)"): the HTTP status the
 *  server actually answered with, when there is one — `'network'` is reserved for a genuine
 *  network-level failure (spec "Offline"), never a blanket label for a 400/500 the server DID
 *  answer with. A `device_id` error is also a real status the server answered with (the
 *  device-identity middleware's 400), so it is logged the same way as `http`, not folded into
 *  `'network'`. A report that could not even be built (`client`: the installed app's version was
 *  unreadable, request-envelope) never reached the network, so it is logged as `'client'`. */
export function sendFailureOutcome(err: unknown): string {
  if (err instanceof GenerationClientError && (err.kind === 'http' || err.kind === 'device_id') && err.status !== undefined) {
    return String(err.status);
  }
  if (err instanceof GenerationClientError && err.kind === 'client') {
    return 'client';
  }
  return 'network';
}
