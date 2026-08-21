# Contract: shell-wiring (chain-2)

Interface only. Touches `LauncherRoot.tsx` (call sites), `build-lifecycle.ts` (one new export),
`prompt-flow.ts` (one type + one constant), `BuildStep.tsx` (prop surface only — nothing rendered).

## Shared types (verbatim, `src/host/launcher/prompt-flow.ts`)

```ts
export interface RunSignals {
  startedAt: number;      // epoch ms the attempt started (the moment Build it / Retry was taken)
  aggregates: RunAggregates;  // cumulative { chars, tokens } folded from the stream
  lastArrivalAt: number;  // epoch ms of the last `token`/`stage` arrival — the heartbeat's origin
}

export const RUN_SIGNAL_TICK_MS = 1_000;
```

## The prop surface `BuildStep` now receives (verbatim, `src/host/launcher/BuildStep.tsx`)

```ts
export interface BuildStepProps {
  stage: Stage | null;
  delivering: boolean;
  signals: RunSignals | null;   // NEW — null when the shell has none for this screen
  now: number;                  // NEW — the render's clock reading, moved by the shell's tick
  onLeaveRunning: () => void;
  onCancel: () => void;
}
```

Chain-3 (4.1/4.2) destructures them and derives, per render:

```ts
elapsedLabel(signals.startedAt, now)          // 'm:ss'
quietSecondsSince(signals.lastArrivalAt, now) // number | null — null = show no quiet indication
signals.aggregates.chars                      // the output-size counter
```

Both helpers are already exported from `prompt-flow.ts` (chain-1's contract). Do NOT add a second
clock, a second threshold, or a store read.

## Where the state lives and how it updates

- `LauncherShell` holds `signalsRef = useRef<RunSignals | null>(null)`. A **ref**, not state: it is
  rewritten on every `token` arrival, and a re-render per token is what this change refuses.
- One `RunSignals` object is threaded through the stream loop as a local; each fold returns a new
  object (same reference when nothing moved), mirrored into `signalsRef.current`.
- **Tick source:** one `useEffect` in `LauncherShell`, gated on `screen.kind === 'build'`, running
  `setInterval(..., RUN_SIGNAL_TICK_MS)` on a throwaway counter. It **reads nothing**.
- Render passes `signals={signalsRef.current} now={Date.now()}`.
- `signalsRef` is never nulled by a settling attempt (unlike `liveRef`): a newer attempt overwrites
  it, which is how it stays in step with the screen actually being shown.

## New export (verbatim, `src/host/launcher/build-lifecycle.ts`)

```ts
export function journalStreamEvent(
  journal: RunJournalStore,
  launcherId: string,
  signals: RunSignals,
  event: GenerationEvent,
  at: number,        // the arrival time; one clock reading per event
): RunSignals;
```

`stage` with `status: 'start'` → `appendStage` + `lastArrivalAt = at`; `status: 'done'` → **no
entry** (the wire emits both edges; journaling both doubles the spine and its durations, and
disagrees with the shell's `status === 'start'` repair tally) but `lastArrivalAt` still moves — a
`done` edge is liveness. `token` → cumulative fold + `appendAggregate` (the store throttles) +
`lastArrivalAt = at`. Anything else → no write, `signals` back **by reference**. Coverage:
`build-lifecycle.suite.ts` (incl. a replayed start/done stream) + `prompt-flow-wiring.suite.ts`.

## Journal calls, by loop point (all inside `LauncherShell`; single writer)

| Point in `runAttempt` / the shell | Call |
| --- | --- |
| immediately after `startPendingBuild` | `journal.create(attemptId)` |
| every stream event | `journalStreamEvent(journal, attemptId, signals, event, Date.now())` |
| stream ended with a `result`, before delivery | `journal.appendTerminal(attemptId, terminalCounts())` |
| `settleFailed` (terminal failure, stream-error, throw) | `journal.appendTerminal(id, { failure: { reason, diagnostics }, ...observed })` |
| after `await deliverAndSettle` resolved | `journal.moveToLastRun(attemptId, delivered.id)` |
| `dropAttempt` (cancel + dismiss) | `journal.delete(id)` beside `dropPendingBuild(pending, id)` |
| `onDelete`, after `await access.remove(app)` | `journal.deleteLastRun(app.id)` |

- Every terminal call carries `RunTerminalCounts` — `{ aggregates: signals.aggregates,
  observedDiagnostics: counts.diagnostic }`, built by `runAttempt`'s local `terminalCounts()`. This
  is the end-of-stream flush: the throttle's last window has no later arrival to close it.
- A user cancel writes **no** terminal entry; it deletes the journal with the record.
- `delivered.id`, not `attemptId`: a behind-tip rebuild delivers onto a fork with its own id.
- The store is `new RunJournalStore(launcherKv)` in `LauncherRoot`'s `useMemo`, on the same
  `KVBackend` as `PendingBuildStore`, passed to `LauncherShell` as the `journal` prop.

## What chains 3–5 must NOT do

- **No journal read on a tick or a render loop.** The build screen's live signals come from
  `signals`/`now` only. A *timeline* read (4.3/5.1/5.3/5.4) is on-demand on open, not per tick.
- **No second writer.** Only `LauncherShell` appends. A timeline/failure surface reads
  (`get`/`getLastRun`) and never appends, moves or deletes.
- **Never delete a pending record outside `dropAttempt`** — `prompt-flow-wiring.suite.ts` pins
  `dropPendingBuild(` to one call site so a record can't be dropped without its journal.
- **`BuildStep.tsx` source may not contain** `token`, `log`, `terminal`, `.kind`, `.symbol`, or any
  animation word (`Animated`/`Easing`/`fadeIn`) — pinned by `prompt-flow-screens.suite.ts`. Render
  `aggregates.chars`, never `aggregates.tokens`, and name locals accordingly.
- A journal **may hold two `terminal` entries** when delivery fails after a `result`. A consumer
  showing failure detail reads the **last**; `stageDurations` (which uses the first) is unaffected.

## chain-3 seam for chain-4 (task 5.4)
`BuildStep` renders the activity line, the heartbeat and a `Details` button; it holds NO visibility
state and reads nothing. The whole seam is `onShowDetails?: () => void` on `BuildStepProps`
(`onPress={onShowDetails}`). Chain-4 owns the open/close state and the read: hold it in
`LauncherShell`, render `RunTimeline` over `journal.get(attemptId)` read **on open**. Copy:
`COPY.buildDetails`, plus `buildActivityLine(elapsed, chars)` / `buildQuietLine(seconds)`.
`FailureScreen` also takes `attemptStarted={screen.journalId != null}`: false suppresses the
what-happened section entirely (a clarify/rewrite failure never started a run).

## Error surface
None. Every journal call is best-effort and non-throwing (chain-1's contract). A lost journal
degrades to "no timeline", never to a failed or lost run.
