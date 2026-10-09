/**
 * @whim/contract — the single source of truth for every shape crossing the device↔server wire.
 *
 * Schemas are zod values; static types derive via `z.infer` (one source of truth — decision #31).
 * TS-source-only: this file IS the published entry (no build step, no dist/). Consumers — the
 * server (esbuild), the device (Metro/Babel, #7), the eval CLI (#12) — all compile TS natively.
 *
 * Transport notes (documented here per design D4):
 *   - The generation stream rides a POST response, NOT `EventSource` (GET-only); the request
 *     carries a body. React Native's global `fetch` is the `whatwg-fetch` polyfill over
 *     `XMLHttpRequest` and has no streaming response body (`response.body` is `undefined`), so it
 *     cannot read this stream incrementally. The device consumes it over an XHR-backed transport
 *     instead, which RN's `XMLHttpRequest` supports natively — see the `generation-stream-transport`
 *     capability and decision #58.
 *   - A `GenerationEvent` stream that runs to completion carries EXACTLY ONE terminal event
 *     (`result` | `failure`), always last. That is a stream-level invariant enforced by the
 *     emitter — it is not (and cannot be) expressed in the per-event schema below. A stream
 *     aborted by the client (disconnect or cancellation) ends without a terminal event; the
 *     invariant applies only to streams the server runs to completion, and a truncated stream
 *     is not a conformance violation.
 *   - Schemas evolve additively under `/v1` (storage lane's additive-only discipline, #38).
 *   - Forward compatibility (beta-1 design D16): every object schema here STRIPS unknown fields
 *     rather than rejecting them (layer 1), except the two device→server diagnostics bodies whose
 *     refusal is their own allowlist rule; a client declares the level it understands in
 *     `PROTOCOL_HEADER` (layer 2); and every SSE event and unary body may carry `compat` (layer 3).
 */
import { z } from 'zod';

export type { DiagnosticKind } from '../../checks/contract';

/** The dev-only log envelope (obs-v1, design D6): plain types, no zod value, no runtime export.
 *  Re-exported type-only so consumers keep importing the package entry — the exception stays one
 *  module wide (`dev-log.ts`) and nothing runtime crosses with it. */
export type { DevLogBatch, DevLogLevel, DevLogRecord, DevLogSinkPath } from './dev-log';

/** The disclosure manifest's widening ids (legal-surface-v2 D4), type-only: the launcher's
 *  what's-new copy names them. The manifest's values are imported by path, never through here. */
export type { WideningId } from './disclosure-manifest';

/** The wire protocol level this contract describes (beta-1 design D16). It goes up by one whenever
 *  the wire gains a message, field meaning or refusal code a client at the previous level would not
 *  understand. Every `/v1` request declares the level its client understands in `PROTOCOL_HEADER`;
 *  a server never sends a client anything introduced above that level. */
export const PROTOCOL_LEVEL = 1;

/** The closed vocabulary a client applies to a message it cannot use: `skip` ignores it and
 *  carries on, `fail` ends the flow on the failure screen, `update` ends it on the update screen.
 *  FROZEN: it never gains a member or changes meaning, because it is the one thing the oldest
 *  installed build must understand forever. */
export const CompatFallback = z.enum(['skip', 'fail', 'update']);
export type CompatFallback = z.infer<typeof CompatFallback>;

/** The longest `compat.notice` a message may carry, in characters. */
export const COMPAT_NOTICE_MAX_CHARS = 200;

const CompatMin = z.number().int().positive();

/** `compat.notice`, optional, with `null` read as no notice: the oldest installed build reads it
 *  that way, so a producer writing "none" as `null` still has its fallback applied. `min` and
 *  `fallback` get no such reading: a `null` there is a `compat` no client can read. */
const CompatNotice = z
  .string()
  .max(COMPAT_NOTICE_MAX_CHARS)
  .nullish()
  .transform((notice) => notice ?? undefined)
  .optional();

