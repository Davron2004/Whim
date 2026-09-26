/**
 * Pipeline interface + stub implementation.
 * The real pipeline (OpenRouter-backed) replaces the stub internals behind this same interface.
 */
import type { GenerateRequest, GenerationEvent, WireAppRecord } from '@whim/contract';
import { buildCandidateSource } from '../../synthrun/builder';
import { stubFutureEvent, stubFutureFallback } from './stub-markers';

/** The app every stub build delivers: a day checklist (the stub rewrite's canned plan describes it).
 *  Its one screen is taller than a phone, so the last element, the Clear done button, has to scroll
 *  clear of the host's orb. Local state only: no capability, no schema. */
const STUB_APP_SOURCE = `import { defineApp, Screen, Stack, Row, Heading, Text, TextInput, Button, Checkbox, ProgressBar, useState } from 'vc-sdk';

const STARTERS = [
  'Drink a glass of water',
  'Stretch for five minutes',
  'Make the bed',
  'Reply to one message',
  'Plan lunch',
  'Take a short walk',
  'Tidy the desk',
  'Water the plants',
  'Read ten pages',
  'Call someone you like',
  'Put the laundry on',
  'Check the calendar for tomorrow',
  'Take out the recycling',
  'Write down one good thing',
  'Charge your phone',
  'Lay out clothes for tomorrow',
];

function Today() {
  const [tasks, setTasks] = useState(STARTERS.map((title, id) => ({ id, title, done: false })));
  const [draft, setDraft] = useState('');
  const [nextId, setNextId] = useState(STARTERS.length);
  const done = tasks.filter((task) => task.done).length;

  const add = () => {
    const title = draft.trim();
    if (title === '') return;
    setTasks([...tasks, { id: nextId, title, done: false }]);
    setNextId(nextId + 1);
    setDraft('');
  };
  const tick = (id: number, checked: boolean) => {
    setTasks(tasks.map((task) => (task.id === id ? { ...task, done: checked } : task)));
  };

  return (
    <Screen padding="lg">
      <Stack gap="lg">
        <Heading size="title">Today</Heading>
        <Text color="text-muted">{done + ' of ' + tasks.length + ' done'}</Text>
        <ProgressBar value={tasks.length === 0 ? 0 : done / tasks.length} tone="positive" />
        <Row gap="sm" align="center">
          <TextInput value={draft} placeholder="Add a task" onChange={setDraft} />
          <Button label="Add" disabled={draft.trim() === ''} onPress={add} />
        </Row>
        <Stack gap="sm">
          {tasks.map((task) => (
            <Checkbox key={task.id} label={task.title} checked={task.done} onChange={(checked) => tick(task.id, checked)} />
          ))}
        </Stack>
        <Button label="Clear done" variant="secondary" disabled={done === 0} onPress={() => setTasks(tasks.filter((task) => !task.done))} />
      </Stack>
    </Screen>
  );
}

export default defineApp({ name: 'Hello App', initial: 'Today', screens: { Today }, capabilities: [] });
`;

export interface Pipeline {
  /**
   * `signal`, when provided, is honored by every implementation (stub included): on abort the
   * returned generator stops emitting events and returns early, without a terminal event.
   */
  run(request: GenerateRequest, signal?: AbortSignal): AsyncIterable<GenerationEvent>;
}

/**
 * Built once (memoized) rather than per-request: `createStubPipeline` can be constructed
 * multiple times within a single test run, and the real H1b esbuild call is comparatively
 * expensive to repeat for a fixed, prompt-independent stub source.
 */
let stubBuildPromise: Promise<{ js: string; map: string }> | undefined;

function buildStubRecord(): Promise<{ js: string; map: string }> {
  stubBuildPromise ??= buildCandidateSource(STUB_APP_SOURCE, { filenameHint: 'stub-app' });
  return stubBuildPromise;
}

