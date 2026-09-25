/**
 * server/src/generation/machine.ts — the bounded generation state machine (design D2, D4-D9, D11;
 * spec "The pipeline is a bounded state machine", "Stage events narrate the machine over the
 * existing contract", "Exactly one terminal event per completed run", "The plan is structured and
 * validated against the request", "Repair asks for a minimal diff with the diagnostics in context",
 * "Cancellation aborts the pipeline at every boundary", "A run is bounded in wall-clock time", "A run
 * ends cleanly when the operator's provider credit is exhausted"). Depends on nothing concrete: `CheckStage`,
 * `BuildStage`, `RunStage`, and `Clock` are injected interfaces (design D2), so this file compiles
 * and is tested against fakes only — the two exceptions are pure, dependency-free library functions
 * (`scanStorageSurface`, `burnedIdFloor`), imported rather than injected precisely because the edit
 * context must be derived from ONE definition shared with the checker, not from a fake's opinion.
 * See `handoff/pipeline-machine.md` for the full contract.
 */
import type {
  Diagnostic,
  GenerateRequest,
  GenerationEvent,
  RunSummary,
  Usage,
  WireAppRecord,
} from '@whim/contract';
import { scanStorageSurface } from '../../../checks/index';
import type { StorageSurface } from '../../../checks/index';
import type { DiagnosticKind } from '../../../checks/contract';
import { burnedIdFloor } from '../../../src/host/storage-engine/schema';
import type { AppliedSchema } from '../../../src/host/storage-engine/schema';
import {
  isCreditExhaustedError,
  isUpstreamModelFailure,
  type ModelCallLabel,
  type ModelClient,
  type ModelMessage,
  type ModelRoster,
  type RoleSetting,
} from './model';
import type { PromptInputs } from './prompts/inputs';
import { buildGenerateMessages, buildPlanMessages, buildRepairMessages } from './prompts';
import { type Plan, parsePlan, validatePlan } from './plan';
import { unwrapSourceFence } from './source-block';
import { claimsNoChange, neutralSummary, type SourceChange, type Summariser, type SummariserInput } from './summarise';
import type { TerminalFailureCode } from './failure-codes';
import { invalidateCreditCache } from '../admission/credit';
import { log, type ServerLogger } from '../logger';

/** Per-run pipeline breadcrumbs — run start, stage transitions, model-call failures, repair
 *  triggers and terminal outcomes — as one child logger carrying its scope as a field. Everything
 *  variable is a NAMED FIELD, never interpolated into the message, and the root logger's `redact`
 *  config is what keeps prompt text / generated source / the API key out of these records: it is
 *  enforced at the serializer, not by a rule a future author has to remember.
 *
 *  Nothing here is called from inside a delta-iteration or token-emission loop. */
const runLog = log.child({ scope: 'run' });

/** The run's own logger: `runLog`, bound to the request id when the trace carries one, so every
 *  line of a served request's run joins its request line and ledger row. */
function runLogFor(trace: RunTrace | undefined): ServerLogger {
  return trace?.requestId === undefined ? runLog : runLog.child({ requestId: trace.requestId });
}

/** The logger the run hands its model calls and summariser: the root logger bound to the request id
 *  alone, never `runLog`, whose `scope` would sit beside the model client's own (pino writes both
 *  keys). Undefined outside a request, so the model client logs through its module logger. */
function modelLogFor(trace: RunTrace | undefined): ServerLogger | undefined {
  return trace?.requestId === undefined ? undefined : log.child({ requestId: trace.requestId });
}

// ─── Injected stage interfaces (design D2) ──────────────────────────────────

/** The clock a run's wall-clock deadline is measured on (design D2's deps object, D13). */
export interface Clock {
  now(): number;
  /** Arms a one-shot timer that calls `onFire` once `delayMs` has elapsed on this clock, and returns
   *  its disarm function. Optional: a clock without it (the production `Date.now` clock) runs the
   *  deadline on the host's timers. */
  setTimer?(delayMs: number, onFire: () => void): () => void;
}

/** The extraction `WireAppRecord.name`/`.manifest`/`.schema` come from (design D12) — present
 *  whenever `CheckStage` extraction succeeded, even alongside other diagnostics. */
export interface CheckedManifest {
  name: string;
  manifest: Record<string, unknown>;
  schema: Record<string, unknown>;
}

export interface CheckReport {
  diagnostics: Diagnostic[];
  manifest?: CheckedManifest;
}

export interface CheckContext {
  appliedSchema?: Record<string, unknown>;
  /** The storage surface of the source this candidate REPLACES — the drift baseline, and the same
   *  value the edit turn's location list was rendered from (design D3: one scanner, two consumers).
   *  Absent for a new app and for an edit with no pre-flighted source, which is how a caller says
   *  "unconstrained", never a bug. */
  previousSurface?: StorageSurface;
}

/** No `ok`/severity-gate field on purpose (design D6: "the checker API grows no severity knob —
 *  the policy lives entirely in the pipeline"). The machine alone decides errors-block /
 *  warnings-pursued from `diagnostics[].severity`. */
export interface CheckStage {
  check(source: string, ctx: CheckContext, signal?: AbortSignal): Promise<CheckReport> | CheckReport;
}

export interface BuildResult {
  bundle: string;
  sourceMap?: string;
}

/** A builder throw is mapped (by the concrete `BuildStage`) to a single `build_failure` error
 *  diagnostic rather than propagating — the machine treats it exactly like a check-stage error, so
 *  the model gets a chance to fix its own build-breaking code via the same repair loop. */
export type BuildOutcome = { ok: true; result: BuildResult } | { ok: false; diagnostic: Diagnostic };

export interface BuildStage {
  build(source: string, signal?: AbortSignal): Promise<BuildOutcome> | BuildOutcome;
}

export interface RunInput {
  source: string;
  manifest?: CheckedManifest;
  build: BuildResult;
}

/** `contained: false` is TERMINAL (design D7): `diagnostics` and any assembled record are ignored
 *  entirely by the machine, no repair attempt is consumed, and nothing about the escape is fed back
 *  to the model.
 *
 *  `contained: null` — the harness observed no authenticated containment verdict at all — is its
 *  own THIRD ARM (design D8-local), not a flag hung off either of the others: an arm makes every
 *  non-exhaustive consumer a compile error, whereas a discriminant field would let a consumer that
 *  handles both original arms keep compiling while silently mishandling the new state. It is
 *  terminal on the same terms as `false` (no repair attempt, nothing fed back) but is a DISTINCT
 *  outcome carrying its own user-facing reason, and is never re-run (design D3): it is NOT a
 *  containment failure, and must never be reported as one — never heard back is not evidence of a
 *  breach, and it is not evidence of containment either.
 *
 *  When `contained` is `true`, `record` is ALWAYS present (the harness-validated `WireAppRecord`,
 *  design D12) — the machine, not the stage, decides whether to deliver it or keep repairing, based
 *  on `diagnostics[].severity` (design D6). */
