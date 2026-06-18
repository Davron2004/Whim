# harness-server-skeleton

## Why

Everything server-side so far is a local stand-in (`build/build.mjs`); there is no server. The
harness must live server-side (decision #34 — phone owns stable, server owns volatile), and
lane C's later changes (#9 static checks, #10 synthetic run, #11 generation loop) all need a
place to mount, while lane B's prompt flow (#7) needs a wire contract to build against *now*.
This change erects that scaffold: the workspaces, the shared schema package, the SSE channel
with a stub pipeline, identity + metering, and the OpenRouter client — no real generation.

## What Changes

- **Monorepo workspaces** — new `contract/` and `server/` npm workspaces in this repo
  (decision #42: shared TS types between SDK, checks, and server is the whole point of #31).
  The RN app stays the root package; the design's first job is keeping Metro away from
  workspace-resolution hazards (hoisting, symlinks, duplicate React) — the RN/Android build
  must be provably unaffected.
- **`contract/` package** — zod schemas as the single wire source of truth: generation
  request, rewrite request/response, the SSE event stream (stage/progress/diagnostic/terminal
  events), the diagnostics *envelope* (§8.1's `{kind, symbol, line, hint}` shape — #9 fills
  the catalog later), the app record, and usage/metering shapes. Consumed by the server now;
  by the device (#7), checks (#9), and evals (#12) later.
- **`server/` package** — Node 22 HTTP service (thin framework, Hono vs plain `node:http`
  decided in design): an SSE generation endpoint over a **stub pipeline** that streams canned
  stage events (plan → generate → check → run → done) in the contract's event shapes, so #7
  can build the full progress UI against it; a rewrite endpoint returning a canned rewrite.
- **Device identity + metering** — middleware requiring the anon device-UUID header
  (decision #42 identity); a per-ID token counter as the *only* server state (§4.7 Model 1,
  ~KB/user; SQLite vs flat file decided in design); a usage-readback endpoint.
- **OpenRouter client wrapper** — model-agnostic, streaming, usage-capturing (#42 model
  strategy: strong-first, downgrade-by-eval — the wrapper takes a model id, never embeds one).
  Built and tested against a fake transport; **not** wired into the stub pipeline (#11 does that).
- **Suites + CI** — deterministic Node test suite (`npm run server:test`, repo convention:
  no jest) TDD'd per §16.2; wired into CI as a blocking gate alongside `build`/`invariants`;
  plus a Metro-unaffected guard (RN bundle still resolves after workspace-ification).

Explicitly **not** changing: real pipeline stages (#9/#10/#11), deployment/TLS (LAN dev only),
accounts/PII (anon UUID only), anything under `src/` (no device code — #7 owns the client),
the runtime/sandbox/bundle contract (untouched tree).

## Capabilities

### New Capabilities

- `generation-contract`: the shared wire contract — zod schemas for generation/rewrite
  requests, the SSE event stream, the diagnostics envelope, app record, and usage shapes;
  workspace-consumption rules (who imports it and how, including the Metro-safety
  requirement on the device side).
- `generation-server`: the harness service skeleton — endpoints, SSE mechanics, device-UUID
  identity middleware, token metering (the only server state), the stub pipeline's canned
  stage stream, and the OpenRouter client wrapper contract.

### Modified Capabilities

*(none — no existing spec's requirements change; the server consumes nothing on-device yet)*

## Impact

- **New top-level workspaces:** `contract/` (zod only) and `server/` (framework + OpenRouter
  wrapper). Root `package.json` gains a `workspaces` field and `server:*` scripts; root
  install layout changes (hoisting) — guarded, see design.
- **`.github/workflows/`** — `server:test` added as a blocking gate (existing
  `build` + `invariants` gate untouched).
- **Untouched:** `src/**` (host, sdk, runtime), `build/`, `fixtures/`, `invariants/**`,
  `android/` — the device tree must not change. New secrets: `OPENROUTER_API_KEY` via env,
  gitignored `.env`; never committed, never required by tests.
- **Downstream contracts created:** #7 builds its SSE client + progress UI against the stub
  endpoint; #9 extends the diagnostics envelope into the catalog; #11 replaces the stub
  pipeline behind the same event schema.
