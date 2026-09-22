/**
 * run-timeline Node suite (generation-observability chain-4, tasks 5.1–5.4), from
 * `prompt-flow/spec.md`: what a run journal becomes as timeline rows, and the flag-gated developer
 * counts — plus `generation-run-journal`'s "a journal is never a second source of truth" fallback.
 * The screens that show it are rendered in `failure-screen.suite.ts` (the what-happened section)
 * and `prompt-flow-ui.suite.tsx` (the build screen's Details sheet).
 *
 * Nothing here awaits a promise that could fail to settle.
 */

import { Harness } from './harness';
import { MapKVBackend } from '../../version-store';
import { journalStreamEvent } from '../build-lifecycle';
import { COPY, timelineDurationLabel, timelineGrowthLine, timelineStageLabel } from '../copy';
import { EMPTY_RUN_AGGREGATES, type RunSignals } from '../prompt-flow';
import { RunJournalStore, type RunJournalEntry } from '../run-journal';
import {
  SHOW_RUN_TIMELINE_DIAGNOSTICS,
  runTimelineRows,
} from '../run-timeline-view';

const stage = (t: number, s: RunJournalEntry['stage']): RunJournalEntry => ({ t, kind: 'stage', stage: s });
const aggregate = (t: number, chars: number, tokens: number, thinkingChars = 0): RunJournalEntry => ({
  t,
  kind: 'aggregate',
  aggregates: { chars, tokens, ...(thinkingChars > 0 ? { thinkingChars } : {}) },
});
const terminal = (
  t: number,
  failure?: RunJournalEntry['failure'],
  flush?: { aggregates?: { chars: number; tokens: number; thinkingChars?: number }; observedDiagnostics?: number },
): RunJournalEntry => ({
  t,
  kind: 'terminal',
  ...(flush?.aggregates ? { aggregates: flush.aggregates } : {}),
  ...(flush?.observedDiagnostics !== undefined ? { observedDiagnostics: flush.observedDiagnostics } : {}),
  ...(failure ? { failure } : {}),
});

const texts = (journal: readonly RunJournalEntry[], devMode = false) =>
  runTimelineRows(journal, devMode).map((r) => r.text);

