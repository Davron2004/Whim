## Context

The generation server is a Node 22 + Hono service that only runs from a repo checkout through `server/dev.mjs`. dev.mjs bundles `main.ts` into a temp file at start and relies on the checkout layout: every runtime file read resolves off `process.cwd()` (research.md R1 §1–3). `esbuild`, `playwright` and `typescript` are root devDependencies, yet the real pipeline needs all three at run time (R1 §4). `SIGTERM` closes the listener and exits with no drain (R1 §2).

The untrusted-code path is weaker than the containment story assumes:

- Playwright adds `--no-sandbox` because `chromiumSandbox` is unset (R2 §A1).
- Nothing intercepts the context's traffic (R2 §A2).
- The page is loaded from `file://`, which is outside Playwright's interception (R2 §A3).
- The CSP does not cover a frame navigating itself (R2 §A4).
- No test watches traffic outside the realm (R2 §A5).
- The candidate build resolves anything esbuild can find on disk, and the import allowlist misses `export … from` and `import =` (R2 §A6).

Abort reaches the model fetch but not the synthrun's semaphore wait, page open or mount wait. It has never been exercised over a real TCP socket (R2 §B8–B10). There are no body caps, quotas, per-device concurrency limits or content checks. The usage store is one cumulative token table with no cost (R3 §Current behavior; proposer notes in research.md).

Every model call spends the operator's OpenRouter key, so cost abuse is the main public risk. The decisions this design builds on are fixed in the orchestrator's launch context: a GCP Compute Engine VM with Docker and Caddy, a persistent disk, Artifact Registry, a 13+ rating, and the exact refusal and report shapes. `server-connectivity` is treated as applied, so `/healthz` returns `{ ok: true, service: 'whim-server' }`.

## Goals / Non-Goals

**Goals:**
- A store-installed app can reach `https://api.whim.<domain>` (or an sslip.io stand-in) over TLS with unbuffered SSE, backed by a reproducible, non-root, secret-free image.
- Untrusted generated code cannot reach the network, cannot read server files through the build, and runs inside Chromium's OS sandbox. A test fails if any of that regresses.
- Spend is bounded per device and globally, per-request cost is measured from provider data, and the operator can see it.
- Objectionable prompts are refused before any model work, and the check fails closed.
- Users can report content, and the operator can read reports, which expire.
- Disconnects, drains, crashes and stalls all release their resources within stated bounds.

**Non-Goals:**
- App or launcher UI for refusals, limits, reports or consent (`store-launch-compliance`).
- BYOK, accounts, billing, model pickers, native work, and any change to `GenerationEvent`.
- Implementing device attestation (only the seam, D15).
- Creating the GCP resources (the scripts encode them, and the orchestrator runs them).
- High availability or multi-VM. One VM for the beta.
- Moderating generated output. Per the launch decision, prompts are filtered, generation prompts carry the rating rule, and reports are the backstop.

## Decisions

### D1. Production runtime tree keeps the checkout-relative layout
`server/build.mjs` bundles `server/src/main.ts` → `server/dist/app/server/main.mjs` and `server/src/admin/cli.ts` → `server/dist/app/server/whim-admin.mjs`. It uses the same esbuild settings as dev.mjs, adds a linked sourcemap, and marks exactly the declared runtime packages external (`hono`, `@hono/node-server`, `pino`, `esbuild`, `playwright`, `typescript`). It then copies the runtime assets into `server/dist/app/` at their repo-relative paths, from one exported list: `docs/sdk-reference.md`, `docs/content-policy.md`, the curated fixtures, `build/react-inject-shim.ts`, `src/runtime/generated/runtime-artifacts.json`. `build/assemble.mjs` is imported and so is bundled (R1 §3).

The process runs with the tree root as its cwd, so every existing `process.cwd()` read keeps working with no path change. A preflight module (`server/src/preflight.ts`) walks the same asset list, `createRequire`-resolves the three harness packages, and checks `WHIM_DATA_DIR` is writable, before any listener opens.

*Alternatives:* adding an asset-root variable and rewriting every read. Rejected: cwd resolution was chosen on purpose because bundling collapses `import.meta.url` (R1 §3), and a second resolution scheme is a new failure mode. Running dev.mjs in the container was also rejected: it bundles at boot, writes temp files into a read-only root, and needs devDependencies.

