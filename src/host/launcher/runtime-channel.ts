/**
 * runtime-channel — the RN side of `runtime-message-auth`: a `RuntimeChannel` over the `WhimRandom`
 * module for each runtime-page WebView (the pool's slots, the dev probe's, the network-deny probe's),
 * with its failures on the error channel and its exposure records through `onExposure`.
 */
import { useSyncExternalStore } from 'react';
import NativeWhimRandom from '../../native/NativeWhimRandom';
import { log } from '../logging';
import { CHANNELS } from '../logging/channels';
import { BRIDGE_EXPOSURE_MESSAGE, bridgeExposureDiagnostic } from '../logging/diagnostic';
import { exposureCode, RuntimeChannel, type ExposureRecord, type RuntimeChannelSnapshot } from './runtime-message-auth';

/** Which WebView a channel serves, for the log. */
export type RuntimeSurface = 'pool' | 'dev-probe' | 'netdeny-probe';

/**
 * Every runtime WebView's exposure record lands here, once per page load (and again if a late canary
 * changes it): the one place the result leaves the channel. It is logged on the host's log, and
 * queued for upload under the error-details consent (`device-diagnostics`), which the diagnostics
 * transport's gate decides; a result whose engine the page could not name is not uploaded.
 */
export function onExposure(record: ExposureRecord, surface: RuntimeSurface): void {
  const exposure = exposureCode(record);
  log.info(CHANNELS.app, BRIDGE_EXPOSURE_MESSAGE, {
    exposure,
    webview: record.webview ?? 'unknown',
    canaryReachedNative: record.canaryReachedNative,
    surface,
  });
  const upload = bridgeExposureDiagnostic(Date.now(), exposure, record.webview);
  if (upload !== null) log.diagnostics.enqueueDiagnostic(upload);
}

/** A channel for one runtime-page WebView. Without a secure random source no token is minted, the
 *  WebView's messages are all dropped, and the failure is logged at `error`. */
export function createRuntimeChannel(surface: RuntimeSurface): RuntimeChannel {
  return new RuntimeChannel(NativeWhimRandom, {
    noToken: () => log.error(CHANNELS.app, 'no secure random source: the WebView gets no bridge token', { where: 'bridge-token', errorClass: 'NoSecureRandom', surface }),
    exposure: (record) => onExposure(record, surface),
  });
}

/** `channel`'s drops, canary and exposure record, re-rendering as they change. */
export function useRuntimeChannel(channel: RuntimeChannel): RuntimeChannelSnapshot {
  return useSyncExternalStore(
    (listener) => channel.subscribe(listener),
    () => channel.snapshot(),
  );
}
