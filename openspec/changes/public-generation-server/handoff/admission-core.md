# admission-core (chain-3)

Route-agnostic, in-memory, no persistence. Routes wire the fixed order (chains 9/10): device
identity → body cap → validation → prompt cap → `checkCredit` → `acquire` (drain → device → cap)
→ daily units → content policy. Every refusal after `acquire` succeeded MUST `release()` first.

## `server/src/admission/slots.ts`

```ts
export type SlotKind = 'generate' | 'unary' | 'probe';
export const MAX_CONCURRENT_PROBES = 2; // /healthz/sse's own pool, never the unary pool
export type SlotRefusalReason = 'draining' | 'device_busy' | 'at_capacity';
export interface SlotHandle { readonly kind: SlotKind; readonly deviceId: string; release(): void }
export type AcquireResult =
  | { ok: true; handle: SlotHandle }
  | { ok: false; reason: SlotRefusalReason };
export interface SlotCounts { readonly generations: number; readonly unary: number; readonly probes: number; readonly draining: boolean }
export interface SlotLimits { maxConcurrentGenerations: number; maxConcurrentUnary: number }
export interface SlotController {
  acquire(kind: SlotKind, deviceId: string): AcquireResult;
  startDraining(): void;
  isDraining(): boolean;
  counts(): SlotCounts;
}
export function createSlotController(limits: SlotLimits): SlotController; // RangeError on a non-positive-integer cap
```

- One controller per process, built from `ServerConfig.maxConcurrentGenerations` / `maxConcurrentUnary`.
- `acquire` order: `draining` (all kinds) → `device_busy` (generate only; unary/probe have no
  per-device exclusivity) → `at_capacity` (its own cap per kind, `MAX_CONCURRENT_PROBES` for probe).
- `release()` is idempotent per handle: the first call frees the slot, every later call is a no-op —
  also after `startDraining()`, and a stale handle never frees the same device's newer generation.
  Safe to call from an abort listener AND a `finally` AND a post-acquire refusal.
- `startDraining()` is one-way; the report route checks `isDraining()` without acquiring. All O(1).
- `/healthz/sse` always `acquire('probe', 'healthz-probe')` — anonymous, own tiny fixed pool, never
  the `unary` pool; `lifecycle.ts`'s drain wait includes `probes`.

## `server/src/admission/refusals.ts`

```ts
export interface ServiceRefusal {
  readonly status: 413 | 422 | 429 | 503;
  readonly body: ApiError & { error: ServiceRefusalCode };
  readonly headers: Readonly<Record<string, string>>; // { 'Retry-After': '<int>' } or {}
}
export function payloadTooLargeRefusal(): ServiceRefusal;               // 413
export function dailyLimitRefusal(now: () => number): ServiceRefusal;   // 429, Retry-After
export function deviceBusyRefusal(): ServiceRefusal;                    // 429
export function serverBusyRefusal(): ServiceRefusal;                    // 429 capacity / draining
export function serverBusyCeilingRefusal(now: () => number): ServiceRefusal; // 429, Retry-After
export function contentPolicyRefusal(): ServiceRefusal;                 // 422
export function policyUnavailableRefusal(): ServiceRefusal;             // 503
export function budgetExhaustedRefusal(): ServiceRefusal;               // 503
export function slotRefusal(reason: SlotRefusalReason): ServiceRefusal; // device_busy → deviceBusy; else serverBusy
```

`Retry-After` = whole seconds to the next UTC midnight on `now()`, rounded up (22:00:00 → `7200`,
exactly 00:00:00 → `86400`). Present ONLY on `daily_limit` and the ceiling `server_busy`. Respond
with `c.json(r.body, r.status, r.headers)`.

| Refusal | Hint |
|---|---|
| `payload_too_large` | That request is too long. Try a shorter description. |
| `daily_limit` | You've reached today's limit on this device. It resets at midnight UTC. |
| `device_busy` | This device is already building an app. Try again when it finishes. |
| `server_busy` (capacity, draining) | Whim is busy right now. Please try again in a few minutes. |
| `server_busy` (global ceiling) | Whim has reached today's building capacity. Please try again after midnight UTC. |
| `content_policy` | Whim can't make that kind of app. Try describing something else. |
| `policy_unavailable` | We couldn't check this request right now. Please try again in a moment. |
| `budget_exhausted` | Whim has used up its generation budget for now. Try again later. |

## `server/src/device-identity.ts`

```ts
export interface DeviceVerifier {
  verify(headers: Headers): Promise<
    | { ok: true; deviceId: string }
    | { ok: false; status: 400 | 401 | 403; body: ApiError }
  >;
}
export const shapeOnlyVerifier: DeviceVerifier;
```

`shapeOnlyVerifier` reads `x-whim-device`: missing or empty → `400 { error: 'missing_device_id',
hint: 'Include a UUID in the x-whim-device request header.' }`; not an 8-4-4-4-12 hex UUID (any
case) → `400 { error: 'invalid_device_id', hint: 'The x-whim-device header must be a valid UUID
(e.g. xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx).' }`; else `{ ok: true, deviceId: <header> }`. Bodies
are byte-identical to today's `app.ts` middleware, which still carries its own copy until chain-9.

## `server/src/admission/credit.ts`

```ts
export interface CreditLookupResponse { readonly status: number; readonly bodyText: string }
export interface CreditTransport { lookupKey(): Promise<CreditLookupResponse> } // rejects only on transport failure
export function createOpenRouterCreditTransport(options: {
  apiKey: string; fetchFn?: FetchFn; timeoutMs?: number; // timeoutMs default 5000
}): CreditTransport; // GET https://openrouter.ai/api/v1/key, Authorization: Bearer <apiKey>, AbortSignal.timeout
export type CreditLookupFailure = 'transport_error' | 'http_status' | 'malformed_body';
export type CreditCheckResult =
  | { ok: true; lookupFailed?: CreditLookupFailure }
  | { ok: false; reason: 'budget_exhausted' };
export interface CreditCheckOptions { transport: CreditTransport; clock: () => number; ttlMs: number; floorUsd: number }
export async function checkCredit(options: CreditCheckOptions): Promise<CreditCheckResult>; // never rejects
export function invalidateCreditCache(): void;
```

Wire `clock: config.now`, `ttlMs: config.creditCacheTtlMs`, `floorUsd: config.minCreditUsd`.

**Fail-open contract (spec, verbatim):** "When the credit lookup itself fails — a transport error, a
non-2xx response, or a malformed body — the server SHALL admit the request and log a warning, deliberately failing open."

- Refuses ONLY when `data.limit_remaining` is a number `< floorUsd` (equal is not below). `null` never refuses.
- Failure → `{ ok: true, lookupFailed }`; the caller MUST log a warning when `lookupFailed` is set.
  Malformed = unparseable JSON, no `data` object, missing `limit_remaining`, or a non-number non-null value.
  A non-2xx is never parsed. A failure caches nothing and never falls back to a stale cached value.
- One process-wide cache (no key but time): a successful lookup is reused while `0 ≤ age < ttlMs`.
  Concurrent checks with no fresh value share one in-flight lookup.
- `invalidateCreditCache()` (call on any provider `402`): drops the value and detaches any in-flight
  lookup; the next check re-queries even inside the TTL, and a lookup started before the call can
  never repopulate the cache. Tests MUST call it first to reset module state.
