## Context

`research.md` maps the terrain. Summary:

- **Device.** Every host diagnostic already goes through one seam (`src/host/logging/`). A record is `{at, level, channel, message, fields}`. It is redacted by field name before any transport sees it, kept in a 500-record memory ring, and mirrored to logcat. A dev-only sink can POST it to `/dev/logs`, and that sink is off in shipping builds. Nothing leaves the phone in production.
- **Gaps on the device.** There is no global JS handler. Fatal sandbox error frames (bundle, mount, deliver) only set `lastError` and never emit `log.error`. Errors thrown inside the mini-app iframe after mount reach nobody.
- **Server.** It logs pino JSON with serializer-level redaction to Docker `json-file` (10 MB × 5) on one GCE VM. Nothing ships off the VM.
- **Requests.** `usageStore.admit` mints a UUID per request, but the machine's `terminal failure` line doesn't carry it, the ledger has no reason column, and no id reaches the client.
- **Alerting.** None: no uptime check, budget, or alert policy exists. `provision.sh` already enables the Logging and Monitoring APIs and grants the VM service account `logging.logWriter` and `monitoring.metricWriter`.
- **Published text.** The privacy policy currently says "no analytics, crash-reporting or advertising SDKs" and "Server logs hold no request content", and the store declarations list exactly user content and device ID. That text is an unreviewed AI draft that #63 rewrites; the release checks enforce it until then. The consent screen lists what gets sent. Any request needs a current AI-data consent grant, except a hand-sent report.

The owner chose to route device errors through Whim's own server instead of a third-party SDK (2026-09-23).

## Goals / Non-Goals

**Goals:**
- Every host error class that the app can catch is visible to the owner in one place (Cloud Logging) within a minute, with a readable stack. That includes fatal JS errors and errors inside the mini-app iframe.
- A failed generation can be followed from the device error to the server's log lines to the ledger row by one id.
- The owner gets an email when a report arrives, the API is down, generations start failing, OpenRouter credit runs out, or GCP spend crosses a threshold.
- Nothing new leaves the phone that could contain what the user typed, saved, or generated.

**Non-Goals:**
- Product analytics, funnels, or session tracking.
- Native crash capture. Play vitals and App Store Connect already collect native crashes without a declaration.
- A custom dashboard. Logs Explorer and saved queries are the dashboard.
- Symbolicating native frames.

## Decisions

### D1. Diagnostics go through Whim's server, not an SDK
The app POSTs batches to `POST /v1/diagnostics`. The server validates them, logs each record through pino, and stores nothing. The logs then ship to Cloud Logging with the rest (D8).

Alternatives:
- **Sentry.** It gives native crashes, symbolication and a UI for free. The cost is a third-party processor that receives crash data, and a native dependency.
- **Server-only.** No store change, but the app stays blind.

Owner's call. It keeps #34 (telemetry lives on the server) and Model 1 (#33) intact, because nothing new is persisted.

Both routes need the same custom code: the allowlist projection (D2) and sandbox capture (D6), since the sandbox has no network access and no SDK can see into it. The only real choice is where the records land. Cloud Logging wins at current scale: one query joins a device error to its server request (D7), and no new processor is added. Sentry wins on grouping, per-release regressions, native crash context and automatic source maps, all of which matter once there are more errors than one person can read. Moving is cheap because every record already goes through one transport, so Sentry would be a second transport fed the same allowlisted records.

Add Sentry as that second transport when any of these holds: triage takes more than about 30 minutes a week; someone starts building grouping or per-release views on Logs Explorer; or native crashes in Play vitals and App Store Connect become a real share of failures and are hard to act on. #63 should describe the destination as "service providers acting for us", so this switch never changes a promise or forces a re-ask.

### D2. An allowlist decides what leaves, not redaction
Redaction by field name can't catch free text. A mini-app's error message, a host `detail`, or the first line of a Hermes stack can all embed user data (research.md, Risks). So a new pure function, `toDiagnostic(record)`, projects a redacted `DevLogRecord` onto a closed shape and drops everything else.

