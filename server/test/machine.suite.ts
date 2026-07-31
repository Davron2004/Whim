/**
 * server/test/machine.suite.ts — chain-4's suite: `plan.ts`'s parser/validator directly, and the
 * state machine end to end against fake `CheckStage`/`BuildStage`/`RunStage`/`Clock` (design D2) —
 * no Chromium, no network, no `checks/index.ts`, no `typescript` import. Deterministic throughout:
 * every model call goes through `ScriptedModelClient` (or a tiny hand-rolled `ModelClient` fake for
 * the abort-mid-stream cases) and the whole file passes with `OPENROUTER_API_KEY` unset.
 */
import { check, eq, section } from './harness';
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
import type { ModelClient, ModelRoster, ModelStream } from '../src/generation/model';
import type { PromptInputs } from '../src/generation/prompts/inputs';
import type { Diagnostic, GenerateRequest, GenerationEvent } from '@whim/contract';

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

  eq('repair-then-success: repair pairs', stageEvents(events, 'repair').map((e) => e.status), ['start', 'done']);
  check('repair-then-success: repair events carry attempt:1', stageEvents(events, 'repair').every((e) => e.type === 'stage' && e.attempt === 1));
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

  eq('warnings-only: exactly one repair pair', stageEvents(events, 'repair').length, 2);
  eq('warnings-only: run begins exactly once (only after the sub-budget is spent)', stageEvents(events, 'run').length, 2);
  eq('warnings-only: both warnings streamed as diagnostic events', events.filter((e) => e.type === 'diagnostic').length, 2);
  eq('warnings-only: exactly one terminal event', terminals(events).length, 1);
  check('warnings-only: terminal is a result (delivered despite residual warnings)', events[events.length - 1].type === 'result');
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
  const model: ModelClient = {
    stream(req): ModelStream {
      calls += 1;
      if (calls === 1) {
        return {
          deltas: (async function* () {
            yield VALID_PLAN_JSON;
          })(),
          usage: Promise.resolve(ZERO_USAGE),
          id: Promise.resolve(undefined),
        };
      }
      return {
        deltas: (async function* () {
          yield 'partial ';
          controller.abort();
          yield 'never observed';
        })(),
        usage: Promise.resolve(ZERO_USAGE),
        id: Promise.resolve(undefined),
      };
    },
  };
  const machine = new GenerationMachine(baseDeps({ model }));
  const events = await collect(machine.run(NEW_APP_REQUEST, controller.signal));

  eq('abort during generate: exactly one token event before the abort was observed', events.filter((e) => e.type === 'token').length, 1);
  eq('abort during generate: no generate:done event', stageEvents(events, 'generate').filter((e) => e.status === 'done').length, 0);
  eq('abort during generate: no terminal event', terminals(events).length, 0);
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

async function testRepairBudgetsAreConstructorInjectable(): Promise<void> {
  section('machine — planAttempts/repairAttempts/warningRepairAttempts are constructor parameters');

  const model = new ScriptedModelClient(ROSTER, [engineerTurn([DANGLING_INITIAL_PLAN_JSON])]);
  const deps = baseDeps({ model, bounds: { planAttempts: 1, repairAttempts: 0, warningRepairAttempts: 0 } });
  const machine = new GenerationMachine(deps);
  const events = await collect(machine.run(NEW_APP_REQUEST));

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

  eq('build failure: exactly one repair pair', stageEvents(events, 'repair').length, 2);
  const buildFailureDiagnostics = events.filter((e) => e.type === 'diagnostic' && e.diagnostic.kind === 'build_failure');
  eq('build failure: build_failure streamed as a diagnostic', buildFailureDiagnostics.length, 1);
  eq('build failure: exactly one terminal event', terminals(events).length, 1);
  check('build failure: terminal is a result once the rebuilt candidate builds', events[events.length - 1].type === 'result');
}

// ── Entry point ────────────────────────────────────────────────────────────

export async function runMachineTests(): Promise<void> {
  testPlanParsing();
  testPlanValidation();
  await testHappyPath();
  await testRepairThenSuccess();
  await testRepairCapExhaustion();
  await testPlanReaskThenFailure();
  await testWarningsOnlyOneRepairThenDeliver();
  await testContainmentFailureShortCircuit();
  await testStageThrowYieldsOneFailure();
  await testAbortBeforeStart();
  await testAbortDuringGenerateTokens();
  await testAbortDuringCheck();
  await testAbortDuringRun();
  await testAbortIsIdempotentAndQuiet();
  await testRepairBudgetsAreConstructorInjectable();
  await testRunTraceCollectsGenerationIds();
  await testBuildFailureBecomesADiagnosticAndIsRepairable();
}
