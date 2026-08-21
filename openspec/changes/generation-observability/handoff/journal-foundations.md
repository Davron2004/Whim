# Contract: journal-foundations (chain-1)

Interface only. Two modules: `src/host/launcher/run-journal.ts` (new) and four pure helpers added
to `src/host/launcher/prompt-flow.ts`.

## Shared types (verbatim, `src/host/launcher/run-journal.ts`)

```ts
export interface RunAggregates { chars: number; tokens: number }

export interface RunJournalFailure {
  reason: string;
  diagnostics?: readonly { hint: string }[];
}

export type RunJournalEntryKind = 'stage' | 'aggregate' | 'terminal';

export interface RunJournalEntry {
  t: number;                     // epoch ms at append time
  kind: RunJournalEntryKind;
  stage?: Stage;                 // 'stage' only — WIRE vocabulary, from prompt-flow.ts
  aggregates?: RunAggregates;    // 'aggregate' only — cumulative running totals
  failure?: RunJournalFailure;   // 'terminal' only, and only on failure
}

export type RunJournal = readonly RunJournalEntry[];
```

## Store API (verbatim)

```ts
export const JOURNAL_KEY = (launcherId: string) => `journal:${launcherId}`;
export const LAST_RUN_KEY = (appId: string) => `lastrun:${appId}`;
export const AGGREGATE_THROTTLE_MS = 5_000;
export const JOURNAL_ENTRY_CAP = 200;

export class RunJournalStore {
  constructor(kv: KVBackend, now?: () => number);          // now defaults to Date.now
  create(launcherId: string): void;
  get(launcherId: string): RunJournal | null;
  getLastRun(appId: string): RunJournal | null;
  appendStage(launcherId: string, stage: Stage): void;
  appendAggregate(launcherId: string, aggregates: RunAggregates): void;
  appendTerminal(launcherId: string, terminal?: { failure?: RunJournalFailure }): void;
  moveToLastRun(launcherId: string, appId: string): void;
  delete(launcherId: string): void;
}
```

`KVBackend` is `../version-store/fs/kv-fs#KVBackend` — construct the store over the SAME backend
instance `PendingBuildStore` is constructed over. Single-writer discipline is the caller's, exactly
as for `PendingBuildStore`: only the shell instance driving the stream appends.

## Invariants the store enforces (callers may rely on these, and must not re-implement them)

- **Throttle.** `appendAggregate` is leading-edge throttled to at most one entry per
  `AGGREGATE_THROTTLE_MS`, derived from the journal's own newest `aggregate` entry (so it survives
  a store re-instantiation mid-attempt). Call it on every `token` event — do not pre-throttle.
- **Terminal is never throttled.** `appendTerminal` always writes, immediately.
- **Failure re-projection.** `appendTerminal` re-builds `failure` as `{ reason, diagnostics:
  [{hint}] }`; a richer diagnostic object passed in cannot leak `kind`/`symbol`/`message` into
  storage. Callers should still pass hints only.
- **Cap/eviction.** Appending at `JOURNAL_ENTRY_CAP` evicts the OLDEST `aggregate` entry first.
  `stage`/`terminal` entries are never evicted; a journal made only of them grows past the cap
  (spec: "Stage and terminal entries survive eviction"). Overshoot stays bounded.
- **`moveToLastRun`** copies `journal:<launcherId>` to `lastrun:<appId>` (overwriting any prior
  report) then deletes the source key. A missing/unreadable source writes NOTHING to
  `lastrun:<appId>` — a prior report is left intact, never emptied or fabricated.
- **Auto-create on append.** Appending to an id with no journal creates it. `create` is still the
  correct call at generation start (it establishes the empty journal the spec requires).
- **Corrupt tolerance.** An unreadable journal reads as `null` (logged via `CHANNELS.app`), never
  thrown. No method throws.

## Pure helpers (verbatim, `src/host/launcher/prompt-flow.ts`)

```ts
export const EMPTY_RUN_AGGREGATES: RunAggregates;             // { chars: 0, tokens: 0 }
export const HEARTBEAT_QUIET_MS = 8_000;

export function accumulateRunAggregates(prev: RunAggregates, event: GenerationEvent): RunAggregates;
export function elapsedLabel(startedAt: number, now: number): string;
export function quietSecondsSince(lastArrivalAt: number, now: number): number | null;

export interface StageDuration { stage: Stage; durationMs: number | null }
export function stageDurations(journal: readonly RunJournalEntry[]): StageDuration[];
```

- `accumulateRunAggregates` folds ONE stream event into the running totals; only `type: 'token'`
  moves them (`chars += text.length`, `tokens += 1`). Any other event returns `prev` by
  **reference** (safe as a React state updater). Token text is counted and discarded.
- `elapsedLabel` returns `m:ss` (`0:00`, `0:07`, `1:05`, `12:30`); `now < startedAt` → `'0:00'`.
- `quietSecondsSince` returns whole seconds quiet, or `null` when not quiet enough to report. The
  threshold must be EXCEEDED: exactly `HEARTBEAT_QUIET_MS` still returns `null`. Feed it the
  timestamp of the last `token`/`stage` arrival; a fresh arrival makes it `null` immediately.
- `stageDurations` maps a journal's `stage` entries to consecutive-transition durations; the last
  stage ends at the `terminal` entry if present, else `durationMs` is `null` (still running).
  Non-stage entries are ignored; negative deltas clamp to `0`.

## Error surface

None. No method or helper throws; there are no new error types and no new failure modes for a
caller to handle. Journal loss degrades to "no timeline", never to a failed run.

## Tests

`src/host/launcher/test/run-journal.suite.ts` + `run-signals.suite.ts`, wired into
`test/acceptance.ts` (`npm run launcher:test`). The store's clock is injected — never sleep.
