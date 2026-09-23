/**
 * OpenRouter client wrapper — model-agnostic, streaming, usage capture.
 *
 * Uses OpenRouter's OpenAI-compatible chat-completions endpoint over SSE.
 * The model id is always a caller parameter (never embedded — decision #42).
 * The transport (fetch) is injectable for testing against recorded frames.
 * OPENROUTER_API_KEY is read from process.env only, and only when invoked.
 *
 * Reasoning (design D1) and provider routing (design D3) are mapped onto the wire in ONE place,
 * `requestBody`; a per-call timing line (design D4) is logged by `stream` whenever its stream
 * settles — completed, failed, or aborted — with no message content.
 */
import { Usage } from '@whim/contract';
import type { ModelCallLabel, ModelDelta, ReasoningSetting } from './generation/model';
import { log } from './logger';
export { Usage };

const routerLog = log.child({ scope: 'openrouter' });

/** `WHIM_PROVIDER_SORT` (design D3) — global, not per role; `undefined` sends no `provider` field. */
export type ProviderSort = 'price' | 'throughput' | 'latency';

// ─── Typed error classes ─────────────────────────────────────────────────────

/** Authentication failure (HTTP 401). */
export class OpenRouterAuthError extends Error {
  readonly kind = 'auth' as const;
  constructor(message: string) {
    super(message);
    this.name = 'OpenRouterAuthError';
  }
}

/** Rate-limit exceeded (HTTP 429). */
export class OpenRouterRateLimitError extends Error {
  readonly kind = 'rate_limit' as const;
  constructor(message: string) {
    super(message);
    this.name = 'OpenRouterRateLimitError';
  }
}

/** The operator's provider credit is exhausted (HTTP 402). `status` is what provider-agnostic
 *  callers read, through `isCreditExhaustedError` (`./generation/model.ts`). */
export class OpenRouterCreditError extends Error {
  readonly kind = 'credit' as const;
  readonly status = 402 as const;
  constructor(message: string) {
    super(message);
    this.name = 'OpenRouterCreditError';
  }
}

/** Network/transport failure (fetch threw, connection error, etc.). */
export class OpenRouterNetworkError extends Error {
  readonly kind = 'network' as const;
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'OpenRouterNetworkError';
  }
}

// ─── Types ───────────────────────────────────────────────────────────────────

export interface OpenRouterMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface OpenRouterOptions {
  /** Model id — appears verbatim in the outgoing request body. */
  model: string;
  messages: OpenRouterMessage[];
  /** Max tokens to generate. */
  maxTokens?: number;
  /** Temperature (0–1). */
  temperature?: number;
  /** The wire mapping (design D1): `off`→`{enabled:false}`, `on`→`{enabled:true}`,
   *  `low`/`medium`/`high`→`{effort}`, `default` or unset → no `reasoning` field at all (today's
   *  provider-default behavior). `../generation/model.ts`'s `ModelRequest.reasoning` is the required
   *  field every pipeline call site actually decides; this one stays optional so a caller exercising
   *  the wrapper directly (most of this file's own tests) need not restate it. */
  reasoning?: ReasoningSetting;
  /** Attributes this call for the per-call `model call` log line (design D4) — never sent on the
   *  wire. Omitted from the log line when absent. */
  role?: ModelCallLabel;
  /** Optional abort signal, forwarded to the injected transport's request-init. */
  signal?: AbortSignal;
}

/** Result of a streaming completion. */
export interface StreamResult {
  /** Async iterable of deltas in arrival order — both visible text and (roster-dependent)
   *  reasoning, tagged by `ModelDelta.kind` so a consumer can tell them apart. */
  deltas: AsyncIterable<ModelDelta>;
  /** Resolves with the captured usage once the stream ends. */
  usage: Promise<Usage>;
  /**
   * Resolves with the top-level generation `id` parsed from the first SSE
   * chunk — the handle for post-abort usage reconciliation against
   * OpenRouter's generation-stats endpoint (wired in #11). Resolves to
   * `undefined` if the stream ends before any chunk arrives.
   */
  id: Promise<string | undefined>;
}

// ─── Client ──────────────────────────────────────────────────────────────────