- **Envelope** (once per batch): `platform`, `osVersion`, `appVersion`, `buildNumber`. No device id.
- **Record:** `at`, `level`, `channel`, `message`. `message` is the call site's constant string, which the seam already requires.
- **Allowlisted fields**, each a bounded string or number:
  - `screen`, `errorClass`, `where`, `stage`, `reason`, `kind`, `status`, `errorCode`, `domain`, `readyState`, `observedRepairAttempts`, `requestId`, `count`
  - `route`: the path only, e.g. `/v1/generate`. It is never a URL.
  - `stack`: see below.
- **Limits:** strings are capped at 128 characters. `stack` is capped at 4 KB, has its first line dropped (Hermes puts `Name: message` there), and is only kept for host errors. Mini-app frames never carry a stack or a message, just `where` and `name` → `errorClass`.

The same closed shape is a zod schema in `@whim/contract` (`DiagnosticsBatch`, `.strict()`). The server rejects unknown keys, so the rule holds even against an old or tampered client. The device imports the type only, since zod never enters Metro.

Alternative: extend the redaction list. It fails open on the next new field name. The allowlist fails closed.

### D3. Uploads respect the AI-data consent gate
The diagnostics transport sends only while a current consent grant exists. Records emitted without one are dropped, not queued. #63's rewritten consent text covers diagnostics (D11), so the grant covers them.

Alternative: a no-consent exception like reports. Rejected. A report is a user's deliberate act; a background upload is not.

### D4. A transport in the seam, batched, deduplicated and capped
`diagnosticsTransport` sits beside the ring buffer and the dev sink in `createSeam`, so it only ever sees redacted records.

- **What it forwards:** `error` level only.
- **Deduplication:** by `(channel, message, errorClass, where)` per app session. Repeats bump `count` instead of adding records.
- **Caps:** at most 50 distinct records per session. A flush happens at 20 records, every 30 s, or when the app goes to the background.
- **Delivery:** one attempt, no retry. A failure is recorded to the ring buffer on `whim:sink` without recursing, the same semantics as the dev sink.
- **Why the caps matter:** a mini-app that throws in a loop can't flood the server or drain the battery.

The dev sink is unchanged and stays off by default. This is why `host-observability` is modified: that spec currently says the seam makes no network request unless the dev sink is on.

### D5. Fatal JS errors survive the crash via a one-record slot
`index.js` installs `ErrorUtils.setGlobalHandler`, which chains to the previous handler, plus a Hermes unhandled-rejection hook. Both emit `log.error` on channel `whim` with a constant message.

A fatal error kills the JS thread before any flush. So for `isFatal`, the handler also writes the allowlisted projection (D2) of that single record to MMKV under one fixed key. The next launch sends it and then deletes it.

This doesn't break the "ring buffer is not persisted" requirement. The buffer isn't persisted; one already-allowlisted record is.

### D6. Sandbox errors: log what's already relayed, capture what isn't
- **Host side.** `handleErrorFrame`'s fatal branch (bundle, mount, deliver), paint-watchdog timeouts and launch failures call `log.error(page, 'mini-app failed', {where, errorClass, appId})`, not just `lastError`. `appId` is dropped by the allowlist; it serves the on-device overlay only.
- **Iframe side.** `loader.js` adds `error` and `unhandledrejection` listeners on the realm's `window`, which post the existing nonce-authenticated `error` frame with `where: 'runtime' | 'rejection'` and `name`.
  - No new frame kind, capability, global or CSP change.
  - A forged frame still fails the nonce check.
  - A mini-app that removes the listeners only hides its own errors.
  - React 19's `createRoot` reports uncaught render errors through `reportError`, which fires `error` on `window`. This is **to be verified** with a scratch script against the built runtime (task 3.1).
- **Containment.** The invariants suites must stay green (`npm run invariants`, `bridge:invariants`).

### D7. One request id per `/v1` request, minted at the edge
- **Minting.** A middleware in `createApp` mints a UUID before device-identity and admission. It sets `x-whim-request-id` on every `/v1` response, including refusals and SSE opens, and binds a pino child logger carrying `requestId` into the Hono context.
- **Ledger.** `usageStore.admit` takes the id instead of minting one, so ledger `requests.id` equals the request id.
- **Pipeline.** `pipeline.run` receives it through `RunTrace`/the logger, so `terminal failure` carries it.
- **Device.** The client reads the header (XHR `getResponseHeader`) and attaches `requestId` to any error record about that request.