/** The forward-compatibility field a producer attaches to a message introduced above level 1:
 *  `min` is the lowest protocol level that can use the message, `fallback` what a client below it
 *  (or one that does not know the message at all) does instead, and `notice` the plain text the
 *  failure or update screen shows. */
export const Compat = z.object({
  min: CompatMin,
  fallback: CompatFallback,
  notice: CompatNotice,
});
export type Compat = z.infer<typeof Compat>;

/** Phase one of the two-phase decode every client applies to every SSE event and unary body: the
 *  message's `type` (an event) or `error` (an `ApiError`) plus its optional `compat`, and nothing
 *  else. Unknown fields are tolerated, and `compat.fallback` is read as an open string so a value
 *  outside `CompatFallback` still parses — a client treats it as `fail`. A client decodes the full
 *  schema only when it knows the type or code and `compat.min` (default 1) is at most its level;
 *  otherwise it applies the fallback, and an unknown message with no `compat` means `fail`.
 *  `compat: null` is no `compat`, as the oldest installed build reads it. */
export const WireEnvelope = z.object({
  type: z.string().optional(),
  error: z.string().optional(),
  compat: z
    .object({ min: CompatMin, fallback: z.string(), notice: CompatNotice })
    .nullish()
    .transform((compat) => compat ?? undefined)
    .optional(),
});
export type WireEnvelope = z.infer<typeof WireEnvelope>;

/** The optional `compat` every SSE event and unary body accepts, spread into each shape, with
 *  `null` read as no `compat` the way `WireEnvelope` reads it. */
const compatField = {
  compat: Compat.nullish()
    .transform((compat) => compat ?? undefined)
    .optional(),
};

/** Integer token counts. ONE shape, used identically by the SSE `usage` event, `/v1/usage`, and
 *  the OpenRouter wrapper's captured usage — imported by reference, never re-declared. */
export const Usage = z.object({
  promptTokens: z.number().int(),
  completionTokens: z.number().int(),
  totalTokens: z.number().int(),
});
export type Usage = z.infer<typeof Usage>;

/** The §8.1 diagnostics envelope. `hint` is mandatory non-empty (shaped like the right SDK
 *  answer). `kind` stays an OPEN wire string so existing stub/runtime kinds keep validating; #9
 *  re-exports the static-check closed kind union as a TS-only narrowing for producers that want it. */
export const Diagnostic = z.object({
  kind: z.string(),
  severity: z.enum(['error', 'warning']).optional(),
  message: z.string().optional(),
  symbol: z.string().optional(),
  line: z.number().optional(),
  hint: z.string().min(1),
});
export type Diagnostic = z.infer<typeof Diagnostic>;

/** App manifest / schema sub-shapes. No cheaply-importable zod schema exists on-device (P4); the
 *  wire only needs them to round-trip, not to re-validate app internals. zod-4 requires the
 *  two-arg `z.record(keyType, valueType)`. */
const ManifestShape = z.record(z.string(), z.unknown());
const SchemaShape = z.record(z.string(), z.unknown());

/** The verified-bundle payload a generation delivers. Deliberately install-state-FREE: no app-id,
 *  install timestamp, or launcher position. The *stored* record (those fields) is the launcher's
 *  concern (#5); the *wire* record is this contract's. P3: the stored record adds install state on
 *  top of this set — the only naming seam is wire `schema` ↔ stored `schemaArtifact`.
 *
 *  An app's declared tile colour rides INSIDE `manifest` (`manifest.tileColor`, a `#rrggbb`
 *  literal) — the same statically extracted structure that already carries capabilities — and is
 *  deliberately NOT a second top-level field: manifest data has exactly one source. `manifest`
 *  stays an untyped record on the wire; the host validates the colour where it consumes it. */
export const WireAppRecord = z.object({
  name: z.string(),
  source: z.string(),
  bundle: z.string(),
  sourceMap: z.string().optional(),
  manifest: ManifestShape,
  schema: SchemaShape,
});
export type WireAppRecord = z.infer<typeof WireAppRecord>;

