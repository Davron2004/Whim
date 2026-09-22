/**
 * server/test/run-stage-fixtures.ts — a stub `RunCandidate` plus a failing-check detail formatter
 * shared by `run-stage.suite.ts` (pure-Node, the adapter driven by a hand-built `RunReport`) and
 * `e2e.ts` (browser-backed, the adapter driven by the real synthrun harness). Nothing here needs
 * Chromium.
 */
import type { CheckedManifest } from '../src/generation/machine';
import type { RunCandidate, RunOptions, RunReport } from '../../synthrun/contract';

const EMPTY_BUDGETS = { mountBudgetMs: 8000, actionQuietMs: 300, actionHardCapMs: 4000, totalBudgetMs: 45000 };

export function fakeReport(overrides: Partial<RunReport>): RunReport {
  return {
    ok: true,
    diagnostics: [],
    // The harness's verdict is three-valued (`handoff/run-report-contract.md`); this default is the
    // "we saw a clean run" stub. A stub meaning "we never heard back" must say `contained: null`
    // explicitly — there is no value that stands in for it.
    contained: true,
    forgeries: { rejected: false, count: 0 },
    truncated: false,
    timings: { buildMs: 0, bootMs: 0, mountToPaintMs: 0, sweepMs: 0, perScreenMs: {} },
    trace: [],
    screens: { declared: [], visited: [] },
    budgets: EMPTY_BUDGETS,
    ...overrides,
  };
}

export function stubRunCandidate(r: RunReport): RunCandidate {
  return async (_source: string, _opts?: RunOptions) => r;
}

export const A_MANIFEST: CheckedManifest = { name: 'X', manifest: {}, schema: {} };

/** Compact, non-lossy detail for a failing `contained` assertion: the raw verdict (`JSON.stringify`
 *  so `null` and `false` never collapse into the same rendered text) plus every diagnostic's
 *  kind/message from the underlying `RunReport` — present even when `RunOutcome.diagnostics` was
 *  zeroed by the D7 short-circuit — so a `mount_timeout` (never reported back) reads differently
 *  from a genuine `containment_failure` in the CI log. The forgery TALLY is included too (a count,
 *  never a payload — `handoff/run-report-contract.md`'s payload-free invariant), and a CI log line
 *  is not a model-facing path. The tally is NOT a hostility signal: the harness's own T6b spoof
 *  probe is rejected on every run, so a clean candidate's baseline is `rejected: true` with
 *  `count >= 1`, rising with realm resets. It reads as "forgery rejection is happening at all",
 *  and a saturated count reads as a candidate flooding the channel. */
export function containedDetail(contained: unknown, capturedReport: RunReport | undefined): string {
  const diagnostics = capturedReport
    ? capturedReport.diagnostics.map((d) => {
        const suffix = d.message ? `: ${d.message}` : '';
        return `${d.kind}${suffix}`;
      })
    : ['<no report captured>'];
  const reportContained = capturedReport ? JSON.stringify(capturedReport.contained) : '<n/a>';
  const forgeries = capturedReport ? JSON.stringify(capturedReport.forgeries) : '<n/a>';
  return `contained=${JSON.stringify(contained)}, report.contained=${reportContained}, forgeries=${forgeries}, diagnostics=${JSON.stringify(diagnostics)}`;
}
