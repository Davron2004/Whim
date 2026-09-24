/**
 * Entry-point wiring for error diagnostics (developer-observability D3/D4/D5). The only module in
 * this set that imports React Native: it hands the RN globals and native seams to the RN-free
 * pieces, which the Node suites test directly.
 *
 *   - points the seam's diagnostics transport at its upload gate (`diagnostics-target.ts`) and
 *     flushes it when the app moves to the background;
 *   - installs the global error handler and the Hermes rejection hook (`crash-capture.ts`), keeping
 *     a fatal error's projection in the `whim.launcher` store (`fatal-slot.ts`);
 *   - sends a record kept by the previous launch, then deletes it.
 *
 * `index.js` imports this right after the entry polyfills, before the app's own modules, so an
 * error thrown while the app is loading is already captured.
 */

import { AppState, Platform } from 'react-native';
import { log } from '../logging';
import { CHANNELS } from '../logging/channels';
import { installCrashCapture } from '../logging/crash-capture';
import type { RejectionTracking, RejectionTrackerHost } from '../logging/crash-capture';
import { keepFatalRecord, sendFatalRecord } from '../logging/fatal-slot';
import { diagnosticsTarget } from '../launcher/diagnostics-target';
import { installedAppInfo, installedInternalBuild } from '../launcher/installed-app-info';
import { createMmkvBackend } from '../version-store/fs/mmkv-backend';

const kv = createMmkvBackend('whim.launcher');

log.diagnostics.configure({
  target: diagnosticsTarget(kv, installedAppInfo, installedInternalBuild()),
  osVersion: String(Platform.Version),
});

/** React Native installs its own rejection tracking only in a dev build (its yellow-box warning);
 *  the hook below replaces it there, so it defers to it. A release build has none. */
function devRejectionTracking(): Partial<RejectionTracking> | undefined {
  // eslint-disable-next-line @react-native/no-deep-imports -- React Native exports its dev rejection tracking options from no public entry point, and Hermes keeps one tracker, so deferring to it means naming the module that holds it.
  return __DEV__ ? require('react-native/Libraries/promiseRejectionTrackingOptions').default : undefined;
}

installCrashCapture({
  errorUtils: ErrorUtils,
  hermes: typeof HermesInternal === 'undefined' ? undefined : (HermesInternal as RejectionTrackerHost | null),
  previousRejectionTracking: devRejectionTracking(),
  seam: log,
  keepFatal: record => keepFatalRecord(kv, log.diagnostics, record),
});

AppState.addEventListener('change', state => {
  if (state === 'background') {
    log.diagnostics.flush().catch(() => undefined);
  }
});

sendFatalRecord(kv, log.diagnostics).catch((err: unknown) => {
  log.warn(CHANNELS.sink, 'fatal-error slot could not be cleared', { errorClass: err instanceof Error ? err.name : typeof err });
});
