/**
 * evals/adapters/synthetic-run.ts — the ONLY module under `evals/` permitted to import the
 * synthetic-run harness (design D6, `handoff/eval-contract.md`, `handoff/run-observation.md`).
 * Normalizes its `RunReport` (`synthrun/contract.ts`, `synthrun/report.ts`'s `createRunCandidate`)
 * into the one shape every tier evaluator reads — `RunObservation` (`evals/contract.ts`) — so a
 * harness field-name change touches exactly this file, never a tier.
 */
import type { RunReport } from '../../synthrun/contract';
import type { Diagnostic, RunObservation } from '../contract';

/**
 * `report.contained` is derived ONLY from the nonce-authenticated `probes` frame by construction
 * (`synthrun/report.ts`: "Derived ONLY from the nonce-authenticated probes frame ... never
 * adopted as `true`" otherwise) — every real synthetic-run report is therefore authenticated by
 * definition. An un-authenticated `ContainmentVerdict` can only arise from a hand-built
 * (synthesized) `RunObservation` used to exercise Tier A's untrusted-verdict path directly —
 * never from this adapter.
 */
export function observationFromRunReport(caseId: string, report: RunReport): RunObservation {
  return {
    caseId,
    diagnostics: report.diagnostics.map(toDiagnostic),
    declaredScreens: report.screens.declared,
    reachedScreens: report.screens.visited,
    syscallsInvoked: entriesOfKind(report, 'syscall'),
    cuesInvoked: entriesOfKind(report, 'cue'),
    containment: { authenticated: true, contained: report.contained },
  };
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
