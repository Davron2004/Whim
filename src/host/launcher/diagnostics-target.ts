/**
 * diagnostics-target — the upload gate the diagnostics transport asks before every decision
 * (developer-observability D3; spec device-diagnostics "Uploads require a current AI-data consent
 * grant").
 *
 * An upload is allowed only when the "Send error details" switch is on AND the same gate every AI
 * request goes through (`liveClientOptions`: a current terms acceptance and a current consent
 * grant) yields options. Everything is read fresh from `kv` at each call — nothing is cached — so
 * a switch flipped or a grant revoked in Settings applies to the very next record. The server
 * address comes from `effectiveServerUrl` (through that gate), and the headers are the shared
 * `/v1` headers, so an upload carries the current envelope and consent version.
 *
 * No React Native import: the launcher's Node suite drives this over a `MapKVBackend`.
 */

import type { KVBackend } from '../version-store/fs/kv-fs';
import { DIAGNOSTICS_PATH } from '../logging/diagnostics';
import type { DiagnosticsTarget } from '../logging/diagnostics';
import type { AppInfo } from './app-info';
import { liveClientOptions } from './consent-options';
import { getDeviceId } from './device-id';
import { errorDetailsEnabled } from './error-details';
import { requestHeaders } from './transport-shared';

export function diagnosticsTarget(
  kv: KVBackend,
  appInfo: () => AppInfo,
  internalBuild: boolean,
): () => DiagnosticsTarget | null {
  return () => {
    if (!errorDetailsEnabled(kv)) return null;
    const options = liveClientOptions(kv, getDeviceId(kv), appInfo, internalBuild);
    if (options === null) return null;
    // Read the installed app's info here rather than inside `requestHeaders`: a read that fails
    // there is logged as an error record, which would come straight back into this gate.
    let app: AppInfo;
    try {
      app = appInfo();
      // eslint-disable-next-line no-restricted-syntax -- intentional: without the installed app's info there is no envelope to send, so no upload; logging it here would feed the upload it gates.
    } catch {
      return null;
    }
    return { baseUrl: options.baseUrl, headers: requestHeaders({ ...options, appInfo: () => app }, DIAGNOSTICS_PATH) };
  };
}
