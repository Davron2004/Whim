# Research digest: what does taking the generation server from LAN dev to a public, abuse-resistant GCP service touch?

<!--
  The question was too broad for one 120-line digest, so it was split into three focused
  researcher dispatches run in parallel on 2026-09-14. Each digest below is that researcher's
  final message, pasted verbatim (HTML entities from the transport restored to their
  characters; one conversational preamble line dropped from R1). Cited from design.md as
  R1 §section, R2 §section, R3 §section.

  R1 — production packaging terrain (dev.mjs, deps, runtime file reads, gate wiring)
  R2 — synthetic-run network/sandbox reach and the real abort path
  R3 — request handling, usage store, model seam, tests (limits/policy/report attach points)

  Proposer verification notes (main thread, targeted greps, not a crawl):
  - usage.db has exactly one table, `usage(device_id PK, prompt_tokens, completion_tokens,
    total_tokens)` (server/src/usage-store.ts:57-62). No cost field exists anywhere in
    server/src or contract/src (grep for `cost`/`total_cost` — no hits). Per-request cost is
    NOT recorded today.
  - OpenRouter's GET /api/v1/generation returns `total_cost` in USD plus token counts
    (openrouter.ai/docs/api-reference/get-a-generation, fetched 2026-09-14).
  - The Playwright v1.60.0 Docker image (`utils/docker/Dockerfile.noble` at tag v1.60.0) installs
    Node **24** (`ARG NODE_VERSION=24`), while CI pins Node 22
    (.github/workflows/invariants.yml:28,56) and the devcontainer is `node:22-bookworm`.
  - Configured roster (local .env, model-id lines only): rewrite `deepseek/deepseek-v4-flash-0731`,
    engineer `deepseek/deepseek-v4-pro-0813`. docs/sdk-reference.md is 16.6 KB; the five
    few-shot fixtures total ~40 KB — roughly 15k tokens of system prompt per engineer call.
-->

---

# R1 — Research digest: run the generation server as a production container process instead of via server/dev.mjs

## Relevant files
- `/Users/davrondjabborov/Work/other/Whim/server/dev.mjs` — esbuild-bundle-then-import dev runner; not a production entry point
- `/Users/davrondjabborov/Work/other/Whim/server/src/main.ts` — composition root (port/bind, pipeline selection, shutdown)
- `/Users/davrondjabborov/Work/other/Whim/server/src/app.ts` — Hono app, `x-whim-device` gate
- `/Users/davrondjabborov/Work/other/Whim/server/src/usage-store.ts` — `node:sqlite`-backed durable usage store
- `/Users/davrondjabborov/Work/other/Whim/server/src/generation/prompts/inputs.ts` — reads `docs/sdk-reference.md` + `fixtures/*.app.tsx` from disk at runtime
- `/Users/davrondjabborov/Work/other/Whim/server/src/generation/index.ts` — `buildModelDepsFromEnv`, `OPENROUTER_API_KEY` read
- `/Users/davrondjabborov/Work/other/Whim/server/src/generation/machine.ts`, `stages/build.ts`, `stages/check.ts` — runtime imports into `checks/`, `synthrun/`
- `/Users/davrondjabborov/Work/other/Whim/synthrun/session.ts` — Playwright `chromium.launch()`, one session per process
- `/Users/davrondjabborov/Work/other/Whim/synthrun/builder.ts` — esbuild candidate build (externals `vc-sdk`/`react`/`react-dom`)
- `/Users/davrondjabborov/Work/other/Whim/synthrun/page.ts` — reads `src/runtime/generated/runtime-artifacts.json`, imports `build/assemble.mjs`
- `/Users/davrondjabborov/Work/other/Whim/synthrun/concurrency.ts` — `DEFAULT_CONCURRENCY = 4` semaphore
- `/Users/davrondjabborov/Work/other/Whim/server/test/run.mjs`, `e2e.run.mjs`, `acceptance.ts` — Node test runners (explicit-import suite list, not glob)
- `/Users/davrondjabborov/Work/other/Whim/scripts/gate.sh:61`, `/Users/davrondjabborov/Work/other/Whim/scripts/gate-full.sh:41` — gate wiring
- `/Users/davrondjabborov/Work/other/Whim/.devcontainer/Dockerfile` — the repo's only Dockerfile; fix-loop harness, not a server deploy artifact
- `/Users/davrondjabborov/Work/other/Whim/openspec/specs/generation-server/spec.md:8-9,21` — governing spec text: "LAN dev only — no deployment or TLS yet"
- `/Users/davrondjabborov/Work/other/Whim/docs/v1-roadmap.md:299` — "deployment/TLS (LAN dev only)" listed as explicitly Out of scope

## Current behavior

**1. Runners.** `server/dev.mjs` (`/Users/davrondjabborov/Work/other/Whim/server/dev.mjs:27-39`) esbuild-bundles `server/src/main.ts` → a temp file `server/.dev-server.<pid>.tmp.mjs` (platform `node`, format `esm`, target `node22`, `bundle:true`, no sourcemap option set, no banner), external: `['node:*','hono','@hono/node-server','@hono/*','esbuild','playwright','typescript','pino']`, then `import()`s the temp file to start the server; SIGINT/SIGTERM handlers just delete the temp file and `process.exit(0)` — no drain logic of their own (shutdown logic actually lives in `main.ts`). Env is passed only via `npm run server:dev` → `"node --env-file-if-exists=.env server/dev.mjs"` (package.json:29) — Node's built-in `--env-file-if-exists` flag, not a dotenv package; `dev.mjs` itself reads no env file.

`server/test/run.mjs` first runs `tsc --noEmit` over `contract/tsconfig.json` and `server/tsconfig.json` (resolving `tsc` via `createRequire` so it also works from a worktree with no local `node_modules`), then esbuild-bundles `server/test/acceptance.ts` (external: `['typescript','esbuild','pino']`) and imports it, forcing `WHIM_LOG_JSON=1` so pino writes structured JSON instead of the worker-thread `pino-pretty` transport.

