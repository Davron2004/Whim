# server-deployment Specification

## Purpose
TBD - created by archiving change public-generation-server. Update Purpose after archive.
## Requirements
### Requirement: A production build produces a self-contained runtime tree
The server package SHALL provide a production build that writes one self-contained runtime tree. That tree SHALL hold the bundled server entry point, the bundled operator command, and every repo file the server reads at run time, each at its repo-relative path: `docs/sdk-reference.md`, `docs/content-policy.md`, the curated top-level `fixtures/*.app.tsx` few-shot examples, `build/react-inject-shim.ts`, and `src/runtime/generated/runtime-artifacts.json`.

The server SHALL start from that tree with the tree's root as working directory and a plain `node` invocation of the bundled entry point. It SHALL NOT invoke `server/dev.mjs`, SHALL NOT bundle anything at start, and SHALL NOT read any file outside the tree except `WHIM_DATA_DIR` and resolved runtime packages. `@whim/contract` and the repo's TypeScript modules SHALL be bundled in. The declared runtime packages SHALL be resolved from `node_modules` at run time.

#### Scenario: The built tree starts without the checkout
- **WHEN** the production build runs, and the built entry point is started with the tree as working directory and the stub selector set
- **THEN** `GET /healthz` returns `200` with the service identity body, and no process loads `server/dev.mjs`

#### Scenario: The tree carries exactly the runtime assets
- **WHEN** the built tree's file list is inspected
- **THEN** it contains the bundled entry points and the listed runtime assets, and it contains no test, spec, or unlisted source file

### Requirement: Boot fails fast when the runtime is incomplete
Before listening, the production server SHALL verify three things: every runtime asset exists and is readable, every declared runtime package (`esbuild`, `playwright`, `typescript`) resolves, and `WHIM_DATA_DIR` is writable. It SHALL exit non-zero with a message naming the first missing item when any check fails.

#### Scenario: A missing asset stops boot by name
- **WHEN** the built tree is started with `docs/sdk-reference.md` removed
- **THEN** the process exits non-zero before listening, and its output names `docs/sdk-reference.md`

#### Scenario: An unwritable data directory stops boot
- **WHEN** `WHIM_DATA_DIR` points at a directory the process cannot write
- **THEN** the process exits non-zero before listening and names the directory

### Requirement: Production configuration refuses dev-only modes
When `NODE_ENV` is `production`, configuration loading SHALL refuse to start the server if any of these hold: the dev log sink is enabled, the stub pipeline selector is set, `OPENROUTER_API_KEY` or either roster model variable is missing, or any configured limit or duration is invalid. Each refusal SHALL name the variable.

In production the logger SHALL emit JSON only.

#### Scenario: The dev log sink cannot reach production
- **WHEN** the server starts with `NODE_ENV=production` and `WHIM_DEV_LOG_SINK=1`
- **THEN** startup fails naming `WHIM_DEV_LOG_SINK`, and no port is bound

#### Scenario: The stub cannot reach production
- **WHEN** the server starts with `NODE_ENV=production` and `WHIM_PIPELINE=stub`
- **THEN** startup fails naming `WHIM_PIPELINE`

#### Scenario: A missing key is named at boot
- **WHEN** the server starts with `NODE_ENV=production` and no `OPENROUTER_API_KEY`
- **THEN** startup fails naming `OPENROUTER_API_KEY` before any browser is launched

### Requirement: Production boot proves the synthetic run works before serving
When the real pipeline is configured, the server SHALL do three things before listening. It SHALL launch the synthetic-run browser with its production launch options. It SHALL run one known-good curated fixture through the synthetic run, which must return a positive containment verdict and a report with no error diagnostic. It SHALL confirm that an egress attempt from a run context is intercepted. Any failure SHALL exit the process non-zero with a named reason, and the server SHALL NOT fall back to a weaker browser configuration.

A failed browser launch, at boot or on a relaunch after the browser disconnected, SHALL be retried up to three attempts in total. Every attempt SHALL use launch options identical to the first. Each failed attempt SHALL be logged with its attempt number and the browser's exit signal or error, and with no other detail. When the third attempt fails, boot SHALL exit non-zero naming the browser launch, and a relaunch SHALL fail the run that needed it.

Before the first launch, boot SHALL log one record naming the host's CPU model, its CPU flags relevant to memory protection (`pku`, `ospke`), and the kernel release, or `unknown` where the host does not expose them.