/** Factory for the stub pipeline with injectable inter-event delay. */
export function createStubPipeline(delayMs = 200): Pipeline {
  return {
    run(request: GenerateRequest, signal?: AbortSignal): AsyncIterable<GenerationEvent> {
      return stubRun(request, delayMs, signal);
    },
  };
}

/**
 * Signal-aware delay: resolves after `ms`, or early (clearing its timer) if `signal` aborts
 * first. Never rejects — an abort is a normal, expected way for this promise to settle.
 */
function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0 || signal?.aborted) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const onAbort = (): void => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Emits one stage's full event sequence (start → optional token sub-loop → done), each
 * preceded by a signal-aware delay. Returns `true` as soon as an abort is observed at any exit
 * point, so the caller can stop the whole stream without emitting a terminal event.
 */
async function* emitStage(
  stage: 'plan' | 'generate' | 'check' | 'run',
  delayMs: number,
  isFailure: boolean,
  signal?: AbortSignal,
): AsyncGenerator<GenerationEvent, boolean> {
  await delay(delayMs, signal);
  if (signal?.aborted) return true;
  yield { type: 'stage', stage, status: 'start' };

  if (stage === 'generate' && !isFailure) {
    // Emit a few token events during generate
    for (const text of ['Hello', ' ', 'World', '!']) {
      await delay(delayMs, signal);
      if (signal?.aborted) return true;
      yield { type: 'token', text };
    }
  }

  await delay(delayMs, signal);
  if (signal?.aborted) return true;
  yield { type: 'stage', stage, status: 'done' };

  return false;
}

/** Emits the usage event followed by the single terminal (failure or result) event. */
async function* emitTerminal(
  delayMs: number,
  isFailure: boolean,
  signal?: AbortSignal,
): AsyncGenerator<GenerationEvent, void> {
  // Usage event always precedes the terminal
  await delay(delayMs, signal);
  if (signal?.aborted) return;
  yield {
    type: 'usage',
    usage: { promptTokens: 42, completionTokens: 128, totalTokens: 170 },
  };

  // Terminal event
  await delay(delayMs, signal);
  if (signal?.aborted) return;
  if (isFailure) {
    yield {
      type: 'failure',
      reason: 'Could not produce a buildable app after maximum attempts.',
      attempts: 3,
      diagnostics: [{ kind: 'BUILD_FAILURE', hint: 'Try a simpler prompt.' }],
    };
  } else {
    const { js, map } = await buildStubRecord();
    const app: WireAppRecord = {
      name: 'Hello App',
      source: STUB_APP_SOURCE,
      bundle: js,
      sourceMap: map,
      manifest: { capabilities: [] },
      schema: {},
    };
    yield { type: 'result', app };
  }
}

async function* stubRun(
  request: GenerateRequest,
  delayMs: number,
  signal?: AbortSignal,
): AsyncIterable<GenerationEvent> {
  const isFailure = request.prompt.includes('[[fail]]');
  const future = stubFutureFallback(request.prompt);

  // Stages: plan → generate (with tokens) → check → run
  const stages: Array<'plan' | 'generate' | 'check' | 'run'> = [
    'plan',
    'generate',
    'check',
    'run',
  ];

  for (const stage of stages) {
    const aborted = yield* emitStage(stage, delayMs, isFailure, signal);
    if (aborted) return;
    if (stage === 'plan' && future !== undefined) {
      // A `[[future:*]]` marker (`stub-markers.ts`): after the plan stage, one event of a type the
      // app can't know, which the route sends as its envelope; then the stream carries on as the
      // stub always does — the app follows the event's fallback. Outside `GenerationEvent` on
      // purpose, so it is cast rather than typed.
      await delay(delayMs, signal);
      if (signal?.aborted) return;
      yield stubFutureEvent(future) as unknown as GenerationEvent;
    }
  }

  yield* emitTerminal(delayMs, isFailure, signal);
}
