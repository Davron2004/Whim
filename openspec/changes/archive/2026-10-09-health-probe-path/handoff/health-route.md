# Contract: health-route (chain-1 → app / smoke / deploy chains)

Interface only. Written by chain-1 of `health-probe-path`.

## Paths

`GET /health` and `GET /healthz` — outside `/v1`, anonymous, no request-id header, no
envelope read (a junk `x-whim-*` header is ignored). Both are served by ONE handler
(`app.on('GET', ['/health', '/healthz'], …)` in `server/src/app.ts`), so the bodies cannot differ.

Why two: Google's front end on the Cloud Run domain answers its own 404 for exactly
`GET /healthz` (issue #140). `/health` reaches the server. Probe `/health` first; keep `/healthz`
working for builds already shipped.

`GET /healthz/sse` is a separate route and is untouched.

## Body (200, `application/json`) — identical on both paths

```ts
{ ok: true; service: 'whim-server'; commit: string; minBuild: { ios: number; android: number } }
```

- `commit`: the image's `WHIM_COMMIT`, or `'unknown'` outside a release image.
- `minBuild`: the live per-platform minimums; `{ ios: 0, android: 0 }` when unset.

## Load-test server (`server/src/loadtest/server.ts`)

The wrapper answers BOTH paths with the load-test identity, never reaching the real handler:

```ts
{ ok: true, service: 'whim-server-loadtest' }   // no commit, no minBuild
```

Exported name: `LOADTEST_HEALTHZ_SERVICE = 'whim-server-loadtest'` (unchanged; now covers both
paths). A smoke check that must refuse a load-test server should compare `service` on the path it
probes — `/health` no longer falls through to the production body.

## Logging

Each health hit emits exactly one `{ scope: 'request', method: 'GET', path: '/health' | '/healthz',
status: 200, durationMs }` record (the global request-log middleware; the load-test wrapper's
answer bypasses it).

## New exports

None. No new env var, no wire/contract type change.
