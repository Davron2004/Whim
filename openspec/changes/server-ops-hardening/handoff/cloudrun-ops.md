# Contract: cloudrun-ops (chain-4, #138/#146)

Consumers: chain-6 (runbook `docs/deploy.md`, decision entry), the orchestrator (tasks 7.4/7.5).

## `deploy/cloudrun/smoke.sh`

```
deploy/cloudrun/smoke.sh                  every check, then one live POST /v1/clarify
deploy/cloudrun/smoke.sh --commit <sha>   the same; /health and the serving revision must be that commit
deploy/cloudrun/smoke.sh --no-live        every check but the live clarify
deploy/cloudrun/smoke.sh --pages-only     pages and association files only (no gcloud, no API host)
  [--site-dir <dir>]                      compare association files with that site build
```

- Flags combine (`--commit` + `--no-live`). `--pages-only` with `--commit` is a usage error (exit 2).
- Without `--site-dir` it builds the site from the checkout (`whim_cloudrun_site_build`), so it then
  needs `WHIM_SUPPORT_EMAIL`, `WHIM_ENGINEER_MODEL`, `WHIM_REWRITE_MODEL`.
- Always needs `WHIM_GCP_PROJECT WHIM_RUN_REGION WHIM_API_HOST WHIM_WEB_HOST`; never `WHIM_STATIC_IP`,
  `WHIM_GCP_ZONE`, SSH or any VM value. Tools: curl, node (+ dig, gcloud unless `--pages-only`).
- Exit 0: `cloudrun/smoke.sh: all checks passed`. Exit 1: `N smoke check(s) failed`, each `FAIL  ...`
  line on stderr. Domain problems stop the smoke before any HTTPS request.

Checks, in order (full mode):
1. `gcloud run domain-mappings describe --domain <host> --region $WHIM_RUN_REGION --format=json` for
   both hosts: `spec.routeName` is `whim-server` (API) / `whim-site` (web), `Ready` condition `True`;
   `dig +short A <host>` returns an IPv4 address.
2. `gcloud run services describe whim-server --format=json`: `latestCreatedRevisionName ==
   latestReadyRevisionName`; traffic with percent > 0 sums to 100, all on that revision; with
   `--commit`, the template image ends `:<sha>`; template annotation
   `run.googleapis.com/cpu-throttling` is not `"false"` (request-based billing, ruling 4).
3. Shared HTTP checks (`deploy/lib.sh`): `/health` (commit, `minBuild` = `WHIM_MIN_BUILD_*`), device
   gate `400` (POST `/v1/generate` without `x-whim-device`), pre-protocol `426 update_required`,
   `/healthz/sse` 3 frames over >= 1.5 s, beta signup trap `303` to `/beta/thanks` (stores nothing).
4. `gcloud run jobs describe whim-purge` exists; `gcloud scheduler jobs describe whim-purge-hourly
   --format='value(schedule,state)'` is `0 * * * *` + `ENABLED`. Skipped when
   `WHIM_STORE_BACKEND=sqlite` (prints `skip  purge job`).
5. Live clarify (unless `--no-live`), see below. Requires `200`.
6. Pages (11 paths, `/beta` CSP `font-src 'self'`) and `.well-known/{apple-app-site-association,
   assetlinks.json}`: byte-equal 200 JSON when the site build has the file, else 404.

## The one production write

- Device id `5e0ce000-0000-4000-8000-00000000c1a1`, prompt `smoke: a checklist with one item`,
  body `{"prompt":"smoke: a checklist with one item"}`, `--max-time 90`.
- Envelope = `server/src/bench-envelope.ts`: `x-whim-platform: android`, `x-whim-app-version: 1.0.0`,
  `x-whim-build:` minutes since 2026-01-01T00:00Z, `x-whim-consent: 2`, `x-whim-protocol: 1`. The suite
  holds these equal to `benchEnvelopeHeaders()` (build within 1).
- Writes one `clarify` ledger row + one usage document under that id (the suite replays the request
  against the real app: `200`, 1 ledger row).
- The pre-protocol probe carries device id `00000000-0000-4000-8000-000000000000` in every mode
  (the device gate runs before the protocol gate); it is refused `426` before admission and writes
  nothing. So `--no-live` means "no request carries the smoke device id and nothing is written",
  not "no request carries any device id".

## `deploy/cloudrun/deploy.sh`

