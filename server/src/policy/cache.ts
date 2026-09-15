/**
 * server/src/policy/cache.ts — `cachedPolicy` (design D9, spec "Verdicts are cached in memory
 * only" and "The policy check is metered and observable without content"): an in-memory LRU+TTL
 * decorator around any `ContentPolicy`, keyed by SHA-256 of the canonical policy input (never the
 * route), and the ONE place that emits the "content policy check" log record. A base
 * `ModelContentPolicy`/`StubContentPolicy` used unwrapped emits no log record — composition MUST
 * always wrap the base policy in this so every check is observed.
 */
import { createHash } from 'node:crypto';
import { log } from '../logger';
import type { ContentPolicy, PolicyRoute, PolicyVerdict } from './policy';

const DEFAULT_MAX_ENTRIES = 1000;
const DEFAULT_TTL_MS = 15 * 60 * 1000;

interface CacheEntry {
  verdict: PolicyVerdict;
  expiresAt: number;
}

export interface CachedPolicyOptions {
  maxEntries?: number;
  ttlMs?: number;
  /** Injectable clock, for TTL tests — defaults to `Date.now`. */
  now?: () => number;
}

function digestOf(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

function describe(verdict: PolicyVerdict): { kind: 'allow' | 'refuse'; category?: string } {
  return verdict === 'allow' ? { kind: 'allow' } : { kind: 'refuse', category: verdict.refuse };
}

function logCheck(route: PolicyRoute, verdict: string, category: string | undefined, durationMs: number): void {
  const fields: Record<string, unknown> = { route, verdict, durationMs };
  if (category !== undefined) fields.category = category;
  // Only route/verdict/category/duration ever reach this call — no checked text and no digest
  // (spec "The record SHALL NOT carry checked text"; "Only the digest and the verdict SHALL be
  // held" for the cache, and even that pair is never logged together).
  log.info(fields, 'content policy check');
}

/**
 * Wrap `inner` with an in-memory LRU+TTL verdict cache and per-check logging. `input` is hashed
 * alone — two routes checking the identical canonical input within the TTL share one cache entry
 * and one classifier call (spec "Clarify then rewrite of the same prompt checks once"). An
 * `inner.check` failure (`PolicyUnavailableError` or otherwise) is never cached and always
 * rethrown after logging `'unavailable'`.
 */
export function cachedPolicy(inner: ContentPolicy, opts: CachedPolicyOptions = {}): ContentPolicy {
  const maxEntries = opts.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
  const now = opts.now ?? Date.now;
  // `Map` preserves insertion order; delete-then-set on a hit moves that key to the
  // most-recently-used end, so eviction below (from the front) always drops the true LRU entry.
  const entries = new Map<string, CacheEntry>();

  return {
    async check(input: string, route: PolicyRoute, signal?: AbortSignal): Promise<PolicyVerdict> {
      const startedAt = now();
      const digest = digestOf(input);
      const existing = entries.get(digest);
      if (existing !== undefined) {
        if (existing.expiresAt > now()) {
          entries.delete(digest);
          entries.set(digest, existing);
          const { kind, category } = describe(existing.verdict);
          logCheck(route, kind === 'allow' ? 'cached-allow' : 'cached-refuse', category, now() - startedAt);
          return existing.verdict;
        }
        entries.delete(digest);
      }

      let verdict: PolicyVerdict;
      try {
        verdict = await inner.check(input, route, signal);
      } catch (err) {
        logCheck(route, 'unavailable', undefined, now() - startedAt);
        throw err;
      }

      entries.set(digest, { verdict, expiresAt: now() + ttlMs });
      while (entries.size > maxEntries) {
        const oldestKey = entries.keys().next().value;
        if (oldestKey === undefined) break;
        entries.delete(oldestKey);
      }

      const { kind, category } = describe(verdict);
      logCheck(route, kind, category, now() - startedAt);
      return verdict;
    },
  };
}