/** The longest typed `Clarification.other` answer, in characters. */
export const CLARIFICATION_OTHER_MAX_CHARS = 200;

/** One answered clarify question, carried BY VALUE into the generate/rewrite request: the server
 *  holds no per-device state between the clarify exchange and the request that follows it. The
 *  `question` text rides along so a server never has to look one up.
 *
 *  `choices` are the options the user picked, `other` the answer they typed, and `decide: true`
 *  means they asked Whim to decide. An entry carries either `decide: true` alone (no choices, no
 *  `other`) or at least one choice or an `other`. At most one choice for a `select: 'one'` question
 *  is the device's and the server's rule, not this schema's: the entry does not carry the mode. */
export const Clarification = z
  .object({
    id: z.string(),
    question: z.string(),
    choices: z.array(z.string()),
    other: z.string().min(1).max(CLARIFICATION_OTHER_MAX_CHARS).optional(),
    decide: z.boolean().optional(),
  })
  .refine(
    (c) => (c.decide === true ? c.choices.length === 0 && c.other === undefined : c.choices.length > 0 || c.other !== undefined),
    { message: 'A clarification carries decide: true alone, or at least one choice or an other answer.' },
  );
export type Clarification = z.infer<typeof Clarification>;

/** One question the clarify exchange asks, with the answer options the device renders as pills.
 *  `options` is non-empty: a question with nothing to pick is not a question. `select` says whether
 *  one or several options may be picked, and `other` whether the user may type their own answer. */
export const ClarifyQuestion = z.object({
  id: z.string(),
  question: z.string(),
  options: z.array(z.string()).min(1),
  select: z.enum(['one', 'many']),
  other: z.boolean(),
});
export type ClarifyQuestion = z.infer<typeof ClarifyQuestion>;

/** What clarify answers when a request's core needs something mini-apps can't do (beta-1 D9):
 *  plain words saying why, and the nearest thing that can be built instead. */
export const ClarifyLimit = z.object({
  reason: z.string().min(1),
  alternative: z.string().min(1),
});
export type ClarifyLimit = z.infer<typeof ClarifyLimit>;

/** The display-name-only context of an app a request CHANGES: its current name, the collections
 *  (and fields) it already keeps, and a plain-words `description` of what it currently is (the
 *  device sends the prompt text that produced the current version). Shared verbatim by
 *  `RewriteRequest.app` and `ClarifyRequest.app` — one shape for "this describes an edit, not a
 *  new app" wherever that fact needs to cross the wire. Carries no source, bundle, burned ids, or
 *  record contents; see `RewriteRequest.app`'s doc comment for why. */
export const AppContext = z.object({
  name: z.string(),
  collections: z
    .array(z.object({ name: z.string(), fields: z.array(z.string()) }))
    .optional(),
  description: z.string().optional(),
});
export type AppContext = z.infer<typeof AppContext>;

/** `POST /v1/clarify` request. Unary — clarify happens BEFORE any generation request exists, so it
 *  is deliberately NOT a `GenerationEvent` stage and opens no stream (design D1).
 *
 *  `app` is OPTIONAL, mirroring `RewriteRequest.app`: its presence means "this clarify exchange is
 *  about a change to an app the user already has", so the clarifier can ask about the CHANGE
 *  instead of re-deriving what the app already is. Absent means a new app. */
export const ClarifyRequest = z.object({ prompt: z.string(), app: AppContext.optional() });
export type ClarifyRequest = z.infer<typeof ClarifyRequest>;

/** `POST /v1/clarify` response: an ORDERED list of AT MOST THREE questions. An empty list is valid
 *  and means "nothing needs clarifying" — the common case, a success, never a degraded mode. Four
 *  or more questions fails to parse. A response carrying `limit` says the request can't be built as
 *  asked, and carries no questions. */
export const ClarifyResponse = z
  .object({ questions: z.array(ClarifyQuestion).max(3), limit: ClarifyLimit.optional(), ...compatField })
  .refine((r) => r.limit === undefined || r.questions.length === 0, {
    message: 'A clarify response carrying limit carries no questions.',
  });