/** Injectable fetch type (matches the global `fetch` signature). */
export type FetchFn = typeof globalThis.fetch;

/** A provider failure delivered INSIDE the stream (`data: {"error":{"code":402,...}}`) rather than
 *  as an HTTP status — how OpenRouter reports a mid-stream credit exhaustion or upstream fault. */
interface SseErrorPayload {
  status?: number;
  message?: string;
}

interface TokenDetails {
  reasoningTokens?: number;
  cachedTokens?: number;
}

interface ParsedSseFrame {
  id?: string;
  provider?: string;
  usage?: Usage;
  tokenDetails?: TokenDetails;
  content?: string;
  reasoning?: string;
  error?: SseErrorPayload;
}

const ZERO_USAGE: Usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

/** The ONE wire mapping for `ReasoningSetting` (design D1) — every request states its reasoning
 *  mode explicitly rather than relying on the provider's default by omission. */
function reasoningField(setting: ReasoningSetting | undefined): Record<string, unknown> {
  switch (setting) {
    case 'off':
      return { reasoning: { enabled: false } };
    case 'on':
      return { reasoning: { enabled: true } };
    case 'low':
    case 'medium':
    case 'high':
      return { reasoning: { effort: setting } };
    case 'default':
    case undefined:
      return {};
  }
}

function requestBody(options: OpenRouterOptions, providerSort: ProviderSort | undefined): string {
  return JSON.stringify({
    model: options.model,
    messages: options.messages,
    stream: true,
    ...(options.maxTokens === undefined ? {} : { max_tokens: options.maxTokens }),
    ...(options.temperature === undefined ? {} : { temperature: options.temperature }),
    ...reasoningField(options.reasoning),
    // `data_collection: 'deny'` keeps prompts away from providers that train on or keep them.
    // Measured 2026-09-23: 25 of 26 providers for the engineer model still qualify (only DeepSeek's
    // own API drops out), and the routed pick and price didn't change.
    provider: { data_collection: 'deny', ...(providerSort ? { sort: providerSort } : {}) },
    stream_options: { include_usage: true },
  });
}

type TypedOpenRouterError =
  | OpenRouterAuthError
  | OpenRouterCreditError
  | OpenRouterRateLimitError
  | OpenRouterNetworkError;

function isTypedOpenRouterError(err: unknown): err is TypedOpenRouterError {
  return (
    err instanceof OpenRouterAuthError ||
    err instanceof OpenRouterCreditError ||
    err instanceof OpenRouterRateLimitError ||
    err instanceof OpenRouterNetworkError
  );
}

/** The ONE status→error mapping. Shared by the pre-stream HTTP check and the mid-stream error
 *  frame, so a provider `402` is the same `OpenRouterCreditError` (and so
 *  `isCreditExhaustedError` fires) whichever way it arrives. */
function statusError(status: number | undefined, message: string): TypedOpenRouterError {
  if (status === 401) return new OpenRouterAuthError(message);
  if (status === 402) return new OpenRouterCreditError(message);
  if (status === 429) return new OpenRouterRateLimitError(message);
  return new OpenRouterNetworkError(message);
}

function responseError(response: Response): TypedOpenRouterError | null {
  if (response.status === 401) return statusError(401, 'OpenRouter: unauthorized (401)');
  if (response.status === 402) return statusError(402, 'OpenRouter: payment required (402)');
  if (response.status === 429) return statusError(429, 'OpenRouter: rate limit exceeded (429)');
  if (!response.ok) return new OpenRouterNetworkError(`OpenRouter: HTTP ${response.status}`);
  if (!response.body) return new OpenRouterNetworkError('OpenRouter: response body is null');
  return null;
}

function usageFrom(parsed: Record<string, unknown>): Usage | undefined {
  if (!parsed.usage || typeof parsed.usage !== 'object') return undefined;
  const u = parsed.usage as Record<string, unknown>;
  return {
    promptTokens: Number(u.prompt_tokens ?? 0),
    completionTokens: Number(u.completion_tokens ?? 0),
    totalTokens: Number(u.total_tokens ?? 0),
  };
}

