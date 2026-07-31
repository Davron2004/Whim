/**
 * synthetic-run-harness — report assembly (design D5, chain 5 task 5.2, `handoff/harness-core.
 * md`/`handoff/observe-api.md`/`handoff/capability-trace.md`). Composes chain 1's session/
 * builder/page primitives, chain 2's trusted-vantage observation + watchdog, chain 3's
 * capability wiring, and chain 4's interaction sweep into the `RunCandidate` entry point
 * `contract.ts` declares: one candidate source string + options in, one deterministic
 * `RunReport` out.
 *
 * Concurrency is session-scoped, not per-call (`harness-core.md`'s D4 note) — `createRunCandidate`
 * binds the returned function to one caller-owned `SynthRunSession`; the caller launches/closes
 * the session itself, same as every other chain's own test suite.
 */
import type { AppRecord } from '../src/host/bridge';
import { DIAGNOSTIC_KINDS, type DiagnosticKind } from '../checks/contract';
import { runStaticChecks } from '../checks';
import { wireCapabilityBridge } from './capability';
import { attachObserversEarly, awaitMount, mergeBudgets, withTotalBudget, type EarlyObservers } from './observe';
import type { SynthRunSession } from './session';
import { sweepApp } from './sweep';
import type { RunCandidate, RunOptions, RunReport, RuntimeDiagnostic } from './contract';

const CLOSED_KINDS: readonly string[] = DIAGNOSTIC_KINDS;

/**
 * Reuses a denial/launch-error kind verbatim when it is already a member of the closed
 * `DiagnosticKind` union (spec §Diagnostics extend the central vocabulary additively, "reuse
 * the runtime's existing kind string"). Falls back to `'launch_failed'` — itself a closed-vocab
 * member, task 5.1 — for any kind this harness has not been told about; NEVER mints a new one.
 */
function knownKind(kind: string): DiagnosticKind {
  return (CLOSED_KINDS.includes(kind) ? kind : 'launch_failed') as DiagnosticKind;
}

/**
 * Build the `RunCandidate` entry point bound to one session. Each call: statically extracts the
 * candidate's manifest (capabilities + schema) ONLY to build the `AppRecord` capability wiring
 * needs — this harness never gates on static-check diagnostics, it exists to catch what they
 * cannot (design Goals) — opens one run, composes the observation + capability `beforeNavigate`
 * hooks (the integration order this chain received: observers attach first, then capability
 * exposure, then any caller-supplied hook), awaits mount, sweeps under the total budget, and
 * assembles the deterministic report.
 */
export function createRunCandidate(session: SynthRunSession): RunCandidate {
  return async function runCandidate(source: string, opts: RunOptions = {}): Promise<RunReport> {
    const budgets = mergeBudgets(opts.budgets);
    const manifest = runStaticChecks(source).manifest;
    const appId = opts.appId ?? crypto.randomUUID();
    const appRecord: AppRecord = {
      appId,
      name: manifest?.name ?? appId,
      manifest: { capabilities: manifest?.capabilities ?? [] },
      schemaArtifact: manifest?.schema as AppRecord['schemaArtifact'],
    };
    const wiring = wireCapabilityBridge(appRecord);

    let early: EarlyObservers | undefined;
    const { ctx, dispose } = await session.openRun(source, {
      ...opts,
      appId,
      beforeNavigate: async (page, context) => {
        early = await attachObserversEarly(page, context); // chain 2
        await wiring.beforeNavigate(page, context); // chain 3
        if (opts.beforeNavigate) await opts.beforeNavigate(page, context);
      },
    });
    const obs = await early!.finish(ctx);

    const diagnostics: RuntimeDiagnostic[] = [];
    // Launch failure is a diagnostic (capability-trace.md: "The caller MUST surface launchError
    // as a diagnostic itself — this module never invents a RuntimeDiagnostic"); the run still
    // proceeds — the page still boots and mounts normally, only capability wiring is absent.
    if (wiring.launchError) {
      diagnostics.push({
        kind: knownKind(wiring.launchError.kind),
        severity: 'error',
        message: `app launch refused (${wiring.launchError.kind})`,
        hint: wiring.launchError.hint,
      });
    }

    try {
      const mountDiag = await awaitMount(obs, budgets);

      let sweepMs = 0;
      let declared: string[] = [];
      let visited: string[] = [];
      let sweepTruncated = false;
      let perScreenMs: Record<string, number> = {};

      const { truncated: budgetTruncated } = await withTotalBudget(
        ctx,
        obs,
        budgets,
        async () => {
          if (mountDiag) return; // a hung mount never reaches a swept-able page (spec: no reason to burn the budget)
          const sweepStart = Date.now();
          const sweep = await sweepApp(ctx, obs, source, budgets);
          sweepMs = Date.now() - sweepStart;
          declared = sweep.declaredScreens;
          visited = sweep.visitedScreens;
          sweepTruncated = sweep.truncated;
          perScreenMs = sweep.perScreenMs;
          diagnostics.push(...sweep.diagnostics);
        },
        opts.signal,
      );

      // `obs.state.diagnostics` is chronological (pushed as observed): the mount gate's own
      // `mount_timeout`, if any, plus every `runtime_throw`/`unhandled_rejection`/
      // `containment_failure`/`run_truncated` recorded up to and including the sweep just above.
      diagnostics.push(...obs.state.diagnostics);

      // Host-side gate denials become diagnostics too (spec "Undeclared capability yields the
      // production denial" scenario) — reusing the bridge's own kind verbatim, never re-derived.
      for (const entry of wiring.trace) {
        if (entry.kind !== 'denial') continue;
        if (!CLOSED_KINDS.includes(entry.errorKind)) continue; // closed vocabulary — never minted
        diagnostics.push({
          kind: entry.errorKind as DiagnosticKind,
          severity: 'error',
          message: `${entry.method}: gate denied (${entry.errorKind})`,
          hint: entry.hint,
        });
      }

      return {
        ok: diagnostics.length === 0,
        diagnostics,
        // Derived ONLY from the nonce-authenticated probes frame (spec §Observation is
        // trusted-vantage only) — `null` (no probes frame yet, e.g. a hung/killed mount) reads
        // as not-proven-contained, never adopted as `true`.
        contained: obs.state.contained === true,
        // Either the total budget fired (page hard-killed) OR the sweep itself hit a per-screen
        // cap with unvisited fingerprints remaining — both mean the report is not a complete
        // pass (spec "A truncated sweep SHALL be marked in the report, never silently reported
        // as complete").
        truncated: budgetTruncated || sweepTruncated,
        timings: {
          buildMs: ctx.timings.buildMs,
          bootMs: ctx.timings.bootMs,
          mountToPaintMs: obs.state.paintAtMs ?? budgets.mountBudgetMs,
          sweepMs,
          perScreenMs,
        },
        trace: wiring.trace,
        screens: { declared, visited },
        budgets,
      };
    } finally {
      obs.detach();
      await dispose();
    }
  };
}
