# runtime-tree (chain-11) — for chains 12, 13, 16

## Tree layout

`node server/build.mjs` (from anywhere; it moves to the repo root) replaces `server/dist/app/` with exactly:

```
server/main.mjs          server/main.mjs.map          # bundled server/src/main.ts
server/whim-admin.mjs    server/whim-admin.mjs.map    # bundled server/src/admin/main.ts (operator CLI)
docs/sdk-reference.md    docs/content-policy.md
fixtures/{navigation-demo,pour-over-timer,style-gallery,tip-splitter,water-counter}.app.tsx
build/react-inject-shim.ts
src/runtime/generated/runtime-artifacts.json          # needs `npm run build` first
```

Asset list source of truth: `RUNTIME_ASSETS` in `server/src/runtime-assets.ts`. Externals = `server/package.json`
dependencies minus `@whim/*`: `@hono/node-server`, `esbuild`, `hono`, `pino`, `playwright`, `typescript`
(subpaths included). They must resolve from a `node_modules` at or above the tree root; nothing else is read
from outside the tree except `WHIM_DATA_DIR`. `server/dist/` is gitignored (not in `.eslintignore`).

## Start

- Server: cwd = tree root, `node --enable-source-maps server/main.mjs`.
- Operator CLI: cwd = tree root, `node server/whim-admin.mjs <subcommand>` (grammar: `handoff/admin-contract.md`).
- Required in production (`NODE_ENV=production`): `OPENROUTER_API_KEY`, `WHIM_ENGINEER_MODEL`, `WHIM_REWRITE_MODEL`
  (config refuses by name otherwise). Set `WHIM_DATA_DIR` (default `server/.data`, cwd-relative),
  `WHIM_SERVER_HOST`/`WHIM_SERVER_PORT` (default `0.0.0.0:8787`). Real pipeline needs Playwright's Chromium.
- Listening is logged as JSON `{"scope":"boot","url":"http://<host>:<port>","pipeline":"real"|"stub","msg":"whim-server listening"}`.

## Boot order and exit contract