export async function runRunTimelineTests(h: Harness): Promise<void> {
  // ── the stage spine and its durations (task 5.1) ────────────────────────────

  await h.test('timeline: stage transitions read as plain words with the time each one took', () => {
    const journal = [
      stage(1_000, 'plan'),
      stage(3_400, 'generate'),
      aggregate(5_000, 120, 20),
      stage(9_000, 'check'),
      terminal(12_000),
    ];
    const rows = runTimelineRows(journal);
    h.eq(
      rows.filter((r) => r.kind === 'stage').map((r) => r.text),
      [
        `${COPY.timelineStagePlan} · 2.4s`,
        `${COPY.timelineStageGenerate} · 5.6s`,
        `${COPY.timelineStageCheck} · 3.0s`,
      ],
      'one row per stage the device saw, in order, each with its own duration',
    );
    h.ok(
      rows.findIndex((r) => r.kind === 'growth') > rows.findIndex((r) => r.kind === 'stage'),
      'the output-growth summary comes after the stage spine, not interleaved with it',
    );
  });

  await h.test('timeline: the stage a run was still in has no duration invented for it', () => {
    const rows = texts([stage(1_000, 'plan'), stage(2_000, 'generate')]);
    h.eq(rows[1], `${COPY.timelineStageGenerate} · ${COPY.timelineStillGoing}`, 'the open stage says so instead');
    h.ok(!rows[1].includes('0.0s'), 'and never claims it took no time at all');
  });

  await h.test('timeline: durations read in tenths under a minute and in minutes above it', () => {
    h.eq(timelineDurationLabel(0), '0.0s', 'an instant transition still reads as a duration');
    h.eq(timelineDurationLabel(2_450), '2.5s', 'tenths of a second under a minute');
    h.eq(timelineDurationLabel(-500), '0.0s', 'a negative duration is never printed');
    h.eq(timelineDurationLabel(65_000), '1m 05s', 'past a minute it reads m ss with a padded seconds field');
    h.eq(timelineDurationLabel(59_960), '1m 00s', 'and never rounds up into a bare "60.0s"');
  });

  await h.test('timeline: every stage in the wire vocabulary has its own plain-words label', () => {
    const labels = (['plan', 'generate', 'check', 'run', 'repair'] as const).map(timelineStageLabel);
    h.eq(new Set(labels).size, labels.length, 'no two stages share a label — the timeline is a list, not four named steps');
    for (const label of labels) {
      h.ok(label.length > 0, 'the label is present');
      h.ok(!/token|diagnostic|stage|typecheck|error/i.test(label), `"${label}" carries no mechanism word`);
    }
  });

  // ── output growth (task 5.1) ────────────────────────────────────────────────

  await h.test('timeline: output growth is the newest cumulative SIZE, never any of the text', () => {
    const journal = [stage(1_000, 'generate'), aggregate(2_000, 40, 8), aggregate(7_000, 910, 96)];
    const growth = runTimelineRows(journal).filter((r) => r.kind === 'growth').map((r) => r.text);
    h.eq(growth, [timelineGrowthLine(910)], 'one row, from the newest aggregate entry');
    h.eq(timelineGrowthLine(910), 'Wrote 910 characters', 'it states a character count');
    h.eq(timelineGrowthLine(1), 'Wrote 1 character', 'one character is not "1 characters"');
    // The SHIPPING shape of a zero-output run: it failed during planning, no `token` ever arrived,
    // and its terminal entry still flushes counts — so the zero is RECORDED, not absent, and only
    // an explicit suppression keeps "Wrote 0 characters" off the screen.
    const noOutput = [
      stage(1_000, 'plan'),
      terminal(3_000, { reason: 'The app could not be built from that description.' }, {
        aggregates: { chars: 0, tokens: 0 },
        observedDiagnostics: 0,
      }),
    ];
    h.eq(
      runTimelineRows(noOutput).filter((r) => r.kind === 'growth').length,
      0,
      'a run that produced no output gets no growth row rather than a fabricated zero',
    );
    h.ok(
      !runTimelineRows(noOutput, true).map((r) => r.text).some((t) => t.includes('0 characters')),
      'and the zero never reaches a row under any gate — it is an absence, not a finding about the run',
    );
  });

  await h.test('timeline: the growth row prefers the terminal entry’s end-of-stream flush', () => {
    // The last throttle window is closed by the terminal entry, never by another aggregate, so the
    // newest aggregate is stale by design and reading it alone under-reports the run.
    const journal = [
      stage(1_000, 'generate'),
      aggregate(6_000, 20_020, 1_001),
      terminal(12_000, undefined, { aggregates: { chars: 24_000, tokens: 1_200 }, observedDiagnostics: 0 }),
    ];
    const growth = runTimelineRows(journal).filter((r) => r.kind === 'growth').map((r) => r.text);
    h.eq(growth, [timelineGrowthLine(24_000)], 'the figure shown is the run’s final one, not the last aggregate’s');
    h.ok(!growth[0].includes('20020'), 'the stale mid-stream figure is not what the user reads');
    h.eq(
      runTimelineRows([stage(1_000, 'generate'), aggregate(6_000, 910, 96), terminal(9_000)])
        .filter((r) => r.kind === 'growth')
        .map((r) => r.text),
      [timelineGrowthLine(910)],
      'and a terminal entry with no flush leaves the newest aggregate as the honest best figure',
    );
  });

  // ── thinking joins the growth row (build-liveness B4) ───────────────────────
  await h.test('timeline: the growth row adds a thinking clause only when the run actually thought', () => {
    h.eq(timelineGrowthLine(910, 0), 'Wrote 910 characters', 'no thinking observed reads exactly as the plain line');
    h.eq(timelineGrowthLine(910), 'Wrote 910 characters', 'and the parameter defaults to that same case');
    h.eq(
      timelineGrowthLine(910, 4_200),
      'Wrote 910 characters after thinking through 4200 characters',
      'a run that thought gets a second clause naming how much',
    );
    h.eq(timelineGrowthLine(0, 1), 'Wrote 0 characters after thinking through 1 character', 'singular thinking count reads correctly');

    const journal = [
      stage(1_000, 'generate'),
      aggregate(6_000, 300, 40, 5_000),
      terminal(9_000, undefined, { aggregates: { chars: 300, tokens: 40, thinkingChars: 5_000 }, observedDiagnostics: 0 }),
    ];
    const growth = runTimelineRows(journal).filter((r) => r.kind === 'growth').map((r) => r.text);
    h.eq(growth, [timelineGrowthLine(300, 5_000)], 'the row is composed from BOTH counts on the same closing entry');
  });

  await h.test('timeline: a journal written before build-liveness (no thinkingChars anywhere) still renders its growth row', () => {
    // Exactly the shape a pre-existing on-device journal has: no `thinkingChars` field at all.
    const journal = [stage(1_000, 'generate'), { t: 4_000, kind: 'terminal' as const, aggregates: { chars: 500, tokens: 60 } }];
    const growth = runTimelineRows(journal).filter((r) => r.kind === 'growth').map((r) => r.text);
    h.eq(growth, ['Wrote 500 characters'], 'reads as "no thinking recorded", never a thrown error or a fabricated clause');
  });

  // ── failure detail (task 5.3) ───────────────────────────────────────────────

  await h.test('timeline: failure detail is the reason and the hints, and nothing else can reach a row', () => {
    const failure = {
      reason: 'The app could not be built from that description.',
      diagnostics: [{ hint: 'Describing the sound differently helps' }, { hint: 'Try fewer moving parts' }],
    };
    const journal = [stage(1_000, 'generate'), terminal(4_000, failure)];
    const rows = runTimelineRows(journal);
    h.eq(rows.filter((r) => r.kind === 'reason').map((r) => r.text), [failure.reason], 'the reason gets one row');
    h.eq(
      rows.filter((r) => r.kind === 'hint').map((r) => r.text),
      ['Describing the sound differently helps', 'Try fewer moving parts'],
      'one row per diagnostic hint',
    );

    // Non-vacuity: even a journal entry that somehow carried engineering detail cannot smuggle it
    // into a row — a row is composed field by field, never from the entry wholesale.
    const rich = { hint: 'Try fewer moving parts', kind: 'sdk-misuse', symbol: 'useAudio', message: 'TS2554' };
    const leaky = [stage(1_000, 'generate'), terminal(4_000, { reason: 'It did not run.', diagnostics: [rich] })];
    const leakedInto = runTimelineRows(leaky, true).map((r) => r.text).join(' | ');
    for (const leak of ['sdk-misuse', 'useAudio', 'TS2554']) {
      h.ok(!leakedInto.includes(leak), `no row carries ${leak}`);
    }
  });

  await h.test('timeline: the LAST terminal entry is the one that ended the attempt', () => {
    // A stream that produced a result, then a delivery that failed: two terminal entries.
    const journal = [
      stage(1_000, 'generate'),
      terminal(5_000),
      terminal(6_000, { reason: 'Putting it on your home screen failed.', diagnostics: [{ hint: 'Try again' }] }),
    ];
    const rows = runTimelineRows(journal);
    h.eq(
      rows.filter((r) => r.kind === 'reason').map((r) => r.text),
      ['Putting it on your home screen failed.'],
      'the later terminal entry’s detail is what is shown',
    );
    h.eq(
      rows.filter((r) => r.kind === 'stage').map((r) => r.text),
      [`${COPY.timelineStageGenerate} · 4.0s`],
      'and the stage durations still end at the FIRST terminal entry, unaffected',
    );
  });

  await h.test('timeline: a real start/done stream renders one row per stage and one repair per attempt', () => {
    // End to end over the SAME fold the shell uses, fed the wire's real two-edge stage protocol:
    // what the timeline shows must be the run, not the run's edges.
    let clock = 1_000;
    const journal = new RunJournalStore(new MapKVBackend(), () => clock);
    let signals: RunSignals = { startedAt: clock, aggregates: EMPTY_RUN_AGGREGATES, lastTokenAt: null, lastThinkingAt: null, lastFrameAt: clock };
    const wire = [
      ['plan', 'start'], ['plan', 'done'],
      ['generate', 'start'], ['generate', 'done'],
      ['check', 'start'], ['check', 'done'],
      ['repair', 'start'], ['repair', 'done'],
      ['check', 'start'], ['check', 'done'],
      ['run', 'start'], ['run', 'done'],
    ] as const;
    let repairStarts = 0;
    for (const [stageName, status] of wire) {
      clock += 1_000;
      if (stageName === 'repair' && status === 'start') repairStarts += 1;
      signals = journalStreamEvent(journal, 'run-1', signals, { type: 'stage', stage: stageName, status }, clock);
    }
    clock += 1_000;
    journal.appendTerminal('run-1', { failure: { reason: 'It did not run.' }, observedDiagnostics: 4 });

    const entries = journal.get('run-1')!;
    const rows = runTimelineRows(entries, true);
    h.eq(
      rows.filter((r) => r.kind === 'stage').map((r) => r.text),
      [
        `${COPY.timelineStagePlan} · 2.0s`,
        `${COPY.timelineStageGenerate} · 2.0s`,
        `${COPY.timelineStageCheck} · 2.0s`,
        `${COPY.timelineStageRepair} · 2.0s`,
        `${COPY.timelineStageCheck} · 2.0s`,
        `${COPY.timelineStageRun} · 2.0s`,
      ],
      'six rows for six stage transitions — never twelve, and never a duration measured across a done edge',
    );
    h.ok(rows.some((r) => r.text === `Repair attempts: ${repairStarts}`), 'the repair count matches the shell’s own start-edge tally');
    h.eq(repairStarts, 1, 'the tally the timeline is being checked against is itself non-trivial');
  });

  // ── the journal is never a second source of truth (task 5.3) ────────────────

  await h.test('timeline: a missing or empty journal produces no rows at all', () => {
    h.eq(runTimelineRows([]), [], 'an empty journal composes nothing');
    h.eq(runTimelineRows([], true), [], 'and dev mode adds no counts to a run with no record of itself');
    h.ok(COPY.timelineEmpty.length > 0, 'the screens have a modest empty note to fall back to');
    h.ok(!/error|missing|failed|null/i.test(COPY.timelineEmpty), 'which reads as an absence, never as a failure');
  });

  // ── the dev gate (task 5.2) ─────────────────────────────────────────────────

  await h.test('timeline dev mode: the counts appear only behind the flag, and the flag ships false', () => {
    const journal = [
      stage(1_000, 'generate'),
      stage(2_000, 'check'),
      stage(3_000, 'repair'),
      stage(4_000, 'check'),
      stage(5_000, 'repair'),
      terminal(
        6_000,
        { reason: 'It still did not run.', diagnostics: [{ hint: 'one' }, { hint: 'two' }] },
        { observedDiagnostics: 7 },
      ),
    ];
    h.eq(runTimelineRows(journal).filter((r) => r.kind === 'dev').length, 0, 'no counts when the gate is off');
    h.eq(
      runTimelineRows(journal, true).filter((r) => r.kind === 'dev').map((r) => r.text),
      ['Diagnostics: 7', 'Repair attempts: 2'],
      'the two observed counts when it is on',
    );
    h.eq(SHOW_RUN_TIMELINE_DIAGNOSTICS, false, 'the build-time flag defaults to false, so a shipping build has no counts');
  });

  await h.test('timeline dev mode: the diagnostics count is what the stream showed, not what the payload kept', () => {
    // The failure payload lists the hints worth SHOWING; the count is how many `diagnostic` events
    // actually went past. Reading the payload's length instead reports the wrong number whenever
    // repair resolved some of them — which is exactly the interesting run.
    const journal = [
      stage(1_000, 'check'),
      stage(2_000, 'repair'),
      terminal(3_000, { reason: 'It did not run.', diagnostics: [{ hint: 'only one hint survived' }] }, {
        observedDiagnostics: 9,
      }),
    ];
    const dev = runTimelineRows(journal, true).filter((r) => r.kind === 'dev').map((r) => r.text);
    h.ok(dev.includes('Diagnostics: 9'), 'the observed figure is the one shown');
    h.ok(!dev.includes('Diagnostics: 1'), 'never the length of the final payload’s hint list');

    // A journal that recorded no such count says nothing rather than claiming a zero.
    const silent = runTimelineRows([stage(1_000, 'check'), terminal(2_000)], true).map((r) => r.text);
    h.ok(!silent.some((t) => t.startsWith('Diagnostics:')), 'no diagnostics row when the run recorded no count');
    h.ok(silent.includes('Repair attempts: 0'), 'the repair count, which the journal can always vouch for, still shows');
  });

}
