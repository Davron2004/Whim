/**
 * Pipeline interface + stub implementation.
 * The real pipeline (OpenRouter-backed) replaces the stub internals behind this same interface.
 */
import type { GenerateRequest, GenerationEvent, WireAppRecord } from '@whim/contract';

export interface Pipeline {
  run(request: GenerateRequest): AsyncIterable<GenerationEvent>;
}

/** Fixed WireAppRecord emitted on success. */
const STUB_APP_RECORD: WireAppRecord = {
  name: 'stub-app',
  source: "import { Screen, Text } from 'vc-sdk'; export default defineApp({ render: () => <Screen><Text>Hello</Text></Screen> });",
  bundle: '(()=>{ /* stub bundle */ })();',
  sourceMap: undefined,
  manifest: { capabilities: [] },
  schema: {},
};

/** Factory for the stub pipeline with injectable inter-event delay. */
export function createStubPipeline(delayMs = 200): Pipeline {
  return {
    run(request: GenerateRequest): AsyncIterable<GenerationEvent> {
      return stubRun(request, delayMs);
    },
  };
}

async function* stubRun(
  request: GenerateRequest,
  delayMs: number,
): AsyncIterable<GenerationEvent> {
  const delay = (ms: number): Promise<void> =>
    ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve();

  const isFailure = request.prompt.includes('[[fail]]');

  // Stages: plan → generate (with tokens) → check → run
  const stages: Array<'plan' | 'generate' | 'check' | 'run'> = [
    'plan',
    'generate',
    'check',
    'run',
  ];

  for (const stage of stages) {
    await delay(delayMs);
    yield { type: 'stage', stage, status: 'start' };

    if (stage === 'generate' && !isFailure) {
      // Emit a few token events during generate
      for (const text of ['Hello', ' ', 'World', '!']) {
        await delay(delayMs);
        yield { type: 'token', text };
      }
    }

    await delay(delayMs);
    yield { type: 'stage', stage, status: 'done' };
  }

  // Usage event always precedes the terminal
  await delay(delayMs);
  yield {
    type: 'usage',
    usage: { promptTokens: 42, completionTokens: 128, totalTokens: 170 },
  };

  // Terminal event
  await delay(delayMs);
  if (isFailure) {
    yield {
      type: 'failure',
      reason: 'Could not produce a buildable app after maximum attempts.',
      attempts: 3,
      diagnostics: [{ kind: 'BUILD_FAILURE', hint: 'Try a simpler prompt.' }],
    };
  } else {
    yield { type: 'result', app: STUB_APP_RECORD };
  }
}
