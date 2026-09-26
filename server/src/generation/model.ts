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
import type { ServerLogger } from '../logger';

// ─── Wire-agnostic message/stream shapes ────────────────────────────────────

export interface ModelMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** Every model call's explicit reasoning mode (design D1, spec "Every model call states its
 *  reasoning mode"). `off`/`on` map to the provider's `reasoning.enabled`; `low`/`medium`/`high` to
 *  `reasoning.effort`; `default` sends no `reasoning` field at all (today's implicit behavior,
 *  restorable per role without a redeploy). The wire mapping lives in ONE place —
 *  `../openrouter.ts`'s `requestBody`. */
export type ReasoningSetting = 'off' | 'on' | 'low' | 'medium' | 'high' | 'default';

/** Attributes a model call for the per-call `model call` log line (design D4) and for test
 *  assertions. Distinct from `ModelRole` (the roster's own keys): the content-policy classifier
 *  labels itself `policy` while still resolving its model from the roster's `rewrite` role. */
export type ModelCallLabel = 'policy' | 'clarify' | 'rewrite' | 'summary' | 'plan' | 'generate' | 'repair';

export interface ModelRequest {
  /** The resolved model id for this turn — the caller picks it via a `ModelRoster`; a
   *  `ModelClient`/adapter NEVER resolves a role to an id itself. */
  model: string;
  messages: ModelMessage[];
  maxTokens?: number;
  temperature?: number;
  /** REQUIRED (design D1): the type checker rejects a call site that forgets to decide. A roster
   *  role's own setting (`RoleSetting.reasoning`) is the usual source; the content-policy classifier
   *  is the one call site that always states `'off'` directly, never through the roster. */
  reasoning: ReasoningSetting;
  /** Required so every call is attributable (design D4) — see `ModelCallLabel`'s doc comment. */
  role: ModelCallLabel;
  /** The request-bound logger (spec request-envelope "One request id follows a /v1 request
   *  everywhere") — when present, the adapter's `model call` line uses THIS instead of its own
   *  module logger, so the line carries the same `requestId` as the rest of that request. Bound
   *  with `requestId` only: a logger that already carries a `scope` (a run or route logger) would
   *  put a second `scope` key on the line beside the adapter's own. Absent
   *  for a call made outside any request (flowbench, load test, admin scripts), which keeps
   *  logging through the module logger exactly as before. */
  logger?: ServerLogger;
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

/** True when a model call failed because the operator's provider credit is exhausted (HTTP 402,
 *  design D6b). Structural so it stays provider-agnostic: an adapter signals it by throwing an
 *  error whose `status` is `402`, as `OpenRouterCreditError` does. */
export function isCreditExhaustedError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { status?: unknown }).status === 402;
}

/** True when a model call failed upstream, at the provider or on the way to it, rather than on the
 *  request itself (beta-1 D10): a 5xx, a 429, or a network or stream failure with no status. A
 *  401, a 402, any other 4xx and every non-provider error are not. Structural, like
 *  `isCreditExhaustedError`: an adapter signals it with `kind: 'rate_limit'`, or `kind: 'network'`
 *  and a `status` that is absent or at least 500, as `../openrouter.ts`'s errors do. */
export function isUpstreamModelFailure(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const { kind, status } = err as { kind?: unknown; status?: unknown };
  if (kind === 'rate_limit') return true;
  return kind === 'network' && (status === undefined || (typeof status === 'number' && status >= 500));
}

// ─── Roster: per-role model ids and reasoning settings, read from the environment ──

/** The roster's own roles (design D2) — the keys of `ModelRoster`. The content-policy classifier
 *  is deliberately NOT one of these: it resolves its model from the `rewrite` role and always
 *  states `reasoning: 'off'` directly (spec content-policy "adds no new model role or model id"). */
export type ModelRole = 'clarify' | 'rewrite' | 'summary' | 'plan' | 'engineer' | 'repair';

export interface RoleSetting {
  model: string;
  reasoning: ReasoningSetting;
}

/** The clarify role also fixes its sampling temperature. Clarify chooses between a `limit` and
 *  questions, and at the provider's default temperature one prompt got either (beta-1 fix-6), so
 *  it samples at `CLARIFY_TEMPERATURE`. No other role has one: their requests state no temperature,
 *  which leaves the provider's default. */
export interface ClarifySetting extends RoleSetting {
  temperature: number;
}

export type ModelRoster = Record<Exclude<ModelRole, 'clarify'>, RoleSetting> & { clarify: ClarifySetting };

const CLARIFY_TEMPERATURE = 0;

const REWRITE_MODEL_ENV = 'WHIM_REWRITE_MODEL';
const ENGINEER_MODEL_ENV = 'WHIM_ENGINEER_MODEL';
const CLARIFY_MODEL_ENV = 'WHIM_CLARIFY_MODEL';
const SUMMARY_MODEL_ENV = 'WHIM_SUMMARY_MODEL';
const PLAN_MODEL_ENV = 'WHIM_PLAN_MODEL';
const REPAIR_MODEL_ENV = 'WHIM_REPAIR_MODEL';

