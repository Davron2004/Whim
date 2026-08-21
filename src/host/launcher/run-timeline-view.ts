/**
 * run-timeline-view — the run timeline's gate and its pure view logic (generation-observability,
 * design D7; `prompt-flow` "The build screen offers a details affordance into the run timeline",
 * "The failure screen includes a what-happened timeline section", "Dev mode adds diagnostics and
 * repair-attempt counts to the run timeline").
 *
 * Free of `react-native` on purpose, exactly like `dev-log-view.ts`: which rows a journal becomes,
 * in what order, and what the dev gate lets through are the parts that can be wrong, and the
 * launcher's Node acceptance suite cannot bundle React Native. `RunTimeline.tsx` is the thin
 * `View`/`Text` mapping over what is decided here.
 *
 * A journal is NEVER a source of truth (`generation-run-journal`): an absent or empty journal
 * produces no rows at all, and the screen shows its modest empty note — never a fabricated run and
 * never a different verdict from the pending-build record it sits beside.
 */

import type { RunJournalEntry } from './run-journal';
import { stageDurations } from './prompt-flow';
import { timelineGrowthLine, timelineStageLabel, timelineStageLine } from './copy';

/**
 * The build-time flag that adds the developer counts to the timeline, in the `RUN_*_PROBE` idiom
 * (App.tsx, decision #60(c)). DEFAULT `false`: it is flipped by hand in a local working copy and
 * never committed as `true`, which is what keeps the counts out of a shipping build.
 */
export const SHOW_RUN_TIMELINE_DIAGNOSTICS = false;

/**
 * The counts' gate: `__DEV__` OR the explicit flag — never `__DEV__` alone, because this project's
 * working build recipe is a RELEASE build, where `__DEV__` is `false` and a `__DEV__`-only surface
 * is unreachable in the build the project actually runs (decision #60(c)).
 */
export function runTimelineDevModeEnabled(dev: boolean, flag: boolean = SHOW_RUN_TIMELINE_DIAGNOSTICS): boolean {
  return dev || flag;
}

/** The dev counts' labels. Mechanism words, deliberately NOT in `copy.ts` — the same standing the
 *  dev log overlay's own labels have: they exist only behind the flag above. */
const DIAGNOSTICS_COUNT_LABEL = 'Diagnostics';
const REPAIR_ATTEMPTS_COUNT_LABEL = 'Repair attempts';

/**
 * A row's role, which is all the renderer needs to know: the stage spine, the output-growth
 * summary, the permitted failure detail, and the flag-gated developer counts. There is no row kind
 * for a raw token or a diagnostic's `kind`/`symbol`/`message` — the timeline cannot render one
 * because nothing here can produce one.
 */
export type TimelineRowKind = 'stage' | 'growth' | 'reason' | 'hint' | 'dev';

export interface TimelineRow {
  readonly key: string;
  readonly kind: TimelineRowKind;
  readonly text: string;
}

/** The cumulative character count the journal's newest `aggregate` entry recorded, or `null` when
 *  no aggregate was ever written (a run that failed before any output arrived). */
function outputChars(journal: readonly RunJournalEntry[]): number | null {
  for (let i = journal.length - 1; i >= 0; i -= 1) {
    const entry = journal[i];
    if (entry.kind === 'aggregate' && entry.aggregates != null) return entry.aggregates.chars;
  }
  return null;
}

/** The LAST terminal entry's failure detail. A journal may hold TWO terminal entries — a stream
 *  that produced a result, then a delivery that failed — and the later one is what actually ended
 *  the attempt. */
function lastFailure(journal: readonly RunJournalEntry[]): RunJournalEntry['failure'] | null {
  for (let i = journal.length - 1; i >= 0; i -= 1) {
    const entry = journal[i];
    if (entry.kind === 'terminal') return entry.failure ?? null;
  }
  return null;
}

/** How many repair attempts this journal actually recorded — one per `repair` stage entry, never
 *  a number invented for a run that never reached repair. */
function repairAttempts(journal: readonly RunJournalEntry[]): number {
  return journal.filter((entry) => entry.kind === 'stage' && entry.stage === 'repair').length;
}

/**
 * The timeline as its readable list of rows: the stage transitions with their durations, the
 * output-growth summary, then the failure detail the failure surfaces already permit (`reason` and
 * each diagnostic `hint` — the journal stores nothing else, so no `kind`, `symbol` or raw
 * `message` can reach a row). `devMode` appends the two observed counts and nothing else.
 */
export function runTimelineRows(
  journal: readonly RunJournalEntry[],
  devMode = false,
): readonly TimelineRow[] {
  const rows: TimelineRow[] = [];

  for (const [i, transition] of stageDurations(journal).entries()) {
    rows.push({
      key: `stage:${i}`,
      kind: 'stage',
      text: timelineStageLine(timelineStageLabel(transition.stage), transition.durationMs),
    });
  }

  const chars = outputChars(journal);
  if (chars != null) rows.push({ key: 'growth', kind: 'growth', text: timelineGrowthLine(chars) });

  const failure = lastFailure(journal);
  if (failure != null) {
    rows.push({ key: 'reason', kind: 'reason', text: failure.reason });
    for (const [i, diagnostic] of (failure.diagnostics ?? []).entries()) {
      rows.push({ key: `hint:${i}`, kind: 'hint', text: diagnostic.hint });
    }
  }

  // No journal, no timeline — and therefore nothing for the counts to be counts OF.
  if (devMode && journal.length > 0) {
    const diagnostics = failure?.diagnostics?.length ?? 0;
    rows.push({ key: 'dev:diagnostics', kind: 'dev', text: `${DIAGNOSTICS_COUNT_LABEL}: ${diagnostics}` });
    rows.push({ key: 'dev:repairs', kind: 'dev', text: `${REPAIR_ATTEMPTS_COUNT_LABEL}: ${repairAttempts(journal)}` });
  }

  return rows;
}
