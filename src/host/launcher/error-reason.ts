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
import { GenerationClientError } from './transport-shared';
import { EmptyBundleError } from './build-lifecycle';

export const GENERIC_STREAM_ERROR = 'Something went wrong while building your app. Please try again.';

/** Maps a thrown error from the client calls down to the failure screen's honest
 *  `{reason, diagnostics}` shape — never the raw error kind/status, matching the "failure shown
 *  honestly" requirement's hint-only discipline (diagnostics stay empty here; only a terminal
 *  `failure` event ever carries real per-diagnostic hints). */
export function errorReason(err: unknown): { reason: string; diagnostics: readonly { hint: string }[] } {
  if (
    err instanceof GenerationClientError &&
    err.hint &&
    (err.kind === 'device_id' || (err.kind === 'http' && (err.status ?? 0) >= 400))
  ) {
    return { reason: err.hint, diagnostics: [] };
  }
  // The install-time bundle guard (build-lifecycle.ts's `deliverResult`): a delivery that defines
  // no app is a failed generation, not a crash, so it reads with its own honest reason rather than
  // the generic one.
  if (err instanceof EmptyBundleError) {
    return { reason: err.message, diagnostics: [] };
  }
  return { reason: GENERIC_STREAM_ERROR, diagnostics: [] };
}