/** `WHIM_<ROLE>_REASONING` per roster role, and each one's default (design D2's table). */
const REASONING_ENV: Record<ModelRole, string> = {
  clarify: 'WHIM_CLARIFY_REASONING',
  rewrite: 'WHIM_REWRITE_REASONING',
  summary: 'WHIM_SUMMARY_REASONING',
  plan: 'WHIM_PLAN_REASONING',
  engineer: 'WHIM_ENGINEER_REASONING',
  repair: 'WHIM_REPAIR_REASONING',
};

const REASONING_DEFAULTS: Record<ModelRole, ReasoningSetting> = {
  clarify: 'off',
  rewrite: 'off',
  summary: 'off',
  plan: 'on',
  engineer: 'on',
  repair: 'on',
};

const REASONING_SETTINGS: readonly ReasoningSetting[] = ['off', 'on', 'low', 'medium', 'high', 'default'];

/** Thrown by `modelRosterFromEnv` when one or both REQUIRED roster variables are unset. Actionable:
 *  names every missing variable so a caller can fix its environment in one read. */
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

/** Thrown by `modelRosterFromEnv` when a `WHIM_<ROLE>_REASONING` variable is set to a value outside
 *  `ReasoningSetting`'s set. Actionable: names the exact variable and the allowed values, the same
 *  fail-fast shape every other `WHIM_*` configuration error takes (`ServerConfigError`,
 *  `../config.ts`) — surfaced the same way, through configuration loading at boot. */
export class ModelRosterReasoningError extends Error {
  constructor(
    public readonly variable: string,
    public readonly value: string,
  ) {
    super(`${variable} must be one of ${REASONING_SETTINGS.join(', ')}, got ${JSON.stringify(value)}.`);
    this.name = 'ModelRosterReasoningError';
  }
}

/** Empty counts as unset (design D2). */
function readModelOverride(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const raw = env[name];
  return raw && raw.trim().length > 0 ? raw : undefined;
}

function readReasoning(env: NodeJS.ProcessEnv, role: ModelRole, fallback = REASONING_DEFAULTS[role]): ReasoningSetting {
  const name = REASONING_ENV[role];
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  if (!(REASONING_SETTINGS as readonly string[]).includes(raw)) {
    throw new ModelRosterReasoningError(name, raw);
  }
  return raw as ReasoningSetting;
}

/** Read the per-role model roster from the environment (design D2): the two required models
 *  (`WHIM_REWRITE_MODEL`, `WHIM_ENGINEER_MODEL`), the four optional per-role overrides (each
 *  falling back to its family's required model), and the six `WHIM_<ROLE>_REASONING` settings.
 *  Throws `ModelRosterEnvError` naming every missing required variable, or `ModelRosterReasoningError`
 *  naming the first invalid reasoning value — never falls back to a hard-coded id. */
export function modelRosterFromEnv(env: NodeJS.ProcessEnv = process.env): ModelRoster {
  const rewrite = readModelOverride(env, REWRITE_MODEL_ENV);
  const engineer = readModelOverride(env, ENGINEER_MODEL_ENV);
  const missing = [
    ...(rewrite ? [] : [REWRITE_MODEL_ENV]),
    ...(engineer ? [] : [ENGINEER_MODEL_ENV]),
  ];
  if (missing.length > 0 || !rewrite || !engineer) throw new ModelRosterEnvError(missing);

  const clarify = readModelOverride(env, CLARIFY_MODEL_ENV) ?? rewrite;
  const summary = readModelOverride(env, SUMMARY_MODEL_ENV) ?? rewrite;
  const plan = readModelOverride(env, PLAN_MODEL_ENV) ?? engineer;
  const repair = readModelOverride(env, REPAIR_MODEL_ENV) ?? engineer;
  const engineerReasoning = readReasoning(env, 'engineer');

  return {
    clarify: { model: clarify, reasoning: readReasoning(env, 'clarify'), temperature: CLARIFY_TEMPERATURE },
    rewrite: { model: rewrite, reasoning: readReasoning(env, 'rewrite') },
    summary: { model: summary, reasoning: readReasoning(env, 'summary') },
    plan: { model: plan, reasoning: readReasoning(env, 'plan') },
    engineer: { model: engineer, reasoning: engineerReasoning },
    repair: { model: repair, reasoning: readReasoning(env, 'repair', engineerReasoning) },
  };
}

/** Test helper: the full roster — every role's default reasoning setting, no overrides — built
 *  from just the two required model ids. The shape `modelRosterFromEnv` produces when only
 *  `WHIM_REWRITE_MODEL`/`WHIM_ENGINEER_MODEL` are set. */
export function defaultModelRoster(rewriteModel: string, engineerModel: string): ModelRoster {
  return {
    clarify: { model: rewriteModel, reasoning: REASONING_DEFAULTS.clarify, temperature: CLARIFY_TEMPERATURE },
    rewrite: { model: rewriteModel, reasoning: REASONING_DEFAULTS.rewrite },
    summary: { model: rewriteModel, reasoning: REASONING_DEFAULTS.summary },
    plan: { model: engineerModel, reasoning: REASONING_DEFAULTS.plan },
    engineer: { model: engineerModel, reasoning: REASONING_DEFAULTS.engineer },
    repair: { model: engineerModel, reasoning: REASONING_DEFAULTS.repair },
  };
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
        role: req.role,
        logger: req.logger,
        signal,
      });
    },
  };
}
