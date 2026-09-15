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
- A store-installed app can reach `https://api.whim.<domain>` (or an sslip.io stand-in) over TLS with unbuffered SSE, backed by a reproducible, non-root, secret-free image. *(Amended by D20: the real hostnames are the default and the stand-in is gone. D21–D23 add the pages host.)*
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
| Concurrent generations (global) | 3 | e2-standard-2 has 2 vCPU and 8 GB. Generations mostly wait on the model, and the CPU-bound part is the synthetic run. *(Demo-night values: the `event` profile, D25.)* |
| Synthetic-run contexts | 2 | Two concurrent renders plus sweeps keep watchdog budgets honest on 2 vCPU. A third generation waits in the semaphore, not in a timed-out mount. |
| Clarify / rewrite per device per day | 60 / 60 | Four times the generation limit to allow re-phrasing. Worst case ≈ $0.12/device/day. |
| Global clarify+rewrite per UTC day (`WHIM_LIMIT_UNARY_PER_DAY`) | 2000 | ONE ceiling counted across both kinds — a UUID-rotating attacker cannot bound spend on either route alone. Worst case 2000 × $0.001 ≈ $2/day. |
| Concurrent clarify+rewrite (global) | 16 | Network-bound calls. Bounds sockets and memory, not spend. |
| Concurrent `/healthz/sse` probes (`WHIM_LIMIT_PROBE_CONCURRENCY`) | 2 | The probe is anonymous and holds its slot for three seconds, so it gets its OWN pool — enough for a smoke check plus an uptime monitor, small enough that flooding it wedges nothing else. Env-read like its siblings, not a compile-time constant. |
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
*(Amended by D20 for hostnames and the static IP, D21 for the pages site in the Caddyfile, D24 for the env files, which replace `limits.env` and `deploy.env` below, and D25 for the machine type, which now comes from a capacity profile.)*

**VM.** Debian 12 on e2-standard-2 in northamerica-northeast1, with a static external IP. A 20 GB pd-balanced persistent disk is mounted at `/mnt/disks/whim-data` and holds `server/` (uid 10001, 0700) and `caddy/`. The service account `whim-vm` has only `artifactregistry.reader`, `logging.logWriter` and `monitoring.metricWriter`, and no Secret Manager access. Firewall allows tcp:80, tcp:443 and udp:443 from anywhere, and SSH only from the IAP range.

**Build and registry.** Artifact Registry repo `whim` (docker) in the same region. The image is built by Cloud Build (`deploy/cloudbuild.yaml`, native amd64; building on Apple Silicon would need emulation of the whole `npm ci`), tagged `:<git-sha>`, with root `.gcloudignore` excluding `node_modules`, `android`, `ios`, `.git`, `.claude`, and similar.

**Compose (`deploy/compose.yaml`).**

- `whim-server`:
  - image `${WHIM_IMAGE}`
  - `env_file: /etc/whim/server.env` (root 0600, written by deploy from Secret Manager) and `/etc/whim/limits.env` (non-secret overrides)
  - `init: true`, `user: "10001:10001"`, `read_only: true`, `tmpfs: /tmp:size=512m`
  - `shm_size: 1gb`, `pids_limit: 1024`, `mem_limit: 6g`, `cap_drop: [ALL]`
  - `cap_add: [SYS_CHROOT]`, amended by chain-12 (measured): Docker's seccomp profile allows `chroot` only with CAP_SYS_CHROOT, and Chromium's namespace sandbox chroots inside its user namespace, so boot failed at `sys_chroot("/proc/self/fdinfo/")` without it. With it, CapEff=CapPrm=CapAmb=0, NoNewPrivs=1, Seccomp=2, and the self-test passes.
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
New fast suites (admission, policy, reports, ledger and resolver, config, disconnect, production build, deploy config) register through `server/test/acceptance.ts`'s explicit import list (R1 §1). *(The site suite, D23, and the load-test suite, D26, are sub-suites called from `deploy-config.suite.ts`, because `acceptance.ts` belongs to merged chain-1.)* Browser tests extend `server/test/e2e.ts` (gate-full:41) and `synthrun/test/` (gate-full:35). The deploy tripwire also runs `bash -n` over `deploy/**/*.sh`.

Nothing edits `scripts/gate*.sh`, `invariants/`, `build/`, or `.claude/**`. The only protected-file edits are `server/package.json` and `package-lock.json` (chain-0), plus a possible `knip.json` workspace entry (chain-0 contingency).

