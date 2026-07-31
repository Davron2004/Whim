/**
 * evals/tiers/tier-a.ts — Tier A, the deterministic gate (design D4, spec "Tier A is
 * deterministic and trusts only authenticated vantages"). Combines the static leg
 * (`runStaticChecks` over the candidate source) with the runtime leg (the boot/mount outcome and
 * containment verdict already normalized into a `RunObservation` by
 * `evals/adapters/synthetic-run.ts`). A pure function of its two inputs — same source + same
 * observation always yields an equal result.
 */
import { runStaticChecks } from '../../checks';
import type { Diagnostic, RunObservation, TierAResult } from '../contract';

/**
 * Any `error`-severity diagnostic from either leg fails Tier A. A boot/mount failure fails Tier A
 * too — it always surfaces as an `error`-severity diagnostic on `observation.diagnostics` (e.g.
 * `mount_timeout`, `run_truncated`), so no separate check is needed for it here. A containment
 * verdict is trusted only when `observation.containment.authenticated` is `true`; an
 * un-authenticated verdict fails Tier A as an untrusted-verdict failure (never adopted as a pass)
 * — visible on the returned `containment` field, which is carried through verbatim.
 */
export function evaluateTierA(source: string, observation: RunObservation): TierAResult {
  const staticDiagnostics: readonly Diagnostic[] = runStaticChecks(source).diagnostics;
  const diagnostics = [...staticDiagnostics, ...observation.diagnostics];

  const hasErrorDiagnostic = diagnostics.some((diagnostic) => diagnostic.severity === 'error');
  const containmentTrusted = observation.containment.authenticated && observation.containment.contained;

  return {
    status: !hasErrorDiagnostic && containmentTrusted ? 'pass' : 'fail',
    diagnostics,
    containment: observation.containment,
  };
}
