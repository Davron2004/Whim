/**
 * server/test/machine.suite.ts — chain-4's suite: `plan.ts`'s parser/validator directly, and the
 * state machine end to end against fake `CheckStage`/`BuildStage`/`RunStage`/`Clock` (design D2) —
 * no Chromium, no network. Deterministic throughout: every model call goes through
 * `ScriptedModelClient` (or a tiny hand-rolled `ModelClient` fake for the abort-mid-stream cases)
 * and the whole file passes with `OPENROUTER_API_KEY` unset.
 *
 * `machine.ts` DOES value-import `checks/index.ts` (for `scanStorageSurface`, the one scanner the
 * edit turn's prompt and the drift check share), so importing it pulls `typescript` in behind it.
 * That costs this suite nothing it cares about: the scanner is pure and synchronous — no I/O, no
 * clock, no network — so determinism is untouched, and `typescript` is `external` in `run.mjs`
 * (Node resolves it from node_modules rather than esbuild bundling its CJS `require`s into an
 * unsupported dynamic require). The real check PIPELINE still never runs here: `CheckStage` is a
 * fake, exactly as before.
 */
import { caught, check, eq, section } from './harness';
import { captureLogs, withMessage } from './log-capture';
import { ScriptedModelClient, type ScriptedTurn } from './scripted-model';
import { parsePlan, validatePlan, type Plan } from '../src/generation/plan';
import {
  GenerationMachine,
  type BuildOutcome,
  type BuildResult,
  type BuildStage,
  type CheckReport,
  type CheckStage,
  type Clock,
  type GenerationPipelineDeps,
  type RunOutcome,
  type RunStage,
  type RunTrace,
} from '../src/generation/machine';
import { openRouterModelClient, type ModelClient, type ModelDelta, type ModelRoster, type ModelStream } from '../src/generation/model';
import type { PromptInputs } from '../src/generation/prompts/inputs';
import { OpenRouterClient, OpenRouterCreditError, type FetchFn } from '../src/openrouter';
import { createModelSummariser, type SummariseResult, type Summariser } from '../src/generation/summarise';
import { checkCredit, invalidateCreditCache, type CreditCheckOptions } from '../src/admission/credit';
import type { Diagnostic, GenerateRequest, GenerationEvent, Usage } from '@whim/contract';

// ── Shared fixtures ───────────────────────────────────────────────────────────

const ROSTER: ModelRoster = { rewrite: 'vendor/rewrite-1', engineer: 'vendor/engineer-1' };
const FAKE_INPUTS: PromptInputs = { sdkReference: 'fake sdk reference', fewShotExamples: [] };
const FAKE_CLOCK: Clock = { now: () => 0 };
const ZERO_USAGE = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

const NEW_APP_REQUEST: GenerateRequest = { prompt: 'a tip splitter' };

const MANIFEST = { name: 'demo', manifest: { capabilities: [] }, schema: {} };
const WIRE_RECORD = {
  name: 'demo',
  source: 'export default {};',
  bundle: '(()=>{})();',
  manifest: { capabilities: [] },
  schema: {},
};
const BUILD_RESULT: BuildResult = { bundle: '(()=>{})();' };

const ERROR_DIAG: Diagnostic = { kind: 'raw_timer', severity: 'error', message: 'raw setTimeout used', hint: 'use delay/interval instead' };
const WARNING_DIAG: Diagnostic = { kind: 'unused_capability', severity: 'warning', message: 'cues declared but unused', hint: 'remove it' };
const RUN_ERROR_DIAG: Diagnostic = { kind: 'run_fault', severity: 'error', message: 'the synthetic run failed', hint: 'fix the runtime behavior' };
/** A VERB-TIME storage denial as the synthetic run reports it (synthetic-run §"Verb-time storage
 *  denials are candidate diagnostics"): the engine's own kind, the denied method, the engine's own
 *  hint. Static checks cannot see it — it exists only because the candidate was actually run. */
const TYPE_MISMATCH_RUN_DIAG: Diagnostic = {
  kind: 'type_mismatch',
  severity: 'error',
  message: 'storage.records.append: storage refused the call (type_mismatch)',
  hint: 'Value for "at" in "Entries" is invalid: expected an epoch-millisecond integer.',
};
const BUILD_FAILURE_DIAG: Diagnostic = { kind: 'build_failure', severity: 'error', message: 'esbuild failed', hint: 'fix the syntax error' };

const VALID_PLAN_JSON = JSON.stringify({
  screens: [{ name: 'Home', purpose: 'the only screen' }],
  initial: 'Home',
  state: [],
  capabilities: [],
  storageKeys: [],
});
const DANGLING_INITIAL_PLAN_JSON = JSON.stringify({
  screens: [{ name: 'Home', purpose: 'the only screen' }],
  initial: 'Missing',
  state: [],
  capabilities: [],
  storageKeys: [],
});

function engineerTurn(deltas: string[]): ScriptedTurn {
  return { role: 'engineer', deltas, usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } };
}

function scriptedCheck(reports: CheckReport[]): CheckStage {
  let i = 0;
  return {
    check: () => {
      const r = reports[i];
      if (!r) throw new Error(`scriptedCheck: exhausted at call ${i}`);
      i += 1;
      return r;
    },
  };
}

function scriptedBuild(outcomes: BuildOutcome[]): BuildStage {
  let i = 0;
  return {
    build: () => {
      const o = outcomes[i];
      if (!o) throw new Error(`scriptedBuild: exhausted at call ${i}`);
      i += 1;
      return o;
    },
  };
}

function scriptedRun(outcomes: RunOutcome[]): RunStage {
  let i = 0;
  return {
    run: () => {
      const o = outcomes[i];
      if (!o) throw new Error(`scriptedRun: exhausted at call ${i}`);
      i += 1;
      return o;
    },
  };
}

function baseDeps(overrides: Partial<GenerationPipelineDeps> & Pick<GenerationPipelineDeps, 'model'>): GenerationPipelineDeps {
  return {
    roster: ROSTER,
    promptInputs: FAKE_INPUTS,
    check: scriptedCheck([]),
    build: scriptedBuild([]),
    run: scriptedRun([]),
    clock: FAKE_CLOCK,
    ...overrides,
  };
}

async function collect(iter: AsyncIterable<GenerationEvent>): Promise<GenerationEvent[]> {
  const out: GenerationEvent[] = [];
  for await (const e of iter) out.push(e);
  return out;
}

function terminals(events: GenerationEvent[]): GenerationEvent[] {
  return events.filter((e) => e.type === 'result' || e.type === 'failure');
}

type StageEvent = Extract<GenerationEvent, { type: 'stage' }>;
function stageEvents(events: GenerationEvent[], stage: StageEvent['stage']): StageEvent[] {
  return events.filter((e): e is StageEvent => e.type === 'stage' && e.stage === stage);
}

function assertCompletedEnvelope(label: string, events: GenerationEvent[]): void {
  eq(`${label}: exactly one terminal event`, terminals(events).length, 1);
  eq(`${label}: exactly one usage event`, events.filter((e) => e.type === 'usage').length, 1);
  check(
    `${label}: usage immediately precedes the last terminal event`,
    events.at(-2)?.type === 'usage' && (events.at(-1)?.type === 'result' || events.at(-1)?.type === 'failure'),
  );
}

// ── §plan.ts — parser + validator, direct ─────────────────────────────────────

function testPlanParsing(): void {
  section('plan.ts — parsePlan: fenced-block tolerant, structurally validated');

  const bare = parsePlan(VALID_PLAN_JSON);
  check('parsePlan: bare JSON parses', bare.ok);

  const fenced = parsePlan(`Here is the plan:\n\`\`\`json\n${VALID_PLAN_JSON}\n\`\`\`\n`);
  check('parsePlan: fenced JSON parses', fenced.ok);
  if (bare.ok && fenced.ok) eq('parsePlan: fenced and bare agree', fenced.plan, bare.plan);

  const malformed = parsePlan('{ not json');
  check('parsePlan: malformed JSON fails', !malformed.ok);

  const notObject = parsePlan('"just a string"');
  check('parsePlan: non-object JSON fails', !notObject.ok);

  const missingField = parsePlan(JSON.stringify({ screens: [], initial: 'Home' }));
  check('parsePlan: missing required field fails', !missingField.ok);

  const empty = parsePlan('   ');
  check('parsePlan: empty response fails', !empty.ok);
}

function testPlanValidation(): void {
  section('plan.ts — validatePlan: mechanical rules against the request');

  const validPlan: Plan = {
    screens: [{ name: 'Home', purpose: 'the only screen' }],
    initial: 'Home',
    state: [],
    capabilities: [],
    storageKeys: [],
  };
  check('validatePlan: a well-formed plan validates', validatePlan(validPlan, NEW_APP_REQUEST).ok);

  const dangling: Plan = { ...validPlan, initial: 'Missing' };
  const danglingResult = validatePlan(dangling, NEW_APP_REQUEST);
  check('validatePlan: dangling initial screen fails', !danglingResult.ok);
  if (!danglingResult.ok) {
    check('validatePlan: dangling-initial reason names the screen', danglingResult.reason.includes('Missing'));
    check('validatePlan: dangling-initial reason names the declared screens', danglingResult.reason.includes('Home'));
  }

  const duplicateNames: Plan = {
    ...validPlan,
    screens: [
      { name: 'Home', purpose: 'a' },
      { name: 'Home', purpose: 'b' },
    ],
  };
  check('validatePlan: duplicate screen names fail', !validatePlan(duplicateNames, NEW_APP_REQUEST).ok);

  const emptyName: Plan = { ...validPlan, screens: [{ name: '  ', purpose: 'a' }], initial: '  ' };
  check('validatePlan: empty screen name fails', !validatePlan(emptyName, NEW_APP_REQUEST).ok);

  const unknownCapability: Plan = { ...validPlan, capabilities: ['teleport'] };
  const unknownResult = validatePlan(unknownCapability, NEW_APP_REQUEST);
  check('validatePlan: unknown capability fails', !unknownResult.ok);
  if (!unknownResult.ok) check('validatePlan: unknown-capability reason names it', unknownResult.reason.includes('teleport'));

  const storageKeysWithoutCapability: Plan = { ...validPlan, storageKeys: ['note'], capabilities: [] };
  const storageResult = validatePlan(storageKeysWithoutCapability, NEW_APP_REQUEST);
  check('validatePlan: storage keys without the storage capability fail', !storageResult.ok);
  if (!storageResult.ok) check('validatePlan: storage-keys reason mentions "storage"', storageResult.reason.includes('storage'));

  const editWithAppliedSchema: GenerateRequest = {
    prompt: 'add a dark mode toggle',
    app: {
      source: 'export default {};',
      manifest: { capabilities: ['storage'] },
      schema: {},
      appliedSchema: { notes: { f1: { type: 'string' } } },
    },
  };
  const droppedStorage: Plan = { ...validPlan, capabilities: [] };
  const droppedResult = validatePlan(droppedStorage, editWithAppliedSchema);
  check('validatePlan: dropping storage the applied schema requires fails', !droppedResult.ok);
  if (!droppedResult.ok) check('validatePlan: dropped-storage reason mentions "storage"', droppedResult.reason.includes('storage'));

  const keptStorage: Plan = { ...validPlan, capabilities: ['storage'] };
  check('validatePlan: keeping the required capability validates', validatePlan(keptStorage, editWithAppliedSchema).ok);
}

