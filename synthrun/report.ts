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
import type { StorageErrorKind } from '../src/host/storage-engine/contract';
import { DIAGNOSTIC_KINDS, type DiagnosticKind } from '../checks/contract';
import { runStaticChecks } from '../checks';
import { wireCapabilityBridge, type CapabilityTraceEntry } from './capability';
import { attachObserversEarly, awaitMount, finalizeContainmentVerdict, mergeBudgets, withTotalBudget, type EarlyObservers } from './observe';
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

/** One `denial` entry as chain 3 records it host-side (`capability.ts`) — the only arm of the
 *  capability trace `denialDiagnostic` below has anything to say about. */
type DenialTraceEntry = Extract<CapabilityTraceEntry, { kind: 'denial' }>;

/**
 * The storage engine's VERB-TIME denial kinds: a value the candidate wrote, or a name it used,
 * that its own declared schema refuses (spec §Verb-time storage denials are candidate
 * diagnostics; host faults are not). Each names a mistake in the candidate's code, so each is an
 * ERROR diagnostic the repair round can act on, carried under the ENGINE'S OWN kind string.
 *
 * The element type is the INTERSECTION of the two vocabularies — the engine's `StorageErrorKind`
 * and the centrally-owned `DiagnosticKind` (`checks/contract.ts`, which this module only
 * references and never extends) — so a rename on either side fails to typecheck instead of
 * silently dropping a denial back into the "unknown kind" bucket.
 */
const VERB_TIME_STORAGE_KINDS: readonly (StorageErrorKind & DiagnosticKind)[] = [
  'type_mismatch',
  'unknown_collection',
  'unknown_field',
  'unknown_record',
  'unqueryable_field',
  'kv_too_large',
];

/**
 * HOST FAULTS. `not_open` and `corrupt_storage` report THIS HARNESS'S engine state — a database
 * that never opened, a store that is damaged — not anything the candidate wrote, so no repair
 * round could act on them and they are deliberately not members of `DIAGNOSTIC_KINDS`. A denial
 * carrying one is excluded from `RunReport.diagnostics` and never renamed into a kind that is a
 * member; it stays verbatim in `RunReport.trace`, so the exclusion is visible rather than silent
 * (spec: "No denial SHALL be dropped from both the diagnostics and the trace").
 *
 * Typed as exactly the engine kinds that are NOT diagnostic kinds: were `DIAGNOSTIC_KINDS` ever
 * to adopt one of these, this list would stop compiling rather than quietly start reporting it.
 */
const HOST_FAULT_KINDS: readonly Exclude<StorageErrorKind, DiagnosticKind>[] = ['not_open', 'corrupt_storage'];

/**
 * The denial → diagnostic mapping, pure: one recorded denial in, the diagnostic it becomes, or
 * `null` when this denial is not a candidate diagnostic at all (a host fault, or a kind outside
 * the closed vocabulary — never minted here). Collected host-side, so a candidate that `.catch`es
 * and swallows the rejected promise is reported exactly like one that does not.
 */
export function denialDiagnostic(entry: DenialTraceEntry): RuntimeDiagnostic | null {
  if ((HOST_FAULT_KINDS as readonly string[]).includes(entry.errorKind)) return null;
  if (!CLOSED_KINDS.includes(entry.errorKind)) return null; // closed vocabulary — never minted
  const verbTime = (VERB_TIME_STORAGE_KINDS as readonly string[]).includes(entry.errorKind);
  return {
    kind: entry.errorKind as DiagnosticKind,
    severity: 'error',
    // Named for what actually refused: the capability gate never sees a verb-time error — the
    // engine does, after the call was authorized. The engine's own hint travels verbatim.
    message: verbTime
      ? `${entry.method}: storage refused the call (${entry.errorKind})`
      : `${entry.method}: gate denied (${entry.errorKind})`,
    hint: entry.hint,
  };
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
        // Every trusted-vantage collector — CDP, the frame relay, the console heartbeat — is live
        // from here, i.e. before the delivered page's inline scripts run (`handoff/
        // observation-phases.md`); nothing observation-side is attached after navigation.
        early = await attachObserversEarly(page, context); // chain 2
        await wiring.beforeNavigate(page, context); // chain 3
        if (opts.beforeNavigate) await opts.beforeNavigate(page, context);
      },
    });
    // Installs nothing — hands the now-available `ctx.sourceMap` to the already-attached CDP
    // collector and returns it.
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

      // Close out the verdict BEFORE the copy below, so a run that never saw an authenticated
      // `probes` frame carries `containment_unobserved` and `contained: null` never travels
      // without its diagnostic. Idempotent — a malformed-payload frame already recorded it.
      finalizeContainmentVerdict(obs.state);

      // `obs.state.diagnostics` is chronological (pushed as observed): the mount gate's own
      // `mount_timeout`, if any, plus every `runtime_throw`/`unhandled_rejection`/
      // `containment_failure`/`containment_unobserved`/`run_truncated` recorded up to and
      // including the sweep just above.
      diagnostics.push(...obs.state.diagnostics);

      // Host-side denials become diagnostics too — both the gate's own refusals (spec "Undeclared
      // capability yields the production denial") and the engine's verb-time refusals — reusing
      // the producer's own kind verbatim, never re-derived. Host faults map to nothing and stay
      // in `trace` below; see `denialDiagnostic`.
      for (const entry of wiring.trace) {
        if (entry.kind !== 'denial') continue;
        const diagnostic = denialDiagnostic(entry);
        if (diagnostic) diagnostics.push(diagnostic);
      }

      return {
        ok: diagnostics.length === 0,
        diagnostics,
        // Derived ONLY from the nonce-authenticated probes frame (spec §Observation is
        // trusted-vantage only), and emitted VERBATIM — all three states survive to the consumer:
        // `true` held, `false` breach, `null` no authenticated verdict was ever observed. The
        // harness never collapses `null` onto `false` (or `true`): "we could not hear the guard"
        // is not "the guard said no" (design D2).
        contained: obs.state.contained,
        // The fact plus a saturating count — never the forged payload (design D5).
        forgeries: { rejected: obs.state.rejectedForgeries > 0, count: obs.state.rejectedForgeries },
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
