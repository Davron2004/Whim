# server/contract deterministic test spec (English-first, §16.5)

This is the authored-first test plan for the `harness-server-skeleton` change. The acceptance
suite (`server/test/acceptance.ts`, run by `server/test/run.mjs`) implements exactly these
assertions. Everything here is deterministic and in-process — no network, no real model, SSE
parsed by a test-side reader, `node:sqlite` opened as `:memory:`. Each group cites the spec
requirement it covers (`generation-contract` = GC, `generation-server` = GS).

The runner also performs `tsc --noEmit` over `contract/` and `server/` before/around the
assertions (GS-8); a type error fails the suite.

---

## 1. Contract round-trips (GC-3, GC-4, GC-5, GC-6/Usage)

1.1 **Every `GenerationEvent` variant round-trips.** For one literal example of each union
member — `stage` (start and done; with and without `attempt`), `token`, `diagnostic`, `usage`,
`result`, `failure` — serialize to JSON and re-parse with `GenerationEvent.parse`; the parsed
value deep-equals the input. (GC-3 "Round-trip validation".)

1.2 **Mandatory non-empty `hint` on `Diagnostic`.** A `Diagnostic` with `hint: ""` (and one with
`hint` omitted) fails `Diagnostic.parse`; a `Diagnostic` with a non-empty `hint` passes. `kind`
accepts an arbitrary string (open union — not a closed enum). (GC-4 "Hint is mandatory".)

1.3 **`WireAppRecord` is install-state-free.** A valid `WireAppRecord` parses with only
`{ name, source, bundle, sourceMap?, manifest, schema }`. Adding `id` / `installedAt` /
`position` is either stripped (if `.strict()` is not used) or the absence of those keys is
asserted on the parsed shape — the test asserts the parsed record exposes no app-id or
install-state field. A `result` event validates carrying only generation outputs. (GC-5.)

1.4 **Closed union rejects unknown `type`.** A payload `{ type: "bogus", ... }` fails
`GenerationEvent.parse`. (GC-3 "Unknown event type rejected".)

1.5 **One `Usage` shape everywhere.** Assert the schema object used by the `usage` SSE event,
the `/v1/usage` response, and the OpenRouter wrapper's captured usage is the *same* `Usage`
schema by identity (same imported reference), not three lookalikes. `Usage` requires integer
`promptTokens`/`completionTokens`/`totalTokens` (a non-integer fails parse). (GC-6.)

1.6 **Request shapes.** `GenerateRequest` requires `prompt`; `app` is optional and, when
present, requires full `{ source, manifest, schema }` (the edit flow re-sends full source, never
a diff). `RewriteRequest` = `{ prompt }`, `RewriteResponse` = `{ rewrittenPrompt }`. (GC-2.)

## 2. Dependency budget (GC-1, GS-1)

2.1 **`contract/package.json` budget.** Read at test time: its only runtime `dependencies` key
is `zod`. The suite fails if anything React-adjacent (`react`, `react-dom`, `react-native`, any
`react-*`) or any server framework appears in `dependencies`. (GC-1 "Dependency budget".)

2.2 **`server/package.json` budget.** Runtime `dependencies` are exactly `hono`,
`@hono/node-server`, `@whim/contract`. Anything React-adjacent fails the test. (GS-1.)

## 3. Device-identity middleware (GS-2)

3.1 **Missing header → 400, no stream.** `POST /v1/generate` (and `/v1/rewrite`, `/v1/usage`)
with no `x-whim-device` returns HTTP `400`, `content-type: application/json`, body
`{ error: "missing_device_id", hint: <non-empty> }`. No SSE stream opens.

3.2 **Malformed header → 400.** A non-UUID `x-whim-device` (e.g. `"not-a-uuid"`) returns `400`
with `{ error: "invalid_device_id", hint: <non-empty> }`.

3.3 **`/healthz` is exempt.** `GET /healthz` with no headers returns `200`.

3.4 **Valid id reaches handlers.** A well-formed UUID passes the gate; the validated id is what
metering and `/v1/usage` scope to (covered transitively by §6).

## 4. SSE framing (GS-3)

Tested via in-process `app.request()` and a small test-side SSE reader that splits frames on the
blank line and parses `event:` / `data:` / `id:`.

4.1 **Frame shape.** Each emitted frame has `event:` = the event's `type`, `data:` = the event's
JSON (which re-parses through `GenerationEvent`), and an `id:`.

