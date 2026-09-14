## ADDED Requirements

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

#### Scenario: A browser that cannot sandbox never serves
- **WHEN** the production server starts on a host where Chromium cannot create its sandbox
- **THEN** the process exits non-zero naming the browser launch as the failure, and no port is bound

#### Scenario: A healthy boot serves
- **WHEN** the production server starts with a working browser and complete runtime tree
- **THEN** the self-test passes and the server begins listening

### Requirement: SIGTERM drains in-flight work before exit
On the first `SIGTERM` or `SIGINT` the server SHALL do the following in order. It SHALL stop accepting new connections and refuse every new admission with `429 server_busy`. It SHALL let running generation streams and unary requests finish until `WHIM_DRAIN_TIMEOUT_MS` (default: `WHIM_GENERATION_MAX_MS` plus 30 seconds) elapses. It SHALL then abort whatever remains with the same semantics as a client disconnect. It SHALL give pending usage and cost resolution a bounded final window. Finally it SHALL close the browser and the stores and exit with status 0.

A second signal during the drain SHALL skip the wait and go straight to the abort step. The drain SHALL NOT truncate a stream that finishes within the deadline.

#### Scenario: A stream finishes during the drain
- **WHEN** a generation is streaming, the server receives `SIGTERM`, and the generation completes before the drain deadline
- **THEN** the client receives the full stream including its single terminal event, and the process then exits 0

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

### Requirement: A TLS front proxy serves the API without buffering streams
The deployment SHALL place Caddy in front of the server with automatic TLS for the hostname in `WHIM_API_HOST`, which may be `api.whim.<domain>` or an `sslip.io`-style hostname derived from the VM's static IP, so the same artifacts serve before and after DNS exists.

Caddy SHALL redirect HTTP to HTTPS and reverse-proxy to the server over a private container network. The server's port SHALL NOT be published on the host. Caddy SHALL flush proxied responses immediately (`flush_interval -1`), SHALL apply no response compression, SHALL cap request bodies at no less than the server's largest body cap, and SHALL keep no access log that could record `x-whim-device`. Certificate state SHALL live on the persistent disk.

#### Scenario: Streams are not buffered through the proxy
- **WHEN** the post-deploy smoke check reads `GET https://$WHIM_API_HOST/healthz/sse`
- **THEN** its three frames arrive about one second apart rather than together at the end

#### Scenario: The server is not reachable around the proxy
- **WHEN** the VM's public IP is probed on the server port
- **THEN** no connection is accepted

### Requirement: An anonymous stream probe verifies proxy flushing
The server SHALL expose `GET /healthz/sse`, outside `/v1` and without a device header. It SHALL emit exactly three SSE comment frames one second apart and then close, with no model call, no browser use, and no stored state.

Concurrent probes SHALL count against the global unary cap and be refused with `429 server_busy` beyond it.

#### Scenario: The probe streams three spaced frames
- **WHEN** a client reads `/healthz/sse` directly from the server
- **THEN** it receives three comment frames at roughly one-second intervals and the stream ends

### Requirement: The server container runs hardened on the VM
The deployment's compose definition SHALL run the server container with these settings. The seccomp profile vendored from the lockfile's Playwright version SHALL be applied, and no other security weakening. `no-new-privileges` SHALL be set and all Linux capabilities dropped. The root filesystem SHALL be read-only, with a size-bounded `/tmp` tmpfs. The container SHALL have an init process, a shared-memory size sufficient for Chromium, a process-count limit, a memory limit, and an automatic restart policy. The stop grace period SHALL be at least the drain timeout plus 30 seconds. `WHIM_DATA_DIR` SHALL be bind-mounted from the persistent disk and owned by the container's uid.

The VM SHALL install a boot-persistent firewall rule set for traffic leaving the deployment's container network. It SHALL keep traffic between the deployment's own containers working. It SHALL drop traffic to the metadata server address and to private, carrier-grade-NAT, and link-local ranges. It SHALL allow egress to any other destination only on TCP 443 and DNS.

#### Scenario: A container cannot reach the metadata server
- **WHEN** the post-deploy smoke check attempts a request from inside the server container to `169.254.169.254`
- **THEN** the attempt fails

#### Scenario: Data survives a container recreate
- **WHEN** the server container is recreated by a deploy
- **THEN** the usage and report databases from before the deploy are present and readable

### Requirement: Secrets are injected at deploy time and never built in
`OPENROUTER_API_KEY` SHALL be held in Secret Manager, fetched by the deploy script using the operator's credentials, and written on the VM to a root-owned, owner-read-only environment file consumed by the compose definition.

The VM's service account SHALL have no Secret Manager access. The image, the compose file, the Cloud Build configuration, instance metadata, and every tracked file SHALL carry the variable's name only, never its value.

#### Scenario: The image carries no key
- **WHEN** the built image's layers and environment are inspected
- **THEN** no key-shaped value and no `.env` file is present

#### Scenario: The key file is not world-readable
- **WHEN** the deployed environment file's mode and owner are inspected on the VM
- **THEN** it is owned by root and readable by its owner only

### Requirement: Scripted build, deploy, and smoke checks
The repo SHALL provide scripts for each deployment step. A Cloud Build configuration SHALL build the `linux/amd64` image and tag it with the full git commit SHA in Artifact Registry. A provisioning script SHALL encode the one-time GCP setup without being run by any task. A VM bootstrap script SHALL install the container runtime, mount the persistent disk, create owned data directories, verify that unprivileged user namespaces are available, and install the egress firewall.

A deploy script SHALL refuse to deploy a dirty working tree or an unpushed commit. It SHALL build and push the image, upload the compose, Caddy, and seccomp files, write the secret file, pull, and restart the server through its drain. It SHALL wait for health and then run the smoke checks. Rollback SHALL be the same deploy script given an earlier image tag.

The smoke checks SHALL verify: the TLS health check returns the service identity; a `/v1` route without a device header returns `400`; the stream probe's frames arrive spaced; and container egress to the metadata server fails. Every script SHALL pass a shell syntax check in the fast gate.

#### Scenario: A dirty tree is not deployed
- **WHEN** the deploy script runs with uncommitted changes
- **THEN** it exits non-zero before building anything

#### Scenario: Rollback redeploys a known tag
- **WHEN** the deploy script is given a previously pushed image tag
- **THEN** it deploys that tag without building and runs the same smoke checks

### Requirement: A short runbook covers operating the public server
`docs/deploy.md` SHALL describe, in order: one-time provisioning (APIs, Artifact Registry, static IP, VM and persistent disk, firewall, minimal service account, Secret Manager secret, and a dedicated OpenRouter key with a provider-side credit limit); VM bootstrap; deploying; verifying; operating (logs, reports, usage and cost, tuning limits including raising them for an event); rolling back; switching from the `sslip.io` hostname to `api.whim.<domain>`; and rotating the key.

It SHALL state the chosen limit defaults and how they were derived.

#### Scenario: The runbook matches the scripts
- **WHEN** the runbook's referenced script names and environment variables are compared with the repo
- **THEN** every referenced script exists and every referenced variable is read by the server or the scripts
