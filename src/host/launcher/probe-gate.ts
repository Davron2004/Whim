/**
 * probe-gate — the connectivity probe loop's start/idle decision, keyed ONLY on whether there is
 * a current, consented `{baseUrl}` to probe (design D2; spec server-connectivity "No probe
 * before consent" / "Granting consent starts the probe" / "Revoking cancels the loop"). Pulled
 * out of `LauncherRoot.tsx`'s `useEffect` (keyed on `clientOptions`) so the decision is watchable
 * without mounting the component — the effect itself still owns starting/stopping the real
 * `ConnectivityLoop` and is exercised by `connectivity.suite.ts`/`connectivity-ux.suite.ts`. RN-
 * free: this must load under the launcher's Node acceptance suite.
 */
import type { ConsentedClientOptions } from './transport-shared';

export type ProbeGateDecision = { readonly kind: 'idle' } | { readonly kind: 'probe'; readonly baseUrl: string };

/** `options == null` means no current AI-data consent grant (absent or outdated) — nothing to
 *  probe, and the caller resets connectivity to `'unknown'`. A non-null value means a loop should
 *  be running against exactly that `baseUrl` — granting consent (which makes `options` non-null)
 *  starts one, revoking it (which makes `options` null again) idles it, through the SAME
 *  dependency-keyed effect either way. */
export function probeGateFor(options: ConsentedClientOptions | null): ProbeGateDecision {
  return options == null ? { kind: 'idle' } : { kind: 'probe', baseUrl: options.baseUrl };
}