/** A nested numeric field two levels down (`usage.completion_tokens_details.reasoning_tokens`,
 *  `usage.prompt_tokens_details.cached_tokens`) — absent unless the provider reports it. */
function nestedNumber(container: Record<string, unknown>, outer: string, inner: string): number | undefined {
  const details = container[outer];
  if (!details || typeof details !== 'object') return undefined;
  const value = (details as Record<string, unknown>)[inner];
  return typeof value === 'number' ? value : undefined;
}

/** The final usage chunk's reasoning/cached token counts (design D4), when the provider reports
 *  them — carried alongside `usage` rather than inside it, since `Usage` is the wire contract type
 *  and does not grow new fields for this. */
function tokenDetailsFrom(parsed: Record<string, unknown>): TokenDetails | undefined {
  if (!parsed.usage || typeof parsed.usage !== 'object') return undefined;
  const u = parsed.usage as Record<string, unknown>;
  const reasoningTokens = nestedNumber(u, 'completion_tokens_details', 'reasoning_tokens');
  const cachedTokens = nestedNumber(u, 'prompt_tokens_details', 'cached_tokens');
  if (reasoningTokens === undefined && cachedTokens === undefined) return undefined;
  return { reasoningTokens, cachedTokens };
}

function idFrom(parsed: Record<string, unknown>): string | undefined {
  return typeof parsed.id === 'string' ? parsed.id : undefined;
}

/** OpenRouter carries the routed provider's name as a top-level string on each SSE chunk. */
function providerFrom(parsed: Record<string, unknown>): string | undefined {
  return typeof parsed.provider === 'string' ? parsed.provider : undefined;
}

function deltaOf(parsed: Record<string, unknown>): Record<string, unknown> | undefined {
  const choices = parsed.choices;
  if (!Array.isArray(choices) || choices.length === 0) return undefined;
  const delta = (choices[0] as Record<string, unknown>).delta;
  return delta && typeof delta === 'object' ? (delta as Record<string, unknown>) : undefined;
}

function contentFrom(parsed: Record<string, unknown>): string | undefined {
  const content = deltaOf(parsed)?.content;
  return typeof content === 'string' && content.length > 0 ? content : undefined;
}

/** The roster models (DeepSeek v4 via OpenRouter) emit reasoning ahead of their visible content —
 *  some providers key it `reasoning`, others `reasoning_content`. Both are read here, since which
 *  one a given provider uses is not itself part of this contract. */
function reasoningFrom(parsed: Record<string, unknown>): string | undefined {
  const delta = deltaOf(parsed);
  const reasoning = delta?.reasoning ?? delta?.reasoning_content;
  return typeof reasoning === 'string' && reasoning.length > 0 ? reasoning : undefined;
}

/** OpenRouter carries the HTTP-equivalent status of a mid-stream failure as `error.code`, which
 *  arrives as a number or as its string form depending on the upstream provider. Anything else
 *  (absent, non-numeric) leaves the status unknown, which `statusError` maps to the generic
 *  transport error rather than guessing. */
function errorFrom(parsed: Record<string, unknown>): SseErrorPayload | undefined {
  const raw = parsed.error;
  if (!raw || typeof raw !== 'object') return undefined;
  const e = raw as Record<string, unknown>;
  const code = typeof e.code === 'string' ? Number(e.code) : e.code;
  return {
    status: typeof code === 'number' && Number.isFinite(code) ? code : undefined,
    message: typeof e.message === 'string' ? e.message : undefined,
  };
}

/** The typed error a mid-stream `error` frame stands for. */
function streamFrameError(error: SseErrorPayload): TypedOpenRouterError {
  const status = error.status === undefined ? 'no status' : String(error.status);
  const detail = error.message === undefined ? '' : `: ${error.message}`;
  return statusError(error.status, `OpenRouter: stream error (${status})${detail}`);
}

