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
 */
import { z } from 'zod';

export type { DiagnosticKind } from '../../checks/contract';

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

/** One answered clarify question, carried BY VALUE into the generate/rewrite request: the server
 *  holds no per-device state between the clarify exchange and the request that follows it. The
 *  `question` text rides along so a server never has to look one up. */
export const Clarification = z.object({
  id: z.string(),
  question: z.string(),
  answer: z.string(),
});
export type Clarification = z.infer<typeof Clarification>;

/** One question the clarify exchange asks, with the answer options the device renders as
 *  single-select pills. `options` is non-empty: a question with nothing to pick is not a question. */
export const ClarifyQuestion = z.object({
  id: z.string(),
  question: z.string(),
  options: z.array(z.string()).min(1),
});
export type ClarifyQuestion = z.infer<typeof ClarifyQuestion>;

/** `POST /v1/clarify` request. Unary — clarify happens BEFORE any generation request exists, so it
 *  is deliberately NOT a `GenerationEvent` stage and opens no stream (design D1). */
export const ClarifyRequest = z.object({ prompt: z.string() });
export type ClarifyRequest = z.infer<typeof ClarifyRequest>;

/** `POST /v1/clarify` response: an ORDERED list of AT MOST THREE questions. An empty list is valid
 *  and means "nothing needs clarifying" — the common case, a success, never a degraded mode. Four
 *  or more questions fails to parse. */
export const ClarifyResponse = z.object({ questions: z.array(ClarifyQuestion).max(3) });
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
 *  both mean "the user answered nothing". */
export const RewriteRequest = z.object({
  prompt: z.string(),
  clarifications: z.array(Clarification).optional(),
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
});
export type RewriteResponse = z.infer<typeof RewriteResponse>;

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

/** The SSE payload — a discriminated union on `type`. Unknown `type` is rejected (clients can trust
 *  the union is closed at a given contract version). `usage` is emitted before the terminal event on
 *  BOTH success and failure. `result`/`failure` are the two terminal events. */
export const GenerationEvent = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('stage'),
    stage: z.enum(['plan', 'generate', 'check', 'run', 'repair']),
    status: z.enum(['start', 'done']),
    attempt: z.number().optional(),
  }),
  z.object({ type: z.literal('token'), text: z.string() }),
  z.object({ type: z.literal('diagnostic'), diagnostic: Diagnostic }),
  z.object({ type: z.literal('usage'), usage: Usage }),
  // `summary` is OPTIONAL so the stub pipeline, a server whose summariser failed, and an older
  // server all stay conforming — a device is never blocked on its presence.
  z.object({ type: z.literal('result'), app: WireAppRecord, summary: RunSummary.optional() }),
  z.object({
    type: z.literal('failure'),
    reason: z.string(),
    attempts: z.number(),
    diagnostics: z.array(Diagnostic),
  }),
]);
export type GenerationEvent = z.infer<typeof GenerationEvent>;

/** The shape every non-SSE `4xx`/`5xx` JSON body a conforming server returns from a `/v1/*` route
 *  validates against — `error` is a machine-readable identifier, `hint` is mandatory non-empty
 *  guidance, mirroring the diagnostics discipline. No route invents an ad-hoc error shape.
 *  `DeviceIdError` below is this shape's narrower, closed-enum specialization for the
 *  device-identity middleware, and stays assignable to `ApiError`. */
export const ApiError = z.object({
  error: z.string(),
  hint: z.string().min(1),
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
