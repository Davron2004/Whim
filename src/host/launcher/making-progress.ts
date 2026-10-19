/**
 * making-progress — what the Making page shows of one run, decided without React (system.md §7.1
 * Step list, §8 making-time lines, §9 Making; `prompt-flow` "The Making page shows honest progress
 * without internals").
 *
 * Everything here reads the run's own page state (`MakingScreen`: its stage, place in line, repair
 * try and when the marker last moved) and its own in-memory signals, so a page can never show
 * another run's progress, and nothing here reads a token's text, a diagnostic or the transport.
 * No `react-native` import: the launcher's Node suite exercises it directly.
 */
import type { EmberState } from '../ui/tokens-pure';
import { COPY, makingQueueLine, makingRepairLine, makingStallLine, REPAIR_ATTEMPT_LIMIT } from './copy';
import { activeBuildStepIndex, BUILD_STEPS, elapsedLabel, livenessOf, STALL_MS, type MakingScreen, type RunSignals } from './prompt-flow';

/**
 * How long making takes, as measured (system.md §8): production flowbench, 22 runs — 53 s median,
 * 144 s p90, 225 s worst. The time lines' thresholds sit with the run that measured them: a run is
 * usual until a little past the median, longer than most until the p90, then slow.
 */
export const MAKING_TIMES = {
  measuredBy: 'production flowbench, 22 runs',
  medianMs: 53_000,
  p90Ms: 144_000,
  worstMs: 225_000,
  usualUntilMs: 75_000,
  longerUntilMs: 150_000,
} as const;

/** The time line for a run that has been making for `elapsedMs` (its time in line not counted). */
export function makingTimeLine(elapsedMs: number): string {
  if (elapsedMs <= MAKING_TIMES.usualUntilMs) return COPY.makingTimeUsual;
  return elapsedMs <= MAKING_TIMES.longerUntilMs ? COPY.makingTimeLonger : COPY.makingTimeSlow;
}

export type MakingRowState = 'done' | 'current' | 'waiting';

/** One row of the step list: a named step, or the repair row under the check. */
export interface MakingRow {
  readonly key: string;
  readonly label: string;
  readonly state: MakingRowState;
  /** The time on the current row (`m:ss`); only the current row carries one. */
  readonly elapsed?: string;
}

/** How the page's ember burns: following the stream, held still and dim in line, stuck at 35%. */
export interface MakingEmber {
  readonly state: Extract<EmberState, 'working' | 'stuck'>;
  /** Stream activity 0–1 (system.md §4.6); 0 while in line or stuck. */
  readonly activity: number;
}

export interface MakingProgress {
  readonly rows: readonly MakingRow[];
  /** The one line under the words: the place in line, the stall, or the time line. */
  readonly line: string;
  readonly ember: MakingEmber;
}

/** The part of the page state this reads. */
export type MakingState = Pick<MakingScreen, 'stage' | 'delivering' | 'queuedPosition' | 'repairAttempt' | 'stepSince'>;

const REPAIR_ROW_AFTER = BUILD_STEPS.indexOf(COPY.buildStepChecking);

/** The rows in order, the repair row (when a repair happened) right under the check. */
function rowKeys(state: MakingState): { key: string; label: string }[] {
  const steps = BUILD_STEPS.map((label, i) => ({ key: `step:${i}`, label }));
  if (state.repairAttempt === undefined) return steps;
  const repair = { key: 'repair', label: makingRepairLine(Math.min(state.repairAttempt, REPAIR_ATTEMPT_LIMIT), REPAIR_ATTEMPT_LIMIT) };
  return [...steps.slice(0, REPAIR_ROW_AFTER + 1), repair, ...steps.slice(REPAIR_ROW_AFTER + 1)];
}

/** Every row above the marker is done, the marker's row is current, the rest wait; in line,
 *  nothing has started. */
function stepRows(state: MakingState, current: string | null, elapsed: string | undefined): MakingRow[] {
  const keys = rowKeys(state);
  const marker = current === null ? -1 : keys.findIndex((row) => row.key === current);
  return keys.map(({ key, label }, i) => {
    if (marker < 0 || i > marker) return { key, label, state: 'waiting' };
    if (i < marker) return { key, label, state: 'done' };
    return { key, label, state: 'current', ...(elapsed ? { elapsed } : {}) };
  });
}

/** The row the marker is on: none in line, the repair row while a repair is the latest news and
 *  delivery has not started, else the active step. Never moves back up past a repair. */
function currentRow(state: MakingState): string | null {
  if (state.queuedPosition !== undefined) return null;
  if (state.repairAttempt !== undefined && !state.delivering) return 'repair';
  return `step:${activeBuildStepIndex(state.stage, state.delivering)}`;
}

/**
 * The Making page at `now`: its rows, its one line and its ember. `signals` is this run's own
 * (`null` when the shell holds none for it); `activity` is its sampled stream activity.
 */
export function makingProgress(state: MakingState, signals: RunSignals | null, now: number, activity: number): MakingProgress {
  const current = currentRow(state);
  const elapsed = current !== null && state.stepSince !== undefined ? elapsedLabel(state.stepSince, now) : undefined;
  const rows = stepRows(state, current, elapsed);
  if (state.queuedPosition !== undefined) {
    return { rows, line: makingQueueLine(state.queuedPosition), ember: { state: 'working', activity: 0 } };
  }
  if (signals !== null && livenessOf(signals, now) === 'stalled') {
    return { rows, line: makingStallLine(STALL_MS / 1000), ember: { state: 'stuck', activity: 0 } };
  }
  const making = signals === null ? 0 : now - (signals.turnCameAt ?? signals.startedAt);
  return { rows, line: makingTimeLine(making), ember: { state: 'working', activity } };
}