Alternative: an id field in `GenerationEvent`. Rejected: it changes the stream contract, and refusals aren't events.

The header name lives in `@whim/contract` as a constant. The device copies the literal, because values from the contract never enter Metro, and a static check keeps the two equal.

### D8. Cloud Logging through the Ops Agent, not the gcplogs driver
The Ops Agent's logging receiver tails `/var/lib/docker/containers/*/*-json.log`, parses the Docker envelope, then parses pino's JSON in `log` into `jsonPayload`, mapping `severity`.

- **Why not `gcplogs`.** As far as we know, the Docker `gcplogs` driver sends each line as a string `message` without parsing the JSON, which would lose field queries and severity. It also needs dual-logging to keep `docker compose logs`. Task 1.1 confirms this before anything else is built. If `gcplogs` does parse structured payloads on this Docker version, switch to it; it's simpler.
- **Severity.** pino gets a `formatters.level` that emits `severity: "INFO" | "WARNING" | "ERROR" | …` alongside the numeric level.
- **Local logs.** `json-file` stays, so on-VM `docker compose logs` is unchanged.
- **Where it runs.** The agent is installed by `deploy/vm/bootstrap.sh` and runs on the host, outside the `DOCKER-USER` egress chain. Container egress rules are untouched, and the container still can't reach the metadata server.
- **Retention.** The `_Default` bucket keeps 30 days.

### D9. `failure_reason` is a closed code, so the ledger still holds no content
- **Schema.** An additive `ALTER TABLE requests ADD COLUMN failure_reason TEXT`, using the existing pattern.
- **Values.** Only the machine's terminal reason codes and the server's refusal codes, both closed enums, validated on write. Free text is rejected.
- **Reading it.** `whim-admin usage` shows a count per reason.
- **Disclosure.** #63's policy text should cover a per-request failure code in the ledger; D11's coverage check (task 5.1) confirms it.

### D10. Alerts are committed files applied by `provision.sh`
`deploy/monitoring/` holds the policy JSON. `provision.sh` applies each by display name: it creates the policy if missing and updates it otherwise, so it's safe to rerun like the rest of the script. Everything emails one channel, `WHIM_ALERT_EMAIL` (new operator config).

| Alert | Trigger | Rate limit |
|---|---|---|
| API down | uptime check on `https://<api>/healthz`, 5 min, 3 regions, fails 2 in a row | — |
| New report | log match `scope="report" msg="report accepted"`, carries `reportId` + `reason` | 1 per 5 min |
| Generation failures | log-based metric on `terminal failure`, > 5 in 1 h | 1 per hour |
| Credit exhausted | log match on a `budget_exhausted` refusal | 1 per hour |
| Device error | log match `scope="device" severity>=ERROR` | 1 per hour |
| (not an alert) Disk snapshots | daily schedule on `whim-data`, keep 14 | — |
| GCP spend | billing budget on `WHIM_BILLING_ACCOUNT`, 50/90/100 % of `WHIM_MONTHLY_BUDGET_USD` | — |

The report alert sends only what is already in the logs: id and reason. Content stays in `reports.db`, and the email tells the owner to run `whim-admin reports show <id>`.

### D11. Disclosure comes from #63; this change only checks coverage
#63 rewrites the consent screen, policy and store declarations from first principles, with room for planned features, and lands first. Its text should already cover error diagnostics, so this change adds no consent copy and bumps no consent version. That avoids a re-ask whose only cause would be this feature.

What this change owns:
- **Release checks.** They fail when a build contains the diagnostics transport and any declaration (consent screen, privacy policy, Play Data safety, iOS privacy manifest, App Store privacy answers) doesn't cover crash logs and diagnostics as collected, not shared, and not linked. They also fail when the declarations disagree.
- **Facts to check against #63's text:** diagnostics are not linked to identity (no device id is sent), are kept 30 days in server logs, and go to service providers acting for Whim. On iOS that means `CrashData` + `OtherDiagnosticData`, and on Play, App info and performance → Crash logs + Diagnostics.
- **Fallback.** If #63's text doesn't cover diagnostics, add the missing declaration here and bump the consent version. That is the one re-ask.