export type RunOutcome =
  | { contained: false; diagnostics: Diagnostic[]; verdict: RunVerdict<'breach'> }
  | { contained: null; diagnostics: Diagnostic[]; verdict: RunVerdict<'unobserved'> }
  | { contained: true; diagnostics: Diagnostic[]; record: WireAppRecord };

/** A non-affirmative verdict, content-free (beta-1 D11): which one, and the closed diagnostic kind
 *  of the check that tripped it. Logged once with the run's terminal failure, never fed back to
 *  the model, and never carrying source, DOM or console text. */
export interface RunVerdict<K extends 'breach' | 'unobserved' = 'breach' | 'unobserved'> {
  kind: K;
  check: DiagnosticKind;
}

export interface RunStage {
  run(input: RunInput, signal?: AbortSignal): Promise<RunOutcome> | RunOutcome;
}

/** How a run ended (design D13). */
export type RunTraceOutcome = 'delivered' | 'failed' | 'expired' | 'aborted';

/** A deliberately dumb out-parameter (design D9): the machine appends each model call's provider
 *  generation id as it resolves. A stub that ignores it stays conforming. */
export interface RunTrace {
  generationIds: string[];
  /** The ids, among `generationIds`, of model calls that failed before their usage arrived (a
   *  retried attempt among them, beta-1 D10). The run's `usage` event does not carry their tokens,
   *  so the caller reconciles those from the provider. Absent while every call's usage arrived. */
  uncreditedGenerationIds?: string[];
  /** The request this run serves (`x-whim-request-id`, also its ledger row id). Set by the caller
   *  before the run starts; every run log line carries it as `requestId`. */
  requestId?: string;
  /** Written once, by whichever ending happens first, and never changed after: `'expired'` the
   *  moment the deadline elapses, `'aborted'` the moment the request signal fires (or when the
   *  consumer stops the run without either), `'delivered'`/`'failed'` just before the `result`/
   *  `failure` terminal is yielded. Absent while the run is still going. */
  outcome?: RunTraceOutcome;
  /** Set as a `failure` terminal is yielded: the code for why the run failed, which the usage
   *  ledger stores instead of the terminal's `reason` sentence. Absent for any other ending. */
  failureCode?: TerminalFailureCode;
}

export interface PipelineBounds {
  /** Initial plan + at most this many re-asks (default 2 total). */
  planAttempts: number;
  /** At most this many repair rounds (default 3 — so at most 4 candidates). */
  repairAttempts: number;
  /** How many of `repairAttempts` may be spent chasing a warnings-only candidate (default 1) —
   *  design D6: "a warnings-only candidate consumes at most one repair attempt". */
  warningRepairAttempts: number;
}

export const DEFAULT_BOUNDS: Readonly<PipelineBounds> = Object.freeze({
  planAttempts: 2,
  repairAttempts: 3,
  warningRepairAttempts: 1,
});

export interface GenerationPipelineDeps {
  model: ModelClient;
  roster: ModelRoster;
  /** Loaded once at composition-root time (design D10) — the machine never reads disk itself. */
  promptInputs: PromptInputs;
  check: CheckStage;
  build: BuildStage;
  run: RunStage;
  clock: Clock;
  /** Optional post-run step (spec "A post-run summariser…"). When absent — a fake-driven suite,
   *  a server that runs without one — the `result` event simply carries no summary, which the
   *  contract declares a legitimate state. It is invoked ONLY after a record has been chosen for
   *  delivery, sees no part of that record (`SummariserInput` is record-free), and can neither
   *  fail the run nor delay a terminal event past its own timeout. */
  summariser?: Summariser;
  bounds?: Partial<PipelineBounds>;
  /** The run's total wall-clock budget on `clock`, from the start of the run (`WHIM_GENERATION_MAX_MS`,
   *  default `DEFAULT_MAX_RUN_MS`). A positive integer; anything else throws `RangeError`. */
  maxRunMs?: number;
}

const DEFAULT_MAX_RUN_MS = 600_000;

// ─── Internal helpers ────────────────────────────────────────────────────────

const ZERO_USAGE: Usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

const PLAN_FAILURE_FALLBACK_REASON =
  'This app could not be planned from the request. Try describing it differently.';
const REPAIR_EXHAUSTED_REASON =
  'Could not produce a working app after several attempts. Try describing it differently or more specifically.';
/** Exported — not because a caller resolves reasons by string, but so `machine.suite.ts` can
 *  assert against these directly instead of keeping its own duplicated copy (a reword there used
 *  to fail about a dozen assertions across the file for no behavioral reason). */
export const CONTAINMENT_FAILURE_REASON = 'This app could not be safely run and was not delivered.';
/** The unobserved-verdict reason (design D6, settled copy — verbatim). Deliberately NOT
 *  `CONTAINMENT_FAILURE_REASON`: that sentence asserts a breach we did not observe. This one says
 *  only that we could not verify the run, and points at the device's existing one-tap "Try again"
 *  rather than promising an automatic retry: an unverified candidate is never re-run (design D3).
 *  The run's one automatic retry is a generate or repair turn resent once after a provider failure
 *  (`runModelTurn`, beta-1 D10), which voids that turn's partial output and re-runs no candidate. */
export const UNVERIFIED_RUN_REASON = "We couldn't verify this app ran safely. Please try again.";
export const GENERIC_INTERNAL_ERROR_REASON = 'Something went wrong while generating this app. Please try again.';
/** Design D13, verbatim. */
export const EXPIRED_REASON = 'This took too long to build. Please try again.';
/** A provider `402` (design D6b). Same sentence as the `budget_exhausted` admission refusal hint, so
 *  a device sees one wording whether the budget ran out before admission or mid-run. */
export const CREDIT_EXHAUSTED_REASON = 'Whim has used up its generation budget for now. Try again later.';

function sumUsage(a: Usage, b: Usage): Usage {
  return {
    promptTokens: a.promptTokens + b.promptTokens,
    completionTokens: a.completionTokens + b.completionTokens,
    totalTokens: a.totalTokens + b.totalTokens,
  };
}

type Settled<T> = { ok: true; value: T } | { ok: false; error: unknown };

/** Attach a rejection handler as soon as a model stream is created. The provider rejects its
 *  `usage` promise on the same paths where the delta iterator throws; waiting to observe the
 *  promise until after iteration would leave that rejection unhandled. */
function settle<T>(promise: Promise<T>): Promise<Settled<T>> {
  return promise.then(
    (value) => ({ ok: true, value }),
    (error: unknown) => ({ ok: false, error }),
  );
}