// ── §machine.ts — end to end against fakes ────────────────────────────────────

async function testHappyPath(): Promise<void> {
  section('machine — happy path: plan, generate, check, run → result');

  const model = new ScriptedModelClient(ROSTER, [
    engineerTurn([VALID_PLAN_JSON]),
    engineerTurn(['export ', 'default {}; // v1']),
  ]);
  const deps = baseDeps({
    model,
    check: scriptedCheck([{ diagnostics: [], manifest: MANIFEST }]),
    build: scriptedBuild([{ ok: true, result: BUILD_RESULT }]),
    run: scriptedRun([{ contained: true, diagnostics: [], record: WIRE_RECORD }]),
  });
  const machine = new GenerationMachine(deps);
  const events = await collect(machine.run(NEW_APP_REQUEST));
  assertCompletedEnvelope('happy path', events);

  eq('happy path: stage sequence', events.filter((e) => e.type === 'stage').map((e) => `${e.stage}:${e.status}`), [
    'plan:start',
    'plan:done',
    'generate:start',
    'generate:done',
    'check:start',
    'check:done',
    'run:start',
    'run:done',
  ]);
  check('happy path: no attempt field on any initial-round stage event', events.every((e) => e.type !== 'stage' || e.attempt === undefined));
  eq('happy path: token events are per-delta', events.filter((e) => e.type === 'token').map((e) => e.text), ['export ', 'default {}; // v1']);
  eq('happy path: exactly one terminal event', terminals(events).length, 1);
  const last = events[events.length - 1];
  const secondLast = events[events.length - 2];
  check('happy path: usage immediately precedes the terminal', secondLast.type === 'usage' && last.type === 'result');
  if (secondLast.type === 'usage') {
    eq('happy path: usage totals sum every model call', secondLast.usage, { promptTokens: 2, completionTokens: 2, totalTokens: 4 });
  }
  if (last.type === 'result') eq('happy path: delivered record matches the run stage record', last.app, WIRE_RECORD);
}

async function testThinkingEvents(): Promise<void> {
  section('machine — thinking events: reasoning deltas surface in every turn, regardless of emitTokens');

  const planReasoning = 'weighing which screens this needs';
  const generateReasoning = 'working out how to write the code';
  const model = new ScriptedModelClient(ROSTER, [
    { role: 'engineer', deltas: [{ reasoning: planReasoning }, VALID_PLAN_JSON], usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } },
    { role: 'engineer', deltas: [{ reasoning: generateReasoning }, 'export default {}; // v1'], usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } },
  ]);
  const deps = baseDeps({
    model,
    check: scriptedCheck([{ diagnostics: [], manifest: MANIFEST }]),
    build: scriptedBuild([{ ok: true, result: BUILD_RESULT }]),
    run: scriptedRun([{ contained: true, diagnostics: [], record: WIRE_RECORD }]),
  });
  const machine = new GenerationMachine(deps);
  const events = await collect(machine.run(NEW_APP_REQUEST));
  assertCompletedEnvelope('thinking events', events);

  eq('thinking events: exactly one per turn', events.filter((e) => e.type === 'thinking').length, 2);
  eq(
    'thinking events: chars matches each reasoning delta length',
    events.filter((e) => e.type === 'thinking').map((e) => (e.type === 'thinking' ? e.chars : -1)),
    [planReasoning.length, generateReasoning.length],
  );

  // The plan turn's reasoning surfaces even though `emitTokens` is false for it — no token event
  // rides along with it, and it lands before `plan:done`.
  const planDoneIndex = events.findIndex((e) => e.type === 'stage' && e.stage === 'plan' && e.status === 'done');
  const firstThinkingIndex = events.findIndex((e) => e.type === 'thinking');
  check('thinking: the plan turn\'s reasoning precedes plan:done', firstThinkingIndex >= 0 && firstThinkingIndex < planDoneIndex);
  eq('thinking: no token event was emitted for the plan turn', events.filter((e) => e.type === 'token').length, 1);

  // The generate turn's reasoning precedes its token stream (thinking, then token — never the
  // reverse, and never interleaved out of order).
  const generateStartIndex = events.findIndex((e) => e.type === 'stage' && e.stage === 'generate' && e.status === 'start');
  const secondThinkingIndex = events.findIndex((e, i) => e.type === 'thinking' && i > firstThinkingIndex);
  const firstTokenIndex = events.findIndex((e) => e.type === 'token');
  check(
    "thinking: the generate turn's reasoning lands after generate:start and before its token event",
    secondThinkingIndex > generateStartIndex && secondThinkingIndex < firstTokenIndex,
  );
  eq('thinking: the generate token carries only the text-kind delta', events.filter((e) => e.type === 'token').map((e) => (e.type === 'token' ? e.text : '')), [
    'export default {}; // v1',
  ]);

  // Usage/terminal ordering is untouched by the interleaved thinking events.
  check('thinking: usage still immediately precedes the terminal', events.at(-2)?.type === 'usage' && events.at(-1)?.type === 'result');

  // Every pipeline turn (plan and generate alike) asks for reasoning — the thinking events above
  // only exist because `reasoning: true` is set on the request, not because the model volunteered it.
  check('thinking: every model request set reasoning: true', model.requests.every((r) => r.request.reasoning === true));
}

async function testRepairThenSuccess(): Promise<void> {
  section('machine — repair-then-success: one repair pair, then result');

  const model = new ScriptedModelClient(ROSTER, [
    engineerTurn([VALID_PLAN_JSON]),
    engineerTurn(['export default {}; // v1']),
    engineerTurn(['export default {}; // v2']),
  ]);
  const deps = baseDeps({
    model,
    check: scriptedCheck([
      { diagnostics: [ERROR_DIAG], manifest: MANIFEST },
      { diagnostics: [], manifest: MANIFEST },
    ]),
    build: scriptedBuild([{ ok: true, result: BUILD_RESULT }]),
    run: scriptedRun([{ contained: true, diagnostics: [], record: WIRE_RECORD }]),
  });
  const machine = new GenerationMachine(deps);
  const events = await collect(machine.run(NEW_APP_REQUEST));
  assertCompletedEnvelope('repair-then-success', events);

  eq('repair-then-success: repair pairs', stageEvents(events, 'repair').map((e) => e.status), ['start', 'done']);
  check('repair-then-success: repair events carry attempt:1', stageEvents(events, 'repair').every((e) => e.type === 'stage' && e.attempt === 1));
  check(
    'repair-then-success: repaired check/run events carry attempt:1',
    [...stageEvents(events, 'check').slice(2), ...stageEvents(events, 'run')].every((e) => e.attempt === 1),
  );
  eq('repair-then-success: generate and repair both stream token deltas', events.filter((e) => e.type === 'token').length, 2);
  eq('repair-then-success: check pairs (initial + one repaired round)', stageEvents(events, 'check').length, 4);
  eq('repair-then-success: run pairs (only the successful candidate)', stageEvents(events, 'run').length, 2);
  eq('repair-then-success: exactly one terminal event', terminals(events).length, 1);
  check('repair-then-success: terminal is a result', events[events.length - 1].type === 'result');
}

async function testRepairCapExhaustion(): Promise<void> {
  section('machine — repair-cap exhaustion: 3 repair pairs, 4 candidates, attempts:4');

  const model = new ScriptedModelClient(ROSTER, [
    engineerTurn([VALID_PLAN_JSON]),
    engineerTurn(['candidate-1']),
    engineerTurn(['candidate-2']),
    engineerTurn(['candidate-3']),
    engineerTurn(['candidate-4']),
  ]);
  const diag = (n: number): Diagnostic => ({ ...ERROR_DIAG, message: `candidate ${n} still broken` });
  const deps = baseDeps({
    model,
    check: scriptedCheck([
      { diagnostics: [diag(1), WARNING_DIAG, diag(1)], manifest: MANIFEST },
      { diagnostics: [diag(2)], manifest: MANIFEST },
      { diagnostics: [diag(3)], manifest: MANIFEST },
      { diagnostics: [diag(4)], manifest: MANIFEST },
    ]),
  });
  const machine = new GenerationMachine(deps);
  const events = await collect(machine.run(NEW_APP_REQUEST));
  assertCompletedEnvelope('repair-cap exhaustion', events);

  eq('repair-cap exhaustion: 3 repair pairs', stageEvents(events, 'repair').length, 6);
  eq('repair-cap exhaustion: repair attempt numbers are 1,2,3', stageEvents(events, 'repair').filter((e) => e.status === 'start').map((e) => e.attempt), [1, 2, 3]);
  eq('repair-cap exhaustion: 4 check pairs (never reaches run/build)', stageEvents(events, 'check').length, 8);
  eq('repair-cap exhaustion: run stage never begins', stageEvents(events, 'run').length, 0);

  const firstCheckDoneIndex = events.findIndex((e) => e.type === 'stage' && e.stage === 'check' && e.status === 'done');
  const diagnosticEventsBeforeFirstDone = events.slice(0, firstCheckDoneIndex).filter((e) => e.type === 'diagnostic');
  eq('repair-cap exhaustion: all 3 first-round diagnostics stream before that check\'s done event', diagnosticEventsBeforeFirstDone.length, 3);

  eq('repair-cap exhaustion: exactly one terminal event', terminals(events).length, 1);
  const terminal = events[events.length - 1];
  check('repair-cap exhaustion: terminal is a failure', terminal.type === 'failure');
  if (terminal.type === 'failure') {
    eq('repair-cap exhaustion: attempts equals candidates produced (4)', terminal.attempts, 4);
    eq('repair-cap exhaustion: accumulated diagnostics cover all 4 rounds', terminal.diagnostics.length, 6);
    check('repair-cap exhaustion: reason is generic product prose, not a diagnostic kind', !terminal.reason.includes('raw_timer'));
  }
}

async function testPlanReaskThenFailure(): Promise<void> {
  section('machine — plan re-ask is bounded: two plan pairs, no generate, one failure');

  const model = new ScriptedModelClient(ROSTER, [
    engineerTurn([DANGLING_INITIAL_PLAN_JSON]),
    engineerTurn([DANGLING_INITIAL_PLAN_JSON]),
  ]);
  const deps = baseDeps({ model });
  const machine = new GenerationMachine(deps);
  const events = await collect(machine.run(NEW_APP_REQUEST));
  assertCompletedEnvelope('plan re-ask', events);

  eq('plan re-ask: exactly two plan pairs', stageEvents(events, 'plan').length, 4);
  eq('plan re-ask: no generate stage begins', stageEvents(events, 'generate').length, 0);
  eq('plan re-ask: exactly one terminal event', terminals(events).length, 1);
  const terminal = events[events.length - 1];
  check('plan re-ask: terminal is a failure', terminal.type === 'failure');
  if (terminal.type === 'failure') {
    eq('plan re-ask: attempts is 0 (no candidate produced)', terminal.attempts, 0);
    eq('plan re-ask: diagnostics is empty', terminal.diagnostics, []);
    check('plan re-ask: reason names the unresolved screen', terminal.reason.includes('Missing'));
  }
  check('plan re-ask: no event carries plan payload (only the stage pair is evidence)', events.every((e) => !('plan' in e)));
}

