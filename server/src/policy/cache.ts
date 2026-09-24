/**
 * server/src/policy/cache.ts — `cachedPolicy` (design D9, spec "Verdicts are cached in memory
 * only" and "The policy check is metered and observable without content"): an in-memory LRU+TTL
 * decorator around any `ContentPolicy`, keyed by SHA-256 of the canonical policy input (never the
 * route), and the ONE place that emits the "content policy check" log record. A base
 * `ModelContentPolicy`/`StubContentPolicy` used unwrapped emits no log record — composition MUST
 * always wrap the base policy in this so every check is observed.
 *
 * The logged `category` is closed to the policy document's own list (`CachedPolicyOptions.
 * knownCategories`, `closedCategory` below) — `PolicyVerdict.refuse.category` is free text the
 * classifier echoes from a user-derived rewritten prompt (`../policy/policy.ts`'s `parseVerdict`
 * accepts any non-empty string, even one off the document's list), so logging it verbatim would let
 * user content reach the log sink. An off-list or unlisted category logs as `'other'`.
 */
import { createHash } from 'node:crypto';
import { log, type ServerLogger } from '../logger';
import type { ContentPolicy, PolicyCheckResult, PolicyRoute, PolicyVerdict } from './policy';

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
  /** The policy document's own category list (`parseCategoryList` over its `## Categories`
   *  section, `../policy`). A `refuse.category` outside this list is logged as `'other'` instead
   *  of its own text — `category` is free text the classifier echoes from a user-derived rewritten
   *  prompt (spec content-policy "the server SHALL treat a refuse verdict with an unknown category
   *  as a refusal" — that decision governs the VERDICT only, never the log record). Membership is
   *  case-insensitive; the logged value on a match is the classifier's own string, unchanged.
   *  Omitted or empty treats every category as unknown, so `'other'` is the safe default absent a
   *  list. */
  knownCategories?: readonly string[];
}

const OTHER_CATEGORY = 'other';

function digestOf(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

function describe(verdict: PolicyVerdict): { kind: 'allow' | 'refuse'; category?: string } {
  return verdict === 'allow' ? { kind: 'allow' } : { kind: 'refuse', category: verdict.refuse };
}

function knownCategorySet(categories: readonly string[] | undefined): ReadonlySet<string> {
  return new Set((categories ?? []).map((category) => category.trim().toLowerCase()));
}

/** Folds `category` to `'other'` unless it case-insensitively matches an entry of `known` — the
 *  ONLY point where a classifier-authored category string is allowed to reach `logCheck`. */
function closedCategory(category: string | undefined, known: ReadonlySet<string>): string | undefined {
  if (category === undefined) return undefined;
  return known.has(category.trim().toLowerCase()) ? category : OTHER_CATEGORY;
}

function logCheck(
  route: PolicyRoute,
  verdict: string,
  category: string | undefined,
  durationMs: number,
  logger: ServerLogger | undefined,
): void {
  const fields: Record<string, unknown> = { route, verdict, durationMs };
  if (category !== undefined) fields.category = category;
  // Only route/verdict/category/duration ever reach this call — no checked text and no digest
  // (spec "The record SHALL NOT carry checked text"; "Only the digest and the verdict SHALL be
  // held" for the cache, and even that pair is never logged together). `category`, by the time it
  // reaches this call, has already been through `closedCategory` — every caller of `logCheck`
  // passes a value from the document's own list or the literal `'other'`, NEVER the classifier's
  // raw string, so an off-list category can't carry user-derived text into the log. `logger`, when
  // present, is the request-bound logger (spec request-envelope) — falls back to the module logger
  // otherwise, exactly as before this parameter existed.
  (logger ?? log).info(fields, 'content policy check');
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
  const knownCategories = knownCategorySet(opts.knownCategories);
  // `Map` preserves insertion order; delete-then-set on a hit moves that key to the
  // most-recently-used end, so eviction below (from the front) always drops the true LRU entry.
  const entries = new Map<string, CacheEntry>();

  return {
    async check(input: string, route: PolicyRoute, signal?: AbortSignal, logger?: ServerLogger): Promise<PolicyCheckResult> {
      const startedAt = now();
      const digest = digestOf(input);
      const existing = entries.get(digest);
      if (existing !== undefined) {
        if (existing.expiresAt > now()) {
          entries.delete(digest);
          entries.set(digest, existing);
          const { kind, category } = describe(existing.verdict);
          logCheck(route, kind === 'allow' ? 'cached-allow' : 'cached-refuse', closedCategory(category, knownCategories), now() - startedAt, logger);
          // A cache hit made no classifier call — no usage/generationId to carry.
          return { verdict: existing.verdict };
        }
        entries.delete(digest);
      }

      let result: PolicyCheckResult;
      try {
        result = await inner.check(input, route, signal, logger);
      } catch (err) {
        logCheck(route, 'unavailable', undefined, now() - startedAt, logger);
        throw err;
      }

      entries.set(digest, { verdict: result.verdict, expiresAt: now() + ttlMs });
      while (entries.size > maxEntries) {
        const oldestKey = entries.keys().next().value;
        if (oldestKey === undefined) break;
        entries.delete(oldestKey);
      }

      const { kind, category } = describe(result.verdict);
      logCheck(route, kind, closedCategory(category, knownCategories), now() - startedAt, logger);
      return result;
    },
  };
}
