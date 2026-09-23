# Research digest: making crashes, failed generations and user reports visible to the developer off-device

## Relevant files
- /Users/davrondjabborov/Work/other/Whim/docs/backlog.md:17-28: the 2026-09-23 audit that this change comes from. It lists the gaps and says that `openspec/specs/{content-reports,server-deployment,server-admission-control,content-policy}` do not exist. I confirmed that: those specs live only as deltas in the unarchived `openspec/changes/public-generation-server/specs/`.
- src/host/logging/{index,channels,redact,ring-buffer,sink}.ts: the device's single logging seam.
- src/host/launcher/ScreenBoundary.tsx, webview-error.ts, transport-shared.ts (`logMappedError`), useMiniAppHost.ts, LauncherRoot.tsx (`errorFields`, `logGenError`, `logGenFailureShown`, `SEND_DEV_LOGS`): where device errors are produced.
- src/runtime/web/loader.js and build/assemble.mjs (outer page): how sandbox error frames are produced and relayed to RN.
- server/src/logger.ts, app.ts (request middleware, `onError`, `/healthz`, `/healthz/sse`), generation/machine.ts:641, routes/{generate,clarify,rewrite,report}.ts, usage-store.ts, admission/credit.ts.
- deploy/compose.yaml, deploy/provision.sh, deploy/vm/{bootstrap.sh,whim-egress.sh}, docs/deploy.md §Operating.
- Privacy surfaces: deploy/site/privacy.html, release/store/play/data-safety.json, ios/Whim/PrivacyInfo.xcprivacy, release/store/answers.md:80, docs/store/review-notes.md:109, src/host/launcher/copy.ts:260-265 (consent strings).
- Specs: openspec/specs/host-observability/spec.md, openspec/specs/generation-server/spec.md, and the deltas in public-generation-server, store-launch-compliance/specs/ai-data-consent, and platform-release-readiness/specs/store-listing.

## Current behavior
**Device seam.** `log.{debug,info,warn,error}(channel, constantMessage, fields)`, built on react-native-logs 5.6.0.
- Channels are a closed set in `channels.ts`: `whim:gen`, `whim`, `whim:page`, `whim:screen`, `whim:sink`.
- Record shape is `DevLogRecord {at, level, channel, message, fields}`. It is a type-only import from `@whim/contract`.
- `redactFields` runs before any transport sees a record. It matches field names case-insensitively against a closed list and recurses to depth 4. The families are prompt, source (including `code`), report note, device id, and credentials. The value is replaced with `[redacted]`.
- Three transports: a ring buffer of 500 records (in memory only), a console mirror (`console.log`/`console.warn`, never `console.error`), and `DevLogSink`.
- `DevLogSink` POSTs batches (50 records / 5 s, capped at 200 pending) to `<serverUrl>/dev/logs`. It is best-effort, never retries, and reports its own failures on `whim:sink`.
- The sink is off unless `SEND_DEV_LOGS` (LauncherRoot.tsx:189, `false`) is set. `LauncherRoot.tsx:596` calls `log.sink.configure({enabled: SEND_DEV_LOGS, baseUrl: serverUrl})`.
- The server refuses `WHIM_DEV_LOG_SINK` when `NODE_ENV=production` (config.ts:176).

**Device error sources and the fields they carry:**
- ScreenBoundary: `log.error(screen, 'screen render failed', {screen, errorClass, detail, stack})`. It is emitted in the fallback render and deduplicated per `screen|class|message`.
- WebView `onError`: `logWebViewError` emits `{appId|surface, errorCode, detail, domain, url}`. The name `errorCode` is deliberate because `code` is redacted.
- Transport errors: `logMappedError` emits `log.error(gen, 'transport failed', {path, host, kind, status, readyState, detail})`.
- LauncherRoot:
  - 'generation step failed' and 'failure screen shown' carry `{stage, reason, observedRepairAttempts, ctor, kind, status, hint, message, stack}`.
  - The open/fork/delete paths log 'installed-app action failed'.
- There is no `ErrorUtils.setGlobalHandler` and no unhandled-rejection hook anywhere (grep found none). `index.js` only installs polyfills and then registers App.

**Mini-app throw path (traced):**
1. loader.js `post('error', {where, name?, message})` sends `{__whimHarness, nonce, kind:'error', payload}` to the outer page. It fires only for:
   - `where:'bundle'`: no AppSpec export.
   - `'mount'`: a synchronous throw from `root.render`.
   - `'deliver'`: the inline-script append threw.
   - `'probes'`: post-paint.
2. The outer page (assemble.mjs:146-150) drops frames that fail the nonce check as `rejected-forgery`. For authentic frames it calls `toRN({kind:'error', trusted:true, payload})` and also `rnLog('ERROR '+JSON)`. The `rnLog` line arrives as `__whimHostLog` and becomes `log.debug(page, 'relayed page log', {line})`.
3. In useMiniAppHost `handleErrorFrame`, non-fatal `where` values get `log.debug(page, 'non-fatal error frame from the realm', {where, detail})`. **Fatal ones (bundle, mount, deliver) only set `state.lastError` (a string). No `log.error` record is emitted**; the only trace is the debug-level relayed line.
4. Paint-watchdog timeouts and launch/deliver failures also write only `lastError`.