export type ClarifyResponse = z.infer<typeof ClarifyResponse>;

/** Generation request. The edit flow re-sends the FULL current source inside `app` (never a wire
 *  diff — Model 1, #33).
 *
 *  `clarifications` is OPTIONAL: the answers the user gave to the clarify exchange's questions.
 *  Absent and empty both mean "the user answered nothing" — a legitimate, common state (the user
 *  skipped, or the clarifier had nothing to ask).
 *
 *  `app.source` is OPTIONAL (#52-D5 / D14): it carries the app's original TypeScript when the
 *  device has it. Its absence means exactly "the device has no original source for this app" —
 *  a pre-existing install whose snapshots predate source tracking — and a conforming server
 *  regenerates under `manifest`/`appliedSchema` rather than treat compiled bundle output as
 *  source. `manifest` and `schema` stay required within `app`.
 *
 *  `app.appliedSchema` is an OPTIONAL record carrying the storage group's **accumulated**
 *  applied-schema union — the database's `_meta` monotone union (#38), not the app's own
 *  `schema` artifact above. It is the diff baseline the harness's schema checks run against and
 *  the source of the burned-ID allocation floor. When absent, the baseline is the empty applied
 *  schema. `schema` and `appliedSchema` are deliberately separate optional-vs-required fields
 *  that can legitimately differ. */
export const GenerateRequest = z.object({
  prompt: z.string(),
  clarifications: z.array(Clarification).optional(),
  app: z
    .object({
      source: z.string().optional(),
      manifest: ManifestShape,
      schema: SchemaShape,
      appliedSchema: SchemaShape.optional(),
    })
    .optional(),
});
export type GenerateRequest = z.infer<typeof GenerateRequest>;

/** Rewrite is fast and unary — plain JSON, no stream. `clarifications` carries the clarify
 *  exchange's answers so the rewrite (and the plan rows it returns) reflect them; absent and empty
 *  both mean "the user answered nothing".
 *
 *  `app` is the OPTIONAL context of the app this rewrite CHANGES: its presence means "this
 *  request describes a change to an app that already exists", its absence means a new app. It is
 *  an `AppContext` — DISPLAY NAMES ONLY (plus an optional plain-words `description`) — because the
 *  rewrite turn writes a product description, not code: it never needs (and so never receives)
 *  source, bundle text, burned collection/field ids, applied schemas, record contents, or any
 *  device-side identity. Anything else a client sends inside `app` is stripped here rather than
 *  forwarded. */
export const RewriteRequest = z.object({
  prompt: z.string(),
  clarifications: z.array(Clarification).optional(),
  app: AppContext.optional(),
});
export type RewriteRequest = z.infer<typeof RewriteRequest>;

/** One labelled row of the plan the device renders as its approval gate (design D10). */
export const PlanRow = z.object({ label: z.string(), text: z.string() });
export type PlanRow = z.infer<typeof PlanRow>;

/** `plan` is OPTIONAL: its absence means "this server produced no structured breakdown", and the
 *  device renders `rewrittenPrompt` as a single row — so a server that returns no rows (and an
 *  empty list, which means the same thing) stays conforming. */
export const RewriteResponse = z.object({
  rewrittenPrompt: z.string(),
  plan: z.array(PlanRow).optional(),
  ...compatField,
});
export type RewriteResponse = z.infer<typeof RewriteResponse>;

/** The closed set of reasons a device can attach to a content report. */
export const ReportReason = z.enum(['broken', 'wrong_result', 'hard_to_use', 'harmful', 'offensive', 'other']);
export type ReportReason = z.infer<typeof ReportReason>;

/** `POST /v1/report` request. Only `reason` is mandatory. `note` and `appName` are shape-bounded
 *  (server-facing display text); `prompt` and `source` carry no character bound here — their byte
 *  caps are an admission concern (`413`), not a shape rule, since the cap is UTF-8-byte-measured
 *  and configurable. Carries no device identity: identity rides `x-whim-device`. */
