/**
 * run-signals Node suite (generation-observability chain-1, task 2.3; build-liveness B1) — the
 * pure derivation helpers behind the build screen's liveness signals and the timeline's stage
 * durations (`prompt-flow/spec.md` ADDED "derived activity signals"; design D6/D7).
 *
 * These are the helpers, not the render: elapsed formatting, cumulative aggregation (now `token`
 * AND `thinking`), the three-clock `livenessOf` derivation (including every boundary), the
 * liveness copy strings, the keepalive fold, and mapping a journal's stage entries to
 * consecutive-transition durations. The old single ~8s "quiet" heartbeat is GONE — see
 * `prompt-flow.ts`'s `livenessOf` doc comment for why one clock could not tell "thinking" from
 * "hanging" apart.
 */

import { Harness } from './harness';
import type { GenerationEvent } from '@whim/contract';
import type { RunJournalEntry } from '../run-journal';
import { COPY, makingQueueLine } from '../copy';
import { MAKING_TIMES, makingTimeLine } from '../making-progress';
import {
  EMPTY_RUN_AGGREGATES,
  STALL_MS,
  THINKING_WINDOW_MS,
  WRITING_WINDOW_MS,
  accumulateRunAggregates,
  elapsedLabel,
  livenessOf,
  stageDurations,
  withKeepalive,
  type RunSignals,
} from '../prompt-flow';

const token = (text: string): GenerationEvent => ({ type: 'token', text });
const thinking = (chars: number): GenerationEvent => ({ type: 'thinking', chars });

/** A signals fixture with every clock explicit, so each test only has to state what it's
 *  overriding. */
function signals(overrides: Partial<RunSignals> = {}): RunSignals {
  return {
    startedAt: 0,
    aggregates: EMPTY_RUN_AGGREGATES,
    lastTokenAt: null,
    lastThinkingAt: null,
    lastFrameAt: 0,
    ...overrides,
  };
}

