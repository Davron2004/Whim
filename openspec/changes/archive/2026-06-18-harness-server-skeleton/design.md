# harness-server-skeleton — design

## Context

There is no server. `build/build.mjs` is the documented local stand-in for the future
server-side harness build, and every harness-lane change (#9/#10/#11) needs a service to mount into, while #7 (prompt-flow-ux) needs a wire contract immediately. Decisions already locked:
TypeScript backend on **Node 22** (#31 + #42), **REST + SSE, zod schemas in a shared
`contract/` package, monorepo `server/` workspace** (#42), **stateless server / device is
system of record — only an anon device ID + token counter persist** (§4.7 Model 1, #33),
**harness server-side always** (#34), model access via **OpenRouter** (#42).

Repo reality this design must respect: the **RN app is the root package** (`package.json` has
no `workspaces` field today; Metro config is the RN default), and the repo's test idiom is
**bespoke Node runners that esbuild-bundle a TS acceptance suite and run it in-process — no
jest, zero new test deps** (`src/host/bridge/test/run.mjs` is the model; it also proves
`node:sqlite` works as a built-in under this repo's Node 22).

## Goals / Non-Goals

**Goals:**

- Stand up `contract/` + `server/` workspaces without perturbing the RN/Android build — and
  *prove* non-perturbation with a guard, not an assertion.
- Freeze the wire contract #7 builds against: request shapes, the SSE event stream, the
  diagnostics envelope, the wire app record, usage shapes.
- A running server a phone-shaped client can hit on LAN: SSE generation endpoint streaming
  **canned** stage events, rewrite endpoint returning a **canned** rewrite, device-UUID
  gate, durable per-ID token counter, usage readback.
- An OpenRouter client wrapper tested against a fake transport, ready for #11 to mount.

**Non-Goals:**

- Real pipeline stages (plan/generate/check/run/repair — #9/#10/#11); prompt assembly;
  repair loops. The stub pipeline is *scaffolding shaped like the contract*, nothing more.
- Any device code (`src/**` untouched; #7 owns the client), deployment/TLS/process
  management (LAN dev only), accounts/PII, rate limiting beyond the token counter.
- Calling OpenRouter from any endpoint (the wrapper exists; nothing routes to it).

## Decisions

### D1 — Workspace topology: npm workspaces `["contract", "server"]`, RN app stays the root package

Root `package.json` gains `"workspaces": ["contract", "server"]`. The RN app is **not** moved
into an `apps/` folder (alternative rejected: it churns `android/` relative paths, CLI
autolinking, CI, and every doc, for zero v1 benefit).

Metro-safety analysis (the brief's explicit warning):

- **Hoisting**: npm will hoist workspace deps into the root `node_modules`. Hazard is a
  hoisted package shadowing or duplicating an RN dependency — above all **a second `react`**.
  Rule: `server/` and `contract/` MUST NOT depend on `react`/`react-dom`/anything
  React-Native-adjacent; their dep budget is deliberately tiny (see D2/D4).
- **Symlinks**: workspaces appear as `node_modules/@whim/*` symlinks. Metro in RN 0.85
  resolves symlinks, and both workspace dirs live *inside* the Metro project root (already
  watched), so when #7 imports `@whim/contract` it resolves as ordinary project source. In
  *this* change no device code imports it — the only Metro-visible effect is install layout.
- **The guard (load-bearing)**: a new `npm run guard:metro` script runs
  `react-native bundle --platform android --dev false --entry-file index.js` to a temp file
  and exits non-zero on resolution failure. It runs in CI next to `build` + `invariants`.
  This converts "we believe Metro is unaffected" into a blocking check, in this change and
  for every future server-lane change.

### D2 — Framework: Hono on `@hono/node-server`

Chosen over plain `node:http` (the brief's other candidate). Rationale: the device-UUID gate
wants real middleware composition; SSE wants the framework's streaming helper rather than
hand-rolled `res.write` framing in every route; #11 will multiply routes and middleware, and
hand-rolled routing is exactly the code that rots. Hono is dependency-light, typed, and runs
on a plain `node:http` adapter — if it ever fights us the escape hatch is the adapter
boundary, not a rewrite. Express rejected (legacy weight, no first-class types); plain
`node:http` rejected as accreting a bespoke micro-framework anyway. New runtime deps:
`hono`, `@hono/node-server`, `zod` — that is the complete list.

### D3 — Wire contract: `@whim/contract`, TS-source-only, zod-first

`contract/` = package `@whim/contract`, sole dependency `zod`. It ships **TS source directly**
(`main`/`exports` → `src/index.ts`, no build step): every consumer — esbuild (server runner),
Metro/Babel (device, #7), the eval CLI (#12) — compiles TS natively, and a `dist/` would be
one more generated artifact to forget. Schemas are zod values; static types derive via
`z.infer` (one source of truth, #31's point).

Schema surface (names are the contract — #7/#9/#11 import these):

- `GenerateRequest` — `{ prompt, app? }`; `app` (edit flow) = `{ source, manifest, schema }`
  re-sent per #33 (no wire diffs — #33 guard (b)).
- `RewriteRequest` / `RewriteResponse` — `{ prompt }` / `{ rewrittenPrompt }` (plain JSON
  endpoint; the rewrite is fast and unary — no stream).
- `GenerationEvent` — discriminated union on `type`, the SSE payload:
  - `{ type: 'stage', stage: 'plan'|'generate'|'check'|'run'|'repair', status: 'start'|'done', attempt? }`
  - `{ type: 'token', text }` — streamed generation deltas for #7's progress UI
  - `{ type: 'diagnostic', diagnostic: Diagnostic }`
  - `{ type: 'usage', usage: Usage }` — emitted before the terminal event on success *and* failure
  - `{ type: 'result', app: WireAppRecord }` | `{ type: 'failure', reason, attempts, diagnostics }`
    — exactly one terminal event per stream (`failure.reason` is user-facing prose: §10's
    honest failure screen).
- `Diagnostic` — the §8.1 envelope `{ kind, symbol?, line?, hint }`, `kind` an **open** string
  here; #9 owns narrowing it into the catalog (this package is where that catalog will live).
- `WireAppRecord` — `{ name, source, bundle, sourceMap?, manifest, schema }`. Deliberately
  device-ID-free: the *wire* record is ours; the *stored* record (ids, install state) is
  #5's. First-to-land defines the seam — record any #5 divergence in the roadmap ledger.
- `Usage` — `{ promptTokens, completionTokens, totalTokens }`.

### D4 — Endpoints, identity, metering

Routes (versioned under `/v1`): `POST /v1/rewrite` (JSON), `POST /v1/generate` (SSE),
`GET /v1/usage` (JSON), `GET /healthz` (no gate). SSE rides a **POST** response — the request
carries a body, and §4.7's shape is request → stream-back → done; `EventSource` (GET-only) is
explicitly not a supported client, fetch-with-readable-stream is (what RN gives #7 anyway).
SSE framing: `event: <type>` + `data: <GenerationEvent JSON>` + monotonic `id:` (seq), comment
keepalives at an injectable interval.

Identity: middleware on all `/v1/*` routes requires header **`x-whim-device`** = UUIDv4 (the
MMKV-stored anon ID, #42); missing/malformed → `400` with a structured error body. Metering:
per-ID token counter persisted via **`node:sqlite`** (already proven a zero-dep built-in by
the bridge suite) in a gitignored data dir (`WHIM_DATA_DIR`, default `server/.data/`); one
table, ~KB/user, satisfying §4.7 "the only server state". Flat JSON file rejected: same
effort once atomic-rename is written, less durable, and SQLite is already the repo's idiom.
The store sits behind a `UsageStore` interface (`:memory:` in tests). The stub pipeline
credits fake usage through the same path #11 will use, so metering is real even while
generation is canned.

### D5 — Stub pipeline behind the real interface

A `Pipeline` interface (`run(request) → AsyncIterable<GenerationEvent>`) with one
implementation, `stubPipeline`: emits the canned, contract-valid sequence — stage
start/done pairs for plan → generate (with a few `token` events) → check → run, then `usage`,
then `result` carrying a tiny fixed `WireAppRecord` (placeholder source/bundle; no real build).
A magic prompt token (e.g. `[[fail]]`) yields the `failure` path so #7 can build the failure
screen against a live wire. Inter-event delay is injected (realistic on LAN, `0` in tests).
#11 replaces the implementation behind this exact interface; the route never changes.

### D6 — OpenRouter client wrapper

`server/src/openrouter.ts`: thin client over OpenRouter's OpenAI-compatible chat-completions
SSE API. Contract: model id is **always a caller parameter** (#42 strong-first /
downgrade-by-eval — nothing in the skeleton names a model), streaming-first
(`AsyncIterable` of text deltas), captures the final usage chunk into `Usage`, normalizes
auth/rate-limit/network failures into typed errors, `fetch` injectable. Unit-tested against a
fake transport replaying recorded SSE frames; **no live-network test, no route mounts it**
(#11 does). `OPENROUTER_API_KEY` via env / gitignored `.env`; absent key only matters when
the wrapper is actually invoked.

### D7 — Execution & test idiom: repo-native, zero new dev deps

- `npm run server:dev` → `node server/dev.mjs`: esbuild-bundles `server/src/main.ts` and runs
  it (the `build.mjs`/bridge-runner idiom; no `tsx`, no `ts-node`). Binds `0.0.0.0`, port
  `WHIM_SERVER_PORT` (default `8787`) — phones on the LAN can hit it.
- `npm run server:test` → `node server/test/run.mjs`: esbuild-bundles a TS acceptance suite,
  runs it in-process against the Hono app (`app.request()` — no port, no network flake); SSE
  responses parsed by a small test-side reader. TDD per §16.2 — this surface is fully
  deterministic. English test specs are written first (§16.5, tasks.md task 1).
- CI: `server:test` + `guard:metro` join `build` + `invariants` as blocking gates.
- `contract/` and `server/` get their own `tsconfig.json`s (Node-flavored, not the RN one);
  `tsc --noEmit` over both runs inside `server:test` so type drift fails the gate. Root
  ESLint extends over the new dirs.

## Risks / Trade-offs

- **[Workspace install mutates the RN dependency tree]** → the D1 no-React-adjacent-deps rule
  keeps the hoist inert; `guard:metro` makes any regression a red CI, not a runtime surprise;
  `package-lock.json` diff is reviewed as part of the change.
- **[Contract churn once real stages land (#9/#11)]** → schemas are versioned under `/v1` and
  the `Diagnostic.kind` is deliberately open; additive evolution only (the storage lane's
  additive-only discipline, #38, applied to the wire). Breaking edits to `GenerationEvent`
  after #7 builds against it require a coordinated change, called out in the ledger.
- **[Stub pipeline shapes #7 around unrealistic timing]** → injectable delays default to
  LAN-realistic values (hundreds of ms between stages, token bursts), not zero.
- **[`node:sqlite` is still marked experimental upstream]** → already shipped in this repo's
  bridge suite under the pinned Node 22; usage here is one table behind `UsageStore`, so
  swapping engines is a one-file change.
- **[Hono dep risk]** → confined behind the `node:http` adapter and ordinary handler
  signatures; the contract package — the part everything else couples to — has zero framework
  surface.
- **[SSE-over-POST rules out `EventSource` clients]** → accepted; the only client is
  first-party (#7) and RN's fetch streams responses. Documented in the contract package.

## Open Questions

- None blocking. (`x-whim-device` rotation/reset semantics deliberately deferred — Model 1
  keeps nothing worth protecting beyond a counter; revisit if usage ever gates features.)
