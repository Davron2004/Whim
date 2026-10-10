/**
 * home-live — what Home shows of attempts that are running right now: which ones wait for a free
 * spot, and how hard each stream is working (system.md §4.6 Honest light: activity
 * `a = clamp(tokensPerSecond / 40, 0, 1)`, reasoning included). Sampled from the live attempts'
 * in-memory signals about once a second while Home is on screen; nothing here is persisted, and the
 * counts are never read back from a journal. No React import.
 */

/** The activity of a stream writing this many tokens a second (§4.6: calibrated against real runs). */
export const FULL_ACTIVITY_TOKENS_PER_SECOND = 40;
/** Reasoning is reported in characters; a token is about this many. */
const CHARS_PER_TOKEN = 4;

/** The part of an attempt's signals Home reads (`RunSignals`, structurally). */
export interface LiveSignals {
  inLine?: boolean;
  aggregates: { tokens: number; thinkingChars?: number };
}

export interface LiveSample {
  readonly tokens: number;
  readonly at: number;
}

export interface LiveView {
  readonly queued: ReadonlySet<string>;
  readonly activity: Readonly<Record<string, number>>;
}

export const NO_LIVE_VIEW: LiveView = { queued: new Set(), activity: {} };

export const activityOf = (tokensPerSecond: number): number =>
  Math.min(1, Math.max(0, tokensPerSecond / FULL_ACTIVITY_TOKENS_PER_SECOND));

const tokensSoFar = (signals: LiveSignals): number =>
  signals.aggregates.tokens + Math.round((signals.aggregates.thinkingChars ?? 0) / CHARS_PER_TOKEN);

/**
 * The view at `now` over the running attempts. `previous` holds each attempt's last sample and is
 * updated in place (attempts that ended are dropped); an attempt seen for the first time has no
 * rate yet and reads as idle.
 */
export function sampleLive(
  attempts: readonly { id: string; signals: LiveSignals }[],
  previous: Map<string, LiveSample>,
  now: number,
): LiveView {
  const queued = new Set<string>();
  const activity: Record<string, number> = {};
  const live = new Set<string>();
  for (const { id, signals } of attempts) {
    live.add(id);
    if (signals.inLine === true) queued.add(id);
    const tokens = tokensSoFar(signals);
    const before = previous.get(id);
    const seconds = before ? (now - before.at) / 1000 : 0;
    activity[id] = before && seconds > 0 ? activityOf(Math.max(0, tokens - before.tokens) / seconds) : 0;
    previous.set(id, { tokens, at: now });
  }
  for (const id of [...previous.keys()]) if (!live.has(id)) previous.delete(id);
  return { queued, activity };
}

export function sameLiveView(a: LiveView, b: LiveView): boolean {
  const ids = Object.keys(a.activity);
  return (
    a.queued.size === b.queued.size &&
    [...a.queued].every((id) => b.queued.has(id)) &&
    ids.length === Object.keys(b.activity).length &&
    ids.every((id) => a.activity[id] === b.activity[id])
  );
}
