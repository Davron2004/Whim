/**
 * server/src/generation/index.ts — the composition root (design D1/D2, task 7.1). The ONLY file
 * that wires the real `ModelClient` (OpenRouter), the disk-backed prompt inputs, the concrete
 * check/build/run stages, and `GenerationMachine` behind the unchanged `Pipeline` interface
 * (`../pipeline.ts` — untouched, design D1: it keeps its own `Pipeline` interface and
 * `createStubPipeline` verbatim). `machine.ts` itself depends on nothing concrete (design D2).
 */
import { OpenRouterClient } from '../openrouter';
import type { Pipeline } from '../pipeline';
import type { GenerateRequest, GenerationEvent, Usage } from '@whim/contract';
import {
  modelRosterFromEnv,
  openRouterModelClient,
  type ModelClient,
  type ModelRoster,
} from './model';
import { loadPromptInputs } from './prompts/inputs';
import { createCheckStage, preflightSource } from './stages/check';
import { createBuildStage } from './stages/build';
import { createRunStage } from './stages/run';
import { GenerationMachine, type PipelineBounds, type RunTrace } from './machine';
import { createModelSummariser } from './summarise';
import type { GenerationStatsTransport } from './reconcile';
import { createRunCandidate } from '../../../synthrun/report';
import type { SynthRunSession } from '../../../synthrun/session';

const API_KEY_ENV = 'OPENROUTER_API_KEY';

/** Thrown when `OPENROUTER_API_KEY` is unset — actionable: names the exact variable a caller
 *  must set before the real pipeline (or the real rewrite endpoint) can make a model call. */
export class MissingApiKeyError extends Error {
  constructor() {
    super(
      `Missing ${API_KEY_ENV} environment variable. Set it (e.g. in a gitignored .env, never ` +
        `committed) before constructing the real generation pipeline or the real rewrite ` +
        `endpoint. For LAN UI work without spending tokens on full generations, run the server ` +
        `with WHIM_PIPELINE=stub instead.`,
    );
    this.name = 'MissingApiKeyError';
  }
}

export interface ModelDeps {
  model: ModelClient;
  roster: ModelRoster;
  /** Kept alongside `model`/`roster` so a caller (`main.ts`) can build the generation-stats
   *  transport below without re-reading the environment a second time. */
  apiKey: string;
}

/**
 * Reads the model roster and `OPENROUTER_API_KEY` from the environment and constructs the
 * OpenRouter-backed `ModelClient` (task 7.1: "roster and OPENROUTER_API_KEY read from the
 * environment at construction, with a typed actionable error naming the variable when the key is
 * absent"). Never falls back to a hard-coded model id or a silently-empty key. Throws
 * `ModelRosterEnvError` (naming every missing roster variable) or `MissingApiKeyError`.
 */
export function buildModelDepsFromEnv(env: NodeJS.ProcessEnv = process.env): ModelDeps {
  const roster = modelRosterFromEnv(env);
  const apiKey = env[API_KEY_ENV];
  if (!apiKey) throw new MissingApiKeyError();
  return { model: openRouterModelClient(new OpenRouterClient()), roster, apiKey };
}

const GENERATION_STATS_URL = 'https://openrouter.ai/api/v1/generation';

/**
 * The real `GenerationStatsTransport` (design D9, `handoff/run-stage.md`) — OpenRouter's
 * post-hoc generation-stats lookup, used ONLY by `routes/generate.ts`'s post-abort
 * reconciliation, never on the normal crediting path. Never throws: any failure (network,
 * non-2xx, unexpected body shape) resolves `null` — "not yet resolved" — which `reconcile.ts`'s
 * own retry loop already treats identically to a transport rejection.
 */
export function openRouterGenerationStatsTransport(
  apiKey: string,
  fetchFn: typeof globalThis.fetch = globalThis.fetch,
): GenerationStatsTransport {
  return {
    async fetchStats(generationId: string): Promise<Usage | null> {
      try {
        const res = await fetchFn(`${GENERATION_STATS_URL}?id=${encodeURIComponent(generationId)}`, {
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        if (!res.ok) return null;
        const body = (await res.json()) as { data?: Record<string, unknown> };
        const data = body.data;
        if (!data) return null;
        const promptTokens = Number(data.tokens_prompt ?? data.native_tokens_prompt ?? 0);
        const completionTokens = Number(data.tokens_completion ?? data.native_tokens_completion ?? 0);
        if (!Number.isFinite(promptTokens) || !Number.isFinite(completionTokens)) return null;
        return { promptTokens, completionTokens, totalTokens: promptTokens + completionTokens };
      } catch {
        return null;
      }
    },
  };
}

export interface CreatePipelineOptions {
  /** The already-launched synthetic-run session this process's pipeline uses for its whole
   *  lifetime (`handoff/run-stage.md`'s "one session per pipeline, per-run slot") — this module
   *  binds `createRunStage` to it but owns no launch/close lifecycle; `main.ts` (task 7.4)
   *  launches and closes it. */
  session: SynthRunSession;
  /** Reuse an already-built `ModelDeps` (e.g. `main.ts` sharing one construction between the
   *  pipeline and `/v1/rewrite`) instead of reading the environment again. */
  modelDeps?: ModelDeps;
  env?: NodeJS.ProcessEnv;
  bounds?: Partial<PipelineBounds>;
}

/**
 * The real generation pipeline (design D1/D2, task 7.1). Loads the disk-backed prompt inputs
 * once, composes the concrete check/build/run stages with `GenerationMachine`, and applies
 * `preflightSource` to `request.app.source` before the machine (and therefore any prompt) ever
 * reads it — chain 5 exported `preflightSource` but deliberately left it unwired for this chain
 * (`handoff/stage-contracts.md`): a supplied source that fails the honest-edit check (parse
 * error, or no default-exported `defineApp`) is treated exactly like no source at all, per spec
 * "An edit without original source regenerates honestly."
 */
export function createGenerationPipeline(options: CreatePipelineOptions): Pipeline {
  const { model, roster } = options.modelDeps ?? buildModelDepsFromEnv(options.env);
  const promptInputs = loadPromptInputs();
  const check = createCheckStage();
  const build = createBuildStage();
  const run = createRunStage(createRunCandidate(options.session));
  const clock = { now: () => Date.now() };

  const machine = new GenerationMachine({
    model,
    roster,
    promptInputs,
    check,
    build,
    run,
    clock,
    summariser: createModelSummariser({ model, roster }),
    bounds: options.bounds,
  });

  return {
    run(request: GenerateRequest, signal?: AbortSignal, trace?: RunTrace): AsyncIterable<GenerationEvent> {
      const preflighted: GenerateRequest = request.app
        ? { ...request, app: { ...request.app, source: preflightSource(request.app.source) } }
        : request;
      return machine.run(preflighted, signal, trace);
    },
  };
}
