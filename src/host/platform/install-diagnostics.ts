/**
 * Entry-point wiring for error diagnostics (developer-observability D3/D4/D5). The only module in
 * this set that imports React Native: it hands the RN globals and native seams to the RN-free
 * pieces, which the Node suites test directly.
 *
 *   - points the seam's diagnostics transport at its upload gate (`diagnostics-target.ts`) and
 *     flushes it when the app moves to the background;
 *   - installs the global error handler and the Hermes rejection hook (`crash-capture.ts`), keeping
 *     a fatal error's projection in the `whim.launcher` store (`fatal-slot.ts`);
 *   - sends a record kept by the previous launch, then deletes it;
 *   - exports `recordRenderCrash`, what `App.tsx`'s root error boundary records a render error with
 *     before rethrowing it (`logging/crash-capture.ts#renderCrashRecorder`).
 *
 * `index.js` imports this right after the entry polyfills, before the app's own modules, so an
 * error thrown while the app is loading is already captured.
 */

import { AppState, Platform } from 'react-native';
import { log } from '../logging';
import { CHANNELS } from '../logging/channels';
import { devRejectionTracking, installCrashCapture, renderCrashRecorder } from '../logging/crash-capture';
import type { RejectionTrackerHost } from '../logging/crash-capture';
import type { DiagnosticRecord } from '@whim/contract';
import { keepFatalRecord, sendFatalRecord } from '../logging/fatal-slot';
import { diagnosticsTarget } from '../launcher/diagnostics-target';
import { installedAppInfo } from '../launcher/installed-app-info';
import { createMmkvBackend } from '../version-store/fs/mmkv-backend';

const kv = createMmkvBackend('whim.launcher');

log.diagnostics.configure({
  target: diagnosticsTarget(kv, installedAppInfo),
  osVersion: String(Platform.Version),
});

const keepFatal = (record: DiagnosticRecord): void => keepFatalRecord(kv, log.diagnostics, record);

installCrashCapture({
  errorUtils: ErrorUtils,
  hermes: typeof HermesInternal === 'undefined' ? undefined : (HermesInternal as RejectionTrackerHost | null),
  // Hermes keeps one tracker and this hook replaces React Native's dev one, so the dev build's
  // rejection warnings come from our own tracker.
  previousRejectionTracking: devRejectionTracking(__DEV__, console),
  seam: log,
  keepFatal,
});

/** The root error boundary's recorder: an error record and the fatal slot, like a fatal error. */
export const recordRenderCrash = renderCrashRecorder({ seam: log, keepFatal });

AppState.addEventListener('change', state => {
  if (state === 'background') {
    log.diagnostics.flush().catch(() => undefined);
  }
});

sendFatalRecord(kv, log.diagnostics).catch((err: unknown) => {
  log.warn(CHANNELS.sink, 'fatal-error slot could not be cleared', { errorClass: err instanceof Error ? err.name : typeof err });
});
