/**
 * error-reason Node suite (store-launch-compliance review fix M2) — `errorReason`'s taxonomy for
 * every `GenerationClientError` kind, per spec prompt-flow "No failure reason on this screen
 * SHALL ever be a transport message": only `http`/`device_id` may surface `err.hint` verbatim
 * (the server's own words); `network`/`stream_parse` are client-side transport strings and must
 * always scrub to the generic reason.
 */
import { Harness } from './harness';
import { errorReason, GENERIC_STREAM_ERROR } from '../error-reason';
import { GenerationClientError } from '../transport-shared';
import { EmptyBundleError } from '../build-lifecycle';

export async function runErrorReasonTests(h: Harness): Promise<void> {
  await h.test('errorReason: an http error surfaces the server’s own hint', () => {
    const err = new GenerationClientError('http', { status: 429, hint: 'Whim is busy right now.' });
    h.eq(errorReason(err), { reason: 'Whim is busy right now.', diagnostics: [] });
  });

  await h.test('errorReason: a device_id error surfaces its hint too', () => {
    const err = new GenerationClientError('device_id', { hint: 'This device could not be identified.' });
    h.eq(errorReason(err), { reason: 'This device could not be identified.', diagnostics: [] });
  });

  await h.test('errorReason: a network error never shows its transport hint', () => {
    const err = new GenerationClientError('network', { hint: 'fetch failed: ECONNRESET' });
    h.eq(errorReason(err), { reason: GENERIC_STREAM_ERROR, diagnostics: [] });
  });

  await h.test('errorReason: a stream_parse error never shows its transport hint', () => {
    const err = new GenerationClientError('stream_parse', { hint: 'Response has no body' });
    h.eq(errorReason(err), { reason: GENERIC_STREAM_ERROR, diagnostics: [] });
  });

  await h.test('errorReason: an http error with no hint still falls through to the generic reason', () => {
    const err = new GenerationClientError('http', { status: 500 });
    h.eq(errorReason(err), { reason: GENERIC_STREAM_ERROR, diagnostics: [] });
  });

  await h.test('errorReason: an empty-bundle delivery reads with its own honest reason', () => {
    const err = new EmptyBundleError();
    h.eq(errorReason(err), { reason: err.message, diagnostics: [] });
  });

  await h.test('errorReason: anything else falls through to the generic reason', () => {
    h.eq(errorReason(new Error('boom')), { reason: GENERIC_STREAM_ERROR, diagnostics: [] });
  });
}
