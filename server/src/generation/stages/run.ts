/**
 * server/src/generation/stages/run.ts — the harness adapter (design D8, `handoff/run-stage.md`).
 * Wraps ONE already-bound `synthrun` `RunCandidate` into the machine's minimal `RunStage`
 * interface (design D2, `handoff/pipeline-machine.md`). This module owns no session lifecycle of
 * its own — "one session per pipeline" (design D8) means the composition root launches ONE
 * `SynthRunSession`, binds it once via `createRunCandidate(session)` (`synthrun/report.ts`), and
 * passes the resulting function in here; every run then takes its own slot from that session's
 * semaphore, unchanged from `synthrun`'s own per-call behavior.
 *
 * The pipeline SHALL NOT reimplement, approximate, or relax any part of the harness's
 * containment, gate, or page assembly (spec "The run stage is the synthetic harness") — this
 * adapter only maps the harness's own verdict onto the machine's `RunOutcome` shape.
 */
import { assembleRecord } from '../record';
import type { CheckedManifest, RunInput, RunOutcome, RunStage } from '../machine';
import type { Diagnostic } from '@whim/contract';
import type { RunCandidate, RuntimeDiagnostic } from '../../../../synthrun/contract';

function toWireDiagnostic(d: RuntimeDiagnostic): Diagnostic {
  return { kind: d.kind, severity: d.severity, message: d.message, symbol: d.symbol, line: d.line, hint: d.hint };
}

/** The machine only ever reaches `RUN` once `CHECK` is clean (design D6's errors-block gate),
 *  which always leaves `CheckReport.manifest` defined (design D12) — `RunInput.manifest` is typed
 *  optional only because it is threaded straight from that report. A missing manifest here is an
 *  upstream invariant violation, not a normal run outcome, so this throws rather than silently
 *  degrading; the machine's own top-level catch turns it into one generic `failure` event, same as
 *  any other unexpected stage throw. */
function requireManifest(manifest: CheckedManifest | undefined): CheckedManifest {
  if (!manifest) {
    throw new Error(
      'RunStage: run invoked without a checked manifest — CHECK must have been clean for RUN to ' +
        'ever be reached (design D6), which always leaves a manifest behind.',
    );
  }
  return manifest;
}

/**
 * Adapts a bound `RunCandidate` (design D8) into the machine's `RunStage`. `signal`, when
 * provided, is forwarded verbatim to the harness's own `RunOptions.signal` — the harness disposes
 * its browser context/page and releases its concurrency slot on that path
 * (`synthrun/observe.ts`'s `withTotalBudget`); this adapter adds no cleanup of its own.
 */
export function createRunStage(runCandidate: RunCandidate): RunStage {
  return {
    async run(input: RunInput, signal?: AbortSignal): Promise<RunOutcome> {
      const report = await runCandidate(input.source, { signal });

      // Containment failure is TERMINAL (design D7, spec "Containment failure short-circuits"):
      // the machine ignores `diagnostics` in this branch outright, but nothing about the escape
      // attempt is even carried this far — `diagnostics` is explicitly `[]`, not a copy of the
      // harness's report, so "feeds nothing back to the model" holds at the type level too.
      if (report.contained === false) return { contained: false, diagnostics: [] };

      const diagnostics: Diagnostic[] = report.diagnostics.map(toWireDiagnostic);

      // Truncation is never a silent pass (spec "Truncation is not a pass"). The harness's own
      // total-budget watchdog already appends a `run_truncated` diagnostic when IT fires; a
      // per-screen sweep truncation (`synthrun/sweep.ts`'s `SweepResult.truncated`) does not —
      // cover that gap here so a truncated sweep can never look like a clean candidate to the
      // machine's errors-block gate.
      if (report.truncated && !diagnostics.some((d) => d.kind === 'run_truncated')) {
        diagnostics.push({
          kind: 'run_truncated',
          severity: 'error',
          message: 'the run was truncated before every interactive element was swept',
          hint: 'the candidate likely has more interactive surface than the harness budget covers — simplify the screen or split it up',
        });
      }

      const manifest = requireManifest(input.manifest);
      const record = assembleRecord(input.source, manifest, input.build);
      return { contained: true, diagnostics, record };
    },
  };
}
