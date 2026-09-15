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
The deployment SHALL place Caddy in front of the server with automatic TLS for the hostname in `WHIM_API_HOST`, a deploy-time value whose committed default is `api.whim.anycognition.ca`. The deploy SHALL refuse a `WHIM_API_HOST` that isn't `api.` followed by `WHIM_WEB_HOST`. No file under `server/src/` SHALL contain a public hostname of the deployment.

Caddy SHALL redirect HTTP to HTTPS and reverse-proxy to the server over a private container network. The server's port SHALL NOT be published on the host. Caddy SHALL flush proxied responses immediately (`flush_interval -1`), SHALL apply no response compression, SHALL cap request bodies at no less than the server's largest body cap, and SHALL keep no access log that could record `x-whim-device`. Certificate state SHALL live on the persistent disk.

#### Scenario: Streams are not buffered through the proxy
- **WHEN** the post-deploy smoke check reads `GET https://$WHIM_API_HOST/healthz/sse`
- **THEN** its three frames arrive about one second apart rather than together at the end

#### Scenario: The server is not reachable around the proxy
- **WHEN** the VM's public IP is probed on the server port
- **THEN** no connection is accepted

#### Scenario: A hostname in server code fails the tripwire
- **WHEN** a file under `server/src/` contains `anycognition.ca` or `sslip.io`
- **THEN** the deploy-config tripwire fails and names the file

#### Scenario: DNS drift is named before any TLS request
- **WHEN** smoke runs and `WHIM_WEB_HOST` resolves to an address other than `WHIM_STATIC_IP`, or has an AAAA record
- **THEN** smoke fails naming the hostname and the records it found, before making any HTTPS request

### Requirement: The front proxy also serves the Whim pages host
The same Caddy SHALL serve a second site for the hostname in `WHIM_WEB_HOST` (committed default `whim.anycognition.ca`) from a rendered static site directory on the persistent disk, mounted read-only.

Over HTTPS, that site SHALL answer as follows, and none of these answers SHALL be a redirect:
- `/privacy` and `/support` with their pages and status `200`
- `/a/` and every path under it with the app-link fallback page and status `200`
- `/.well-known/apple-app-site-association` and `/.well-known/assetlinks.json` with the association file's bytes, status `200` and `Content-Type: application/json` when the published site carries them, and status `404` when it doesn't
- any other path with a not-found page and status `404`

The pages site SHALL NOT reverse-proxy, template files, compress responses, or keep an access log, and the API site SHALL NOT serve site files. Pages SHALL contain no script and SHALL be served with a `Content-Security-Policy` that starts from `default-src 'none'`.

Publishing SHALL swap in a complete new site directory atomically. A site-only publish SHALL build no image, read no secret, and leave the server container running.

#### Scenario: Association files are served as JSON without a redirect
- **WHEN** smoke requests `https://$WHIM_WEB_HOST/.well-known/apple-app-site-association` without following redirects, on a site that carries association files
- **THEN** the response is `200` with `Content-Type: application/json` and a body byte-identical to the site build's copy of the file

#### Scenario: An app link opens the fallback page in a browser
- **WHEN** a browser requests `https://$WHIM_WEB_HOST/a/app-abc`
- **THEN** the response is `200` with the fallback page, which contains no script

#### Scenario: Updating the policy doesn't interrupt a generation
- **WHEN** the operator runs a site-only publish while a generation is streaming
- **THEN** the new privacy page is served and the stream still ends with its single terminal event

#### Scenario: The pages site can't reach the server
- **WHEN** the deploy-config tripwire reads the Caddyfile
- **THEN** it fails if the pages site block contains `reverse_proxy`, `templates`, `encode` or `log`, or if the API site block serves files

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

The site build SHALL substitute only these deploy-time values, each HTML-escaped: `WHIM_SUPPORT_EMAIL` (required, with no committed default), `WHIM_ENGINEER_MODEL` and `WHIM_REWRITE_MODEL` (required, the values the deployed server runs with), and `WHIM_APP_STORE_URL` and `WHIM_PLAY_STORE_URL` (optional). It SHALL fail and name the value when a required value is missing or malformed, when a page uses an unknown placeholder, or when a placeholder survives rendering.

The privacy policy SHALL:
- name AnyCognition Inc. as the operator and give the support email
- quote verbatim every disclosure string of the app's AI-data consent screen
- say that requests go to AnyCognition's server and then to third-party AI models through OpenRouter, and name the configured models
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

Concurrent probes SHALL be bounded by their own small dedicated cap, never by the global unary cap the paid clarify and rewrite routes share, and SHALL be refused with `429 server_busy` beyond it. The probe is unauthenticated and holds its slot for seconds, so counting it against the unary pool would let anonymous traffic starve every paying device.

