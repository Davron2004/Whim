## Why

Whim is going to the App Store and Google Play, and store-installed apps need a server they can reach. The generation server today only runs from a repo checkout through `server/dev.mjs` on a LAN (research.md R1 §1–3). Every model call runs on the operator's OpenRouter key, so anyone who can reach a public server can spend that money. Two facts make the current server unsafe to expose. First, untrusted generated JS runs in Chromium with the OS sandbox off (Playwright adds `--no-sandbox`) and nothing intercepts its network traffic (R2 §A1–A5). Second, the server has no request-size limits, no quotas, no per-device concurrency cap and no content filter (R3 §Current behavior). Apple 4.7.1 and Google Play's AI-generated-content policy also require a way to filter objectionable content and a way for users to report it.

## What Changes

- **Production packaging.** A production build writes a self-contained runtime tree (bundled entry points plus the few repo files the pipeline reads at run time). A Node 22 container image runs it as a non-root user, and a preflight at boot fails fast if an asset or runtime package is missing. The image pins Chromium to the lockfile's Playwright version. It does not use the Playwright base image, which ships Node 24 (see design.md D2). Production config refuses the dev log sink and the stub pipeline. SIGTERM drains in-flight streams up to a deadline.
- **Dependency budget amended.** `esbuild`, `playwright` and `typescript` become declared `@whim/server` runtime dependencies, pinned to the lockfile's versions. The pipeline already needs all three at run time (R1 §4). **BREAKING** for the spec's "exactly four runtime deps" rule.
- **Synthetic-run hardening.** Chromium's OS sandbox is always on, and launch fails rather than falling back. Every request from a run's browser context is aborted, except the run's own page, which is served from memory. A browser-wide dead proxy and a WebRTC UDP policy back that up. The candidate build resolves nothing from disk, and the import allowlist covers re-export and `import =` forms. All waits honor abort, and a crashed browser is replaced. A browser-backed test with a local canary fails if any egress path reopens.
- **Admission control.** Every refusal is an `ApiError`. Body and prompt byte caps return 413 `payload_too_large`. Per-device-per-UTC-day limits return 429 `daily_limit` with `Retry-After`. A second concurrent generation from one device returns 429 `device_busy`. A global concurrency cap, a global daily generation ceiling and draining return 429 `server_busy`. Limits are env-configurable. The per-device daily limit and the global caps are the primary spend controls, with public-beta defaults justified in design.md D6.
- **A request ledger in the existing usage store.** It is one row per admitted request: device, kind, UTC day, outcome, tokens and resolved **cost in USD** from OpenRouter's generation-stats data. Daily limits are enforced from it. An operator CLI reports cost per generation, per device and per day. It stores no content.
- **Content policy check** on `/v1/clarify`, `/v1/rewrite` and `/v1/generate`, run before any model work or stream opens. A refusal returns 422 `content_policy`. A failed check returns 503 `policy_unavailable` (fail closed). The classifier uses the configured rewrite model against a 13+ rating policy kept in one document, which also supplies the rating rule the generation prompts carry.
- **`POST /v1/report`** accepts a `ReportRequest` and returns 202 `{ reportId }`. Reports go to a separate store with a retention period, and the operator lists them with the CLI. This is the one deliberate exception to "no content stored".
- **Real disconnect proof.** Tests over an actual TCP socket show that a client disconnect tears down the model call, the browser context and the admission slot within a bound.
- **Bounded lifetimes.** A generation has a wall-clock budget that ends in a single `failure` terminal event. Unary model calls time out.
- **Attestation-ready identity seam.** The `/v1` gate runs through an injectable device verifier. App Attest or Play Integrity can replace the UUID shape check later with no route changes.
- **GCP deployment artifacts.** The Dockerfile and a Cloud Build config push to Artifact Registry. The VM runs a compose file with Caddy, which provides automatic TLS for `api.whim.<domain>` or an sslip.io hostname and never buffers SSE. The artifacts also cover a seccomp profile, a container egress firewall, the persistent-disk layout, a provisioning script, a VM bootstrap, a deploy script with post-deploy smoke checks, and `docs/deploy.md`. Secrets come from Secret Manager at deploy time and are never baked in. Creating the GCP resources is not a task.
- Update the "LAN dev only" purpose line and every other statement this change makes false.

