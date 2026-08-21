/**
 * run-signals Node suite (generation-observability chain-1, task 2.3) — the pure derivation
 * helpers behind the build screen's liveness signals and the timeline's stage durations
 * (`prompt-flow/spec.md` ADDED "derived activity signals" and "stall heartbeat"; design D6/D7).
 *
 * These are the helpers, not the render: elapsed formatting, cumulative aggregation, the ~8s
 * heartbeat threshold (including its boundary and the no-quiet-indication case), and mapping a
 * journal's stage entries to consecutive-transition durations.
 */

import { Harness } from './harness';
import type { GenerationEvent } from '@whim/contract';
import type { RunJournalEntry } from '../run-journal';
import {
  EMPTY_RUN_AGGREGATES,
  HEARTBEAT_QUIET_MS,
  accumulateRunAggregates,
  elapsedLabel,
  quietSecondsSince,
  stageDurations,
} from '../prompt-flow';

const token = (text: string): GenerationEvent => ({ type: 'token', text });

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

  await h.test('accumulateRunAggregates: a non-token event returns the previous totals unchanged', async () => {
    const prev = { chars: 12, tokens: 2 };
    const stage: GenerationEvent = { type: 'stage', stage: 'generate', status: 'start' };
    h.ok(accumulateRunAggregates(prev, stage) === prev, 'the same object comes back, so a state setter sees no change');
    const diagnostic: GenerationEvent = {
      type: 'diagnostic',
      diagnostic: { kind: 'typecheck', hint: 'a name is used before it exists', message: 'TS2304' },
    };
    h.eq(accumulateRunAggregates(prev, diagnostic), prev, 'a diagnostic never moves the output counter');
  });

  // ── heartbeat ───────────────────────────────────────────────────────────────
  await h.test('quietSecondsSince: a healthy stream shows no quiet indication', async () => {
    h.eq(quietSecondsSince(1000, 1000), null, 'an event that just arrived is not quiet');
    h.eq(quietSecondsSince(1000, 4000), null, 'three seconds of quiet is still under the threshold');
  });

  await h.test('quietSecondsSince: the threshold must be exceeded, not merely reached', async () => {
    const last = 1000;
    h.eq(quietSecondsSince(last, last + HEARTBEAT_QUIET_MS - 1), null, 'one millisecond short of the threshold stays silent');
    h.eq(quietSecondsSince(last, last + HEARTBEAT_QUIET_MS), null, 'exactly at the threshold still reads as healthy');
    h.eq(quietSecondsSince(last, last + HEARTBEAT_QUIET_MS + 1), 8, 'one millisecond past it reports the quiet duration');
  });

  await h.test('quietSecondsSince: the reported duration grows in whole seconds as the stall continues', async () => {
    h.eq(quietSecondsSince(0, 12_400), 12, 'twelve-and-a-bit seconds quiet reads as 12');
    h.eq(quietSecondsSince(0, 30_000), 30, 'and keeps climbing');
  });

  await h.test('quietSecondsSince: a fresh arrival clears the indication immediately', async () => {
    const now = 20_000;
    h.eq(quietSecondsSince(1000, now), 19, 'quiet while the last arrival stays old');
    h.eq(quietSecondsSince(now, now), null, 'the instant a token or stage arrives, lastArrivalAt is now and the indication clears');
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
