## Why

Today the owner can't see anything that goes wrong for a user unless the user files a report. App errors never leave the phone: the ring buffer is memory-only and the dev sink is off in shipping builds. Server logs rotate away on the VM after about 50 MB. A failed generation logs only a reason code, with nothing tying it to its ledger row or to what the phone saw. Nothing notifies anyone when a report arrives, the API goes down, or spend spikes (audit of 2026-09-23, `docs/backlog.md`; terrain in `research.md`). With two testers this is fine. It won't be at public launch.

## What Changes

- **Device diagnostics.** The app sends error-level records to a new `POST /v1/diagnostics` route on Whim's own server. No third-party SDK is added. A closed allowlist of fields decides what goes, applied after the existing redaction, so free-text error messages from the host or a mini-app never leave the phone. Uploads need a current AI-data consent grant, like every other request. The route logs each record through pino and stores nothing.
- **Error sources that are invisible today get captured:** a global JS error handler, unhandled promise rejections, fatal sandbox error frames (bundle, mount, deliver), and uncaught errors inside the mini-app iframe after mount. That last one goes over the existing nonce-authenticated `error` frame, with no new capability and no CSP change.
- **Readable stacks.** Every release build keeps its Hermes source map, keyed by version and build number, and an operator script symbolicates a stack from Cloud Logging.
- **Server logs go to Google Cloud Logging** through the Ops Agent on the VM host, which parses pino's JSON into queryable fields. `docker compose logs` keeps working, and container egress is unchanged. Each pino line carries a Cloud Logging `severity`.
- **One request id per `/v1` request** comes from the `request-envelope` change, which this change builds on: device error records attach it, and the Logs Explorer queries use it.
- **Alerts by email to the owner, all Cloud Monitoring config** created idempotently by `deploy/provision.sh`: an uptime check on `/healthz`, a GCP billing budget, and log-based alerts for a new report (report id and reason only), a spike in generation failures, `budget_exhausted` refusals, and device diagnostics.
- **Disclosure.** #63 rewrites the consent screen, privacy policy and store declarations first, and its text already covers diagnostics. This change only checks that coverage and fails the release if a declaration is missing. So no consent change and no re-ask are expected. If #63's text turns out not to cover diagnostics, the missing declaration is added here and that becomes the one re-ask.

Out of scope: product analytics of any kind, a web dashboard (Cloud Logging's Logs Explorer is the dashboard), and native crash capture (Play vitals and App Store Connect already collect it, and neither needs a store declaration).

## Capabilities

### New Capabilities
- `device-diagnostics`: which device errors are captured, the allowlisted record shape, consent-gated batched upload to `/v1/diagnostics`, the route's admission and logging, source-map retention and symbolication, and the disclosure that has to match it.
- `server-observability`: log shipping to Cloud Logging with severity, the ledger's `failure_reason`, and the alerting set (uptime, budget, reports, failure spikes, refusals, diagnostics).

### Modified Capabilities
- `host-observability`: "Batched delivery to the dev sink…" currently says the logging seam makes no network request unless the dev sink is enabled. It changes so the dev sink stays off by default while the diagnostics upload becomes a second governed path out of the seam.

## Impact

- **Device:** `src/host/logging/` (new diagnostics transport), `index.js` (global handler), `src/host/launcher/useMiniAppHost.ts` (fatal error frames get logged), `src/runtime/web/loader.js` and `build/assemble.mjs` (iframe `error`/`unhandledrejection` → existing error frame; containment-critical, `npm run invariants` must stay green), `generation-client.ts` / `transport-shared.ts` (read the request-id header), `copy.ts` (consent line, policy version).
- **Contract:** the `DiagnosticsBatch` zod schema in `@whim/contract`. The device imports them type-only.
- **Server:** new `routes/diagnostics.ts`; `usage-store.ts` (additive `failure_reason` column via the existing `ALTER TABLE` pattern); `machine.ts` terminal failure; pino `severity` formatter in `logger.ts`. No new runtime dependency.
- **Deploy:** `deploy/vm/bootstrap.sh` (Ops Agent and its config), `provision.sh` (source-map bucket, alert channel, uptime check, log-based alerts, budget), new operator config `WHIM_ALERT_EMAIL`, `WHIM_BILLING_ACCOUNT` and `WHIM_MONTHLY_BUDGET_USD`, and `docs/deploy.md` §Operating (Logs Explorer queries).
- **Release:** release scripts upload each build's Hermes source map to a private bucket, plus `scripts/symbolicate.mjs`; `deploy/site/privacy.html`, `release/store/play/data-safety.json`, `ios/Whim/PrivacyInfo.xcprivacy`, App Store privacy answers, review notes, and the release parity checks.
- **Sequencing:** `public-generation-server` (3 live-verification tasks open), `store-launch-compliance` (all done) and `platform-release-readiness` (24 open) are unarchived, and their deltas own specs this change sits next to: content-reports, server-deployment, ai-data-consent, store-listing. This change adds requirements in its own capabilities rather than modifying theirs. Archiving `store-launch-compliance` first is still worth doing, and `public-generation-server` can be archived once task 15.5 runs.
- **After `request-envelope`**, which provides the request id and the version/build envelope. Chains 2 and 4 read its `handoff/envelope.md`.
- **Blocked on #63** (promise only what Whim is). Chain-5 (disclosure) takes its consent and policy wording from that audit, so users are asked to agree again once, not twice.
