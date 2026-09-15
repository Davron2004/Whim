/**
 * consent-options Node suite (store-launch-compliance review fix M1) — `liveClientOptions` reads
 * a just-granted consent WITHOUT waiting for a re-render, per spec ai-data-consent "After the user
 * agrees, the action they started SHALL continue as if consent had already existed".
 *
 * The regression this guards: `LauncherRoot.tsx`'s `clientOptions` React memo is keyed on a
 * `consentTick` state bump and does not retire until the render AFTER `grantConsent` runs — a
 * continuation invoked in the SAME call (Ask mode's "Agree and continue") must not see the
 * pre-grant `null`. `liveClientOptions` reads `consentStatus`/`effectiveServerUrl` fresh from `kv`
 * every call instead of trusting a memo, so it sees the grant the instant it is written.
 */
import { Harness } from './harness';
import { MapKVBackend } from '../../version-store';
import { grantConsent, revokeConsent } from '../ai-consent';
import { liveClientOptions } from '../consent-options';

const DEVICE_ID = 'device-1';

export async function runConsentOptionsTests(h: Harness): Promise<void> {
  await h.test('liveClientOptions: no grant yet reads null, same as the gated memo would', () => {
    const kv = new MapKVBackend();
    h.eq(liveClientOptions(kv, DEVICE_ID), null);
  });

  await h.test('liveClientOptions: a grant written the instant before is seen right away, with no re-render', () => {
    const kv = new MapKVBackend();
    grantConsent(kv, '2026-09-14T00:00:00.000Z');
    const options = liveClientOptions(kv, DEVICE_ID);
    h.ok(options != null, 'a continuation invoked in the SAME call as the grant gets non-null options');
    h.eq(options!.deviceId, DEVICE_ID);
  });

  await h.test('liveClientOptions: a revoke read fresh, too — null again the instant it is written', () => {
    const kv = new MapKVBackend();
    grantConsent(kv, '2026-09-14T00:00:00.000Z');
    h.ok(liveClientOptions(kv, DEVICE_ID) != null, 'granted first');
    revokeConsent(kv);
    h.eq(liveClientOptions(kv, DEVICE_ID), null, 'revoked reads null immediately');
  });
}
