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
 *  concrete syscall/cue/denial record shapes (its own contract owns those fields).
 *  `egress_blocked` is the harness's own entry, `EgressBlockedTraceEntry` below. */
export interface TraceEntry {
  kind: 'syscall' | 'cue' | 'denial' | 'egress_blocked';
  method: string;
  /** Milliseconds since the run's `startedAt` anchor (`RunContext.startedAt`, session.ts). */
  atMs: number;
}

/** The fixed cap for the blocked-egress count. Refusals beyond it saturate, exactly like
 *  `REJECTED_FORGERY_CAP`: the signal needed is "did this candidate try to reach the network, once
 *  or repeatedly", and a candidate must not be able to grow the report by retrying. */
export const BLOCKED_EGRESS_CAP = 16;

/** Spec §A synthetic run has no network egress: every request or WebSocket the run's browser
 *  context aborted, recorded as the FACT (this entry is present) plus a BOUNDED count. At most one
 *  per report, appended last, and only when something was refused. It never carries a URL: the
 *  destination is candidate-chosen text. */
export interface EgressBlockedTraceEntry extends TraceEntry {
  kind: 'egress_blocked';
  method: 'network';
  /** When the first refusal happened, from the run's `startedAt` anchor. */
  atMs: number;
  /** Refusals observed, saturating at `BLOCKED_EGRESS_CAP` (read a capped value as "at least"). */
  count: number;
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
  /** Resolves once a concurrency slot is free with the function that releases it. When `signal`
   *  aborts first, the waiter MUST leave the queue without ever holding a slot, and the promise
   *  rejects with an `AbortError`. Calling the release function again after the first call does
   *  nothing. */
  acquire(signal?: AbortSignal): Promise<() => void>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Rejected forgeries (spec §Observation is trusted-vantage only, "A frame the outer page
// rejected as a forgery SHALL be recorded as the fact of a rejection plus a bounded count";
// design D5)
// ─────────────────────────────────────────────────────────────────────────────

/** The fixed cap the harness declares for the rejected-forgery count. Rejections beyond it
 *  SATURATE rather than being recorded individually, so the recorded signal is fixed-size no
 *  matter how many frames a candidate posts (design D5: the signal needed is "did this candidate
 *  try to forge, and was it once or was it spamming", which saturates well before this). */
export const REJECTED_FORGERY_CAP = 16;

/** The whole rejected-forgery signal: the FACT plus a BOUNDED count — never the payload, never a
 *  per-frame list. A forged frame's contents are attacker-chosen input, so echoing them would let
 *  the candidate author our diagnostics and an unbounded list would be a log-exhaustion lever. */
export interface ForgeryTally {
  /** At least one frame was refused as a forgery during this run — by the outer page's nonce check
   *  or by the host's own provenance guard (see `RunReport.forgeries`). */
  rejected: boolean;
  /** How many rejections were observed, SATURATING at `REJECTED_FORGERY_CAP`: when `count`
   *  equals the cap, read it as "at least `REJECTED_FORGERY_CAP`", never as exactly that many.
   *  `0` iff `rejected` is `false`. */
  count: number;
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
   *  observe-api.md`'s `attachObserversEarly`); chain 3's `context.exposeBinding(
   *  'whimHostDispatch', ...)` — `exposeBinding`, never `exposeFunction`, because only the former
   *  keeps the calling frame's browser-derived identity, which is what refuses a syscall frame
   *  hand-rolled inside the candidate's own realm (`capability.ts`, design D2). Multiple concerns
   *  compose by wrapping: `session.openRun(source,
   *  { beforeNavigate: async (page, ctx) => { await a(page, ctx); await b(page, ctx); } })`. */
  beforeNavigate?: (page: Page, context: BrowserContext) => Promise<void>;
  /** Cancellation (generation-pipeline spec "Cancellation aborts the pipeline at every boundary",
   *  synthetic-run spec "Abort is honoured at every wait in a run"). Raced at every wait
   *  (public-generation-server design D12, which supersedes #56 D8's "threaded, not raced" for
   *  the slot, navigation and mount waits). The page and context are closed within 5 s of the
   *  abort, and the slot is released exactly once:
   *  - while queued for a slot: the waiter leaves the queue, never holds the slot and never opens a
   *    context; the call rejects with an `AbortError`;
   *  - while a replacement browser launches, before the context is created, or during navigation:
   *    `openRun` closes what it opened, releases the slot and rejects with an `AbortError`;
   *  - while awaiting mount: the wait ends within one poll, the sweep is skipped, and the run
   *    disposes;
   *  - during the sweep: `withTotalBudget` hard-kills the page and returns `aborted: true`.
   *  Once `openRun` has returned, `runCandidate` resolves with a report the caller must discard.
   *  esbuild and the synchronous static check stay unraced; both are bounded by input caps. */
  signal?: AbortSignal;
}

export interface RunReport {
  /** `true` IFF `diagnostics.length === 0` (the `checks/contract.ts` `CheckReport` precedent). */
  ok: boolean;
  diagnostics: RuntimeDiagnostic[];
  /** The containment verdict, derived ONLY from the nonce-authenticated `probes` frame
   *  (spec §Observation is trusted-vantage only) — never the candidate's self-report.
   *
   *  THREE-VALUED, and never collapsed (design D2):
   *  - `true`  — an authenticated `probes` frame reported containment held;
   *  - `false` — an authenticated `probes` frame reported a breach (a `containment_failure`
   *              diagnostic accompanies it);
   *  - `null`  — NO authenticated verdict was ever observed: no `probes` frame arrived, or the
   *              one that arrived carried no boolean verdict (a `containment_unobserved`
   *              diagnostic accompanies it, and NO `containment_failure`).
   *
   *  "We could not hear the guard" and "the guard said no" are distinct states at the type level:
   *  a consumer that ignores the distinction fails to compile rather than silently treating an
   *  unverified run as a breach — or as a pass. */
  contained: boolean | null;
  /** Frames refused as forgeries: the fact plus a count bounded by `REJECTED_FORGERY_CAP`
   *  (design D5). BOTH refusal sites are folded into this one tally — the outer page rejecting a
   *  frame that fails its nonce check, and the HOST refusing a frame that arrived on its relay
   *  binding from outside `page.mainFrame()` (i.e. straight from the candidate's realm) — so a
   *  non-zero count does NOT imply the outer page rejected anything. Payload-free by construction —
   *  no byte of a forged frame reaches this or any other report field, any diagnostic, any log
   *  line, or any model-facing path. */
  forgeries: ForgeryTally;
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