async function testWarningsOnlyOneRepairThenDeliver(): Promise<void> {
  section('machine — warnings-only: at most one repair, then delivered with residual warnings');

  const model = new ScriptedModelClient(ROSTER, [
    engineerTurn([VALID_PLAN_JSON]),
    engineerTurn(['export default {}; // v1']),
    engineerTurn(['export default {}; // v2']),
  ]);
  const deps = baseDeps({
    model,
    check: scriptedCheck([
      { diagnostics: [WARNING_DIAG], manifest: MANIFEST },
      { diagnostics: [WARNING_DIAG], manifest: MANIFEST },
    ]),
    build: scriptedBuild([{ ok: true, result: BUILD_RESULT }]),
    run: scriptedRun([{ contained: true, diagnostics: [], record: WIRE_RECORD }]),
  });
  const machine = new GenerationMachine(deps);
  const events = await collect(machine.run(NEW_APP_REQUEST));
  assertCompletedEnvelope('warnings-only', events);

  eq('warnings-only: exactly one repair pair', stageEvents(events, 'repair').length, 2);
  eq('warnings-only: run begins exactly once (only after the sub-budget is spent)', stageEvents(events, 'run').length, 2);
  eq('warnings-only: both warnings streamed as diagnostic events', events.filter((e) => e.type === 'diagnostic').length, 2);
  eq('warnings-only: exactly one terminal event', terminals(events).length, 1);
  check('warnings-only: terminal is a result (delivered despite residual warnings)', events[events.length - 1].type === 'result');
}

async function testRepairPromptGetsWholeCurrentRoundErrorsFirst(): Promise<void> {
  section('machine — repair context: CHECK + RUN diagnostics from one round, errors first');

  const model = new ScriptedModelClient(ROSTER, [
    engineerTurn([VALID_PLAN_JSON]),
    engineerTurn(['candidate-1']),
    engineerTurn(['candidate-2']),
    engineerTurn(['candidate-3']),
  ]);
  const deps = baseDeps({
    model,
    check: scriptedCheck([
      { diagnostics: [WARNING_DIAG], manifest: MANIFEST },
      { diagnostics: [WARNING_DIAG], manifest: MANIFEST },
      { diagnostics: [], manifest: MANIFEST },
    ]),
    build: scriptedBuild([
      { ok: true, result: BUILD_RESULT },
      { ok: true, result: BUILD_RESULT },
    ]),
    run: scriptedRun([
      { contained: true, diagnostics: [RUN_ERROR_DIAG], record: WIRE_RECORD },
      { contained: true, diagnostics: [], record: WIRE_RECORD },
    ]),
  });
  const events = await collect(new GenerationMachine(deps).run(NEW_APP_REQUEST));
  assertCompletedEnvelope('whole-round repair context', events);

  eq(
    'whole-round repair context: repair/check/run attempts propagate by candidate',
    events
      .filter((e): e is StageEvent => e.type === 'stage' && e.status === 'start' && ['repair', 'check', 'run'].includes(e.stage))
      .map((e) => `${e.stage}:${e.attempt ?? 'initial'}`),
    ['check:initial', 'repair:1', 'check:1', 'run:1', 'repair:2', 'check:2', 'run:2'],
  );

  const secondRepairPrompt = model.requests[3]?.request.messages.map((message) => message.content).join('\n') ?? '';
  const errorIndex = secondRepairPrompt.indexOf(RUN_ERROR_DIAG.kind);
  const warningIndex = secondRepairPrompt.indexOf(WARNING_DIAG.kind);
  check('whole-round repair context: the RUN error is included', errorIndex >= 0);
  check('whole-round repair context: the preceding CHECK warning is included', warningIndex >= 0);
  check('whole-round repair context: errors are ordered before warnings', errorIndex >= 0 && errorIndex < warningIndex);
  check('whole-round repair context: terminal is a result after the next green candidate', events.at(-1)?.type === 'result');
}

async function testVerbTimeRunDiagnosticRoutesToRepairAndDeliversNoRecord(): Promise<void> {
  section('machine — repair context: an error run diagnostic (type_mismatch) repairs and delivers no record');

  // The first candidate RUNS and is contained — so the harness hands the machine an assembled
  // record for it — but its storage write was refused at verb time. The record must never be
  // delivered (synthetic-run §"An error run diagnostic reaches repair"): the machine, not the
  // stage, decides delivery, and an error diagnostic in the round means repair.
  const model = new ScriptedModelClient(ROSTER, [
    engineerTurn([VALID_PLAN_JSON]),
    engineerTurn(['candidate-writes-a-date-string']),
    engineerTurn(['candidate-writes-epoch-ms']),
  ]);
  const REFUSED_RECORD = { ...WIRE_RECORD, name: 'candidate-with-a-refused-write' };
  const deps = baseDeps({
    model,
    // Both candidates pass the static checks clean — a verb-time denial is exactly the class of
    // fault that only the run can produce, so nothing else in the round can explain the repair.
    check: scriptedCheck([
      { diagnostics: [], manifest: MANIFEST },
      { diagnostics: [], manifest: MANIFEST },
    ]),
    build: scriptedBuild([
      { ok: true, result: BUILD_RESULT },
      { ok: true, result: BUILD_RESULT },
    ]),
    run: scriptedRun([
      { contained: true, diagnostics: [TYPE_MISMATCH_RUN_DIAG], record: REFUSED_RECORD },
      { contained: true, diagnostics: [], record: WIRE_RECORD },
    ]),
  });
  const events = await collect(new GenerationMachine(deps).run(NEW_APP_REQUEST));
  assertCompletedEnvelope('verb-time run diagnostic', events);

  eq('verb-time run diagnostic: exactly one repair pair is consumed', stageEvents(events, 'repair').length, 2);
  eq('verb-time run diagnostic: the candidate is run twice — the repaired one too', stageEvents(events, 'run').length, 4);
  eq(
    'verb-time run diagnostic: it streams as a diagnostic event under the engine\'s own kind',
    events.filter((e) => e.type === 'diagnostic' && e.diagnostic.kind === 'type_mismatch').length,
    1,
  );

  const repairPrompt = model.requests[2]?.request.messages.map((message) => message.content).join('\n') ?? '';
  check('verb-time run diagnostic: the repair prompt carries the kind', repairPrompt.includes('type_mismatch'));
  check('verb-time run diagnostic: the repair prompt carries the engine\'s own hint', repairPrompt.includes(TYPE_MISMATCH_RUN_DIAG.hint));
  check('verb-time run diagnostic: the repair prompt names the denied method', repairPrompt.includes('storage.records.append'));

  check(
    'verb-time run diagnostic: no byte of the refused candidate\'s record is delivered anywhere',
    !JSON.stringify(events).includes(REFUSED_RECORD.name),
  );
  const terminal = events.at(-1);
  check('verb-time run diagnostic: terminal is a result for the repaired candidate', terminal?.type === 'result');
  if (terminal?.type === 'result') {
    eq('verb-time run diagnostic: the delivered record is the repaired one', terminal.app.name, WIRE_RECORD.name);
  }
}

async function testContainmentFailureShortCircuit(): Promise<void> {
  section('machine — containment failure is terminal, no repair consumed (D7)');

  const model = new ScriptedModelClient(ROSTER, [engineerTurn([VALID_PLAN_JSON]), engineerTurn(['export default {};'])]);
  const deps = baseDeps({
    model,
    check: scriptedCheck([{ diagnostics: [], manifest: MANIFEST }]),
    build: scriptedBuild([{ ok: true, result: BUILD_RESULT }]),
    run: scriptedRun([{ contained: false, diagnostics: [] }]),
  });
  const machine = new GenerationMachine(deps);
  const events = await collect(machine.run(NEW_APP_REQUEST));
  assertCompletedEnvelope('containment failure', events);

  eq('containment failure: no repair stage ever begins', stageEvents(events, 'repair').length, 0);
  eq('containment failure: no diagnostic event is emitted', events.filter((e) => e.type === 'diagnostic').length, 0);
  eq('containment failure: exactly one terminal event', terminals(events).length, 1);
  const terminal = events[events.length - 1];
  check('containment failure: terminal is a failure', terminal.type === 'failure');
  if (terminal.type === 'failure') {
    eq('containment failure: attempts is 1 (one candidate produced)', terminal.attempts, 1);
    eq('containment failure: diagnostics is empty — nothing fed back', terminal.diagnostics, []);
  }
}

/** The settled copy for each terminal (design D6). Written out verbatim here rather than imported:
 *  these two sentences are product decisions, and a test that reads the constant it is checking
 *  would pass through any reword. */
const CONTAINMENT_FAILURE_COPY = 'This app could not be safely run and was not delivered.';
const UNVERIFIED_RUN_COPY = "We couldn't verify this app ran safely. Please try again.";

async function testUnobservedVerdictIsTerminalWithItsOwnReason(): Promise<void> {
  section('machine — an unobserved containment verdict is terminal, distinct, and consumes no repair (D3/D6)');

  // Two scripted turns only — plan and generate. A repair round would ask the model for a third
  // and blow up, so "no repair attempt is consumed" is enforced structurally as well as asserted.
  const model = new ScriptedModelClient(ROSTER, [engineerTurn([VALID_PLAN_JSON]), engineerTurn(['export default {};'])]);
  const deps = baseDeps({
    model,
    check: scriptedCheck([{ diagnostics: [], manifest: MANIFEST }]),
    build: scriptedBuild([{ ok: true, result: BUILD_RESULT }]),
    // One outcome only: a second `run` call — a re-run of the same candidate — exhausts the script
    // and throws, so "an unobserved verdict is NOT automatically re-run" (D3) is enforced too.
    run: scriptedRun([{ contained: null, diagnostics: [] }]),
  });
  const events = await collect(new GenerationMachine(deps).run(NEW_APP_REQUEST));
  assertCompletedEnvelope('unobserved verdict', events);

  eq('unobserved verdict: no repair stage ever begins', stageEvents(events, 'repair').length, 0);
  eq('unobserved verdict: the run stage bracket still closes', stageEvents(events, 'run').map((e) => e.status), ['start', 'done']);
  eq('unobserved verdict: no diagnostic event is emitted', events.filter((e) => e.type === 'diagnostic').length, 0);
  eq('unobserved verdict: no result is emitted — the candidate is never delivered', events.filter((e) => e.type === 'result').length, 0);

  const terminal = events.at(-1);
  check('unobserved verdict: the single terminal is a failure', terminal?.type === 'failure');
  if (terminal?.type === 'failure') {
    eq('unobserved verdict: the reason says we could not VERIFY, not that the app was unsafe', terminal.reason, UNVERIFIED_RUN_COPY);
    check('unobserved verdict: the reason is NOT the containment-failure reason', terminal.reason !== CONTAINMENT_FAILURE_COPY);
    eq('unobserved verdict: attempts is 1 — no repair attempt was spent', terminal.attempts, 1);
    eq('unobserved verdict: diagnostics is empty — nothing fed back', terminal.diagnostics, []);
  }

  // spec "Forgery detail never reaches the model" / the unobserved half of the same guard: the
  // pipeline assembled exactly the plan and generate prompts, and neither names the unobserved
  // verdict, its diagnostic kind, or any forgery signal.
  eq('unobserved verdict: only the plan and generate prompts were ever assembled', model.requests.length, 2);
  const assembled = model.requests
    .flatMap((r) => r.request.messages.map((m) => m.content))
    .join('\n')
    .toLowerCase();
  for (const leak of ['containment_unobserved', 'unobserved', 'forger', 'contained']) {
    check(`unobserved verdict: no assembled prompt mentions "${leak}"`, !assembled.includes(leak));
  }
}

