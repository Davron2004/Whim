# Contract: synthrun-resilience (written by chain-7)

Interface for chain 11 (drain, boot, e2e 12.6). Source: `synthrun/session.ts`, `synthrun/concurrency.ts`, `synthrun/abort.ts`, `synthrun/report.ts`, `synthrun/contract.ts`. Builds on `handoff/synthrun-launch.md`, which still holds unchanged.

## Session errors

```ts
export type SessionErrorName = 'browser_disconnected' | 'browser_launch_failed';
export class SessionError extends Error {
  override name: SessionErrorName;
  constructor(name: SessionErrorName, message: string);
}
```

- `browser_disconnected`: the browser a run was on went away (crash, kill, or `session.close()`) before the run finished.
- `browser_launch_failed`: `chromium.launch(browserLaunchOptions())` rejected. The message is `synthrun session: the browser failed to launch: <underlying message>` (Linux without a sandbox: `No usable sandbox!`).
- `SynthRunSession.launch()` now rejects with `browser_launch_failed` rather than the raw Playwright error. Boot must still treat that as a named boot failure, with no retry using weaker options.

## How they reach the run stage

`createRunCandidate(session)(source, opts)` rejects with the `SessionError` itself. The run-stage adapter (`server/src/generation/stages/run.ts`) is unchanged and lets the rejection through. The machine's top-level catch turns it into exactly one generic `failure` event (`GENERIC_INTERNAL_ERROR_REASON`) plus its `usage`. When the request signal has already aborted, that catch returns silently and emits nothing. A crash never becomes a candidate diagnostic and never triggers a repair round.

## Abort surface (`RunOptions.signal`)

The bound is 5 s from the abort to the page and context being closed and the slot released. The slot is released exactly once. Where the abort lands decides how the call ends:

| Wait | Behaviour | `openRun` / `runCandidate` |
|---|---|---|
| queued in `Semaphore.acquire` | waiter leaves the queue, never holds a slot, opens no context | rejects `AbortError` |
| replacement browser launching | launch continues and is adopted; slot released | rejects `AbortError` |
| before context creation, during `beforeNavigate`, during `page.goto` | context closed, slot released | rejects `AbortError` |
| awaiting mount | wait ends within one 15 ms poll, sweep skipped, run disposes | resolves with a report to discard |
| sweep | `withTotalBudget` closes the page, run disposes | resolves with a report to discard |

`AbortError` is a plain `Error` with `name === 'AbortError'` (`abortError()` in `synthrun/abort.ts`). The caller's `signal.reason` is not propagated.

```ts
export interface Semaphore {
  /** Abort: the waiter MUST leave the queue without holding a slot and reject with an AbortError.
   *  The returned release function is idempotent. */
  acquire(signal?: AbortSignal): Promise<() => void>;
}
export async function awaitMount(obs: AttachedObservers, budgets: RunBudgets, signal?: AbortSignal): Promise<ObservedDiagnostic | null>;
// abort ⇒ returns null and appends no diagnostic
```

A caller-supplied `Semaphore` must honour the signal. A semaphore that ignores it leaves an aborted waiter queued until a slot frees.

## RunContext additions

```ts
export interface RunContext {
  // ...existing fields
  /** Aborts when RunOptions.signal aborts or the run's browser disconnects. Every wait honours it. */
  signal: AbortSignal;
  /** The browser_disconnected SessionError once the run's browser has disconnected, else null. */
  browserLost(): SessionError | null;
}
```

`OpenRunResult.dispose()` is memoized. A second call returns the first call's promise and does no second close or release.

## Relaunch semantics

- The session keeps one current browser. On `browser.on('disconnected')` it forgets that browser, stores the `browser_disconnected` error on it, and aborts every run's `ctx.signal` that is still on it.
- Relaunch is lazy. The next `openRun` (after it acquires its slot) or `browserProcessId()` launches a replacement. Nothing relaunches while no run needs the browser.
- Launching is single-flight. Concurrent callers share one pending launch, so a crash with N queued runs costs one launch.
- A failed launch rejects every caller that shared it with `browser_launch_failed`. The session then forgets it, and the next caller launches again. The session never stays dead.
- There is exactly one launch call site: `chromium.launch(browserLaunchOptions())` in `SynthRunSession`'s private `startBrowser`. The first launch and every relaunch go through it. `test/isolation.ts` still enforces one sanctioned call.
- `close()` sets the session closed, closes the current browser (in-flight runs end `browser_disconnected`), and closes any browser still launching. Afterwards, `openRun`/`browserProcessId` reject with a plain `Error('synthrun session: the session is closed')`. `close()` is idempotent.

## Observability

```ts
SynthRunSession.openContextCount(): number; // contexts open on the current browser; 0 when none is live
```

This is what "the session has no open context" means for e2e 12.6. Slot freedom is shown by a follow-up `openRun` on a concurrency-1 session, or by a counting `Semaphore` passed as `SessionOptions.semaphore`.

## Proof (synthrun/test/resilience.ts, from acceptance.ts)

Covered: abort while queued (no context, first run unaffected), abort 250 ms into a hanging mount (context closed once and slot released once, both within 5 s, no `mount_timeout`), a browser killed mid-run (`browser_disconnected` within 5 s, next run clean on a new PID, relaunched with `browserLaunchOptions()`, sandbox switches absent), and a failed relaunch followed by retry with one launch shared by two concurrent runs. Each was red-checked against its weaker variant.