The current policy and store text are an unreviewed AI draft, so none of their specifics (including "no crash-reporting SDKs") constrain this change.

### D12. Source maps per release build, symbolicated on demand
- **Producing them.** The release scripts (`android:release`, the iOS archive lane) already produce a Hermes bundle; they also emit the composed Hermes source map.
- **Storing them.** Maps are uploaded to a private bucket `gs://anycognition-whim-sourcemaps/<platform>/<version>+<build>.map`, which `provision.sh` creates. They aren't committed to git (several MB each).
- **Using them.** `scripts/symbolicate.mjs <platform> <version> <build>` reads a stack on stdin and prints source frames, using `metro-symbolicate`. It is already in the tree through React Native. If it isn't a direct dependency, the `package.json` edit makes that chain human-bootstrap.

### D13. `/healthz` names the running commit
`deploy/cloudbuild.yaml` already tags each image with the full commit SHA, and `deploy.sh` refuses a dirty or unpushed tree. So the SHA is trustworthy. It is passed as a Docker build arg into an `ENV`, so the value describes the image's bytes. A value set at deploy time would only describe what the deploy script believed. A rollback therefore reports the right commit with no extra step. The repo is public, so publishing the SHA reveals nothing an attacker couldn't already read. Smoke compares it with the deployed tag, which catches the "deploy said OK, old container still serving" case, and the boot log line carries it, so every Cloud Logging entry after a restart can be dated to a commit.

## Risks / Trade-offs

- **#63 slips or misses diagnostics.** Then this change needs its own re-ask. → Chain-5 waits for #63, and the fallback in D11 keeps it to one re-ask either way.
- **The allowlist hides the cause.** Dropping free-text messages means some errors arrive as `TypeError` at a frame with no message. → Symbolicated stacks usually locate it. If a class keeps coming back unexplained, add a structured field at the call site, never the free text.
- **Mini-app error spam.** → Dedup, a per-session cap, and a per-device daily cap on the route (D4, spec).
- **The Ops Agent can't reach Google APIs.** It is host-level and outside `DOCKER-USER` by reading, but that isn't verified live. → Task 1.1 checks on the real VM before anything else.
- **Alert noise.** → Rate limits per policy, and thresholds are plain JSON the owner can tune.
- **Cloud Logging cost.** → Current volume is far below the free 50 GiB/month. The budget alert catches runaway.
- **Source map / build mismatch.** → The key includes version and build number, and the symbolicate script refuses a missing key instead of guessing.
- **The iframe listener changes containment code.** → No new capability, the existing nonce frame, and the invariants suites stay the gate.

## Migration Plan

1. **Server first:** request id, `failure_reason`, pino severity, `/v1/diagnostics`. Deploy with `deploy/deploy.sh`. Old clients ignore the new header and never call the new route.
2. **VM:** rerun `bootstrap.sh` (Ops Agent), then `provision.sh` (bucket, channel, uptime check, alert policies, budget). Confirm logs appear in Logs Explorer and a test alert fires.
3. **App release:** transport, handlers and sandbox capture in one build, gated by the release checks from D11. Update Play Data safety and the App Store privacy answers before submitting that build.
4. **Rollback:** the route is additive, and the device transport is off without consent. Uninstalling the Ops Agent leaves `json-file` logs as before. The ledger column is additive and nullable.

## Open Questions

- Does diagnostics upload need the AI-data consent grant at all (D3), or does it rest on another legal basis? #63 answers this (its question 3). If consent isn't needed, D3 may still stay as a product choice (turning AI off stops everything leaving the phone), but that becomes the owner's call, not a legal one.

- Is Play's purpose for crash logs and diagnostics "App functionality" or "Analytics" under Google's current definitions? Settle it in the Data safety task against the live form.
- Do React 19 root render errors reach `window` `error` inside the sandboxed realm? Task 3.1 verifies this; if not, the SDK's root gets an error boundary that posts the same frame.