### D2. Image base is `node:22-bookworm-slim`, not the Playwright image
**This deviates from the brief's "Playwright base image" wording, on a verified fact:** the Playwright v1.60.0 image installs Node 24 (research.md proposer notes). CI runs Node 22 (`invariants.yml:28,56`), the devcontainer is `node:22-bookworm`, and `engines` says ≥22.11. Running production on a different Node major than every gate would put the two most delicate behaviors on untested runtime code: `node:sqlite`, and `@hono/node-server`'s abort-on-close over undici.

The Dockerfile (`deploy/Dockerfile`, build context = repo root, root `.dockerignore`) has three stages:

1. **build:** `npm ci --ignore-scripts`, then `npm run build`, then `node server/build.mjs`.
2. **deps:** `npm ci --omit=dev --workspace server --include-workspace-root=false --ignore-scripts`. This yields the server workspace's production closure, with no React or React Native.
3. **runtime:** `node:22-bookworm-slim`. It runs `npx --ignore-scripts --package=playwright@<lockfile version> playwright install --with-deps --only-shell chromium` into `PLAYWRIGHT_BROWSERS_PATH=/ms-playwright`, which is the same pin convention CI and the devcontainer already use (R1 §Integration points). It then copies the runtime tree and `node_modules`, creates user `whim` with uid/gid 10001, sets `USER 10001`, `WORKDIR /app`, `ENV NODE_ENV=production`, `CMD ["node","--enable-source-maps","server/main.mjs"]`, and `EXPOSE 8787`.

The fast-gate deploy tripwire reads the lockfile's resolved `playwright` version and fails if the Dockerfile's install pin differs.

*Alternative:* the Playwright image with Node 24. Rejected for the parity reason above. Switching later means changing one `FROM` line plus the tripwire (see Open Questions).

### D3. The dependency budget names the harness runtime
`server/package.json` gains `esbuild`, `playwright` and `typescript` as `dependencies`, pinned exactly to the lockfile-resolved root versions (1.60.0 / 0.25.12 / 5.9.3 at planning time). Root devDependencies stay. npm dedupes the hoisted copy, so `guard:metro` is unaffected. The contract suite's budget check grows to the seven-package set and asserts the exact-pin equality.

*Alternatives:* installing root devDependencies into the image (pulls the RN toolchain, and the budget becomes fiction) or bundling the three. Bundling is impossible for esbuild's native binary and Playwright's driver, and `typescript` already fails bundling with "Dynamic require of fs" in this repo. Because adding dependencies needs `npm install`, this is **human-bootstrap** work (chain-0).

### D4. Chromium's OS sandbox is always on, and there is no escape hatch
One `browserLaunchOptions()` in `synthrun/session.ts` sets `chromiumSandbox: true`, `headless: true`, the D5 flags, and the D5 proxy. There is no option or environment variable that turns the sandbox off.

On Linux, Chromium's sandbox needs unprivileged user namespaces. In Docker that means the Playwright seccomp profile for the pinned version, vendored as `deploy/seccomp/chromium-playwright-1.60.0.json`, which is Docker's default profile plus the namespace syscalls. On the host it means a kernel that permits userns. The VM runs **Debian 12**, which does not restrict unprivileged userns the way Ubuntu 23.10+ AppArmor does. `vm/bootstrap.sh` asserts it anyway.

When the sandbox cannot start, Chromium refuses to launch. Boot then fails closed (D16).

CI (GitHub `ubuntu-latest`) and the devcontainer must be able to launch the sandboxed browser. If the runner's AppArmor restriction blocks it, the workflow adds `sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0` before the Chromium suites. The devcontainer gains `--security-opt seccomp=<vendored profile>`. Enabling the sandbox is never traded for a disabling flag.

*Alternative:* keep `--no-sandbox` and treat the container as the boundary. Rejected: the server process holds the OpenRouter key in its environment, so a renderer compromise without a sandbox equals key theft (R2 §Risks). gVisor would stack well, but it is heavier than the beta needs and is noted as future hardening.

### D5. No egress, proven out of band, with independent layers
Each HTTP-family layer is sufficient on its own, and each is tested for non-vacuity.