function severityOf(d: Diagnostic): 'error' | 'warning' {
  return d.severity ?? 'error';
}

function hasErrors(diagnostics: readonly Diagnostic[]): boolean {
  return diagnostics.some((d) => severityOf(d) === 'error');
}

const SEVERITY_RANK: Record<'error' | 'warning', number> = { error: 0, warning: 1 };

/** Stable errors-first ordering (spec "Repair asks for a minimal diff… errors before warnings"). */
function errorsFirst(diagnostics: readonly Diagnostic[]): Diagnostic[] {
  return [...diagnostics].sort((a, b) => SEVERITY_RANK[severityOf(a)] - SEVERITY_RANK[severityOf(b)]);
}

/** What to do next given one stage's diagnostics and the current repair budgets (design D6) — the
 *  one place the errors-block / warnings-pursued-at-most-once policy is decided. */
type DiagnosticsDecision =
  | { action: 'proceed' }
  | { action: 'repair'; diagnostics: Diagnostic[]; warningsOnly: boolean }
  | { action: 'failed'; reason: string; code: TerminalFailureCode };

function decideAfterDiagnostics(diagnostics: readonly Diagnostic[], budgets: RepairBudgetsSnapshot): DiagnosticsDecision {
  if (diagnostics.length === 0) return { action: 'proceed' };

  if (hasErrors(diagnostics)) {
    if (budgets.repairsUsed >= budgets.repairAttempts) return { action: 'failed', reason: REPAIR_EXHAUSTED_REASON, code: 'repair_exhausted' };
    return { action: 'repair', diagnostics: errorsFirst(diagnostics), warningsOnly: false };
  }

  const warningBudgetLeft = budgets.warningRepairsUsed < budgets.warningRepairAttempts;
  const repairBudgetLeft = budgets.repairsUsed < budgets.repairAttempts;
  if (warningBudgetLeft && repairBudgetLeft) {
    return { action: 'repair', diagnostics: errorsFirst(diagnostics), warningsOnly: true };
  }
  return { action: 'proceed' };
}

/** Converts a non-`'proceed'` decision into the outcome `processCandidate`/`buildAndRun` return. */
function outcomeFromDecision(decision: Exclude<DiagnosticsDecision, { action: 'proceed' }>): CandidateOutcome {
  if (decision.action === 'repair') {
    return { kind: 'repair', diagnostics: decision.diagnostics, warningsOnly: decision.warningsOnly };
  }
  return { kind: 'failed', reason: decision.reason, code: decision.code };
}

/** One breadcrumb for a `stage` transition — same fields the wire's `stage` event itself carries
 *  (stage name, status, and attempt when present). */
function logStage(state: RunState, stage: string, status: string, attempt?: number): void {
  state.log.info({ stage, status, ...(attempt !== undefined ? { attempt } : {}) }, 'stage');
}

/** Logs a model stream's rejected `usage`/`id` promise at the point it is observed, before the
 *  turn reports the failure — never called from inside the delta iteration loop (design D5 scope). */
function logModelCallFailure(state: RunState, which: 'usage' | 'id', error: unknown): void {
  state.log.error(
    {
      which,
      errorClass: errorClassOf(error),
      detail: error instanceof Error ? error.message : String(error),
    },
    'model call failed',
  );
}

function errorClassOf(error: unknown): string {
  return error instanceof Error ? error.constructor.name : typeof error;
}

/** How many times a generate or repair turn is resent after an upstream failure (beta-1 D10). */
const MODEL_TURN_RETRIES = 1;

/** One model call's ending: its text, or the error it failed with and whether it had already
 *  streamed `token` events (which a resend has to void with `restart`). */
type TurnAttempt =
  | { ok: true; text: string; aborted: boolean }
  | { ok: false; error: unknown; yieldedTokens: boolean };

/** A failed call, with its generation id recorded as uncredited: its usage never arrived, so the
 *  run's `usage` event cannot carry its tokens (`RunTrace.uncreditedGenerationIds`). An aborted
 *  call records nothing more: an aborted run emits no `usage`, so every id is reconciled anyway. */
async function failedAttempt(
  error: unknown,
  yieldedTokens: boolean,
  idResult: Promise<Settled<string | undefined>>,
  signal: AbortSignal | undefined,
  trace: RunTrace | undefined,
): Promise<TurnAttempt> {
  if (!signal?.aborted && trace) {
    const settledId = await idResult;
    if (settledId.ok && settledId.value !== undefined) {
      trace.uncreditedGenerationIds ??= [];
      trace.uncreditedGenerationIds.push(settledId.value);
    }
  }
  return { ok: false, error, yieldedTokens };
}

/** The wire's applied schema, structurally narrowed to the engine's type. The field is a free-form
 *  record on the wire, so a shape `burnedIdFloor` cannot read yields `undefined` — the JSON is
 *  still rendered, only the numeric floors are dropped. */
function asAppliedSchema(raw: Record<string, unknown>): AppliedSchema | undefined {
  const collections = raw.collections;
  if (!Array.isArray(collections)) return undefined;
  const readable = collections.every(
    (c) =>
      typeof c === 'object' &&
      c !== null &&
      typeof (c as AppliedSchema['collections'][number]).id === 'string' &&
      Array.isArray((c as AppliedSchema['collections'][number]).active) &&
      Array.isArray((c as AppliedSchema['collections'][number]).retired),
  );
  return readable ? (raw as unknown as AppliedSchema) : undefined;
}

/**
 * The burned-ID context both code-writing turns carry (spec "Generation allocates burned field IDs
 * above the accumulated floor"). The floor is STATED numerically per collection and computed with
 * the storage engine's exported `burnedIdFloor` — the checker's own definition, never re-derived
 * here, so the prompt cannot teach a floor the check would not enforce.
 *
 * It asks the model to KEEP the existing IDs and to allocate above the floor; it deliberately does
 * NOT say "do not reuse these IDs", which read as "avoid c1/f1" — the precise opposite of what
 * preserves the user's rows (design D9).
 */
function schemaContextFor(request: GenerateRequest): string {
  const appliedSchema = request.app?.appliedSchema;
  if (!appliedSchema || Object.keys(appliedSchema).length === 0) return '';
  const applied = asAppliedSchema(appliedSchema);
  const floors = applied ? burnedIdFloor(applied) : {};
  return [
    `Applied schema (the storage identities the user's existing data already lives under): ${JSON.stringify(appliedSchema)}`,
    ...Object.entries(floors).map(
      ([collectionId, floor]) =>
        `- collection "${collectionId}": new field IDs start above ${floor} (the next free ID is "f${floor + 1}").`,
    ),
    'Keep the existing collection and field IDs for every concept that already has one — the ' +
      "user's rows are stored under those IDs, and a different ID is a different, empty column. " +
      "Allocate a NEW ID only for a genuinely new concept, strictly above that collection's floor.",
  ].join('\n');
}

