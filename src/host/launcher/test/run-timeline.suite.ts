/**
 * run-timeline Node suite (generation-observability chain-4, tasks 5.1–5.4), from
 * `prompt-flow/spec.md`: the build screen's details affordance into the run timeline, the failure
 * screen's what-happened section, and the flag-gated developer counts — plus
 * `generation-run-journal`'s "a journal is never a second source of truth" fallback.
 *
 * What a journal BECOMES lives in the RN-free `run-timeline-view.ts` + `copy.ts` and is exercised
 * for real here; only the properties that genuinely live in JSX (the section being additional to
 * the checklist, the read happening on open rather than on a tick, token-only styling) are
 * asserted from source, the idiom `failure-screen.suite.ts` / `observability-ui.suite.ts`
 * established.
 *
 * Nothing here awaits a promise that could fail to settle.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { Harness } from './harness';
import { COPY, timelineDurationLabel, timelineGrowthLine, timelineStageLabel } from '../copy';
import type { RunJournalEntry } from '../run-journal';
import {
  SHOW_RUN_TIMELINE_DIAGNOSTICS,
  runTimelineDevModeEnabled,
  runTimelineRows,
} from '../run-timeline-view';

function readSource(file: string): string {
  return fs.readFileSync(path.join(process.cwd(), 'src/host/launcher', file), 'utf8');
}

/** Source with its comments removed: the negative assertions are about what the code DOES. */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