function parseSseLine(line: string): ParsedSseFrame | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith(':') || !trimmed.startsWith('data:')) return null;
  const payload = trimmed.slice('data:'.length).trim();
  if (payload === '[DONE]') return null;
  try {
    const parsed = JSON.parse(payload) as Record<string, unknown>;
    return {
      id: idFrom(parsed),
      provider: providerFrom(parsed),
      usage: usageFrom(parsed),
      tokenDetails: tokenDetailsFrom(parsed),
      content: contentFrom(parsed),
      reasoning: reasoningFrom(parsed),
      error: errorFrom(parsed),
    };
  // eslint-disable-next-line no-restricted-syntax -- intentional: a malformed SSE data line is just not a usable frame — returns null
  } catch {
    return null;
  }
}

function decodeChunk(decoder: TextDecoder, chunk: Uint8Array | ArrayBufferLike): string {
  return decoder.decode(chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk as ArrayBuffer), { stream: true });
}

export class OpenRouterClient {
  private readonly fetchFn: FetchFn;
  private readonly providerSort: ProviderSort | undefined;

  constructor(fetchFn: FetchFn = globalThis.fetch, providerSort?: ProviderSort) {
    this.fetchFn = fetchFn;
    this.providerSort = providerSort;
  }

  /**
   * Start a streaming chat completion. Returns deltas (AsyncIterable<ModelDelta> — text and,
   * roster-dependent, reasoning), a Promise<Usage> that resolves when the stream ends, and a
   * Promise<id>
   * that resolves with the generation id parsed from the first SSE chunk
   * (or `undefined` if the stream ends before any chunk arrives).
   *
   * `options.signal`, when provided, is forwarded to the injected transport's
   * request-init so a caller can abort a live completion mid-stream.
   *
   * Throws (from the delta iterator, always also rejecting `usage`):
   *   OpenRouterAuthError     on HTTP 401
   *   OpenRouterCreditError   on HTTP 402
   *   OpenRouterRateLimitError on HTTP 429
   *   OpenRouterNetworkError  on fetch throw or other transport failures
   * A failure the provider delivers mid-stream (`data: {"error":{"code":...}}`) raises the SAME
   * typed error its HTTP status would, so a credit exhaustion is never mistaken for a short reply.
   *
   * Whenever the stream settles — completed, failed, or aborted — logs exactly one `model call`
   * info line (design D4): `role`/`model`, `provider` and token-detail fields when present,
   * `ttftMs`/`durationMs`, prompt/completion tokens, `generationId`, `outcome`. No message content.
   */
  stream(options: OpenRouterOptions): StreamResult {
    const { fetchFn, providerSort } = this;
    const apiKey = process.env.OPENROUTER_API_KEY ?? '';
    const startedAt = Date.now();
    let firstDeltaAt: number | undefined;
    let capturedProvider: string | undefined;
    let capturedTokenDetails: TokenDetails | undefined;
    let capturedGenerationId: string | undefined;

    let resolveUsage!: (usage: Usage) => void;
    let rejectUsage!: (err: unknown) => void;
    const usagePromise = new Promise<Usage>((res, rej) => {
      resolveUsage = res;
      rejectUsage = rej;
    });

    let resolveId!: (id: string | undefined) => void;
    const idPromise = new Promise<string | undefined>((res) => {
      resolveId = res;
    });
    let idCaptured = false;
    /** Resolves `idPromise` with the FIRST value it is called with; later calls are no-ops. */
    function captureId(id: string | undefined): void {
      if (idCaptured) return;
      idCaptured = true;
      capturedGenerationId = id;
      resolveId(id);
    }

    /** The ONE `model call` log emission point (design D4) — called from every settle path below,
     *  never from inside the delta-emission loop itself. `outcomeFor` distinguishes a failure the
     *  caller's own signal already asked for (`'aborted'`) from any other failure (`'failed'`). */
    function outcomeFor(): 'failed' | 'aborted' {
      return options.signal?.aborted === true ? 'aborted' : 'failed';
    }
    function logSettle(outcome: 'completed' | 'failed' | 'aborted', usage: Usage | undefined): void {
      routerLog.info(
        {
          ...(options.role !== undefined ? { role: options.role } : {}),
          model: options.model,
          ...(capturedProvider !== undefined ? { provider: capturedProvider } : {}),
          ...(firstDeltaAt !== undefined ? { ttftMs: firstDeltaAt - startedAt } : {}),
          durationMs: Date.now() - startedAt,
          promptTokens: usage?.promptTokens ?? 0,
          completionTokens: usage?.completionTokens ?? 0,
          ...(capturedTokenDetails?.reasoningTokens !== undefined ? { reasoningTokens: capturedTokenDetails.reasoningTokens } : {}),
          ...(capturedTokenDetails?.cachedTokens !== undefined ? { cachedTokens: capturedTokenDetails.cachedTokens } : {}),
          ...(capturedGenerationId !== undefined ? { generationId: capturedGenerationId } : {}),
          outcome,
        },
        'model call',
      );
    }

    async function* makeDeltas(): AsyncIterable<ModelDelta> {
      let response: Response;
      try {
        response = await fetchFn('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: requestBody(options, providerSort),
          signal: options.signal,
        });
      } catch (err) {
        const netErr = new OpenRouterNetworkError('fetch failed', err);
        captureId(undefined);
        logSettle(outcomeFor(), undefined);
        rejectUsage(netErr);
        throw netErr;
      }

      const validationError = responseError(response);
      if (validationError) {
        captureId(undefined);
        logSettle(outcomeFor(), undefined);
        rejectUsage(validationError);
        throw validationError;
      }
      // `responseError` above already rejects+throws on a null body, so this guard is
      // unreachable at runtime — it exists to narrow `body` to non-null for the loop below.
      // Kept consistent with every other throw path (reject the usage promise, never leave it
      // pending) so it degrades safely if that invariant is ever weakened.
      const body = response.body;
      if (!body) {
        const netErr = new OpenRouterNetworkError('OpenRouter: response body is null');
        captureId(undefined);
        logSettle(outcomeFor(), undefined);
        rejectUsage(netErr);
        throw netErr;
      }

      let capturedUsage: Usage | undefined;
      const decoder = new TextDecoder();
      let buffer = '';

      // Apply one parsed SSE frame: capture the generation id and provider, remember usage and
      // token details, emit any reasoning delta then any content delta (reasoning precedes the
      // content it led to within one frame). Shared by the per-line loop and the trailing-buffer
      // flush so the two paths cannot drift — a new field (tool calls) is handled once.
      function* emitFrame(rawLine: string): Generator<ModelDelta> {
        const frame = parseSseLine(rawLine);
        if (frame) captureId(frame.id);
        if (frame?.provider) capturedProvider = frame.provider;
        if (frame?.usage) capturedUsage = frame.usage;
        if (frame?.tokenDetails) capturedTokenDetails = frame.tokenDetails;
        // A mid-stream failure frame ends the stream as a failure rather than as a short, complete
        // reply: dropping it would hand the caller a truncated candidate and hide a `402` from
        // `isCreditExhaustedError`. The catch below preserves this typed error as-is.
        if (frame?.error) throw streamFrameError(frame.error);
        if (frame?.reasoning) {
          firstDeltaAt ??= Date.now();
          yield { kind: 'reasoning', text: frame.reasoning };
        }
        if (frame?.content) {
          firstDeltaAt ??= Date.now();
          yield { kind: 'text', text: frame.content };
        }
      }

      try {
        for await (const chunk of body) {
          buffer += decodeChunk(decoder, chunk);
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const line of lines) yield* emitFrame(line);
        }

        // Flush the trailing buffer (a final frame with no terminating newline)
        yield* emitFrame(buffer);

        captureId(undefined);
        const finalUsage = capturedUsage ?? ZERO_USAGE;
        logSettle('completed', finalUsage);
        resolveUsage(finalUsage);
      } catch (streamErr) {
        // A typed error raised by `emitFrame` (a mid-stream failure frame) keeps its own class and
        // status; anything else (a genuine read failure) is wrapped as a transport error.
        const err = isTypedOpenRouterError(streamErr) ? streamErr : new OpenRouterNetworkError('stream read failed', streamErr);
        captureId(undefined);
        logSettle(outcomeFor(), capturedUsage);
        rejectUsage(err);
        throw err;
      }
    }

    return { deltas: makeDeltas(), usage: usagePromise, id: idPromise };
  }
}
