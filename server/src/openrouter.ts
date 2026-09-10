/**
 * OpenRouter client wrapper — model-agnostic, streaming, usage capture.
 *
 * Uses OpenRouter's OpenAI-compatible chat-completions endpoint over SSE.
 * The model id is always a caller parameter (never embedded — decision #42).
 * The transport (fetch) is injectable for testing against recorded frames.
 * OPENROUTER_API_KEY is read from process.env only, and only when invoked.
 *
 * No route imports this module in this change (#8); it is wired in #11.
 */
import { Usage } from '@whim/contract';
import type { ModelDelta } from './generation/model';
export { Usage };

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
  /** Ask OpenRouter to include the model's reasoning stream (`{ reasoning: { enabled: true } }` on
   *  the wire) rather than hiding it, as it does by default. See `ModelRequest.reasoning`'s doc
   *  comment (`../generation/model.ts`) for why a caller sets this. */
  reasoning?: boolean;
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

interface ParsedSseFrame {
  id?: string;
  usage?: Usage;
  content?: string;
  reasoning?: string;
}

const ZERO_USAGE: Usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

// OpenRouter hides a model's reasoning stream by default — the roster models (DeepSeek v4) emit
// nothing under `delta.reasoning` unless a request opts in. We ask for it (`{ enabled: true }`,
// confirmed live against WHIM_ENGINEER_MODEL) purely so the device can show "thinking" instead of
// silence while the model works; no `effort` budget is set, so the model keeps its own default
// reasoning behavior — this only unhides a stream that already happens, it doesn't change it.
function requestBody(options: OpenRouterOptions): string {
  return JSON.stringify({
    model: options.model,
    messages: options.messages,
    stream: true,
    ...(options.maxTokens === undefined ? {} : { max_tokens: options.maxTokens }),
    ...(options.temperature === undefined ? {} : { temperature: options.temperature }),
    ...(options.reasoning ? { reasoning: { enabled: true } } : {}),
    stream_options: { include_usage: true },
  });
}

function responseError(response: Response): OpenRouterAuthError | OpenRouterRateLimitError | OpenRouterNetworkError | null {
  if (response.status === 401) return new OpenRouterAuthError('OpenRouter: unauthorized (401)');
  if (response.status === 429) return new OpenRouterRateLimitError('OpenRouter: rate limit exceeded (429)');
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

function idFrom(parsed: Record<string, unknown>): string | undefined {
  return typeof parsed.id === 'string' ? parsed.id : undefined;
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

function parseSseLine(line: string): ParsedSseFrame | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith(':') || !trimmed.startsWith('data:')) return null;
  const payload = trimmed.slice('data:'.length).trim();
  if (payload === '[DONE]') return null;
  try {
    const parsed = JSON.parse(payload) as Record<string, unknown>;
    return {
      id: idFrom(parsed),
      usage: usageFrom(parsed),
      content: contentFrom(parsed),
      reasoning: reasoningFrom(parsed),
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

  constructor(fetchFn: FetchFn = globalThis.fetch) {
    this.fetchFn = fetchFn;
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
   * Throws:
   *   OpenRouterAuthError     on HTTP 401
   *   OpenRouterRateLimitError on HTTP 429
   *   OpenRouterNetworkError  on fetch throw or other transport failures
   */
  stream(options: OpenRouterOptions): StreamResult {
    const { fetchFn } = this;
    const apiKey = process.env.OPENROUTER_API_KEY ?? '';

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
      resolveId(id);
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
          body: requestBody(options),
          signal: options.signal,
        });
      } catch (err) {
        const netErr = new OpenRouterNetworkError('fetch failed', err);
        captureId(undefined);
        rejectUsage(netErr);
        throw netErr;
      }

      const validationError = responseError(response);
      if (validationError) {
        captureId(undefined);
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
        rejectUsage(netErr);
        throw netErr;
      }

      let capturedUsage: Usage | undefined;
      const decoder = new TextDecoder();
      let buffer = '';

      // Apply one parsed SSE frame: capture the generation id, remember usage, emit any
      // reasoning delta then any content delta (reasoning precedes the content it led to within
      // one frame). Shared by the per-line loop and the trailing-buffer flush so the two paths
      // cannot drift — a new field (tool calls) is handled once.
      function* emitFrame(rawLine: string): Generator<ModelDelta> {
        const frame = parseSseLine(rawLine);
        if (frame) captureId(frame.id);
        if (frame?.usage) capturedUsage = frame.usage;
        if (frame?.reasoning) yield { kind: 'reasoning', text: frame.reasoning };
        if (frame?.content) yield { kind: 'text', text: frame.content };
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
        resolveUsage(capturedUsage ?? ZERO_USAGE);
      } catch (streamErr) {
        const netErr = new OpenRouterNetworkError('stream read failed', streamErr);
        captureId(undefined);
        rejectUsage(netErr);
        throw netErr;
      }
    }

    return { deltas: makeDeltas(), usage: usagePromise, id: idPromise };
  }
}