1. **In-memory delivery plus abort-all interception.** `openRun` stops writing `…/synthrun-page-*/<runId>.html` and stops `goto('file://…')` (R2 §A3). Instead a `context.route('**/*')` handler fulfills exactly `https://synthrun.invalid/run/<runId>` with the assembled HTML from memory and aborts every other request. The context is created with `acceptDownloads: false`, and `context.routeWebSocket(/.*/)` closes every socket. Service workers are blocked by two mechanisms: Chromium refuses registration in the candidate's opaque-origin sandboxed iframe, and the abort-all route refuses the worker script fetch for the outer page, which counts as blocked egress. Playwright's `serviceWorkers: 'block'` is rejected because it injects a script into every frame, including the candidate's realm, where it throws and surfaces as a candidate error, and harness code must never run inside that realm. `.invalid` can never resolve (RFC 2606), and `https` keeps the outer page a secure context like `file://` was. The page bytes, CSP, nonce handshake and loader are untouched. Because `file://` is outside interception, no guarantee could be proven for it at all. With an `https` origin, a frame's self-navigation to `file://` or `http(s)` is either blocked by Chromium or intercepted and aborted.
2. **Dead proxy.** Launch with `proxy: { server: 'http://127.0.0.1:9', bypass: '<-loopback>' }`, so anything that escapes interception is sent to a closed port, loopback included.
3. **Resolver and UDP.** `--host-resolver-rules=MAP * ~NOTFOUND` and `--force-webrtc-ip-handling-policy=disable_non_proxied_udp` (WebRTC is not covered by CSP, R2 §A4), plus `--dns-prefetch-disable`.
4. **Host.** On the VM, the egress firewall drops container traffic to `169.254.169.254` and to private ranges, and allows only TCP 443 and DNS (D17).

Aborted requests increment a bounded counter in the run trace. URLs are never recorded, following the forgery-echo rule. The hostile-candidate canary test lives in `synthrun/test/` (browser suite, gate-full), because `invariants/` is owner-authored and Class-2 (R2 §Constraints). Mirroring it into `invariants/` is recorded as an owner follow-up.

Build-side, `synthrun/builder.ts` gains an esbuild `onResolve` plugin: the three externals stay external, the entry and the inject shim resolve, and everything else fails with a named error. `checks/passes/import-allowlist.ts` adds `ExportDeclaration.moduleSpecifier` and `ImportEqualsDeclaration`. Either layer alone closes the file-read path (R2 §A6).

### D6. Spend controls and their public-beta defaults
The primary controls are the **per-device daily generation limit** and the **global admission caps** (concurrency plus a global daily ceiling). A dedicated OpenRouter key with a provider-side credit limit is the hard backstop. Device UUIDs are free to mint, so per-device limits only shape honest heavy use. The global daily ceiling is what bounds a UUID-rotating attacker.

**Cost model (to be replaced by ledger data in week 1).** The engineer system prompt is about 15k tokens (research.md proposer notes).

| Run | Engineer calls | Input tokens | Output tokens (incl. reasoning) | Cost at $0.50/M in, $2.00/M out |
|---|---|---|---|---|
| Typical | ~3 (plan, generate, ≤1 repair, plus summariser) | ~50k | ~15k | ≈ $0.055 |
| Worst case (2 plans, 4 candidates) | ~6 | ~110k | ~50k | ≈ $0.155 |

The prices are placeholders in DeepSeek's historical range, since `deepseek-v4-pro` pricing is not verified. Budget **$0.20 per generation** as the planning ceiling, including the policy check. Clarify and rewrite on the flash model cost about $0.001 each, and a policy check about $0.0005.

| Control | Default | Why |
|---|---|---|
| Generations per device per UTC day | 15 | One app with a few edits is 5–8 generations, so 15 lets an engaged tester build two apps in a day. Worst case per device is 15 × $0.20 = $3/day. |
| Global generations per UTC day | 400 | Worst case 400 × $0.20 = $80/day, typical ≈ $22. Throughput at the concurrency cap is about 36/h ≈ 860/day, so the ceiling, not the VM, binds spend. Raise it for demo night via env. |
| Concurrent generations (global) | 3 | e2-standard-2 has 2 vCPU and 8 GB. Generations mostly wait on the model, and the CPU-bound part is the synthetic run. |
| Synthetic-run contexts | 2 | Two concurrent renders plus sweeps keep watchdog budgets honest on 2 vCPU. A third generation waits in the semaphore, not in a timed-out mount. |
| Clarify / rewrite per device per day | 60 / 60 | Four times the generation limit to allow re-phrasing. Worst case ≈ $0.12/device/day. |
| Concurrent clarify+rewrite (global) | 16 | Network-bound calls. Bounds sockets and memory, not spend. |
| Reports per device / global per day | 10 / 300 | Bounds disk under UUID rotation: 300 × ~0.3 MB ≈ 90 MB/day worst case, and retention caps the total. |
| Body caps (unary / generate / report) | 64 KiB / 1 MiB / 512 KiB | Real prompts are under 5 KB and generated sources 5–30 KB. Edits re-send source, manifest and schemas. |
| Prompt / report source caps | 16 KiB / 256 KiB | Plan-row prompts run 3–5 KB. |
| Generation wall clock / unary model timeout | 10 min / 60 s | Honest runs take minutes (demo generations about 6 min). Stalled providers must not hold slots. |