**Iframe blind spot.** Nothing in the iframe listens for `error`/`unhandledrejection`, and SDK/loader have no React error boundary (grep found none). So throws in post-mount event handlers, async effects, and React 19 concurrent render errors never reach the host. I did not verify how `createRoot().render` surfaces a render throw in React 19 (a sync throw versus `reportError`).

**Server.**
- There is one pino logger whose `redact` paths cover prompt/source/code/deviceId/x-whim-device/apiKey/authorization/secret. Each name is expanded into case variants and applied at the top level and three wildcard levels deep. Output is JSON in production.
- Per-request middleware logs `{method, path, status, durationMs}` and skips SSE responses. `onError` logs `{method, path, errorClass, detail}`. Child loggers are scoped (`request`, `run`, `report`, `boot`, `drain`, `openrouter`, `cost-sweep`).
- Compose uses the `json-file` driver (10m × 5) for both containers, and docs/deploy.md tells operators to read logs with `docker compose logs`.
- Nothing ships logs off the VM: no Ops Agent and no gcplogs.

**Request id.** `usageStore.admit` mints `randomUUID()` as the ledger `requests.id`.
- The `requests` table has no reason or error column. `outcome` is one of `delivered|failed|aborted|expired|refused|unavailable|ok|error`.
- The requestId appears in logs only on settlement failures (generate.ts:356, report.ts:129, clarify.ts).
- `pipeline.run(request, signal, trace)` does not receive it. machine.ts:641 logs `runLog.info({reason}, 'terminal failure')` with no requestId and no device id.
- No id reaches the client. `GenerationEvent` has no id field, no custom response header is set anywhere in server/src, and `ApiError` is `{error, hint}`. The one exception: `/v1/report` returns `{reportId}` with a 202.

**Uptime and budget.**
- `/healthz` returns `{ok, service}` with no auth. `/healthz/sse` is an anonymous probe with its own 2-slot pool. Compose's healthcheck polls `/healthz` locally.
- `credit.ts` fails open. It reads OpenRouter `GET /api/v1/key` `limit_remaining` through an in-memory cache, and a 402 invalidates the cache.
- The repo has no GCP budget config, alert policy, or uptime check. provision.sh enables `logging.googleapis.com` and `monitoring.googleapis.com` and grants the VM SA `roles/logging.logWriter` and `roles/monitoring.metricWriter` with scope `cloud-platform`.

**Reports.** After `reportStore.insert` (reports.db) and `settle(ok)`, the route logs `{reportId, reason, promptBytes, sourceBytes}` and returns 202. There is no notification path, and there is no SMTP, webhook, or push code anywhere. `WHIM_SUPPORT_EMAIL` is used only to render the site pages.

## Constraints and invariants
- **The published policy forbids crash SDKs today.** privacy.html:49 says "Whim has no accounts, no ads, and no analytics, crash-reporting or advertising SDKs." Line 50 says "Server logs hold no request content…" The public-generation-server server-deployment delta requires that the policy "state that Whim has no … analytics, crash-reporting or advertising SDKs". answers.md:80 and review-notes.md:109 ("no crash reporter … no background telemetry") say the same. A parity tripwire fails the gate if any `consent*` copy key is not quoted verbatim in the policy, or if a stated retention period drifts.
- **Store declarations are pinned.**
  - data-safety.json, app-privacy.json and PrivacyInfo.xcprivacy declare exactly two types: user content and device ID.
  - The Play purposes for device ID are app_functionality and fraud_prevention.
  - The store-listing delta says "The release checks SHALL fail on any disagreement".
  - A native crash SDK adds a collected type ("Crash logs"/"Diagnostics") and probably its own required-reason API usage. privacy-audit.ts scans the archived `.app` for required-reason symbols.
- **Consent gate.** The ai-data-consent delta says "The launcher SHALL NOT send any request to the server … unless a current AI-data consent grant exists." The one exception is a hand-sent report. The consent copy describes the device ID as "used for daily limits".
- **host-observability.**
  - Ring buffer "SHALL NOT be persisted to disk".
  - Sink "off unless explicitly enabled", with its destination "the server address the device already persists … no second address".
  - Redaction must happen before buffering, "so redaction cannot be lost by a sink".
  - The overlay stays out of shipping builds.
  - Every host diagnostic goes through the seam, and no `console.*` outside it (lint-scanned).
