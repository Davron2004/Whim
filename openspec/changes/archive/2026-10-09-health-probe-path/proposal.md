## Why

Production now runs on Cloud Run behind a custom-domain mapping (decisions #71, #72). Google's front end answers its own HTML 404 for exactly `GET /healthz` on that domain (issue #140, measured 2026-10-07): `/health`, `/healthz/`, `/healthz/sse`, `/livez` and every `/v1` route reach the server. The app's launch probe calls only `/healthz` and treats any non-200 as unreachable, so every build shows "offline" against production and never reads the minimum-build values. The uptime check fails for the same reason; its alert is disabled until this lands.

## What Changes

- The server answers `GET /health` with exactly the `/healthz` body (`ok`, `service`, `commit`, `minBuild`), outside `/v1`, anonymous. `/healthz` stays for the VM path, self-hosters and already-installed builds that reach a server not behind Google's front end.
- The load-test wrapper answers `/health` with its own `whim-server-loadtest` identity, as it does `/healthz`, so a load-test server never reads as production on either path.
- The app's probe asks `/health` first. Only when that answer is a `404` does it ask `/healthz`, within the same timeout budget. A self-hosted server running older code still verifies, and production verifies through `/health`. Classification (`verified` / `unverified` / `unreachable`, `minBuild` parsing) is unchanged.
- `deploy/smoke.sh`, the uptime check (`deploy/monitoring/`) and the runbook move to `/health`. After deploy, the uptime check is updated in place and the "Whim: API down" alert is re-enabled.

## Capabilities

### New Capabilities

### Modified Capabilities
- `generation-server`: the device-identity exemption covers `GET /health` as well as `GET /healthz`.
- `app-update-gate`: the server reports the minimums on `/health` and `/healthz`. The launch-time check reads them through the probe's `/health`-then-`/healthz` order. The runbook confirms on `/health`.

## Impact

- Server: `server/src/app.ts` (one route) and `server/src/loadtest/server.ts`, plus server suites that pin health behaviour.
- App: `src/host/launcher/server-probe.ts` (single URL builder), plus the launcher test fixtures that answer by path (shared `rendered-launcher.tsx` harness and the suites listed in research.md).
- Deploy: `deploy/smoke.sh`, `deploy/monitoring/uptime-healthz.env` and `policy-api-down.json`, `deploy/cloudrun/deploy.sh` (echo), `deploy-config.suite.ts`, and docs (`docs/deploy.md`, `docs/store/review-notes.md`).
- Users: the fix reaches phones only with the next app build. Until then installed builds stay offline against production. Pre-release, accepted by the owner.
