# Research digest: what does adding an unreserved health path next to GET /healthz touch?

## Relevant files
- server/src/app.ts — registers `/healthz` (l.281) and `/healthz/sse` (l.287); the logging middleware (l.230) and `/v1/*` gates (l.319-340) sit around them.
- server/src/loadtest/server.ts — load-test wrapper that shadows `/healthz` only (l.61, 104-111).
- src/host/launcher/server-probe.ts — `probeServer` / `probeServerHealth`; the only place app code builds a health URL (l.91).
- src/host/launcher/LauncherRoot.tsx:688-717 — ConnectivityLoop probe plus update gate, via `probeServerHealth`.
- src/host/launcher/SettingsScreen.tsx:29,146 — Settings "own server" check, via `probeServer` in a `DebouncedProbe`.
- src/host/launcher/server-address.ts:24-30 — comment only (leading-slash `/healthz`). `sanitizeServerUrl` strips trailing slashes.
- deploy/monitoring/uptime-healthz.env and policy-api-down.json (l.6, l.27 mention `/healthz`).
- deploy/provision.sh:284-315 — applies the uptime check.
- deploy/smoke.sh (l.168 `/healthz`, l.220 `/healthz/sse`), deploy/cloudrun/deploy.sh:129 (echo only), deploy/compose.yaml:52 (container healthcheck, localhost), deploy/loadtest/run.sh:106.
- scripts/release/upgrade-check.sh:262 — curls `$SERVER_URL/healthz` against a stub server.
- docs/deploy.md l.40, 74, 263-275, 346, 427, 460-464; docs/store/review-notes.md:145; docs/handoff-2026-10-07.md:40-52.

## Current behavior
**Server**
- `/healthz` is `app.get('/healthz', (c) => c.json({ ok: true, service: 'whim-server', commit: config.commit, minBuild }, 200))`.
- `minBuild` is a frozen `{ios, android}` object from config. `commit` is the 40-character SHA, or `'unknown'` outside the release image.
- Status is always 200. The only header set is Hono's default JSON content-type. There is no CORS or cache header.
- The handler is registered before every `/v1/*` middleware, so none of them touch it. Those are `assignRequestId`, the device verifier, `readEnvelope`, `readProtocolLevel` and `minimumBuildGate`.
- Request-id header: `/healthz` carries none (request-edge.suite.ts:209 asserts `null`). A junk `x-whim-build` header is ignored (request-edge.suite.ts:601).
- Logging: the global `app.use('*')` middleware logs one `{scope:'request', method, path, status, durationMs}` record per non-SSE request. A health hit is logged at info level (server-core.suite.ts:419-426 asserts exactly one record with `path:'/healthz'`). `c.req.path` is logged as-is.
- Drain: I found no `/healthz`-specific drain branch. `main.ts:26-37` drains via `handle.drain()`, which closes the listener. `slots.acquire` refuses probes while draining, and that applies only to `/healthz/sse`. I did not read `ServerHandle.drain` itself.
- `/healthz/sse`: three frames `: whim-healthz-probe\n\n` spaced 1 s apart, then close. It takes a slot from its own "probe" pool (`maxConcurrentProbes`) and gets a slot-refusal body when full or draining. Headers: `content-type: text/event-stream`, `cache-control: no-cache`, `connection: keep-alive`.
- Load-test variant: `wrapWithLoadtestHealthz` makes an outer Hono app. Its `GET /healthz` returns `{ok:true, service:'whim-server-loadtest'}` (no commit, no minBuild), and `outer.all('*')` forwards everything else to the real app. A new path would fall through to the real handler and answer `whim-server`, unless the wrapper is also changed.
- 404s: there is no `notFound` handler anywhere in server/src. An unknown path gets Hono's default plain-text `404 Not Found`. It is not an ApiError JSON body, and the `onError` handler does not apply to it.

