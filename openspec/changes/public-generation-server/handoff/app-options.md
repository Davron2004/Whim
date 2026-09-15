# app-options (chain-9)

`server/src/app.ts`'s `createApp(options: AppOptions)`. Only `pipeline` and `usageStore` are
REQUIRED — every admission/policy/report/resolver/credit dependency is OPTIONAL with an internal
default, so every pre-existing suite (`server-core`, `wire-v2`, `metering`, `logging`) still
constructs a bare `createApp({ pipeline, usageStore, ... })` unchanged.

```ts
export interface AppOptions {
  pipeline: Pipeline;
  usageStore: UsageStore;
  keepaliveMs?: number;
  model?: ModelClient;
  roster?: ModelRoster;
  reconcile?: { transport: GenerationStatsTransport; bounds?: Partial<ReconcileBounds> };
  devLogSink?: DevLogSinkOptions;
  stub?: boolean;

  deviceVerifier?: DeviceVerifier;               // default: shapeOnlyVerifier
  config?: ServerConfig;                         // default: loadServerConfig({})
  clock?: () => number;                          // default: (config).now — overrides it alone
  slots?: SlotController;                        // default: fresh, sized from config
  policy?: ContentPolicy;                        // default: cachedPolicy(new StubContentPolicy())
  reportStore?: ReportStore;                     // default: fresh InMemoryReportStore
  resolver?: { transport?: UsageAndCostTransport; tracker?: ResolveTracker; bounds?: Partial<ResolveBounds> };
  creditTransport?: CreditTransport;              // default: absent — the credit check is skipped
}
```

**`policy` MUST already be wrapped in `cachedPolicy`** — `createApp` never wraps a policy it is
given; an unwrapped policy emits no log record (`handoff/content-policy.md`).

**`creditTransport` absent ⇒ the operator-credit check is skipped entirely** (never refuses
`budget_exhausted`, no warning logged) rather than defaulting to a transport that always fails
open with a per-request warning. Production (`main.ts`, chain-10/11) supplies
`createOpenRouterCreditTransport(...)`.

**`resolver.tracker`** is the SAME `ResolveTracker` instance a later `drain` (chain-11) should call
`.drain(windowMs)` on — construct it once in composition and pass it in; omitted, `createApp`
builds one that is unreachable from outside (fine for tests, useless for drain).
**`resolver.transport`** defaults to one that never resolves a stat (`fetchStats` always `null`) —
the real OpenRouter-backed transport (parsing `total_cost`) is still unbuilt (`handoff/usage-ledger.md`).

## The in-flight tracking hook drain (chain-11) will use

No new mechanism: it is the SAME `SlotController` passed as (or defaulted into) `options.slots`.
`slots.startDraining()` makes every admission helper's `acquire()` refuse new work with
`server_busy`/`draining` from that instant; `slots.counts()` reports how many generations/unary
calls are still in flight so drain knows what it is waiting for. `/healthz/sse` also acquires a
`'unary'` slot for its lifetime, so it is drained/refused identically.

## The shared admission helper every unary route calls

`admitUnaryRequest(deps): Promise<{ ok: true; requestId; release } | { ok: false; refusal }>`,
exported from `server/src/routes/clarify.ts` (imported by `rewrite.ts` — no new file). Runs, in
order, AFTER the caller's own raw-body-cap/validation/prompt-cap: operator credit (if
`creditTransport` given) → `slots.acquire('unary', deviceId)` (drain + global-unary-cap) →
`usageStore.admit({..., kind: 'clarify'|'rewrite'})` (daily unit) → `policy.check(...)`. Every
refusal after a resource was taken releases the slot and/or settles+refunds the ledger row first.
`/v1/report` does NOT call this — no credit check and no policy check on reports (spec).

## `isProviderBudgetExhausted(err)` — 402 detection (also `clarify.ts`, imported by `rewrite.ts`)

**Deviation from the original plan, coordinated live with chain-8:** detects a mid-call provider
`402` STRUCTURALLY — `typeof err === 'object' && err !== null && 'status' in err && err.status ===
402` — NOT against `OpenRouterNetworkError`'s message text. Chain-8 is adding a proper
`OpenRouterCreditError` (`status: 402`) to `../openrouter.ts` and `isCreditExhaustedError` to
`../generation/model.ts`, but that work isn't merged into this chain's base yet. **Follow-up for
whoever merges next:** replace this chain's `isProviderBudgetExhausted` with chain-8's
`isCreditExhaustedError` once both are on the same tree (same `status === 402` structural shape,
so the swap should be a one-line import change, not a behavior change).

## Ledger outcomes this chain writes for clarify/rewrite/report

Reuses the ledger's existing unary/report vocabulary (`handoff/usage-ledger.md`): `'ok'` on
success, `'error'` on any other ending (timeout, 402, generic model failure, client abort —
distinguished by response status, not by a finer-grained outcome value), `'refused'`/`'unavailable'`
from `admitUnaryRequest`'s own policy-check branch. Every unary/report request that reaches
`usageStore.admit(...)` is settled exactly once before the route responds — no row is left
`endedAt: null`.

## Known gap — NOT implemented (class B, flagged per chains.md's own carry-forward note)

specs/content-policy "The policy check is metered and observable without content" requires the
classifier call's OWN token usage and generation id to reach the calling device's usage store and
the gated request's ledger row. `ContentPolicy.check()` (chain-4, `server/src/policy/policy.ts`,
out of this chain's file scope) has no return channel for either — chain-4's own contract note
says exactly this ("if it can't be done inside your file scope, class-B stop with options rather
than dropping it"). NOT implemented here. Options for whoever picks this up: (a) widen
`ContentPolicy.check()`'s return type to carry `{ usage?, generationId? }` alongside the verdict
(touches `policy.ts` + `cache.ts` + every existing call site); or (b) have the route call the
classifier's own `ModelClient` directly, duplicating `policy.ts`'s system-message/verdict-parsing
logic at the route level (rejected here as a real duplication, not attempted).

## Suite

`server/test/routes-unary.suite.ts` (chain-9's own): admission ordering discriminators (two rules
violated at once), no-model-call-before-admission, chunked-body 413, a stalled rewrite timing out
with its slot released, a policy-refused rewrite making only the classifier call, a mid-call 402
on both clarify and rewrite mapping to `503 budget_exhausted` with the credit cache invalidated
(proven via a lookup-counting transport, not the admission outcome), `/v1/report` acceptance/
bounds/gating/content-free logging, and `/healthz/sse` frame spacing + unary-cap gating.
`server/test/wire-v2.suite.ts` gained one addition: the substituted-verifier scenario
(generation-server spec).