async function testStageThrowYieldsOneFailure(): Promise<void> {
  section('machine — a stage throwing still yields exactly one failure');

  const model = new ScriptedModelClient(ROSTER, [engineerTurn([VALID_PLAN_JSON]), engineerTurn(['export default {};'])]);
  const throwingCheck: CheckStage = {
    check: () => {
      throw new Error('unexpected transport error with a secret token XYZ123');
    },
  };
  const deps = baseDeps({ model, check: throwingCheck });
  const machine = new GenerationMachine(deps);
  const events = await collect(machine.run(NEW_APP_REQUEST));
  assertCompletedEnvelope('stage throws', events);

  eq('stage throws: exactly one terminal event', terminals(events).length, 1);
  const terminal = events[events.length - 1];
  check('stage throws: terminal is a failure', terminal.type === 'failure');
  if (terminal.type === 'failure') {
    eq('stage throws: attempts reflects the candidate already produced', terminal.attempts, 1);
    check('stage throws: reason does not leak the exception text', !terminal.reason.includes('XYZ123'));
  }
  check('stage throws: usage still precedes the terminal', events[events.length - 2].type === 'usage');
}

async function testAbortBeforeStart(): Promise<void> {
  section('machine — abort: already aborted before run() is even iterated');

  const controller = new AbortController();
  controller.abort();
  const model = new ScriptedModelClient(ROSTER, [engineerTurn([VALID_PLAN_JSON])]);
  const machine = new GenerationMachine(baseDeps({ model }));
  const events = await collect(machine.run(NEW_APP_REQUEST, controller.signal));

  eq('abort before start: no events at all', events.length, 0);
}

async function testAbortDuringGenerateTokens(): Promise<void> {
  section('machine — abort during generate stops the model stream, no terminal event');

  const controller = new AbortController();
  let calls = 0;
  const signals: (AbortSignal | undefined)[] = [];
  const model: ModelClient = {
    stream(_req, signal): ModelStream {
      calls += 1;
      signals.push(signal);
      if (calls === 1) {
        return {
          deltas: (async function* (): AsyncGenerator<ModelDelta> {
            yield { kind: 'text', text: VALID_PLAN_JSON };
          })(),
          usage: Promise.resolve(ZERO_USAGE),
          id: Promise.resolve('gen-plan-before-abort'),
        };
      }
      return {
        deltas: (async function* (): AsyncGenerator<ModelDelta> {
          yield { kind: 'text', text: 'partial ' };
          controller.abort();
          yield { kind: 'text', text: 'never observed' };
        })(),
        usage: Promise.resolve(ZERO_USAGE),
        id: Promise.resolve('gen-generate-aborted'),
      };
    },
  };
  const machine = new GenerationMachine(baseDeps({ model }));
  const trace: RunTrace = { generationIds: [] };
  const events = await collect(machine.run(NEW_APP_REQUEST, controller.signal, trace));

  eq('abort during generate: exactly one token event before the abort was observed', events.filter((e) => e.type === 'token').length, 1);
  eq('abort during generate: no generate:done event', stageEvents(events, 'generate').filter((e) => e.status === 'done').length, 0);
  eq('abort during generate: no terminal event', terminals(events).length, 0);
  // The model receives the run's own signal, linked to the caller's (design D13), not the caller's itself.
  check('abort during generate: the caller abort reached every model call', signals.every((signal) => signal?.aborted === true));
  eq('abort during generate: RunTrace retains the aborted call id for reconciliation', trace.generationIds, [
    'gen-plan-before-abort',
    'gen-generate-aborted',
  ]);
}

async function testAbortDuringCheck(): Promise<void> {
  section('machine — abort during check produces no check:done and no terminal event');

  const controller = new AbortController();
  const model = new ScriptedModelClient(ROSTER, [engineerTurn([VALID_PLAN_JSON]), engineerTurn(['export default {};'])]);
  const abortingCheck: CheckStage = {
    check: () => {
      controller.abort();
      return { diagnostics: [], manifest: MANIFEST };
    },
  };
  const machine = new GenerationMachine(baseDeps({ model, check: abortingCheck }));
  const events = await collect(machine.run(NEW_APP_REQUEST, controller.signal));

  eq('abort during check: no check:done event', stageEvents(events, 'check').filter((e) => e.status === 'done').length, 0);
  eq('abort during check: no terminal event', terminals(events).length, 0);
}

async function testAbortDuringRun(): Promise<void> {
  section('machine — abort during run releases the harness with no terminal event');

  const controller = new AbortController();
  const model = new ScriptedModelClient(ROSTER, [engineerTurn([VALID_PLAN_JSON]), engineerTurn(['export default {};'])]);
  const abortingRun: RunStage = {
    run: () => {
      controller.abort();
      return { contained: true, diagnostics: [], record: WIRE_RECORD };
    },
  };
  const deps = baseDeps({
    model,
    check: scriptedCheck([{ diagnostics: [], manifest: MANIFEST }]),
    build: scriptedBuild([{ ok: true, result: BUILD_RESULT }]),
    run: abortingRun,
  });
  const machine = new GenerationMachine(deps);
  const events = await collect(machine.run(NEW_APP_REQUEST, controller.signal));

  eq('abort during run: no run:done event', stageEvents(events, 'run').filter((e) => e.status === 'done').length, 0);
  eq('abort during run: no terminal event', terminals(events).length, 0);
}

async function testAbortIsIdempotentAndQuiet(): Promise<void> {
  section('machine — abort is idempotent: firing twice ends the run once, quietly');

  const controller = new AbortController();
  controller.abort();
  controller.abort(); // idempotent: AbortController itself no-ops past the first call
  const model = new ScriptedModelClient(ROSTER, [engineerTurn([VALID_PLAN_JSON])]);
  const machine = new GenerationMachine(baseDeps({ model }));

  let threw: unknown;
  const events: GenerationEvent[] = [];
  try {
    for await (const e of machine.run(NEW_APP_REQUEST, controller.signal)) events.push(e);
  } catch (e) {
    threw = e;
  }
  check('abort twice: no unhandled rejection/throw', threw === undefined);
  eq('abort twice: no events, ended once', events.length, 0);
}

async function testAbortAtEveryStageBoundary(): Promise<void> {
  section('machine — abort checks cover every stage boundary, including the repair round');

  const boundaries: { stage: StageEvent['stage']; status: StageEvent['status']; attempt?: number }[] = [
    { stage: 'plan', status: 'start' },
    { stage: 'plan', status: 'done' },
    { stage: 'generate', status: 'start' },
    { stage: 'generate', status: 'done' },
    { stage: 'check', status: 'start' },
    { stage: 'check', status: 'done' },
    { stage: 'repair', status: 'start', attempt: 1 },
    { stage: 'repair', status: 'done', attempt: 1 },
    { stage: 'check', status: 'start', attempt: 1 },
    { stage: 'check', status: 'done', attempt: 1 },
    { stage: 'run', status: 'start', attempt: 1 },
    { stage: 'run', status: 'done', attempt: 1 },
  ];

  for (const boundary of boundaries) {
    const controller = new AbortController();
    const model = new ScriptedModelClient(ROSTER, [
      engineerTurn([VALID_PLAN_JSON]),
      engineerTurn(['candidate-1']),
      engineerTurn(['candidate-2']),
    ]);
    const machine = new GenerationMachine(baseDeps({
      model,
      check: scriptedCheck([
        { diagnostics: [ERROR_DIAG], manifest: MANIFEST },
        { diagnostics: [], manifest: MANIFEST },
      ]),
      build: scriptedBuild([{ ok: true, result: BUILD_RESULT }]),
      run: scriptedRun([{ contained: true, diagnostics: [], record: WIRE_RECORD }]),
    }));

    const events: GenerationEvent[] = [];
    let reached = false;
    for await (const event of machine.run(NEW_APP_REQUEST, controller.signal)) {
      events.push(event);
      if (
        event.type === 'stage' &&
        event.stage === boundary.stage &&
        event.status === boundary.status &&
        event.attempt === boundary.attempt
      ) {
        reached = true;
        controller.abort();
      }
    }

    const label = `${boundary.stage}:${boundary.status}:${boundary.attempt ?? 'initial'}`;
    const lastEvent = events.at(-1);
    check(`abort boundary ${label}: target was reached`, reached);
    eq(`abort boundary ${label}: no terminal event`, terminals(events).length, 0);
    check(
      `abort boundary ${label}: no event follows the boundary`,
      lastEvent?.type === 'stage' &&
        lastEvent.stage === boundary.stage &&
        lastEvent.status === boundary.status &&
        lastEvent.attempt === boundary.attempt,
    );
  }
}

async function testAbortAtDiagnosticAndCompletionBoundaries(): Promise<void> {
  section('machine — abort after diagnostic/usage events emits nothing further');

  const diagnosticController = new AbortController();
  const diagnosticModel = new ScriptedModelClient(ROSTER, [
    engineerTurn([VALID_PLAN_JSON]),
    engineerTurn(['candidate-1']),
  ]);
  const diagnosticMachine = new GenerationMachine(baseDeps({
    model: diagnosticModel,
    check: scriptedCheck([{ diagnostics: [ERROR_DIAG, RUN_ERROR_DIAG], manifest: MANIFEST }]),
  }));
  const diagnosticEvents: GenerationEvent[] = [];
  for await (const event of diagnosticMachine.run(NEW_APP_REQUEST, diagnosticController.signal)) {
    diagnosticEvents.push(event);
    if (event.type === 'diagnostic') diagnosticController.abort();
  }
  eq('abort after diagnostic: only the observed diagnostic is forwarded', diagnosticEvents.filter((e) => e.type === 'diagnostic').length, 1);
  eq('abort after diagnostic: check:done is suppressed', stageEvents(diagnosticEvents, 'check').filter((e) => e.status === 'done').length, 0);
  eq('abort after diagnostic: no terminal event', terminals(diagnosticEvents).length, 0);
  check('abort after diagnostic: the diagnostic is the last event', diagnosticEvents.at(-1)?.type === 'diagnostic');

  const completionCases: { label: string; machine: GenerationMachine }[] = [
    {
      label: 'success',
      machine: new GenerationMachine(baseDeps({
        model: new ScriptedModelClient(ROSTER, [engineerTurn([VALID_PLAN_JSON]), engineerTurn(['candidate-1'])]),
        check: scriptedCheck([{ diagnostics: [], manifest: MANIFEST }]),
        build: scriptedBuild([{ ok: true, result: BUILD_RESULT }]),
        run: scriptedRun([{ contained: true, diagnostics: [], record: WIRE_RECORD }]),
      })),
    },
    {
      label: 'failure',
      machine: new GenerationMachine(baseDeps({
        model: new ScriptedModelClient(ROSTER, [engineerTurn([DANGLING_INITIAL_PLAN_JSON])]),
        bounds: { planAttempts: 1 },
      })),
    },
  ];

  for (const completionCase of completionCases) {
    const controller = new AbortController();
    const events: GenerationEvent[] = [];
    for await (const event of completionCase.machine.run(NEW_APP_REQUEST, controller.signal)) {
      events.push(event);
      if (event.type === 'usage') controller.abort();
    }
    eq(`abort after usage (${completionCase.label}): one usage was observed`, events.filter((e) => e.type === 'usage').length, 1);
    eq(`abort after usage (${completionCase.label}): terminal is suppressed`, terminals(events).length, 0);
    check(`abort after usage (${completionCase.label}): usage is the last event`, events.at(-1)?.type === 'usage');
  }
}

