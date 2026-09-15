/**
 * probe-gate Node suite (store-launch-compliance review fix M6a) — `probeGateFor`'s idle/probe
 * decision, per spec server-connectivity "No probe before consent" / "Granting consent starts the
 * probe" / "Revoking cancels the loop". The effect itself (starting/stopping the real
 * `ConnectivityLoop`) is exercised on-device / in `connectivity.suite.ts`; this locks only the
 * pure decision `LauncherRoot.tsx`'s effect is keyed on.
 */
import { Harness } from './harness';
import { probeGateFor } from '../probe-gate';

export async function runProbeGateTests(h: Harness): Promise<void> {
  await h.test('probeGateFor: no consented options means idle — no probe before consent', () => {
    h.eq(probeGateFor(null), { kind: 'idle' });
  });

  await h.test('probeGateFor: a current grant starts a probe against its baseUrl', () => {
    h.eq(probeGateFor({ baseUrl: 'https://gen.example' }), { kind: 'probe', baseUrl: 'https://gen.example' });
  });

  await h.test('probeGateFor: revoking (options going back to null) cancels the loop back to idle', () => {
    const granted = probeGateFor({ baseUrl: 'https://gen.example' });
    h.eq(granted.kind, 'probe', 'sanity: granted first');
    h.eq(probeGateFor(null), { kind: 'idle' }, 'revoked reads idle again, the same as never-granted');
  });
}
