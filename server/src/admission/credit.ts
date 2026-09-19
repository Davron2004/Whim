/**
 * server/src/admission/credit.ts — the pre-admission operator credit check (design D6a/D6b;
 * specs/server-admission-control "The server refuses admission when the operator's provider credit
 * is exhausted"). Route-agnostic: clarify, rewrite and generate call the same primitive.
 *
 * It reads `data.limit_remaining` from `GET https://openrouter.ai/api/v1/key` through an injectable
 * transport and keeps the value in one in-memory cache keyed by nothing but time (one key, one
 * server). It refuses only when the cached value is a number below the floor; `null` means the key
 * carries no limit and never refuses.
 *
 * It fails OPEN, deliberately and unlike the content policy: a transport error, a non-2xx status or
 * a malformed body admits the request and reports the failure so the caller logs a warning. The
 * provider's own `402` on the model call is the real backstop, and that path calls
 * `invalidateCreditCache()` so the next check re-queries at once.
 */
import type { FetchFn } from '../openrouter';

const OPENROUTER_KEY_URL = 'https://openrouter.ai/api/v1/key';

/** Bounds the real lookup, so a hanging key endpoint fails open instead of stalling admission. */
const DEFAULT_CREDIT_LOOKUP_TIMEOUT_MS = 5000;

export interface CreditLookupResponse {
  readonly status: number;
  readonly bodyText: string;
}

/** One `GET` of the operator key record. Resolves with the HTTP status and raw body text, whatever
 *  the status; rejects only on a transport failure (including its own timeout). */
export interface CreditTransport {
  lookupKey(): Promise<CreditLookupResponse>;
}

export function createOpenRouterCreditTransport(options: {
  apiKey: string;
  fetchFn?: FetchFn;
  timeoutMs?: number;
}): CreditTransport {
  const fetchFn = options.fetchFn ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_CREDIT_LOOKUP_TIMEOUT_MS;
  return {
    async lookupKey() {
      const response = await fetchFn(OPENROUTER_KEY_URL, {
        method: 'GET',
        headers: { Authorization: `Bearer ${options.apiKey}` },
        signal: AbortSignal.timeout(timeoutMs),
      });
      return { status: response.status, bodyText: await response.text() };
    },
  };
}

export type CreditLookupFailure = 'transport_error' | 'http_status' | 'malformed_body';

export type CreditCheckResult =
  | { ok: true; lookupFailed?: CreditLookupFailure }
  | { ok: false; reason: 'budget_exhausted' };

export interface CreditCheckOptions {
  transport: CreditTransport;
  /** Epoch milliseconds — `ServerConfig.now`. */
  clock: () => number;
  /** `ServerConfig.creditCacheTtlMs`. */
  ttlMs: number;
  /** `ServerConfig.minCreditUsd`. */
  floorUsd: number;
}

type Lookup =
  | { ok: true; limitRemaining: number | null }
  | { ok: false; failure: CreditLookupFailure };

let cached: { limitRemaining: number | null; storedAt: number } | undefined;
let inflight: Promise<Lookup> | undefined;
/** Bumped by every invalidation, so a lookup that started before it can never repopulate the
 *  cache or be joined by a check that runs after it. */
let cacheEpoch = 0;

/** `undefined` when the body is not `{ data: { limit_remaining: number | null } }`. */
function parseLimitRemaining(bodyText: string): number | null | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyText);
  // eslint-disable-next-line no-restricted-syntax -- intentional: an unparseable body is the `malformed_body` fail-open case, reported through `lookupFailed`
  } catch {
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined;
  const data: unknown = (parsed as { data?: unknown }).data;
  if (typeof data !== 'object' || data === null || !('limit_remaining' in data)) return undefined;
  const value: unknown = (data as { limit_remaining: unknown }).limit_remaining;
  if (value === null) return null;
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

async function lookup(transport: CreditTransport): Promise<Lookup> {
  let response: CreditLookupResponse;
  try {
    response = await transport.lookupKey();
  // eslint-disable-next-line no-restricted-syntax -- intentional: every transport failure fails open by design (D6a); the caller logs the warning from `lookupFailed`
  } catch {
    return { ok: false, failure: 'transport_error' };
  }
  if (response.status < 200 || response.status > 299) return { ok: false, failure: 'http_status' };
  const limitRemaining = parseLimitRemaining(response.bodyText);
  if (limitRemaining === undefined) return { ok: false, failure: 'malformed_body' };
  return { ok: true, limitRemaining };
}

/** Concurrent checks with no fresh cache share one in-flight lookup. */
function sharedLookup(transport: CreditTransport, clock: () => number): Promise<Lookup> {
  if (inflight) return inflight;
  const startedEpoch = cacheEpoch;
  const pending = lookup(transport).then((result) => {
    if (cacheEpoch === startedEpoch) {
      inflight = undefined;
      if (result.ok) cached = { limitRemaining: result.limitRemaining, storedAt: clock() };
    }
    return result;
  });
  inflight = pending;
  return pending;
}

function decide(limitRemaining: number | null, floorUsd: number): CreditCheckResult {
  return typeof limitRemaining === 'number' && limitRemaining < floorUsd
    ? { ok: false, reason: 'budget_exhausted' }
    : { ok: true };
}

export async function checkCredit(options: CreditCheckOptions): Promise<CreditCheckResult> {
  const { transport, clock, ttlMs, floorUsd } = options;
  if (cached) {
    const age = clock() - cached.storedAt;
    if (age >= 0 && age < ttlMs) return decide(cached.limitRemaining, floorUsd);
  }
  const result = await sharedLookup(transport, clock);
  if (!result.ok) return { ok: true, lookupFailed: result.failure };
  return decide(result.limitRemaining, floorUsd);
}

/** Drops the cached value and detaches any in-flight lookup, so the next `checkCredit` queries the
 *  key endpoint even inside the TTL. Called on a provider `402`. */
export function invalidateCreditCache(): void {
  cacheEpoch++;
  cached = undefined;
  inflight = undefined;
}
