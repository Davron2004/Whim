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
}

/** Result of a streaming completion. */
export interface StreamResult {
  /** Async iterable of text deltas in arrival order. */
  deltas: AsyncIterable<string>;
  /** Resolves with the captured usage once the stream ends. */
  usage: Promise<Usage>;
}

// ─── Client ──────────────────────────────────────────────────────────────────

/** Injectable fetch type (matches the global `fetch` signature). */
export type FetchFn = typeof globalThis.fetch;

export class OpenRouterClient {
  private readonly fetchFn: FetchFn;

  constructor(fetchFn: FetchFn = globalThis.fetch) {
    this.fetchFn = fetchFn;
  }

  /**
   * Start a streaming chat completion. Returns deltas (AsyncIterable<string>)
   * and a Promise<Usage> that resolves when the stream ends.
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

    async function* makeDeltas(): AsyncIterable<string> {
      let response: Response;
      try {
        response = await fetchFn('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: options.model,
            messages: options.messages,
            stream: true,
            ...(options.maxTokens !== undefined ? { max_tokens: options.maxTokens } : {}),
            ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
            stream_options: { include_usage: true },
          }),
        });
      } catch (err) {
        const netErr = new OpenRouterNetworkError('fetch failed', err);
        rejectUsage(netErr);
        throw netErr;
      }

      if (response.status === 401) {
        const authErr = new OpenRouterAuthError('OpenRouter: unauthorized (401)');
        rejectUsage(authErr);
        throw authErr;
      }
      if (response.status === 429) {
        const rlErr = new OpenRouterRateLimitError('OpenRouter: rate limit exceeded (429)');
        rejectUsage(rlErr);
        throw rlErr;
      }
      if (!response.ok) {
        const netErr = new OpenRouterNetworkError(`OpenRouter: HTTP ${response.status}`);
        rejectUsage(netErr);
        throw netErr;
      }

      if (!response.body) {
        const netErr = new OpenRouterNetworkError('OpenRouter: response body is null');
        rejectUsage(netErr);
        throw netErr;
      }

      let capturedUsage: Usage | undefined;
      const decoder = new TextDecoder();
      let buffer = '';

      try {
        for await (const chunk of response.body) {
          buffer += decoder.decode(chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk as ArrayBuffer), { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith(':')) continue; // empty / comment
            if (!trimmed.startsWith('data:')) continue;

            const payload = trimmed.slice('data:'.length).trim();
            if (payload === '[DONE]') continue;

            let parsed: Record<string, unknown>;
            try {
              parsed = JSON.parse(payload) as Record<string, unknown>;
            } catch {
              continue;
            }

            // Capture usage from the final chunk (stream_options: include_usage)
            if (parsed.usage && typeof parsed.usage === 'object') {
              const u = parsed.usage as Record<string, unknown>;
              capturedUsage = {
                promptTokens: Number(u.prompt_tokens ?? 0),
                completionTokens: Number(u.completion_tokens ?? 0),
                totalTokens: Number(u.total_tokens ?? 0),
              };
            }

            // Extract text delta from choices[0].delta.content
            const choices = parsed.choices;
            if (!Array.isArray(choices) || choices.length === 0) continue;
            const delta = (choices[0] as Record<string, unknown>).delta;
            if (!delta || typeof delta !== 'object') continue;
            const content = (delta as Record<string, unknown>).content;
            if (typeof content === 'string' && content.length > 0) {
              yield content;
            }
          }
        }

        // Flush remaining buffer
        if (buffer.trim()) {
          const trimmed = buffer.trim();
          if (trimmed.startsWith('data:')) {
            const payload = trimmed.slice('data:'.length).trim();
            if (payload !== '[DONE]') {
              try {
                const parsed = JSON.parse(payload) as Record<string, unknown>;
                if (parsed.usage && typeof parsed.usage === 'object') {
                  const u = parsed.usage as Record<string, unknown>;
                  capturedUsage = {
                    promptTokens: Number(u.prompt_tokens ?? 0),
                    completionTokens: Number(u.completion_tokens ?? 0),
                    totalTokens: Number(u.total_tokens ?? 0),
                  };
                }
              } catch {
                // ignore malformed trailing data
              }
            }
          }
        }

        resolveUsage(
          capturedUsage ?? { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        );
      } catch (err) {
        if (
          err instanceof OpenRouterAuthError ||
          err instanceof OpenRouterRateLimitError ||
          err instanceof OpenRouterNetworkError
        ) {
          rejectUsage(err);
          throw err;
        }
        const netErr = new OpenRouterNetworkError('stream read failed', err);
        rejectUsage(netErr);
        throw netErr;
      }
    }

    return { deltas: makeDeltas(), usage: usagePromise };
  }
}
