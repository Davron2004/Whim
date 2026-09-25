# handoff/wire-protocol.md — beta-1 chain-1 (wire protocol, design D16); read by chains 2, 3, 4

## `@whim/contract` (`contract/src/index.ts`)

```ts
export const PROTOCOL_LEVEL = 1;
export const PROTOCOL_HEADER = 'x-whim-protocol';
export const ProtocolLevelHeader = PositiveIntegerText;       // header text → number; same rule as the build header
export const CompatFallback = z.enum(['skip', 'fail', 'update']); // FROZEN: never gains a member or changes meaning
export const COMPAT_NOTICE_MAX_CHARS = 200;
export const Compat = z.object({ min: z.number().int().positive(), fallback: CompatFallback, notice: z.string().max(200).optional() });
export const WireEnvelope = z.object({                       // reader side: fallback is an OPEN string
  type: z.string().optional(), error: z.string().optional(),
  compat: z.object({ min: int ≥ 1, fallback: z.string(), notice: z.string().max(200).optional() }).optional(),
});
// Every GenerationEvent arm, ApiError, ClarifyResponse, RewriteResponse and ReportResponse gains `compat?: Compat`.
{ type: 'queued'; position: number /* int ≥ 1: generations ahead + 1 */ }   // non-terminal
{ type: 'restart' }                                                        // non-terminal: the current model turn is resent; its tokens since the turn began are void
export const ClarifyQuestion = z.object({ id, question, options: z.array(z.string()).min(1), select: z.enum(['one', 'many']), other: z.boolean() });
export const ClarifyLimit = z.object({ reason: z.string().min(1), alternative: z.string().min(1) });
export const ClarifyResponse = z.object({ questions: z.array(ClarifyQuestion).max(3), limit: ClarifyLimit.optional(), compat? })
  .refine((r) => r.limit === undefined || r.questions.length === 0);
export const CLARIFICATION_OTHER_MAX_CHARS = 200;
export const Clarification = z.object({ id, question, choices: z.array(z.string()), other: z.string().min(1).max(200).optional(), decide: z.boolean().optional() })
  .refine((c) => c.decide === true ? c.choices.length === 0 && c.other === undefined : c.choices.length > 0 || c.other !== undefined);
```
- Every object schema strips unknown fields. Exempt, and kept `.strict()`: `DiagnosticRecord`/`DiagnosticsBatch`
  (device→server request bodies whose refusal is their own allowlist rule). `contract.suite.ts` walks every export.
- At most one choice for `select: 'one'` is NOT in the schema (an entry has no mode): device and server enforce it.