/** The edit turn's storage-location list: one line per location the source being edited names,
 *  rendered from the run's single `scanStorageSurface` result. Empty (no section rendered) when
 *  there is no surface, or when the source names no location at all. */
function storageSurfaceFor(surface: StorageSurface | undefined): string {
  if (!surface) return '';
  return [
    ...surface.kvKeys.map((ref) => `- kv key "${ref.name}"`),
    ...surface.collections.map((ref) => `- record collection "${ref.name}"`),
  ].join('\n');
}

/**
 * Everything derived ONCE per run from the pre-flighted request and threaded to every consumer
 * (design D3). `previousSurface` goes to the check stage as its drift baseline and `storageSurface`
 * is the same scan rendered for the prompts — one scanner, two consumers, so the harness can never
 * teach one set of locations and enforce another.
 */
interface EditContext {
  schemaContext: string;
  storageSurface: string;
  previousSurface?: StorageSurface;
}

function editContextFor(request: GenerateRequest): EditContext {
  // `app.source` is already pre-flighted by the composition root, so it is either real source or
  // absent; an absent one yields no surface, which is exactly "unconstrained".
  const source = request.app?.source;
  const previousSurface = source !== undefined ? scanStorageSurface(source) : undefined;
  return {
    schemaContext: schemaContextFor(request),
    storageSurface: storageSurfaceFor(previousSurface),
    previousSurface,
  };
}

function hostTimer(delayMs: number, onFire: () => void): () => void {
  const timer = setTimeout(onFire, delayMs);
  timer.unref?.();
  return () => clearTimeout(timer);
}

/**
 * One run's wall-clock budget and end-cause bookkeeping (design D13). `signal` is the run's own
 * abort signal, linked to the request signal: every stage, model call, and synthetic run receives
 * it, so the deadline tears down in-flight work exactly the way a client abort does.
 *
 * The deadline stays armed until the run begins its completion envelope (`beginCompletion`). From
 * then on only a client abort can stop the run, so a deadline can never cut between the `usage`
 * event and its terminal and cause a second envelope.
 */
class RunBudget {
  private readonly controller = new AbortController();
  private deadlineArmed = false;
  private disarmTimer: (() => void) | undefined;
  private outcome: RunTraceOutcome | undefined;

  constructor(
    clock: Clock,
    maxRunMs: number,
    private readonly requestSignal: AbortSignal | undefined,
    private readonly trace: RunTrace | undefined,
    private readonly runLogger: ServerLogger,
  ) {
    if (requestSignal?.aborted) {
      this.onRequestAbort();
      return;
    }
    requestSignal?.addEventListener('abort', this.onRequestAbort, { once: true });
    this.deadlineArmed = true;
    this.disarmTimer = clock.setTimer ? clock.setTimer(maxRunMs, this.onDeadline) : hostTimer(maxRunMs, this.onDeadline);
  }

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  /** The deadline elapsed first: the stages were stopped before any terminal was committed to. */
  get expired(): boolean {
    return this.outcome === 'expired';
  }

  /** Called as the completion envelope starts, after its abort check passed. */
  beginCompletion(): void {
    this.disarmDeadline();
  }

  /** Records `delivered`/`failed` just before the terminal is yielded. A no-op for the outcome when
   *  the run already has one: the expiry failure keeps `expired`. A failure's code is recorded
   *  either way, since it is the one terminal the run yields. */
  recordTerminal(outcome: 'delivered' | 'failed', failureCode?: TerminalFailureCode): void {
    this.record(outcome);
    if (failureCode !== undefined && this.trace) this.trace.failureCode = failureCode;
  }

  /** The run's generator is finishing: disarm, unlink, and name a run that stopped without any
   *  recorded ending (the consumer returned early) as aborted. */
  dispose(): void {
    this.disarmDeadline();
    this.requestSignal?.removeEventListener('abort', this.onRequestAbort);
    this.record('aborted');
  }

  private readonly onDeadline = (): void => {
    if (!this.deadlineArmed) return;
    this.deadlineArmed = false;
    this.disarmTimer = undefined;
    if (!this.record('expired')) return;
    this.runLogger.info('run expired');
    this.controller.abort();
  };

  private readonly onRequestAbort = (): void => {
    this.disarmDeadline();
    this.record('aborted');
    this.controller.abort();
  };

  private disarmDeadline(): void {
    if (!this.deadlineArmed) return;
    this.deadlineArmed = false;
    this.disarmTimer?.();
    this.disarmTimer = undefined;
  }

  /** First ending wins; returns whether this call was it. */
  private record(outcome: RunTraceOutcome): boolean {
    if (this.outcome !== undefined) return false;
    this.outcome = outcome;
    if (this.trace) this.trace.outcome = outcome;
    return true;
  }
}

/** Mutable per-run accumulator threaded through every phase. */
interface RunState {
  usage: Usage;
  diagnostics: Diagnostic[];
  candidatesProduced: number;
  budget: RunBudget;
  /** The run's logger (`runLogFor`) — every run line goes through it. */
  log: ServerLogger;
  /** The logger model calls and the summariser receive (`modelLogFor`). */
  modelLog: ServerLogger | undefined;
}

interface RepairBudgetsSnapshot {
  repairsUsed: number;
  warningRepairsUsed: number;
  repairAttempts: number;
  warningRepairAttempts: number;
}

type CandidateOutcome =
  | { kind: 'aborted' }
  | { kind: 'deliver'; record: WireAppRecord }
  | { kind: 'repair'; diagnostics: Diagnostic[]; warningsOnly: boolean }
  | { kind: 'failed'; reason: string; code: TerminalFailureCode }
  | { kind: 'contained-failure'; verdict: RunVerdict }
  | { kind: 'containment-unobserved'; verdict: RunVerdict };

/** Maps a non-affirmative containment verdict onto its own terminal outcome — the one place the
 *  three-valued verdict is turned into a candidate outcome. An exhaustive `switch` over the
 *  verdict's literal type (design D8-local): `contained` is the discriminant, so a fourth
 *  `RunOutcome` arm makes this a compile error at the call site instead of silently reusing one of
 *  these two. Never collapse the two — `null` is absence of evidence, `false` is evidence. */
function unverifiedRunOutcome(outcome: Exclude<RunOutcome, { contained: true }>): CandidateOutcome {
  switch (outcome.contained) {
    case false:
      return { kind: 'contained-failure', verdict: outcome.verdict };
    case null:
      return { kind: 'containment-unobserved', verdict: outcome.verdict };
  }
}

type FailureEvent = Extract<GenerationEvent, { type: 'failure' }>;