**App**
- `probeServerHealth(baseUrl, {timeoutMs=4000, fetchImpl})` does `fetch(`${baseUrl}/healthz`, GET, AbortController)`.
- Thrown error or timeout gives `unreachable` (logged at debug). Status other than 200 gives `unreachable`. A 200 whose JSON fails to parse or lacks `service === 'whim-server'` gives `unverified`.
- A verified body also yields `minBuild` only if both `ios` and `android` are non-negative safe integers; otherwise `minBuild` is omitted.
- `probeServer` = `probeServerHealth().result`. It sends no headers, so the envelope is not sent.
- The load-test identity `whim-server-loadtest` classifies as `unverified` and its minBuild is ignored.
- Callers: (1) LauncherRoot's `ConnectivityLoop` probe calls `probeServerHealth(decision.baseUrl)` and, if `belowMinimumBuild(appInfo, health.minBuild)`, opens the update screen. This is gated by `probeGateFor(clientOptions)`, i.e. consent plus address. (2) SettingsScreen's `DebouncedProbe` calls `probeServer(url)`.
- No other app code builds a health URL. The log-egress check suite (checks/test/repo/log-egress.suite.ts:83) uses `/healthz` only as a fixture string.

**Deploy**
- Uptime check env: `CHECK_PATH=/healthz`, `PERIOD_MINUTES=5`, `TIMEOUT_SECONDS=10`, `REGIONS=usa-virginia,usa-oregon,europe`, `MATCHER_CONTENT="ok":true` (contains-string).
- provision.sh reads those keys via `whim_read_env_lines`. It finds the existing check by display name. If the host differs it fails with the "host can't be updated in place" message (l.303-305).
- If the content hash (`git hash-object` of the env file, stored as the `whim_spec` user label) differs, it runs `monitoring uptime update ... --path "$uptime_CHECK_PATH" ...`, with a matcher and timeout. **The path IS passed on update (l.293, 308), so a path change is applied in place and only the host is immovable.** I did not run gcloud to confirm that update accepts `--path`.
- smoke.sh `/healthz` check (l.168): 200 + JSON structure judged by a Node snippet. It requires `ok`, `service`, a 40-character `commit`, and the configured minBuild. `--commit` pins the SHA. A missing commit field fails with "predates the commit report". Rollback below the min-build gate is handled.
- smoke.sh `/healthz/sse` (l.220): checks frame spacing.
- docs/deploy.md:74 says "Paths ending in `z` (`/healthz`) are reserved on the `*.run.app` URLs, so check the server through the mapped hostname." The Cloud Run behaviour on the mapped domain is now measured to be the same for exactly `/healthz` (issue #140, handoff-2026-10-07.md:40).

## Constraints and invariants
- generation-server requirement "Device-identity middleware": all `/v1/*` routes are gated by path prefix, and "`GET /healthz` SHALL be exempt." Scenario "Health check is anonymous": no headers gives 200. Scenario "LAN-reachable dev server": plain-HTTP `GET /healthz` gives 200. The suite asserts the gate over the whole `/v1` route table, so a new `/v1/...` path would be device-gated and min-build-gated. That is incompatible with the health use, which must work for old builds and unconsented users.
- app-update-gate (spec l.11): "`GET /healthz` SHALL report" the minimums. L.28: the launcher update screen opens "when the launch-time check finds the installed build below its platform's minimum on `/healthz`." L.24 and L.54-59 (runbook, confirm on `/healthz`) also name the path. The new path would have to carry `minBuild` or this spec must change.
- request-envelope D4/D5: the probe carries no envelope headers, and `/healthz` is outside `/v1`. Tested in server-probe.suite.ts:110 and request-envelope-ui.suite.tsx:130.
- Service identity: `whim-server` is the verified marker. `whim-server-loadtest` must never read as production. See `LOADTEST_HEALTHZ_SERVICE` and the checks in deploy/loadtest/run.sh and e2e.ts:662.
- `/healthz` is a no-op for the min-build gate by being outside `/v1`.
- server-deployment (still in-flight under public-generation-server; I found no live copy): "An anonymous stream probe verifies proxy flushing" requires `GET /healthz/sse`, outside `/v1` and without a device header, three comment frames 1 s apart. The load-test requirement says "Its `/healthz` SHALL answer with the service identity `whim-server-loadtest`."
- The smoke fixtures must equal the real server's body. Deploy-config.suite.ts:1353-1389 and 1564 derive it from the producer, and l.1564 asserts `DEFAULT_HEALTH` equals the real default body.
- Zod/contract: I did not check whether the contract package types the health body. The grep shows no contract mention.
- Self-hosting (#70, beta-1 D20) lets any address be saved. Settings verification therefore classifies unverified vs unreachable against the exact `/healthz` body.
- `invariants/` has no `/healthz` mention (grep of the repo excluding node_modules/archive).

## Integration points
- Server: a sibling `app.get(...)` next to l.281, outside `/v1/*` and before the middleware at l.319. The logging middleware logs it automatically. The load-test wrapper in server/src/loadtest/server.ts:104-111 is the other place an identity override would be needed.
- App: server-probe.ts:91 is the single URL builder. Both ConnectivityLoop and Settings go through it. The classification rules (200 only, `service` match, `minBuild` parse) live in the same function.
- Deploy: `CHECK_PATH` in uptime-healthz.env (applied in place by provision.sh:308 on a spec-hash change). smoke.sh l.168 builds the URL (`url="https://$WHIM_API_HOST/healthz"`). cloudrun/deploy.sh:129 echo. policy-api-down.json displayName and content strings. docs/deploy.md l.40, 263-275, 346, 427, 460-464.
- Tests that pin the path or body (each would need a counterpart or edit):
  - Server: server-core.suite.ts:72-79,419-426; request-edge.suite.ts:209,557-611; loadtest.suite.ts:144; e2e.ts:662; prod-build.suite.ts:323; routes-unary.suite.ts:1394-1441 (`/healthz/sse`).
  - Deploy: deploy-config.suite.ts:1093-1103,1353-1389,1559-1637, and 2084 (`UPTIME_NAME ...whim-api-healthz-x1`) and 2546 (asserts `--path /healthz`).
  - App fixtures that answer by `endsWith('/healthz')`: consent-gate-ui.suite.tsx:165; app-link-ui.suite.tsx:107; launcher-interactions.suite.tsx:37,100,139-154; rendered-launcher.tsx:144 (`path === '/healthz'`, shared harness).
  - App assertions on the URL: server-probe.suite.ts:59,110; connectivity-ux.suite.tsx:104; settings-screen.suite.tsx:59,193; diagnostics-ui.suite.tsx:138; request-envelope-ui.suite.tsx (healthz option and `probes`).
- Specs: generation-server (exemption), app-update-gate, plus the in-flight server-deployment delta (`/healthz/sse`, load-test identity). In-flight changes naming `/healthz`: store-launch-compliance/specs/server-connectivity (l.17), server-connectivity/specs/{server-connectivity,generation-server}, public-generation-server/specs/*, developer-observability/specs/server-observability. Report only.
- Self-hosting: an older self-hosted server has no route for a new path. Hono returns plain-text `404 Not Found` (non-200, non-JSON). The current app maps any non-200 to `unreachable`, so a probe of only the new path would show an older server as offline. `/healthz` still answers on it with the full body. Self-hosted servers behind a plain proxy are unaffected by the Google-front-end reservation.

## Risks and unknowns
- I did not verify which exact path set Google reserves besides the reported "exactly `/healthz`". Whether the new path could be reserved by a pattern (e.g. a `z` suffix per docs/deploy.md:74) is not checked.
- I did not verify that `gcloud monitoring uptime update --path` actually succeeds on an existing check. Only the script calls it.
- The `whim_spec` label is a hash of the env file, so any edit to the env file triggers the update. The deploy-config test stubs gcloud; the sandbox does not run real gcloud.
- I did not read `ServerHandle.drain` (the server start module) to confirm health routes still answer during drain.
- Where the contract package or docs/decisions.md describes the health body: no match found, not confirmed absent.
- Installed builds already shipped probe only `/healthz`, so they stay offline on the custom domain regardless of what is added. `/healthz` stays exposed on `*.run.app` as well.
- The real `/healthz` is public-facing in store review notes (docs/store/review-notes.md:145) and upgrade-check.sh. Both still say `/healthz`.

## Open questions for the planner
1. Should the new path return the same body, including `service`, `commit` and `minBuild`? The app, smoke, uptime matcher and update gate all depend on those fields.
2. Should the load-test wrapper answer the new path with the load-test identity too, or fall through to the real handler?
3. Should an older self-hosted server's plain-text 404 on the new path be classified as "try the old path", or as `unreachable`?
4. Is `/healthz` kept as an alias for old builds and self-hosters, or do the uptime check and smoke move entirely to the new path?
5. Does the in-flight server-deployment delta (still under public-generation-server) need a new live-spec delta, given there is no live server-deployment mention of health?