config → preflight → model client → stores (+ report and ledger purge: at boot, then hourly, unref'd) →
[real pipeline only] session launch → boot self-test → app → listen. Nothing listens before the self-test passed.

Preflight, in order, first failure wins:
1. each `RUNTIME_ASSETS` path is a readable file → `runtime asset missing or unreadable: <path>`
2. `esbuild`, `playwright`, `typescript` resolve → `runtime package does not resolve: <name> (…)`
3. `process.umask(0o077)`; `mkdir -p WHIM_DATA_DIR` mode 0700; create+remove a probe file →
   `WHIM_DATA_DIR is not writable: <absolute dir> (…)`

Self-test: `fixtures/tip-splitter.app.tsx` through `createRunCandidate(session)` must give `contained === true`
and no `severity: 'error'` diagnostic; then `probeEgressBlocked(session).blocked` must be true.

Any boot failure: one JSON log `{"level":60,"reason":<BootFailureReason>,"detail":<message naming the item>,
"msg":"boot failed"}`, everything opened is closed, exit code **1**, no port bound.

```ts
export type BootFailureReason =
  | 'config' | 'preflight' | 'model' | 'stores' | 'browser_launch' | 'self_test' | 'composition' | 'listen';
export class BootError extends Error { readonly reason: BootFailureReason }
export async function runBootSelfTest(session: SynthRunSession, cwd?: string /* process.cwd() */): Promise<void>;
```

## Drain (first SIGTERM or SIGINT → `handle.drain()`, then exit 0)

1. `slots.startDraining()` (every new admission → `429 server_busy`), `server.close()`, `closeIdleConnections()`;
   logs `msg: "drain started"`.
2. Wait until every connection has closed (idle ones re-closed every 25 ms), up to `WHIM_DRAIN_TIMEOUT_MS`
   (default `WHIM_GENERATION_MAX_MS + 30000` = 630000). A stream that finishes in time is delivered whole.
3. If connections remain: `InFlightGenerations.abortAll()` + `closeAllConnections()` (client-disconnect semantics).
4. Final window **10 s** total: wait for generation+unary slots to reach 0, then `ResolveTracker.drain` (looped).
5. `closeAllConnections()`, stop purges, `session.close()` (bounded **10 s**), close both stores; exit 0.

Second signal during the wait → skips to step 3. Worst case after the signal: drain timeout + 20 s. Known gap: real-pipeline drain is defeated until `browserLaunchOptions()` sets `handleSIGINT/SIGTERM/SIGHUP: false`
(Playwright closes Chromium on SIGTERM/SIGHUP and exits 130 on SIGINT) — pending a decision, see chain-11 report.

## `startServer` (verbatim, `server/src/lifecycle.ts`)

```ts
export interface Servable {
  fetch(request: Request, env: HttpBindings | Http2Bindings): unknown;
}
export interface StartServerOverrides {
  model?: { client: ModelClient; roster: ModelRoster };
  statsTransport?: UsageAndCostTransport;
  creditTransport?: CreditTransport;
  wrapApp?: (app: ReturnType<typeof createApp>) => Servable;
}
export interface StartServerOptions {
  env: NodeJS.ProcessEnv;
  overrides?: StartServerOverrides;
  listen?: { host?: string; port?: number };
}
export interface ServerHandle {
  readonly url: string;
  readonly config: ServerConfig;
  readonly session: SynthRunSession | undefined;
  drain(): Promise<void>;
  close(): Promise<void>;
}
export async function startServer(options: StartServerOptions): Promise<ServerHandle>;
```

- `env` is data: config comes from `loadServerConfig(env)`; no override is env-selectable. `main.ts` passes
  `process.env` and no overrides, and owns the signal handlers and `process.exit`.
- `model` replaces the client+roster for the pipeline, the policy classifier, rewrite and clarify
  (`buildModelDepsFromEnv` is then not called). Without it, the real pipeline needs `OPENROUTER_API_KEY` + roster.
- `statsTransport` / `creditTransport` default to the OpenRouter ones only when `OPENROUTER_API_KEY` is set;
  otherwise none (the resolver's no-op transport; credit check skipped). Real one: `openRouterUsageAndCostTransport`
  in `server/src/usage/openrouter-stats.ts`; the credit transport resolves `globalThis.fetch` at creation.
- `wrapApp` gets the `/v1` app and returns what is served (e.g. an outer Hono answering `/healthz` itself).
- `listen` overrides `WHIM_SERVER_HOST`/`WHIM_SERVER_PORT`; port 0 allowed; `url` carries the bound port.
- `drain()`: first call runs the drain; a later call skips the wait; all calls share one never-rejecting promise.
  `close()` = drain with the wait skipped. Neither exits the process.
- Serving installs @hono/node-server's global `Request`/`Response`; in-process suites save and restore both
  property descriptors. `session` is the live synthetic-run session (real pipeline) for observation only.

## `bundleServerEntry` (verbatim, `server/build.mjs`; types in `server/build.d.mts`)

```ts
export function bundleServerEntry(options: { entry: string; outfile: string; write?: boolean }): Promise<string[]>;
export function buildRuntimeTree(options: { outDir: string }): Promise<void>;
```

- Settings: `bundle`, `platform: 'node'`, `format: 'esm'`, `target: 'node22'`, `sourcemap: 'linked'`, `metafile`,
  `external` = the declared runtime packages, `absWorkingDir: process.cwd()`. `write` defaults to `true`.
- Returns `Object.keys(metafile.inputs)`, relative to `process.cwd()`, which must be the repo root (safe to
  bundle into a suite). `entry`/`outfile` resolve against the cwd.
- `buildRuntimeTree` refuses an `outDir` equal to or containing the repo; it deletes `outDir` first.
