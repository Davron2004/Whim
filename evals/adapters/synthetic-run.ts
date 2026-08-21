/**
 * evals/adapters/synthetic-run.ts — the ONLY module under `evals/` permitted to import the
 * synthetic-run harness (design D6, `handoff/eval-contract.md`, `handoff/run-observation.md`).
 * Normalizes its `RunReport` (`synthrun/contract.ts`, `synthrun/report.ts`'s `createRunCandidate`)
 * into the one shape every tier evaluator reads — `RunObservation` (`evals/contract.ts`) — so a
 * harness field-name change touches exactly this file, never a tier.
 *
 * `SynthRunSession`/`createRunCandidate` are re-exported (opaque passthrough, never inspected
 * here) so `evals/cli.mjs`'s embedded facade — which only launches/closes a session and drives a
 * run, never reads a `RunReport` field directly — can reach them without importing `../synthrun`
 * itself (`fix/redaction-tier-results`, restoring the "ONLY module" invariant this docstring
 * asserts).
 */
import { SynthRunSession, createRunCandidate } from '../../synthrun';
import type { RunReport } from '../../synthrun/contract';
import type { ContainmentVerdict, Diagnostic, RunObservation } from '../contract';

export { SynthRunSession, createRunCandidate };

/**
 * `report.contained` is three-valued (`handoff/run-report-contract.md`): `true`/`false` come from
 * a nonce-authenticated `probes` frame, `null` means no authenticated verdict was ever observed.
 * `toContainmentVerdict` carries that distinction into `ContainmentVerdict.authenticated` rather
 * than collapsing it — `null` becomes `authenticated: false`, which is exactly the untrusted
 * vantage Tier A already refuses to pass (`tier-a.ts`'s `containmentTrusted = authenticated &&
 * contained`).
 */
export function observationFromRunReport(caseId: string, report: RunReport): RunObservation {
  return {
    caseId,
    diagnostics: report.diagnostics.map(toDiagnostic),
    declaredScreens: report.screens.declared,
    reachedScreens: report.screens.visited,
    syscallsInvoked: entriesOfKind(report, 'syscall'),
    cuesInvoked: entriesOfKind(report, 'cue'),
    containment: toContainmentVerdict(report.contained),
  };
}

/**
 * `true`/`false` came from an authenticated `probes` frame, so they pass through as
 * `authenticated: true` with the same `contained` value. `null` (no authenticated verdict ever
 * observed) maps to `authenticated: false` — the un-authenticated state Tier A already refuses to
 * trust. `ContainmentVerdict.contained` has no "unknown" value to carry alongside that, so `null`
 * picks `contained: false`: the fail-closed reading, and one that never changes a gating outcome
 * either way, since `authenticated: false` already short-circuits Tier A's `authenticated &&
 * contained` check regardless of what `contained` says.
 */
function toContainmentVerdict(contained: boolean | null): ContainmentVerdict {
  if (contained === null) {
    return { authenticated: false, contained: false };
  }
  return { authenticated: true, contained };
}

function entriesOfKind(report: RunReport, kind: 'syscall' | 'cue'): readonly string[] {
  return report.trace.filter((entry) => entry.kind === kind).map((entry) => entry.method);
}

/**
 * `RuntimeDiagnostic` (`synthrun/contract.ts`) is `Diagnostic` (`checks/contract.ts`) minus a
 * mandatory `line` — a runtime producer (a gate denial, a hard timeout) may anchor to no source
 * line at all. `Diagnostic` requires one; `0` is never a real 1-based line, so it reads
 * unambiguously downstream as "no source anchor", never as a false line-1 pin.
 */
function toDiagnostic(entry: RunReport['diagnostics'][number]): Diagnostic {
  return { ...entry, line: entry.line ?? 0 };
}
