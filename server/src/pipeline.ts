/**
 * Pipeline interface + stub implementation.
 * The real pipeline (OpenRouter-backed) replaces the stub internals behind this same interface.
 */
import type { GenerateRequest, GenerationEvent, WireAppRecord } from '@whim/contract';

export interface Pipeline {
  /**
   * `signal`, when provided, is honored by every implementation (stub included): on abort the
   * returned generator stops emitting events and returns early, without a terminal event.
   */
  run(request: GenerateRequest, signal?: AbortSignal): AsyncIterable<GenerationEvent>;
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

async function* stubRun(
  request: GenerateRequest,
  delayMs: number,
  signal?: AbortSignal,
): AsyncIterable<GenerationEvent> {
  const isFailure = request.prompt.includes('[[fail]]');

  // Stages: plan → generate (with tokens) → check → run
  const stages: Array<'plan' | 'generate' | 'check' | 'run'> = [
    'plan',
    'generate',
    'check',
    'run',
  ];

  for (const stage of stages) {
    await delay(delayMs, signal);
    if (signal?.aborted) return;
    yield { type: 'stage', stage, status: 'start' };

    if (stage === 'generate' && !isFailure) {
      // Emit a few token events during generate
      for (const text of ['Hello', ' ', 'World', '!']) {
        await delay(delayMs, signal);
        if (signal?.aborted) return;
        yield { type: 'token', text };
      }
    }

    await delay(delayMs, signal);
    if (signal?.aborted) return;
    yield { type: 'stage', stage, status: 'done' };
  }

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
    yield { type: 'result', app: STUB_APP_RECORD };
  }
}