4.2 **Monotonic ids.** Across a full stream the `id:` values are strictly increasing integers.

4.3 **Injectable keepalive.** With the keepalive interval forced active, comment keepalive lines
(`:`-prefixed) appear and are ignored by the reader; with interval injected as effectively off
(test default) none appear. Keepalives never count as events and never carry an `id:` collision.

4.4 **Exactly one terminal, always last.** A completed stream contains exactly one `result` or
`failure` event and it is the final event; the stream then closes. (Also a contract-level check:
feeding the captured event list through a "exactly one terminal, last" assertion.)

## 5. Stub pipeline + endpoints (GS-3, GS-4)

5.1 **Happy path order.** A valid `GenerateRequest` (with device header) yields, in order:
`stage{plan,start}` … `stage{plan,done}`, `stage{generate,start}`, ≥1 `token`,
`stage{generate,done}`, `stage{check,start/done}`, `stage{run,start/done}`, then `usage`, then
`result` carrying a small fixed `WireAppRecord`. Each stage's `start` precedes its `done`; ids
strictly increasing; stream ends after `result`. (GS-3 "Canned happy path".)

5.2 **Failure path.** A prompt containing the magic token `[[fail]]` yields a stream whose single
terminal is `failure` (user-facing `reason` prose, numeric `attempts`, `diagnostics` array),
preceded by a `usage` event. No `result` event appears. (GS-3 "Canned failure path".)

5.3 **Invalid body never opens a stream.** A `POST /v1/generate` body that fails
`GenerateRequest` validation returns `400` JSON with a structured error — *not* `text/event-stream`.
(GS-3 "Invalid body never opens a stream".)

5.4 **Deterministic delay off in tests.** The injectable inter-event delay is `0` in the suite so
runs are fast and deterministic.

5.5 **Canned rewrite.** A valid `RewriteRequest` (with device header) returns a `RewriteResponse`
whose `rewrittenPrompt` is a deterministic function of the input (same input → same output;
asserted across two calls). Invalid body → `400`. (GS-4.)

## 6. Metering — the only server state (GS-5, GS-6)

6.1 **Stub generation meters real state across restart.** Run two stub generations for one device
id against a `UsageStore` backed by a temp `node:sqlite` file (not `:memory:`), then construct a
fresh store over the same file (simulating restart) and read back: the accumulated total equals
the sum of both runs' `usage` events. (GS-5 "Stub generation meters real state".)

6.2 **Nothing but the counter persists.** After a generation, inspect the data dir / table: it
contains device-id→counter rows only — assert no column/row holds prompt, source, bundle, or app
content. (GS-5 "Nothing but the counter persists".)

6.3 **Readback scoped to caller.** After device A's generations, `GET /v1/usage` with A's header
returns totals equal to what the store recorded for A alone; device B's readback is unaffected.
(GS-6 "Readback matches metered usage".)

6.4 **Unknown id reads zeros, not error.** `GET /v1/usage` for an id with no recorded usage
returns HTTP `200` with `{ promptTokens: 0, completionTokens: 0, totalTokens: 0 }`. (GS-6.)

6.5 **Credit happens before the terminal event.** The generate route credits usage through the
`UsageStore` before emitting the terminal event (asserted by reading usage immediately after a
stream completes and seeing the credited total).

## 7. OpenRouter wrapper (GS-7) — fake transport, no live network

7.1 **Streaming deltas in order.** Running a streaming completion against recorded SSE frames
(injected `fetch`) yields text deltas in the recorded order via the async iterable. (GS-7
"Streaming completion".)

7.2 **Usage capture.** The final chunk's usage is captured and validates as the contract `Usage`
schema (by identity per §1.5). (GS-7.)

7.3 **Model-id passthrough.** The caller-supplied model id appears verbatim in the outgoing
request body the wrapper hands to the injected `fetch` (asserted by capturing the request). No
model id is hard-coded anywhere in the wrapper. (GS-7.)

7.4 **Typed errors.** A replayed `401` raises a distinct typed auth error; a replayed `429`
raises a distinct typed rate-limit error; a transport throw raises a typed network error — three
distinguishable error types, not generic throws. (GS-7 "Failures are typed".)

7.5 **No key required by the suite.** No test reads `OPENROUTER_API_KEY`; the wrapper is never
invoked over the real network and no route mounts it.
