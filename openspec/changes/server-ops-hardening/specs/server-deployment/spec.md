## MODIFIED Requirements

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

## ADDED Requirements

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
- the serving revision is the one just deployed, with all traffic.

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
- **THEN** no request carries a device id

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
