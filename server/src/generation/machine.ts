/**
 * server/src/generation/machine.ts — the bounded generation state machine (design D2, D4-D9, D11;
 * spec "The pipeline is a bounded state machine", "Stage events narrate the machine over the
 * existing contract", "Exactly one terminal event per completed run", "The plan is structured and
 * validated against the request", "Repair asks for a minimal diff with the diagnostics in context",
 * "Cancellation aborts the pipeline at every boundary"). Depends on nothing concrete: `CheckStage`,
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
import { burnedIdFloor } from '../../../src/host/storage-engine/schema';
import type { AppliedSchema } from '../../../src/host/storage-engine/schema';
import type { ModelClient, ModelMessage, ModelRoster } from './model';
import type { PromptInputs } from './prompts/inputs';
import { buildGenerateMessages, buildPlanMessages, buildRepairMessages } from './prompts';
import { type Plan, parsePlan, validatePlan } from './plan';
import type { Summariser } from './summarise';
import { log } from '../logger';

/** Per-run pipeline breadcrumbs — run start, stage transitions, model-call failures, repair
 *  triggers and terminal outcomes — as one child logger carrying its scope as a field. Everything
 *  variable is a NAMED FIELD, never interpolated into the message, and the root logger's `redact`
 *  config is what keeps prompt text / generated source / the API key out of these records: it is
 *  enforced at the serializer, not by a rule a future author has to remember.
 *
 *  Nothing here is called from inside a delta-iteration or token-emission loop. */
const runLog = log.child({ scope: 'run' });

// ─── Injected stage interfaces (design D2) ──────────────────────────────────

/** Reserved for stage-duration instrumentation (design D2's deps object). The machine does not
 *  branch on it today — a fake in tests may return any value. */