#### Scenario: A browser that cannot sandbox never serves
- **WHEN** the production server starts on a host where Chromium cannot create its sandbox
- **THEN** every launch attempt fails, the process exits non-zero naming the browser launch as the failure, and no port is bound

#### Scenario: A healthy boot serves
- **WHEN** the production server starts with a working browser and complete runtime tree
- **THEN** the self-test passes and the server begins listening

#### Scenario: One launch crash does not cost the instance
- **WHEN** the first browser launch dies with a signal and the second succeeds
- **THEN** the self-test runs on the second browser, the server listens, and the log shows one failed attempt with its signal

#### Scenario: Retries never weaken the browser
- **WHEN** the launch options of every attempt in a failing boot are recorded
- **THEN** they are identical to the production launch options, with the sandbox enabled in every attempt

#### Scenario: The boot host is recorded
- **WHEN** the production server boots
- **THEN** one log record carries the CPU model, the `pku`/`ospke` flag presence and the kernel release, before the first launch attempt

### Requirement: SIGTERM drains in-flight work before exit
On the first `SIGTERM` or `SIGINT` the server SHALL do the following in order. It SHALL stop accepting new connections and refuse every new admission with `429 server_busy`. It SHALL let running generation streams, unary requests and in-flight stream probes finish until `WHIM_DRAIN_TIMEOUT_MS` (default: `WHIM_GENERATION_MAX_MS` plus 30 seconds) elapses. It SHALL then abort whatever remains with the same semantics as a client disconnect. It SHALL give pending usage and cost resolution a bounded final window. Finally it SHALL close the browser and the stores and exit with status 0.

A second signal during the drain SHALL skip the wait and go straight to the abort step. The drain SHALL NOT truncate a stream that finishes within the deadline.

#### Scenario: A stream finishes during the drain
- **WHEN** a generation is streaming, the server receives `SIGTERM`, and the generation completes before the drain deadline
- **THEN** the client receives the full stream including its single terminal event, and the process then exits 0

#### Scenario: An in-flight stream probe is drained too
- **WHEN** a `/healthz/sse` probe is streaming and the server receives `SIGTERM`
- **THEN** the drain waits for it, the completed drain reports no probe still holding a slot, the probe's connection ends, and the process exits 0

#### Scenario: New work is refused while draining
- **WHEN** a request arrives on an existing connection after `SIGTERM`
- **THEN** it is refused with `429 server_busy`

#### Scenario: The deadline aborts the rest
- **WHEN** a generation is still running at the drain deadline
- **THEN** its pipeline observes an abort, its browser context is closed, the process exits 0, and the ledger row is settled as aborted

### Requirement: The container image is pinned, minimal, non-root, and secret-free
The repo SHALL provide a multi-stage container build that produces the runtime image on a Node 22 base.

The image SHALL install Chromium through the exact Playwright version the lockfile resolves, into a fixed browsers path. It SHALL contain the production runtime tree and only the server workspace's production dependency closure, with no React, React Native, or other devDependency. It SHALL run as a fixed non-root user, contain no secret value, `.env` file, or credential, and expose only the server port. A deploy-config tripwire in the fast gate SHALL fail in any of these cases: the Playwright version the image installs differs from the lockfile's, the image's user is root, the image copies a `.env` file or sets a secret-named variable to a value, or any deploy artifact disables the Chromium sandbox.

#### Scenario: The browser pin follows the lockfile
- **WHEN** the lockfile's resolved Playwright version and the image definition's Playwright install version are compared
- **THEN** they are equal, and the tripwire fails if either changes alone

#### Scenario: The image runs non-root
- **WHEN** the image definition is inspected
- **THEN** its final user is a fixed non-root uid, and the tripwire fails if the user is root or unset

#### Scenario: No sandbox-disabling flag ships
- **WHEN** every deploy artifact is scanned for `--no-sandbox`, `--disable-setuid-sandbox`, or `chromiumSandbox: false`
- **THEN** none is found

### Requirement: Cloud Run serves both hostnames over managed TLS
Production SHALL run as two Cloud Run services in `WHIM_RUN_REGION` (committed default `us-east4`), each reached through a Cloud Run domain mapping with a Google-managed certificate: `whim-server` for the hostname in `WHIM_API_HOST` and `whim-site` for the hostname in `WHIM_WEB_HOST` (committed default `whim.anycognition.ca`). The deploy SHALL refuse a `WHIM_API_HOST` that isn't `api.` followed by `WHIM_WEB_HOST`. No file under `server/src/` SHALL contain a public hostname of the deployment.