/** A run's one terminal: a `result`, or a `failure` with the code the ledger records for it and,
 *  for a containment ending, the verdict its log line names. */
type Completion =
  | { terminal: Extract<GenerationEvent, { type: 'result' }>; code?: never; verdict?: never }
  | { terminal: FailureEvent; code: TerminalFailureCode; verdict?: RunVerdict };

/** The `failure` terminal each run-ending, non-delivering candidate outcome produces — the one
 *  place a `reason` is chosen. An exhaustive `switch`, so a new terminal outcome cannot be added
 *  without deciding what the user is told; and each arm decides its `diagnostics` independently.
 *  Both containment terminals send `[]`: nothing about an escape attempt, and no unobserved-verdict
 *  detail, is ever fed back (spec "The run stage is the synthetic harness…"). */
function failureTerminalFor(
  outcome: Extract<CandidateOutcome, { kind: 'failed' | 'contained-failure' | 'containment-unobserved' }>,
  state: RunState,
): Completion {
  const attempts = state.candidatesProduced;
  switch (outcome.kind) {
    case 'contained-failure':
      return {
        terminal: { type: 'failure', reason: CONTAINMENT_FAILURE_REASON, attempts, diagnostics: [] },
        code: 'containment_failed',
        verdict: outcome.verdict,
      };
    // Terminal on the same terms as a containment failure — an unverified run is not a candidate to
    // iterate on — but with its OWN reason (design D3/D6). No repair attempt is consumed, no repair
    // prompt is built, and the candidate is never re-run.
    case 'containment-unobserved':
      return {
        terminal: { type: 'failure', reason: UNVERIFIED_RUN_REASON, attempts, diagnostics: [] },
        code: 'run_unverified',
        verdict: outcome.verdict,
      };
    case 'failed':
      return { terminal: { type: 'failure', reason: outcome.reason, attempts, diagnostics: state.diagnostics }, code: outcome.code };
  }
}

/** Whether the delivered source is byte-identical to the source the request started from
 *  (beta-1 D13). A request without `app.source` gives nothing to compare with. */
function sourceChangeOf(request: GenerateRequest, record: WireAppRecord): SourceChange {
  const before = request.app?.source;
  if (before === undefined) return 'unknown';
  return record.source === before ? 'unchanged' : 'changed';
}

/** A summary may say the app did not change only when its source did not (beta-1 D13, #106);
 *  anywhere else that claim is replaced by the neutral line. */
function honestSummary(summary: RunSummary | undefined, input: SummariserInput, state: RunState): RunSummary | undefined {
  if (summary === undefined || input.sourceChange === 'unchanged' || !claimsNoChange(summary.text)) return summary;
  state.log.info({ sourceChange: input.sourceChange }, 'no-change summary replaced');
  return neutralSummary(input);
}

// ─── The machine ─────────────────────────────────────────────────────────────

export class GenerationMachine {
  private readonly deps: GenerationPipelineDeps;
  private readonly bounds: PipelineBounds;
  private readonly maxRunMs: number;

  constructor(deps: GenerationPipelineDeps) {
    this.deps = deps;
    this.bounds = { ...DEFAULT_BOUNDS, ...deps.bounds };
    this.maxRunMs = deps.maxRunMs ?? DEFAULT_MAX_RUN_MS;
    if (!Number.isSafeInteger(this.maxRunMs) || this.maxRunMs <= 0) {
      throw new RangeError(`maxRunMs must be a positive integer, got ${String(deps.maxRunMs)}`);
    }
  }

  /** `signal`, when provided, is honored at every state boundary (spec "Cancellation aborts the
   *  pipeline at every boundary"): on abort the returned generator stops without a terminal event.
   *  `trace`, when provided, receives every model call's provider generation id as it resolves
   *  (design D9) and the run's `outcome` once it ends (design D13). */
  run(request: GenerateRequest, signal?: AbortSignal, trace?: RunTrace): AsyncIterable<GenerationEvent> {
    return this.runGenerator(request, signal, trace);
  }

  private async *runGenerator(
    request: GenerateRequest,
    signal?: AbortSignal,
    trace?: RunTrace,
  ): AsyncGenerator<GenerationEvent> {
    const runLogger = runLogFor(trace);
    const budget = new RunBudget(this.deps.clock, this.maxRunMs, signal, trace, runLogger);
    try {
      if (budget.signal.aborted) return;
      const state: RunState = { usage: ZERO_USAGE, diagnostics: [], candidatesProduced: 0, budget, log: runLogger, modelLog: modelLogFor(trace) };
      yield* this.runStages(request, budget.signal, trace, state);
      // The deadline stopped the stages, which emitted nothing further. Unlike a client abort, this
      // still ends as a completed run. Its abort checks read the REQUEST signal, because the run
      // signal was aborted by the expiry itself.
      if (budget.expired) {
        yield* this.emitCompletion(state, signal, {
          terminal: { type: 'failure', reason: EXPIRED_REASON, attempts: state.candidatesProduced, diagnostics: state.diagnostics },
          code: 'expired',
        });
      }
    } finally {
      budget.dispose();
    }
  }

  private async *runStages(
    request: GenerateRequest,
    signal: AbortSignal,
    trace: RunTrace | undefined,
    state: RunState,
  ): AsyncGenerator<GenerationEvent, void> {
    state.log.info('run start');
    try {
      const edit = editContextFor(request);

      const plan = yield* this.runPlanPhase(request, edit, signal, trace, state);
      if (!plan) return;
      if (signal.aborted) return;

      const source = yield* this.runGeneratePhase(request, plan, edit, signal, trace, state);
      if (source === undefined) return;

      yield* this.runRepairLoop(request, plan, edit, source, signal, trace, state);
    } catch (err) {
      yield* this.endOnThrow(err, signal, state);
    }
  }

  /** A stage or model call threw. Stops quietly when the run was already aborted or expired;
   *  otherwise ends in one failure. A provider `402` gets its own reason and no repair, since a
   *  repair spends more of a budget that is already gone (design D6b). */
  private async *endOnThrow(err: unknown, signal: AbortSignal, state: RunState): AsyncGenerator<GenerationEvent, void> {
    const creditExhausted = isCreditExhaustedError(err);
    // Authoritative even when an abort or the deadline got there first: the next admission must
    // re-query the credit rather than trust the cached value.
    if (creditExhausted) invalidateCreditCache();
    if (signal.aborted) return;
    state.log.error(
      {
        errorClass: err instanceof Error ? err.constructor.name : typeof err,
        detail: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      },
      creditExhausted ? 'provider credit exhausted' : 'run failed',
    );
    yield* this.emitCompletion(state, signal, {
      terminal: {
        type: 'failure',
        reason: creditExhausted ? CREDIT_EXHAUSTED_REASON : GENERIC_INTERNAL_ERROR_REASON,
        attempts: state.candidatesProduced,
        diagnostics: state.diagnostics,
      },
      code: creditExhausted ? 'credit_exhausted' : 'internal_error',
    });
  }

