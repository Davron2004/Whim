/**
 * server/src/bench-envelope.ts — the client envelope the server's own traffic generators send
 * (`flowbench/drive.ts`, `loadtest/drive.ts`), so their requests read like the app's in the request
 * log: a complete envelope for the newest build a release lane could stamp right now, never the
 * legacy default. Deliberately free of the logger and of Hono values, because both drivers are
 * bundled into standalone CLIs.
 */
import { APP_VERSION_HEADER, BUILD_HEADER, CONSENT_HEADER, PLATFORM_HEADER } from '@whim/contract';
import { buildNumberAt } from '../../scripts/release/lib/build-number';
import { highestConsentVersion } from './consent-practices';

/** The installed marketing version the drivers claim: `release/whim-release.xcconfig`'s
 *  `WHIM_MARKETING_VERSION`, which the server suite holds this equal to. */
export const BENCH_APP_VERSION = '1.0.0';

/** The four envelope headers for a driver request sent at `now`. */
export function benchEnvelopeHeaders(now: Date = new Date()): Record<string, string> {
  return {
    [PLATFORM_HEADER]: 'android',
    [APP_VERSION_HEADER]: BENCH_APP_VERSION,
    [BUILD_HEADER]: String(buildNumberAt(now)),
    [CONSENT_HEADER]: String(highestConsentVersion()),
  };
}