export const ReportRequest = z.object({
  reason: ReportReason,
  note: z.string().max(1000).optional(),
  appName: z.string().max(200).optional(),
  prompt: z.string().optional(),
  source: z.string().optional(),
});
export type ReportRequest = z.infer<typeof ReportRequest>;

/** `POST /v1/report` response. */
export const ReportResponse = z.object({ reportId: z.string().min(1), ...compatField });
export type ReportResponse = z.infer<typeof ReportResponse>;

/** The closed set of change kinds the device groups history by. Closed on purpose: a history
 *  screen groups by these and nothing else. */
export const SummaryKind = z.enum(['Start', 'Added', 'Changed', 'Removed', 'Look', 'Fixed']);
export type SummaryKind = z.infer<typeof SummaryKind>;

/** One highlight span over the summary's OWN `text`: `start`/`end` are character offsets into
 *  `text` (`end` exclusive), never into anything else. `chg` marks what changed, `hedge` marks the
 *  part the summariser is unsure about.
 *
 *  The producer-side budget — offsets in bounds, no two marks overlapping, at most one `chg` and
 *  one `hedge` per sentence — is enforced by the PRODUCER (see the `generation-pipeline` spec), not
 *  by this schema: a client must stay correct against a producer that violates it, which it cannot
 *  do if the whole terminal event fails to parse. The renderer enforces its display caps
 *  independently. */
export const SummaryMark = z.object({
  cls: z.enum(['chg', 'hedge']),
  start: z.number().int(),
  end: z.number().int(),
});
export type SummaryMark = z.infer<typeof SummaryMark>;

/** The post-run summariser's output, carried ON the terminal `result` event and nowhere else
 *  (design D2) — never its own event, never before the terminal, never on a run that produced no
 *  record. `touched` names the plain-words AREAS a change affected (never file names or symbols). */
export const RunSummary = z.object({
  text: z.string(),
  kind: SummaryKind,
  touched: z.array(z.string()),
  marks: z.array(SummaryMark),
});
export type RunSummary = z.infer<typeof RunSummary>;

/** The SSE payload — a discriminated union on `type`. `GenerationEvent.parse` rejects an unknown
 *  `type`; a CLIENT never gets that far with one, because it reads every frame through
 *  `WireEnvelope` first and applies the frame's `compat` fallback instead (design D16). `usage` is
 *  emitted before the terminal event on BOTH success and failure. `result`/`failure` are the two
 *  terminal events. Every arm accepts the optional `compat` field.
 *
 *  `thinking`: the model is reasoning before or between writing; carries only a length. Some
 *  roster models emit a distinct reasoning stream ahead of (or interleaved with) their visible
 *  content, and without a signal for it the device sees total silence for minutes and then
 *  thousands of characters at once. `chars` is the length of ONE reasoning delta — the reasoning
 *  TEXT itself never crosses the wire: it is not user-facing, and the run journal must never carry
 *  raw model text it did not ask to keep.
 *
 *  `queued`: the generation is waiting for a free slot; `position` is the number of generations
 *  ahead of it plus one. `restart`: the current model turn is being sent again, so the tokens
 *  streamed for that turn since its start are void. Neither is terminal. */
export const GenerationEvent = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('stage'),
    stage: z.enum(['plan', 'generate', 'check', 'run', 'repair']),
    status: z.enum(['start', 'done']),
    attempt: z.number().optional(),
    ...compatField,
  }),
  z.object({ type: z.literal('token'), text: z.string(), ...compatField }),
  z.object({ type: z.literal('thinking'), chars: z.number().int().positive(), ...compatField }),
  z.object({ type: z.literal('diagnostic'), diagnostic: Diagnostic, ...compatField }),
  z.object({ type: z.literal('usage'), usage: Usage, ...compatField }),
  z.object({ type: z.literal('queued'), position: z.number().int().min(1), ...compatField }),
  z.object({ type: z.literal('restart'), ...compatField }),
  // `summary` is OPTIONAL so the stub pipeline, a server whose summariser failed, and an older
  // server all stay conforming — a device is never blocked on its presence.
  z.object({ type: z.literal('result'), app: WireAppRecord, summary: RunSummary.optional(), ...compatField }),
  z.object({
    type: z.literal('failure'),
    reason: z.string(),
    attempts: z.number(),
    diagnostics: z.array(Diagnostic),
    ...compatField,
  }),
]);
export type GenerationEvent = z.infer<typeof GenerationEvent>;

