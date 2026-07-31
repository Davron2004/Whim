/**
 * synthetic-run-harness — the shared contract (design D5/D6, `handoff/harness-core.md`).
 *
 * Types plus small const tables only — NO engine logic, mirroring the `checks/contract.ts`
 * precedent (design D5: this library is a plain top-level directory, `checks/`-style, no
 * workspace entry). `DiagnosticKind` is imported, never redeclared: harness-diagnostics req 2
 * mandates runtime-observed kinds be added additively to `checks/contract.ts`'s closed union
 * (chain 5, task 5.1) — this module only references that union, it does not own it.
 */

import type { BrowserContext, Page } from 'playwright';
import type { Diagnostic as StaticDiagnostic } from '../checks/contract';

// ─────────────────────────────────────────────────────────────────────────────
// Diagnostics (spec §Diagnostics extend the central vocabulary additively)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A runtime-observed diagnostic. Same shape as the static-checks `Diagnostic`
 * (`checks/contract.ts`) EXCEPT `line` is optional: a runtime producer (a `pageerror` stack,
 * a gate denial) may have no source anchor at all, only one that resolves through the build's
 * source map when it does (spec: "`line` SHALL be populated when the failure maps... and
 * omitted otherwise"). `hint` stays mandatory, non-empty, on every diagnostic.
 */
export type RuntimeDiagnostic = Omit<StaticDiagnostic, 'line'> & { line?: number };

// ─────────────────────────────────────────────────────────────────────────────
// Trace (spec: "the syscall/cue invocation trace"; refined by chain 3's
// `handoff/capability-trace.md` into the concrete denial/effector record shapes)
// ─────────────────────────────────────────────────────────────────────────────

/** The minimum every trace entry carries; chain 3 extends this into a discriminated union of
 *  concrete syscall/cue/denial record shapes (its own contract owns those fields). */
export interface TraceEntry {
  kind: 'syscall' | 'cue' | 'denial';
  method: string;
  /** Milliseconds since the run's `startedAt` anchor (`RunContext.startedAt`, session.ts). */
  atMs: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Budgets (design D2 — watchdog, owned/defaulted by chain 2; this is the shape only)
// ─────────────────────────────────────────────────────────────────────────────

export interface RunBudgets {
  /** No nonce-authenticated `paint` frame within this many ms ⇒ `mount_timeout`. */
  mountBudgetMs: number;
  /** Per-action quiet-window settle heuristic (never itself a diagnostic). */
  actionQuietMs: number;
  /** Hard cap on the per-action settle wait, regardless of ongoing activity. */
  actionHardCapMs: number;
  /** Total wall-clock budget for the whole run; firing marks the report `truncated`. */
  totalBudgetMs: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Timings (spec: "per-stage timings (build, boot, mount→paint, sweep, per-screen)")
// ─────────────────────────────────────────────────────────────────────────────

export interface StageTimings {
  buildMs: number;
  bootMs: number;
  mountToPaintMs: number;
  sweepMs: number;
  perScreenMs: Record<string, number>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Concurrency handle (design D4 — a caller-set semaphore scoped to the session, not the call;
// see `handoff/harness-core.md` for why `RunOptions` below does not repeat it per call)
// ─────────────────────────────────────────────────────────────────────────────

export interface Semaphore {
  /** Resolves once a concurrency slot is free; call the returned function exactly once to
   *  release it. */
  acquire(): Promise<() => void>;
}

// ─────────────────────────────────────────────────────────────────────────────
// The entry point (spec §One candidate in, one deterministic run report out)
// ─────────────────────────────────────────────────────────────────────────────

export interface RunOptions {
  /** Overrides for any subset of `RunBudgets`; unset fields take the session's defaults. */
  budgets?: Partial<RunBudgets>;
  /** Ephemeral storage-engine `appId` scope for this run (design D3). Defaults to the run's
   *  generated id when omitted — never shared across runs (no cross-candidate contamination). */
  appId?: string;
  /** Called with the freshly-opened page + context AFTER `context.newPage()` but BEFORE
   *  navigation — the seam for setup that must be live before the delivered page's inline
   *  scripts run: chain 2's CDP `Runtime.enable` (a candidate can throw before the
   *  nonce-handshake's slower `toRN()` frame channel would ever catch it — `handoff/
   *  observe-api.md`'s `attachObserversEarly`); chain 3's `context.exposeFunction(
   *  'whimHostDispatch', ...)`. Multiple concerns compose by wrapping: `session.openRun(source,
   *  { beforeNavigate: async (page, ctx) => { await a(page, ctx); await b(page, ctx); } })`. */
  beforeNavigate?: (page: Page, context: BrowserContext) => Promise<void>;
}

export interface RunReport {
  /** `true` IFF `diagnostics.length === 0` (the `checks/contract.ts` `CheckReport` precedent). */
  ok: boolean;
  diagnostics: RuntimeDiagnostic[];
  /** The containment verdict, derived ONLY from the nonce-authenticated `probes` frame
   *  (spec §Observation is trusted-vantage only) — never the candidate's self-report. */
  contained: boolean;
  /** The total wall-clock budget fired and the page was killed mid-run (`run_truncated`). */
  truncated: boolean;
  timings: StageTimings;
  trace: TraceEntry[];
  screens: { declared: string[]; visited: string[] };
  /** The budget values actually applied to this run (session defaults merged with
   *  `RunOptions.budgets`), recorded verbatim. */
  budgets: RunBudgets;
}

/** The library's single entry-point shape: one candidate TypeScript source string (the H1b
 *  bundle contract) plus options in, one deterministic `RunReport` out (spec §One candidate
 *  in...). Declared here as a type first; chain 5 (task 5.2) assembles the composed function
 *  this describes on top of the session/builder/page primitives chain 1 provides (`session.ts`
 *  `SynthRunSession.openRun`, `builder.ts`, `page.ts`) plus observation (chain 2), capability
 *  wiring (chain 3), and the interaction sweep (chain 4). */
export type RunCandidate = (source: string, opts?: RunOptions) => Promise<RunReport>;
