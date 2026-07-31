/**
 * server/src/generation/machine.ts — the bounded generation state machine (design D2, D4-D9, D11;
 * spec "The pipeline is a bounded state machine", "Stage events narrate the machine over the
 * existing contract", "Exactly one terminal event per completed run", "The plan is structured and
 * validated against the request", "Repair asks for a minimal diff with the diagnostics in context",
 * "Cancellation aborts the pipeline at every boundary"). Depends on nothing concrete: `CheckStage`,
 * `BuildStage`, `RunStage`, and `Clock` are injected interfaces (design D2), so this file compiles
 * and is tested against fakes only. See `handoff/pipeline-machine.md` for the full contract.
 */
import type {
  Diagnostic,
  GenerateRequest,
  GenerationEvent,
  Usage,
  WireAppRecord,
} from '@whim/contract';
import type { ModelClient, ModelMessage, ModelRoster } from './model';
import type { PromptInputs } from './prompts/inputs';
import { buildGenerateMessages, buildPlanMessages, buildRepairMessages } from './prompts';
import { type Plan, parsePlan, validatePlan } from './plan';

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
 *  to the model. When `contained` is `true`, `record` is ALWAYS present (the harness-validated
 *  `WireAppRecord`, design D12) — the machine, not the stage, decides whether to deliver it or keep
 *  repairing, based on `diagnostics[].severity` (design D6). */
export type RunOutcome =
  | { contained: false; diagnostics: Diagnostic[] }
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
  bounds?: Partial<PipelineBounds>;
}

// ─── Internal helpers ────────────────────────────────────────────────────────

const ZERO_USAGE: Usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

const PLAN_FAILURE_FALLBACK_REASON =
  'This app could not be planned from the request. Try describing it differently.';
const REPAIR_EXHAUSTED_REASON =
  'Could not produce a working app after several attempts. Try describing it differently or more specifically.';
const CONTAINMENT_FAILURE_REASON = 'This app could not be safely run and was not delivered.';
const GENERIC_INTERNAL_ERROR_REASON = 'Something went wrong while generating this app. Please try again.';