- **Model 1 (#33).** The server persists about a KB per user. Reports are the one deliberate exception (#68). "The ledger holds no content" is a file-level property asserted by tests. #34 places telemetry on the server as a principle. The obs-v1 proposal excluded off-device crash reporting as out of scope ("No Sentry, no Crashlytics, no analytics"). No decision records a privacy rationale beyond these.
- **Content-reports delta.** Logs carry only `reportId`, `reason` and byte sizes, and "SHALL NOT log the note, app name, prompt, source, or device id". Call-site discipline enforces this, not the serializer: the server redact list lacks `note`/`appName`, which the device list does include.
- **Server.**
  - The generation-server spec pins the runtime dependency budget to an exact set: hono, @hono/node-server, pino, @whim/contract (+zod), plus esbuild, playwright and typescript per #68. Any new server dependency trips it.
  - "Logging SHALL NOT be added inside any response-path hot loop."
  - Every `/v1` route is gated by `x-whim-device`, and there is exactly one terminal event per stream.
- **Egress (#68, server-deployment delta).** The container subnet is limited to TCP 443 plus DNS, and 169.254.169.254 is dropped. A process inside the container therefore cannot get GCP metadata credentials. Host-level agents and the dockerd logging driver sit outside the `DOCKER-USER` chain, which I did not test live. The Caddy API site must keep no access log. The boot self-test and smoke test assert that the metadata server is unreachable from the container.
- **Tooling.**
  - `package.json` and `package-lock.json` are in gate.sh `CONFIG_SET`: the gate refuses to run until the edit is committed into BASE, which makes that chain human-bootstrap.
  - RN 0.85.3 runs with `newArchEnabled=true` (bridgeless) and `hermesEnabled=true`, arm64-v8a only. The Podfile uses `use_frameworks!` only if the `USE_FRAMEWORKS` env var is set.
  - `guard:metro` only asserts that the Android bundle is at least 500 KB.
  - Node suites cannot import RN modules.
  - `@whim/contract` values must never enter Metro; device imports from it are type-only.

## Integration points
- Device: `createSeam` transports (index.ts:113) are the single place every redacted record passes. Other attachment points: `DevLogSink`/`SinkOptions`, the `index.js` entry, `ScreenBoundary.renderFallback`, `handleErrorFrame` in useMiniAppHost (fatal branch), `logWebViewError`, and `logMappedError`.
- Sandbox: `post('error', …)` in loader.js and the outer-page relay in build/assemble.mjs. This is containment-critical code: nonce, no new capability, CSP.
- Server:
  - `createApp` middleware and `onError` (app.ts:183-219).
  - `admit` in usage-store.ts, where the requestId is born.
  - `RunTrace`/`pipeline.run` signature (generate.ts:367).
  - `emitCompletion` (machine.ts:640).
  - `requests` DDL, which already uses an additive `ALTER TABLE` pattern for `generation_ids` (usage-store.ts:467-472).
  - `ApiError` and `GenerationEvent` in contract/src/index.ts, if an id is to reach the client.
- Reports: after `reportStore.insert` in routes/report.ts:86-101. Operator reads go through `server/whim-admin.mjs` (server/src/admin/cli.ts).
- Deploy:
  - compose.yaml `logging:` blocks.
  - bootstrap.sh install steps.
  - provision.sh, where the SA roles and APIs are already in place.
  - docs/deploy.md §Operating.
  - The site build (server/src/site/build.ts) and privacy.html.
  - The release checks under scripts/release/lib.

## Risks and unknowns
- Fatal sandbox errors are invisible to anything that only hooks `log.error`, and post-mount iframe errors are not captured at all. Making them reach the host touches loader.js, which falls under the sandbox containment invariants.
- The `whim:page` relayed lines and `lastError` strings carry raw mini-app error messages. These could embed user data or generated-source fragments, and redaction is by field name only, so free-text `detail`/`message`/`stack`/`line` values pass through unredacted on both device and server.
- ScreenBoundary `stack` and LauncherRoot `errorFields.stack` are Hermes stacks. I did not verify whether release builds ship source maps for symbolication.
- I did not verify:
  - whether the store-launch-compliance and platform-release-readiness changes are merged, since both are unarchived;
  - the exact text of `app-privacy.json`;
  - whether a release check scans the policy for the "crash-reporting" sentence specifically, beyond the `consent*` parity check;
  - whether the Docker gcplogs driver or the Ops Agent reach Google APIs despite the firewall (by reading, they run on the host outside `DOCKER-USER`);
  - Cloud Logging cost or retention.
- Native crashes are currently visible only in Play Console vitals and App Store Connect → TestFlight → Crashes, according to backlog.md. I did not check either console.
- Keying events by device id would conflict with the consent copy ("used for daily limits") and with the Play purpose declarations.

## Open questions for the planner
1. Is shipping a crash SDK meant to reverse the "no crash-reporting SDK" commitment? That would mean changing the policy, the store forms, and possibly consent copy. Or does crash reporting have to route through Whim's own server, per #34?
2. Must device-originated crash reports respect the AI-data consent gate, or do they get a new exception like reports have?
3. May a request id leave the server, in an SSE event, a header, or the `ApiError` body? That changes the generation-contract wire.
4. Should the ledger gain a failure-reason column, given that "the ledger holds no content" is a test-asserted file property?
5. Where should report notifications go, and may report metadata (reason, byte sizes, reportId) leave the VM under the content-reports "logs no content" rule?