#### Scenario: The probe streams three spaced frames
- **WHEN** a client reads `/healthz/sse` directly from the server
- **THEN** it receives three comment frames at roughly one-second intervals and the stream ends

#### Scenario: Flooding the probe cannot starve the paid routes
- **WHEN** the probe cap is filled by concurrent probes and another probe arrives
- **THEN** the extra probe is refused `429 server_busy` while a `/v1/clarify` request from a device is still admitted

### Requirement: The server container runs hardened on the VM
The deployment's compose definition SHALL run the server container with these settings. The seccomp profile vendored from the lockfile's Playwright version SHALL be applied, and no other security weakening. `no-new-privileges` SHALL be set, and the container SHALL drop all Linux capabilities (`cap_drop: [ALL]`) and add back exactly one, `SYS_CHROOT` (`cap_add: [SYS_CHROOT]`), because Docker's seccomp profile allows `chroot` only when that capability is held and Chromium's namespace sandbox calls `chroot` inside its own user namespace. The non-root server process still holds no effective, permitted or ambient capability. The root filesystem SHALL be read-only, with a size-bounded `/tmp` tmpfs. The container SHALL have an init process, a shared-memory size sufficient for Chromium, a process-count limit, a memory limit, and an automatic restart policy. The stop grace period SHALL be at least the drain timeout plus 30 seconds. `WHIM_DATA_DIR` SHALL be bind-mounted from the persistent disk and owned by the container's uid.

The VM SHALL install a boot-persistent firewall rule set for traffic leaving the deployment's container network. It SHALL keep traffic between the deployment's own containers working. It SHALL drop traffic to the metadata server address and to private, carrier-grade-NAT, and link-local ranges. It SHALL allow egress to any other destination only on TCP 443 and DNS.

#### Scenario: The capability set is pinned
- **WHEN** the deploy-config tripwire reads the server service in the compose definition
- **THEN** `cap_drop` is exactly `[ALL]`, `cap_add` is exactly `[SYS_CHROOT]`, and the tripwire fails on any other added capability or on a missing `no-new-privileges` or seccomp setting

#### Scenario: A container cannot reach the metadata server
- **WHEN** the post-deploy smoke check attempts a request from inside the server container to `169.254.169.254`
- **THEN** the attempt fails

#### Scenario: Data survives a container recreate
- **WHEN** the server container is recreated by a deploy
- **THEN** the usage and report databases from before the deploy are present and readable

### Requirement: Secrets are injected at deploy time and never built in
`OPENROUTER_API_KEY` SHALL be held in Secret Manager, fetched by the deploy script using the operator's credentials, and written on the VM to a root-owned, owner-read-only environment file consumed by the compose definition.

The VM's service account SHALL have no Secret Manager access. The image, the compose file, the Cloud Build configuration, instance metadata, and every tracked file SHALL carry the variable's name only, never its value.

Before building or changing anything, the deploy script SHALL read the secret and SHALL exit non-zero naming it when the secret doesn't exist, has no enabled version, or is empty. No script SHALL create, rotate or set the key's value or its provider-side credit limit; provisioning creates only the empty secret.

#### Scenario: A missing key stops the deploy before a build
- **WHEN** the deploy script runs and the secret has no enabled version
- **THEN** it exits non-zero naming the secret, no Cloud Build is started, and nothing on the VM changes

#### Scenario: The image carries no key
- **WHEN** the built image's layers and environment are inspected
- **THEN** no key-shaped value and no `.env` file is present

#### Scenario: The key file is not world-readable
- **WHEN** the deployed environment file's mode and owner are inspected on the VM
- **THEN** it is owned by root and readable by its owner only

### Requirement: Scripted build, deploy, and smoke checks
The repo SHALL provide scripts for each deployment step. A Cloud Build configuration SHALL build the `linux/amd64` image and tag it with the full git commit SHA in Artifact Registry. A provisioning script SHALL encode the one-time GCP setup without being run by any task. A VM bootstrap script SHALL install the container runtime, mount the persistent disk, create owned data directories, verify that unprivileged user namespaces are available, and install the egress firewall.

A deploy script SHALL refuse to deploy a dirty working tree or an unpushed commit, and SHALL refuse, naming each, when a required deploy-time value is missing. It SHALL build and push the image, upload the compose, Caddy, and seccomp files, write the secret file and the server's non-secret configuration, build and publish the pages site, pull, and restart the server through its drain. It SHALL wait for health and then run the smoke checks. Rollback SHALL be the same deploy script given an earlier image tag. A site-only mode SHALL publish the pages site and the Caddyfile and run the pages checks without touching the server.

The smoke checks SHALL verify: both hostnames resolve only to the static IP; the TLS health check returns exactly the production service identity; a `/v1` route without a device header returns `400`; the stream probe's frames arrive spaced; container egress to the metadata server fails; the privacy, support, fallback and not-found pages answer as specified; and each association path either serves the site build's file or returns `404`, matching what the build published. Every script SHALL pass a shell syntax check in the fast gate.