Images, Cloud Build and the Firestore database stay in `WHIM_GCP_REGION`; Cloud Run runs elsewhere only because it refuses domain mappings there (decision #72). Operator health checks through the custom domain SHALL use `/health`: Google's front end answers its own `404` for exactly `GET /healthz` on a Cloud Run custom domain, so `/healthz` is served only for older app builds and container-local checks.

#### Scenario: A mismatched API host is refused
- **WHEN** the Cloud Run deploy runs with `WHIM_WEB_HOST=whim.example.ca` and `WHIM_API_HOST=api.other.ca`
- **THEN** it exits non-zero naming `WHIM_API_HOST` before building or deploying anything

#### Scenario: A hostname in server code fails the tripwire
- **WHEN** a file under `server/src/` contains `anycognition.ca` or `sslip.io`
- **THEN** the deploy-config tripwire fails and names the file

#### Scenario: The API health check reaches the server
- **WHEN** an operator requests `https://$WHIM_API_HOST/health`
- **THEN** the server answers `200` with its service identity and commit, not Google's front-end `404`

### Requirement: The pages service serves the Whim pages host
The `whim-site` service SHALL be a Caddy image with the rendered static site and `deploy/cloudrun/Caddyfile` baked in, serving plain HTTP on the port Cloud Run injects while Cloud Run terminates TLS.

Over HTTPS, that site SHALL answer as follows, and none of these answers SHALL be a redirect:
- `/privacy`, `/privacy/v1`, `/terms`, `/fr/privacy`, `/fr/terms`, `/support`, `/beta`, `/beta/thanks` and `/beta/retry` with their pages and status `200`, and `/assets/*` with the site's static assets
- `/a/` and every path under it with the app-link fallback page and status `200`
- `/.well-known/apple-app-site-association` and `/.well-known/assetlinks.json` with the association file's bytes, status `200` and `Content-Type: application/json` when the published site carries them, and status `404` when it doesn't
- any other path with a not-found page and status `404`

The pages site SHALL NOT reverse-proxy, template files or keep request headers or client addresses in its logs. Pages SHALL contain no script and SHALL be served with a `Content-Security-Policy` that starts from `default-src 'none'`. A site-only deploy SHALL build no server image, read no secret, and leave `whim-server` untouched.

#### Scenario: Association files are served as JSON without a redirect
- **WHEN** a client requests `https://$WHIM_WEB_HOST/.well-known/apple-app-site-association` without following redirects, on a site that carries association files
- **THEN** the response is `200` with `Content-Type: application/json` and a body byte-identical to the site build's copy of the file

#### Scenario: An app link opens the fallback page in a browser
- **WHEN** a browser requests `https://$WHIM_WEB_HOST/a/app-abc`
- **THEN** the response is `200` with the fallback page, which contains no script

#### Scenario: Updating the policy doesn't touch the server
- **WHEN** the operator runs `deploy/cloudrun/deploy.sh --site-only`
- **THEN** a new `whim-site` revision serves the new pages, and `whim-server` gets no new revision

### Requirement: The server runs on Cloud Run gen2 with Chromium's sandbox
`whim-server` SHALL run the image from `deploy/Dockerfile` on the Cloud Run gen2 execution environment, with 2 vCPU, 4 GiB, between zero and one instance, request concurrency 40, a 900-second request timeout and port 8787. It SHALL keep `WHIM_DRAIN_TIMEOUT_MS` (8000) inside Cloud Run's 10-second stop grace.

Chromium's sandbox SHALL stay on: no deploy artifact SHALL pass `--no-sandbox`, and a boot that cannot sandbox exits before listening, so Cloud Run replaces that instance rather than serving it. Both services SHALL run as the `whim-run` service account, which holds only secret access to the OpenRouter key, log writing, Firestore use, and permission to start the `whim-purge` job. The VM's host egress firewall and metadata-server block have no Cloud Run equivalent (decision #71): the synthetic run's in-process egress lock, proved by the boot self-test, is the egress control that remains.

#### Scenario: One instance holds every cap
- **WHEN** the Cloud Run deploy runs
- **THEN** `whim-server` is deployed with `--execution-environment gen2` and `--max-instances 1`, so the in-process concurrency caps and the line are one set

#### Scenario: A launch without the sandbox never serves
- **WHEN** Chromium fails to launch or cannot sandbox on a new instance
- **THEN** the boot self-test fails, the process exits before listening, and the platform starts another instance

### Requirement: Secrets are injected at deploy time and never built in
`OPENROUTER_API_KEY` SHALL reach the server and the purge job only as a Cloud Run secret environment variable referencing the latest version of the Secret Manager secret named by `WHIM_OPENROUTER_SECRET_ID`.

The image, the Cloud Build configuration, the deploy scripts and every tracked file SHALL carry the variable's name only, never its value. No script SHALL create, rotate or set the key's value or its provider-side credit limit. A new secret version takes effect on the next deploy.

#### Scenario: The image carries no key
- **WHEN** the built image's layers and environment are inspected
- **THEN** no key-shaped value and no `.env` file is present

#### Scenario: The key arrives as a secret reference
- **WHEN** the Cloud Run deploy deploys `whim-server`
- **THEN** it passes `--set-secrets OPENROUTER_API_KEY=<secret id>:latest` and writes no key value to the environment file it passes

### Requirement: Scripted Cloud Run deploy and rollback
The repo SHALL provide `deploy/cloudrun/deploy.sh` with three modes: a plain deploy (the server image for `HEAD`, built by Cloud Build and tagged with the full commit SHA unless Artifact Registry already holds it, plus the pages site), `--tag <sha>` (the server only, from an image already in Artifact Registry), and `--site-only` (the pages site only).

A plain or site-only deploy SHALL refuse a dirty working tree or an unpushed `HEAD`. Every mode SHALL refuse, naming each, a missing required deploy-time value, and `--tag` SHALL refuse a value that isn't a full 40-character commit SHA or an image Artifact Registry doesn't hold. Rollback SHALL be `--tag` with an earlier commit. Every deploy script SHALL pass a shell syntax check and set `-euo pipefail`, checked in the fast gate.

#### Scenario: A dirty tree is not deployed
- **WHEN** the Cloud Run deploy runs without `--tag` and with uncommitted changes
- **THEN** it exits non-zero before building anything

#### Scenario: Rollback redeploys a known tag
- **WHEN** the Cloud Run deploy is given `--tag` with a commit whose image is in Artifact Registry
- **THEN** it deploys that image without building and without touching the pages site

#### Scenario: A tag with no image changes nothing
- **WHEN** the Cloud Run deploy is given `--tag` with a commit whose image is not in Artifact Registry
- **THEN** it exits non-zero naming the image, and no service changes

### Requirement: Association files come only from the release tooling
The site build SHALL include association files only as the unmodified output of the release tooling's `association-files` command run from the same checkout, and only when both `release/android-upload-cert.sha256` and `release/android-play-signing-cert.sha256` are committed.

When either fingerprint file is missing, the site SHALL carry neither association file, and the build SHALL succeed while reporting that app link verification stays pending and naming the missing file. When both files are present and the command fails, the build SHALL fail and nothing SHALL be published. No deploy artifact SHALL contain hand-written association file content.

#### Scenario: Before the first Play upload
- **WHEN** the site builds from a checkout where `release/android-play-signing-cert.sha256` isn't committed
- **THEN** the build succeeds, its output names that file and says link verification is pending, the site has no `.well-known` files, and after publishing both association paths return `404`

#### Scenario: After the Play signing fingerprint is committed
- **WHEN** both fingerprint files are committed and the release command succeeds
- **THEN** the site's `.well-known` directory holds exactly the command's two files, byte for byte, and the assetlinks file lists the Play signing fingerprint before the upload fingerprint

#### Scenario: A failing release command stops the build
- **WHEN** both fingerprint files are committed and the release command exits non-zero
- **THEN** the site build exits non-zero and the output directory is not created

### Requirement: The privacy policy and support pages match what the app discloses
The repository SHALL hold the privacy policy, support page, app-link fallback page and not-found page as static page sources.

The site build SHALL substitute only these deploy-time values, each HTML-escaped: `WHIM_SUPPORT_EMAIL` (required, with no committed default), and `WHIM_APP_STORE_URL` and `WHIM_PLAY_STORE_URL` (optional). It SHALL fail and name the value when a required value is missing or malformed, when a page uses an unknown placeholder, or when a placeholder survives rendering.

The privacy policy SHALL:
- name AnyCognition Inc. as the operator and give the support email
- quote verbatim every disclosure string of the app's AI-data consent screen
- say that requests go to AnyCognition's server and then to third-party AI models through OpenRouter, and say that which models are used can change without notice, without naming specific model ids
- describe reports as sent only by the user, list what a report holds including the anonymous device ID, and state how long reports are kept
- describe the usage ledger, say it holds no request content, and state how long it's kept
- state that Whim has no accounts, no ads, no analytics, crash-reporting or advertising SDKs, and no sharing between users

A fast-gate tripwire SHALL fail when the rendered policy lacks, verbatim, the value of any launcher copy key starting with `consent`, except a fixed allowlist of non-disclosure keys (the screen title, the outdated-grant line and the action labels), so a new consent key is required by default. It SHALL also fail when a retention period the policy states differs from the server configuration's default, or when any deploy profile or env file sets a retention variable.

#### Scenario: A dropped disclosure fails the gate
- **WHEN** the privacy page no longer contains the consent screen's anonymous-ID line
- **THEN** the tripwire fails naming `consentWhatSentDevice`

#### Scenario: A new consent line must be quoted
- **WHEN** the launcher copy gains a `consentWhatSentReports` key that isn't on the allowlist, and the policy doesn't contain its text
- **THEN** the tripwire fails naming `consentWhatSentReports`

#### Scenario: Retention can't drift from the server
- **WHEN** the policy says reports are kept for 30 days while the report retention default is 90
- **THEN** the tripwire fails

#### Scenario: No support email, no site
- **WHEN** the site build runs without `WHIM_SUPPORT_EMAIL`
- **THEN** it exits non-zero naming `WHIM_SUPPORT_EMAIL` and writes no output directory

#### Scenario: Store links appear only when configured
- **WHEN** neither store URL is set
- **THEN** the fallback page renders without store links and without any leftover placeholder

### Requirement: An anonymous stream probe verifies proxy flushing
The server SHALL expose `GET /healthz/sse`, outside `/v1` and without a device header. It SHALL emit exactly three SSE comment frames one second apart and then close, with no model call, no browser use, and no stored state.

Concurrent probes SHALL be bounded by their own small dedicated cap — `WHIM_LIMIT_PROBE_CONCURRENCY`, default 2, read at startup like every other limit — never by the global unary cap the paid clarify and rewrite routes share, and SHALL be refused with `429 server_busy` beyond it. The probe is unauthenticated and holds its slot for seconds, so counting it against the unary pool would let anonymous traffic starve every paying device.

#### Scenario: The probe streams three spaced frames
- **WHEN** a client reads `/healthz/sse` directly from the server
- **THEN** it receives three comment frames at roughly one-second intervals and the stream ends

#### Scenario: Flooding the probe cannot starve the paid routes
- **WHEN** the probe cap is filled by concurrent probes and another probe arrives
- **THEN** the extra probe is refused `429 server_busy` while a `/v1/clarify` request from a device is still admitted

### Requirement: A load test measures capacity without spending provider credit
The repository SHALL provide a load-test server that runs the production composition (admission, the ledger, the content policy check, the generation machine, the candidate build, the static checks, the sandboxed synthetic run with its boot self-test, and SSE) with a replay model client that has no network code, a stats transport that resolves every generation at zero cost, and a credit transport that reports no limit.

The load-test server SHALL be a separate entry point in a separate image built from the production image of the same commit. It SHALL refuse to start when `OPENROUTER_API_KEY` is set. While running, any `fetch` call SHALL fail. Its `/healthz` SHALL answer with the service identity `whim-server-loadtest`. It SHALL use its own data directory, never production's. The load test runs on the retired VM deployment (`deploy/loadtest/run.sh`); it has no Cloud Run runner yet.

No environment variable SHALL select the load-test server. The production image SHALL contain no module from the load-test sources, and the production Dockerfile, Cloud Build configuration, compose file, deploy script and resize script SHALL NOT reference it. A fast-gate tripwire SHALL fail if either rule breaks.

A load-test driver SHALL start a given number of synthetic devices at once against a deployed server, each posting one generation and reading its stream to the terminal event. It SHALL then probe for leaked slots by starting cap-many generations from fresh devices, twice, aborting each after its first event. It SHALL report p50 and p95 time to first event and total time, counts of terminal events and of refusals by code, the probe verdict, and the peak CPU and memory sampled from the server container. It SHALL exit non-zero on a `failure` terminal, on any refusal when the device count doesn't exceed the cap, or on a failed probe.

#### Scenario: A key in the environment stops the load-test server
- **WHEN** the load-test server starts with `OPENROUTER_API_KEY` set
- **THEN** it exits non-zero naming `OPENROUTER_API_KEY` before launching a browser

#### Scenario: Nothing leaves the process during a load test
- **WHEN** the browser-backed suite runs three concurrent generations through the load-test server with a generation cap of three
- **THEN** all three deliver a `result`, a fourth concurrent generation is refused with `server_busy`, and the `fetch` trap counted zero calls

#### Scenario: The production bundle carries no replay code
- **WHEN** the production entry point is bundled with a metafile
- **THEN** no input path lies under `server/src/loadtest/`, and the tripwire fails if one does

#### Scenario: A leaked slot fails the run
- **WHEN** the server under test never releases a slot after its stream ends
- **THEN** the driver's leak probe receives `server_busy` and the driver exits non-zero

### Requirement: The retired VM deployment stays in the repo and checked
The VM deployment SHALL stay in the repo, marked retired in the runbook, for a return to a VM: `deploy/compose.yaml`, `deploy/Caddyfile`, `deploy/deploy.sh`, `deploy/smoke.sh`, `deploy/resize.sh`, `deploy/provision.sh`, `deploy/profiles/`, `deploy/seccomp/` and `deploy/vm/`.

Its fast-gate tripwires SHALL keep running: the server service drops all capabilities and adds back exactly `SYS_CHROOT`, with `no-new-privileges` and the vendored Playwright seccomp profile; the pages site block in `deploy/Caddyfile` neither reverse-proxies, templates, compresses nor logs; every capacity profile names a unique machine type and sets no daily limit, ceiling, retention period, `NODE_ENV`, pipeline selector, dev log sink or secret. None of it describes production.

#### Scenario: The capability set is pinned
- **WHEN** the deploy-config tripwire reads the server service in the compose definition
- **THEN** `cap_drop` is exactly `[ALL]`, `cap_add` is exactly `[SYS_CHROOT]`, and the tripwire fails on any other added capability or on a missing `no-new-privileges` or seccomp setting

#### Scenario: The VM pages block can't reach the server
- **WHEN** the deploy-config tripwire reads `deploy/Caddyfile`
- **THEN** it fails if the pages site block contains `reverse_proxy`, `templates`, `encode` or `log`, or if the API site block serves files

### Requirement: A short runbook covers operating the public server
`docs/deploy.md` SHALL open with the Cloud Run production deployment: the two services and their shapes, the three deploy modes, the service account, what changed from the VM and what that costs, the Firestore stores, and the domain mappings with their DNS records.

It SHALL then cover the operator values file, the OpenRouter key and its provider-side credit limit, the pages host and when association files go live, operating (logs, reports, usage and cost, tuning limits), the minimum supported build, rolling back and rotating the key. Sections that apply only to the retired VM SHALL say so. It SHALL state the chosen limit defaults and how they were derived.

#### Scenario: The runbook matches the scripts
- **WHEN** the runbook's referenced script names and environment variables are compared with the repo
- **THEN** every referenced script exists and every referenced variable is read by the server or the scripts

### Requirement: Log-based alerts match the Cloud Run service's logs
Every committed log-based alert policy and log metric that watches server output SHALL filter on the `whim-server` Cloud Run revision's logs (`resource.type="cloud_run_revision"` and that service's name) and SHALL NOT reference `log_id("docker")` or `gce_instance`. A metric-threshold policy SHALL name the Cloud Run resource type of the metric it watches.

The Cloud Run deploy script SHALL apply the notification channel, every log metric, every alert policy and the uptime check on each plain deploy. It SHALL create a missing one and SHALL update one only when its committed definition's fingerprint differs, without a VM provisioning step.

A fast-gate check SHALL fail when any committed monitoring definition references the Docker log id or the GCE instance resource, or when the deploy script would leave a committed policy file unapplied.

#### Scenario: No alert watches the VM
- **WHEN** the fast gate scans `deploy/monitoring/`
- **THEN** no file mentions `log_id("docker")` or `gce_instance`, and every log filter names `cloud_run_revision`

#### Scenario: A deploy applies every alert
- **WHEN** a plain Cloud Run deploy runs against a fake `gcloud` that records its calls
- **THEN** the log metric, every `policy-*.json` and the uptime check are created or updated by fingerprint, and an unchanged definition is not rewritten

### Requirement: A Cloud Run deploy ends with a Cloud Run smoke check
The repository SHALL provide a Cloud Run smoke script. `deploy/cloudrun/deploy.sh` SHALL run it at the end of every mode, SHALL exit non-zero when it fails, and SHALL print the rollback command when it does. The smoke SHALL NOT depend on a static IP, SSH, or any VM value.

It SHALL check that:
- both domain mappings report ready and both hostnames resolve;
- `/health` returns `200` with `"ok":true`, `"service":"whim-server"`, the deployed commit, and the configured minimum builds;
- a `/v1` route without `x-whim-device` returns `400`;
- a pre-protocol build is refused with `426 update_required`;
- `/healthz/sse` frames arrive spaced;
- the pages host serves its pages and association files exactly as the site build published them;
- the `whim-purge` job and its hourly scheduler exist;
- the serving revision is the one just deployed, with all traffic, and runs with the instance bounds the deploy script sets (a minimum of 0, at revision and service level, and a maximum of 1), so no revision bills idle or extra instances unseen.

A site-only deploy SHALL run only the pages checks.

Unless the operator passes `--no-live`, the smoke SHALL send exactly one live `POST /v1/clarify` with a fixed, documented smoke device id and a fixed benign prompt, and SHALL require a `200`. This is the only production write any smoke makes. It writes one ledger row and one usage document under that device id. The smoke SHALL make no other request that admits, credits or stores anything.

#### Scenario: A stale revision fails the deploy
- **WHEN** `/health` reports a commit other than the one deployed
- **THEN** the smoke fails naming both commits, and the deploy script exits non-zero printing the rollback command

#### Scenario: No VM values are needed
- **WHEN** the smoke runs with `WHIM_STATIC_IP` and `WHIM_GCP_ZONE` unset
- **THEN** it runs every check without error from missing values

#### Scenario: Exactly one live request
- **WHEN** a full smoke runs against a fake `curl` that records requests
- **THEN** exactly one request carries the smoke device id, and it is `POST /v1/clarify`

#### Scenario: A smoke can make no write at all
- **WHEN** the smoke runs with `--no-live`
- **THEN** no request carries the smoke device id and nothing is written; the pre-protocol `426` probe carries the all-zero device id `00000000-0000-4000-8000-000000000000` and is refused before admission

### Requirement: Firestore admission contention is load-tested without touching production
The repository SHALL provide an on-demand Firestore admission load test. It SHALL drive bursts of concurrent `admit` calls (generate, and a clarify+rewrite mix under the shared unary ceiling) through the production `FirestoreUsageStore`. It SHALL report p50 and p99 `admit` latency, the transaction attempt count per admission, the number of transactions that exhausted their retries, and whether the number admitted equals exactly the configured limit.

By default it SHALL run against the Firestore emulator from the pinned `firebase-tools`. It SHALL run against real Firestore only when the operator names a database. In that mode it SHALL:
- refuse `(default)`, the deployed `WHIM_FIRESTORE_DATABASE`, and any name without the `whim-loadtest-` prefix;
- refuse to run more than a hard cap of operations, and print that cap's estimated cost before it starts;
- create the database itself and delete it on exit, including after a failure.

It SHALL never contact a deployed server, and it SHALL NOT run in any gate. A small-burst correctness case (no over-admission, no exhausted transaction) SHALL run in the existing Firestore conformance step.

#### Scenario: The production database is refused
- **WHEN** the load test is given `--database` equal to the deployed `WHIM_FIRESTORE_DATABASE` or `(default)`
- **THEN** it exits non-zero before creating a client or any database

#### Scenario: A burst never over-admits
- **WHEN** 50 concurrent `admit` calls race for a global limit of 20 on the emulator
- **THEN** exactly 20 are admitted, none exhausts its retries, and the report records p50/p99 latency and attempts

#### Scenario: The throwaway database is always deleted
- **WHEN** a real-database run fails midway
- **THEN** the script still deletes the `whim-loadtest-*` database it created and exits non-zero