**Recommended OpenRouter key credit limit: $50 to start.** The global daily ceiling, not the credit limit, is the control that shapes day-to-day spend — the limit is a coarse backstop against the ceiling being misconfigured or bypassed, not the primary lever. $50 covers roughly two days at the worst-case ceiling, enough to catch a bad deploy before it burns real money, and it is raised once `whim-admin usage` shows real cost per generation instead of the placeholder table above.

*Alternatives:* per-IP limits. Rejected: carrier-grade NAT makes an IP a crowd, and trusting `X-Forwarded-For` adds a spoofing surface. A short-window burst limiter was also rejected, because it would need a refusal code outside the decided set, and the daily cap already bounds cost.

### D6a. Pre-admission credit check, cached and fail-open
The provider credit limit (D6) is a backstop, not a checked control — nothing before this stopped the server from admitting work once it was exhausted, so every in-flight request past that point failed at the model call, mid-stream, after the device had already committed to a wait. `server/src/admission/credit.ts` adds a route-agnostic check ahead of drain, concurrency, and daily-unit accounting on `/v1/clarify`, `/v1/rewrite`, and `/v1/generate`: it reads `GET https://openrouter.ai/api/v1/key`, caches `data.limit_remaining` in memory for `WHIM_CREDIT_CACHE_TTL_MS` (default 60000), and refuses with `budget_exhausted` when the cached value is a number below `WHIM_MIN_CREDIT_USD` (default 0.50).

The cache exists because the key endpoint is an extra network round-trip the admission path cannot afford on every request; a minute of staleness is an acceptable trade against that cost, and a mid-flight `402` (D-below) invalidates it immediately rather than waiting out the TTL.

The lookup fails open: a transport error, non-2xx status, or malformed body admits the request and logs a warning instead of refusing. This is the opposite of the content-policy check's fail-closed default, and the asymmetry is deliberate — content policy protects against a reputational and legal risk with no other backstop, where refusing safely is more important than staying available; the credit check protects against spend that the provider's own `402` already catches, so failing closed here would trade a rare lookup outage for taking down the whole service over a control that is redundant with the provider's own enforcement.

### D6b. A 402 mid-flight ends the request and invalidates the cache
A `402` from OpenRouter during a unary call (clarify or rewrite) maps to the same `503 budget_exhausted` the pre-admission check would have produced, rather than the generic `502` honest failure. During a generation stream it ends the run the same way every other ending does — one terminal `failure` event — with no repair attempt, because a repair spends more of an already-exhausted budget. Either path invalidates the credit-check cache immediately, so the next request refuses up front instead of being admitted into a run that will also fail.

### D7. The request ledger lives in the usage store
The existing store is the only durable state and is enforced against (R3 §Constraints), so admission reads and writes it rather than a second store. `usage.db` gains a table:

`requests(id TEXT PK, device_id TEXT, kind TEXT, utc_day TEXT, started_at INTEGER, ended_at INTEGER, outcome TEXT, prompt_tokens INTEGER, completion_tokens INTEGER, cost_usd REAL, cost_state TEXT CHECK(cost_state IN ('pending','resolved','unresolved')), refunded INTEGER DEFAULT 0)`

It is indexed on `(utc_day, kind, device_id)`. The WAL journal and `busy_timeout` let the CLI read while the server writes.

`UsageStore` grows:

- `admit({deviceId, kind, now, deviceLimit, globalLimit?}) → {ok:true, requestId} | {ok:false, reason:'device'|'global', retryAfterSec}`. One `BEGIN IMMEDIATE` transaction counts the non-refunded rows and inserts. `node:sqlite` is synchronous, so the check and the insert run in one JS turn, which is atomic against concurrent requests.
- `refund(requestId)`
- `settle(requestId, {outcome, usage?})`
- `recordCost(requestId, {state, costUsd?})`
- `summary(...)` and `purgeLedger(beforeDay)`

`InMemoryUsageStore` mirrors all of it for tests.

Outcomes are `delivered | failed | aborted | expired | refused | unavailable | ok | error`.