async function testModelStreamThrowYieldsOneFailure(): Promise<void> {
  section('machine — a model stream throw and rejected usage become one safe failure');

  const model = new ScriptedModelClient(ROSTER, [
    { role: 'engineer', deltas: [], error: new Error('provider secret MODEL-LEAK') },
  ]);

  const capture = captureLogs();
  let events: GenerationEvent[];
  try {
    events = await collect(new GenerationMachine(baseDeps({ model })).run(NEW_APP_REQUEST));
  } finally {
    capture.stop();
  }

  assertCompletedEnvelope('model stream throws', events);
  const terminal = events.at(-1);
  check('model stream throws: terminal is a failure', terminal?.type === 'failure');
  if (terminal?.type === 'failure') {
    check('model stream throws: failure prose hides provider details', !terminal.reason.includes('MODEL-LEAK'));
    eq('model stream throws: no candidate was produced', terminal.attempts, 0);
  }

  check(
    'model stream throws: the run log carries the plan stage start, as named fields',
    withMessage(capture, 'stage').some(
      (r) => r.scope === 'run' && r.stage === 'plan' && r.status === 'start',
    ),
  );
  // ScriptedModelClient's error turn throws from the delta iterator itself (deltas: []), so this
  // exception is never observed via `settledUsage.error`/`settledId.error` — it propagates straight
  // to runGenerator's top-level catch. The record below is that catch's log, carrying the same error
  // class/message; it is NOT evidence that `throwLoggedModelCallFailure` ran (see
  // testUsageRejectionAfterDeltasLogsAtThrowSite for that coverage).
  check(
    'model stream throws: the run log carries the runGenerator-catch record with error class and detail',
    withMessage(capture, 'run failed').some(
      (r) => r.errorClass === 'Error' && r.detail === 'provider secret MODEL-LEAK',
    ),
  );
}

/**
 * Covers the actual `throwLoggedModelCallFailure` call site inside `runModelTurn` — reachable only
 * when the delta stream completes normally but `stream.usage` rejects afterward (a genuine race the
 * real provider client can hit, per `settle`'s doc comment), unlike `ScriptedModelClient`'s error
 * turn, which always throws from the delta iterator itself before that point is ever reached.
 */
async function testUsageRejectionAfterDeltasLogsAtThrowSite(): Promise<void> {
  section('machine — a usage rejection after a clean delta stream logs at its own throw site');

  const model: ModelClient = {
    stream(): ModelStream {
      return {
        deltas: (async function* (): AsyncGenerator<ModelDelta> {
          yield { kind: 'text', text: VALID_PLAN_JSON };
        })(),
        usage: Promise.reject(new Error('usage promise rejected after deltas')),
        id: Promise.resolve('gen-usage-rejected'),
      };
    },
  };

  const capture = captureLogs();
  let events: GenerationEvent[];
  try {
    events = await collect(new GenerationMachine(baseDeps({ model })).run(NEW_APP_REQUEST));
  } finally {
    capture.stop();
  }

  const terminal = events.at(-1);
  check('usage rejection: terminal is still a failure', terminal?.type === 'failure');

  check(
    'usage rejection: the run log carries the throw-site model-call-failure record',
    withMessage(capture, 'model call failed').some(
      (r) =>
        r.which === 'usage' && r.errorClass === 'Error' && r.detail === 'usage promise rejected after deltas',
    ),
  );
}

async function testRepairBudgetsAreConstructorInjectable(): Promise<void> {
  section('machine — planAttempts/repairAttempts/warningRepairAttempts are constructor parameters');

  const model = new ScriptedModelClient(ROSTER, [engineerTurn([DANGLING_INITIAL_PLAN_JSON])]);
  const deps = baseDeps({ model, bounds: { planAttempts: 1, repairAttempts: 0, warningRepairAttempts: 0 } });
  const machine = new GenerationMachine(deps);
  const events = await collect(machine.run(NEW_APP_REQUEST));
  assertCompletedEnvelope('injectable bounds', events);

  eq('injectable bounds: exactly one plan pair when planAttempts:1', stageEvents(events, 'plan').length, 2);
  eq('injectable bounds: exactly one terminal event', terminals(events).length, 1);
  const terminal = events[events.length - 1];
  if (terminal.type === 'failure') eq('injectable bounds: attempts is 0', terminal.attempts, 0);
}

async function testRunTraceCollectsGenerationIds(): Promise<void> {
  section('machine — RunTrace collects every model call\'s provider generation id (D9)');

  const model = new ScriptedModelClient(ROSTER, [
    { role: 'engineer', deltas: [VALID_PLAN_JSON], id: 'gen-plan-1' },
    { role: 'engineer', deltas: ['export default {};'], id: 'gen-generate-1' },
  ]);
  const deps = baseDeps({
    model,
    check: scriptedCheck([{ diagnostics: [], manifest: MANIFEST }]),
    build: scriptedBuild([{ ok: true, result: BUILD_RESULT }]),
    run: scriptedRun([{ contained: true, diagnostics: [], record: WIRE_RECORD }]),
  });
  const machine = new GenerationMachine(deps);
  const trace: RunTrace = { generationIds: [] };
  await collect(machine.run(NEW_APP_REQUEST, undefined, trace));

  eq('RunTrace: one id per model call, in order', trace.generationIds, ['gen-plan-1', 'gen-generate-1']);
}

async function testBuildFailureBecomesADiagnosticAndIsRepairable(): Promise<void> {
  section('machine — a build failure maps to build_failure and is repaired like a check error');

  const model = new ScriptedModelClient(ROSTER, [
    engineerTurn([VALID_PLAN_JSON]),
    engineerTurn(['export default {}; // v1']),
    engineerTurn(['export default {}; // v2']),
  ]);
  const deps = baseDeps({
    model,
    check: scriptedCheck([
      { diagnostics: [], manifest: MANIFEST },
      { diagnostics: [], manifest: MANIFEST },
    ]),
    build: scriptedBuild([{ ok: false, diagnostic: BUILD_FAILURE_DIAG }, { ok: true, result: BUILD_RESULT }]),
    run: scriptedRun([{ contained: true, diagnostics: [], record: WIRE_RECORD }]),
  });
  const machine = new GenerationMachine(deps);
  const events = await collect(machine.run(NEW_APP_REQUEST));
  assertCompletedEnvelope('build failure', events);

  eq('build failure: exactly one repair pair', stageEvents(events, 'repair').length, 2);
  const buildFailureDiagnostics = events.filter((e) => e.type === 'diagnostic' && e.diagnostic.kind === 'build_failure');
  eq('build failure: build_failure streamed as a diagnostic', buildFailureDiagnostics.length, 1);
  eq('build failure: exactly one terminal event', terminals(events).length, 1);
  check('build failure: terminal is a result once the rebuilt candidate builds', events[events.length - 1].type === 'result');
}

// ── §wall-clock budget and provider credit (design D6b, D13) ─────────────────

/** Settled copy, verbatim — written out rather than imported, so a reword fails here. */
const EXPIRED_COPY = 'This took too long to build. Please try again.';
const CREDIT_EXHAUSTED_COPY = 'Whim has used up its generation budget for now. Try again later.';
const GENERIC_FAILURE_COPY = 'Something went wrong while generating this app. Please try again.';
const MAX_RUN_MS = 5_000;
const ONE_TOKEN_USAGE: Usage = { promptTokens: 1, completionTokens: 1, totalTokens: 2 };

/** A test clock: time moves only on `advance`, which fires every armed timer that has come due. */
class ManualClock implements Clock {
  private current = 0;
  private readonly timers: { dueAt: number; delayMs: number; onFire: () => void; armed: boolean }[] = [];

  now(): number {
    return this.current;
  }

  setTimer(delayMs: number, onFire: () => void): () => void {
    const timer = { dueAt: this.current + delayMs, delayMs, onFire, armed: true };
    this.timers.push(timer);
    return () => {
      timer.armed = false;
    };
  }

  advance(ms: number): void {
    this.current += ms;
    for (const timer of this.timers) {
      if (timer.armed && timer.dueAt <= this.current) {
        timer.armed = false;
        timer.onFire();
      }
    }
  }

  /** The delay of every timer ever armed, in arming order. */
  get armedDelays(): number[] {
    return this.timers.map((timer) => timer.delayMs);
  }

  /** Timers still armed — a finished run must leave none. */
  get pending(): number {
    return this.timers.filter((timer) => timer.armed).length;
  }
}

const TIMED_OUT = Symbol('timed out');

/** Awaits `promise` against a ref'd timer, so a machine that never settles fails a named check
 *  instead of hanging the whole suite. */
async function settles<T>(label: string, promise: Promise<T>, ms = 2_000): Promise<{ ok: true; value: T } | { ok: false }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<typeof TIMED_OUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMED_OUT), ms);
  });
  try {
    const outcome = await Promise.race([promise, timeout]);
    check(`${label}: settles`, outcome !== TIMED_OUT);
    return outcome === TIMED_OUT ? { ok: false } : { ok: true, value: outcome };
  } finally {
    clearTimeout(timer);
  }
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** What an aborted `fetch` and an aborted synthetic run reject with. */
function abortError(): Error {
  const err = new Error('This operation was aborted');
  err.name = 'AbortError';
  return err;
}

type StreamFactory = (signal: AbortSignal | undefined) => ModelStream;

/** A `ModelClient` whose calls are the given stream factories, in order. */
function sequencedModel(streams: readonly StreamFactory[]): ModelClient {
  let call = 0;
  return {
    stream(_req, signal): ModelStream {
      const next = streams[call];
      call += 1;
      if (!next) throw new Error(`sequencedModel: call ${call} was not scripted`);
      return next(signal);
    },
  };
}

function textStream(text: string): StreamFactory {
  return () => ({
    deltas: (async function* (): AsyncGenerator<ModelDelta> {
      yield { kind: 'text', text };
    })(),
    usage: Promise.resolve(ONE_TOKEN_USAGE),
    id: Promise.resolve(undefined),
  });
}

interface StallProbe {
  /** Resolves once the stream has gone silent. */
  reached: ReturnType<typeof deferred>;
  signal?: AbortSignal;
}

/** One text delta, then silence until the signal aborts, then the throw an aborted `fetch` makes. */
function stalledStream(probe: StallProbe): StreamFactory {
  return (signal) => {
    probe.signal = signal;
    const untilAborted = new Promise<never>((_resolve, reject) => {
      signal?.addEventListener('abort', () => reject(abortError()), { once: true });
    });
    return {
      deltas: (async function* (): AsyncGenerator<ModelDelta> {
        yield { kind: 'text', text: 'partial ' };
        probe.reached.resolve();
        await untilAborted;
      })(),
      usage: untilAborted,
      id: Promise.resolve(undefined),
    };
  };
}

