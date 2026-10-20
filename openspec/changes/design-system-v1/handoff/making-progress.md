# Contract: making-progress (chain-17)

Interface only. Rules: spec prompt-flow (Making, Ready, Failure, Details), system.md §7.1 Step list, §8, §9.
Pure logic is Node-importable: `making-progress.ts`, `failure-kind.ts`, `prompt-flow.ts`, `home-live.ts`.
`handoff/making-sheet.md` and `handoff/home.md` point here for the run pages, Stop and the Failure page's Discard.

## Pages (props verbatim; each is a `KeyboardShell host="sheet"` body; `HostedPage` is gone)

```ts
MakingPage({ name: string /* attemptName(rec) or the app's name */; changing: boolean; words: string;
  stage: Stage | null; delivering: boolean; queuedPosition?: number; repairAttempt?: number; stepSince?: number;
  signals: RunSignals | null /* this run's own */; now: number /* shell tick, 1 s */; activity: number /* 0–1 */;
  onStop(): void })
ReadyPage({ app: InstalledApp; words: string; onOpen(): void; onDone(): void })   // TilePlate size 'hero', Button 'tint'
FailurePage({ kind: FailureKind; reason: string; diagnostics: readonly { hint: string }[]; rephraseHelps: boolean;
  changing: boolean; journal?: readonly RunJournalEntry[] | null; attemptStarted?: boolean; notice?: FlowNotice;
  offline?: boolean; devMode?: boolean; onChange(): void; onRetry?(): void /* absent: no attempt */; onDismiss?(): void;
  onNotNow?(): void /* needs-update's Not now; the shell passes goHome */ })
```
Android back on all three is the sheet's close (`closeSheet`): none registers `useSheetBack` or `BackHandler`.
Making: close = leave running; Ready: close = Done; Failure: close = leave (tile and journal kept).

## Page state — `prompt-flow.ts`

```ts
MakingScreen += { repairAttempt?: number /* latest repair try; marker never moves back up */; stepSince?: number }
ReadyScreen  += { runId?: string; text: string }
withStreamEvent(screen: MakingScreen, event: GenerationEvent, at: number): MakingScreen  // stamps stepSince when the marker moves
withDelivering(screen: MakingScreen, at: number): MakingScreen
readyStep(prev: MakingScreen, app): ReadyScreen     // carries runId + text
pageKeyOf(ready) = `run:${runId ?? app.id}`         // one key from the first frame to Ready/Failure
PlanProblem += { offline?: true }                   // reason COPY.planOffline, neutral notice
```
`runAttempt` sets the page only once the attempt id exists: `{ ...opening, runId, stepSince: startedAt }` (no `run:starting` frame).

## Progress — `making-progress.ts`

```ts
MAKING_TIMES = { measuredBy, medianMs: 53_000, p90Ms: 144_000, worstMs: 225_000, usualUntilMs: 75_000, longerUntilMs: 150_000 }
makingTimeLine(elapsedMs): string                    // ≤75 s usual, ≤150 s longer, else slow (copy.ts making*)
type MakingRowState = 'done' | 'current' | 'waiting'
MakingRow { key: 'step:0'..'step:3' | 'repair'; label; state; elapsed?: string /* m:ss, current row only */ }
MakingEmber { state: 'working' | 'stuck'; activity: number }
MakingProgress { rows: readonly MakingRow[]; line: string; ember: MakingEmber }
makingProgress(state: Pick<MakingScreen,'stage'|'delivering'|'queuedPosition'|'repairAttempt'|'stepSince'>,
  signals: RunSignals | null, now: number, activity: number): MakingProgress
```
Line priority: in line (`makingQueueLine(position)`) > stalled (`makingStallLine(40)`) > time line from `turnCameAt ?? startedAt`.
Repair row `makingRepairLine(min(N, 3), 3)` sits under the check; while it is current the check reads done.

## Stream-activity signal (the Ember consumes it; chain-22)

```ts
// home-live.ts (unchanged API)
activityOf(tokensPerSecond): number                  // clamp(t/40, 0, 1)
sampleLive(attempts: { id; signals: LiveSignals }[], previous: Map<string, LiveSample>, now): LiveView
LiveView { queued: ReadonlySet<string>; activity: Readonly<Record<string /* run id */, number>> }
useHomeLive(active: boolean, attempts: () => readonly { id; signals }[]): LiveView   // samples every 1 s while active
```
- `LauncherRoot.liveView` is active while the screen is `home` OR `making`; Home tiles read `activity[rec.id]`, the
  Making page reads `activity[screen.runId] ?? 0` and passes it through `makingProgress(...).ember`.
- Tokens per second count `token` events plus reasoning (`thinkingChars / 4`); first sample of a run is 0.
- In line: ember `working` at activity 0 (still, dim). Stuck: `livenessOf(signals, now) === 'stalled'` (no frame,
  keepalives included, for `STALL_MS` 40 s) → `Ember state 'stuck'`, AmbientLight activity 0.