function sumUsage(a: Usage, b: Usage): Usage {
  return {
    promptTokens: a.promptTokens + b.promptTokens,
    completionTokens: a.completionTokens + b.completionTokens,
    totalTokens: a.totalTokens + b.totalTokens,
  };
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

function schemaContextFor(request: GenerateRequest): string {
  const appliedSchema = request.app?.appliedSchema;
  if (!appliedSchema || Object.keys(appliedSchema).length === 0) return '';
  return `Applied schema (existing burned field IDs — do not reuse them): ${JSON.stringify(appliedSchema)}`;
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
  | { kind: 'contained-failure' };

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

    try {
      const schemaContext = schemaContextFor(request);

      const plan = yield* this.runPlanPhase(request, schemaContext, signal, trace, state);
      if (!plan) return;
      if (signal?.aborted) return;

      const source = yield* this.runGeneratePhase(request, plan, schemaContext, signal, trace, state);
      if (source === undefined) return;

      yield* this.runRepairLoop(request, plan, schemaContext, source, signal, trace, state);
    } catch {
      if (signal?.aborted) return;
      yield { type: 'usage', usage: state.usage };
      yield {
        type: 'failure',
        reason: GENERIC_INTERNAL_ERROR_REASON,
        attempts: state.candidatesProduced,
        diagnostics: state.diagnostics,
      };
    }
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
    let text = '';
    for await (const delta of stream.deltas) {
      if (signal?.aborted) return { text, aborted: true };
      text += delta;
      if (emitTokens) yield { type: 'token', text: delta };
    }
    if (signal?.aborted) return { text, aborted: true };
    const usage = await stream.usage;
    state.usage = sumUsage(state.usage, usage);
    const id = await stream.id;
    if (id !== undefined && trace) trace.generationIds.push(id);
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
    schemaContext: string,
    signal: AbortSignal | undefined,
    trace: RunTrace | undefined,
    state: RunState,
  ): AsyncGenerator<GenerationEvent, Plan | undefined> {
    let priorFailureReason: string | undefined;

    for (let attempt = 1; attempt <= this.bounds.planAttempts; attempt++) {
      if (signal?.aborted) return undefined;
      yield { type: 'stage', stage: 'plan', status: 'start' };
      if (signal?.aborted) return undefined;

      const messages = buildPlanMessages({ request, schemaContext, priorFailureReason });
      const turn = yield* this.runModelTurn(messages, signal, trace, state, false);
      if (turn.aborted) return undefined;

      const { plan, failureReason } = this.resolvePlan(turn.text, request);

      yield { type: 'stage', stage: 'plan', status: 'done' };
      if (signal?.aborted) return undefined;

      if (plan) return plan;

      priorFailureReason = failureReason;
      if (attempt === this.bounds.planAttempts) {
        yield { type: 'usage', usage: state.usage };
        yield {
          type: 'failure',
          reason: failureReason ?? PLAN_FAILURE_FALLBACK_REASON,
          attempts: 0,
          diagnostics: [],
        };
        return undefined;
      }
    }
    return undefined;
  }

  /** The `GENERATE` state — always the initial round, never carries `attempt`. */
  private async *runGeneratePhase(
    request: GenerateRequest,
    plan: Plan,
    schemaContext: string,
    signal: AbortSignal | undefined,
    trace: RunTrace | undefined,
    state: RunState,
  ): AsyncGenerator<GenerationEvent, string | undefined> {
    yield { type: 'stage', stage: 'generate', status: 'start' };
    if (signal?.aborted) return undefined;

    const messages = buildGenerateMessages({ request, plan, schemaContext }, this.deps.promptInputs);
    const turn = yield* this.runModelTurn(messages, signal, trace, state, true);
    if (turn.aborted) return undefined;

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
    schemaContext: string,
    currentSource: string,
    diagnostics: Diagnostic[],
    roundAttempt: number,
    signal: AbortSignal | undefined,
    trace: RunTrace | undefined,
    state: RunState,
  ): AsyncGenerator<GenerationEvent, string | undefined> {
    yield { type: 'stage', stage: 'repair', status: 'start', attempt: roundAttempt };
    if (signal?.aborted) return undefined;

    const messages = buildRepairMessages(
      { request, plan, currentSource, diagnostics, schemaContext },
      this.deps.promptInputs,
    );
    const turn = yield* this.runModelTurn(messages, signal, trace, state, true);
    if (turn.aborted) return undefined;

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
    schemaContext: string,
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
      const outcome = yield* this.processCandidate(source, request, roundAttempt, signal, state.diagnostics, budgets);

      if (outcome.kind === 'aborted') return;

      if (outcome.kind === 'deliver') {
        yield { type: 'usage', usage: state.usage };
        yield { type: 'result', app: outcome.record };
        return;
      }
      if (outcome.kind === 'contained-failure') {
        yield { type: 'usage', usage: state.usage };
        yield {
          type: 'failure',
          reason: CONTAINMENT_FAILURE_REASON,
          attempts: state.candidatesProduced,
          diagnostics: [],
        };
        return;
      }
      if (outcome.kind === 'failed') {
        yield { type: 'usage', usage: state.usage };
        yield {
          type: 'failure',
          reason: outcome.reason,
          attempts: state.candidatesProduced,
          diagnostics: state.diagnostics,
        };
        return;
      }

      repairsUsed += 1;
      if (outcome.warningsOnly) warningRepairsUsed += 1;
      roundAttempt = repairsUsed;

      const repaired = yield* this.runRepairRound(
        request,
        plan,
        schemaContext,
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

  /** Streams each diagnostic as it is observed, then the stage's `done` event — the shared tail
   *  of both `CHECK` and `RUN` (build failures included). */
  private async *emitDiagnosticsAndDone(
    diagnostics: readonly Diagnostic[],
    stage: 'check' | 'run',
    attemptField: { attempt?: number },
    diagnosticsAccum: Diagnostic[],
  ): AsyncGenerator<GenerationEvent, void> {
    for (const d of diagnostics) {
      diagnosticsAccum.push(d);
      yield { type: 'diagnostic', diagnostic: d };
    }
    yield { type: 'stage', stage, status: 'done', ...attemptField };
  }

  /** `CHECK`, then — when it is clean or a warnings-only budget says "proceed" — `BUILD` and `RUN`
   *  folded into the wire's single `run` stage bracket (the `stage` enum has no `build` member).
   *  Decides the next transition; never emits a terminal event itself. */
  private async *processCandidate(
    source: string,
    request: GenerateRequest,
    roundAttempt: number | undefined,
    signal: AbortSignal | undefined,
    diagnosticsAccum: Diagnostic[],
    budgets: RepairBudgetsSnapshot,
  ): AsyncGenerator<GenerationEvent, CandidateOutcome> {
    const attemptField = roundAttempt !== undefined ? { attempt: roundAttempt } : {};

    yield { type: 'stage', stage: 'check', status: 'start', ...attemptField };
    if (signal?.aborted) return { kind: 'aborted' };
    const checkReport = await this.deps.check.check(source, { appliedSchema: request.app?.appliedSchema }, signal);
    if (signal?.aborted) return { kind: 'aborted' };
    yield* this.emitDiagnosticsAndDone(checkReport.diagnostics, 'check', attemptField, diagnosticsAccum);
    if (signal?.aborted) return { kind: 'aborted' };

    const decision = decideAfterDiagnostics(checkReport.diagnostics, budgets);
    if (decision.action !== 'proceed') return outcomeFromDecision(decision);

    return yield* this.buildAndRun(source, checkReport, signal, diagnosticsAccum, budgets, attemptField);
  }

  private async *buildAndRun(
    source: string,
    checkReport: CheckReport,
    signal: AbortSignal | undefined,
    diagnosticsAccum: Diagnostic[],
    budgets: RepairBudgetsSnapshot,
    attemptField: { attempt?: number },
  ): AsyncGenerator<GenerationEvent, CandidateOutcome> {
    yield { type: 'stage', stage: 'run', status: 'start', ...attemptField };
    if (signal?.aborted) return { kind: 'aborted' };
    const buildOutcome = await this.deps.build.build(source, signal);
    if (signal?.aborted) return { kind: 'aborted' };

    if (!buildOutcome.ok) {
      yield* this.emitDiagnosticsAndDone([buildOutcome.diagnostic], 'run', attemptField, diagnosticsAccum);
      if (signal?.aborted) return { kind: 'aborted' };
      return budgets.repairsUsed < budgets.repairAttempts
        ? { kind: 'repair', diagnostics: [buildOutcome.diagnostic], warningsOnly: false }
        : { kind: 'failed', reason: REPAIR_EXHAUSTED_REASON };
    }

    const runOutcome = await this.deps.run.run(
      { source, manifest: checkReport.manifest, build: buildOutcome.result },
      signal,
    );
    if (signal?.aborted) return { kind: 'aborted' };

    if (!runOutcome.contained) {
      yield { type: 'stage', stage: 'run', status: 'done', ...attemptField };
      return { kind: 'contained-failure' };
    }

    yield* this.emitDiagnosticsAndDone(runOutcome.diagnostics, 'run', attemptField, diagnosticsAccum);
    if (signal?.aborted) return { kind: 'aborted' };

    const decision = decideAfterDiagnostics(runOutcome.diagnostics, budgets);
    if (decision.action !== 'proceed') return outcomeFromDecision(decision);
    return { kind: 'deliver', record: runOutcome.record };
  }
}
