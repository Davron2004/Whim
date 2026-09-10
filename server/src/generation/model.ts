/**
 * server/src/generation/model.ts — the ONE seam through which the pipeline reaches a language
 * model (design D3, spec "Every model call goes through an injectable client"). `ModelClient` is
 * the interface every stage of the pipeline codes against; `OpenRouterClient` (../openrouter.ts)
 * is one adapter behind it, wired via `openRouterModelClient`. Tests never construct
 * `OpenRouterClient` — they use `ScriptedModelClient` (server/test/scripted-model.ts).
 *
 * Model ids are NEVER literals here or anywhere under server/src/generation/ (tripwire in
 * server/test/prompts.suite.ts): a `ModelRequest.model` is always a value the caller read out of
 * a `ModelRoster`, and the roster itself is read from the environment by `modelRosterFromEnv`.
 */
import type { OpenRouterClient } from '../openrouter';
import type { Usage } from '@whim/contract';

// ─── Wire-agnostic message/stream shapes ────────────────────────────────────

export interface ModelMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ModelRequest {
  /** The resolved model id for this turn — the caller picks it via a `ModelRoster`; a
   *  `ModelClient`/adapter NEVER resolves a role to an id itself. */
  model: string;
  messages: ModelMessage[];
  maxTokens?: number;
  temperature?: number;
  /** Ask the provider to surface its reasoning stream (`ModelDelta`'s `'reasoning'` kind) rather
   *  than emitting only visible text. OpenRouter hides a roster model's reasoning by default; the
   *  generation machine sets this `true` for every engineer turn (plan/generate/repair) so the
   *  device can show "thinking" instead of going quiet while the model works. The rewrite and
   *  clarify routes leave it unset — their replies are unary JSON, not a stream a device watches,
   *  so there is nothing to surface reasoning INTO. */
  reasoning?: boolean;
}

/** One streamed unit from a model turn: either visible completion text (`'text'`) or reasoning the
 *  model emits before/between writing (`'reasoning'`, roster models on OpenRouter — see
 *  `../openrouter.ts`'s `emitFrame`). Consumers that only care about the model's actual output
 *  (route handlers building JSON, the summariser) accumulate `kind === 'text'` only; a caller that
 *  wants to surface reasoning as it happens (the generation machine's `thinking` event) reads the
 *  `'reasoning'` deltas too, but the reasoning TEXT itself is discarded there by design — only its
 *  length crosses the wire (contract `GenerationEvent`'s `thinking` variant). */
export type ModelDelta = { kind: 'text'; text: string } | { kind: 'reasoning'; text: string };

/** Structurally identical to `OpenRouterClient.stream`'s `StreamResult` (design D3) — the
 *  adapter below is a thin pass-through, not a re-shaping. */
export interface ModelStream {
  deltas: AsyncIterable<ModelDelta>;
  usage: Promise<Usage>;
  id: Promise<string | undefined>;
}

export interface ModelClient {
  stream(req: ModelRequest, signal?: AbortSignal): ModelStream;
}

// ─── Roster: per-role model ids, read from the environment ─────────────────

export type ModelRole = 'rewrite' | 'engineer';

export interface ModelRoster {
  rewrite: string;
  engineer: string;
}

const REWRITE_MODEL_ENV = 'WHIM_REWRITE_MODEL';
const ENGINEER_MODEL_ENV = 'WHIM_ENGINEER_MODEL';

/** Thrown by `modelRosterFromEnv` when one or both roster variables are unset. Actionable: names
 *  every missing variable so a caller can fix its environment in one read. */
export class ModelRosterEnvError extends Error {
  constructor(public readonly missing: readonly string[]) {
    super(
      `Missing model roster environment variable(s): ${missing.join(', ')}. Set ${REWRITE_MODEL_ENV} ` +
        `and ${ENGINEER_MODEL_ENV} to the OpenRouter model ids for each role before constructing a ` +
        `live-model pipeline.`,
    );
    this.name = 'ModelRosterEnvError';
  }
}

/** Read the per-role model roster from the environment. Throws `ModelRosterEnvError` naming every
 *  missing variable — never falls back to a hard-coded id. */
export function modelRosterFromEnv(env: NodeJS.ProcessEnv = process.env): ModelRoster {
  const rewrite = env[REWRITE_MODEL_ENV];
  const engineer = env[ENGINEER_MODEL_ENV];
  const missing = [
    ...(rewrite ? [] : [REWRITE_MODEL_ENV]),
    ...(engineer ? [] : [ENGINEER_MODEL_ENV]),
  ];
  if (missing.length > 0 || !rewrite || !engineer) throw new ModelRosterEnvError(missing);
  return { rewrite, engineer };
}

// ─── The OpenRouter adapter ──────────────────────────────────────────────────

/**
 * Adapt an `OpenRouterClient` to `ModelClient`. A thin pass-through (design D3): `ModelRequest`
 * already carries the resolved model id and provider-agnostic messages, so this maps field names
 * 1:1 onto `OpenRouterOptions` and forwards the abort signal — no role resolution, no roster
 * lookup, no model-id literal.
 */
export function openRouterModelClient(client: OpenRouterClient): ModelClient {
  return {
    stream(req: ModelRequest, signal?: AbortSignal): ModelStream {
      return client.stream({
        model: req.model,
        messages: req.messages,
        maxTokens: req.maxTokens,
        temperature: req.temperature,
        reasoning: req.reasoning,
        signal,
      });
    },
  };
}