  /** The one completion envelope: usage immediately before the terminal, with the abort check
   *  between those two externally-observable events so cancellation can never leak a terminal.
   *  Passing the first check commits the run to this envelope, so the deadline is disarmed here. */
  private async *emitCompletion(
    state: RunState,
    signal: AbortSignal | undefined,
    { terminal, code, verdict }: Completion,
  ): AsyncGenerator<GenerationEvent, void> {
    if (signal?.aborted) return;
    state.budget.beginCompletion();
    yield { type: 'usage', usage: state.usage };
    if (signal?.aborted) return;
    state.budget.recordTerminal(terminal.type === 'result' ? 'delivered' : 'failed', code);
    if (terminal.type === 'failure') {
      // The closed code, never `terminal.reason`: a plan_failed sentence quotes model-written
      // screen names that echo the prompt, and this line ships to Cloud Logging. The field is
      // `reason` because the logger redacts any field named `code`. A containment ending adds its
      // content-free verdict (beta-1 D11): two closed-vocabulary values, nothing the candidate wrote.
      state.log.info({ reason: code, ...(verdict ? { verdict: verdict.kind, check: verdict.check } : {}) }, 'terminal failure');
    } else {
      state.log.info('terminal result');
    }
    yield terminal;
  }

  /** Calls the model for one turn (plan, generate, or a repair round), accumulating usage/trace,
   *  and — when `emitTokens` — streaming `token` events (spec: only `generate` and a `repair`
   *  stream tokens; `plan` does not). `roleSetting` is the caller's own roster entry (`roster.plan`
   *  or `roster.engineer`) and `label` attributes the call (design D4) — every call site decides
   *  both, never this shared helper. Reasoning deltas surface as `thinking` events (length only,
   *  never the reasoning text) in EVERY turn regardless of `emitTokens`, whenever the role's own
   *  reasoning setting actually streams one: the device needs to know the model is working during
   *  the plan turn just as much as during generate/repair — it is the silent one otherwise.
   *
   *  A generate or repair turn that fails upstream (`isUpstreamModelFailure`: 5xx, 429, network or
   *  stream error) is sent once more with the same messages (beta-1 D10). When the failed attempt
   *  had already streamed `token` events, `restart` goes first, so the device voids them. Any other
   *  failure, a failure after the run was stopped, and the resend's own failure are thrown to
   *  `endOnThrow` exactly as before. */
  private async *runModelTurn(
    messages: ModelMessage[],
    roleSetting: RoleSetting,
    label: ModelCallLabel,
    signal: AbortSignal | undefined,
    trace: RunTrace | undefined,
    state: RunState,
    emitTokens: boolean,
  ): AsyncGenerator<GenerationEvent, { text: string; aborted: boolean }> {
    const retries = label === 'generate' || label === 'repair' ? MODEL_TURN_RETRIES : 0;
    for (let resends = 0; ; resends++) {
      const turn = yield* this.streamModelTurn(messages, roleSetting, label, signal, trace, state, emitTokens);
      if (turn.ok) return { text: turn.text, aborted: turn.aborted };
      if (resends >= retries || signal?.aborted || !isUpstreamModelFailure(turn.error)) throw turn.error;
      state.log.info({ role: label, errorClass: errorClassOf(turn.error), restart: turn.yieldedTokens }, 'model turn retried');
      if (turn.yieldedTokens) yield { type: 'restart' };
    }
  }

  /** One model call of a turn: `runModelTurn`'s stream consumption, reporting a failure instead of
   *  throwing it so the turn can decide whether to resend. */
  private async *streamModelTurn(
    messages: ModelMessage[],
    roleSetting: RoleSetting,
    label: ModelCallLabel,
    signal: AbortSignal | undefined,
    trace: RunTrace | undefined,
    state: RunState,
    emitTokens: boolean,
  ): AsyncGenerator<GenerationEvent, TurnAttempt> {
    const stream = this.deps.model.stream(
      { model: roleSetting.model, messages, reasoning: roleSetting.reasoning, role: label, logger: state.modelLog },
      signal,
    );
    const usageResult = settle(stream.usage);
    const idResult = settle(stream.id).then((result) => {
      // Start observing the id immediately, rather than after the delta stream completes. The id
      // resolves from the provider's first frame, and aborted-run reconciliation depends on the
      // out-parameter already containing it when cancellation stops this generator (design D9).
      if (result.ok && result.value !== undefined && trace) trace.generationIds.push(result.value);
      return result;
    });
    let text = '';
    let yieldedTokens = false;
    try {
      for await (const delta of stream.deltas) {
        if (signal?.aborted) return { ok: true, text, aborted: true };
        if (delta.kind === 'reasoning') {
          yield { type: 'thinking', chars: delta.text.length };
          continue;
        }
        text += delta.text;
        if (emitTokens) {
          yieldedTokens = true;
          yield { type: 'token', text: delta.text };
        }
      }
    } catch (error) {
      return failedAttempt(error, yieldedTokens, idResult, signal, trace);
    }
    if (signal?.aborted) return { ok: true, text, aborted: true };
    const settledUsage = await usageResult;
    if (!settledUsage.ok) {
      logModelCallFailure(state, 'usage', settledUsage.error);
      return failedAttempt(settledUsage.error, yieldedTokens, idResult, signal, trace);
    }
    state.usage = sumUsage(state.usage, settledUsage.value);
    const settledId = await idResult;
    if (!settledId.ok) {
      logModelCallFailure(state, 'id', settledId.error);
      return { ok: false, error: settledId.error, yieldedTokens };
    }
    return { ok: true, text, aborted: signal?.aborted ?? false };
  }

  private resolvePlan(text: string, request: GenerateRequest): { plan?: Plan; failureReason?: string } {
    const parsed = parsePlan(text);
    if (!parsed.ok) return { failureReason: parsed.reason };
    const validation = validatePlan(parsed.plan, request);
    if (!validation.ok) return { failureReason: validation.reason };
    return { plan: parsed.plan };
  }

