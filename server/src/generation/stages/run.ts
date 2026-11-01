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
import type { CheckedManifest, NeverMountedPhase, RunInput, RunOutcome, RunStage, RunVerdict } from '../machine';
import type { Diagnostic } from '@whim/contract';
import type { RunCandidate, RunReport, RuntimeDiagnostic } from '../../../../synthrun/contract';

function toWireDiagnostic(d: RuntimeDiagnostic): Diagnostic {
  return { kind: d.kind, severity: d.severity, message: d.message, symbol: d.symbol, line: d.line, hint: d.hint };
}

/** The check that kept an unverified run from reporting a verdict (beta-1 D11): the kind of the
 *  first diagnostic the harness recorded besides `containment_unobserved` itself (a
 *  `mount_timeout`, a `runtime_throw` before the probes ran), or `containment_unobserved` when it
 *  recorded nothing else. A kind only, from the closed vocabulary: no message, hint or symbol. */
function unobservedVerdict(report: RunReport): RunVerdict<'unobserved'> {
  const cause = report.diagnostics.find((d) => d.kind !== 'containment_unobserved');
  return { kind: 'unobserved', check: cause?.kind ?? 'containment_unobserved' };
}

/** The phase says the candidate itself never mounted (#58, design D1). It comes from the harness's
 *  channel-derived `unobservedPhase`; no message text is read here either. */
function neverMountedPhase(report: RunReport): NeverMountedPhase | undefined {
  const phase = report.unobservedPhase;
  return phase === 'module-eval' || phase === 'bundle' || phase === 'mount-timeout' ? phase : undefined;
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
      let report = await runCandidate(input.source, { signal });
      let rerun = false;

      // An unobserved verdict that is not the candidate's own fault is a harness fault: the same
      // source is run once more, in the fresh browser context every call gets, consuming no repair
      // attempt (spec "The run stage is the synthetic harness…"; design D1). The re-run's verdict is
      // then handled as a first run's would be, except that a still-unobserved one is terminal
      // whatever its phase. An abandoned run is not re-run.
      if (report.contained === null && !neverMountedPhase(report) && !signal?.aborted) {
        report = await runCandidate(input.source, { signal });
        rerun = true;
      }

      // The harness's verdict is THREE-valued (`handoff/run-report-contract.md`): `false` is an
      // authenticated breach, `null` is "no authenticated verdict was ever observed", `true` is the
      // only value that lets a candidate proceed. All three are discriminated explicitly here: a
      // bare `=== false` would let `null` fall through to the delivery path — treating an
      // unverified run as "not a breach, proceed", which is the collapse this stage exists to
      // prevent. Only `true` ever reaches the code below; nothing here delivers a candidate whose
      // verdict went unobserved.
      //
      // Containment failure is TERMINAL (design D7, spec "Containment failure short-circuits"). In
      // that branch `diagnostics` is explicitly `[]`, not a copy of the harness's report: nothing
      // about the escape attempt is even carried this far, so "feeds nothing back to the model"
      // holds at the type level too. What does travel is the content-free verdict the machine logs
      // (beta-1 D11): the probes' own `containment_failure`.
      if (report.contained === false) return { contained: false, diagnostics: [], verdict: { kind: 'breach', check: 'containment_failure' } };
      if (report.contained === null) {
        const phase = neverMountedPhase(report);
        // A first run that never mounted by the candidate's own fault goes to repair with the
        // harness's candidate diagnostics (design D1): every `containment_*` kind is filtered out
        // by kind, so no unobserved-verdict or forgery detail can reach the repair prompt.
        if (phase && !rerun) {
          const diagnostics = report.diagnostics.filter((d) => !d.kind.startsWith('containment_')).map(toWireDiagnostic);
          return { contained: null, repairable: true, diagnostics, phase };
        }
        // Otherwise the unobserved ending is terminal and distinct from a containment failure: its
        // `diagnostics` is `[]` and the verdict names only the check that kept it away.
        return { contained: null, repairable: false, diagnostics: [], verdict: unobservedVerdict(report), phase: report.unobservedPhase ?? 'none', rerun };
      }

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
