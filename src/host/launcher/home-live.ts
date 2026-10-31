/**
 * home-live — what Home shows of attempts that are running right now: which ones wait for a free
 * spot, how hard each stream is working (system.md §4.6 Honest light: activity
 * `a = clamp(tokensPerSecond / 40, 0, 1)`, reasoning included), which ones stalled (no progress event
 * for `STALL_MS`, as the Making page says), and each run's flicker pulse, which its arrivals move.
 * Sampled from the live attempts' in-memory signals about once a second while Home is on screen;
 * nothing here is persisted, and the counts are never read back from a journal. No React import.
 */

import { livenessOf, type RunSignals } from './prompt-flow';

/** The activity of a stream writing this many tokens a second (§4.6: calibrated against real runs). */
export const FULL_ACTIVITY_TOKENS_PER_SECOND = 40;
/** Reasoning is reported in characters; a token is about this many. */
const CHARS_PER_TOKEN = 4;

/** The part of an attempt's signals Home reads (`RunSignals`, structurally). */
export interface LiveSignals extends Pick<RunSignals, 'lastTokenAt' | 'lastThinkingAt' | 'lastProgressAt'> {
  inLine?: boolean;
  aggregates: { tokens: number; thinkingChars?: number };
}

/** A run's flicker pulse (system.md §4.6): −1…1 right after an arrival, back to 0 within 500 ms of
 *  the last one. A Reanimated shared value that every light of the run reads (`run-light.ts`). */
export interface FlickerPulse {
  readonly value: number;
}

/** One running attempt as Home reads it. */
export interface LiveAttemptView {
  id: string;
  signals: LiveSignals;
  pulse?: FlickerPulse;
}

export interface LiveSample {
  readonly tokens: number;
  readonly at: number;
}

export interface LiveView {
  readonly queued: ReadonlySet<string>;
  readonly activity: Readonly<Record<string, number>>;
  /** No progress event for `STALL_MS`: the run's light is stuck. */
  readonly stalled: ReadonlySet<string>;
  readonly flicker: Readonly<Record<string, FlickerPulse>>;
}

export const NO_LIVE_VIEW: LiveView = { queued: new Set(), activity: {}, stalled: new Set(), flicker: {} };

export const activityOf = (tokensPerSecond: number): number =>
  Math.min(1, Math.max(0, tokensPerSecond / FULL_ACTIVITY_TOKENS_PER_SECOND));

const tokensSoFar = (signals: LiveSignals): number =>
  signals.aggregates.tokens + Math.round((signals.aggregates.thinkingChars ?? 0) / CHARS_PER_TOKEN);

/**
 * The view at `now` over the running attempts. `previous` holds each attempt's last sample and is
 * updated in place (attempts that ended are dropped); an attempt seen for the first time has no
 * rate yet and reads as idle.
 */
export function sampleLive(attempts: readonly LiveAttemptView[], previous: Map<string, LiveSample>, now: number): LiveView {
  const queued = new Set<string>();
  const stalled = new Set<string>();
  const activity: Record<string, number> = {};
  const flicker: Record<string, FlickerPulse> = {};
  const live = new Set<string>();
  for (const { id, signals, pulse } of attempts) {
    live.add(id);
    if (signals.inLine === true) queued.add(id);
    if (livenessOf(signals, now) === 'stalled') stalled.add(id);
    if (pulse) flicker[id] = pulse;
    const tokens = tokensSoFar(signals);
    const before = previous.get(id);
    const seconds = before ? (now - before.at) / 1000 : 0;
    activity[id] = before && seconds > 0 ? activityOf(Math.max(0, tokens - before.tokens) / seconds) : 0;
    previous.set(id, { tokens, at: now });
  }
  for (const id of previous.keys()) if (!live.has(id)) previous.delete(id);
  return { queued, activity, stalled, flicker };
}

const sameSet = (a: ReadonlySet<string>, b: ReadonlySet<string>): boolean => a.size === b.size && [...a].every((id) => b.has(id));

function sameRecord<T>(a: Readonly<Record<string, T>>, b: Readonly<Record<string, T>>): boolean {
  const ids = Object.keys(a);
  return ids.length === Object.keys(b).length && ids.every((id) => a[id] === b[id]);
}

export function sameLiveView(a: LiveView, b: LiveView): boolean {
  return sameSet(a.queued, b.queued) && sameSet(a.stalled, b.stalled) && sameRecord(a.activity, b.activity) && sameRecord(a.flicker, b.flicker);
}