function newStallProbe(): StallProbe {
  return { reached: deferred() };
}

/** Always returns `limits[n]` for the n-th lookup (the last one repeating), as a 2xx key body. */
function creditOptions(limits: readonly number[]): { options: CreditCheckOptions; lookups: () => number } {
  let lookups = 0;
  return {
    options: {
      transport: {
        lookupKey: () => {
          const limit = limits[Math.min(lookups, limits.length - 1)];
          lookups += 1;
          return Promise.resolve({ status: 200, bodyText: JSON.stringify({ data: { limit_remaining: limit } }) });
        },
      },
      clock: () => 0,
      ttlMs: 60_000,
      floorUsd: 0.5,
    },
    lookups: () => lookups,
  };
}

function lastFailure(events: GenerationEvent[]): Extract<GenerationEvent, { type: 'failure' }> | undefined {
  const last = events.at(-1);
  return last?.type === 'failure' ? last : undefined;
}

async function testDeadlineEndsAStalledModelInOneFailure(): Promise<void> {
  section('machine — wall-clock budget: a stalled model ends in one usage and one failure');

  const clock = new ManualClock();
  const probe = newStallProbe();
  const request = new AbortController();
  const trace: RunTrace = { generationIds: [] };
  const machine = new GenerationMachine(baseDeps({
    model: sequencedModel([textStream(VALID_PLAN_JSON), stalledStream(probe)]),
    clock,
    maxRunMs: MAX_RUN_MS,
  }));
  const run = collect(machine.run(NEW_APP_REQUEST, request.signal, trace));
  if (!(await settles('stalled model: the generate turn goes silent', probe.reached.promise)).ok) return;

  clock.advance(MAX_RUN_MS - 1);
  eq('stalled model: one ms short of the budget the run is still going', trace.outcome, undefined);
  check('stalled model: one ms short of the budget the transport is not aborted', probe.signal?.aborted === false);
  clock.advance(1);

  const settled = await settles('stalled model: the run ends', run);
  if (!settled.ok) return;
  const events = settled.value;
  check('stalled model: the transport observes the abort', probe.signal?.aborted === true);
  check('stalled model: the caller\'s own signal is never aborted by the deadline', !request.signal.aborted);
  assertCompletedEnvelope('stalled model', events);
  const failure = lastFailure(events);
  check('stalled model: the terminal is a failure', failure !== undefined);
  eq('stalled model: the reason is the settled budget prose', failure?.reason, EXPIRED_COPY);
  eq('stalled model: attempts counts no candidate', failure?.attempts, 0);
  eq('stalled model: no generate:done is emitted', stageEvents(events, 'generate').map((e) => e.status), ['start']);
  eq('stalled model: RunTrace.outcome is expired', trace.outcome, 'expired');
  eq('stalled model: the deadline was armed once, for maxRunMs', clock.armedDelays, [MAX_RUN_MS]);
  eq('stalled model: no timer is left armed', clock.pending, 0);
}

async function testClientAbortBeforeDeadlineEndsSilently(): Promise<void> {
  section('machine — wall-clock budget: a client abort before the budget still ends silently');

  const clock = new ManualClock();
  const probe = newStallProbe();
  const controller = new AbortController();
  const trace: RunTrace = { generationIds: [] };
  const machine = new GenerationMachine(baseDeps({
    model: sequencedModel([textStream(VALID_PLAN_JSON), stalledStream(probe)]),
    clock,
    maxRunMs: MAX_RUN_MS,
  }));
  const run = collect(machine.run(NEW_APP_REQUEST, controller.signal, trace));
  if (!(await settles('abort first: the generate turn goes silent', probe.reached.promise)).ok) return;

  controller.abort();
  const settled = await settles('abort first: the run ends', run);
  if (!settled.ok) return;
  const events = settled.value;
  check('abort first: the transport observes the abort', probe.signal?.aborted === true);
  eq('abort first: no terminal event', terminals(events).length, 0);
  eq('abort first: no usage event', events.filter((e) => e.type === 'usage').length, 0);
  eq('abort first: RunTrace.outcome is aborted', trace.outcome, 'aborted');
  eq('abort first: the abort disarmed the deadline', clock.pending, 0);

  clock.advance(MAX_RUN_MS);
  eq('abort first: the budget elapsing later changes no outcome', trace.outcome, 'aborted');

  // A consumer that aborts and never pulls again (an SSE stream's cancel) never resumes the
  // generator, so nothing but the abort itself can disarm the deadline or record the outcome.
  const idleClock = new ManualClock();
  const idleController = new AbortController();
  const idleTrace: RunTrace = { generationIds: [] };
  const iterator = new GenerationMachine(baseDeps({
    model: new ScriptedModelClient(ROSTER, [engineerTurn([VALID_PLAN_JSON])]),
    clock: idleClock,
    maxRunMs: MAX_RUN_MS,
  })).run(NEW_APP_REQUEST, idleController.signal, idleTrace)[Symbol.asyncIterator]();
  if (!(await settles('abort without pulling: the first event arrives', iterator.next())).ok) return;
  eq('abort without pulling: the deadline is armed while the run is going', idleClock.pending, 1);
  idleController.abort();
  eq('abort without pulling: RunTrace.outcome is aborted at once', idleTrace.outcome, 'aborted');
  eq('abort without pulling: the abort alone disarms the deadline', idleClock.pending, 0);
  if (iterator.return) await settles('abort without pulling: the run is released', iterator.return());
}

async function testDeadlineInTheTurnAModelCallResolves(): Promise<void> {
  section('machine — wall-clock budget: the budget elapsing in the same turn a model call resolves');

  const clock = new ManualClock();
  const trace: RunTrace = { generationIds: [] };
  const resolvesAsBudgetElapses: StreamFactory = () => {
    let resolveUsage!: (usage: Usage) => void;
    const usage = new Promise<Usage>((resolve) => {
      resolveUsage = resolve;
    });
    return {
      deltas: (async function* (): AsyncGenerator<ModelDelta> {
        yield { kind: 'text', text: 'export default {};' };
        clock.advance(MAX_RUN_MS);
        resolveUsage(ONE_TOKEN_USAGE);
      })(),
      usage,
      id: Promise.resolve(undefined),
    };
  };
  // No check outcome is scripted: reaching the check stage would throw and end in the generic reason.
  const machine = new GenerationMachine(baseDeps({
    model: sequencedModel([textStream(VALID_PLAN_JSON), resolvesAsBudgetElapses]),
    clock,
    maxRunMs: MAX_RUN_MS,
  }));
  const settled = await settles('same-turn resolve: the run ends', collect(machine.run(NEW_APP_REQUEST, new AbortController().signal, trace)));
  if (!settled.ok) return;
  const events = settled.value;
  assertCompletedEnvelope('same-turn resolve', events);
  eq('same-turn resolve: the budget wins over the finished turn', lastFailure(events)?.reason, EXPIRED_COPY);
  eq('same-turn resolve: no result is delivered', events.filter((e) => e.type === 'result').length, 0);
  eq('same-turn resolve: the check stage never begins', stageEvents(events, 'check').length, 0);
  eq('same-turn resolve: RunTrace.outcome is expired', trace.outcome, 'expired');
  eq('same-turn resolve: no timer is left armed', clock.pending, 0);
}

async function testDeadlineAfterTheCompletionEnvelopeStartsIsInert(): Promise<void> {
  section('machine — wall-clock budget: elapsing between usage and the terminal changes nothing');

  const cases: { label: string; deps: (clock: ManualClock) => GenerationPipelineDeps; terminal: 'result' | 'failure'; outcome: RunTrace['outcome'] }[] = [
    {
      label: 'delivering run',
      deps: (clock) => baseDeps({
        model: new ScriptedModelClient(ROSTER, [engineerTurn([VALID_PLAN_JSON]), engineerTurn(['export default {};'])]),
        check: scriptedCheck([{ diagnostics: [], manifest: MANIFEST }]),
        build: scriptedBuild([{ ok: true, result: BUILD_RESULT }]),
        run: scriptedRun([{ contained: true, diagnostics: [], record: WIRE_RECORD }]),
        clock,
        maxRunMs: MAX_RUN_MS,
      }),
      terminal: 'result',
      outcome: 'delivered',
    },
    {
      label: 'failing run',
      deps: (clock) => baseDeps({
        model: new ScriptedModelClient(ROSTER, [engineerTurn([DANGLING_INITIAL_PLAN_JSON])]),
        bounds: { planAttempts: 1 },
        clock,
        maxRunMs: MAX_RUN_MS,
      }),
      terminal: 'failure',
      outcome: 'failed',
    },
  ];

  for (const c of cases) {
    const clock = new ManualClock();
    const trace: RunTrace = { generationIds: [] };
    const machine = new GenerationMachine(c.deps(clock));
    const events: GenerationEvent[] = [];
    const run = (async (): Promise<void> => {
      for await (const event of machine.run(NEW_APP_REQUEST, undefined, trace)) {
        events.push(event);
        if (event.type === 'usage') clock.advance(MAX_RUN_MS);
      }
    })();
    if (!(await settles(`after usage (${c.label}): the run ends`, run)).ok) continue;
    assertCompletedEnvelope(`after usage (${c.label})`, events);
    eq(`after usage (${c.label}): the committed terminal is delivered`, events.at(-1)?.type, c.terminal);
    check(`after usage (${c.label}): no expiry failure`, events.every((e) => e.type !== 'failure' || e.reason !== EXPIRED_COPY));
    eq(`after usage (${c.label}): RunTrace.outcome`, trace.outcome, c.outcome);
    eq(`after usage (${c.label}): no timer is left armed`, clock.pending, 0);
  }
}

async function testDeadlineDuringRepair(): Promise<void> {
  section('machine — wall-clock budget: elapsing during a repair turn ends in one failure');

  const clock = new ManualClock();
  const probe = newStallProbe();
  const trace: RunTrace = { generationIds: [] };
  const machine = new GenerationMachine(baseDeps({
    model: sequencedModel([textStream(VALID_PLAN_JSON), textStream('candidate-1'), stalledStream(probe)]),
    check: scriptedCheck([{ diagnostics: [ERROR_DIAG], manifest: MANIFEST }]),
    clock,
    maxRunMs: MAX_RUN_MS,
  }));
  const run = collect(machine.run(NEW_APP_REQUEST, new AbortController().signal, trace));
  if (!(await settles('during repair: the repair turn goes silent', probe.reached.promise)).ok) return;
  clock.advance(MAX_RUN_MS);

  const settled = await settles('during repair: the run ends', run);
  if (!settled.ok) return;
  const events = settled.value;
  check('during repair: the repair transport observes the abort', probe.signal?.aborted === true);
  assertCompletedEnvelope('during repair', events);
  const failure = lastFailure(events);
  eq('during repair: the reason is the budget prose', failure?.reason, EXPIRED_COPY);
  eq('during repair: attempts counts the one finished candidate', failure?.attempts, 1);
  eq('during repair: diagnostics carry what was accumulated', failure?.diagnostics, [ERROR_DIAG]);
  eq('during repair: the repair round opened and never closed', stageEvents(events, 'repair').map((e) => e.status), ['start']);
  eq('during repair: RunTrace.outcome is expired', trace.outcome, 'expired');
  eq('during repair: no timer is left armed', clock.pending, 0);
}

