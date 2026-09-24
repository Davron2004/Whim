/** Request-envelope fixtures for the launcher suites, taken from the real producers: the installed
 *  app's info as `appInfoFrom` turns native constants into it, and consented options from the real
 *  gate over a real terms acceptance and a real grant. */
import { MapKVBackend } from '../../version-store';
import { appInfoFrom, type AppInfo } from '../app-info';
import { consentStatus, grantConsent } from '../ai-consent';
import { acceptTerms, termsStatus } from '../terms-acceptance';
import { consentedClientOptions, type ConsentedClientOptions } from '../transport-shared';

/** An installed iOS build, as its native module reports it. */
export const TEST_APP_INFO: AppInfo = appInfoFrom('ios', { version: '1.4.0', build: '381500' });

/** The installed-app reader a suite hands the client or the shell. */
export const testAppInfo = (): AppInfo => TEST_APP_INFO;

/** Options from `consentedClientOptions` over an acceptance and a grant just written to a fresh
 *  store. */
export function grantedOptions(baseUrl: string, deviceId: string): ConsentedClientOptions {
  const kv = new MapKVBackend();
  acceptTerms(kv, '2026-09-14T00:00:00.000Z');
  grantConsent(kv, '2026-09-14T00:00:00.000Z');
  const options = consentedClientOptions(termsStatus(kv), consentStatus(kv), baseUrl, deviceId, testAppInfo);
  if (options === null) throw new Error('a fresh grant yields no options');
  return options;
}