## Server
**Request edge** (`request-edge.ts`, mounted in `app.ts`), `/v1/*` order:
`assignRequestId` → device gate (400) → `readEnvelope` (400 `invalid_envelope`) → `readProtocolLevel` → `minimumBuildGate` → routes.
`readProtocolLevel`: header missing, empty or not a positive integer → `updateRequiredRefusal()` (426, the gate's exact body),
before any admission, ledger row or model call; otherwise `c.set('protocolLevel', n)`. Routes read
`c.get('protocolLevel'): number` (`RequestVariables.protocolLevel`, always set on `/v1`). `parseProtocolLevel(headers): number | undefined` is exported.

**Registry and emitter** (`wire-level.ts`), verbatim:
```ts
export interface WireEvent { readonly type: string; readonly compat?: Compat }
export interface WireEntry<M> {
  readonly level: number;                                   // level the event type / error code was introduced at
  readonly compat?: Compat;                                 // required above level 1, with min === level
  readonly downgrade?: (message: M, clientLevel: number) => M | undefined;
}
export interface WireRegistry {
  readonly events: Readonly<Record<string, WireEntry<WireEvent>>>;
  readonly errors: Readonly<Record<string, WireEntry<ApiError>>>;
}
export const WIRE_REGISTRY: WireRegistry;   // every GenerationEvent type + every /v1 error code, all level 1
export function eventForLevel(event: WireEvent, clientLevel: number, registry?: WireRegistry): WireEvent;
export function errorForLevel(body: ApiError, clientLevel: number, registry?: WireRegistry): ApiError;
```
- entry.level ≤ clientLevel → the message, plus the entry's `compat` when it has one.
- above → `downgrade(message, clientLevel)` if its result's own entry is ≤ clientLevel (one step, not recursive);
  else only the envelope: `{ type, compat }` / `{ error, hint, compat }`. Never the higher-level payload.
- Throws `Error` for an unregistered type/code, and for an entry above the client with no `compat`.
- `buildSseStream(source: AsyncIterable<WireEvent>, …)` (`sse.ts`) writes the helper's output as is.
- `EVENT_LEVELS` is a mapped type over `GenerationEvent['type']` and `ERROR_LEVELS` over
  `ServiceRefusalCode | DeviceIdError['error'] | RouteErrorCode`: a new arm or refusal code fails typecheck until registered.

**Call-site rule.** Any producer of an event type or error code whose entry is above level 1 MUST send it through
`eventForLevel`/`errorForLevel` with `c.get('protocolLevel')`. Everything in beta-1 is level 1 (`queued`, `restart`,
the `limit` arm, `select`/`other`, the new `Clarification`, `queue_timeout`), so no beta-1 call site is required to;
routing a level-1 message through the helper returns it unchanged. A NEW `/v1` error code must be added to
`ERROR_LEVELS` (`RouteErrorCode` for route-local ones) AND the device's `KNOWN_ERROR_CODES`; the device reads an
unregistered code as unknown → `fail` (lockstep: `wire-future-frames.suite.ts`). A unary success-body FIELD above
level 1 has no helper: its route adapts it. Raising the level: bump `PROTOCOL_LEVEL` in the contract and in
`src/host/launcher/wire-headers.ts` together (`header-lockstep.suite.ts`).

**Failure code.** `'queue_timeout'` is in `TERMINAL_FAILURE_CODES` (`generation/failure-codes.ts`). Corrected after chain-2: a waiter has no ledger row, because the daily unit IS the row (`usage-store.ts#admit`), so the ledger never stores it; it labels the terminal log line.
No reason constant exists yet (no consumer): the `failure.reason` for it is the `server_busy` capacity hint,
`serverBusyRefusal().body.hint` = "Whim is busy right now. Please try again in a few minutes." (same pattern as
`CREDIT_EXHAUSTED_REASON` reusing the `budget_exhausted` hint).

**Clarify interim (chain 3 replaces).** `shapeClarify` keeps a model's `select: 'many'` / `other: true`, else
`'one'` / `false`; stub questions are `'one'`/`false`; `limit` is never produced. Prompt turns render
`- question → choices.join(', ')` and skip entries with no choices; the policy input's answer is `choices.join(', ')`.
`other` and `decide` reach no prompt and no policy input: whoever renders them must add them to `policy/input.ts` too.

## Device (`src/host/launcher`)

`wire-headers.ts`: `PROTOCOL_HEADER`, `PROTOCOL_LEVEL = 1`; `transport-shared.ts#requestHeaders` sends it on every `/v1` request.
`wire-compat.ts` (no runtime contract import), verbatim:
```ts
export type WireFallback =
  | { readonly kind: 'skip' }
  | { readonly kind: 'fail'; readonly notice?: string }
  | { readonly kind: 'update'; readonly notice?: string };
export type TerminalFallback = Exclude<WireFallback, { kind: 'skip' }>;
export type WireGate = { readonly kind: 'decode' } | { readonly kind: 'fallback'; readonly fallback: WireFallback };
export function gateMessage(message: Record<string, unknown>, known: boolean): WireGate;
export const KNOWN_ERROR_CODES: readonly string[];            // == server registry codes at level ≤ PROTOCOL_LEVEL
export function isKnownErrorCode(code: string): boolean;
```
Decode: known && (no compat || compat.min ≤ PROTOCOL_LEVEL) → full guard. Otherwise: no compat → `fail`; unreadable
compat (not a record; min not a safe int ≥ 1; fallback not a string; notice not a string ≤ 200) → `fail`; fallback
outside the set → `fail` (notice kept); empty notice = none. Known event types = keys of `generation-client.ts#EVENT_GUARDS`
(mapped over `GenerationEvent['type']`).

**Where callers receive it.** `skip` never leaves the client: an SSE frame is dropped; a success body is read with
this build's guard; an `ApiError` becomes the ordinary `http` error. `fail`/`update` are THROWN as
`GenerationClientError{ kind: 'fallback', fallback: TerminalFallback, status?, requestId? }` by: `generateApp`'s
iteration (a frame, via `parseSseBlock`), `clarifyPrompt`/`rewritePrompt`/`sendReport` (success body: `gateUnaryBody`;
error body: `httpErrorFrom`), and the generate open on either transport (`httpErrorFrom`). They land in
`LauncherRoot.tsx`'s catches (`runAttempt`, `onComposeContinue`, `openPlan`) and `ReportSheet.handleSend`.

**Interim device behaviours (chain 4 replaces each):**
1. `update` → `serviceRefusalOf` returns `{ code: 'update_required', hint: notice ?? COPY.updateRequiredLine }`, so the existing update-screen path opens; the notice is not shown.
2. `fail` → `errorReason`: the notice as the failure reason (`server_refused`), else `GENERIC_STREAM_ERROR` (`unexpected_error`); the report sheet shows its generic failure notice.
3. `queued`/`restart` → accepted by the guards; `journalStreamEvent` treats them as liveness only (moves `lastFrameAt`); no line UI; `restart` voids nothing.
4. `limit` → accepted by `isClarifyResponse`, then ignored: zero questions → the plan step.
5. `select`/`other` → required by the guard, ignored by ClarifyStep (single pick); `clarificationsFrom` sends `choices: [picked]`, never `other`/`decide`.
6. A skipped frame is neither an event nor a keepalive: it moves no liveness clock.

## Invariants and error surface
- A level-N client never receives a level-N+1 payload (`wire-level.suite.ts`); `x-whim-protocol` absent → 426, never served.
- Not an envelope (non-object, or `type` not a string) → `stream_parse`; a known event failing its guard → `stream_parse`.
- `isClarifySkip` is `kind === 'http' && status === 502` (a fallback error on a 502 is not a skip).
- Every non-app `/v1` caller sends the header: `deploy/smoke.sh`, `bench-envelope.ts` (flowbench + load-test drivers), server suites (`route-doubles.ts#PROTOCOL_HEADERS`/`PROTOCOL_HEADER_LINE`).