async function testDeadlineAbortsTheSyntheticRun(): Promise<void> {
  section('machine — wall-clock budget: elapsing during the run stage aborts the synthetic run');

  const clock = new ManualClock();
  const entered = deferred();
  let runSignal: AbortSignal | undefined;
  const hangingRun: RunStage = {
    run: (_input, signal) => {
      runSignal = signal;
      entered.resolve();
      return new Promise<RunOutcome>((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(abortError()), { once: true });
      });
    },
  };
  const trace: RunTrace = { generationIds: [] };
  const machine = new GenerationMachine(baseDeps({
    model: new ScriptedModelClient(ROSTER, [engineerTurn([VALID_PLAN_JSON]), engineerTurn(['export default {};'])]),
    check: scriptedCheck([{ diagnostics: [], manifest: MANIFEST }]),
    build: scriptedBuild([{ ok: true, result: BUILD_RESULT }]),
    run: hangingRun,
    clock,
    maxRunMs: MAX_RUN_MS,
  }));
  const run = collect(machine.run(NEW_APP_REQUEST, new AbortController().signal, trace));
  if (!(await settles('during run stage: the synthetic run is driving', entered.promise)).ok) return;
  check('during run stage: the synthetic run is not aborted before the budget', runSignal?.aborted === false);
  clock.advance(MAX_RUN_MS);

  const settled = await settles('during run stage: the run ends', run);
  if (!settled.ok) return;
  const events = settled.value;
  check('during run stage: the synthetic run observes the abort', runSignal?.aborted === true);
  assertCompletedEnvelope('during run stage', events);
  eq('during run stage: the reason is the budget prose', lastFailure(events)?.reason, EXPIRED_COPY);
  eq('during run stage: no run:done is emitted', stageEvents(events, 'run').map((e) => e.status), ['start']);
  eq('during run stage: RunTrace.outcome is expired', trace.outcome, 'expired');
}

async function testClientAbortRightAfterTheDeadline(): Promise<void> {
  section('machine — wall-clock budget: a client abort landing just after the budget elapses');

  {
    const clock = new ManualClock();
    const probe = newStallProbe();
    const controller = new AbortController();
    const trace: RunTrace = { generationIds: [] };
    const machine = new GenerationMachine(baseDeps({
      model: sequencedModel([textStream(VALID_PLAN_JSON), stalledStream(probe)]),
      clock,
      maxRunMs: MAX_RUN_MS,
    }));
    const run = collect(machine.run(NEW_APP_REQUEST, controller.signal, trace));
    if ((await settles('abort in the expiry turn: the generate turn goes silent', probe.reached.promise)).ok) {
      clock.advance(MAX_RUN_MS);
      controller.abort();
      const settled = await settles('abort in the expiry turn: the run ends', run);
      if (settled.ok) {
        eq('abort in the expiry turn: no usage event', settled.value.filter((e) => e.type === 'usage').length, 0);
        eq('abort in the expiry turn: no terminal event', terminals(settled.value).length, 0);
        eq('abort in the expiry turn: RunTrace.outcome stays expired', trace.outcome, 'expired');
      }
    }
  }

  {
    const clock = new ManualClock();
    const probe = newStallProbe();
    const controller = new AbortController();
    const trace: RunTrace = { generationIds: [] };
    const machine = new GenerationMachine(baseDeps({
      model: sequencedModel([textStream(VALID_PLAN_JSON), stalledStream(probe)]),
      clock,
      maxRunMs: MAX_RUN_MS,
    }));
    const events: GenerationEvent[] = [];
    const run = (async (): Promise<void> => {
      for await (const event of machine.run(NEW_APP_REQUEST, controller.signal, trace)) {
        events.push(event);
        if (event.type === 'usage') controller.abort();
      }
    })();
    if ((await settles('abort after expiry usage: the generate turn goes silent', probe.reached.promise)).ok) {
      clock.advance(MAX_RUN_MS);
      if ((await settles('abort after expiry usage: the run ends', run)).ok) {
        eq('abort after expiry usage: exactly one usage event', events.filter((e) => e.type === 'usage').length, 1);
        eq('abort after expiry usage: the failure is suppressed', terminals(events).length, 0);
        eq('abort after expiry usage: usage is the last event', events.at(-1)?.type, 'usage');
        eq('abort after expiry usage: RunTrace.outcome stays expired', trace.outcome, 'expired');
      }
    }
  }
}

async function testCreditExhaustedMidGenerate(): Promise<void> {
  section('machine — provider credit: a mid-generate 402 ends in one failure with no repair');

  invalidateCreditCache();
  // Two turns only: a repair would ask for a third and throw, so "no repair" is structural too.
  const model = new ScriptedModelClient(ROSTER, [
    engineerTurn([VALID_PLAN_JSON]),
    { role: 'engineer', deltas: [], error: new OpenRouterCreditError('OpenRouter: payment required (402)') },
  ]);
  const trace: RunTrace = { generationIds: [] };
  const events = await collect(new GenerationMachine(baseDeps({ model })).run(NEW_APP_REQUEST, undefined, trace));

  assertCompletedEnvelope('402 mid-generate', events);
  const failure = lastFailure(events);
  eq('402 mid-generate: the reason names the generation budget running out', failure?.reason, CREDIT_EXHAUSTED_COPY);
  check('402 mid-generate: the reason is not the generic model-failure prose', failure?.reason !== GENERIC_FAILURE_COPY);
  eq('402 mid-generate: no repair stage begins', stageEvents(events, 'repair').length, 0);
  eq('402 mid-generate: the check stage never begins', stageEvents(events, 'check').length, 0);
  eq('402 mid-generate: no model call follows the 402', model.requests.length, 2);
  eq('402 mid-generate: RunTrace.outcome is failed', trace.outcome, 'failed');
  invalidateCreditCache();
}

async function testCreditExhaustedDuringRepair(): Promise<void> {
  section('machine — provider credit: a 402 on the repair call ends the run without another repair');

  invalidateCreditCache();
  const model = new ScriptedModelClient(ROSTER, [
    engineerTurn([VALID_PLAN_JSON]),
    engineerTurn(['candidate-1']),
    { role: 'engineer', deltas: [], error: new OpenRouterCreditError('OpenRouter: payment required (402)') },
  ]);
  const trace: RunTrace = { generationIds: [] };
  const events = await collect(new GenerationMachine(baseDeps({
    model,
    check: scriptedCheck([{ diagnostics: [ERROR_DIAG], manifest: MANIFEST }]),
  })).run(NEW_APP_REQUEST, undefined, trace));

  assertCompletedEnvelope('402 during repair', events);
  const failure = lastFailure(events);
  eq('402 during repair: the reason names the generation budget running out', failure?.reason, CREDIT_EXHAUSTED_COPY);
  eq('402 during repair: attempts counts the one finished candidate', failure?.attempts, 1);
  eq('402 during repair: the model is never called again', model.requests.length, 3);
  eq('402 during repair: the repair round opened once and never closed', stageEvents(events, 'repair').map((e) => e.status), ['start']);
  eq('402 during repair: RunTrace.outcome is failed', trace.outcome, 'failed');
  invalidateCreditCache();
}

async function testCreditExhaustedInvalidatesTheCreditCache(): Promise<void> {
  section('machine — provider credit: a 402 invalidates the cached credit check');

  const cases = [
    { label: 'after a 402', error: new OpenRouterCreditError('OpenRouter: payment required (402)'), refused: true },
    { label: 'after an ordinary model failure', error: new Error('provider hiccup'), refused: false },
  ];
  for (const c of cases) {
    invalidateCreditCache();
    // The first lookup finds plenty of credit; any re-query finds none left.
    const credit = creditOptions([10, 0]);
    eq(`credit cache (${c.label}): the primed check admits`, await checkCredit(credit.options), { ok: true });

    const model = new ScriptedModelClient(ROSTER, [{ role: 'engineer', deltas: [], error: c.error }]);
    const events = await collect(new GenerationMachine(baseDeps({ model })).run(NEW_APP_REQUEST));
    assertCompletedEnvelope(`credit cache (${c.label})`, events);

    const next = await checkCredit(credit.options);
    if (c.refused) {
      eq(`credit cache (${c.label}): the next check inside the TTL re-queries`, credit.lookups(), 2);
      eq(`credit cache (${c.label}): the next request is refused as budget_exhausted`, next, { ok: false, reason: 'budget_exhausted' });
    } else {
      eq(`credit cache (${c.label}): the next check is a cache hit`, credit.lookups(), 1);
      eq(`credit cache (${c.label}): the next request is admitted`, next, { ok: true });
    }
  }
  invalidateCreditCache();
}

async function testTheProviderClientsHttp402IsRecognised(): Promise<void> {
  section('machine — provider credit: the OpenRouter client\'s HTTP 402 is told apart from other HTTP failures');

  const cases = [
    { status: 402, reason: CREDIT_EXHAUSTED_COPY },
    { status: 500, reason: GENERIC_FAILURE_COPY },
  ];
  for (const c of cases) {
    invalidateCreditCache();
    const model = openRouterModelClient(new OpenRouterClient(() => Promise.resolve(new Response(null, { status: c.status }))));
    const events = await collect(new GenerationMachine(baseDeps({ model })).run(NEW_APP_REQUEST));
    assertCompletedEnvelope(`HTTP ${c.status}`, events);
    eq(`HTTP ${c.status}: the failure reason`, lastFailure(events)?.reason, c.reason);
  }
  invalidateCreditCache();
}

/** One SSE `data:` line, terminated as the provider terminates it. */
function sseFrame(payload: Record<string, unknown>): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

function contentFrames(id: string, texts: readonly string[]): string[] {
  return texts.map((text) => sseFrame({ id, choices: [{ index: 0, delta: { content: text } }] }));
}

/** A fake OpenRouter transport: the Nth `stream()` call replays `streams[N]` over a real SSE
 *  response body (status 200 throughout — the failure being tested arrives INSIDE the stream). */
function sseFetchSequence(streams: readonly (readonly string[])[]): FetchFn {
  let call = 0;
  return async () => {
    const frames = streams[Math.min(call, streams.length - 1)] ?? [];
    call += 1;
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const frame of frames) controller.enqueue(encoder.encode(frame));
        controller.close();
      },
    });
    return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  };
}

/**
 * The provider can run out of credit AFTER the response headers are sent: OpenRouter answers
 * `200 OK`, streams part of the candidate, then sends `data: {"error":{"code":402}}`. Dropped, that
 * frame would end the stream "normally" with a truncated candidate — the run would check and repair
 * half a file while the real cause (no credit) went unreported and uncached.
 */
