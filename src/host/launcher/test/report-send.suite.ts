/**
 * report-send Node suite (store-launch-compliance review fix M6c) — `ReportSheet`'s send-button
 * state machine and disabled predicate, pulled out RN-free (design D13/D14; spec
 * `content-reporting`): a reason is required before Send is enabled, a send in flight disables it,
 * the thanks state follows a successful send, and a `payload_too_large` refusal returns to a
 * resendable draft rather than getting stuck `sending`.
 */
import { Harness } from './harness';
import { sendDisabled, sendFailureOutcome, settleSend } from '../report-send';
import type { ReportRequest } from '@whim/contract';
import { GenerationClientError } from '../transport-shared';

const REQUEST: ReportRequest = { reason: 'broken' };

interface TestNotice {
  readonly hint: string;
}

export async function runReportSendTests(h: Harness): Promise<void> {
  await h.test('sendDisabled: no reason chosen yet (request null) disables Send', () => {
    h.eq(sendDisabled(null, 'draft', false), true);
  });

  await h.test('sendDisabled: a reason with nothing else gating it enables Send', () => {
    h.eq(sendDisabled(REQUEST, 'draft', false), false);
  });

  await h.test('sendDisabled: a send already in flight disables Send', () => {
    h.eq(sendDisabled(REQUEST, 'sending', false), true);
  });

  await h.test('sendDisabled: a live retry-window gate disables Send even with a reason chosen', () => {
    h.eq(sendDisabled(REQUEST, 'draft', true), true);
  });

  await h.test('settleSend: a successful send moves to thanks with no notice', () => {
    h.eq(settleSend<TestNotice>({ kind: 'sent' }), { phase: 'thanks', notice: null });
  });

  await h.test('settleSend: a payload_too_large refusal returns to draft, carrying the notice — resendable right away', () => {
    const notice: TestNotice = { hint: 'That report is too large to send.' };
    const settled = settleSend<TestNotice>({ kind: 'refused', notice });
    h.eq(settled.phase, 'draft', 'never stuck sending');
    h.eq(settled.notice, notice);
    h.eq(sendDisabled(REQUEST, settled.phase, false), false, 'the same draft is ready to resend immediately');
  });

  await h.test('settleSend: an unrecognised failure also returns to a resendable draft', () => {
    const notice: TestNotice = { hint: 'Something went wrong. Please try again.' };
    const settled = settleSend<TestNotice>({ kind: 'failed', notice });
    h.eq(settled.phase, 'draft');
    h.eq(settled.notice, notice);
  });

  await h.test('sendFailureOutcome: an HTTP status the server answered with is logged verbatim, never as network', () => {
    const err = new GenerationClientError('http', { status: 413 });
    h.eq(sendFailureOutcome(err), '413');
  });

  await h.test('sendFailureOutcome: a genuine transport failure logs as network', () => {
    h.eq(sendFailureOutcome(new GenerationClientError('network', { hint: 'fetch failed' })), 'network');
    h.eq(sendFailureOutcome(new Error('boom')), 'network');
  });
}