Non-goals: app or launcher UI (the sibling `store-launch-compliance` change), BYOK, model pickers, accounts, billing, native iOS/Android work, changes to `GenerationEvent`, and implementing attestation.

## Capabilities

### New Capabilities
- `server-deployment`: the production build and start path, the self-contained runtime tree and boot preflight, production config refusals, the container image, graceful drain, the boot self-test, the Caddy TLS front with unbuffered SSE, the GCP VM deploy artifacts (compose, seccomp, egress firewall, persistent disk, secrets), the deploy script and the runbook.
- `server-admission-control`: body and prompt caps, per-device daily limits, per-device generation exclusivity, global concurrency and daily ceilings, drain refusal, `Retry-After`, check ordering, env-configurable limits, the request ledger with per-request cost, and the operator usage report.
- `content-policy`: the fail-closed pre-model content check on the three prompt routes, the 13+ policy document as the single source, the in-memory-only verdict cache, deterministic stub behavior, metering of the check, and the rating rule in generation prompts.
- `content-reports`: `POST /v1/report`, report validation and caps, the separate report store, retention purge, report caps, operator listing, and logging without content.

### Modified Capabilities
- `generation-server`: the runtime and dependency budget (harness deps declared, production start, configurable bind), device identity behind an injectable verifier, client disconnect proven over real TCP with bounded teardown and slot release, the server-state rule (usage store plus user-sent reports replace "only a token counter"), and blocking-suite wording (loopback sockets allowed).
- `generation-contract`: `ReportRequest`/`ReportResponse` shapes and a closed `ServiceRefusalCode` enum naming the six refusal identifiers. `ApiError` is unchanged.
- `generation-pipeline`: a wall-clock run budget that ends in one `failure`, and cost resolution for every run (token reconciliation still only on abort).
- `synthetic-run`: OS sandbox always on, no network egress with an out-of-band proof, a build that reads nothing from disk, abort honored at every wait, and browser crash replacement.
- `static-checks`: the import allowlist also rejects `export … from` and `import x = require(…)` specifiers.

## Impact

- **Code:** `server/src/{main,app,config,sse}.ts`, `server/src/routes/*` (new `report.ts`), new `server/src/{admission,policy,reports,device-identity}/`, `server/src/usage-store.ts`, `server/src/generation/{machine,reconcile,index}.ts`, the prompt builders, new `server/build.mjs` and `server/admin.mjs`, `synthrun/{session,builder,observe,report,concurrency}.ts`, `checks/passes/import-allowlist.ts`, `contract/src/index.ts`.
- **Tests:** new fast suites in `server/test/` (admission, policy, reports, ledger, config, real-TCP disconnect, production build, deploy config), browser-backed additions to `server/test/e2e.ts` and `synthrun/test/` (egress canary, sandbox, crash replacement, boot self-test). No gate script edits.
- **Dependencies (human bootstrap):** `server/package.json` and `package-lock.json` gain `esbuild`, `playwright` and `typescript` at the lockfile's exact versions.
- **New files:** `deploy/` (Dockerfile, cloudbuild.yaml, compose.yaml, Caddyfile, seccomp profile, VM scripts, provision/deploy/smoke scripts), root `.dockerignore` and `.gcloudignore`, `docs/deploy.md`, `docs/content-policy.md`.
- **Docs:** `docs/decisions.md` gets a new entry (public server posture, the reports exception to Model 1 #33), plus the generation-server spec Purpose, `docs/capabilities.md` rows and a README pointer.
- **CI and devcontainer:** the Chromium sandbox has to launch in CI and in the devcontainer (a runner sysctl and a seccomp run argument, if needed).
- **Wire contract:** additive only (new shapes and a new enum). Existing device builds keep working. A 429, 413, 422 or 503 surfaces through the existing `http` error kind until the sibling change adds UX.
