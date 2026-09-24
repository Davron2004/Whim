/**
 * server/src/request-edge.ts — the `/v1` request edge (request-envelope D3/D6/D9): the request id
 * minted before the device gate, the client envelope read after it, and the Hono context variables
 * every later middleware and route reads.
 *
 * The request id is one UUID per `/v1` request. It is returned in `x-whim-request-id` on every
 * `/v1` response — device-gate, envelope and admission refusals, a thrown route's `500`, and an SSE
 * open alike — and it is bound into a request-scoped child logger (`c.get('log')`), so every line a
 * route logs through that logger carries `requestId`. Routes use it as the usage ledger row's id.
 *
 * The envelope is the four client headers. None of them present is a legacy client, served exactly
 * as before the envelope existed (`LEGACY_ENVELOPE`); some but not all, or any malformed value, is
 * refused `400` before any route admission — only a buggy client sends that.
 */
import { randomUUID } from 'node:crypto';
import type { MiddlewareHandler } from 'hono';
import {
  APP_VERSION_HEADER,
  BUILD_HEADER,
  ClientEnvelope,
  CONSENT_HEADER,
  PLATFORM_HEADER,
  REQUEST_ID_HEADER,
  type ApiError,
} from '@whim/contract';
import { log, type ServerLogger } from './logger';

/** What a request with none of the four envelope headers is treated as (design D3). A client
 *  envelope always names `ios` or `android` and a positive build, so `platform: 'unknown'` (and
 *  build `0`) identifies a legacy client unambiguously. */
export const LEGACY_ENVELOPE = Object.freeze({ platform: 'unknown', appVersion: 'unknown', build: 0, consent: 1 } as const);
export type LegacyEnvelope = typeof LEGACY_ENVELOPE;

/** The envelope a `/v1` request is served under. */
export type RequestEnvelope = ClientEnvelope | LegacyEnvelope;

/** The context variables a `/v1` route can rely on: every one is set before any route runs. */
export interface RequestVariables {
  /** This request's id — the `x-whim-request-id` value and the ledger row id. */
  requestId: string;
  /** The root logger's child bound to `{ requestId }`. */
  log: ServerLogger;
  /** Set by the device gate from the `DeviceVerifier`'s answer — never the raw header. */
  deviceId: string;
  /** Set by the envelope middleware. */
  envelope: RequestEnvelope;
}

/** The env every `/v1` route module is typed with. */
export type V1Env = { Variables: RequestVariables };

/** The app-level env: outside `/v1` (and before each `/v1` middleware has run) a variable may be
 *  unset, so the app itself reads them as optional. */
export type EdgeEnv = { Variables: Partial<RequestVariables> };

/** Mounted on `/v1/*` BEFORE the device gate. The header is stamped after the rest of the chain
 *  has produced its response, so a refusal, a thrown route's `500` and an SSE open all carry it;
 *  `c.header` re-wraps a finalized response, so a route's raw `Response` gets it too. */
export const assignRequestId: MiddlewareHandler<EdgeEnv> = async (c, next) => {
  const requestId = randomUUID();
  c.set('requestId', requestId);
  c.set('log', log.child({ requestId }));
  await next();
  c.header(REQUEST_ID_HEADER, requestId);
};

const ENVELOPE_HEADERS = {
  platform: PLATFORM_HEADER,
  appVersion: APP_VERSION_HEADER,
  build: BUILD_HEADER,
  consent: CONSENT_HEADER,
} as const;

type EnvelopeField = keyof typeof ENVELOPE_HEADERS;

const FIELD_FORMATS: Readonly<Record<EnvelopeField, string>> = {
  platform: 'ios or android',
  appVersion: 'the installed app version, such as 1.0.0',
  build: 'a positive integer',
  consent: 'a positive integer, or none',
};

const FIELDS = Object.keys(ENVELOPE_HEADERS) as EnvelopeField[];

export type EnvelopeParse = { ok: true; envelope: RequestEnvelope } | { ok: false; body: ApiError };

function invalidEnvelope(hint: string): EnvelopeParse {
  return { ok: false, body: { error: 'invalid_envelope', hint } };
}

/** Reads the four envelope headers: none present → the legacy envelope; some missing, or any
 *  value malformed → an `invalid_envelope` body whose hint names the offending header. A header
 *  present with an empty value counts as present and malformed. */
export function parseRequestEnvelope(headers: Headers): EnvelopeParse {
  const missing = FIELDS.filter((field) => !headers.has(ENVELOPE_HEADERS[field]));
  if (missing.length === FIELDS.length) return { ok: true, envelope: LEGACY_ENVELOPE };
  if (missing.length > 0) {
    const names = missing.map((field) => ENVELOPE_HEADERS[field]).join(', ');
    return invalidEnvelope(`Send all four client headers or none of them; missing ${names}.`);
  }
  const raw = Object.fromEntries(FIELDS.map((field) => [field, headers.get(ENVELOPE_HEADERS[field])]));
  const parsed = ClientEnvelope.safeParse(raw);
  if (parsed.success) return { ok: true, envelope: parsed.data };
  const field = parsed.error.issues[0]?.path[0] as EnvelopeField;
  return invalidEnvelope(`The ${ENVELOPE_HEADERS[field]} header must be ${FIELD_FORMATS[field]}.`);
}

/** Mounted on `/v1/*` right AFTER the device gate: a refused envelope ends the request before any
 *  later middleware or route admission runs. */
export const readEnvelope: MiddlewareHandler<EdgeEnv> = async (c, next) => {
  const result = parseRequestEnvelope(c.req.raw.headers);
  if (!result.ok) return c.json(result.body, 400);
  c.set('envelope', result.envelope);
  await next();
};

/** The envelope's fields on the per-request log line (design D9) — never the device id. Empty for
 *  a request that ended before its envelope was read (outside `/v1`, or refused at the edge). */
export function envelopeLogFields(envelope: RequestEnvelope | undefined): Record<string, unknown> {
  if (!envelope) return {};
  const { platform, appVersion, build, consent } = envelope;
  return { platform, appVersion, build, consent };
}