### D19. Records
The change also:

- appends `docs/decisions.md` #64: public server posture, sandbox-on and no-egress, spend controls, the reports exception to #33, and superseding #56 D8 for three waits
- rewrites the generation-server spec's Purpose line ("LAN dev only…")
- updates the `docs/capabilities.md` generation-server row and adds four rows
- adds a README pointer to `docs/deploy.md`
- fixes the stale e2e header comments (R2 §B9)

### D20. Real hostnames, kept out of server code
The owner's domain is `anycognition.ca`, with DNS at GoDaddy. A records for `api.whim.anycognition.ca` and `whim.anycognition.ca` already point at the reserved static IP `34.118.191.193` (project `anycognition-whim`, region `northamerica-northeast1`). Those names are now the defaults, and the sslip.io stand-in stops being one.

They live in a committed, non-secret `deploy/defaults.env` with the other values every operator shares: `WHIM_GCP_PROJECT`, `WHIM_GCP_REGION`, `WHIM_GCP_ZONE` (`northamerica-northeast1-a`), `WHIM_STATIC_IP`, `WHIM_API_HOST` and `WHIM_WEB_HOST`. The scripts load that file first, then the operator's own values, then the process environment (D24), so any of them can be overridden without editing the repo. Nothing under `server/src/` names a hostname. The server has no reason to know its public name, and the deploy tripwire fails if `anycognition.ca` or `sslip.io` appears there.

Two checks keep the names honest. The deploy refuses unless `WHIM_API_HOST` is `api.` followed by `WHIM_WEB_HOST`, which is the grammar the app derives from its one domain constant (store-launch-compliance D6). Smoke resolves both names before any HTTPS request and fails, naming the record, unless each has an A record equal to `WHIM_STATIC_IP` and no AAAA record. A DNS slip at GoDaddy then reads as a DNS error, not as a failed certificate order two steps later.

`provision.sh` adopts the reserved address by its IP value and never creates one. It fails if no reserved address in the region holds `WHIM_STATIC_IP`.

sslip.io isn't kept as a fallback. DNS exists, and because the hostname is only a variable, a break-glass deploy can still set `WHIM_WEB_HOST=34-118-191-193.sslip.io` and `WHIM_API_HOST=api.34-118-191-193.sslip.io` without any script or runbook path of its own.

*Alternative:* keep sslip.io as the default until a cutover. Rejected. The cutover only existed because DNS didn't, and each day on the stand-in means more exposure to shared Let's Encrypt rate limits and one more runbook step to forget.

### D21. The pages host is a second site on the same Caddy
`whim.anycognition.ca` is served by the Caddy container that already fronts the API, as a second site block keyed on `{$WHIM_WEB_HOST}`. That keeps one VM, one certificate store on the persistent disk, and one proxy to patch. The pages block serves static files and nothing else: no `reverse_proxy`, no `encode`, no `log`, no `templates`. The API block serves no files. Neither host can reach the other's content.

| Path | Response |
|---|---|
| `/.well-known/apple-app-site-association` | the file, `200`, `Content-Type: application/json`; `404` while absent (D22) |
| `/.well-known/assetlinks.json` | the file, `200`, `Content-Type: application/json`; `404` while absent |
| `/privacy` | `privacy.html`, `200` |
| `/support` | `support.html`, `200` |
| `/a/` and everything under it | `app-link.html`, `200` |
| anything else | `not-found.html`, `404` |

Routes rewrite internally to flat files and never use directory indexes. Caddy answers a directory path that lacks its trailing slash with a redirect, and both Apple and Android refuse an association file behind a redirect. Page responses carry `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; img-src 'self'` and `X-Content-Type-Options: nosniff`. The pages have no JavaScript, and the site suite fails on any `<script`.

The rendered site lives under `/mnt/disks/whim-data/site/`, mounted read-only into Caddy, which serves `/srv/site/current`. `deploy.sh` publishes by uploading a complete new release directory next to the live one and swapping the `current` symlink with `mv -T`, so a reader never sees half a site. Caddy reads files per request, so new content needs no reload. A Caddyfile change needs `caddy reload`, which drops no connections.

