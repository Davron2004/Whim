/**
 * server/src/wire-level.ts — protocol-level negotiation on the sending side (beta-1 design D16,
 * layer 2): the level every wire event type and `/v1` error code was introduced at, and the one
 * helper a producer passes a message through before a client at a given level receives it.
 *
 * An entry above level 1 carries `compat` (its `min` is the entry's level), so a client that does not
 * know the message still has a fallback. A producer of any event or code above level 1 sends it
 * through `eventForLevel`/`errorForLevel` with the request's `protocolLevel` (`request-edge.ts`):
 * a client below the message's level gets the entry's lower-level form when it has one, and
 * otherwise only the envelope — `{ type, compat }` for an event, `{ error, hint, compat }` for an
 * error — so its own decoder applies the fallback. It never gets the higher-level payload.
 *
 * A level-1 message may also gain a field later: its entry's `fields` lists each such field with
 * the level it arrived at, and a client below that level receives the message without it. That is
 * how `failure.cause` (level 2) reaches a level-2 client only, while `failure` stays level 1.
 */
import type { ApiError, Compat, DeviceIdError, GenerationEvent, ServiceRefusalCode } from '@whim/contract';
import { REFUSAL_HINTS } from './admission/refusals';

/** Anything that goes out as an SSE event: a contract `GenerationEvent`, or the envelope a client
 *  below the event's level gets instead. */
export interface WireEvent {
  readonly type: string;
  readonly compat?: Compat;
}

/** One registered event type or error code. */
export interface WireEntry<M> {
  /** The protocol level the event type or error code was introduced at. */
  readonly level: number;
  /** Required above level 1: what a client that cannot use the message does instead. */
  readonly compat?: Compat;
  /** Fields of this message introduced after its own level, by name to the level each arrived at.
   *  A client below a field's level never receives the field; the rest of the message is sent
   *  as it is. */
  readonly fields?: Readonly<Record<string, number>>;
  /** The same content in a form a client at `clientLevel` understands, or `undefined` when there is
   *  none. The result's own entry must be at or below `clientLevel`, or the envelope is sent. */
  readonly downgrade?: (message: M, clientLevel: number) => M | undefined;
}

export interface WireRegistry {
  readonly events: Readonly<Record<string, WireEntry<WireEvent>>>;
  readonly errors: Readonly<Record<string, WireEntry<ApiError>>>;
}

/** The `/v1` error codes a route or the request edge sets itself, beside the contract's closed
 *  refusal and device-identity vocabularies. */
type RouteErrorCode =
  | 'invalid_envelope'
  | 'invalid_request'
  | 'internal_error'
  | 'model_failure'
  | 'clarify_not_configured'
  | 'rewrite_not_configured';

type V1ErrorCode = ServiceRefusalCode | DeviceIdError['error'] | RouteErrorCode;

/** Everything the wire had at level 1, the first level (beta-1). */
const LEVEL_1 = Object.freeze({ level: 1 });

const EVENT_LEVELS = {
  stage: LEVEL_1,
  token: LEVEL_1,
  thinking: LEVEL_1,
  diagnostic: LEVEL_1,
  usage: LEVEL_1,
  queued: LEVEL_1,
  restart: LEVEL_1,
  result: LEVEL_1,
  failure: Object.freeze({ level: 1, fields: Object.freeze({ cause: 2 }) }),
} satisfies { readonly [K in GenerationEvent['type']]: WireEntry<WireEvent> };

const ERROR_LEVELS = {
  payload_too_large: LEVEL_1,
  daily_limit: LEVEL_1,
  device_busy: LEVEL_1,
  server_busy: LEVEL_1,
  content_policy: LEVEL_1,
  policy_unavailable: LEVEL_1,
  budget_exhausted: LEVEL_1,
  update_required: LEVEL_1,
  consent_required: LEVEL_1,
  provider_unavailable: Object.freeze({
    level: 2,
    compat: Object.freeze({ min: 2, fallback: 'fail', notice: REFUSAL_HINTS.provider_unavailable }),
  }),
  missing_device_id: LEVEL_1,
  invalid_device_id: LEVEL_1,
  invalid_envelope: LEVEL_1,
  invalid_request: LEVEL_1,
  internal_error: LEVEL_1,
  model_failure: LEVEL_1,
  clarify_not_configured: LEVEL_1,
  rewrite_not_configured: LEVEL_1,
} satisfies { readonly [K in V1ErrorCode]: WireEntry<ApiError> };

/** The production registry: every `GenerationEvent` type and every `/v1` error code. */
export const WIRE_REGISTRY: WireRegistry = Object.freeze({ events: EVENT_LEVELS, errors: ERROR_LEVELS });

function entryOf<M>(entries: Readonly<Record<string, WireEntry<M>>>, key: string): WireEntry<M> {
  if (!Object.hasOwn(entries, key)) throw new Error(`"${key}" is not a registered wire message`);
  return entries[key];
}

function withCompat<M extends { readonly compat?: Compat }>(message: M, entry: WireEntry<M>): M {
  return entry.compat === undefined ? message : { ...message, compat: entry.compat };
}

/** `message` without each of its entry's `fields` introduced above `clientLevel`. */
function withoutNewerFields<M extends { readonly compat?: Compat }>(message: M, entry: WireEntry<M>, clientLevel: number): M {
  const newer = Object.entries(entry.fields ?? {}).filter(([name, level]) => level > clientLevel && name in message);
  if (newer.length === 0) return message;
  const kept: Record<string, unknown> = { ...(message as Record<string, unknown>) };
  for (const [name] of newer) delete kept[name];
  return kept as M;
}

/** The form of `message` a client at `clientLevel` may receive: itself (with its entry's `compat`)
 *  when its entry is at or below the level, else its downgrade when that one is, else the
 *  envelope `envelopeOf` builds from the entry's `compat`. */
function forLevel<M extends { readonly compat?: Compat }>(
  message: M,
  keyOf: (m: M) => string,
  entries: Readonly<Record<string, WireEntry<M>>>,
  clientLevel: number,
  envelopeOf: (compat: Compat) => M,
): M {
  const entry = entryOf(entries, keyOf(message));
  if (entry.level <= clientLevel) return withCompat(withoutNewerFields(message, entry, clientLevel), entry);
  const lower = entry.downgrade?.(message, clientLevel);
  if (lower !== undefined) {
    const lowerEntry = entryOf(entries, keyOf(lower));
    if (lowerEntry.level <= clientLevel) return withCompat(withoutNewerFields(lower, lowerEntry, clientLevel), lowerEntry);
  }
  if (entry.compat === undefined) throw new Error(`"${keyOf(message)}" is above level 1 but carries no compat`);
  return envelopeOf(entry.compat);
}

/** What a client that declared `clientLevel` receives for `event`. */
export function eventForLevel(event: WireEvent, clientLevel: number, registry: WireRegistry = WIRE_REGISTRY): WireEvent {
  return forLevel(event, (e) => e.type, registry.events, clientLevel, (compat) => ({ type: event.type, compat }));
}

/** What a client that declared `clientLevel` receives for the error body `body`. */
export function errorForLevel(body: ApiError, clientLevel: number, registry: WireRegistry = WIRE_REGISTRY): ApiError {
  return forLevel(body, (b) => b.error, registry.errors, clientLevel, (compat) => ({ error: body.error, hint: body.hint, compat }));
}