/** The shape every non-SSE `4xx`/`5xx` JSON body a conforming server returns from a `/v1/*` route
 *  validates against — `error` is a machine-readable identifier, `hint` is mandatory non-empty
 *  guidance, mirroring the diagnostics discipline. No route invents an ad-hoc error shape.
 *  `DeviceIdError` below is this shape's narrower, closed-enum specialization for the
 *  device-identity middleware, and stays assignable to `ApiError`. Every `error` identifier
 *  introduced above protocol level 1 carries `compat`. */
export const ApiError = z.object({
  error: z.string(),
  hint: z.string().min(1),
  ...compatField,
});
export type ApiError = z.infer<typeof ApiError>;

/** The structured `400` body the device-identity middleware returns (shared so `/v1/usage` and any
 *  client match it). `hint` is non-empty, mirroring the diagnostics discipline. A closed-enum
 *  specialization of `ApiError` above — every `DeviceIdError` value validates as `ApiError` too. */
export const DeviceIdError = z.object({
  error: z.enum(['missing_device_id', 'invalid_device_id']),
  hint: z.string().min(1),
});
export type DeviceIdError = z.infer<typeof DeviceIdError>;

/** The request envelope's header names (request-envelope D1/D8): every `/v1` request carries the
 *  first four, and every `/v1` response carries the request id. The device cannot import values
 *  from this package (zod never enters Metro), so it keeps its own literals and a static check holds
 *  them equal to these. */
export const PLATFORM_HEADER = 'x-whim-platform';
export const APP_VERSION_HEADER = 'x-whim-app-version';
export const BUILD_HEADER = 'x-whim-build';
export const CONSENT_HEADER = 'x-whim-consent';
export const REQUEST_ID_HEADER = 'x-whim-request-id';
/** Request: the highest protocol level the client understands (`PROTOCOL_LEVEL` in its build). */
export const PROTOCOL_HEADER = 'x-whim-protocol';

/** The platforms a client envelope can name. */
export const ClientPlatform = z.enum(['ios', 'android']);
export type ClientPlatform = z.infer<typeof ClientPlatform>;

/** A positive integer as header text: digits only, no sign, no leading zero, no exponent, and at
 *  most 15 digits so it always converts to a safe integer. */
const PositiveIntegerText = z.string().regex(/^[1-9]\d{0,14}$/).transform(Number);

/** The installed marketing version the envelope accepts: a digit first, then up to 31 of
 *  `[0-9A-Za-z.+-]`, so a pre-release or build suffix still parses (`1.0.0`, `1.1.0-beta.2`). The
 *  device keeps its own literal (`src/host/launcher/app-info.ts`) and a static check holds the two
 *  equal, so the phone never sends a version this schema refuses. */
export const APP_VERSION_PATTERN = /^\d[0-9A-Za-z.+-]{0,31}$/;

/** The four envelope headers as the server reads them: the input is the raw header text keyed by
 *  field, the output the parsed envelope. `appVersion` is the installed marketing version
 *  (`APP_VERSION_PATTERN`); `build` is the installed build number; `consent` is the consent
 *  version the request is sent under, or `none` when no grant is required and none exists. A
 *  request with NONE of the headers is a legacy client — that default is the server's, not a value
 *  of this schema. */
export const ClientEnvelope = z.object({
  platform: ClientPlatform,
  appVersion: z.string().regex(APP_VERSION_PATTERN),
  build: PositiveIntegerText,
  consent: z.union([z.literal('none'), PositiveIntegerText]),
});
export type ClientEnvelope = z.infer<typeof ClientEnvelope>;
export type ConsentVersion = ClientEnvelope['consent'];