**One resolver for cost and reconciliation.** `server/src/usage/resolve.ts` generalises `reconcileAbortedUsage` (R2 §B8). After any request ends, it takes the request's recorded generation ids: the policy call, the unary call, and every pipeline call. It fetches stats with a per-attempt `AbortSignal.timeout`, bounded attempts and a total budget, then sums `total_cost` onto the row. It credits reconciled tokens only when the in-stream `usage` was never credited (`creditOwned`, #56 D9). It runs detached from the response and is tracked, so drain can give it a final window. Clarify and rewrite gain generation-id capture, so an aborted or timed-out unary call still gets its cost recorded (answers R2 open question 5 for cost; token credit for an aborted unary call follows the same `creditOwned` rule).

*Alternative:* OpenRouter's inline `usage.include` cost. It has no data for aborted streams and would create a second cost path. The stats endpoint covers every case and is authoritative.

### D8. Admission module, ordering and hints
`server/src/admission/` holds:

- `config.ts`: the typed, frozen env config for D6 and D13, with named errors.
- `slots.ts`: in-memory slot controller with per-device generation exclusivity, the global generation cap, the global unary cap, and a `draining` flag. `acquire` returns a handle whose `release()` is idempotent.
- `refusals.ts`: builds `ApiError` bodies and `Retry-After` values from an injectable clock.
- `admit.ts`: the ordered pipeline from the spec's "Admission checks run in a fixed order" requirement.

Body caps use Hono core's `hono/body-limit` middleware per route, part of `hono` with no new dependency. It counts streamed bodies without `Content-Length`, and its `onError` returns the 413 `ApiError`. The prompt byte cap runs after validation.

For `/v1/generate`, the slot handle is released from the SSE stream's single teardown path: terminal event, cancel, `Request.signal`, error, budget expiry, or drain abort. The fast suite checks slot counts after each path.

Hints (server-owned, one sentence each):

| Refusal | Hint |
|---|---|
| `payload_too_large` | "That request is too long. Try a shorter description." |
| `daily_limit` | "You've reached today's limit on this device. It resets at midnight UTC." |
| `device_busy` | "This device is already building an app. Try again when it finishes." |
| `server_busy` (capacity) | "Whim is busy right now. Please try again in a few minutes." |
| `server_busy` (global ceiling) | "Whim has reached today's building capacity. Please try again after midnight UTC." |
| `content_policy` | "Whim can't make that kind of app. Try describing something else." |
| `policy_unavailable` | "We couldn't check this request right now. Please try again in a moment." |
| `budget_exhausted` | "Whim has used up its generation budget for now. Try again later." |

`ServiceRefusalCode` in the contract names the seven identifiers, so the device side can match on a shared vocabulary. `ApiError` is unchanged.

### D9. Content policy: a cached, fail-closed classifier on the rewrite model
`server/src/policy/` holds four pieces:

- `ContentPolicy` interface: `check(input, signal) → Promise<'allow' | {refuse: category}>`, throwing `PolicyUnavailableError`.
- `ModelContentPolicy`: roster `rewrite` id, `reasoning: false`, `maxTokens: 48`, timeout `WHIM_POLICY_TIMEOUT_MS`.
- `StubContentPolicy`: the markers from the spec.
- `cachedPolicy`: an LRU of 1000 entries with a 15-minute TTL, keyed by SHA-256 of the canonical JSON input, which never caches unavailable.

The system message is a fixed frame plus the categories section of `docs/content-policy.md`, read at run time exactly like `sdk-reference.md` (R1 §3) and carried in the runtime tree. The user message wraps the canonical input in a delimited data block and says the text is to be judged, never obeyed. The verdict goes through `json-block.ts` (R3 §Relevant files), then a hand-written structural guard. Anything else is unavailable.

The rewrite and engineer system prompts append the document's rating-rule section verbatim. The prompt suite's single-source tripwires (generation-pipeline "Prompt assembly has one source of truth") extend to it.

**Latency and cost.** A flash-class model returning under 20 tokens adds about 0.5–1.5 s per uncached check. Clarify and rewrite of the same text hit the cache. Generate checks the final prompt once. Input is about 1.2k tokens of policy plus a typical 50–400 tokens of user text, roughly $0.0003–0.001 per check. That is three checks per app, under 2% of a $0.055 typical generation.

*Alternatives:*
- A keyword list: brittle, easy to evade, high false-positive rate.
- A third-party moderation API: adds a provider, key, DPA and privacy disclosure, and its categories don't map to a 13+ app rating.
- The engineer model: slower and costlier for the same judgment.
- Checking app source: large inputs, and the source came from a checked prompt. A modified client could smuggle text through it, and that residual risk is accepted, with reports as the backstop.