#### Scenario: A dirty tree is not deployed
- **WHEN** the deploy script runs with uncommitted changes
- **THEN** it exits non-zero before building anything

#### Scenario: Rollback redeploys a known tag
- **WHEN** the deploy script is given a previously pushed image tag
- **THEN** it deploys that tag without building and runs the same smoke checks

#### Scenario: A site-only publish needs no key
- **WHEN** the operator runs the site-only mode before the OpenRouter secret has a version
- **THEN** the pages site is published and checked, and the server container is not recreated

### Requirement: VM size and capacity limits change together as a named profile
The deployment SHALL define capacity profiles as committed files, each naming exactly one VM machine type, the server container's memory limit and shared-memory size, and any server limit overrides. It SHALL provide `standard` (`e2-standard-2`, no server limit overrides) and `event` (`e2-standard-8` with `WHIM_MAX_CONCURRENT_GENERATIONS=15`, `WHIM_SYNTHRUN_CONCURRENCY=6` and `WHIM_MAX_CONCURRENT_UNARY=32`). Machine types SHALL be unique across profiles. No profile SHALL set a daily limit, a daily ceiling, a retention period, `NODE_ENV`, the pipeline selector, the dev log sink, or a secret.

The deploy script SHALL apply the profile whose machine type equals the VM's actual machine type, and SHALL refuse, naming the type, when no profile matches. It SHALL take no option that picks a profile. Provisioning SHALL create the VM with the `standard` machine type unless told to use another profile.

A resize script SHALL move the VM to a named profile by, in order: checking the region's quota for the target type, draining and stopping the server container, stopping the VM, setting its machine type, starting it, and redeploying the running image tag, which writes that profile's configuration and runs the smoke checks. When setting the type or starting the VM fails, it SHALL start the VM on the type it has, redeploy the profile for that type, and exit non-zero naming the failed step.

#### Scenario: A machine type without a profile is refused
- **WHEN** the deploy script runs against a VM whose machine type is `e2-highcpu-4`
- **THEN** it exits non-zero naming `e2-highcpu-4` before changing anything on the VM

#### Scenario: Resizing up for an event
- **WHEN** the operator runs the resize script with `--profile event` on a VM running the standard profile
- **THEN** the VM runs `e2-standard-8`, the server's environment holds the event limits, and smoke passes

#### Scenario: The server stays down until its limits match
- **WHEN** the VM restarts during a resize
- **THEN** the server container stays stopped until the redeploy has written the profile for the new machine type

#### Scenario: A failed resize leaves a consistent server
- **WHEN** setting the machine type fails
- **THEN** the VM runs its previous type with that type's profile, smoke passes, and the script exits non-zero naming the step

### Requirement: A load test measures capacity without spending provider credit
The repository SHALL provide a load-test server that runs the production composition (admission, the ledger, the content policy check, the generation machine, the candidate build, the static checks, the sandboxed synthetic run with its boot self-test, and SSE) with a replay model client that has no network code, a stats transport that resolves every generation at zero cost, and a credit transport that reports no limit.

The load-test server SHALL be a separate entry point in a separate image built from the production image of the same commit. It SHALL refuse to start when `OPENROUTER_API_KEY` is set. While running, any `fetch` call SHALL fail. Its `/healthz` SHALL answer with the service identity `whim-server-loadtest`. On the VM it SHALL use its own data directory, never production's.

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

#### Scenario: A forgotten load-test container fails the next smoke
- **WHEN** smoke runs while the load-test server answers on the API host
- **THEN** smoke fails on the service identity

#### Scenario: A leaked slot fails the run
- **WHEN** the server under test never releases a slot after its stream ends
- **THEN** the driver's leak probe receives `server_busy` and the driver exits non-zero

### Requirement: A short runbook covers operating the public server
`docs/deploy.md` SHALL describe, in order: one-time provisioning (APIs, Artifact Registry, adopting the reserved static IP, the VM on the standard profile with its persistent disk, firewall, minimal service account, the empty Secret Manager secret, and the owner-created OpenRouter key with its provider-side credit limit); the DNS records for both hostnames; the operator values file; VM bootstrap; deploying; verifying; the pages host (publishing the site, the support email, and when association files go live relative to the first Play upload and the first TestFlight build); operating (logs, reports, usage and cost, tuning limits); capacity profiles, resizing for an event and back, and running the load test; rolling back; and rotating the key.

It SHALL state the chosen limit defaults and how they were derived, and it SHALL mark the event profile's numbers as estimates until a recorded load test replaces them.

#### Scenario: The runbook matches the scripts
- **WHEN** the runbook's referenced script names and environment variables are compared with the repo
- **THEN** every referenced script exists and every referenced variable is read by the server or the scripts
