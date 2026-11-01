/**
 * server/src/admission/refusals.ts — the structured refusal bodies for size, admission,
 * content-policy, operator-budget, minimum-build and consent refusals (design D8; request-envelope;
 * specs/server-admission-control "Every refusal is a structured, user-facing ApiError").
 *
 * Every body validates as `ApiError` with `error` a `ServiceRefusalCode` member, and every hint is
 * the server-owned user-facing text from design D8's table: no internal identifiers, limit names,
 * environment variable names, model names or policy category names. `Retry-After` is an integer
 * number of seconds and is present exactly where the retry time is knowable — a device daily limit
 * and the global daily ceiling, both of which reset at the next UTC midnight on the injected clock,
 * and a `provider_unavailable` refusal given the seconds left in the provider breaker's cooldown.
 */
import type { ApiError, ServiceRefusalCode } from '@whim/contract';
import type { SlotRefusalReason } from './slots';

export interface ServiceRefusal {
  readonly status: 403 | 413 | 422 | 426 | 429 | 503;
  readonly body: ApiError & { error: ServiceRefusalCode };
  /** `{ 'Retry-After': '<integer seconds>' }` on `daily_limit`, the ceiling `server_busy` and a
   *  `provider_unavailable` given a window; empty on every other refusal. Pass straight to the response as headers. */
  readonly headers: Readonly<Record<string, string>>;
}

/** The D8 hint table. `server_busy` has two variants: capacity (also used while draining) and the
 *  global daily ceiling. */
export const REFUSAL_HINTS = Object.freeze({
  payload_too_large: 'That request is too long. Try a shorter description.',
  daily_limit: 'You’ve reached today’s limit on this device. It resets at midnight UTC.',
  device_busy: 'This device is already making an app. Try again when it finishes.',
  server_busy_capacity: 'Whim is busy right now. Please try again in a few minutes.',
  server_busy_ceiling: 'Whim has reached today’s limit for making apps. Please try again after midnight UTC.',
  content_policy: 'Whim can’t make that kind of app. Try describing something else.',
  policy_unavailable: 'We couldn’t check this request right now. Please try again in a moment.',
  budget_exhausted: 'Whim has used up its budget for making apps for now. Try again later.',
  update_required: 'Update Whim to the latest version to keep using its AI features.',
  consent_required: 'Whim needs your permission to send requests to its AI service.',
  provider_unavailable: 'The AI service Whim uses is having trouble right now. It’s not something you did. Please try again in a little while.',
});

const DAY_MS = 86_400_000;
const NO_HEADERS: Readonly<Record<string, string>> = Object.freeze({});

/** Whole seconds from `nowMs` to the next UTC midnight, rounded up so a client never retries
 *  before the reset. Exactly at midnight the next reset is a full day away. */
function secondsUntilNextUtcMidnight(nowMs: number): number {
  const nextMidnight = (Math.floor(nowMs / DAY_MS) + 1) * DAY_MS;
  return Math.ceil((nextMidnight - nowMs) / 1000);
}

function refusal(
  status: ServiceRefusal['status'],
  error: ServiceRefusalCode,
  hint: string,
  headers: Readonly<Record<string, string>> = NO_HEADERS,
): ServiceRefusal {
  return Object.freeze({ status, body: Object.freeze({ error, hint }), headers });
}

function retryAfterUntilMidnight(now: () => number): Readonly<Record<string, string>> {
  return Object.freeze({ 'Retry-After': String(secondsUntilNextUtcMidnight(now())) });
}

/** `413` — a raw body or prompt/source over its byte cap. */
export function payloadTooLargeRefusal(): ServiceRefusal {
  return refusal(413, 'payload_too_large', REFUSAL_HINTS.payload_too_large);
}

/** `429` — the device's daily allowance for this route is spent. Carries `Retry-After`. */
export function dailyLimitRefusal(now: () => number): ServiceRefusal {
  return refusal(429, 'daily_limit', REFUSAL_HINTS.daily_limit, retryAfterUntilMidnight(now));
}

/** `429` — the device already holds a running generation. No `Retry-After`. */
export function deviceBusyRefusal(): ServiceRefusal {
  return refusal(429, 'device_busy', REFUSAL_HINTS.device_busy);
}

/** `429` — a global concurrency cap is reached, or the server is draining. No `Retry-After`. */
export function serverBusyRefusal(): ServiceRefusal {
  return refusal(429, 'server_busy', REFUSAL_HINTS.server_busy_capacity);
}

/** `429` — the global daily ceiling is reached for everyone. Carries `Retry-After`. */
export function serverBusyCeilingRefusal(now: () => number): ServiceRefusal {
  return refusal(429, 'server_busy', REFUSAL_HINTS.server_busy_ceiling, retryAfterUntilMidnight(now));
}

/** `422` — the content policy refused the request. */
export function contentPolicyRefusal(): ServiceRefusal {
  return refusal(422, 'content_policy', REFUSAL_HINTS.content_policy);
}

/** `503` — the content policy check could not be made (fail closed). */
export function policyUnavailableRefusal(): ServiceRefusal {
  return refusal(503, 'policy_unavailable', REFUSAL_HINTS.policy_unavailable);
}

/** `503` — the operator's provider credit is below the floor, before admission or from a
 *  mid-call `402`. No `Retry-After`: the refill time is unknowable. */
export function budgetExhaustedRefusal(): ServiceRefusal {
  return refusal(503, 'budget_exhausted', REFUSAL_HINTS.budget_exhausted);
}

/** `503` — the AI provider the server depends on is failing. `Retry-After` (whole seconds,
 *  rounded up by the caller) only when a window is known, as from an open breaker; a run that
 *  failed mid-call has none. */
export function providerUnavailableRefusal(retryAfterSeconds?: number): ServiceRefusal {
  const headers = retryAfterSeconds === undefined ? NO_HEADERS : Object.freeze({ 'Retry-After': String(retryAfterSeconds) });
  return refusal(503, 'provider_unavailable', REFUSAL_HINTS.provider_unavailable, headers);
}

/** `426` — the request's build is below its platform's minimum (the `/v1` minimum-build gate).
 *  No `Retry-After`: only an update clears it. */
export function updateRequiredRefusal(): ServiceRefusal {
  return refusal(426, 'update_required', REFUSAL_HINTS.update_required);
}

/** `403` — the request's consent version does not cover the route's data practice (a consent of
 *  `none` on clarify, rewrite or generate), refused before any model work. */
export function consentRequiredRefusal(): ServiceRefusal {
  return refusal(403, 'consent_required', REFUSAL_HINTS.consent_required);
}

/** Maps a slot controller refusal to its body: `device_busy` → `device_busy`; `draining` and
 *  `at_capacity` → capacity `server_busy`. None carries `Retry-After`. */
export function slotRefusal(reason: SlotRefusalReason): ServiceRefusal {
  return reason === 'device_busy' ? deviceBusyRefusal() : serverBusyRefusal();
}
