# Contract: synthrun-launch (written by chain-6)

Interface for chains 7, 11 and 12. Source: `synthrun/session.ts`, `synthrun/contract.ts`, `synthrun/builder.ts`.

## Launch options (the only launch configuration)

```ts
export function browserLaunchOptions(): LaunchOptions {
  return {
    headless: true,
    chromiumSandbox: true,
    proxy: { server: 'http://127.0.0.1:9', bypass: '<-loopback>' },
    args: ['--host-resolver-rules=MAP * ~NOTFOUND', '--force-webrtc-ip-handling-policy=disable_non_proxied_udp', '--dns-prefetch-disable'],
  };
}
```

Invariants, enforced by `synthrun/test/isolation.ts`:
- Exactly one call site `chromium.launch(browserLaunchOptions())` exists across `synthrun/*.ts` and `server/src/**/*.ts`, in `session.ts`. A relaunch (chain-7) goes through that same call site. A second one fails the scan.
- No parameter, no `process.env` read inside it, no `ignoreDefaultArgs`, and `chromiumSandbox` is only ever the literal `true`. No string anywhere in those sources names a sandbox- or isolation-disabling switch.
- If the sandbox cannot start, `chromium.launch` rejects (Linux: `No usable sandbox!`). Callers surface that as boot failure. There is no retry with weaker options.

## Delivery and isolation

```ts
export const DELIVERY_ORIGIN = 'https://synthrun.invalid';
export function runPageUrl(runId: string): string; // `${DELIVERY_ORIGIN}/run/${runId}`

export interface EgressTally {
  readonly count: number;          // saturates at BLOCKED_EGRESS_CAP
  readonly firstAt: number | null; // Date.now() at the first refusal
}
export interface IsolatedContext { context: BrowserContext; egress: EgressTally }
export async function newIsolatedContext(browser: Browser, delivery?: { url: string; html: string }): Promise<IsolatedContext>;
```

- The context is created with `{ acceptDownloads: false }`. A `context.route('**/*')` fulfills only the first navigation request to `delivery.url`, and every other request is `abort('aborted')`ed and counted. A refused frame navigation commits no error page, so the realm survives. `context.routeWebSocket(/.*/)` closes every socket and counts it.
- Never pass Playwright's `serviceWorkers: 'block'`: it injects a script into the candidate's sandboxed realm, where it throws and surfaces as a candidate `runtime_throw` (20 existing checks go red). Service workers are blocked by Chromium in the opaque-origin realm and, for the outer page, by the abort-all route, which counts the worker script fetch.
- `RunContext` gains `egress: EgressTally` (the run's live tally). `openRun` no longer touches the filesystem.
- `SynthRunSession.browserProcessId(): Promise<number>` returns the OS pid of the session's browser process, via CDP `SystemInfo.getProcessInfo`.

## Trace field for blocked egress

```ts
export const BLOCKED_EGRESS_CAP = 16;
export interface TraceEntry { kind: 'syscall' | 'cue' | 'denial' | 'egress_blocked'; method: string; atMs: number }
export interface EgressBlockedTraceEntry extends TraceEntry {
  kind: 'egress_blocked';
  method: 'network';
  atMs: number;  // first refusal, from the run's startedAt
  count: number; // saturating at BLOCKED_EGRESS_CAP; a capped value reads "at least"
}
```

`createRunCandidate` appends at most one such entry, last in `RunReport.trace`, only when `ctx.egress.count > 0`. It is read once at report assembly. No URL is ever recorded. A clean candidate produces none: the existing `trace.length === 0` assertions hold. `RunReport` itself has no new field.

## Boot self-test probe

```ts
export interface EgressProbeResult {
  blocked: boolean;           // the pass condition
  canaryConnections: number;  // TCP connections the loopback canary accepted
  fetched: boolean;           // the in-page fetch got a response
  navigated: boolean;         // the harness-side navigation to the canary committed
  blockedCount: number;       // ctx.egress.count after the attempts
}
export async function probeEgressBlocked(session: SynthRunSession): Promise<EgressProbeResult>;
```

**Pass condition:** `blocked === (canaryConnections === 0 && !fetched && !navigated && blockedCount > 0)`.

The probe starts an HTTP canary on `127.0.0.1:0` and opens one real run (`openRun`, with a built-in harmless candidate), so it takes a concurrency slot. From the outer page's main frame it tries a `no-cors` fetch and a WebSocket to the canary, then navigates the main frame there. Each attempt is bounded to about 2 s (the navigation to about 4 s). The run is disposed and the canary closed before it returns. It never throws for a leak; it throws only if `openRun` does. The boot self-test must treat `blocked === false` as a named boot failure.

## Builder file-read boundary

```ts
export const CANDIDATE_RESOLVE_REFUSED = 'candidate_resolve_refused';
```

- Build entry and `build/react-inject-shim.ts` are the only resolvable files. `vc-sdk`, `react` and `react-dom` stay external. Any other specifier (a path, a package, `react-dom/client`, a subpath, `require`, dynamic `import()`, a re-export) rejects `buildCandidateSource`/`buildCandidateFile` with an esbuild `BuildFailure` whose `errors[0].text` starts with `candidate_resolve_refused: "<specifier>"`. The server build stage renders it as `build_failure` unchanged.
- An import whose binding is never used is erased by TypeScript semantics before resolution. It builds and reads nothing. The static checker still rejects it (`disallowed_import`).
- Output for honest candidates stays byte-identical to `build/build.mjs` (existing tripwire).

## Container and CI enablement

- Vendored profile: `deploy/seccomp/chromium-playwright-1.60.0.json` (byte-identical to Playwright v1.60.0 `utils/docker/seccomp_profile.json`, git blob `fddc05fb520affb145404e6f6f647ca96af8087d`). Its version must track the lockfile's Playwright.
- Used by `.devcontainer/devcontainer.json` `runArgs` and `.devcontainer/run-loop.sh` (`--security-opt seccomp=…`). Measured in the devcontainer image as user `node`: without the profile the launch fails with `No usable sandbox!`; with it every Chromium process runs with the sandbox on (seccomp mode 2). Deploy compose (chain-12) needs the same `security_opt`.
- `.github/workflows/invariants.yml` runs `sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0` before the Chromium suites. CI runs no synthrun or e2e suite, so this is unverified on the runner.
