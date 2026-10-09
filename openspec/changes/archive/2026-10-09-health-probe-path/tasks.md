## 1. Server: `/health`

- [x] 1.1 Register `GET /health` in `server/src/app.ts` on the same handler as `/healthz` (one function, two routes), outside `/v1` and before the `/v1` middleware.
- [x] 1.2 Make the load-test wrapper (`server/src/loadtest/server.ts`) answer `/health` with the same `whim-server-loadtest` body it gives `/healthz`.
- [x] 1.3 Server tests:
  - `/health` and `/healthz` return identical bodies anonymously with no request-id header.
  - A junk envelope is ignored on both.
  - Each health hit logs exactly one request record with its own path.
  - The load-test server answers both paths with the load-test identity.
  - `/health` is not under the `/v1` device gate.

  Red-check each new assertion against the route removed.

## 2. App: probe `/health`, fall back on 404

- [x] 2.1 In `src/host/launcher/server-probe.ts`, request `${baseUrl}/health` first. Only a `404` answer triggers one `${baseUrl}/healthz` request. One `AbortController` deadline (default 4000 ms) covers both. Classification and `minBuild` parsing are unchanged, applied to whichever answer is final.
- [x] 2.2 Update the shared launcher test harness (`rendered-launcher.tsx`) and the fixtures that answer by path so a "current server" answers `/health`. Keep at least one fixture of an "older server" that 404s `/health` and answers `/healthz`.
- [x] 2.3 Probe tests:
  - `/health` 200 is verified and makes no `/healthz` request.
  - `/health` 404 with `/healthz` 200 is verified with minimums read from `/healthz`.
  - A `/health` network error or timeout is unreachable with exactly one request.
  - `/health` 500 is unreachable with no fallback.
  - `/health` 200 with a non-Whim body is unverified with no fallback.
  - The shared deadline aborts a slow fallback.
  - The probe still sends no envelope headers.

## 3. Deploy and docs: operator surfaces on `/health`

- [x] 3.1 `deploy/smoke.sh`: the health check requests `/health` with the same body rules (`ok`, `service`, 40-character `commit`, `minBuild`, `--commit` pin). Update `deploy-config.suite.ts` expectations that pin `/healthz`, including the stubbed `--path` assertion.
- [x] 3.2 `deploy/monitoring/uptime-healthz.env` `CHECK_PATH=/health`, plus `policy-api-down.json` strings and the `deploy/cloudrun/deploy.sh` closing echo.
- [x] 3.3 Docs: `docs/deploy.md`.
  - Change the health-check mentions to `/health`, including the minimum-build runbook and Cloud Run section.
  - Explain that `/healthz` is kept and is blocked by Google's front end on Cloud Run custom domains.
  - Update `docs/store/review-notes.md` to match.

## 4. Rollout (orchestrator, attended, after merge)

- [x] 4.1 Deploy the merged tip with `deploy/cloudrun/deploy.sh`. Confirm `https://<api host>/health` returns the new commit and both minimums.
- [x] 4.2 `gcloud monitoring uptime update` the "Whim API healthz" check to `--path /health`, re-enable the "Whim: API down" policy, and confirm the uptime check reports passing.
