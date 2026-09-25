/**
 * wire-compat — phase one of the two-phase decode every SSE event and unary body goes through
 * (beta-1 design D16, layer 3; spec generation-contract "Every wire message carries a
 * forward-compatibility envelope with a closed fallback vocabulary").
 *
 * A message gets its full structural guard only when this build knows its `type` or `error` code
 * and its `compat.min` (default 1) is at most `PROTOCOL_LEVEL`. Otherwise its fallback applies:
 * `skip`, `fail` or `update`, each with the message's `notice`. An unknown message with no
 * `compat`, a `fallback` outside the frozen set, and a `compat` this build cannot read all mean
 * `fail`.
 *
 * A hand-written mirror of `@whim/contract`'s `WireEnvelope`: no contract value may enter the Metro
 * bundle (zod). `wire-future-frames.suite.ts` holds it to the contract and to the server's own
 * registry. No runtime imports but `wire-headers.ts`, so the transports can import it without a
 * cycle and it loads under Node.
 */
import type { CompatFallback } from '@whim/contract';
import { PROTOCOL_LEVEL } from './wire-headers';

/** What this build does with a message it cannot use: `skip` carries on, `fail` ends the flow on
 *  the failure screen, `update` ends it on the update screen. `notice` is the message's own plain
 *  text for that screen, absent when it sent none. */
export type WireFallback =
  | { readonly kind: 'skip' }
  | { readonly kind: 'fail'; readonly notice?: string }
  | { readonly kind: 'update'; readonly notice?: string };

/** The two fallbacks that end a flow — what `GenerationClientError{kind:'fallback'}` carries. */
export type TerminalFallback = Exclude<WireFallback, { kind: 'skip' }>;

/** Phase one's verdict on one message: decode it with its full guard, or apply `fallback`. */
export type WireGate = { readonly kind: 'decode' } | { readonly kind: 'fallback'; readonly fallback: WireFallback };

/** The contract's `COMPAT_NOTICE_MAX_CHARS`. */
const COMPAT_NOTICE_MAX_CHARS = 200;

/** Every `ApiError` code the wire had at `PROTOCOL_LEVEL`: the contract's refusal and
 *  device-identity codes and the ones the server's routes set themselves. A code outside this list
 *  is one this build was never written against. */
export const KNOWN_ERROR_CODES: readonly string[] = [
  'payload_too_large',
  'daily_limit',
  'device_busy',
  'server_busy',
  'content_policy',
  'policy_unavailable',
  'budget_exhausted',
  'update_required',
  'consent_required',
  'missing_device_id',
  'invalid_device_id',
  'invalid_envelope',
  'invalid_request',
  'internal_error',
  'model_failure',
  'clarify_not_configured',
  'rewrite_not_configured',
];

const KNOWN_ERROR_CODE_SET: ReadonlySet<string> = new Set(KNOWN_ERROR_CODES);

export function isKnownErrorCode(code: string): boolean {
  return KNOWN_ERROR_CODE_SET.has(code);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A `compat` as this build reads it. `fallback` stays an open string, as the contract's envelope
 *  reads it, so a value outside the frozen set still resolves (to `fail`). */
interface ReadableCompat {
  readonly min: number;
  readonly fallback: string;
  readonly notice?: string;
}

/** `message.compat`: absent, readable, or `'unreadable'` — present but not a record with a
 *  positive-integer `min`, a string `fallback`, and a `notice` that, when present, is a string of at
 *  most `COMPAT_NOTICE_MAX_CHARS` characters. */
function compatOf(message: Record<string, unknown>): ReadableCompat | undefined | 'unreadable' {
  const compat = message.compat;
  if (compat === undefined) return undefined;
  if (!isRecord(compat)) return 'unreadable';
  const { min, fallback, notice } = compat;
  if (typeof min !== 'number' || !Number.isSafeInteger(min) || min < 1) return 'unreadable';
  if (typeof fallback !== 'string') return 'unreadable';
  if (notice !== undefined && (typeof notice !== 'string' || notice.length > COMPAT_NOTICE_MAX_CHARS)) return 'unreadable';
  return { min, fallback, ...(notice === undefined ? {} : { notice }) };
}

const DECODE: WireGate = Object.freeze({ kind: 'decode' });
const FAIL: WireGate = Object.freeze({ kind: 'fallback', fallback: Object.freeze({ kind: 'fail' }) });

/** The fallback `compat` names: the contract's frozen `CompatFallback` set, read by value. An empty
 *  notice is no notice. */
function fallbackOf(compat: ReadableCompat): WireFallback {
  const notice = compat.notice === undefined || compat.notice === '' ? {} : { notice: compat.notice };
  switch (compat.fallback) {
    case 'skip' satisfies CompatFallback:
      return { kind: 'skip' };
    case 'update' satisfies CompatFallback:
      return { kind: 'update', ...notice };
    default:
      // `fail`, and any value outside the frozen set.
      return { kind: 'fail', ...notice };
  }
}

/** Phase one for one message (an SSE event, an `ApiError`, or a unary success body): `known` says
 *  whether this build knows the message's `type` or `error` code — a unary success body's route
 *  always is. */
export function gateMessage(message: Record<string, unknown>, known: boolean): WireGate {
  const compat = compatOf(message);
  if (compat === 'unreadable') return FAIL;
  if (known && (compat === undefined || compat.min <= PROTOCOL_LEVEL)) return DECODE;
  if (compat === undefined) return FAIL;
  return { kind: 'fallback', fallback: fallbackOf(compat) };
}
