## Context

The terrain is in research.md. There is one server handler (`app.ts:281`), registered before every `/v1` middleware. There is one app URL builder (`server-probe.ts:91`), shared by the ConnectivityLoop/update gate and the Settings "own server" check. A load-test wrapper shadows `/healthz` with its own identity. Smoke, uptime check and fixtures pin the path and body. Measured on the live domain: only exactly `/healthz` is intercepted. `/health` reaches the server (its plain-text 404 today).

## Goals / Non-Goals

**Goals:** production verifies and reports `minBuild` to new builds. Self-hosted servers on older code still verify. A load-test server never reads as production. Uptime monitoring works again.

**Non-Goals:** making already-installed builds work against production. They only know `/healthz`, and no server change can reach them through Google's front end. Also out of scope: renaming `/healthz/sse`, which isn't intercepted, and any `/v1` route.

## Decisions

### D1. `/health`, same handler, `/healthz` kept
`GET /health` is registered next to `/healthz` and shares one handler, so the bodies cannot drift. `/health` is measured to pass Google's front end, it is the conventional name, and it doesn't end in `z`.
*Alternatives:* `/v1/health` was rejected because it would fall under the device gate, envelope and min-build gate, which the probe must bypass (unconsented users, old builds). `/livez` passes today, but it ends in `z`, a suffix Google documents as reserved in some cases. Dropping `/healthz` was rejected because it would break self-hosters behind ordinary proxies and the VM path for no gain.

### D2. Probe order: `/health`, then `/healthz` only on 404
`probeServerHealth` requests `/health`. A `404` answer means a server that predates the route, so the probe then requests `/healthz`, and that answer is classified with today's rules. Any other outcome on `/health` is final: 200, other statuses, a network error or timeout. That way a down server costs one request, not two. One `AbortController` deadline, default 4000 ms, covers both requests, so callers' timing is unchanged.
*Alternatives:* trying both in parallel was rejected because it doubles every probe forever to serve a shrinking set of old servers. Probing `/healthz` first was rejected because production would always pay a wasted round trip and Google's 404 page.

### D3. Load-test identity on both paths
The load-test wrapper answers `/health` exactly as it answers `/healthz` (`service: 'whim-server-loadtest'`). Otherwise `/health` would fall through to the real handler and a load-test server would verify as production.

### D4. Operator surfaces move to `/health`
Smoke checks `/health` with the same body rules. The uptime check's `CHECK_PATH` becomes `/health`. `provision.sh` already updates the path in place on a spec-hash change, and only the host is immutable (research.md). For production, the orchestrator applies the same update with `gcloud monitoring uptime update --path /health`, then re-enables the "Whim: API down" policy. `provision.sh` is VM-shaped, and running it now would fail on the deleted VM.

## Risks / Trade-offs

- [Google adds `/health` to its reserved set] → Smoke and uptime would catch it within 5 minutes, and the fallback order means only production is affected. Recorded, not mitigated further.
- [A self-hosted proxy maps unknown paths to something other than 404, e.g. a 200 SPA page] → The probe classifies that `/health` answer as `unverified` without falling back. Acceptable: such a server was never verifiable on a path it doesn't serve, and the Settings screen shows the state.
- [Installed builds stay offline] → Accepted by the owner. The next build carries the fix.

## Migration Plan

1. Merge. Deploy the server image built from the merged tip with `deploy/cloudrun/deploy.sh`. Smoke-check `/health` on the live domain.
2. `gcloud monitoring uptime update <check> --path /health`. Re-enable "Whim: API down", and confirm the uptime check passes.
3. Rollback: redeploy the previous image tag. `/healthz` still works on non-Google fronts.