async function testMidStreamCreditFrameEndsTheRun(): Promise<void> {
  section('machine — a 402 delivered INSIDE the SSE stream ends the run as budget exhaustion, not as a truncated candidate');

  invalidateCreditCache();
  const credit = creditOptions([10, 0]);
  eq('mid-stream 402: the primed check admits', await checkCredit(credit.options), { ok: true });

  const model = openRouterModelClient(new OpenRouterClient(sseFetchSequence([
    [...contentFrames('gen-plan', [VALID_PLAN_JSON]), 'data: [DONE]\n\n'],
    [
      ...contentFrames('gen-generate', ['export default ', 'defineApp({']),
      sseFrame({ error: { code: 402, message: 'Insufficient credits' } }),
    ],
  ])));
  const trace: RunTrace = { generationIds: [] };
  const events = await collect(new GenerationMachine(baseDeps({ model })).run(NEW_APP_REQUEST, undefined, trace));

  assertCompletedEnvelope('mid-stream 402', events);
  eq('mid-stream 402: the failure names the generation budget, not a generic error', lastFailure(events)?.reason, CREDIT_EXHAUSTED_COPY);
  eq('mid-stream 402: the truncated candidate is never checked', stageEvents(events, 'check').length, 0);
  eq('mid-stream 402: no repair is attempted on a budget that is already gone', stageEvents(events, 'repair').length, 0);
  eq('mid-stream 402: the tokens streamed before the failure still reached the device', events.filter((e) => e.type === 'token').length, 2);
  eq('mid-stream 402: RunTrace.outcome is failed', trace.outcome, 'failed');

  const next = await checkCredit(credit.options);
  eq('mid-stream 402: the next check re-queries inside the TTL', credit.lookups(), 2);
  eq('mid-stream 402: the next request is refused as budget_exhausted', next, { ok: false, reason: 'budget_exhausted' });
  invalidateCreditCache();
}

/** Deps for a run that delivers on its first candidate, with `summariser` as the only variable. */
function deliveringDepsWithSummariser(model: ModelClient, summariser: Summariser): GenerationPipelineDeps {
  return baseDeps({
    model,
    summariser,
    check: scriptedCheck([{ diagnostics: [], manifest: MANIFEST }]),
    build: scriptedBuild([{ ok: true, result: BUILD_RESULT }]),
    run: scriptedRun([{ contained: true, diagnostics: [], record: WIRE_RECORD }]),
  });
}

/**
 * A 402 raised by the post-run summariser must not fail the run — the record is already built and
 * the summary is a nicety — but it is still authoritative about the operator's credit. Both
 * swallowing layers are covered: the model-backed summariser's own catch (the production path) and
 * `machine.ts`'s defensive catch around a summariser that rejects outright.
 */
async function testSummariserCreditErrorStillInvalidatesTheCache(): Promise<void> {
  section('machine — a 402 from the post-run summariser still delivers the run AND invalidates the credit cache');

  const rejectingSummariser: Summariser = {
    summarise: (): Promise<SummariseResult> => Promise.reject(new OpenRouterCreditError('OpenRouter: payment required (402)')),
  };
  const modelTurns = (): ScriptedTurn[] => [engineerTurn([VALID_PLAN_JSON]), engineerTurn(['export default {};'])];

  const cases: { label: string; summariser: (model: ScriptedModelClient) => Summariser; turns: ScriptedTurn[] }[] = [
    {
      label: 'the production model-backed summariser (its own catch swallows the throw)',
      summariser: (model) => createModelSummariser({ model, roster: ROSTER, timeoutMs: 2_000 }),
      turns: [
        ...modelTurns(),
        { role: 'rewrite', deltas: [], error: new OpenRouterCreditError('OpenRouter: payment required (402)') },
      ],
    },
    {
      label: 'a summariser that rejects outright (machine.ts\'s own catch)',
      summariser: () => rejectingSummariser,
      turns: modelTurns(),
    },
  ];

  for (const c of cases) {
    invalidateCreditCache();
    const credit = creditOptions([10, 0]);
    eq(`summariser 402 (${c.label}): the primed check admits`, await checkCredit(credit.options), { ok: true });

    const model = new ScriptedModelClient(ROSTER, c.turns);
    const events = await collect(new GenerationMachine(deliveringDepsWithSummariser(model, c.summariser(model))).run(NEW_APP_REQUEST));

    assertCompletedEnvelope(`summariser 402 (${c.label})`, events);
    const terminal = events.at(-1);
    eq(`summariser 402 (${c.label}): the run still delivers its result`, terminal?.type, 'result');
    if (terminal?.type === 'result') {
      eq(`summariser 402 (${c.label}): the delivered record is unchanged`, terminal.app, WIRE_RECORD);
      eq(`summariser 402 (${c.label}): no summary is attached`, terminal.summary, undefined);
    }

    const next = await checkCredit(credit.options);
    eq(`summariser 402 (${c.label}): the next check re-queries inside the TTL`, credit.lookups(), 2);
    eq(`summariser 402 (${c.label}): the next request is refused as budget_exhausted`, next, { ok: false, reason: 'budget_exhausted' });
  }
  invalidateCreditCache();
}

async function testA402InTheExpiryTurnStillInvalidates(): Promise<void> {
  section('machine — a 402 landing in the turn the budget elapses: expiry ends the run, the cache is still invalidated');

  invalidateCreditCache();
  const credit = creditOptions([10, 0]);
  eq('402 at expiry: the primed check admits', await checkCredit(credit.options), { ok: true });

  const clock = new ManualClock();
  const trace: RunTrace = { generationIds: [] };
  const creditErrorAsBudgetElapses: StreamFactory = () => {
    const error = new OpenRouterCreditError('OpenRouter: payment required (402)');
    let rejectUsage!: (err: unknown) => void;
    const usage = new Promise<Usage>((_resolve, reject) => {
      rejectUsage = reject;
    });
    return {
      deltas: (async function* (): AsyncGenerator<ModelDelta> {
        yield { kind: 'text', text: 'partial ' };
        clock.advance(MAX_RUN_MS);
        rejectUsage(error);
        throw error;
      })(),
      usage,
      id: Promise.resolve(undefined),
    };
  };
  const machine = new GenerationMachine(baseDeps({
    model: sequencedModel([textStream(VALID_PLAN_JSON), creditErrorAsBudgetElapses]),
    clock,
    maxRunMs: MAX_RUN_MS,
  }));
  const settled = await settles('402 at expiry: the run ends', collect(machine.run(NEW_APP_REQUEST, undefined, trace)));
  if (settled.ok) {
    assertCompletedEnvelope('402 at expiry', settled.value);
    eq('402 at expiry: the first ending (the budget) names the failure', lastFailure(settled.value)?.reason, EXPIRED_COPY);
    eq('402 at expiry: RunTrace.outcome is expired', trace.outcome, 'expired');
    eq('402 at expiry: the next request is still refused as budget_exhausted', await checkCredit(credit.options), { ok: false, reason: 'budget_exhausted' });
  }
  invalidateCreditCache();
}

async function testRunTraceOutcomeAndBudgetDefaults(): Promise<void> {
  section('machine — RunTrace.outcome for every ending, and the budget\'s default and validation');

  {
    const clock = new ManualClock();
    const controller = new AbortController();
    controller.abort();
    const trace: RunTrace = { generationIds: [] };
    const events = await collect(new GenerationMachine(baseDeps({
      model: new ScriptedModelClient(ROSTER, [engineerTurn([VALID_PLAN_JSON])]),
      clock,
    })).run(NEW_APP_REQUEST, controller.signal, trace));
    eq('aborted before start: no events', events.length, 0);
    eq('aborted before start: RunTrace.outcome is aborted', trace.outcome, 'aborted');
    eq('aborted before start: no deadline is ever armed', clock.armedDelays, []);
  }

  {
    const clock = new ManualClock();
    const trace: RunTrace = { generationIds: [] };
    const machine = new GenerationMachine(baseDeps({
      model: new ScriptedModelClient(ROSTER, [engineerTurn([VALID_PLAN_JSON]), engineerTurn(['export default {};'])]),
      clock,
    }));
    for await (const event of machine.run(NEW_APP_REQUEST, undefined, trace)) {
      if (event.type === 'stage') break;
    }
    eq('consumer returns early: RunTrace.outcome is aborted', trace.outcome, 'aborted');
    eq('consumer returns early: no timer is left armed', clock.pending, 0);
    eq('default budget: the deadline is armed for 600000 ms', clock.armedDelays, [600_000]);
  }

  const machineWithBudget = (maxRunMs: number): GenerationMachine =>
    new GenerationMachine(baseDeps({ model: new ScriptedModelClient(ROSTER, []), maxRunMs }));
  for (const maxRunMs of [0, -1, 1.5, Number.NaN]) {
    const threw = await caught(() => {
      machineWithBudget(maxRunMs);
    });
    check(`maxRunMs ${maxRunMs}: the constructor throws RangeError`, threw instanceof RangeError);
  }

  // The production clock has no `setTimer`: the budget must still hold on the host's timers.
  const probe = newStallProbe();
  const trace: RunTrace = { generationIds: [] };
  const machine = new GenerationMachine(baseDeps({
    model: sequencedModel([textStream(VALID_PLAN_JSON), stalledStream(probe)]),
    clock: { now: () => Date.now() },
    maxRunMs: 1,
  }));
  const settled = await settles('host timers: the run ends', collect(machine.run(NEW_APP_REQUEST, undefined, trace)));
  if (settled.ok) {
    eq('host timers: the stalled run ends in the budget prose', lastFailure(settled.value)?.reason, EXPIRED_COPY);
    eq('host timers: RunTrace.outcome is expired', trace.outcome, 'expired');
  }
}

// ── Entry point ────────────────────────────────────────────────────────────

export async function runMachineTests(): Promise<void> {
  testPlanParsing();
  testPlanValidation();
  await testHappyPath();
  await testThinkingEvents();
  await testRepairThenSuccess();
  await testRepairCapExhaustion();
  await testPlanReaskThenFailure();
  await testWarningsOnlyOneRepairThenDeliver();
  await testRepairPromptGetsWholeCurrentRoundErrorsFirst();
  await testVerbTimeRunDiagnosticRoutesToRepairAndDeliversNoRecord();
  await testContainmentFailureShortCircuit();
  await testUnobservedVerdictIsTerminalWithItsOwnReason();
  await testStageThrowYieldsOneFailure();
  await testAbortBeforeStart();
  await testAbortDuringGenerateTokens();
  await testAbortDuringCheck();
  await testAbortDuringRun();
  await testAbortIsIdempotentAndQuiet();
  await testAbortAtEveryStageBoundary();
  await testAbortAtDiagnosticAndCompletionBoundaries();
  await testModelStreamThrowYieldsOneFailure();
  await testUsageRejectionAfterDeltasLogsAtThrowSite();
  await testRepairBudgetsAreConstructorInjectable();
  await testRunTraceCollectsGenerationIds();
  await testBuildFailureBecomesADiagnosticAndIsRepairable();
  await testDeadlineEndsAStalledModelInOneFailure();
  await testClientAbortBeforeDeadlineEndsSilently();
  await testDeadlineInTheTurnAModelCallResolves();
  await testDeadlineAfterTheCompletionEnvelopeStartsIsInert();
  await testDeadlineDuringRepair();
  await testDeadlineAbortsTheSyntheticRun();
  await testClientAbortRightAfterTheDeadline();
  await testCreditExhaustedMidGenerate();
  await testCreditExhaustedDuringRepair();
  await testCreditExhaustedInvalidatesTheCreditCache();
  await testTheProviderClientsHttp402IsRecognised();
  await testA402InTheExpiryTurnStillInvalidates();
  await testMidStreamCreditFrameEndsTheRun();
  await testSummariserCreditErrorStillInvalidatesTheCache();
  await testRunTraceOutcomeAndBudgetDefaults();
}
