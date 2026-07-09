/**
 * @whim/contract — the single source of truth for every shape crossing the device↔server wire.
 *
 * Schemas are zod values; static types derive via `z.infer` (one source of truth — decision #31).
 * TS-source-only: this file IS the published entry (no build step, no dist/). Consumers — the
 * server (esbuild), the device (Metro/Babel, #7), the eval CLI (#12) — all compile TS natively.
 *
 * Transport notes (documented here per design D4):
 *   - The generation stream rides a POST response (`fetch` + readable stream), NOT `EventSource`
 *     (GET-only); the request carries a body. RN's fetch streams responses, which is the only
 *     first-party client.
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
 *  top of this set — the only naming seam is wire `schema` ↔ stored `schemaArtifact`. */
export const WireAppRecord = z.object({
  name: z.string(),
  source: z.string(),
  bundle: z.string(),
  sourceMap: z.string().optional(),
  manifest: ManifestShape,
  schema: SchemaShape,
});
export type WireAppRecord = z.infer<typeof WireAppRecord>;

/** Generation request. The edit flow re-sends the FULL current source inside `app` (never a wire
 *  diff — Model 1, #33). */
export const GenerateRequest = z.object({
  prompt: z.string(),
  app: z
    .object({
      source: z.string(),
      manifest: ManifestShape,
      schema: SchemaShape,
    })
    .optional(),
});
export type GenerateRequest = z.infer<typeof GenerateRequest>;

/** Rewrite is fast and unary — plain JSON, no stream. */
export const RewriteRequest = z.object({ prompt: z.string() });
export type RewriteRequest = z.infer<typeof RewriteRequest>;
export const RewriteResponse = z.object({ rewrittenPrompt: z.string() });
export type RewriteResponse = z.infer<typeof RewriteResponse>;

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
  z.object({ type: z.literal('result'), app: WireAppRecord }),
  z.object({
    type: z.literal('failure'),
    reason: z.string(),
    attempts: z.number(),
    diagnostics: z.array(Diagnostic),
  }),
]);
export type GenerationEvent = z.infer<typeof GenerationEvent>;

/** The structured `400` body the device-identity middleware returns (shared so `/v1/usage` and any
 *  client match it). `hint` is non-empty, mirroring the diagnostics discipline. */
export const DeviceIdError = z.object({
  error: z.enum(['missing_device_id', 'invalid_device_id']),
  hint: z.string().min(1),
});
export type DeviceIdError = z.infer<typeof DeviceIdError>;