- Ends every mode with the smoke: plain → `--commit HEAD --site-dir <its build>`; `--tag <sha>` →
  `--commit <sha>` (live clarify included, ruling 2; the smoke builds the site itself);
  `--site-only` → `--pages-only --site-dir <its build>`. Success prints `cloudrun/deploy.sh: done`.
- On smoke failure, exit 1 and print to stderr
  `cloudrun/deploy.sh: the smoke failed. What this deploy changed is live. To roll back:` then
  - server modes: `  deploy/cloudrun/deploy.sh --tag <sha>`, the sha read (before deploying) from the
    image tag of `status.latestReadyRevisionName` via `gcloud run revisions describe`; or
    `  (no earlier whim-server revision with a commit-tagged image to roll back to)`;
  - site deployed (plain, `--site-only`): `  gcloud --project <p> run deploy whim-site --region <r>
    --image <previous whim-site template image>` when one was read.
- Server deploy now passes `--cpu-throttling` (request-based billing; was implicit before).
- Forwards optional keys `WHIM_POLICY_ATTEMPT_TIMEOUT_MS`, `WHIM_LIMIT_POLICY_CHECKS_PER_DEVICE_DAY`,
  `WHIM_LIMIT_POLICY_CHECKS_PER_DAY` (added to `WHIM_VALUE_KEYS` and `deploy/operator.env.example`).
- A plain firestore deploy requires `WHIM_ALERT_EMAIL` (refused before any gcloud call) and, after the
  purge job, runs `whim_apply_monitoring`. `--tag`, `--site-only` and `WHIM_STORE_BACKEND=sqlite`
  apply no monitoring.

## Monitoring apply (`deploy/lib.sh`, shared with `provision.sh`)

`whim_apply_monitoring <alert email> <api host>` (needs `WHIM_MONITORING_WORK`; optional
`WHIM_FAIL_CONTEXT` suffix on errors; sets `WHIM_MONITORING_CHANNEL`):
1. Dry-renders every `channel-email.json`, `metric-*.json`, `policy-*.json` first; an unfilled
   `{{placeholder}}` fails before anything is applied.
2. Channel, uptime check (`uptime-healthz.env`), each log metric, each `policy-*.json`: created when
   missing (by display name; metric by name), updated in place when the `whim_spec` fingerprint
   differs, else `unchanged ...`. Output lines unchanged from `provision.sh`
   (`created|updated|unchanged alert policy '<name>'`, etc.).
- Other lib helpers: `whim_require_hostnames`, `whim_cloudrun_site_build <out>`, `whim_smoke_*`
  (`probe`, `health`, `device_header_required`, `pre_protocol_build_refused`, `stream_probe`,
  `beta_signup_trap`, `pages`, `association`, `finish`). VM `deploy/smoke.sh` uses them; its CLI and
  output are unchanged.

## Filters (exact)

Server selector, at the start of every server log filter:
`resource.type="cloud_run_revision" AND resource.labels.service_name="whim-server" AND logName:"run.googleapis.com%2Fstdout"`

| File | Filter after `<selector> AND ` |
| --- | --- |
| `metric-whim-terminal-failures.json` | `jsonPayload.msg="terminal failure"` |
| `policy-credit-exhausted.json` | `((jsonPayload.msg="request" AND jsonPayload.error="budget_exhausted") OR (jsonPayload.scope="run" AND jsonPayload.msg="provider credit exhausted"))` |
| `policy-device-error.json` | `jsonPayload.scope="device" AND severity>=ERROR` |
| `policy-report.json` | `jsonPayload.scope="report" AND jsonPayload.msg="report accepted"` |

- `policy-terminal-failures.json`: `metric.type="logging.googleapis.com/user/whim-terminal-failures"
  AND resource.type="cloud_run_revision"` (> 5 per hour).
- `policy-purge-failed.json` (unchanged): `resource.type="cloud_run_job" AND
  resource.labels.job_name="whim-purge" AND severity>=ERROR`. `policy-api-down.json`: uptime metric.
- Policy docs now point at `node server/admin.mjs ...` from a laptop and `deploy/cloudrun/smoke.sh
  --no-live`. Logs Explorer short form (no AND): `resource.type="cloud_run_revision"
  resource.labels.service_name="whim-server" jsonPayload....`.
- The suite's runbook test reads the "Terminal failures, by reason" row's line predicates and
  evaluates them under the selector above, whatever log selector the row names, so chain-6 may write
  either form; the row must keep a base filter in backticks plus a `<code>` narrowing.