/** `PROTOCOL_HEADER` as the server reads it: a positive integer as header text, parsed to a
 *  number. Anything else — including no header at all — is below every level the server supports. */
export const ProtocolLevelHeader = PositiveIntegerText;

/** The closed vocabulary of `error` identifiers a conforming server uses for size, admission,
 *  content-policy, and operator-budget refusals. Every value validates as `ApiError`, whose `error`
 *  stays an open string — this is a narrower, closed-enum specialization used by admission control
 *  and the content policy, the same pattern `DeviceIdError` uses above. `budget_exhausted` means
 *  the operator's own provider credit is exhausted (distinct from `daily_limit`, a device/global
 *  admission ceiling, and `policy_unavailable`, the content classifier being down); its `hint`
 *  SHALL say generation is unavailable for now without naming the provider or a dollar amount.
 *  `update_required` (`426`) refuses a build below its platform's minimum; `consent_required`
 *  (`403`) refuses a request whose consent version does not cover the route's data practice.
 *  Grows only additively — no refusal introduces a second error shape. */
export const ServiceRefusalCode = z.enum([
  'payload_too_large',
  'daily_limit',
  'device_busy',
  'server_busy',
  'content_policy',
  'policy_unavailable',
  'budget_exhausted',
  'update_required',
  'consent_required',
]);
export type ServiceRefusalCode = z.infer<typeof ServiceRefusalCode>;

/** The body of `POST /v1/diagnostics` may be at most this many bytes (developer-observability D2). */
export const DIAGNOSTICS_MAX_BODY_BYTES = 32 * 1024;

/** A string an allowlisted diagnostic field may carry: at most 128 characters. */
const DiagnosticString = z.string().max(128);
/** An allowlisted diagnostic field's value: a bounded string or a finite number. */
const DiagnosticValue = z.union([DiagnosticString, z.number().finite()]);

/** One device error record, projected onto the closed allowlist (developer-observability D2,
 *  device-diagnostics "Only an allowlisted projection of an error record leaves the device").
 *  `.strict()`: a field outside the allowlist is refused, never dropped, so an old or tampered
 *  client cannot widen what the server logs. `route` is a path only — no host, no query, no
 *  fragment. `stack` is capped at 4 KB and never starts with the error's message line (the
 *  device drops it; the server cannot tell, so the cap is all it enforces). */
export const DiagnosticRecord = z
  .object({
    at: z.number().finite(),
    level: z.enum(['debug', 'info', 'warn', 'error']),
    channel: DiagnosticString,
    message: DiagnosticString,
    screen: DiagnosticValue.optional(),
    errorClass: DiagnosticValue.optional(),
    where: DiagnosticValue.optional(),
    stage: DiagnosticValue.optional(),
    reason: DiagnosticValue.optional(),
    kind: DiagnosticValue.optional(),
    status: DiagnosticValue.optional(),
    errorCode: DiagnosticValue.optional(),
    domain: DiagnosticValue.optional(),
    readyState: DiagnosticValue.optional(),
    observedRepairAttempts: DiagnosticValue.optional(),
    requestId: DiagnosticValue.optional(),
    route: DiagnosticString.regex(/^\/[^?#]*$/).optional(),
    count: DiagnosticValue.optional(),
    stack: z.string().max(4096).optional(),
  })
  .strict();
export type DiagnosticRecord = z.infer<typeof DiagnosticRecord>;

/** `POST /v1/diagnostics`'s body: the OS version and 1–50 records, nothing else. Platform, app
 *  version and build travel in the request envelope headers; the device id only in
 *  `x-whim-device`, never in the body. */
export const DiagnosticsBatch = z
  .object({
    osVersion: DiagnosticString,
    records: z.array(DiagnosticRecord).min(1).max(50),
  })
  .strict();
export type DiagnosticsBatch = z.infer<typeof DiagnosticsBatch>;
