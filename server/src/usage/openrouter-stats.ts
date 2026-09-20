/**
 * server/src/usage/openrouter-stats.ts — the real `UsageAndCostTransport` the resolver polls
 * (`./resolve.ts`, design D7): `GET https://openrouter.ai/api/v1/generation?id=…` for one provider
 * generation id's tokens and `total_cost`. Composition (`../lifecycle.ts`) builds it from the
 * operator key unless an override replaces it.
 */
import type { FetchFn } from '../openrouter';
import type { GenerationStats, UsageAndCostTransport } from './resolve';

const GENERATION_STATS_URL = 'https://openrouter.ai/api/v1/generation';

/** One OpenRouter generation-stats record as the resolver needs it, or `null` while the record is
 *  not (yet) complete: tokens (native counts as the fallback) and `total_cost` in USD. */
function parseGenerationStats(data: Record<string, unknown> | undefined): GenerationStats | null {
  if (!data) return null;
  const promptTokens = Number(data.tokens_prompt ?? data.native_tokens_prompt ?? 0);
  const completionTokens = Number(data.tokens_completion ?? data.native_tokens_completion ?? 0);
  const totalCostUsd = data.total_cost;
  if (!Number.isFinite(promptTokens) || !Number.isFinite(completionTokens)) return null;
  if (typeof totalCostUsd !== 'number' || !Number.isFinite(totalCostUsd)) return null;
  return { usage: { promptTokens, completionTokens, totalTokens: promptTokens + completionTokens }, totalCostUsd };
}

/** A non-2xx or incomplete record is "not yet resolved" (`null`); a transport failure or an
 *  unparseable body rejects, which the resolver treats the same way and retries within its bounds.
 *  `fetchFn` defaults to the global `fetch` as it is when each request is made. */
export function openRouterUsageAndCostTransport(apiKey: string, fetchFn?: FetchFn): UsageAndCostTransport {
  return {
    async fetchStats(generationId: string, signal: AbortSignal): Promise<GenerationStats | null> {
      const doFetch = fetchFn ?? globalThis.fetch;
      const res = await doFetch(`${GENERATION_STATS_URL}?id=${encodeURIComponent(generationId)}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal,
      });
      if (!res.ok) return null;
      const body = (await res.json()) as { data?: Record<string, unknown> };
      return parseGenerationStats(body.data);
    },
  };
}