export async function runRunSignalsTests(h: Harness): Promise<void> {
  // ── elapsed time ────────────────────────────────────────────────────────────
  await h.test('elapsedLabel: renders m:ss and advances with the clock', async () => {
    h.eq(elapsedLabel(1000, 1000), '0:00', 'a stream that just started reads zero');
    h.eq(elapsedLabel(1000, 8400), '0:07', 'sub-second remainders round down, never up');
    h.eq(elapsedLabel(1000, 66_000), '1:05', 'past a minute it reads m:ss with a padded seconds field');
    h.eq(elapsedLabel(0, 750_000), '12:30', 'and keeps counting past ten minutes');
  });

  await h.test('elapsedLabel: a now before the start reads 0:00, never a negative', async () => {
    h.eq(elapsedLabel(5000, 4000), '0:00', 'clock skew degrades to zero');
  });

  // ── cumulative aggregation ──────────────────────────────────────────────────
  await h.test('accumulateRunAggregates: token events accumulate cumulative chars and tokens', async () => {
    let acc = EMPTY_RUN_AGGREGATES;
    h.eq(acc, { chars: 0, tokens: 0 }, 'nothing observed yet');
    acc = accumulateRunAggregates(acc, token('const'));
    acc = accumulateRunAggregates(acc, token(' total'));
    acc = accumulateRunAggregates(acc, token(' = 0;'));
    h.eq(acc, { chars: 16, tokens: 3 }, 'running totals, not per-tick deltas');
  });

  await h.test('accumulateRunAggregates: counts the token text without carrying it', async () => {
    const acc = accumulateRunAggregates(EMPTY_RUN_AGGREGATES, token('secret source'));
    h.eq(Object.keys(acc).sort((a, b) => a.localeCompare(b)), ['chars', 'tokens'], 'only the two numeric fields exist');
    h.ok(!JSON.stringify(acc).includes('secret source'), 'no token text survives the fold');
  });

  await h.test('accumulateRunAggregates: a non-token, non-thinking event returns the previous totals unchanged', async () => {
    const prev = { chars: 12, tokens: 2 };
    const stage: GenerationEvent = { type: 'stage', stage: 'generate', status: 'start' };
    h.ok(accumulateRunAggregates(prev, stage) === prev, 'the same object comes back, so a state setter sees no change');
    const diagnostic: GenerationEvent = {
      type: 'diagnostic',
      diagnostic: { kind: 'typecheck', hint: 'a name is used before it exists', message: 'TS2304' },
    };
    h.eq(accumulateRunAggregates(prev, diagnostic), prev, 'a diagnostic never moves the output counter');
  });

  await h.test('accumulateRunAggregates: thinking events accumulate a SEPARATE cumulative count', async () => {
    let acc = EMPTY_RUN_AGGREGATES;
    acc = accumulateRunAggregates(acc, thinking(400));
    acc = accumulateRunAggregates(acc, thinking(1_200));
    h.eq(acc, { chars: 0, tokens: 0, thinkingChars: 1_600 }, 'thinkingChars accumulates independently of chars/tokens');
    acc = accumulateRunAggregates(acc, token('const x = 1;'));
    h.eq(acc, { chars: 12, tokens: 1, thinkingChars: 1_600 }, 'a later token moves chars/tokens without disturbing it');
  });

  // ── liveness: thinking distinguished from hanging (build-liveness B1) ───────
  await h.test('livenessOf: a recent token reads as writing', async () => {
    h.eq(livenessOf(signals({ lastTokenAt: 10_000, lastFrameAt: 10_000 }), 10_000 + WRITING_WINDOW_MS), 'writing', 'exactly at the window is still writing');
    h.eq(
      livenessOf(signals({ lastTokenAt: 10_000, lastFrameAt: 10_000 }), 10_000 + WRITING_WINDOW_MS + 1),
      'connected',
      'one ms past it, writing has lapsed — and with no thinking clock set at all, it falls through to connected',
    );
  });

  await h.test('livenessOf: writing beats thinking when both clocks are recent', async () => {
    const s = signals({ lastTokenAt: 10_000, lastThinkingAt: 10_000, lastFrameAt: 10_000 });
    h.eq(livenessOf(s, 10_000), 'writing', 'a token this instant wins even if thinking is equally recent');
  });

  await h.test('livenessOf: a recent thinking delta reads as thinking once writing has lapsed', async () => {
    const s = signals({ lastTokenAt: 0, lastThinkingAt: 10_000, lastFrameAt: 10_000 });
    h.eq(livenessOf(s, 10_000 + THINKING_WINDOW_MS), 'thinking', 'exactly at the window is still thinking');
    h.eq(livenessOf(s, 10_000 + THINKING_WINDOW_MS + 1), 'connected', 'one ms past it, thinking has lapsed too');
  });

  await h.test('livenessOf: no token or thinking delta at all falls straight to connected/stalled', async () => {
    const s = signals({ lastFrameAt: 0 });
    h.eq(livenessOf(s, STALL_MS), 'connected', 'a keepalive-only stream is connected, not stalled, up to the boundary');
    h.eq(livenessOf(s, STALL_MS + 1), 'stalled', 'one ms past it, nothing has arrived at all');
  });

  await h.test('livenessOf: minutes of thinking never read as a stall, however long it takes', async () => {
    // The reported bug, restated as a test: DeepSeek-class models reason for minutes before
    // writing. As long as a `thinking` event (or the keepalive) keeps arriving, the screen must
    // never say "stalled" just because no VISIBLE output has shown up yet.
    const s = signals({ lastThinkingAt: 120_000, lastFrameAt: 120_000 });
    h.eq(livenessOf(s, 123_000), 'thinking', 'still reads as thinking two minutes into a run with no token yet');
  });

  await h.test('withKeepalive: moves ONLY the any-frame clock, and takes no journal to move it in', async () => {
    const s = signals({ lastTokenAt: 1_000, lastThinkingAt: 500, aggregates: { chars: 9, tokens: 1 }, lastFrameAt: 1_000 });
    const after = withKeepalive(s, 9_000);
    h.eq(after.lastFrameAt, 9_000, 'the any-frame clock moves to the keepalive');
    h.eq(after.lastTokenAt, 1_000, 'the token clock is untouched');
    h.eq(after.lastThinkingAt, 500, 'so is the thinking clock');
    h.eq(after.aggregates, s.aggregates, 'and the output counters never move for a keepalive');
    h.eq(after.startedAt, s.startedAt, 'nor does the attempt start time');
  });

  // ── the Making page's time lines (system.md §8) ─────────────────────────────
  await h.test('makingTimeLine: a slow run says so honestly — 80 s still writing reads "Taking longer than most"', async () => {
    h.eq(makingTimeLine(40_000), COPY.makingTimeUsual, 'under the median: the usual range');
    h.eq(makingTimeLine(80_000), 'Taking longer than most. Still going.', 'the spec’s 80 s scenario');
    h.eq(makingTimeLine(200_000), COPY.makingTimeSlow, 'past the p90: slow, still going');
  });

  await h.test('makingTimeLine: the thresholds sit where the measured runs put them, and each line holds up to its threshold', async () => {
    const t = MAKING_TIMES;
    h.ok(t.medianMs < t.usualUntilMs && t.usualUntilMs < t.p90Ms, 'a run stops being usual past the median, before the p90');
    h.ok(t.p90Ms <= t.longerUntilMs && t.longerUntilMs < t.worstMs, 'and is slow past the p90, which the worst run passed');
    h.eq([makingTimeLine(t.usualUntilMs), makingTimeLine(t.usualUntilMs + 1)], [COPY.makingTimeUsual, COPY.makingTimeLonger], 'usual up to its threshold');
    h.eq([makingTimeLine(t.longerUntilMs), makingTimeLine(t.longerUntilMs + 1)], [COPY.makingTimeLonger, COPY.makingTimeSlow], 'longer than most up to its threshold');
  });

  await h.test('makingQueueLine: two runs ahead reads "2 ahead of you."; at the front, it is next', async () => {
    h.eq(makingQueueLine(3), '2 ahead of you.', 'position 3 has two ahead');
    h.eq(makingQueueLine(1), COPY.makingQueuedNext, 'position 1 is next');
  });

  // ── stage durations ─────────────────────────────────────────────────────────
  await h.test('stageDurations: consecutive stage entries become transition durations', async () => {
    const journal: RunJournalEntry[] = [
      { t: 1000, kind: 'stage', stage: 'plan' },
      { t: 3000, kind: 'stage', stage: 'generate' },
      { t: 9000, kind: 'stage', stage: 'check' },
      { t: 9500, kind: 'terminal' },
    ];
    h.eq(stageDurations(journal), [
      { stage: 'plan', durationMs: 2000 },
      { stage: 'generate', durationMs: 6000 },
      { stage: 'check', durationMs: 500 },
    ], 'each stage lasts until the next one; the last lasts until the terminal entry');
  });

  await h.test('stageDurations: the stage a run is still in has no duration yet', async () => {
    const journal: RunJournalEntry[] = [
      { t: 1000, kind: 'stage', stage: 'plan' },
      { t: 3000, kind: 'stage', stage: 'generate' },
    ];
    h.eq(stageDurations(journal), [
      { stage: 'plan', durationMs: 2000 },
      { stage: 'generate', durationMs: null },
    ], 'an unfinished stage reports null rather than a fabricated duration');
  });

  await h.test('stageDurations: aggregate entries are ignored, never turned into transitions', async () => {
    const journal: RunJournalEntry[] = [
      { t: 1000, kind: 'stage', stage: 'plan' },
      { t: 2000, kind: 'aggregate', aggregates: { chars: 40, tokens: 8 } },
      { t: 4000, kind: 'aggregate', aggregates: { chars: 90, tokens: 17 } },
      { t: 5000, kind: 'stage', stage: 'generate' },
      { t: 6000, kind: 'terminal', failure: { reason: 'it did not run' } },
    ];
    h.eq(stageDurations(journal), [
      { stage: 'plan', durationMs: 4000 },
      { stage: 'generate', durationMs: 1000 },
    ], 'the timeline spine is the stage entries alone');
  });

  await h.test('stageDurations: an empty or stage-free journal yields no rows', async () => {
    h.eq(stageDurations([]), [], 'an empty journal');
    h.eq(stageDurations([{ t: 1, kind: 'terminal' }]), [], 'a journal with no stage entry at all');
  });

  await h.test('stageDurations: an out-of-order timestamp clamps to zero rather than going negative', async () => {
    const journal: RunJournalEntry[] = [
      { t: 5000, kind: 'stage', stage: 'plan' },
      { t: 4000, kind: 'stage', stage: 'generate' },
      { t: 4500, kind: 'terminal' },
    ];
    h.eq(stageDurations(journal).map((r) => r.durationMs), [0, 500], 'no negative duration ever reaches the timeline');
  });
}
