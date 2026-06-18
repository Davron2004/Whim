# Handoff: server-core.md (chain-C → D)

The injection seams chain-C exposes for chain-D's metering + usage routes. D consumes these; it
does not modify the app factory or SSE helper.

## Pipeline (server/src/pipeline.ts)
```typescript
interface Pipeline {
  run(request: GenerateRequest): AsyncIterable<GenerationEvent>;
}
// stubPipeline: Pipeline — canned stage→token→usage→result sequence;
// prompt containing the magic token `[[fail]]` yields the `failure` terminal instead.
// createStubPipeline(delayMs?: number): Pipeline — injectable delay (0 in tests, 200 in dev).
```
The `/v1/generate` route is constructed with an injected `Pipeline` (stub in tests/dev) and an
injected `UsageStore` (below). It credits usage BEFORE emitting the terminal event.

## UsageStore (server/src/usage-store.ts)
Chain-C defines the interface and ships `InMemoryUsageStore` for tests/dev:
```typescript
interface UsageStore {
  credit(deviceId: string, usage: Usage): Promise<void>;
  read(deviceId: string): Promise<Usage>;   // zeros for unknown IDs (not an error)
}
class InMemoryUsageStore implements UsageStore { /* in-memory, non-durable */ }
```
Chain-D adds: `NodeSqliteUsageStore` (writing under `WHIM_DATA_DIR`) and mounts `/v1/usage`.

## App factory (server/src/app.ts)
```typescript
function createApp(options: { pipeline, usageStore, keepaliveMs? }): Hono
```
Routes: `GET /healthz` (exempt from middleware), `POST /v1/generate`, `POST /v1/rewrite`.

## Device-identity middleware
- Header `x-whim-device` (UUID) is required on all `/v1/*`; `/healthz` is exempt.
- Missing/malformed → HTTP `400` with this structured JSON body (D's `/v1/usage` must match it):
```
{ "error": "missing_device_id" | "invalid_device_id", "hint": "<non-empty fix hint>" }
```
- UUID pattern: `/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i`
- The validated device id is available to handlers via `c.get('deviceId')`.

## Invariants for D
- D adds routes (`/v1/usage`) and the metering credit; it must NOT change the SSE framing, the
  one-terminal-event rule, or the middleware error shape.
- `/v1/usage` is scoped to the calling `x-whim-device`; unknown id → zeroed `Usage`, HTTP 200.
- Chain-D mounts `/v1/usage` by calling `app.route('/v1/usage', makeUsageRoute(usageStore))`.
