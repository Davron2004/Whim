# Contract: browser-launch (chain-3, #139)

Consumers: chain-6 (runbook prose, decision entry). Tasks 7.x read these lines from production logs.

## Attempt bound (`synthrun/session.ts`)

- A failed `chromium.launch` is retried up to **3 attempts in total**, **500 ms** apart.
- Boot (`SynthRunSession.launch`) and every relaunch after `browser_disconnected` share the same
  loop (`launchBrowser`, called only from `startBrowser`).
- Every attempt is the one sanctioned call `chromium.launch(browserLaunchOptions())`. The options
  are deep-equal on every attempt, with `chromiumSandbox: true`. No retry uses weaker options.
- When the 3rd attempt fails, the session rejects with
  `SessionError('browser_launch_failed', 'synthrun session: the browser failed to launch in 3 attempts: <error message>')`.
  At boot, that becomes `BootError('browser_launch')`, then `boot failed` with `reason: "browser_launch"`
  and exit 1, as before. On a relaunch, only the run that needed the browser fails, as before.
- If the session is closed during the pause between attempts, it stops retrying and rejects with
  `Error('synthrun session: the session closed while its browser was launching')`.

## Session option

```ts
export type LaunchFailure = { attempt: number } & ({ signal: string } | { error: string });

export interface SessionOptions {
  concurrency?: number;
  semaphore?: Semaphore;
  /** Called once per failed launch attempt, the last one included, before any retry. */
  onLaunchFailure?: (failure: LaunchFailure) => void;
}
```

- `signal` comes from Playwright's call-log line `<process did exit: exitCode=…, signal=SIG…>`
  in the launch error. When the log names a signal, the failure carries `signal` (for example
  `"SIGSEGV"`) and no `error`.
- Otherwise the failure carries `error`, which is the **first line** of the launch error message only
  (for example `browserType.launch: Executable doesn't exist at …`). The browser's call log and
  command line are never included.

## Log lines (`server/src/lifecycle.ts`, pino JSON)

| `msg` | level | `scope` | fields | when |
|---|---|---|---|---|
| `boot host` | info | `boot` | `cpuModel`, `pku`, `ospke`, `kernel` | once, real pipeline only, immediately before the first launch attempt |
| `browser launch failed` | warn | `browser` | `attempt` + (`signal` \| `error`) | once per failed attempt, at boot and on relaunch |

- `cpuModel`: the first `model name` value in `/proc/cpuinfo`, or `"unknown"`.
- `pku`, `ospke`: `true`/`false` for whether the flag is in the first `flags` line of
  `/proc/cpuinfo`, or `"unknown"` when there is no flags line or the file is unreadable (any
  non-Linux host).
- `kernel`: `os.release()`, or `"unknown"` if it is empty.
- The stub pipeline launches no browser, so it logs neither line.
- Apart from pino's base fields (`level`, `severity`, `time`, `pid`, `hostname`, `scope`, `msg`),
  neither record carries anything else.

## Example (Cloud Run filter material for chain-6 / task 7.x)

```json
{"level":30,"severity":"INFO","scope":"boot","cpuModel":"AMD EPYC 7B13","pku":true,"ospke":true,"kernel":"6.1.0","msg":"boot host"}
{"level":40,"severity":"WARNING","scope":"browser","attempt":1,"signal":"SIGSEGV","msg":"browser launch failed"}
```

The values in the example are illustrative and were not observed in production.