### D10. Reports: a separate SQLite file with secure deletion
`server/src/reports/store.ts` defines `ReportStore` (`insert`, `list`, `get`, `purgeOlderThan`) and `NodeSqliteReportStore` on `WHIM_DATA_DIR/reports.db`. The database uses the WAL journal and `PRAGMA secure_delete=ON`, so purged content is overwritten rather than left in free pages. The data directory is created with mode `0700` and the process umask is `0077`.

`reportId = crypto.randomUUID()`. Purge runs at boot and hourly on an unref'd timer. The route is `server/src/routes/report.ts`, mounted with `app.route('/v1/report', …)`, so the prefix gate covers it by construction (R3 §Constraints). There is no policy check and no model call.

Keeping reports out of `usage.db` makes "the usage database holds no content" a file-level property a test can assert. `docs/decisions.md` records reports as the only exception to Model 1 (#33).

### D11. One operator command
`server/src/admin/cli.ts` provides:

- `reports list [--since N] [--limit N] [--json]`
- `reports show <id> [--json]`
- `reports purge`
- `usage [--days N] [--top N] [--json]`

It opens the stores read-only except for `purge`. In production it runs as `docker compose exec whim-server node server/whim-admin.mjs …`. In dev it runs as `node server/admin.mjs …`, a runner that bundles the CLI like dev.mjs. No npm script is added, which avoids a Class-1 edit.

### D12. Abort is provable and bounded
**Fast suite (`server/test/disconnect.suite.ts`).** `serve()` the app on `127.0.0.1:0` with a scripted model whose transport blocks until its signal aborts. A raw `net.Socket` posts a generate request, reads the first SSE event, and calls `destroy()`. The test then polls for up to 5 s:

- the transport's signal is aborted
- the device and global generation slots are free
- a follow-up generation from the same device is admitted

It also does the same for clarify.

**Browser suite (`server/test/e2e.ts`).** Same socket procedure against the real synthrun session, with a candidate whose mount hangs. Assert the session has no open context and a free slot within 5 s.

**synthrun changes.** Abortable acquisition in `concurrency.ts` removes the waiter. `openRun` checks the signal before creating a context and races `goto` against it. `awaitMount` races the signal. `withTotalBudget` is unchanged.

This supersedes #56 D8's "threaded, not raced" for those three waits and brings the code into line with generation-pipeline's existing "inside every waiting operation" wording (R2 §Constraints). esbuild and the synchronous static check stay unraced: both are bounded by the body and output caps and finish in milliseconds.

### D13. Bounded lifetimes
The machine gets a deadline from the injectable clock (`WHIM_GENERATION_MAX_MS`). On expiry it aborts an internal controller linked to the request signal and records the cause as `expired`. It then emits `usage` plus one `failure` with reason "This took too long to build. Please try again." A client abort first leaves the cause `aborted`, and nothing is emitted.

Clarify and rewrite combine `c.req.raw.signal` with `AbortSignal.timeout(WHIM_UNARY_MODEL_TIMEOUT_MS)` and keep their existing honest `502`. The summariser keeps its 20 s bound (R2 §B11).

### D14. Crash replacement
`SynthRunSession` listens for `browser.on('disconnected')`, fails in-flight runs with a named `browser_disconnected` harness error (a pipeline internal error, so one `failure`), and relaunches lazily under a mutex before the next `openRun`. A failed relaunch errors that run and retries on the next one.

### D15. Attestation-ready identity seam
`server/src/device-identity.ts` exports this interface:

```ts
interface DeviceVerifier {
  verify(headers: Headers): Promise<
    | { ok: true; deviceId: string }
    | { ok: false; status: 400 | 401 | 403; body: ApiError }
  >;
}
```

The default is `shapeOnlyVerifier` (today's UUID check and `DeviceIdError` 400). `createApp` accepts `deviceVerifier`. The `/v1/*` middleware calls it and sets `deviceId`, and routes, admission and metering read only that.

An App Attest or Play Integrity verifier can later validate an assertion header and map it to a verified key id, turning `x-whim-device` from shape-checked into verified, with no route changes.

### D16. Drain and boot
`main.ts` becomes a thin shell over `server/src/lifecycle.ts`: load config, then preflight, then open stores, then launch the session and run the self-test (real pipeline only), then listen.

**Self-test.** Run `fixtures/tip-splitter.app.tsx` (a curated few-shot, already zero-diagnostic by tripwire) through `runCandidate` and require `contained === true` and no error diagnostics. From a harness context, navigate to `http://127.0.0.1:9/` and require it to be blocked, with the trace counter incremented. Exit 1 with a named reason on any failure.

**Drain on SIGTERM/SIGINT.**

1. Set `draining`, then `server.close()` and `closeIdleConnections()`.
2. Await tracked in-flight requests until `WHIM_DRAIN_TIMEOUT_MS`.
3. Abort the rest through their controllers.
4. Await resolvers for up to 10 s.
5. `closeAllConnections()`, close the session and stores, `exit(0)`.

A second signal jumps to step 3.

Compose `stop_grace_period` is `11m`. For an urgent deploy, `WHIM_DRAIN_TIMEOUT_MS` can be lowered in the VM's env file.

### D17. Deployment topology
**VM.** Debian 12 on e2-standard-2 in northamerica-northeast1, with a static external IP. A 20 GB pd-balanced persistent disk is mounted at `/mnt/disks/whim-data` and holds `server/` (uid 10001, 0700) and `caddy/`. The service account `whim-vm` has only `artifactregistry.reader`, `logging.logWriter` and `monitoring.metricWriter`, and no Secret Manager access. Firewall allows tcp:80, tcp:443 and udp:443 from anywhere, and SSH only from the IAP range.

**Build and registry.** Artifact Registry repo `whim` (docker) in the same region. The image is built by Cloud Build (`deploy/cloudbuild.yaml`, native amd64; building on Apple Silicon would need emulation of the whole `npm ci`), tagged `:<git-sha>`, with root `.gcloudignore` excluding `node_modules`, `android`, `ios`, `.git`, `.claude`, and similar.

**Compose (`deploy/compose.yaml`).**

- `whim-server`:
  - image `${WHIM_IMAGE}`
  - `env_file: /etc/whim/server.env` (root 0600, written by deploy from Secret Manager) and `/etc/whim/limits.env` (non-secret overrides)
  - `init: true`, `user: "10001:10001"`, `read_only: true`, `tmpfs: /tmp:size=512m`
  - `shm_size: 1gb`, `pids_limit: 1024`, `mem_limit: 6g`, `cap_drop: [ALL]`
  - `security_opt: [no-new-privileges:true, seccomp=./seccomp/chromium-playwright-1.60.0.json]`
  - volume `/mnt/disks/whim-data/server:/data`, `WHIM_DATA_DIR=/data`
  - `restart: unless-stopped`, `stop_grace_period: 11m`
  - json-file logging (10 MB × 5), healthcheck via `node -e` fetch of `/healthz`, no published ports
- `caddy`:
  - image `caddy:2.x` pinned by digest
  - ports 80, 443, 443/udp
  - volume `/mnt/disks/whim-data/caddy:/data`
  - `WHIM_API_HOST` from `/etc/whim/deploy.env`

**Caddyfile.** `{$WHIM_API_HOST} { request_body { max_size 2MB } reverse_proxy whim-server:8787 { flush_interval -1 } }`, with no `encode` and no `log`. The default hostname is `api.<ip-with-dashes>.sslip.io`. Switching to `api.whim.<domain>` is a one-line env change plus DNS.

**Egress firewall.** Compose declares a fixed bridge subnet (`172.31.250.0/24`) so the host rules can name it. `deploy/vm/whim-egress.sh` plus a systemd unit ordered `After=docker.service` inserts `DOCKER-USER` rules for traffic sourced from that subnet, in order:

1. Allow established and related traffic.
2. Allow destinations inside the subnet itself. Bridged container-to-container traffic, Caddy to server, crosses FORWARD once `br_netfilter` is on.
3. Drop `169.254.169.254`, RFC1918, 100.64/10 and link-local.
4. Allow tcp:443 and DNS to anything else.
5. Drop the rest.

Docker's embedded DNS forwards from the host namespace, so container DNS still works.

**Scripts.** `deploy/provision.sh` (idempotent `gcloud`, run by the orchestrator, never by a task), `deploy/vm/bootstrap.sh`, `deploy/deploy.sh [--tag <sha>]`, and `deploy/smoke.sh`.

*Alternatives:* Container-Optimized OS (no compose plugin, harder bootstrap), Ubuntu 24.04 (AppArmor userns restriction fights D4), Cloud Run (ruled out by the launch decision).

### D18. Tests and gates: no gate edits
New fast suites (admission, policy, reports, ledger and resolver, config, disconnect, production build, deploy config) register through `server/test/acceptance.ts`'s explicit import list (R1 §1). Browser tests extend `server/test/e2e.ts` (gate-full:41) and `synthrun/test/` (gate-full:35). The deploy tripwire also runs `bash -n` over `deploy/**/*.sh`.

Nothing edits `scripts/gate*.sh`, `invariants/`, `build/`, or `.claude/**`. The only protected-file edits are `server/package.json` and `package-lock.json` (chain-0), plus a possible `knip.json` workspace entry (chain-0 contingency).

### D19. Records
The change also:

- appends `docs/decisions.md` #64: public server posture, sandbox-on and no-egress, spend controls, the reports exception to #33, and superseding #56 D8 for three waits
- rewrites the generation-server spec's Purpose line ("LAN dev only…")
- updates the `docs/capabilities.md` generation-server row and adds four rows
- adds a README pointer to `docs/deploy.md`
- fixes the stale e2e header comments (R2 §B9)

## Risks / Trade-offs

- **[A host or CI runner cannot create Chromium's user-namespace sandbox]** → boot fails closed. Bootstrap asserts userns. CI adds the documented sysctl, and the devcontainer gets the seccomp profile. Never `--no-sandbox`.
- **[In-memory delivery at `https://synthrun.invalid` changes page origin and perturbs harness behavior]** → the whole existing synthrun and e2e suites must stay green unchanged (a spec scenario). If one breaks, the chain halts and escalates instead of weakening a guard.
- **[CPU contention on 2 vCPU causes false `mount_timeout` failures]** → synthrun concurrency 2, generation cap 3, and an attended load check in the acceptance task. Limits are env-tunable without a rebuild.
- **[UUID rotation bypasses per-device limits]** → the global daily ceiling and the provider credit limit. Attestation (D15) is the real fix, post-beta.
- **[Classifier false positives or prompt injection]** → a generic hint, a content-free refusal log with category counts, the policy doc is editable without code, and reports are the backstop.
- **[sslip.io hostnames share Let's Encrypt rate limits]** → Caddy falls back to ZeroSSL automatically, certs persist on the disk, and the cutover to `api.whim.<domain>` happens as soon as DNS exists.
- **[Up to 10.5 min drains slow deploys; single VM means brief downtime at restart]** → accepted for the beta. The drain timeout is overridable, and the runbook documents it.
- **[Cost estimates are assumptions]** → the ledger measures real cost from day one. The runbook's week-1 step recalibrates the ceilings.
- **[A slow SSE reader makes the server buffer]** (R2 §B7) → bounded by the pipeline's output bounds. Noted, not changed.
- **[The vendored seccomp profile drifts from a future Playwright bump]** → the profile's filename carries the version, and the deploy tripwire fails when the lockfile Playwright version differs from that filename.
- **[`npm ci --workspace server --omit=dev` pulls more than the server closure]** → the container smoke step asserts `node_modules` has no `react-native`.

## Migration Plan

1. Human applies chain-0 (dependency pins) on the staging branch. Dispatched chains follow (chains.md).
2. After merge, the orchestrator runs `deploy/provision.sh`, then `vm/bootstrap.sh` over IAP, stores the OpenRouter key in Secret Manager, and sets the provider credit limit.
3. `deploy/deploy.sh` builds, pushes and deploys with the sslip.io hostname. `smoke.sh` must pass.
4. Release builds (sibling change) point at the hostname. DNS cutover later is a one-line `WHIM_API_HOST` change plus a redeploy.

**Rollback:** `deploy.sh --tag <previous-sha>`. The schema changes are additive (new table, new file). An older image ignores them, and no down-migration exists or is needed.

## Open Questions

Each open question has a default, so apply proceeds without waiting.

- **Base image.** Default `node:22-bookworm-slim` plus the pinned Playwright Chromium install (D2). Switching to `mcr.microsoft.com/playwright:v1.60.0-noble` means accepting Node 24 in production only.
- **Limit numbers.** Default is the D6 table. Revisit after one week of ledger data or before demo night (2026-09-24).
- **Whether policy refusals should cost a daily unit.** Default yes (consumed at admission, refunded only for `policy_unavailable`), so refusal spam is bounded.
- **Generation wall-clock budget.** Default 10 min, which is generous against the ~6 min demo generations.
- **Report retention.** Default 90 days for reports and for the ledger.
- **Mirroring the egress canary into `invariants/`.** Default: left as an owner follow-up, since agents cannot edit `invariants/`.
- **Device blocklist for abusive devices (Apple 4.7.1 "block abusive users").** Default not in this change: Whim has no user-to-user surface, and a blocklist without attestation is trivially evaded.