  /** The `PLAN` state, including its own re-ask loop (design D4, at most `bounds.planAttempts`
   *  total). Emits its own `failure` terminal on exhaustion; returns `undefined` for BOTH an
   *  abort and an already-emitted exhaustion failure — either way the caller simply stops. */
  private async *runPlanPhase(
    request: GenerateRequest,
    edit: EditContext,
    signal: AbortSignal | undefined,
    trace: RunTrace | undefined,
    state: RunState,
  ): AsyncGenerator<GenerationEvent, Plan | undefined> {
    let priorFailureReason: string | undefined;

    for (let attempt = 1; attempt <= this.bounds.planAttempts; attempt++) {
      if (signal?.aborted) return undefined;
      logStage(state, 'plan', 'start');
      yield { type: 'stage', stage: 'plan', status: 'start' };
      if (signal?.aborted) return undefined;

      const messages = buildPlanMessages({
        request,
        schemaContext: edit.schemaContext,
        storageSurface: edit.storageSurface,
        priorFailureReason,
      });
      const turn = yield* this.runModelTurn(messages, this.deps.roster.plan, 'plan', signal, trace, state, false);
      if (turn.aborted) return undefined;

      const { plan, failureReason } = this.resolvePlan(turn.text, request);

      logStage(state, 'plan', 'done');
      yield { type: 'stage', stage: 'plan', status: 'done' };
      if (signal?.aborted) return undefined;

      if (plan) return plan;

      priorFailureReason = failureReason;
      if (attempt === this.bounds.planAttempts) {
        yield* this.emitCompletion(state, signal, {
          terminal: { type: 'failure', reason: failureReason ?? PLAN_FAILURE_FALLBACK_REASON, attempts: 0, diagnostics: [] },
          code: 'plan_failed',
        });
        return undefined;
      }
    }
    return undefined;
  }

  /** The `GENERATE` state — always the initial round, never carries `attempt`. */
  private async *runGeneratePhase(
    request: GenerateRequest,
    plan: Plan,
    edit: EditContext,
    signal: AbortSignal | undefined,
    trace: RunTrace | undefined,
    state: RunState,
  ): AsyncGenerator<GenerationEvent, string | undefined> {
    logStage(state, 'generate', 'start');
    yield { type: 'stage', stage: 'generate', status: 'start' };
    if (signal?.aborted) return undefined;

    const messages = buildGenerateMessages(
      { request, plan, schemaContext: edit.schemaContext, storageSurface: edit.storageSurface },
      this.deps.promptInputs,
    );
    const turn = yield* this.runModelTurn(messages, this.deps.roster.engineer, 'generate', signal, trace, state, true);
    if (turn.aborted) return undefined;

    logStage(state, 'generate', 'done');
    yield { type: 'stage', stage: 'generate', status: 'done' };
    if (signal?.aborted) return undefined;

    state.candidatesProduced = 1;
    return unwrapSourceFence(turn.text);
  }

  /** One `REPAIR` round: prompts with the minimal-diff instructions plus the round's diagnostics
   *  (errors first, verbatim), and produces a full replacement candidate (never a patch). */
  private async *runRepairRound(
    request: GenerateRequest,
    plan: Plan,
    edit: EditContext,
    currentSource: string,
    diagnostics: Diagnostic[],
    roundAttempt: number,
    signal: AbortSignal | undefined,
    trace: RunTrace | undefined,
    state: RunState,
  ): AsyncGenerator<GenerationEvent, string | undefined> {
    logStage(state, 'repair', 'start', roundAttempt);
    yield { type: 'stage', stage: 'repair', status: 'start', attempt: roundAttempt };
    if (signal?.aborted) return undefined;

    const messages = buildRepairMessages(
      {
        request,
        plan,
        currentSource,
        diagnostics,
        schemaContext: edit.schemaContext,
        storageSurface: edit.storageSurface,
      },
      this.deps.promptInputs,
    );
    const turn = yield* this.runModelTurn(messages, this.deps.roster.repair, 'repair', signal, trace, state, true);
    if (turn.aborted) return undefined;

    logStage(state, 'repair', 'done', roundAttempt);
    yield { type: 'stage', stage: 'repair', status: 'done', attempt: roundAttempt };
    if (signal?.aborted) return undefined;

    state.candidatesProduced += 1;
    return unwrapSourceFence(turn.text);
  }

  /** `CHECK` → `(BUILD →) RUN`, with the `REPAIR` loop (design D4/D6/D7). Runs until the machine
   *  reaches a terminal outcome (delivered, failed, or an abort — no terminal event on abort). */
  private async *runRepairLoop(
    request: GenerateRequest,
    plan: Plan,
    edit: EditContext,
    initialSource: string,
    signal: AbortSignal | undefined,
    trace: RunTrace | undefined,
    state: RunState,
  ): AsyncGenerator<GenerationEvent, void> {
    let source = initialSource;
    let repairsUsed = 0;
    let warningRepairsUsed = 0;
    let roundAttempt: number | undefined;

    for (;;) {
      const budgets: RepairBudgetsSnapshot = {
        repairsUsed,
        warningRepairsUsed,
        repairAttempts: this.bounds.repairAttempts,
        warningRepairAttempts: this.bounds.warningRepairAttempts,
      };
      const outcome = yield* this.processCandidate(source, request, edit, roundAttempt, signal, state, budgets);

      if (outcome.kind === 'aborted') return;

      if (outcome.kind === 'deliver') {
        yield* this.emitDelivery(request, outcome.record, state, signal);
        return;
      }
      if (outcome.kind !== 'repair') {
        yield* this.emitCompletion(state, signal, failureTerminalFor(outcome, state));
        return;
      }

      const kindCounts: Record<string, number> = {};
      for (const d of outcome.diagnostics) kindCounts[d.kind] = (kindCounts[d.kind] ?? 0) + 1;
      state.log.info({ kindCounts, warningsOnly: outcome.warningsOnly }, 'repair triggered');

      repairsUsed += 1;
      if (outcome.warningsOnly) warningRepairsUsed += 1;
      roundAttempt = repairsUsed;

      const repaired = yield* this.runRepairRound(
        request,
        plan,
        edit,
        source,
        outcome.diagnostics,
        roundAttempt,
        signal,
        trace,
        state,
      );
      if (repaired === undefined) return;
      source = repaired;
    }
  }

  /** Summarise, then deliver: the summariser runs between the delivery decision and the terminal
   *  event, so its token spend lands inside the `usage` event that immediately precedes `result`. */
  private async *emitDelivery(
    request: GenerateRequest,
    record: WireAppRecord,
    state: RunState,
    signal: AbortSignal | undefined,
  ): AsyncGenerator<GenerationEvent, void> {
    const summary = await this.summariseDelivery(request, record, state, signal);
    yield* this.emitCompletion(state, signal, {
      terminal: { type: 'result', app: record, ...(summary ? { summary } : {}) },
    });
  }