- Not provided yet: §4.6 flicker (token arrival in the last 500 ms) — derive from `RunSignals.lastTokenAt`.
- `Ember({ size: 20|24|48|96|128; state: 'working'|'stuck'|'out'; activity?; spark? })`, `AmbientLight({ width; height; activity })`.

## Failure — `failure-kind.ts`

```ts
type FailureKind = 'couldnt-run' | 'refused' | 'needs-update' | 'closed' | 'stopped' | 'connection' | 'other'
FailureFacts { reason; rephraseHelps: boolean; repairs: number; interrupted?: 'closed' | 'stopped'; refused: boolean;
  cause?: PendingFailureCause; needsUpdate?: boolean }
failureKindOf(facts): FailureKind     // refused > interrupted > needsUpdate > cause 'connection' > repairs >= 3; never the reason text
failureCauseOf(failure?): PendingFailureCause | undefined  // stored cause; a cause-less old record: frozen legacy sentence
failureSentence(kind, { reason, rephraseHelps }): string | null    // null for 'refused' (its notice speaks)
FailureAction { move: 'change' | 'retry' | 'update' | 'not-now'; label; variant: 'ember' | 'ink' | 'plain' }
failureActions(kind, rephraseHelps, canRetry): readonly FailureAction[]  // needs-update: Update Whim (ink), Not now (plain)
type PendingFailureCause = 'connection'; PendingBuildFailure += { cause? }            // pending-builds.ts
stillNeedsUpdate(rec, protocolLevel): boolean  // build-lifecycle.ts, replaces reopenedRecord
openWhimUpdate(): Promise<void>                // UpdateRequiredScreen.tsx; the store link both pages open
```
- Shell `failure` screen += `interrupted?`, `cause?`, `needsUpdate?: true`; repairs = live `counts.repair`, or
  `repairAttemptsIn(journal)` (run-timeline-view.ts) when reopened from a tile with a readable journal.
- A stream that ends without a terminal event, or a network error mid-run, settles with reason `COPY.failureConnection`,
  remedy `{ kind: 'retry' }`, `cause: 'connection'` (`settleFailed(…, { remedy, cause })`); Try again is disabled while
  `showOfflineIndicator`. Storage-degraded settlements (generic reason) store no cause.
- A record an `update` fallback ended reopens from its tile as kind `needs-update` while `stillNeedsUpdate` (its notice
  under What happened). The LIVE fallback, the `update_required` refusal, the launch check and Report still open
  `UpdateRequiredScreen` (generation-contract fallback rule; service-refusals), which stays for them.
- "What happened" rows: `runTimelineRows(journal, devMode, sentence, true)` + hints it lacks, each a `GroupedRow`.
- Discard (`onDiscardFromFailure`, replaces `onDismissPending`) = Home's tile Discard: `purgeWindows.armAttempt(id)`, then
  `goHome()`, `warning` haptic, toast `COPY.discardedToast` + Undo, `onEnd` → `finish('attempt', id)` (6 s; the window is the
  toast's). Undo restores record, journal and Failure page untouched (arming deletes nothing); too late → `undoTooLateToast`.
  A marker that can't be written: nothing changes, the page stays. Whim closed mid-window: the launch sweep finishes it.
- `completePurge` for an attempt: record + order, then journal, each tried regardless, then read back; anything left throws,
  so the marker stays (tile hidden) and the next launch retries; once all reads back gone, `pending.forgetRetained(id)`
  drops a volatile view. `PendingBuildStore.retainDiscardFailure` is gone (no in-process "retained generic" ghost).

## Stop and records — `pending-builds.ts`

```ts
PendingBuildRecord += { stopped?: true }            // only on 'interrupted'; absent = Whim closed under it
PendingBuildStore.stop(id: string): void           // building → interrupted, stopped: true
```
Stop (Making page `onStopMaking`, tile menu `onCancelPending`) aborts at once; a new app keeps its record (stopped tile,
journal kept) and lands on Home; a change (`editingAppId`) is dropped, its app untouched.
Delivery wins: once `delivering` (stream ended with a result, install under way) the Making page renders no Stop and
`stopLiveAttempt(live): boolean` returns false without touching anything (tile menu Stop included; it stays in the menu).
Closing the sheet (or an app link) detaches the page's own run (`detachSelectedRun`), so a delivery under way toasts.

## Delivery and the toast

Selected and attached → Ready. Otherwise, when the screen is `home`: `toast.show({ message: readyTitle(name),
action: { label: COPY.actionOpen, onPress: () => onOpen(app) } })` through `toastRef` (`ToastBridge` inside the one
`ToastHost`). Over a running app nothing is shown yet: the orb's ember dot is chain-19's.

## For chain-18 (opening)
Ready's `Open it` and the toast's `Open` both call `LauncherRoot.onOpen(app)`; no tile rect is measured on Ready yet.