`deploy.sh --site-only` builds and publishes the site, uploads the Caddyfile, reloads Caddy (or starts it if it isn't running) and runs the pages smoke checks. It builds no image, reads no secret and never touches the server container. Fixing a typo in the privacy policy shouldn't drain a ten-minute generation (D16), and the pages can go live before the first server image exists.

*Alternatives:* a separate static host. Cloud Storage needs a load balancer in front for HTTPS on a custom domain, and GitHub Pages would add a second DNS target and TLS stack for four files. The owner chose the same Caddy, and I agree. A Caddy `templates` directive for the support email was also rejected: rendering at deploy time keeps the served bytes static and lets the suite test exactly what ships (D23).

### D22. Association files come from the release tooling, and the Play fingerprint gates them
The deploy never writes an association file itself. The site build (`node server/site.mjs build`, D23) first checks whether the release has what the files need, meaning both `release/android-upload-cert.sha256` and `release/android-play-signing-cert.sha256` are committed.

- **Both present.** It runs `node scripts/release/run.mjs association-files --out <stage>` (platform-release-readiness D15 and its app-links spec) from the same checkout and copies the two output files, unchanged, into the site's `.well-known/`. A non-zero exit fails the build. With both fingerprints committed, a failure means a malformed fingerprint or missing tooling, never an expected state.
- **Either missing.** The site ships no association file. The build prints `association files: absent (<missing path>); app link verification stays PENDING` and succeeds.

The published site is therefore a function of the commit plus the deploy-time values. There is no directory to hand to ops and no stale copy to forget on the VM. Smoke fetches each file without following redirects and checks `200`, `application/json`, and bytes equal to the build output. When the files are absent, it checks that both paths return `404`.

**Sequencing against the first Play upload.** The Play App Signing fingerprint exists only after the first manual AAB upload (platform-release-readiness task 14.3). Until then the deploy omits `assetlinks.json` entirely rather than serving an upload-key-only file, and Android link verification stays PENDING. I chose omission for three reasons:
- An upload-key-only file verifies nothing anyone installs. Play re-signs every build it distributes, and the local `offline` build is debug-signed, so no planned install is signed by the upload key alone.
- The release command refuses to write assetlinks without the Play fingerprint (its "The Play signing fingerprint isn't recorded yet" scenario). An upload-only file would have to be typed by hand or come from a second code path, and the owner ruled both out.
- A wrong file costs something. Android records a failed verification at install time and retries only on its own schedule or after `pm verify-app-links --re-verify`.

The command writes both files or neither, so the AASA waits too. The order:
1. The first server deploy publishes `/privacy`, `/support` and `/a/*`. Both `.well-known` paths return `404`.
2. PRR 14.1 commits the upload fingerprint. The host doesn't change, because the command still refuses.
3. PRR 14.2 registers the App ID with Associated Domains and creates the App Store Connect record. The AASA doesn't depend on the record: its content is fixed by the team id and bundle id, and Apple's CDN fetches it for any installed build whose entitlement names the host. Serving it before or after the record exists is harmless.
4. PRR 14.3 uploads the first AAB as a draft and commits the Play signing fingerprint. The operator runs `deploy.sh --site-only`, and both files go live with the Play signing fingerprint first.
5. Only after step 4 does the closed-testing release roll out to testers (Android verifies at install), and only then does the first TestFlight build go up (PRR 14.6). Every install that should verify links is made after the files are live. Apple's CDN can take up to a day to pick up a new AASA, so the PRR 13.8 iOS link check runs after that window.

Links also need the app to name this host. `WHIM_DOMAIN` in `release/whim-release.xcconfig` and `src/host/launcher/release-config.ts` must be `anycognition.ca`, and their lockstep suite keeps the two equal. That edit belongs to the platform change. The runbook lists it as a precondition and nothing here makes it.

*Alternative:* ask the release tooling for an AASA-only mode so iOS links can be verified before the first Play upload. Not taken, because it changes another change's spec. It's an open question for the owner.

### D23. Privacy policy and support pages are repo files, checked against the consent screen
The page sources live in `deploy/site/`: `privacy.html`, `support.html`, `app-link.html` and `not-found.html`. Each is plain HTML with one inline style block and no script. `server/src/site/build.ts` renders them, and `node server/site.mjs build --out <dir>` runs it, bundling like `server/dev.mjs`. Rendering substitutes only values that aren't committed, from a closed placeholder set. An unknown placeholder, a missing or malformed required value, or a leftover `{{` fails the build and names the placeholder. Every value is HTML-escaped. The build writes to a temp directory and moves it into place only on success.

| Placeholder | Source | Rule |
|---|---|---|
| `WHIM_SUPPORT_EMAIL` | deploy-time value (D24) | required, no committed default, must parse as an email address |
| `WHIM_APP_STORE_URL`, `WHIM_PLAY_STORE_URL` | deploy-time values | optional `https` URLs on `apps.apple.com` and `play.google.com`; the fallback page leaves out its store-links paragraph when both are unset |

The policy names OpenRouter as the processor and says the models can change, rather than rendering the model ids the server runs with. `WHIM_ENGINEER_MODEL` and `WHIM_REWRITE_MODEL` stay required deploy-time values (D24) — the server runs with them, and `deploy.sh` writes them to `config.env` — but they're server config only, never page placeholders. That means a model switch never requires a policy republish, and it keeps store-launch-compliance's spec text ("third-party AI model providers through OpenRouter", never specific model ids) rather than the stricter default this design originally chose.

**The privacy policy** is committed text with a "Last updated" date. It says:
- AnyCognition Inc. runs Whim, reachable at the support email.
- What leaves the phone, quoting the consent screen word for word: its lead, the "What gets sent" and "What never gets sent" lists, and the footnote. Requests go to AnyCognition's server, which sends them to third-party AI models through OpenRouter. The page names OpenRouter as the processor, not the model ids, and says which models Whim uses can change without notice.
- Reports are sent only when the user taps Send. A report holds the reason, an optional note, and optionally the app's name, prompt and source, stored with the phone's anonymous ID and deleted after 90 days.
- The usage ledger keeps one row per request (anonymous ID, request type, times, outcome, token counts, cost) and no request content, for 90 days.
- Whim has no accounts, no ads, no analytics, crash-reporting or advertising SDKs, and no way for people to share apps or content with each other.
- Server logs hold no request content, and the front proxy keeps no access log.
- Turning AI features off in Settings stops all sending, and apps already on the phone keep working.
- Access and deletion requests go to the support email. Nothing is tied to a name or account, so AnyCognition may not be able to find one person's rows, and reports and ledger rows are gone after 90 days either way.
- The app is rated 13+, and a change to what Whim sends makes the app ask for consent again.

**The support page** gives the support email, how to report an app from inside Whim, how to turn AI features off, and a link to the policy.

**The app-link fallback** tells a browser visitor that the app opens only on the phone that made it (the in-app wording of store-launch-compliance D15, adapted for a web page) and links to both stores when they're configured.

**Parity tripwire.** `server/test/web-site.suite.ts` imports `COPY` from `src/host/launcher/copy.ts` and renders the site with fixture values. It takes the rendered policy's text (tags stripped, entities decoded, whitespace collapsed, U+2019 and `'` compared as the same character). Every `COPY` key that starts with `consent` must appear there verbatim, except a fixed allowlist of screen chrome: `consentTitle`, `consentOutdatedLine`, `consentAgree`, `consentDecline`, `consentReviewKeepOn`, `consentReviewTurnOff` and `consentReviewTurnOn`. The suite names each missing key. Denying by default is what makes the check worth having. A disclosure line added to the consent screen under any new `consent…` key fails the gate until the policy quotes it, while a hand-kept list of required keys would pass without noticing.

The same suite requires the retention periods the policy states to equal `loadServerConfig({})`'s `reportRetentionDays` and `ledgerRetentionDays`. The deploy tripwire forbids either retention variable in every profile and env file, so the server can't keep data longer than the page says.

*Alternatives:* key-phrase matching. Rejected, because it can't tell a reworded disclosure from a changed one, and anyone reviewing the two side by side expects the same words. Serving the policy text from the app's strings at run time was also rejected, since the page has to work in any browser and the app bundle isn't on the VM.

### D24. Deploy-time values and the files that carry them
This supersedes D17's `/etc/whim/limits.env` and `/etc/whim/deploy.env`.

**Operator side**, loaded in this order, later sources winning:
1. `deploy/defaults.env` (committed): project, region, zone, static IP and both hostnames (D20).
2. `~/.config/whim/deploy.env`, outside the repo next to the release credentials the platform change keeps in that directory. It holds `WHIM_SUPPORT_EMAIL`, `WHIM_ENGINEER_MODEL` and `WHIM_REWRITE_MODEL`, and optionally the two store URLs. None of these has a committed default. `deploy/operator.env.example` lists the names only.
3. The process environment.

**VM side**, written by `deploy.sh` (except `loadtest/`, which D26's `run.sh` uploads):
- `/opt/whim/` holds `compose.yaml`, `Caddyfile`, `seccomp/`, `loadtest/` and a compose `.env` with `WHIM_IMAGE`, `WHIM_API_HOST`, `WHIM_WEB_HOST`, `WHIM_PROFILE`, `WHIM_SERVER_MEM_LIMIT` and `WHIM_SERVER_SHM_SIZE`. Compose reads that file for every command run in `/opt/whim`. `compose.yaml` references each value as `${NAME:?}`, so a compose command that misses the file fails and can't recreate containers with blank settings.
- `/etc/whim/config.env` (root, 0600) is the server's non-secret environment: the active profile's server limits (D25) and the two model ids.
- `/etc/whim/server.env` (root, 0600) holds `OPENROUTER_API_KEY` only, from Secret Manager, as in D17.

**A missing key fails the deploy early and loudly.** The owner creates the production OpenRouter key and its credit limit later, and no script creates, rotates or sets either. `provision.sh` still creates only the empty secret. Before Cloud Build starts, `deploy.sh` reads the latest enabled version of that secret with the operator's credentials. If the secret doesn't exist, has no enabled version, or holds an empty value, it exits non-zero naming the secret and the runbook section, and it builds, uploads and restarts nothing. The same preflight names any missing required value from the operator file. `--site-only` skips the key check but still needs the support email, because the policy page renders it; the model ids are required deploy values regardless.

The boot refusal in specs/server-deployment ("A missing key is named at boot") stays as the last line of defense. The deploy check just moves the failure to the operator's terminal instead of a restart loop on the VM.

### D25. Capacity profiles: machine type and limits change together
Concurrency caps refuse with `429 server_busy` instead of queueing (D8), so with about 30 people in the room on demo night, a lack of capacity shows up as refusals. D6's defaults fit e2-standard-2. Raising the caps without a bigger VM trades refusals for watchdog timeouts, and a bigger VM without higher caps still refuses. So both change together as a named profile, a committed file `deploy/profiles/<name>.env`:

| Key | `standard` | `event` |
|---|---|---|
| `WHIM_PROFILE_MACHINE_TYPE` | `e2-standard-2` (2 vCPU, 8 GB) | `e2-standard-8` (8 vCPU, 32 GB) |
| `WHIM_SERVER_MEM_LIMIT` | `6g` | `16g` |
| `WHIM_SERVER_SHM_SIZE` | `1gb` | `3gb` |
| `WHIM_MAX_CONCURRENT_GENERATIONS` | not set (default 3) | `15` |
| `WHIM_SYNTHRUN_CONCURRENCY` | not set (default 2) | `6` |
| `WHIM_MAX_CONCURRENT_UNARY` | not set (default 16) | `32` |

`standard` sets no server limit, so `server/src/config.ts` stays the one source of the defaults. No profile sets a daily limit, the global daily ceiling, a retention period, `NODE_ENV`, `WHIM_PIPELINE`, `WHIM_DEV_LOG_SINK` or a secret, and machine types are unique across profiles. The deploy tripwire checks all of that and runs each profile's server keys through `loadServerConfig`.

**Six synthetic-run contexts on 8 vCPU (an estimate, to be measured by task 15.4).** D6 sizes the standard profile at about one Chromium render per vCPU ("two concurrent renders plus sweeps keep watchdog budgets honest on 2 vCPU"). It accepts that Node, the browser process and Caddy share those cores, because three generations rarely reach their run stage at the same moment. At 15 concurrent generations that stops being rare. Static checks and candidate builds for all 15 run on Node's one main thread, and the browser and GPU processes, esbuild, Caddy's TLS for 15-plus open streams and Docker's log writer all need CPU too. The event profile reserves one vCPU for Node and one for everything else, and keeps one render per vCPU on the other six. Demand fits under that. A generation spends roughly 30 s of its ~6 min in the run stage, so 15 generations need about 1.3 contexts on average. Even the burst after the talk, when everyone taps Build it together, only queues runs in the abortable semaphore (D12), which costs waiting time rather than failures.

**Memory (an estimate, to be measured).** I assume about 400 MB per context (the runtime page, the candidate's isolated sandboxed-iframe renderer and its sweep states), 300 MB for the browser process and 500 MB for Node holding 15 streams, so about 3.2 GB at peak. The standard 6g cap is the 8 GB VM minus room for the OS, Docker and Caddy. The event cap of 16g is half the VM and five times the estimate: a bad guess can't get the server OOM-killed mid-demo, and a runaway still can't starve Caddy or dockerd. Shared memory keeps the standard profile's allowance per context (1 GB for 2 contexts, so 3 GB for 6). tmpfs pages cost memory only when they're used.

The unary cap doubles to 32 because 30 people could all be on the clarify step at once, and those calls are network-bound and a few MB each. The global generation ceiling stays at 400. Even 30 people making ten apps each is 300.

**Profiles follow the machine, not a flag.** `deploy.sh` reads the VM's actual machine type and applies the one profile that names it, and refuses, naming the type, when no profile does. `deploy.sh` has no `--profile` option. No deploy can put event limits on a 2-vCPU VM, and no resized VM can keep its old limits after the next deploy. `provision.sh` creates the VM with the `standard` machine type unless given `--profile <name>`.

**Resizing is a script.** `deploy/resize.sh --profile <name>`:
1. Checks that the region's E2 vCPU quota fits the target type, and changes nothing if it doesn't.
2. Drains with `docker compose stop whim-server`, which sends SIGTERM and waits out the drain (D16). Under `restart: unless-stopped`, a container stopped this way stays stopped across a VM restart, so the server can't come back up on the old limits.
3. Runs `gcloud compute instances stop`, `set-machine-type` and `start`.
4. Confirms the running machine type, then runs `deploy.sh --tag <running tag>`. That writes `/etc/whim/config.env` and the compose `.env` from the profile matching the type, starts the server, waits for health and runs smoke.

If `set-machine-type` or `start` fails, the script starts the VM on whatever type it still has, redeploys the profile for that type, and exits non-zero naming the step that failed. The static IP, the persistent disk and Caddy's certificates all survive a stop and start. E2 prices scale with vCPU and memory, so e2-standard-8 costs four times e2-standard-2 per hour. The runbook resizes up on the day of the event and back down after it.

*Alternatives:* computing the caps from the container's CPU count at boot. Rejected, because the numbers come from measurement and not a formula, and a value computed at boot can't be read in the repo. Queueing instead of refusing stays rejected for D8's reason (it needs a refusal code outside the decided set).

### D26. The load test replays a model in a separate image and can't spend credit
D25's numbers are estimates. Task 15.4 measures them on the event profile without a single OpenRouter call.

**Why the existing modes don't do it.** `WHIM_PIPELINE=stub` exists, but production config refuses it, and it skips the synthetic run, which is the part that decides capacity. The scripted model client lives in `server/test/`, which the production tree doesn't carry.

**The mechanism.** It relies on one seam in chain-11: `lifecycle.ts` exports `startServer({ env, overrides?, listen? })`, whose overrides can replace the model client and roster, the stats transport, the credit transport, and wrap the Hono app. `main.ts` passes no overrides. On top of that seam, `server/src/loadtest/` adds:
- `replay-model.ts`, a `ModelClient` with no network code at all. It answers every call the real pipeline and the real content-policy classifier make with a canned turn. Engineer-role turns wait `WHIM_LOADTEST_ENGINEER_TURN_MS` (default 15000) and rewrite-role turns wait `WHIM_LOADTEST_REWRITE_TURN_MS` (default 1000), so slots are held about as long as a real run's waits and the classifier costs about what D9 estimates. Generated apps rotate across the curated fixtures that pass the static checks with no error, so the run stage sees different screens and sweeps.
- `server.ts`, whose `runLoadtestServer({ env, listen })` refuses to start when `env.OPENROUTER_API_KEY` is set. It swaps `globalThis.fetch` for a function that throws and counts calls, and puts the real one back on stop. It then calls `startServer` with the replay model and roster (`loadtest/engineer`, `loadtest/rewrite`), a stats transport that resolves every id at zero cost, a credit transport that reports no limit, and an outer app whose `/healthz` answers `service: 'whim-server-loadtest'`. The config loader gets `NODE_ENV=production`, the inert key string `loadtest-no-network` and those roster ids, so every other production refusal still applies. Everything else is production code: admission, slots, the ledger, the real policy check (over the replay model), the machine, esbuild, the static checks, the sandboxed synthetic run with its boot self-test, and SSE through Caddy.
- `drive.ts`, the driver, run as `node server/loadtest.mjs`.

The load-test server ships in its own image. `deploy/loadtest/Dockerfile` builds from the production image of the same commit (`whim/server:<sha>`), adds one bundle, `server/loadtest-server.mjs`, produced by `server/loadtest-build.mjs` through chain-11's exported bundling function, and makes it the command. `deploy/loadtest/cloudbuild.yaml` pushes it as `whim/server-loadtest:<sha>`. `deploy/loadtest/compose.loadtest.yaml` overrides only the `whim-server` service: that image, no `server.env`, and `/mnt/disks/whim-data/loadtest` (wiped at start) as `/data`, so synthetic rows never reach production's ledger or daily counts.

**Why it can't burn credit.**
1. The container has no key. The override drops `server.env`, and if a compose merge ever put it back, the server refuses to boot.
2. Nothing in it can make a request. The replay model has no transport, and the `fetch` trap turns any missed override into a loud failure. The browser suite asserts the trap counted zero calls.
3. If both of those failed, the only key present is an inert string OpenRouter would reject.

**Why it can't reach production by accident.**
- No environment variable selects it. It's a different entry point in a different image, so an edit to `/etc/whim/config.env` can't turn it on.
- The production image doesn't contain it. A fast test bundles the production entry with esbuild's metafile and fails if any input comes from `server/src/loadtest/`, and the deploy tripwire fails if `deploy/Dockerfile`, `deploy/cloudbuild.yaml`, `deploy/compose.yaml`, `deploy/deploy.sh` or `deploy/resize.sh` mentions `loadtest`.
- `deploy.sh` always recreates `whim-server` from `compose.yaml` alone, and smoke requires `/healthz` to answer exactly `service: 'whim-server'`. A load-test container someone forgot to stop fails the next deploy's smoke.

**Running it.** `deploy/loadtest/run.sh` has three subcommands:
- `start` refuses unless the checkout is at the deployed tag, builds the load-test image if it's missing, drains and stops the production server, and starts the load-test service under the same name on the same network. Caddy's API site now points at it.
- `drive --devices <N> --cap <C>` samples `docker stats` for the server container on the VM every 2 s over IAP while the driver runs from the operator's machine against `https://$WHIM_API_HOST`, then prints the report.
- `stop` recreates the production server from `compose.yaml` and runs smoke.

The API is down for real users while the load test runs. Before launch there are none, and that's a fair price for measuring the real VM, Caddy and image instead of a copy.

**The driver** starts N synthetic devices at once. Each is a fresh UUID sending one `POST /v1/generate` with a prompt unique to it, so the classifier cache can't hide policy work. It reads every SSE stream to its terminal event and records time to the first event, total time, the terminal type, and any HTTP refusal with its `error` code. When all streams have ended it probes for leaked slots: C generations from fresh devices, each of which must receive its first event before the driver aborts it, then, after 5 s, the same again. A leaked slot shows up as `server_busy` in either round, and the second round also proves aborted streams give their slots back. The report gives p50 and p95 of both timings, counts by terminal type and refusal code, the probe verdict, and the peak CPU and memory from the sampler. The driver exits non-zero on any `failure` terminal, on any refusal when N ≤ C, or on a failed probe.

*Alternatives:*
- A replay selector in `config.ts`, refused under `NODE_ENV=production` like the stub. Rejected: the load test has to run with production's refusals active on the production VM, an env-selectable fake model is exactly the switch someone flips by accident, and it would change chain-1's merged `ServerConfig` contract.
- Pointing the server at a fake OpenRouter through a base-URL variable. Rejected, because in production that variable would send the real key to whatever host it names.
- Real generations on a cheap model. Rejected by the owner's no-spend rule, and a cheap model changes how long runs take anyway.
- A second VM for load testing. Rejected: it measures a copy, and it doubles provisioning for a question asked once before an event.

## Risks / Trade-offs

- **[A host or CI runner cannot create Chromium's user-namespace sandbox]** → boot fails closed. Bootstrap asserts userns. CI adds the documented sysctl, and the devcontainer gets the seccomp profile. Never `--no-sandbox`.
- **[In-memory delivery at `https://synthrun.invalid` changes page origin and perturbs harness behavior]** → the whole existing synthrun and e2e suites must stay green unchanged (a spec scenario). If one breaks, the chain halts and escalates instead of weakening a guard.
- **[CPU contention on 2 vCPU causes false `mount_timeout` failures]** → synthrun concurrency 2, generation cap 3, and an attended load check in the acceptance task. Limits are env-tunable without a rebuild. *(The event profile and the no-spend load test: D25, D26.)*
- **[UUID rotation bypasses per-device limits]** → the global daily ceiling and the provider credit limit. Attestation (D15) is the real fix, post-beta.
- **[Classifier false positives or prompt injection]** → a generic hint, a content-free refusal log with category counts, the policy doc is editable without code, and reports are the backstop.
- **[sslip.io hostnames share Let's Encrypt rate limits]** → Caddy falls back to ZeroSSL automatically, certs persist on the disk, and the cutover to `api.whim.<domain>` happens as soon as DNS exists. *(Superseded by D20: DNS exists and the real names are the default.)*
- **[The event profile's numbers are wrong]** → they're marked estimates, task 15.4 measures them under a 15-device load before demo night, and a change is an edit to `deploy/profiles/event.env` plus a redeploy, with no image rebuild.
- **[A resize fails halfway and leaves the API down]** → `resize.sh` checks quota before stopping anything, and on any later failure starts the VM on its current type with that type's profile (D25).
- **[The privacy policy drifts from what the app discloses]** → the verbatim parity tripwire with a deny-by-default key rule, plus retention parity with the config defaults (D23).
- **[Association files go live after an install that needed them]** → D22's order puts the site publish before the closed-testing rollout and the first TestFlight build, and the runbook repeats it. A device installed earlier needs `pm verify-app-links --re-verify` or a reinstall.
- **[The consent copy gains a `consent…` key in another change]** → that change's regate fails on the parity tripwire until `deploy/site/privacy.html` quotes it. That's intended, and chains.md warns the other chains.
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

*(Steps 3–4 amended by D20 and D22: the first deploy uses `api.whim.anycognition.ca` and `whim.anycognition.ca` from `deploy/defaults.env`, with no cutover. It publishes the pages without association files. Those go live with `deploy.sh --site-only` once the Play signing fingerprint is committed, before the closed-testing rollout and the first TestFlight build. Before demo night: `resize.sh --profile event`, the load test (task 15.4), and `resize.sh --profile standard` after the event.)*

**Rollback:** `deploy.sh --tag <previous-sha>`. The schema changes are additive (new table, new file). An older image ignores them, and no down-migration exists or is needed.

## Open Questions

Each open question has a default, so apply proceeds without waiting.

- **Base image.** Default `node:22-bookworm-slim` plus the pinned Playwright Chromium install (D2). Switching to `mcr.microsoft.com/playwright:v1.60.0-noble` means accepting Node 24 in production only.
- **Limit numbers.** Default is the D6 table. Revisit after one week of ledger data or before demo night (2026-09-24). *(Demo night: the `event` profile, D25, measured by task 15.4.)*
- **Whether policy refusals should cost a daily unit.** Default yes (consumed at admission, refunded only for `policy_unavailable`), so refusal spam is bounded.
- **Generation wall-clock budget.** Default 10 min, which is generous against the ~6 min demo generations.
- **Report retention.** Default 90 days for reports and for the ledger.
- **Mirroring the egress canary into `invariants/`.** Default: left as an owner follow-up, since agents cannot edit `invariants/`.
- **Device blocklist for abusive devices (Apple 4.7.1 "block abusive users").** Default not in this change: Whim has no user-to-user surface, and a blocklist without attestation is trivially evaded.
- **Support contact email.** Not decided. Default: `WHIM_SUPPORT_EMAIL` is required at deploy time with no committed default, so the pages can't publish until the owner picks one (D23, D24).
- **Production model pair.** Not decided (see the backlog item on choosing models for public cost). Default: `WHIM_ENGINEER_MODEL` and `WHIM_REWRITE_MODEL` are required deploy-time values with no committed default; the policy page names OpenRouter, never the deployed models.
- **AASA before the first Play upload.** Default: no. Both association files go live together once the Play signing fingerprint is committed, because the release command writes both or neither (D22). An AASA-only mode would be a platform-release-readiness change.
- **Hostnames committed in `deploy/defaults.env`.** Default: yes, because they're public DNS names and the deploy is reproducible from the repo. If the owner wants no domain literal in the repo, both move to `~/.config/whim/deploy.env` and nothing else changes.
- **VM zone.** Default `northamerica-northeast1-a`. The reserved IP is regional, so any zone in the region works.
- **Store links on the app-link fallback.** Default: none until the listings are public. `WHIM_APP_STORE_URL` and `WHIM_PLAY_STORE_URL` add them without a code change.
- **Provider credit on demo night.** The owner sets the key's credit limit. The $50 starting limit (D6) covers roughly 250 worst-case generations, fewer than the 400 daily ceiling. Default: no script touches it, and exhaustion refuses cleanly with `budget_exhausted` (D6a).
- **Event profile numbers.** Default: the D25 table, marked as estimates until task 15.4 measures them.
