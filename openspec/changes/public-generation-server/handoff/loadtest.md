# loadtest (chain-16) — for chain-13

Design D26; specs/server-deployment "A load test measures capacity without spending provider credit".

## `runLoadtestServer` (`server/src/loadtest/server.ts`)

```ts
export const LOADTEST_ROSTER: ModelRoster = { engineer: 'loadtest/engineer', rewrite: 'loadtest/rewrite' };
export const LOADTEST_INERT_API_KEY = 'loadtest-no-network';
export const LOADTEST_HEALTHZ_SERVICE = 'whim-server-loadtest';

export class LoadtestConfigError extends Error { readonly reason: 'config' }

export interface RunLoadtestServerOptions {
  env: NodeJS.ProcessEnv;
  listen?: StartServerOptions['listen'];
  /** Chain-11's real `startServer`, or a test double. REQUIRED — this module never value-imports
   *  `lifecycle.ts` (only its types), so the fast Node suite never pulls `synthrun`/`playwright`
   *  into its static bundle. The one production caller is `server/loadtest-server.entry.mjs`. */
  start: (options: StartServerOptions) => Promise<ServerHandle>;
}
export interface LoadtestServerHandle extends ServerHandle {
  /** Fetch-trap call count. Must stay 0 for the server's whole life. */
  fetchCallCount(): number;
}
export async function runLoadtestServer(options: RunLoadtestServerOptions): Promise<LoadtestServerHandle>;
```

Refuses (`LoadtestConfigError`, `reason: 'config'`) before touching `start` when `env.OPENROUTER_API_KEY`
is set, or when `WHIM_LOADTEST_ENGINEER_TURN_MS`/`WHIM_LOADTEST_REWRITE_TURN_MS` aren't positive integers.
Otherwise forces `NODE_ENV=production`, `OPENROUTER_API_KEY=loadtest-no-network`, and
`WHIM_ENGINEER_MODEL`/`WHIM_REWRITE_MODEL` = the fixed roster onto the env `start` sees; every other
`config.ts` production refusal still applies. Installs a counting `fetch` trap (throws on any call)
before calling `start`, restored the first time the returned handle's `drain()`/`close()` resolves.
Overrides: the replay model (`replay-model.ts`), a stats transport resolving every id at zero cost, a
credit transport reporting `limit_remaining: null` (no limit, never refuses), and a `wrapApp` that
answers `/healthz` with `{ ok: true, service: 'whim-server-loadtest' }` before falling through.

`createReplayModel({ roster, engineerTurnMs?, rewriteTurnMs?, fixtures? })` (`replay-model.ts`) answers
every call deterministically, paced by role (engineer default 15000ms, rewrite default 1000ms — the
`WHIM_LOADTEST_*_TURN_MS` env names). `loadRotationFixtures(cwd?)` returns every top-level
`fixtures/*.app.tsx` that passes `runStaticChecks` with no error diagnostic, sorted by name; engineer
generate/repair turns rotate across it.

## Driver (`server/src/loadtest/drive.ts`, CLI `server/loadtest.mjs`)

```
node server/loadtest.mjs --target <https url> --devices <N> --cap <C> [--json <file>] [--stats <file>]
```

`--stats <file>` is the CSV `run.sh drive`'s sampler collects: one `cpuPercent,memoryPercent` pair per
line (both `docker stats`-native percentages — no byte-unit conversion). Prints the JSON report to
stdout (and `--json <file>` if given) and exits 0 iff `verdict.ok`.

Report shape (`LoadTestReport` + `verdict`):

```ts
interface LoadTestReport {
  devices: number; cap: number;
  timeToFirstEventMs: { p50: number; p95: number };
  totalMs: { p50: number; p95: number };
  terminals: { result: number; failure: number; none: number };
  refusals: Record<string, number>;       // by ApiError.error code, e.g. "server_busy"
  leakProbe: { ok: boolean; detail?: string };
  peak?: { peakCpuPercent: number; peakMemoryPercent: number };
}
```

**Exit rule** (`verdict(report)`): fails when any run ended in a `failure` terminal, when any refusal
happened with `devices <= cap` (a refusal while devices EXCEEDS cap is expected and does not fail), or
when `leakProbe.ok` is false. `leakProbe(baseUrl, cap, roundDelayMs = 5000)` starts `cap` fresh devices
twice (`roundDelayMs` apart), aborting each right after its first event; a `server_busy` refusal in
either round fails it. Exported pure pieces for testing: `feedSseBuffer`, `parseGenerationEvent`,
`percentile`, `parseStatsCsv`/`peakStats`, `buildReport`, `verdict`, `parseArgs`, `readPeakStats`.
Network pieces (`runDevice`, `runDevices`, `leakProbe`) capture `fetch` at module load, before any
trap installs — never affected by a load-test server's own trap when driven in-process (tests only).

## `deploy/loadtest/run.sh` (bash 3.2-compatible, sources `deploy/lib.sh` read-only)

| Command | Does |
|---|---|
| `run.sh start` | Refuses on a dirty tree or unless `git rev-parse HEAD` equals the VM's currently-deployed tag (read from `/opt/whim/.env`'s `WHIM_IMAGE`). Builds `.../whim/server-loadtest:<sha>` via `deploy/loadtest/cloudbuild.yaml` if Artifact Registry lacks it. Uploads `compose.loadtest.yaml` to `/opt/whim/loadtest/`, `docker compose stop whim-server`, wipes+re-owns (10001:10001, 0700) `/mnt/disks/whim-data/loadtest`, then `up -d --wait` with `compose.yaml` + the override, polling `/healthz` for `whim-server-loadtest`. |
| `run.sh drive --devices <N> --cap <C> [--json <file>]` | Samples `docker stats` on the VM over IAP every 2s into a temp CSV while running `node server/loadtest.mjs --target https://$WHIM_API_HOST …` from the operator's machine, then stops the sampler. |
| `run.sh stop` | `docker compose up -d --wait whim-server` from `compose.yaml` ALONE (recreates production), then `deploy/smoke.sh`. |

Image: `<region>-docker.pkg.dev/<project>/whim/server-loadtest:<full sha>`. `deploy/loadtest/Dockerfile`
builds from `${SERVER_IMAGE}` (the already-built production image of the same commit) plus one bundle;
its sibling `Dockerfile.dockerignore` overrides the root `.dockerignore`'s `deploy/` exclusion.
`compose.loadtest.yaml` overrides only `whim-server`: the load-test image, `env_file` reset to
`/etc/whim/config.env` alone (no `server.env`), the `WHIM_LOADTEST_*_TURN_MS` pacing vars, and
`/mnt/disks/whim-data/loadtest:/data`. `cap_add`/`security_opt` are untouched (inherited from
`compose.yaml`) — Chromium's sandbox needs both.

## Production exclusion (fast-gate tripwires, `server/test/loadtest.suite.ts`)

`bundleServerEntry({ entry: 'server/src/main.ts', write: false })`'s metafile inputs contain nothing
under `server/src/loadtest/` (red-checked: a planted import into a probe entry DOES trip it). None of
`deploy/Dockerfile`, `cloudbuild.yaml`, `compose.yaml`, `deploy.sh`, `resize.sh` mention `loadtest`
(any case) — `deploy/loadtest/*` is exempt by construction (different directory).
