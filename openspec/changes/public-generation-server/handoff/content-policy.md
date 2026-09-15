# content-policy (chain-4)

`server/src/policy/` (barrel `server/src/policy/index.ts`). Nothing here is a diary — read the
modules for rationale/comments.

## `policy.ts`

```ts
export type PolicyRoute = 'clarify' | 'rewrite' | 'generate';
export type PolicyVerdict = 'allow' | { refuse: string };

export class PolicyUnavailableError extends Error {} // .name === 'PolicyUnavailableError'

export interface ContentPolicy {
  // Resolves to a verdict, or THROWS PolicyUnavailableError — never resolves 'allow' on failure.
  // `route` is carried through only for the log record (cache.ts); never sent to the classifier,
  // never part of the cache key. `signal` aborts the call (e.g. client disconnect);
  // ModelContentPolicy also enforces its own `timeoutMs` independent of `signal`.
  check(input: string, route: PolicyRoute, signal?: AbortSignal): Promise<PolicyVerdict>;
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
// Never caches a thrown error (PolicyUnavailableError or otherwise) — every miss re-checks.
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
thread it anywhere); `buildRewriteMessages` and `buildGenerateMessages`'s system messages already
carry it verbatim. `buildRepairMessages`'s system message does NOT carry it (scope matches the
"both-prompts-carry-it" tripwire: rewrite + generate only).

## Wiring notes for chain-9/10

- Construct once per process: `const policy = cachedPolicy(config.pipeline === 'stub' ? new StubContentPolicy() : new ModelContentPolicy({ modelClient, rewriteModelId: roster.rewrite, categories: loadContentPolicyDocument().categories, timeoutMs: config.policyTimeoutMs }));`
- Per request: build input with the route's `buildXPolicyInput`, then `await policy.check(input, route, signal)`.
- Catch `PolicyUnavailableError` → `503 policy_unavailable`, refund the daily unit. A `{ refuse }`
  result → `422 content_policy` (never reveal `refuse.category` to the client). No route work
  follows either outcome.
- Token usage/generation-id crediting for the classifier call is NOT exposed by `ContentPolicy.check`
  (design D9's literal signature has no return channel for it) — this interface does not solve that
  half of "The policy check is metered and observable"; the ledger-row scenario is a route-level
  concern chain-9/10 own directly against the classifier `ModelClient` if/when needed.
