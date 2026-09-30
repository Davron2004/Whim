# DONE: no-op resolver promise contract

Finding: S78 — `typescript:S7503`, `server/src/app.ts:65` (MINOR).

Change only the no-op resolver transport's `fetchStats` implementation from an unnecessary
`async` function to a direct `Promise.resolve(null)` result. It must remain assignable to
`UsageAndCostTransport.fetchStats(generationId: string, signal: AbortSignal):
Promise<GenerationStats | null>`.

Preserve its default behavior: an unconfigured resolver has no stats, resolves `null`, makes no
provider request, and records no resolved cost. Do not change resolver retries, transport failure
handling, or any production transport. This is structural; existing resolver and application
coverage supplies the regression surface. Add no patch-shaped test.

Allowlist: `server/src/app.ts`.
