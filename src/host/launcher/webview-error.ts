/**
 * The one way a host WebView's `onError` becomes a log record (obs-v1).
 *
 * Free of `react-native` on purpose, exactly like `dev-log-view.ts`: the field mapping is the part
 * that can be wrong, so it lives where the launcher's Node acceptance suite can call it for real.
 * `MiniAppView` and `DevProbeScreen` stay thin `onError={…}` one-liners over this.
 *
 * The native `code` is carried as `errorCode`: `code` is in the seam's sensitive-field set (it is
 * a generated-source carrier there), so emitting it under that name would redact the single most
 * diagnostic field of the record. The set is not the thing that is wrong — the name was.
 */

import type { Seam } from '../logging';
import { CHANNELS } from '../logging/channels';

/** The subset of `react-native-webview`'s error payload worth recording. Structurally satisfied by
 *  its `WebViewError`, so a call site can pass `ev.nativeEvent` straight through. */
export interface WebViewErrorPayload {
  readonly code?: number | string;
  readonly description?: string;
  readonly domain?: string;
  readonly url?: string;
}

/** The constant message; everything variable is a named field. */
export const WEBVIEW_ERROR_MESSAGE = 'webview failed to load';

/**
 * Record a WebView load failure on the container channel. `context` carries the caller's own named
 * fields (which app, which surface) and is merged under the payload's, never interpolated.
 */
export function logWebViewError(
  seam: Seam,
  native: WebViewErrorPayload,
  context: Readonly<Record<string, unknown>> = {},
): void {
  seam.error(CHANNELS.app, WEBVIEW_ERROR_MESSAGE, {
    ...context,
    errorCode: native.code,
    detail: native.description,
    domain: native.domain,
    url: native.url,
  });
}