`server/test/e2e.run.mjs` mirrors this without the `tsc` step, bundling `server/test/e2e.ts` with external `['esbuild','playwright','typescript','pino']`.

**2. Pipeline selection / lifecycle (`main.ts`).** `WHIM_PIPELINE=stub` picks `createStubPipeline(200)`; otherwise the real pipeline requires `session = await SynthRunSession.launch()` (launches Chromium) plus `modelDeps = buildModelDepsFromEnv()` — a missing `OPENROUTER_API_KEY` (or roster env) throws synchronously at module top-level in non-stub mode (fail-fast startup crash, uncaught — no try/catch around that branch), while stub mode degrades gracefully (logs a warning, `/v1/rewrite` 502s later). Port: `Number(process.env.WHIM_SERVER_PORT ?? '8787')`; bind: hard-coded `hostname:'0.0.0.0'` via `@hono/node-server`'s `serve({fetch, port, hostname}, cb)`. Shutdown: SIGINT/SIGTERM call `server.close()`, then `session.close()` (closes the Chromium browser) if the real pipeline was used, then `process.exit(0)` — no request-drain timeout, no forced-kill fallback.

**3. Runtime filesystem reads**, all resolved off `process.cwd()` (never `import.meta.url`/`__dirname` — `dev.mjs`'s bundling collapses those onto the temp-file path, called out explicitly in comments at `synthrun/builder.ts:16-21` and `synthrun/page.ts:20-22`):
- `docs/sdk-reference.md` (or `WHIM_SDK_REFERENCE_PATH` override) — `server/src/generation/prompts/inputs.ts:42,53`
- `fixtures/*.app.tsx` top-level only, excluding `latency-probe.app.tsx` — `inputs.ts:70-88`
- `src/runtime/generated/runtime-artifacts.json` (`.parts`) — `synthrun/page.ts:42`, cached in-process after first read
- `build/assemble.mjs` (`buildOuterHtml`/`buildSrcdoc`) — imported (not fs-read) by `synthrun/page.ts:18`
- `build/react-inject-shim.ts` — passed to esbuild's `inject` in `synthrun/builder.ts:48`
- `WHIM_DATA_DIR` (default `path.join(process.cwd(),'server','.data')`) — `mkdirSync(..., {recursive:true})`, no explicit mode, then opens `usage.db` — `main.ts:39-41`

All of these assume the process's cwd is the repo root at the checkout layout used today (`docs/`, `fixtures/`, `build/`, `src/runtime/generated/` siblings of `server/`) — a container image that doesn't preserve this relative layout (or that runs with a different cwd) breaks every one of them.

**4. Third-party/runtime imports.** `checks/index.ts` (`runStaticChecks`, `scanStorageSurface`) is imported at runtime by `server/src/generation/machine.ts:21-22` and `server/src/generation/stages/check.ts:17-18` — `checks/` internally uses the `typescript` package (`checks/internal/parse.ts` etc.), so **`typescript` is a real runtime dependency**, not test-only. `esbuild` is a real runtime dependency via `synthrun/builder.ts` (`buildCandidateSource`), imported by `server/src/generation/stages/build.ts:12` and `server/src/pipeline.ts:6`. `playwright` is a real runtime dependency via `synthrun/session.ts`, imported by `main.ts:22`. The candidate build's `vc-sdk`/`react`/`react-dom` imports are left `external` in `synthrun/builder.ts:49` — esbuild does **not** resolve them from `node_modules` at all; they're resolved instead by the pre-built `runtime-artifacts.json` globals (`sdkInject`/`reactInject` parts, produced once ahead-of-time by `npm run build`, not per-request).

**5. synthrun launch.** `chromium.launch()` with **no arguments** (`synthrun/session.ts:76`) — no explicit `headless`, `args`, `chromiumSandbox`, `executablePath`, or `channel` (Playwright defaults apply, i.e. headless true). One `Browser` is launched **eagerly, once per `SynthRunSession`**, and `main.ts` creates exactly one session for the real-pipeline process's whole lifetime. `DEFAULT_CONCURRENCY = 4` (`synthrun/concurrency.ts:32`), enforced by a hand-rolled counting semaphore (`createSemaphore`, same file) scoped to the session. I found **no disconnect/crash-relaunch handling** anywhere under `synthrun/` (grepped for `disconnected|isConnected|reconnect` — no matches) — a crashed/killed browser process is not detected or relaunched; every subsequent `openRun` would presumably fail against the dead browser handle (not directly verified by exercising a crash).

## Constraints and invariants
- **Governing spec text** (`openspec/specs/generation-server/spec.md:8-9,21`): "LAN dev only — no deployment or TLS yet"; port defaults so "LAN devices can reach it." `docs/v1-roadmap.md:299` lists "deployment/TLS (LAN dev only)" as explicitly out of scope for the decisions that shipped the server skeleton. There is currently **no decision in `docs/decisions.md` that authorizes or designs a production deployment** — I did not find one in the areas grepped (searched for LAN/deploy/production/container in `docs/v1-roadmap.md` and `openspec/specs/generation-server/spec.md`; did not exhaustively read all of `docs/decisions.md`).
- `server/src/app.ts:103-119` — every `/v1/*` route is gated by `x-whim-device` (capabilities.md's stated invariant); unaffected by transport (still applies in a container).
- `checks/`/`synthrun`/`esbuild`/`typescript`/`playwright` must all ship in the production image — they are load-bearing runtime deps of the real pipeline, not devDependencies-only in effect (even though `esbuild`/`playwright`/`typescript` live in root `devDependencies`, package.json:68,73,77 — a container build that prunes devDependencies would break the real pipeline).
- Root `package.json` `engines.node: ">=22.11.0"` (both root and `server/package.json:7-9`); server test/dev runners target `node22` in esbuild and rely on `node:sqlite` as a Node-22 built-in — I found **no `--experimental-sqlite` flag anywhere** (grepped repo-wide for `experimental-sqlite`, zero matches in any run/dev/test script), so this assumes `node:sqlite` is stable-without-flag on the pinned Node version; not independently verified against Node 22.11's exact stability status for that module.
- `.gitignore:90-94` — `server/.data/`, `server/.logs/`, `.env` are all gitignored (state + secrets never committed).
- `tsconfig.json:40-44` excludes `contract`/`server` from the root RN tsconfig by design (they're Node-flavored, type-checked separately by `server:test`); `knip.json:56-59` has a `server` entry (`entry: ["test/**","src/main.ts"]`, `project: "{src,test}/**/*.{ts,mjs}"`).

## Integration points
- `server/src/main.ts` is the only composition root; a container entrypoint would need to either reproduce or replace `dev.mjs`'s bundle-then-run step (the file itself says "Dev runner" and keeps `esbuild`/`playwright`/`typescript` external at import time — those still need to resolve from `node_modules` at container runtime).
- `npm run server:dev` (package.json:29) is the only existing "run the server" script; there is no `server:start`/`server:build` production script.
- Gate wiring: `scripts/gate.sh:61` → `npm run -s server:test`; `scripts/gate-full.sh:41` → `npm run -s server:e2e` (also `:35` synthrun, `:32` guard:metro, `:33-34` invariants). Both scripts are human-edited only (`protect-harness.sh` blocks agents).
- `.devcontainer/Dockerfile` (`FROM node:22-bookworm`) is the closest existing container artifact but is scoped to the fix-loop harness (installs Claude Code CLI, egress-firewalled to Anthropic only, no server ports exposed, no `.env`/`OPENROUTER_API_KEY` handling) — not reusable as-is for a public-facing server image.
- Dependency versions actually resolved in `package-lock.json`: `playwright@1.60.0` (root devDep is `^1.49.0`), `esbuild@0.25.12` (`^0.25.0`), `typescript@5.9.3` (`^5.8.3`), `hono@4.13.1` (server dep `^4.6.0`), `@hono/node-server@2.1.0` (`^2.0.5`), `zod@4.4.3`-range in `contract/package.json` resolving elsewhere in the lockfile to entries like `4.1.11`/`4.0.17` depending on consumer (contract itself pins `^4.4.3`) — I did not resolve which exact zod version lands under `contract/node_modules` vs hoisted root. `.devcontainer/Dockerfile:46` and `.github/workflows/invariants.yml:104` both pin Playwright's Chromium install to the lockfile-resolved `1.60.0` via `npx --ignore-scripts --package=playwright@1.60.0 playwright install --with-deps chromium` — this is the only Chromium-revision pin I found; it's a CI/devcontainer convention, not something `server/dev.mjs`, `package.json`, or `package-lock.json` itself enforces at `npm install` time (no `postinstall` script found).

## Risks and unknowns
- I did not verify what happens when the single `SynthRunSession`'s browser actually crashes/disconnects mid-process — no relaunch code exists, but I did not trace every consumer of `session.openRun` to confirm the failure mode (exception surfaced to the request vs. process-wide failure).
- I did not exhaustively read `docs/decisions.md` for every LAN/deployment-adjacent decision — I relied on the generation-server spec and v1-roadmap's explicit "out of scope" line; there may be additional numbered decisions on server posture I didn't surface.
- Did not verify `node:sqlite` stability-without-flag specifically on Node 22.11.0 (the pinned floor) vs. later 22.x — the repo's own scripts never pass `--experimental-sqlite`, which is circumstantial evidence it's unneeded on the versions actually run, not a citation of Node's own release notes.
- Did not check whether `zod` resolves identically for `contract/` under a workspaces install as opposed to root-hoisted — flagged as unresolved above.
- Did not check `@hono/node-server`'s `serve()` for additional options beyond `{fetch, port, hostname}` (e.g. TLS, keep-alive tuning) since none are passed in `main.ts` today — only confirms none are currently used, not that none exist.

## Open questions for the planner
- None — file:line terrain above is sufficient to reason from; scope/strategy decisions (image base, secrets injection, browser crash recovery, TLS termination) are proposal-design territory, not something the code resolves for you.

---

# R2 — Research digest: what can untrusted candidate JS reach during the server-side synthetic run, and does client disconnect really tear down the model call and browser context?

Paths below are relative to `/Users/davrondjabborov/Work/other/Whim/`. I read code only and ran nothing.

## Relevant files
- /Users/davrondjabborov/Work/other/Whim/synthrun/session.ts — browser launch, context, file:// navigation, dispose
- /Users/davrondjabborov/Work/other/Whim/synthrun/report.ts — `createRunCandidate`: openRun, awaitMount, withTotalBudget(signal), `finally` dispose
- /Users/davrondjabborov/Work/other/Whim/synthrun/observe.ts — budgets, `awaitMount`, `withTotalBudget` abort race, relay binding
- /Users/davrondjabborov/Work/other/Whim/synthrun/capability.ts — `whimHostDispatch` binding, `:memory:` engine, recording effectors
- /Users/davrondjabborov/Work/other/Whim/synthrun/page.ts, builder.ts, concurrency.ts, contract.ts — page assembly, esbuild call, semaphore, `RunOptions.signal` doc
- /Users/davrondjabborov/Work/other/Whim/build/assemble.mjs — LOCKED_CSP, iframe sandbox attribute, outer page (no CSP)
- /Users/davrondjabborov/Work/other/Whim/src/runtime/web/neutralize.js, probes.js — global strip; in-realm network probes
- /Users/davrondjabborov/Work/other/Whim/server/src/routes/generate.ts, sse.ts, main.ts, app.ts — abort wiring, SSE stream, keepalive, serve()
- /Users/davrondjabborov/Work/other/Whim/server/src/generation/{machine,model,summarise,reconcile,index}.ts, stages/{run,build}.ts, openrouter.ts — signal threading
- /Users/davrondjabborov/Work/other/Whim/server/src/routes/clarify.ts, rewrite.ts — model calls outside the pipeline signal
- /Users/davrondjabborov/Work/other/Whim/server/test/{e2e.ts,server-core.suite.ts,metering.suite.ts} — abort/cancel tests
- /Users/davrondjabborov/Work/other/Whim/node_modules/@hono/node-server/dist/index.mjs — v2.1.0 installed (`server/package.json` asks for `^2.0.5`)
- /Users/davrondjabborov/Work/other/Whim/node_modules/playwright-core/lib/coreBundle.js — v1.60.0 Chromium default args
- /Users/davrondjabborov/Work/other/Whim/checks/passes/import-allowlist.ts — the only check between model output and esbuild
- Specs: openspec/specs/synthetic-run, generation-server (L160-174), generation-pipeline (L502-525)

## Current behavior
**Part A: what the candidate can reach**
- **A1 Launch.** `chromium.launch()` is called with no options (session.ts:76). `main.ts:62` calls `SynthRunSession.launch()`, so concurrency defaults to 4 (session.ts:32). No args, no headless setting, no chromiumSandbox, no ignoreDefaultArgs. In Playwright 1.60 the default args add `--no-sandbox` whenever `chromiumSandbox !== true` (coreBundle.js:41681-41682). So **the Chromium OS sandbox is off**, and headless is the default (41673). The default switch list (33589-33644) does not disable web security or site isolation. The invariants runners launch the same way (run-against-build.mjs:88, bridge/runner.mjs:85).
- **A2 Context.** `browser.newContext()` also takes no options (session.ts:101), so Playwright defaults apply (offline false, bypassCSP false, no proxy, no permissions). synthrun has **no** `context.route`, `page.route`, `routeWebSocket`, `on('request')` or `framenavigated` (grep). The only instrumentation:
  - `page.addInitScript(installRelayShim)` plus `page.exposeBinding(RELAY)` (observe.ts:492,538)
  - `context.exposeBinding('whimHostDispatch')`, which refuses any caller that is not the main frame (capability.ts:145-155)
  - CDP `Runtime.enable`
- **A3 Load.** The HTML is built with channel 'b', syscallSink 'exposed', no diagnostics (page.ts:57-69). It is written to `os.tmpdir()/synthrun-page-*/<runId>.html` and loaded with `page.goto('file://…', {waitUntil:'load', timeout:20000})`; the temp dir is removed afterwards (session.ts:96-114). **Outer page origin is file://.** The outer script creates `<iframe sandbox="allow-scripts">` with `srcdoc` (assemble.mjs:131), so the candidate runs in an opaque origin. The bundle arrives by postMessage and is injected as an inline DOM `<script>`, wrapped by `wrapBundle` (assemble.mjs:43-58), which adds lexical shadows.
- **A4 CSP.**
  - The outer page (`buildOuterHtml`, assemble.mjs:185-209) has **no CSP**.
  - The srcdoc has a meta CSP (assemble.mjs:17-27, 80), verbatim: `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'; child-src 'none'; worker-src 'none'`.
  - It has no media-src or font-src (both fall back to `default-src 'none'`) and no navigate-to.
  - **Blocked by CSP alone** (reading standard semantics): fetch to 169.254.169.254, WebSocket, sendBeacon (connect-src), `<img src=http>` and CSS `url()` images (img-src data:), fonts and media (default-src).
  - **Not a CSP matter:** `window.open` and top navigation are blocked by the sandbox attribute (no allow-popups, no allow-top-navigation). Forms are blocked by form-action plus the sandbox (no allow-forms).
  - **Nothing in this CSP covers the iframe navigating itself** (`location.href=`, an `<a>` click, an inserted `<meta http-equiv=refresh>`), and the outer page has no frame-src.
  - WebRTC is not covered by connect-src (spike2 §security model, leg 3).
- **A4 Global strip.** neutralize.js:63-89 replaces these with non-configurable window-level throwing stubs: fetch, XMLHttpRequest, WebSocket, EventSource, RTCPeerConnection, Worker, SharedWorker. localStorage, sessionStorage, indexedDB and caches become inert Proxies. `navigator.sendBeacon` gets an own-property stub. **Not stripped:** `document`/DOM (evil.app.tsx:38 creates a `<script>`), `location`, WebTransport, `webkitRTCPeerConnection`, `Navigator.prototype.sendBeacon`.
- **A5 Tests.** All network assertions run inside the realm and report back.
  - probes.js:48-56 asserts that fetch, XHR, WebSocket, RTCPeerConnection, EventSource and sendBeacon *throw when called*. L77-82 asserts parent/top are unreachable. The result travels in the nonce-authenticated `probes` frame as `contained`.
  - Consumers: invariants/run-against-build.mjs (b-evil and others), synthrun reports, and server/test/e2e.ts:311-337, which only checks `contained === true` for fixtures/adversarial/evil.app.tsx.
  - **No test anywhere watches traffic at the network, CDP or Playwright level, and there is no host-controlled network sink.** An egress path the probes never call (img, self-navigation, DNS) fails nothing. Spike2 constraint #3 names an out-of-band sink as an option, and decision #28 calls network isolation "the most important" assertion. No implementation exists.
- **A6 Server-side I/O.**
  - The registry is storage + diag + cues only (src/host/bridge/index.ts:43-49). There is no network syscall.
  - Storage is a fresh `createNodeSqlExecutor(':memory:')` per run (capability.ts:87). Cues are recorded, not fired (77-84). diag writes to the trace only (121-123).
  - Candidate *content* (not its execution) is written to temp files: a .tsx for esbuild (builder.ts:83-90) and the .html page.
  - esbuild runs with `bundle:true`, `sourcesContent:true`, and no resolve plugin or restriction (builder.ts:37-60). Whatever the source imports and esbuild can resolve on disk goes into the bundle and its source map.
  - The only guard before build is import-allowlist.ts:65-77. It visits ImportDeclaration, `import()` and `require()`. It does **not** visit `export … from '<path>'` or `import x = require('<path>')`.

**Part B: the abort path**
- **B7 Route and SSE.**
  - generate.ts:78-86 creates one AbortController per request. `c.req.raw.signal` 'abort' calls `controller.abort()`, and so does `buildSseStream`'s onCancel (L125). The abort listener also starts fire-and-forget reconciliation unless `creditOwned` is set (L95-113).
  - The comment at L73-77, verbatim:
    > NOTE: the deterministic suites drive only the cancel() surface. Whether
    > @hono/node-server actually fires Request.signal on a real TCP disconnect is an external
    > runtime assumption nothing here asserts — its acceptance step is the LAN check when the
    > real pipeline is mounted (task 7.6): kill the device app mid-generation, confirm the
    > server log shows the abort. See docs/v1-roadmap.md #11 carryover.
  - sse.ts: the keepalive `setInterval` sends `: keepalive\n\n` every 15 000 ms (main.ts:69). `cancel()` sets `cancelled`, clears the interval, calls onCancel and settles. The `start()` loop only checks `cancelled` when the next event arrives (sse.ts:68-69).
  - There is **no max-duration guard** in sse.ts, the route or app.ts, and `start()` enqueues without checking desiredSize.
- **B8 Signal threading.**
  - The machine checks the signal at stage boundaries (machine.ts:430-446, 804-870).
  - Model path: `model.stream(…, signal)` (L497) → openRouterModelClient (model.ts:107-115) → **`fetch(..., {signal})`** (openrouter.ts:228-236). An abort mid-read throws OpenRouterNetworkError, which the top-level catch swallows when `signal.aborted` (machine.ts:445-446).
  - Run path: run.ts:48 passes `{signal}` to runCandidate. The signal is consulted **only** in `withTotalBudget` around the sweep (report.ts:155-171). It is not consulted in:
    - the semaphore wait (concurrency.ts:26-35)
    - `openRun`: build, file write, newContext, `goto` with its 20 s timeout (session.ts:85-131)
    - `awaitMount`, up to 8000 ms (observe.ts:602, 622-637)
  - contract.ts:125-133 documents this ("threaded, not raced", decision #56 D8).
  - On abort: `page.close()` (observe.ts:705-709), then report.ts's `finally` runs `obs.detach()` and `dispose()`, which does `context.close()` and releases the slot (session.ts:121-124). The browser itself closes only on SIGINT/SIGTERM (main.ts:85-102). The build stage ignores the signal (build.ts:34-39).
  - Reconcile after abort: bounds of 5 attempts / 5000 ms / 500 ms (reconcile.ts:37-41). The deadline is only checked *between* attempts, and `fetchStats` has no signal or timeout (generation/index.ts:79-83).
- **B9 Tests.**
  - Every route-level cancel test uses in-process `app.request()` and `reader.cancel()` (post helper at server-core.suite.ts:52-58; L426/518/620/672; metering.suite.ts:241; wire-v2.suite.ts:390).
  - Machine aborts use an AbortController directly (machine.suite.ts:676-900; openrouter.suite.ts:359).
  - **No test calls `serve()`, listens on a port, or uses a TCP socket.**
  - e2e.ts starts no server. It launches `SynthRunSession` directly. `testCancellationDisposesAndReleasesSlot` (L357-391) aborts 250 ms after beforeNavigate on a concurrency-1 session and asserts the page is closed and a second run finishes in under 8 s.
  - e2e is wired into gate-full.sh:41. The header comments in e2e.run.mjs:10-13 and e2e.ts:6-7 say it isn't; they are stale (decision #56 D15 records it applied).
- **B10 @hono/node-server 2.1.0 (source read only).**
  - The request's `signal` getter lazily creates an AbortController (index.mjs:345-349, 387-389).
  - The listener attaches `outgoing.on("close")` (862-866, 891). If `!outgoing.writableFinished`, it calls `abortRequest("Client connection prematurely closed.")` (702-709).
  - Streaming the response cancels the ReadableStream reader on writable 'close' or 'error' (615-625).
  - So both surfaces look wired in source. **Not verified over a real TCP connection.**
- **B11 Outside the pipeline signal.**
  - /v1/clarify (clarify.ts:109) and /v1/rewrite (rewrite.ts:84,141) pass `c.req.raw.signal` straight to `model.stream`. On abort they fall into the catch and return 502, usage is not credited, and nothing reconciles it.
  - No model call has a timeout except the summariser (20 s, summarise.ts:60,197-232), which does follow the pipeline signal.
  - Untrusted source is processed with no signal:
    - `runStaticChecks`, a synchronous TS parse, in the check stage and again at report.ts:106
    - `preflightSource` (index.ts:144-146)
    - esbuild, which runs twice (build stage and openRun)

## Constraints and invariants
- Containment has three legs: opaque sandboxed iframe, CSP without unsafe-eval, window-level strip (decisions #35/#37, spike2 §security model). Never widen the CSP; never value-replace Function/eval; a realm reset recreates the iframe.
- synthetic-run spec: pages come from the unmodified production artifacts, with no forking or loosening of page, CSP or loader. `build/*` and `invariants/` are read-only (Class-2, owner-authored, #28). Each candidate gets a fresh context, closed with its page. The runtime page stays watchdog-free. Forged payloads are never echoed.
- generation-server spec L160-174: both cancel surfaces trigger one abort; model streams and browser contexts are torn down; no unhandled rejection; no persistence beyond the per-device counter (#33).
- generation-pipeline spec L502-508 requires the signal to be honoured "inside every waiting operation". The synthrun gaps in B8 sit in tension with that wording, while #56 D8 accepts them.
- #56 D9: `creditOwned` is set before `await credit`, so reconciliation never double-credits.
- Every `/v1/*` route is gated by the `x-whim-device` header (app.ts:101-127).

## Integration points
- `SynthRunSession.launch` (session.ts:75-79): launch options. `openRun`'s `newContext` (session.ts:101): context options.
- `RunOptions.beforeNavigate` (contract.ts:124; composed at report.ts:120-127): the pre-navigation seam where route handlers and request listeners would attach.
- `withTotalBudget` (observe.ts:668), report.ts `finally` (221-224), semaphore acquire (session.ts:86).
- generate.ts:78-86 controller; `buildSseStream` params (sse.ts:37-42); `createApp` options (app.ts:45-68); `serve()` in main.ts:77.
- `ModelClient.stream` seam (model.ts:56) and the fetch init in openrouter.ts:228; clarify.ts:109 and rewrite.ts:141.
- Test homes: synthrun/test/acceptance.ts, server/test/e2e.ts (gate-full), server-core.suite.ts (fast gate), invariants/ (owner-only).

## Risks and unknowns
- I did not verify that Chromium blocks the iframe navigating itself to http(s) or file://. Nothing in the code blocks it.
- I did not verify DNS-prefetch, preconnect or prefetch behaviour under `default-src 'none'`, nor whether WebTransport or `webkitRTCPeerConnection` exist in Playwright 1.60's Chromium.
- I did not verify Playwright's `acceptDownloads` default, or whether the sandbox blocks downloads.
- With `--no-sandbox`, a renderer compromise means code execution as the server user. The code sets no process or network egress boundary (host network, `0.0.0.0` bind at main.ts:77). The only Dockerfile is `.devcontainer/`, which is for harness agents; I found no server deploy config.
- I did not verify that a real TCP disconnect, HTTP/2, or a buffering reverse proxy fires the node-server 'close' handler.
- I did not measure worst-case abort latency. By reading, it is semaphore wait + esbuild + goto (≤20 s) + mount (≤8 s) before the context closes.
- I did not verify whether esbuild actually resolves and inlines the `export-from` / `import-equals` forms that the allowlist doesn't visit, or whether another check pass catches them.
- No slow-client backpressure in sse.ts: memory growth is unmeasured.

## Open questions for the planner
1. Should the public server's containment rest on in-page legs alone, or also on a process/egress boundary around Chromium? This decides whether `--no-sandbox` and host networking are in scope.
2. Should an out-of-band network assertion live in `invariants/` (owner-authored, Class-2) or in synthrun's own suite?
3. Does "inside every waiting operation" now bind the semaphore wait, `openRun` and `awaitMount`, superseding #56 D8?
4. Should a real-TCP disconnect test (server on an ephemeral port) run in gate.sh or gate-full.sh?
5. Should /v1/clarify and /v1/rewrite reconcile or credit usage on abort the way /v1/generate does?

---

# R3 — Research digest: per-device limits, body-size limits, content-policy check, and a report endpoint for `public-generation-server`

## Relevant files
- `server/src/app.ts` — `createApp`, middleware order, `/v1/*` device-identity gate, route table
- `server/src/routes/{clarify,rewrite,generate,usage,dev-logs}.ts` — per-route body validation, model calls, usage crediting
- `contract/src/index.ts` — zod schemas (`ClarifyRequest`, `GenerateRequest`, `ApiError`, `DeviceIdError`, `Usage`, `GenerationEvent`)
- `server/src/usage-store.ts` — `UsageStore` interface + `NodeSqliteUsageStore`/`InMemoryUsageStore`
- `server/src/generation/model.ts` — `ModelClient`/`ModelRoster` seam, env-driven roster
- `server/src/generation/json-block.ts` — tolerant JSON-fence extractor shared by clarify/rewrite
- `server/src/generation/machine.ts` — `Clock`/`RunTrace` interfaces (existing clock-injection precedent)
- `server/src/generation/reconcile.ts` — uses raw `Date.now()`, not the injected `Clock`
- `server/src/logger.ts` — redaction config, `createServerLogger`
- `server/src/main.ts` — env wiring (`WHIM_PIPELINE`, `WHIM_DATA_DIR`, `WHIM_DEV_LOG_SINK`, model roster)
- `server/test/{run.mjs,acceptance.ts,harness.ts,scripted-model.ts,wire-v2.suite.ts,SPEC.md}` — suite discovery, gate assertion, test doubles
- `src/host/launcher/transport-shared.ts` — device-side `GenerationClientError` classification (read-only)
- `docs/decisions.md` #33, #42 — data residency (Model 1) and anonymous device identity, governing constraints

## Current behavior

**`server/src/app.ts`** (`createApp`, lines 45-142): `AppOptions` injects `pipeline: Pipeline`, `usageStore: UsageStore`, optional `keepaliveMs`, optional `model?: ModelClient` + `roster?: ModelRoster`, optional `reconcile?: {transport, bounds}`, optional `devLogSink?: DevLogSinkOptions`, optional `stub?: boolean`. No env/options-bag abstraction beyond this flat interface — no logger, no clock injected. Middleware order: (1) global `app.use('*', …)` request-logging middleware (app.ts:81-96, skips SSE content-type), (2) anonymous `GET /healthz` (line 99, returns plain text `'ok'`, though `server-connectivity` change — treat as applied — makes it JSON `{ok:true, service:'whim-server'}`), (3) `app.use('/v1/*', …)` device-identity gate (lines 102-127): reads `x-whim-device` header, validates non-empty then against `UUID_RE` (line 40-41), on failure returns `c.json(DeviceIdError, 400)`, on success `c.set('deviceId', deviceHeader)` then `await next()`. Route mounts (lines 130-138): `POST /v1/generate`, `POST /v1/rewrite`, `POST /v1/clarify`, `GET /v1/usage`, and conditionally `POST /dev/logs` (outside `/v1`, only when `options.devLogSink` set). No `notFound`/`onError` handler is registered on the Hono app (Hono's own defaults apply — I did not verify Hono's default 404/500 body shape). No CORS middleware, no trust-proxy/`x-forwarded-for` handling, no global body-size limit anywhere in `app.ts`.

**Per-route bodies**: `clarify.ts`/`rewrite.ts`/`generate.ts` all do `const body = await c.req.json().catch(() => null)` then `Schema.safeParse(body)`; on failure return `c.json({error:'invalid_request', hint: parsed.error.issues[0]?.message ?? '...'} satisfies ApiError, 400)` — this happens before any model call or SSE stream opens (generate.ts:60-67 is before the `AbortController`/pipeline invocation at line 116-124). `usage.ts` reads no body (GET). None of the three JSON-body routes read raw text or enforce a byte bound before `c.req.json()` — Hono/undici's default body parsing applies with no explicit limit. **`dev-logs.ts` is the one route with an explicit body-size precedent**: it does `const raw = await c.req.text()` (line 87) then `Buffer.byteLength(raw,'utf8') > maxBodyBytes` (default 1_000_000, configurable via `DevLogSinkOptions.maxBodyBytes`) → `413` `ApiError` before `JSON.parse`, then a record-count bound (`maxRecords`, default 500) → `413` after parse but before writing. This is a manual read-then-check pattern, not a Hono/middleware-level limit.

**Model/role usage**: clarify and rewrite both call `model.stream({model: roster.rewrite, ...}, signal)` — the small/fast model, never `roster.engineer`. Both take `c.req.raw.signal` (generate.ts and rewrite.ts thread it explicitly; clarify.ts too, line 109). `generate.ts` doesn't call the model directly — it delegates to `pipeline.run(request, signal, trace)`, an `AsyncIterable<GenerationEvent>`.

**Usage crediting**: clarify/rewrite call `usageStore.credit(deviceId, usage)` inline after the model stream's `usage` promise resolves (clarify.ts:114-115, rewrite.ts:88-89 inside `rewriteWithRetry`, up to 2 attempts → up to 2 credits per rewrite call). generate.ts credits via `interceptUsage` (generate.ts:153-166), an async generator wrapper around the pipeline's event source that calls `usageStore.credit` when it sees a `usage`-type `GenerationEvent`, marking `creditOwned=true` *before* awaiting the credit call to close an abort race. Post-abort reconciliation lives in `server/src/generation/reconcile.ts` (not fully read, but its signature `reconcileAbortedUsage(deviceId, generationIds, {transport, usageStore, bounds})` and its `Date.now()`-based deadline logic at reconcile.ts:30,67,78,96,121 were confirmed).

**Stub selector** (`WHIM_PIPELINE=stub`, main.ts:26): only affects clarify (marker `[[noclarify]]` → empty questions, else canned `STUB_QUESTIONS`) and rewrite (marker `[[fail]]` → prompt passed through raw) — both make no model call when stubbed. The pipeline's own stub (`createStubPipeline`) is selected separately by main.ts passing it as `pipeline`, unrelated to `options.stub`.

## Constraints and invariants

- **Every `/v1/*` route must stay gated by the single path-prefix middleware "by construction"** (`generation-server` spec, Requirement "Device-identity middleware"; enforced by `server/test/wire-v2.suite.ts` `testWholeRouteTableIsGated`, lines 172-196, which enumerates `app.routes` at runtime and asserts every mounted `/v1` route 400s without the header). Any new route mounted under `/v1` — e.g. a report endpoint — is gated automatically only if mounted via `app.route('/v1/...', ...)`; mounting outside `/v1` (like `/dev/logs`) requires the same "not under `/v1`" test-visibility discipline `dev-logs.ts` follows.
- **§4.7/Model 1 (decision #33): the server persists only a per-device token counter — no prompt, source, bundle, or app content, ever.** `generation-server` spec's "Token metering — the only server state" requirement states this explicitly ("No other server-side persistence of any kind SHALL exist"). Any new per-device limit counter (rate/quota) or report-endpoint persistence must be argued against this — it is presently the *only* sanctioned server-side durable state.
- **Decision #42 identity**: anonymous device UUID, no accounts, no PII — governs what a "per-device" limit can key on (only the UUID header, already validated by the existing middleware).
- **Every non-SSE `4xx`/`5xx` body from a `/v1/*` route must validate against `ApiError` = `{error: string, hint: string.min(1)}`** (contract spec, Requirement "Structured API error body"). `dev-logs.ts` already returns `413`/`400` `ApiError` bodies for size/shape violations — same shape a per-device-limit `429` or a content-policy `4xx` would need.
- **generation-server spec's "Blocking server suite in CI"** requires the deterministic suite pass with `OPENROUTER_API_KEY` unset and launch no browser; a browser-backed suite is separate (full gate only).
- Model ids are never literals in `server/src/generation/` — always resolved via `ModelRoster` read from env (`WHIM_REWRITE_MODEL`/`WHIM_ENGINEER_MODEL`), enforced by a tripwire in `server/test/prompts.suite.ts` (I did not read that tripwire directly, only its mention in `model.ts`'s header comment).
- Logging redaction (`logger.ts` `SENSITIVE_FIELD_NAMES`) already covers `prompt`, `source`, `deviceId`, API-key-shaped fields at up to 3 levels of nesting — a content-policy check or report endpoint that logs the offending prompt/body must go through this logger to stay redacted, not a bespoke `console`/`fs.appendFile` call (the `dev-logs.ts` precedent explicitly routes through a `pino` child logger for this reason, lines 13-15 of that file's header comment).

## Integration points

- **Per-device limits**: natural seam is the existing `UsageStore` interface (`credit`/`read`) or a sibling store constructed the same way in `main.ts` (env-driven path under `WHIM_DATA_DIR`, `:memory:` in tests) and injected via a new `AppOptions` field, checked either in a new `/v1/*`-scoped middleware (alongside the device-identity middleware in `app.ts`, after `c.set('deviceId', ...)`) or inline at the top of each route handler before the first model call — the existing routes all validate the body first, so a limit check would slot in the same "before pipeline/model call" position already used for schema validation (clarify.ts:93-99, rewrite.ts:126-132, generate.ts:61-67).
- **Body-size limits**: `dev-logs.ts`'s `c.req.text()` + `Buffer.byteLength` pattern is the only in-repo precedent; the three JSON routes currently rely on `c.req.json()` with no explicit ceiling — a body-size check would need the same manual read-then-bound-then-parse restructuring, or a Hono body-limit middleware (I did not verify whether `@hono/node-server`/Hono ships one already available without adding a dependency — the spec's workspace-dependency budget in `generation-server` Requirement "Server workspace and runtime" restricts runtime deps to exactly `hono`, `@hono/node-server`, `pino`, `@whim/contract`).
- **Content-policy check**: no existing seam; would sit after body validation, before the first `model.stream(...)` call in clarify/rewrite, or before `pipeline.run(...)` in generate — i.e., the same "point where a pre-check can still return non-SSE 4xx" already exploited by body validation (generate.ts:60-67, still inside the unary POST handler before `new Response(stream, ...)` at line 134).
- **Report endpoint**: would be a new route module under `server/src/routes/`, mounted in `app.ts` either under `/v1` (auto-gated, per the spec's by-construction requirement) or outside it like `/dev/logs` (would need its own explicit test coverage per the "not under /v1" precedent) — `dev-logs.ts` is the closest structural template (bounded batch, structural guard, append-only file via a scoped `pino` child logger).
- **Model roster** (`ModelRoster{rewrite, engineer}`) and `ModelClient.stream` are the only model-call seam; a content-policy check implemented as a model call (vs. static/regex) would need a role — currently only `rewrite`/`engineer` exist, so a policy check would either reuse `rewrite` or require a roster extension.
- **Tests**: new routes/middleware get exercised the same way every existing suite does — `createApp({...})` constructed directly in-process (no separate app-factory helper beyond `createApp` itself) and driven via Hono's `app.request(path, init)`; `server/test/wire-v2.suite.ts`'s route-table enumeration (`app.routes.filter(r => r.path.startsWith('/v1') ...)`) is the mechanism that would need to see any new `/v1` route to keep the "every route gated" assertion meaningful.

## Risks and unknowns

- I did not verify Hono's default `notFound`/`onError` behavior (no explicit handlers registered in `app.ts`) — unclear what body shape an unmatched route or an unhandled exception currently returns.
- I did not verify whether `@hono/node-server` or Hono core exposes a body-size-limit primitive without a new dependency, given the spec's closed runtime-dependency budget (exactly `hono`, `@hono/node-server`, `pino`, `@whim/contract`).
- I did not find a `Retry-After` header anywhere in the repo (grep for `retry-after`/`Retry-After`/`retryAfter` returned no matches) — the device-side `GenerationClientError` classification (`transport-shared.ts`) has no case for a rate-limit-specific error kind today; its `GenerationClientErrorKind` union is `'network' | 'device_id' | 'http' | 'stream_parse'`, so a `429` would presently surface as generic `'http'` with `status: 429` and whatever `hint` the body carries (via `httpErrorFrom`, transport-shared.ts:169-181).
- I did not read `server/src/generation/reconcile.ts` in full, only grepped it — confirmed it uses raw `Date.now()` (not an injected clock) for its reconciliation deadline logic, unlike `machine.ts`'s `Clock` interface (`now(): number`, machine.ts:45-47) which `generation/index.ts:128` wires as `{now: () => Date.now()}`. So there are two different time-access patterns in the server: one injectable (`Clock`, used by the generation machine, currently unused for branching per its own comment), one not (`reconcile.ts`'s direct `Date.now()`).
- I did not verify `server/test/prompts.suite.ts`'s literal-model-id tripwire directly, only its description in `model.ts`'s header comment.
- I did not check whether any content-policy/report-endpoint precedent exists in `openspec/changes/` beyond `server-connectivity` — did not do a broader changes/ sweep since the question scoped to generation-server internals.

## Open questions for the planner

1. Should per-device limits be a new counter table alongside `usage` in the same SQLite file, or a wholly separate store — and does adding it conflict with decision #33's "only a token counter persists" framing (a rate-limit counter is arguably still "just a counter" but the spec's wording is narrow)?
2. Is a content-policy check meant to be a model call (needs a roster role) or static (regex/keyword), given the roster is currently closed to `rewrite`/`engineer`?
3. Does the report endpoint accept device-submitted content (prompt, generated app) for review, and if so, does that create the first exception to "no content stored" (Model 1) that needs its own decision entry?

---

# Research digest: replay Compose env-file isolation after the attended load-test failure

## Relevant files

- `docs/capabilities.md` — maps no-spend replay deployment to `server-deployment`.
- `openspec/specs/server-deployment/spec.md` — requires a capacity test without provider credit.
- `openspec/changes/public-generation-server/design.md` D26 — governs replay and its key refusal.
- `deploy/compose.yaml` — production `whim-server` reads `config.env` then `server.env`.
- `deploy/loadtest/compose.loadtest.yaml` — replay override previously named only `config.env` as an ordinary list.
- `server/src/loadtest/server.ts` — refuses a present `OPENROUTER_API_KEY` before listening.
- `server/test/loadtest.suite.ts` — current fast-gate deploy-file tripwire.
- `openspec/changes/public-generation-server/handoff/loadtest.md` — operator contract and attended sequence.

## Current behavior

The replay override is applied after `deploy/compose.yaml`. Under Compose sequence merge rules,
its ordinary `env_file` list appends to the base list, leaving `/etc/whim/server.env` available.
That file supplies the production provider key. The replay server then fails closed before it
starts, so the inherited HTTP health check later reports the container unhealthy.

The live run built and started the replay image, received Compose unhealthy, restored production,
and passed smoke. No device drive ran. The recovery removed replay logs, so the exact container
stderr was not retained; the configuration path explains the observed symptom.

## Constraints and invariants

- `server-deployment` “A load test measures capacity without spending provider credit” and D26
  require no provider activity. The pre-start production-key refusal remains a required backstop.
- `!reset` cannot be used because it removes the non-secret capacity values in `config.env`.
- An empty `OPENROUTER_API_KEY` environment entry would mask a value but still exposes the real
  key file; it does not satisfy file isolation.
- Docker Compose is not a gate dependency. The Node suite can guard source structure, while an
  attended no-daemon `docker compose config --format json` receipt proves the merged model.
- No real key may be read, emitted, copied, or placed in a test fixture.

## Integration points

- Compose replacement tag: the replay service’s existing `env_file` field.
- Fast test seam: `testDeployFilesExcludeLoadtest()` in `server/test/loadtest.suite.ts`.
- Operator proof: `handoff/loadtest.md`, before replay start and task 15.4 drives.

## Risks and unknowns

- Local Docker Compose is `v5.4.0`; the VM reports `v5.5.1`. Local parsing of `!override` passed.
  I did not run the sentinel receipt on the VM; it is the required attended preflight.
- I did not inspect replay-container logs because cleanup had removed the container.
