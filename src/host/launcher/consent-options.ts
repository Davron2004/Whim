/**
 * consent-options — the live-store read a just-granted consent (or just-accepted terms) needs at
 * the INSTANT it acts (design D2; spec ai-data-consent "After the user agrees, the action they
 * started SHALL continue as if consent had already existed"). `LauncherRoot.tsx`'s `clientOptions`
 * is a React memo keyed on a `consentTick` state bump: it does not refresh until the render AFTER
 * `grantConsent`/`acceptTerms` runs, so a continuation invoked in the SAME call (Ask mode's "Agree
 * and continue", the terms step's `Accept`) would otherwise still read the pre-grant `null`. This
 * reads the same values fresh from `kv` instead of trusting the memo. RN-free: this must load
 * under the launcher's Node acceptance suite.
 */
import type { KVBackend } from '../version-store/fs/kv-fs';
import { consentStatus } from './ai-consent';
import type { AppInfo } from './app-info';
import { effectiveServerUrl } from './server-address';
import { termsStatus } from './terms-acceptance';
import { consentedClientOptions } from './transport-shared';
import type { ConsentedClientOptions } from './transport-shared';

/** The same gate the `clientOptions` memo composes (`termsStatus` + `consentStatus` +
 *  `effectiveServerUrl` + `deviceId` + the installed-app reader), read FRESH from `kv` every call —
 *  never cached — so a caller that just wrote an acceptance or a grant sees it immediately,
 *  without waiting for a re-render. */
export function liveClientOptions(kv: KVBackend, deviceId: string, appInfo: () => AppInfo): ConsentedClientOptions | null {
  return consentedClientOptions(termsStatus(kv), consentStatus(kv), effectiveServerUrl(kv), deviceId, appInfo);
}
