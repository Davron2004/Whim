/**
 * error-reason — the ONE mapping from a thrown clarify/rewrite/generate error to a failure
 * screen's honest `{reason, diagnostics}` shape (design D9; spec prompt-flow "No failure reason
 * on this screen SHALL ever be a transport message"). Pulled out of `LauncherRoot.tsx`, which
 * imports react-native and so cannot be exercised under the launcher's Node acceptance suite —
 * this decision needs to be watchable on its own.
 *
 * `GenerationClientError.hint` mixes two very different things depending on `kind`/`status`. For
 * `device_id`, and for `http` on an actual error status (>= 400), it is the SERVER's own
 * plain-English message (a 4xx/5xx body, or the device-id gate's own copy) — safe, and meant to
 * be read. But `http` is not exclusively server-authored: `generation-client.ts` also raises
 * `kind: 'http'` with a CLIENT-generated hint ("Unexpected clarify/rewrite response shape") when a
 * 200 response's body fails to structurally validate — that hint is a transport/shape complaint,
 * never a product sentence. For `network`/`stream_parse` it is always a client-side transport
 * string built from `err.message`, a WebView network error code, or the fixed `'Response has no
 * body'` — mechanism, never a product sentence. All of these are scrubbed to the generic reason
 * instead, never shown verbatim.
 */
import type { DiagnosticReason } from '../logging/diagnostic';
import { GenerationClientError } from './transport-shared';
import { EmptyBundleError } from './build-lifecycle';
import { fallbackNotice, terminalFallbackOf } from './wire-fallback';

export const GENERIC_STREAM_ERROR = 'Something went wrong while building your app. Please try again.';

/** The one decision both exports below read: which of the three failures a thrown error is, as
 *  the closed code the log records and the sentence the screen shows. */
function classify(err: unknown): { code: DiagnosticReason; reason: string } {
  // A message whose fallback ends the flow (beta-1 D16): its notice is plain text the server wrote
  // for this screen, capped as the contract caps it; without one, the generic reason.
  const fallback = terminalFallbackOf(err);
  if (fallback) {
    const notice = fallbackNotice(fallback);
    return notice ? { code: 'server_refused', reason: notice } : { code: 'unexpected_error', reason: GENERIC_STREAM_ERROR };
  }
  if (
    err instanceof GenerationClientError &&
    err.hint &&
    (err.kind === 'device_id' || (err.kind === 'http' && (err.status ?? 0) >= 400))
  ) {
    return { code: 'server_refused', reason: err.hint };
  }
  // The install-time bundle guard (build-lifecycle.ts's `deliverResult`): a delivery that defines
  // no app is a failed generation, not a crash, so it reads with its own honest reason rather than
  // the generic one.
  if (err instanceof EmptyBundleError) {
    return { code: 'empty_bundle', reason: err.message };
  }
  return { code: 'unexpected_error', reason: GENERIC_STREAM_ERROR };
}

/** Maps a thrown error from the client calls down to the failure screen's honest
 *  `{reason, diagnostics}` shape — never the raw error kind/status, matching the "failure shown
 *  honestly" requirement's hint-only discipline (diagnostics stay empty here; only a terminal
 *  `failure` event ever carries real per-diagnostic hints). */
export function errorReason(err: unknown): { reason: string; diagnostics: readonly { hint: string }[] } {
  return { reason: classify(err).reason, diagnostics: [] };
}

/** The closed code a failure record carries for the screen `errorReason` builds — never its
 *  sentence, which may be the server's own text. */
export function errorReasonCode(err: unknown): DiagnosticReason {
  return classify(err).code;
}