const stage = (t: number, s: RunJournalEntry['stage']): RunJournalEntry => ({ t, kind: 'stage', stage: s });
const aggregate = (t: number, chars: number, tokens: number): RunJournalEntry => ({
  t,
  kind: 'aggregate',
  aggregates: { chars, tokens },
});
const terminal = (t: number, failure?: RunJournalEntry['failure']): RunJournalEntry => ({
  t,
  kind: 'terminal',
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
    h.eq(timelineGrowthLine(910), '910 characters written', 'it states a character count');
    h.eq(timelineGrowthLine(1), '1 character written', 'one character is not "1 characters"');
    h.eq(
      runTimelineRows([stage(1_000, 'plan')]).filter((r) => r.kind === 'growth').length,
      0,
      'a run that produced no output gets no growth row rather than a fabricated zero',
    );
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

  // ── the journal is never a second source of truth (task 5.3) ────────────────

  await h.test('timeline: a missing or empty journal produces no rows at all', () => {
    h.eq(runTimelineRows([]), [], 'an empty journal composes nothing');
    h.eq(runTimelineRows([], true), [], 'and dev mode adds no counts to a run with no record of itself');
    h.ok(COPY.timelineEmpty.length > 0, 'the screens have a modest empty note to fall back to');
    h.ok(!/error|missing|failed|null/i.test(COPY.timelineEmpty), 'which reads as an absence, never as a failure');
  });

  await h.test('timeline: the failure screen falls back without changing anything else it shows', () => {
    const src = code(readSource('FailureScreen.tsx'));
    h.ok(/entries=\{journal\}/.test(src), 'the section renders the journal the caller handed it');
    h.ok(/journal = null/.test(src), 'an absent journal is null, so the timeline renders its empty note');
    h.ok(/failureChecklistRows\(\{ diagnostics, hasWorkingVersion \}\)/.test(src), 'the checklist still comes from the props');
    h.ok(!/journal\.(map|filter|find|length)/.test(src), 'and no row of the screen’s own state is derived from the journal');
    h.ok(
      src.indexOf('<RunTimeline') > src.indexOf('failureChecklistRows('),
      'the what-happened section is IN ADDITION to the checklist panel, not in place of it',
    );
  });

  // ── the dev gate (task 5.2) ─────────────────────────────────────────────────

  await h.test('timeline dev mode: the counts appear only behind the flag, and the flag ships false', () => {
    const journal = [
      stage(1_000, 'generate'),
      stage(2_000, 'check'),
      stage(3_000, 'repair'),
      stage(4_000, 'check'),
      stage(5_000, 'repair'),
      terminal(6_000, { reason: 'It still did not run.', diagnostics: [{ hint: 'one' }, { hint: 'two' }] }),
    ];
    h.eq(runTimelineRows(journal).filter((r) => r.kind === 'dev').length, 0, 'no counts when the gate is off');
    h.eq(
      runTimelineRows(journal, true).filter((r) => r.kind === 'dev').map((r) => r.text),
      ['Diagnostics: 2', 'Repair attempts: 2'],
      'the two observed counts when it is on',
    );
    h.eq(SHOW_RUN_TIMELINE_DIAGNOSTICS, false, 'the build-time flag defaults to false, so a shipping build has no counts');
  });

  await h.test('timeline dev mode: the gate is __DEV__ OR the explicit flag, never __DEV__ alone', () => {
    h.eq(runTimelineDevModeEnabled(false, false), false, 'both gates off: no counts');
    h.eq(runTimelineDevModeEnabled(true, false), true, 'reachable under a debug build');
    h.eq(runTimelineDevModeEnabled(false, true), true, 'reachable in a locally-built RELEASE apk with the flag on');
    h.eq(runTimelineDevModeEnabled(false), false, 'the committed default is what an unqualified call gets');
    const rootSrc = code(readSource('LauncherRoot.tsx'));
    h.ok(/runTimelineDevModeEnabled\(__DEV__\)/.test(rootSrc), 'the shell decides it once, through the gate');
    h.ok(!/devMode=\{__DEV__\}/.test(rootSrc), 'and never hands a bare __DEV__ to a timeline surface');
  });

  // ── the component and its wiring (tasks 5.1 / 5.4) ──────────────────────────

  await h.test('timeline: the component renders rows it is given and never reads a store', () => {
    const src = code(readSource('RunTimeline.tsx'));
    h.ok(/runTimelineRows\(entries \?\? \[\], devMode\)/.test(src), 'every row comes from the one pure composer');
    h.ok(!/Store|journal\.get|useState|useEffect/.test(src), 'the component holds no state and reads no store');
    h.ok(!/\.kind\b.*symbol|\.symbol\b/.test(src), 'it never reaches for a diagnostic symbol');
    h.ok(!/token/i.test(src), 'and never for token text');
    h.ok(/COPY\.timelineTitle/.test(src) && /COPY\.timelineEmpty/.test(src), 'its two strings come from the copy table');
  });

  await h.test('timeline: it is styled from the v2 tokens alone', () => {
    const src = readSource('RunTimeline.tsx');
    h.ok(!/#[0-9a-f]{3,8}\b/i.test(src), 'no hex colour literal');
    h.ok(!/fontSize\s*:/.test(src), 'no numeric font-size literal — faces come from TYPE_SCALE');
    h.ok(!/borderRadius\s*:\s*\d/.test(src), 'no numeric radius literal');
    h.ok(/TYPE_SCALE/.test(src) && /SPACING/.test(src), 'the v2 tokens are what it styles from');
    h.ok(/shellPalette\(theme\)/.test(src), 'colours come from shellPalette, not a second palette');
  });

  await h.test('timeline: the build screen’s details affordance reads the journal ON OPEN', () => {
    const rootSrc = code(readSource('LauncherRoot.tsx'));
    const handler = rootSrc.slice(rootSrc.indexOf('const onShowDetails'), rootSrc.indexOf('const failureActions'));
    h.ok(handler.includes('journal.get(id)'), 'the read is inside the affordance’s handler');
    h.ok(handler.includes('liveRef.current?.id'), 'and it reads the attempt actually in flight');
    h.ok(rootSrc.includes('onShowDetails={onShowDetails}'), 'the build screen is handed the callback — without this the affordance is inert');

    const tickEffect = rootSrc.slice(
      rootSrc.indexOf("if (screen.kind !== 'build') return undefined;"),
      rootSrc.indexOf('const refresh ='),
    );
    h.ok(!tickEffect.includes('journal.get'), 'the tick and the details state around it read nothing out of the store');
    h.eq((rootSrc.match(/journal\.get\(/g) ?? []).length, 2, 'exactly two reads exist: the details affordance and the failure screen’s');
  });

  await h.test('timeline: the details view is an overlay, and back closes it instead of cancelling the run', () => {
    const rootSrc = code(readSource('LauncherRoot.tsx'));
    h.ok(/\{timeline !== null && \(/.test(rootSrc), 'the overlay renders only while it is open');
    h.ok(/<RunTimeline entries=\{timeline\} devMode=\{timelineDevMode\} \/>/.test(rootSrc), 'over the entries read on open');
    h.ok(/onPress=\{\(\) => setTimeline\(null\)\}/.test(rootSrc) && rootSrc.includes('COPY.timelineClose'), 'and it offers a labelled way out');
    const backEffect = rootSrc.slice(rootSrc.indexOf('if (timeline === null) return undefined;'), rootSrc.indexOf("if (screen.kind !== 'build') setTimeline(null);"));
    h.ok(backEffect.includes('hardwareBackPress') && backEffect.includes('setTimeline(null)'), 'hardware back closes the details view');
    h.ok(backEffect.includes('return true;'), 'and stops there, so the build screen’s cancel never fires underneath it');
    h.ok(rootSrc.includes("if (screen.kind !== 'build') setTimeline(null);"), 'leaving the build screen closes it, so it can never reopen onto a previous attempt');
  });
}