  /**
   * The post-run summariser (spec "A post-run summariser…"). Called once, only for a record that
   * is already going to be delivered, and never allowed to change that: it is handed copied
   * primitives (no record, no manifest object, no bundle), its token spend is folded into the run's
   * usage before the `usage` event, and ANY failure — a rejection, a timeout, unusable prose —
   * yields `undefined`, so the run still emits its `result` with the summary simply absent. No
   * stage event narrates it: it is not a stage, and the enum is not widened. The one thing a
   * summariser failure DOES change outside itself is the credit cache: a `402` here means the
   * provider credit is gone, and `invalidateCreditCache()` runs for it exactly as it does for a
   * `402` on any other model call.
   */
  private async summariseDelivery(
    request: GenerateRequest,
    record: WireAppRecord,
    state: RunState,
    signal: AbortSignal | undefined,
  ): Promise<RunSummary | undefined> {
    const summariser = this.deps.summariser;
    if (!summariser || signal?.aborted) return undefined;
    const capabilities = record.manifest.capabilities;
    const input: SummariserInput = {
      prompt: request.prompt,
      isEdit: request.app !== undefined,
      appName: record.name,
      capabilities: Array.isArray(capabilities) ? capabilities.filter((c): c is string => typeof c === 'string') : [],
      attempts: state.candidatesProduced,
      diagnostics: [...state.diagnostics],
      sourceChange: sourceChangeOf(request, record),
    };
    try {
      const result = await summariser.summarise(input, signal, state.modelLog);
      if (result.usage) state.usage = sumUsage(state.usage, result.usage);
      return honestSummary(result.summary, input, state);
    } catch (err) {
      // The summariser's failure still cannot fail the run — but a `402` is authoritative about
      // the operator's credit wherever it is raised, so the next admission must re-query rather
      // than trust a cached value (the same invalidation `endOnThrow` performs).
      if (isCreditExhaustedError(err)) invalidateCreditCache();
      state.log.error(
        {
          errorClass: err instanceof Error ? err.constructor.name : typeof err,
          detail: err instanceof Error ? err.message : String(err),
        },
        'summariser failed',
      );
      return undefined;
    }
  }

  /** Streams each diagnostic as it is observed, then the stage's `done` event — the shared tail
   *  of both `CHECK` and `RUN` (build failures included). */
  private async *emitDiagnosticsAndDone(
    diagnostics: readonly Diagnostic[],
    stage: 'check' | 'run',
    attemptField: { attempt?: number },
    state: RunState,
    signal: AbortSignal | undefined,
  ): AsyncGenerator<GenerationEvent, void> {
    for (const d of diagnostics) {
      if (signal?.aborted) return;
      state.diagnostics.push(d);
      yield { type: 'diagnostic', diagnostic: d };
      if (signal?.aborted) return;
    }
    if (signal?.aborted) return;
    logStage(state, stage, 'done', attemptField.attempt);
    yield { type: 'stage', stage, status: 'done', ...attemptField };
  }

  /** `CHECK`, then — when it is clean or a warnings-only budget says "proceed" — `BUILD` and `RUN`
   *  folded into the wire's single `run` stage bracket (the `stage` enum has no `build` member).
   *  Decides the next transition; never emits a terminal event itself. */
  private async *processCandidate(
    source: string,
    request: GenerateRequest,
    edit: EditContext,
    roundAttempt: number | undefined,
    signal: AbortSignal | undefined,
    state: RunState,
    budgets: RepairBudgetsSnapshot,
  ): AsyncGenerator<GenerationEvent, CandidateOutcome> {
    const attemptField = roundAttempt !== undefined ? { attempt: roundAttempt } : {};

    logStage(state, 'check', 'start', attemptField.attempt);
    yield { type: 'stage', stage: 'check', status: 'start', ...attemptField };
    if (signal?.aborted) return { kind: 'aborted' };
    const checkReport = await this.deps.check.check(
      source,
      { appliedSchema: request.app?.appliedSchema, previousSurface: edit.previousSurface },
      signal,
    );
    if (signal?.aborted) return { kind: 'aborted' };
    yield* this.emitDiagnosticsAndDone(checkReport.diagnostics, 'check', attemptField, state, signal);
    if (signal?.aborted) return { kind: 'aborted' };

    const decision = decideAfterDiagnostics(checkReport.diagnostics, budgets);
    if (decision.action !== 'proceed') return outcomeFromDecision(decision);

    return yield* this.buildAndRun(
      source,
      checkReport,
      signal,
      state,
      budgets,
      attemptField,
      [...checkReport.diagnostics],
    );
  }

  private async *buildAndRun(
    source: string,
    checkReport: CheckReport,
    signal: AbortSignal | undefined,
    state: RunState,
    budgets: RepairBudgetsSnapshot,
    attemptField: { attempt?: number },
    roundDiagnostics: Diagnostic[],
  ): AsyncGenerator<GenerationEvent, CandidateOutcome> {
    logStage(state, 'run', 'start', attemptField.attempt);
    yield { type: 'stage', stage: 'run', status: 'start', ...attemptField };
    if (signal?.aborted) return { kind: 'aborted' };
    const buildOutcome = await this.deps.build.build(source, signal);
    if (signal?.aborted) return { kind: 'aborted' };

    if (!buildOutcome.ok) {
      yield* this.emitDiagnosticsAndDone([buildOutcome.diagnostic], 'run', attemptField, state, signal);
      if (signal?.aborted) return { kind: 'aborted' };
      roundDiagnostics.push(buildOutcome.diagnostic);
      return budgets.repairsUsed < budgets.repairAttempts
        ? { kind: 'repair', diagnostics: errorsFirst(roundDiagnostics), warningsOnly: false }
        : { kind: 'failed', reason: REPAIR_EXHAUSTED_REASON, code: 'repair_exhausted' };
    }

    const runOutcome = await this.deps.run.run(
      { source, manifest: checkReport.manifest, build: buildOutcome.result },
      signal,
    );
    if (signal?.aborted) return { kind: 'aborted' };

    // Only an affirmative verdict proceeds. `!runOutcome.contained` would be true for BOTH `false`
    // and `null` and would report an unverified run as a containment failure; `=== false` alone
    // would let `null` fall through to delivery. Both non-`true` verdicts still emit the `run`
    // stage's `done` half — the bracket the wire opened above always closes — and neither streams a
    // `diagnostic` event.
    if (runOutcome.contained !== true) {
      logStage(state, 'run', 'done', attemptField.attempt);
      yield { type: 'stage', stage: 'run', status: 'done', ...attemptField };
      return unverifiedRunOutcome(runOutcome);
    }

    yield* this.emitDiagnosticsAndDone(runOutcome.diagnostics, 'run', attemptField, state, signal);
    if (signal?.aborted) return { kind: 'aborted' };

    roundDiagnostics.push(...runOutcome.diagnostics);
    const decision = decideAfterDiagnostics(roundDiagnostics, budgets);
    if (decision.action !== 'proceed') return outcomeFromDecision(decision);
    return { kind: 'deliver', record: runOutcome.record };
  }
}
