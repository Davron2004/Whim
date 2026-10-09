# composition (chain-10)

What `server/src/main.ts` builds, in order, and the generate-route seams a lifecycle/drain
(chain-11) reaches. `main.ts` is still a top-level-await entry; nothing in it is exported.

## Construction order (`main.ts`)

1. `config = loadServerConfig(process.env)` — first; a bad value throws `ServerConfigError` by name.
   `useStub = config.pipeline === 'stub'`.
2. `devLogSink = config.devLogSink ? { filePath: path.resolve(config.devLogFile) } : undefined`.
3. `dataDir = path.resolve(config.dataDir)`, `mkdirSync(recursive)` (no mode/umask yet — 12.1), then
   `usageStore = new NodeSqliteUsageStore(dataDir/usage.db)`,
   `reportStore = new NodeSqliteReportStore(dataDir/reports.db)`. No purge timers yet (12.2).
4. `modelDeps = buildModelDepsFromEnv()`; on throw: rethrow unless `useStub` (then warn, `undefined`).
5. `slots = createSlotController({ maxConcurrentGenerations, maxConcurrentUnary })` from config.
6. `resolveTracker = new ResolveTracker()` and `inFlight = new InFlightGenerations()`.
7. Pipeline + base policy, one branch:
   - `useStub || !modelDeps` → `createStubPipeline(200)`, `new StubContentPolicy()`
     (`!modelDeps` only happens under stub).
   - else → `session = await SynthRunSession.launch({ concurrency: config.synthrunConcurrency })`,
     `createGenerationPipeline({ session, modelDeps, maxRunMs: config.generationMaxMs })`,
     `new ModelContentPolicy({ modelClient: modelDeps.model, rewriteModelId: modelDeps.roster.rewrite,
     categories: loadContentPolicyDocument().categories, timeoutMs: config.policyTimeoutMs })`.
8. `createApp({ pipeline, usageStore, keepaliveMs: 15_000, model, roster, stub: useStub, devLogSink,
   config, slots, policy: cachedPolicy(basePolicy), reportStore,
   resolver: { transport: modelDeps ? openRouterUsageAndCostTransport(modelDeps.apiKey) : undefined,
   tracker: resolveTracker }, creditTransport: modelDeps ? createOpenRouterCreditTransport({ apiKey:
   modelDeps.apiKey }) : undefined, inFlight })`.
9. `serve({ fetch: app.fetch, port: config.serverPort, hostname: config.serverHost })`.
   SIGINT/SIGTERM: `server.close()`, `session?.close()`, `exit(0)` — unchanged, no drain yet.

Credit: the transport exists whenever a key exists (stub mode included); absent ⇒ the check is
skipped. Floor and TTL come from `config.minCreditUsd` / `config.creditCacheTtlMs`, read by the routes.

## Resolver transport (local to `main.ts`)

`openRouterUsageAndCostTransport(apiKey): UsageAndCostTransport` — `GET
https://openrouter.ai/api/v1/generation?id=<id>` with `Authorization: Bearer`, the resolver's
per-attempt `signal`. Non-2xx → `null`; `data` missing, non-finite tokens, or `total_cost` not a finite
number → `null`; transport failure / bad JSON → rejects (the resolver retries both the same way).
Tokens: `tokens_prompt ?? native_tokens_prompt`, `tokens_completion ?? native_tokens_completion`.
The token-only `openRouterGenerationStatsTransport` was deleted (no consumer left).

## `AppOptions` delta (`server/src/app.ts`)

```ts
// removed: reconcile?: { transport: GenerationStatsTransport; bounds?: Partial<ReconcileBounds> };
resolver?: { transport?: UsageAndCostTransport; tracker?: ResolveTracker; bounds?: Partial<ResolveBounds> };
// ↑ now also serves /v1/generate (cost for every ending + aborted-run token reconciliation)
inFlight?: InFlightGenerations; // default: a fresh registry, unreachable from outside
```

## `server/src/routes/generate.ts`

```ts
export class InFlightGenerations {
  get size(): number;                        // admitted streams whose teardown has not run
  abortAll(): void;                          // aborts each stream exactly as a client disconnect
  track(abort: () => void): () => void;      // route-internal; returns the unregister function
}
export interface GenerateRouteOptions {
  keepaliveMs?: number; config: ServerConfig; clock: () => number; slots: SlotController;
  policy: ContentPolicy; creditTransport: CreditTransport | undefined;
  resolveTracker: ResolveTracker; resolveTransport: UsageAndCostTransport;
  resolveBounds: Partial<ResolveBounds> | undefined; inFlight: InFlightGenerations;
}
export function makeGenerateRoute(pipeline: Pipeline, usageStore: UsageStore, options: GenerateRouteOptions): Hono<Env>;
```

Admission order: body cap (`maxBodyBytesGenerate`) → validation → prompt cap → `checkCredit` (if a
transport; `lookupFailed` logs `operator credit lookup failed open`) → `slots.acquire('generate')`
→ `usageStore.admit({ kind: 'generate', deviceLimit, globalLimit })` (`device` → `daily_limit`,
`global` → ceiling `server_busy`) → `policy.check(buildGeneratePolicyInput, 'generate', Request.signal)`.
A thrown/rejected check ⇒ settle `unavailable` + refund + `503`; `usage` credited on return; `{refuse}` ⇒
settle `refused` (with classifier usage), release, resolve cost for its id, `422`.

## Stream teardown invariants

- One `AbortController` per stream, fired by SSE `cancel()`, `Request.signal`, or `abortAll()`.
- Teardown runs exactly once, when the event source's iteration ends (after the pipeline stopped):
  unregister from `inFlight` → `slot.release()` → `settle(requestId, { outcome, usage })` → resolver.
- `outcome` = `RunTrace.outcome` if set; else `result` → `delivered`, `failure` → `failed`,
  aborted → `aborted`, otherwise `failed` (pipeline error or no terminal).
- Nothing is forwarded after the controller aborted; nothing after the first terminal event.
- Resolver hand-off: no classifier id ⇒ one call `(requestId, pipelineIds, creditOwned)`. With a
  classifier id ⇒ cost call `(requestId, [policyId, ...pipelineIds], true)` plus, only if
  `!creditOwned` and pipeline ids exist, a token call `('', pipelineIds, false)`. Classifier tokens are
  never reconciled twice.
- A drain that calls `inFlight.abortAll()` then waits on `slots.counts().generations === 0` sees every
  aborted stream release through this same teardown; `resolveTracker.drain(ms)` then covers costs.
