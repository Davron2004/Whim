/**
 * probe-gate Node suite (store-launch-compliance review fix M6a) — `probeGateFor`'s idle/probe
 * decision, per spec server-connectivity "No probe before consent" / "Granting consent starts the
 * probe" / "Revoking cancels the loop". The effect itself (starting/stopping the real
 * `ConnectivityLoop`) is exercised on-device / in `connectivity.suite.ts`; this locks only the
 * pure decision `LauncherRoot.tsx`'s effect is keyed on.
 */
import { Harness } from './harness';
import { probeGateFor } from '../probe-gate';
import { consentedClientOptions } from '../transport-shared';
import type { ConsentStatus } from '../ai-consent';

const GRANTED: ConsentStatus = { kind: 'granted', grantedAt: '2026-09-14T00:00:00.000Z' };

/** A real `ConsentedClientOptions` — built the one sanctioned way, through the gate itself, so
 *  this suite cannot structurally forge one the way a plain `{baseUrl}` object literal used to. */
function consented(baseUrl: string) {
  const options = consentedClientOptions(GRANTED, baseUrl, 'device-1');
  if (options === null) throw new Error('sanity: a granted status must yield options');
  return options;
}

export async function runProbeGateTests(h: Harness): Promise<void> {
  await h.test('probeGateFor: no consented options means idle — no probe before consent', () => {
    h.eq(probeGateFor(null), { kind: 'idle' }, 'no options at all means idle');
  });

  await h.test('probeGateFor: a current grant starts a probe against its baseUrl', () => {
    h.eq(
      probeGateFor(consented('https://gen.example')),
      { kind: 'probe', baseUrl: 'https://gen.example' },
      'a consented grant starts a probe against its own baseUrl',
    );
  });

  await h.test('probeGateFor: revoking (options going back to null) cancels the loop back to idle', () => {
    const granted = probeGateFor(consented('https://gen.example'));
    h.eq(granted.kind, 'probe', 'sanity: granted first');
    h.eq(probeGateFor(null), { kind: 'idle' }, 'revoked reads idle again, the same as never-granted');
  });

  // N4: `probeGateFor` takes `ConsentedClientOptions`, not a structural `{baseUrl, deviceId}` — a
  // plain object literal can never satisfy it because `CONSENTED` is an unexported unique symbol
  // this module cannot spell. `tsconfig.json` excludes `src/host/launcher/test` from `tsc`
  // (`probe-gate.ts` itself stays type-checked), so this `@ts-expect-error` is never enforced by
  // the gate — it documents the guarantee for a reader, and was verified out-of-band by pointing
  // `tsc --noEmit` directly at a scratch file with this exact call: TS2345 "Property '[CONSENTED]'
  // is missing in type '{ baseUrl: string; deviceId: string; }'", i.e. even a FULL structural
  // match without the brand is still rejected.
  await h.test('probeGateFor: a non-consented {baseUrl, deviceId} literal cannot be passed (type-level)', () => {
    // @ts-expect-error a structural match is not a ConsentedClientOptions — the CONSENTED brand is required
    probeGateFor({ baseUrl: 'https://gen.example', deviceId: 'device-1' });
    h.ok(true, 'compile-time only: see the @ts-expect-error above (verified out-of-band via tsc, not the gate)');
  });
}
