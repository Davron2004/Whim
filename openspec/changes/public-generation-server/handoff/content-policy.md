# content-policy (chain-4)

`server/src/policy/` (barrel `server/src/policy/index.ts`). Nothing here is a diary — read the
modules for rationale/comments.

## `policy.ts`

```ts
export type PolicyRoute = 'clarify' | 'rewrite' | 'generate';
export type PolicyVerdict = 'allow' | { refuse: string };

export class PolicyUnavailableError extends Error {} // .name === 'PolicyUnavailableError'

// `check`'s result (chain-9b, spec "The policy check is metered and observable without content"):
// `usage`/`generationId` are present ONLY when this call actually invoked the classifier model —
// absent for a cache hit (cache.ts never carries usage forward) and for StubContentPolicy (no
// model call either way). A caller credits `usage` to the device and folds `generationId` into
// whatever generation-id list it resolves cost against, exactly like any other model call.
export interface PolicyCheckResult {
  verdict: PolicyVerdict;
  usage?: Usage;          // @whim/contract's Usage — same shape credit()/resolveRequestUsage use
  generationId?: string;
}

export interface ContentPolicy {
  // Resolves to a result, or THROWS PolicyUnavailableError — never resolves an 'allow' verdict on
  // failure. `route` is carried through only for the log record (cache.ts); never sent to the
  // classifier, never part of the cache key. `signal` aborts the call (e.g. client disconnect);
  // ModelContentPolicy also enforces its own `timeoutMs` independent of `signal`.
  check(input: string, route: PolicyRoute, signal?: AbortSignal): Promise<PolicyCheckResult>;
}

export interface ModelContentPolicyOptions {
  modelClient: ModelClient;      // ../generation/model
  rewriteModelId: string;        // roster.rewrite — resolve from ModelRoster, never a literal
  categories: string;            // loadContentPolicyDocument(cwd).categories — read ONCE by the caller
  timeoutMs: number;             // config.policyTimeoutMs (WHIM_POLICY_TIMEOUT_MS)
}
export class ModelContentPolicy implements ContentPolicy {
  constructor(opts: ModelContentPolicyOptions);
}

// WHIM_PIPELINE=stub only. loadServerConfig already refuses that flag under NODE_ENV=production,
// so this can never reach production silently — no further gating needed at the call site.
export class StubContentPolicy implements ContentPolicy {
  // refuses input containing "[[refuse]]"; throws PolicyUnavailableError for "[[policy-down]]";
  // allows everything else. No model call.
}
```

## `cache.ts`

```ts
export interface CachedPolicyOptions {
  maxEntries?: number; // default 1000
  ttlMs?: number;      // default 900000 (15 min)
  now?: () => number;  // default Date.now
}

// Wraps `inner`. Keyed by SHA-256 of `input` ALONE (route is not part of the key — two routes
// checking the identical canonical input within the TTL share one entry and one classifier call).
// Never caches a thrown error (PolicyUnavailableError or otherwise) — every miss re-checks. Only
// `verdict` is cached; a cache hit's `PolicyCheckResult` always carries `usage`/`generationId`
// as `undefined` (no classifier call happened).
//
// THE ONE PLACE THAT LOGS: every call to the returned ContentPolicy's `check` emits exactly one
// `log.info({...}, 'content policy check')` record (server/src/logger.ts's singleton `log`).
// Composition MUST always wrap the base policy in this — ModelContentPolicy/StubContentPolicy used
// unwrapped emit no log record.
export function cachedPolicy(inner: ContentPolicy, opts?: CachedPolicyOptions): ContentPolicy;
```

**Log record fields** (`msg: 'content policy check'`): `route` (`PolicyRoute`), `verdict`
(`'allow' | 'refuse' | 'unavailable' | 'cached-allow' | 'cached-refuse'`), `category?` (string,
present only when the verdict names a refusal), `durationMs` (number). Never the checked text, never
the cache digest — those two are the ONLY things the cache holds, and neither is ever logged
together or apart.

## `input.ts` — canonical per-route input (also the cache-key material and what the classifier judges)

```ts
export function buildClarifyPolicyInput(request: ClarifyRequest): string;   // prompt only
export function buildRewritePolicyInput(request: RewriteRequest): string;   // prompt + clarifications Q&A + app.name + collection/field names
export function buildGeneratePolicyInput(request: GenerateRequest): string; // prompt + clarifications Q&A (GenerateRequest.app has no display names)
```

Never includes `source`, `manifest`, `schema`, or `appliedSchema`. Each returns a deterministic JSON
string (fixed key order) — hash it whole for the cache key; do not re-derive a digest from parts.

## The document is the one source (`../generation/prompts/inputs.ts`, not this module)

```ts
export interface ContentPolicyDocument { ratingRule: string; categories: string; }
export function loadContentPolicyDocument(cwd?: string): ContentPolicyDocument;
```

Reads `docs/content-policy.md`'s `## Rating rule` and `## Categories` sections, memoized per
resolved path. Throws `PromptInputError` naming the missing section. The composition root calls
this once and passes `.categories` into `ModelContentPolicyOptions.categories`. `.ratingRule` is
consumed internally by `../generation/prompts/index.ts` (already wired — chain-9/10 do not need to
thread it anywhere); `buildRewriteMessages`, `buildGenerateMessages` and `buildRepairMessages`'s
system messages all carry it verbatim. `buildPlanMessages`'s does NOT.

## Wiring notes (chain-9/10, updated by chain-9b)

- Construct once per process: `const policy = cachedPolicy(config.pipeline === 'stub' ? new StubContentPolicy() : new ModelContentPolicy({ modelClient, rewriteModelId: roster.rewrite, categories: loadContentPolicyDocument().categories, timeoutMs: config.policyTimeoutMs }));`
- Per request: build input with the route's `buildXPolicyInput`, then `const result = await policy.check(input, route, signal)`.
- If `result.usage` is set, credit it to the calling device immediately (`usageStore.credit(deviceId, result.usage)`) — allowed or refused, since the classifier call happened either way.
- Catch `PolicyUnavailableError` → `503 policy_unavailable`, refund the daily unit. `result.verdict`
  being a `{ refuse }` → `422 content_policy` (never reveal `refuse.category` to the client), after
  settling the ledger row with `usage: result.usage` and resolving cost for `result.generationId`
  (when present) exactly as a route resolves its own model calls. No route work follows either
  outcome. On `allow`, fold `result.generationId` (when present) into the request's own generation-id
  list before resolving cost, so the classifier's cost lands on the same ledger row.
  `server/src/routes/clarify.ts`'s `admitUnaryRequest` does all of this already — both `/v1/clarify`
  and `/v1/rewrite` get it for free.