export interface Clock {
  now(): number;
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
  | { contained: false; diagnostics: Diagnostic[] }
  | { contained: null; diagnostics: Diagnostic[] }
  | { contained: true; diagnostics: Diagnostic[]; record: WireAppRecord };

export interface RunStage {
  run(input: RunInput, signal?: AbortSignal): Promise<RunOutcome> | RunOutcome;
}

/** A deliberately dumb out-parameter (design D9): the machine appends each model call's provider
 *  generation id as it resolves. A stub that ignores it stays conforming. */
export interface RunTrace {
  generationIds: string[];
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
}

// ─── Internal helpers ────────────────────────────────────────────────────────

const ZERO_USAGE: Usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

const PLAN_FAILURE_FALLBACK_REASON =
  'This app could not be planned from the request. Try describing it differently.';
const REPAIR_EXHAUSTED_REASON =
  'Could not produce a working app after several attempts. Try describing it differently or more specifically.';
const CONTAINMENT_FAILURE_REASON = 'This app could not be safely run and was not delivered.';
/** The unobserved-verdict reason (design D6, settled copy — verbatim). Deliberately NOT
 *  `CONTAINMENT_FAILURE_REASON`: that sentence asserts a breach we did not observe. This one says
 *  only that we could not verify the run, and points at the device's existing one-tap "Try again"
 *  rather than promising an automatic retry (design D3 declines to add one). */
const UNVERIFIED_RUN_REASON = "We couldn't verify this app ran safely. Please try again.";
const GENERIC_INTERNAL_ERROR_REASON = 'Something went wrong while generating this app. Please try again.';

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
  | { action: 'failed'; reason: string };

function decideAfterDiagnostics(diagnostics: readonly Diagnostic[], budgets: RepairBudgetsSnapshot): DiagnosticsDecision {
  if (diagnostics.length === 0) return { action: 'proceed' };

  if (hasErrors(diagnostics)) {
    if (budgets.repairsUsed >= budgets.repairAttempts) return { action: 'failed', reason: REPAIR_EXHAUSTED_REASON };
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
  return { kind: 'failed', reason: decision.reason };
}

/** One breadcrumb for a `stage` transition — same fields the wire's `stage` event itself carries
 *  (stage name, status, and attempt when present). */
function logStage(stage: string, status: string, attempt?: number): void {
  runLog.info({ stage, status, ...(attempt !== undefined ? { attempt } : {}) }, 'stage');
}

/** Logs a model stream's rejected `usage`/`id` promise before re-throwing it, at the exact point
 *  `runModelTurn` would otherwise `throw settledUsage.error;` / `throw settledId.error;` — never
 *  called from inside the delta iteration loop (design D5 scope). */
function throwLoggedModelCallFailure(which: 'usage' | 'id', error: unknown): never {
  runLog.error(
    {
      which,
      errorClass: error instanceof Error ? error.constructor.name : typeof error,
      detail: error instanceof Error ? error.message : String(error),
    },
    'model call failed',
  );
  throw error;
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

/** Mutable per-run accumulator threaded through every phase. */
interface RunState {
  usage: Usage;
  diagnostics: Diagnostic[];
  candidatesProduced: number;
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
  | { kind: 'failed'; reason: string }
  | { kind: 'contained-failure' }
  | { kind: 'containment-unobserved' };

/** Maps a non-affirmative containment verdict onto its own terminal outcome — the one place the
 *  three-valued verdict is turned into a candidate outcome. An exhaustive `switch` over the
 *  verdict's literal type (design D8-local): `contained` is the discriminant, so a fourth
 *  `RunOutcome` arm makes this a compile error at the call site instead of silently reusing one of
 *  these two. Never collapse the two — `null` is absence of evidence, `false` is evidence. */
function unverifiedRunOutcome(contained: false | null): CandidateOutcome {
  switch (contained) {
    case false:
      return { kind: 'contained-failure' };
    case null:
      return { kind: 'containment-unobserved' };
  }
}

type TerminalEvent = Extract<GenerationEvent, { type: 'result' | 'failure' }>;

/** The `failure` terminal each run-ending, non-delivering candidate outcome produces — the one
 *  place a `reason` is chosen. An exhaustive `switch`, so a new terminal outcome cannot be added
 *  without deciding what the user is told; and each arm decides its `diagnostics` independently.
 *  Both containment terminals send `[]`: nothing about an escape attempt, and no unobserved-verdict
 *  detail, is ever fed back (spec "The run stage is the synthetic harness…"). */
function failureTerminalFor(
  outcome: Extract<CandidateOutcome, { kind: 'failed' | 'contained-failure' | 'containment-unobserved' }>,
  state: RunState,
): TerminalEvent {
  const attempts = state.candidatesProduced;
  switch (outcome.kind) {
    case 'contained-failure':
      return { type: 'failure', reason: CONTAINMENT_FAILURE_REASON, attempts, diagnostics: [] };
    // Terminal on the same terms as a containment failure — an unverified run is not a candidate to
    // iterate on — but with its OWN reason (design D3/D6). No repair attempt is consumed, no repair
    // prompt is built, and the candidate is never re-run.
    case 'containment-unobserved':
      return { type: 'failure', reason: UNVERIFIED_RUN_REASON, attempts, diagnostics: [] };
    case 'failed':
      return { type: 'failure', reason: outcome.reason, attempts, diagnostics: state.diagnostics };
  }
}

// ─── The machine ─────────────────────────────────────────────────────────────

export class GenerationMachine {
  private readonly deps: GenerationPipelineDeps;
  private readonly bounds: PipelineBounds;

  constructor(deps: GenerationPipelineDeps) {
    this.deps = deps;
    this.bounds = { ...DEFAULT_BOUNDS, ...deps.bounds };
  }

  /** `signal`, when provided, is honored at every state boundary (spec "Cancellation aborts the
   *  pipeline at every boundary"): on abort the returned generator stops without a terminal event.
   *  `trace`, when provided, receives every model call's provider generation id as it resolves
   *  (design D9). */
  run(request: GenerateRequest, signal?: AbortSignal, trace?: RunTrace): AsyncIterable<GenerationEvent> {
    return this.runGenerator(request, signal, trace);
  }

  private async *runGenerator(
    request: GenerateRequest,
    signal?: AbortSignal,
    trace?: RunTrace,
  ): AsyncGenerator<GenerationEvent> {
    if (signal?.aborted) return;
    const state: RunState = { usage: ZERO_USAGE, diagnostics: [], candidatesProduced: 0 };

    runLog.info('run start');
    try {
      const edit = editContextFor(request);

      const plan = yield* this.runPlanPhase(request, edit, signal, trace, state);
      if (!plan) return;
      if (signal?.aborted) return;

      const source = yield* this.runGeneratePhase(request, plan, edit, signal, trace, state);
      if (source === undefined) return;

      yield* this.runRepairLoop(request, plan, edit, source, signal, trace, state);
    } catch (err) {
      if (signal?.aborted) return;
      runLog.error(
        {
          errorClass: err instanceof Error ? err.constructor.name : typeof err,
          detail: err instanceof Error ? err.message : String(err),
          stack: err instanceof Error ? err.stack : undefined,
        },
        'run failed',
      );
      yield* this.emitCompletion(state, signal, {
        type: 'failure',
        reason: GENERIC_INTERNAL_ERROR_REASON,
        attempts: state.candidatesProduced,
        diagnostics: state.diagnostics,
      });
    }
  }

  /** The one completion envelope: usage immediately before the terminal, with the abort check
   *  between those two externally-observable events so cancellation can never leak a terminal. */
  private async *emitCompletion(
    state: RunState,
    signal: AbortSignal | undefined,
    terminal: TerminalEvent,
  ): AsyncGenerator<GenerationEvent, void> {
    if (signal?.aborted) return;
    yield { type: 'usage', usage: state.usage };
    if (signal?.aborted) return;
    if (terminal.type === 'failure') {
      runLog.info({ reason: terminal.reason }, 'terminal failure');
    } else {
      runLog.info('terminal result');
    }
    yield terminal;
  }

  /** Calls the engineer model, accumulating usage/trace, and — when `emitTokens` — streaming
   *  `token` events (spec: only `generate` and a `repair` stream tokens; `plan` does not). */
  private async *runModelTurn(
    messages: ModelMessage[],
    signal: AbortSignal | undefined,
    trace: RunTrace | undefined,
    state: RunState,
    emitTokens: boolean,
  ): AsyncGenerator<GenerationEvent, { text: string; aborted: boolean }> {
    const stream = this.deps.model.stream({ model: this.deps.roster.engineer, messages }, signal);
    const usageResult = settle(stream.usage);
    const idResult = settle(stream.id).then((result) => {
      // Start observing the id immediately, rather than after the delta stream completes. The id
      // resolves from the provider's first frame, and aborted-run reconciliation depends on the
      // out-parameter already containing it when cancellation stops this generator (design D9).
      if (result.ok && result.value !== undefined && trace) trace.generationIds.push(result.value);
      return result;
    });
    let text = '';
    for await (const delta of stream.deltas) {
      if (signal?.aborted) return { text, aborted: true };
      text += delta;
      if (emitTokens) yield { type: 'token', text: delta };
    }
    if (signal?.aborted) return { text, aborted: true };
    const settledUsage = await usageResult;
    if (!settledUsage.ok) throwLoggedModelCallFailure('usage', settledUsage.error);
    state.usage = sumUsage(state.usage, settledUsage.value);
    const settledId = await idResult;
    if (!settledId.ok) throwLoggedModelCallFailure('id', settledId.error);
    return { text, aborted: signal?.aborted ?? false };
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
      logStage('plan', 'start');
      yield { type: 'stage', stage: 'plan', status: 'start' };
      if (signal?.aborted) return undefined;

      const messages = buildPlanMessages({
        request,
        schemaContext: edit.schemaContext,
        storageSurface: edit.storageSurface,
        priorFailureReason,
      });
      const turn = yield* this.runModelTurn(messages, signal, trace, state, false);
      if (turn.aborted) return undefined;

      const { plan, failureReason } = this.resolvePlan(turn.text, request);

      logStage('plan', 'done');
      yield { type: 'stage', stage: 'plan', status: 'done' };
      if (signal?.aborted) return undefined;

      if (plan) return plan;

      priorFailureReason = failureReason;
      if (attempt === this.bounds.planAttempts) {
        yield* this.emitCompletion(state, signal, {
          type: 'failure',
          reason: failureReason ?? PLAN_FAILURE_FALLBACK_REASON,
          attempts: 0,
          diagnostics: [],
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
    logStage('generate', 'start');
    yield { type: 'stage', stage: 'generate', status: 'start' };
    if (signal?.aborted) return undefined;

    const messages = buildGenerateMessages(
      { request, plan, schemaContext: edit.schemaContext, storageSurface: edit.storageSurface },
      this.deps.promptInputs,
    );
    const turn = yield* this.runModelTurn(messages, signal, trace, state, true);
    if (turn.aborted) return undefined;

    logStage('generate', 'done');
    yield { type: 'stage', stage: 'generate', status: 'done' };
    if (signal?.aborted) return undefined;

    state.candidatesProduced = 1;
    return turn.text;
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
    logStage('repair', 'start', roundAttempt);
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
    const turn = yield* this.runModelTurn(messages, signal, trace, state, true);
    if (turn.aborted) return undefined;

    logStage('repair', 'done', roundAttempt);
    yield { type: 'stage', stage: 'repair', status: 'done', attempt: roundAttempt };
    if (signal?.aborted) return undefined;

    state.candidatesProduced += 1;
    return turn.text;
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
      const outcome = yield* this.processCandidate(source, request, edit, roundAttempt, signal, state.diagnostics, budgets);

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
      runLog.info({ kindCounts, warningsOnly: outcome.warningsOnly }, 'repair triggered');

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
      type: 'result',
      app: record,
      ...(summary ? { summary } : {}),
    });
  }

  /**
   * The post-run summariser (spec "A post-run summariser…"). Called once, only for a record that
   * is already going to be delivered, and never allowed to change that: it is handed copied
   * primitives (no record, no manifest object, no bundle), its token spend is folded into the run's
   * usage before the `usage` event, and ANY failure — a rejection, a timeout, unusable prose —
   * yields `undefined`, so the run still emits its `result` with the summary simply absent. No
   * stage event narrates it: it is not a stage, and the enum is not widened.
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
    try {
      const result = await summariser.summarise(
        {
          prompt: request.prompt,
          isEdit: request.app !== undefined,
          appName: record.name,
          capabilities: Array.isArray(capabilities) ? capabilities.filter((c): c is string => typeof c === 'string') : [],
          attempts: state.candidatesProduced,
          diagnostics: [...state.diagnostics],
        },
        signal,
      );
      if (result.usage) state.usage = sumUsage(state.usage, result.usage);
      return result.summary;
    } catch (err) {
      runLog.error(
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
    diagnosticsAccum: Diagnostic[],
    signal: AbortSignal | undefined,
  ): AsyncGenerator<GenerationEvent, void> {
    for (const d of diagnostics) {
      if (signal?.aborted) return;
      diagnosticsAccum.push(d);
      yield { type: 'diagnostic', diagnostic: d };
      if (signal?.aborted) return;
    }
    if (signal?.aborted) return;
    logStage(stage, 'done', attemptField.attempt);
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
    diagnosticsAccum: Diagnostic[],
    budgets: RepairBudgetsSnapshot,
  ): AsyncGenerator<GenerationEvent, CandidateOutcome> {
    const attemptField = roundAttempt !== undefined ? { attempt: roundAttempt } : {};

    logStage('check', 'start', attemptField.attempt);
    yield { type: 'stage', stage: 'check', status: 'start', ...attemptField };
    if (signal?.aborted) return { kind: 'aborted' };
    const checkReport = await this.deps.check.check(
      source,
      { appliedSchema: request.app?.appliedSchema, previousSurface: edit.previousSurface },
      signal,
    );
    if (signal?.aborted) return { kind: 'aborted' };
    yield* this.emitDiagnosticsAndDone(checkReport.diagnostics, 'check', attemptField, diagnosticsAccum, signal);
    if (signal?.aborted) return { kind: 'aborted' };

    const decision = decideAfterDiagnostics(checkReport.diagnostics, budgets);
    if (decision.action !== 'proceed') return outcomeFromDecision(decision);

    return yield* this.buildAndRun(
      source,
      checkReport,
      signal,
      diagnosticsAccum,
      budgets,
      attemptField,
      [...checkReport.diagnostics],
    );
  }

  private async *buildAndRun(
    source: string,
    checkReport: CheckReport,
    signal: AbortSignal | undefined,
    diagnosticsAccum: Diagnostic[],
    budgets: RepairBudgetsSnapshot,
    attemptField: { attempt?: number },
    roundDiagnostics: Diagnostic[],
  ): AsyncGenerator<GenerationEvent, CandidateOutcome> {
    logStage('run', 'start', attemptField.attempt);
    yield { type: 'stage', stage: 'run', status: 'start', ...attemptField };
    if (signal?.aborted) return { kind: 'aborted' };
    const buildOutcome = await this.deps.build.build(source, signal);
    if (signal?.aborted) return { kind: 'aborted' };

    if (!buildOutcome.ok) {
      yield* this.emitDiagnosticsAndDone([buildOutcome.diagnostic], 'run', attemptField, diagnosticsAccum, signal);
      if (signal?.aborted) return { kind: 'aborted' };
      roundDiagnostics.push(buildOutcome.diagnostic);
      return budgets.repairsUsed < budgets.repairAttempts
        ? { kind: 'repair', diagnostics: errorsFirst(roundDiagnostics), warningsOnly: false }
        : { kind: 'failed', reason: REPAIR_EXHAUSTED_REASON };
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
      logStage('run', 'done', attemptField.attempt);
      yield { type: 'stage', stage: 'run', status: 'done', ...attemptField };
      return unverifiedRunOutcome(runOutcome.contained);
    }

    yield* this.emitDiagnosticsAndDone(runOutcome.diagnostics, 'run', attemptField, diagnosticsAccum, signal);
    if (signal?.aborted) return { kind: 'aborted' };

    roundDiagnostics.push(...runOutcome.diagnostics);
    const decision = decideAfterDiagnostics(roundDiagnostics, budgets);
    if (decision.action !== 'proceed') return outcomeFromDecision(decision);
    return { kind: 'deliver', record: runOutcome.record };
  }
}
