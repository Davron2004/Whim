/**
 * The `3b` failure screen (obs-v1 chain-D; prompt-flow "Failure is shown honestly, never as a
 * crash", app-launcher "The mini-app container styles its failure state from tokens").
 *
 * The screen's copy decisions (checklist rows, attempt segments, the attempt label) are pure and
 * run here directly; the screen itself is rendered for what it shows and what its exits do.
 */

import React from 'react';
import { Harness } from './harness';
import {
  COPY,
  REPAIR_ATTEMPT_LIMIT,
  attemptSegments,
  attemptsUsedLabel,
  failureChecklistRows,
} from '../copy';
import FailureScreen, { type FailureScreenProps } from '../FailureScreen';
import { runTimelineRows } from '../run-timeline-view';
import type { RunJournalEntry } from '../run-journal';
import { WEBVIEW_ERROR_MESSAGE, logWebViewError } from '../webview-error';
import { createSeam } from '../../logging';
import { CHANNELS } from '../../logging/channels';
import { REDACTED } from '../../logging/redact';
import { hardwareBack } from './native-host';
import { button, press, renderScreen, textOf, unmountScreen } from './react-screen';

/** Render the screen with spies on its three actions, run `body`, and unmount. */
async function withFailureScreen(
  props: Partial<FailureScreenProps>,
  body: (shown: () => string, calls: { back: number; dismiss: number; rephrase: number }, tree: Awaited<ReturnType<typeof renderScreen>>) => Promise<void>,
): Promise<void> {
  const calls = { back: 0, dismiss: 0, rephrase: 0 };
  const tree = await renderScreen(React.createElement(FailureScreen, {
    reason: 'It did not build.',
    diagnostics: [{ hint: 'Try fewer screens.' }],
    onRephrase: () => { calls.rephrase++; },
    onBack: () => { calls.back++; },
    ...props,
  }));
  try {
    await body(() => textOf(tree.root), calls, tree);
  } finally {
    await unmountScreen(tree);
  }
}

const JOURNAL: RunJournalEntry[] = [
  { t: 1_000, kind: 'stage', stage: 'generate' },
  { t: 4_000, kind: 'stage', stage: 'check' },
  { t: 6_000, kind: 'terminal', failure: { reason: 'It did not build.', diagnostics: [{ hint: 'Try fewer screens.' }] } },
];

export async function runFailureScreenTests(h: Harness): Promise<void> {
  // ── the attempt row: only what the device actually watched go past ──────────

  await h.test('attempts: two observed repairs spend two segments, and the run sits on the third', () => {
    const segments = attemptSegments(2);
    h.eq(segments.length, REPAIR_ATTEMPT_LIMIT, 'one segment per permitted attempt');
    h.eq([...segments], ['spent', 'spent', 'current'], 'the observed attempts are spent; the run was on the next one');
    h.eq([...attemptSegments(1)], ['spent', 'current', 'remaining'], 'one observed attempt leaves the rest unreached');
    h.eq([...attemptSegments(REPAIR_ATTEMPT_LIMIT)], ['spent', 'spent', 'spent'], 'an exhausted run has no current segment');
  });

  await h.test('attempts: a count is never invented — zero observed attempts spends nothing', () => {
    h.eq([...attemptSegments(0)], ['current', 'remaining', 'remaining'], 'nothing is spent for a run that never repaired');
    h.eq([...attemptSegments(-4)], [...attemptSegments(0)], 'a nonsense count cannot spend segments');
    h.eq([...attemptSegments(99)], [...attemptSegments(REPAIR_ATTEMPT_LIMIT)], 'the row never grows past the permitted attempts');
  });

  await h.test('attempts: the label names the attempts used, not the ones left', () => {
    h.eq(attemptsUsedLabel(1), 'Tried once', 'one attempt reads as words, not a numeral');
    h.eq(attemptsUsedLabel(3), 'Tried 3 times', 'more than one is counted');
    h.ok(!/left|remaining|of \d/i.test(attemptsUsedLabel(2)), 'the label never counts down');
  });


  await h.test('attempts: the row shows only when the caller reports observed repair attempts', async () => {
    await withFailureScreen({}, async (shown) => {
      h.ok(!shown().includes(attemptsUsedLabel(1)) && !/Tried/.test(shown()), 'no count given: no attempt row, never a default of one');
    });
    await withFailureScreen({ observedRepairAttempts: 0 }, async (shown) => {
      h.ok(!/Tried/.test(shown()), 'zero observed attempts: no attempt row');
    });
    await withFailureScreen({ observedRepairAttempts: 2 }, async (shown) => {
      h.ok(shown().includes(attemptsUsedLabel(2)), 'two observed attempts are shown');
    });
  });

  // ── the two exits: one leaves, one deletes, and each says so ───────────────

  await h.test('exits: Back leaves, Discard deletes, and system back is always Back', async () => {
    let dismissed = 0;
    await withFailureScreen({ onDismiss: () => { dismissed++; } }, async (_shown, calls, tree) => {
      await press(button(tree, COPY.failureBack));
      h.eq([calls.back, dismissed], [1, 0], 'the Back button only leaves');
      await press(button(tree, COPY.failureDismiss));
      h.eq([calls.back, dismissed], [1, 1], 'the Discard button deletes');
      h.ok(!/back to your apps/i.test(COPY.failureDismiss) && COPY.failureDismiss !== COPY.failureBack, 'and is not labelled as navigation');
      hardwareBack();
      h.eq([calls.back, dismissed], [2, 1], 'system back performs Back, never Discard');
    });
  });

  await h.test('exits: with nothing to discard there is no Discard button, and Back still leaves', async () => {
    await withFailureScreen({}, async (shown, calls, tree) => {
      h.ok(!shown().includes(COPY.failureDismiss), 'no Discard label is rendered');
      await press(button(tree, COPY.failureBack));
      h.eq(calls.back, 1, 'Back is always there');
    });
  });

  // ── the what-happened section ──────────────────────────────────────────────

  await h.test('what happened: absent for a failure that never started an attempt', async () => {
    await withFailureScreen({ journal: null, attemptStarted: false }, async (shown) => {
      h.ok(!shown().includes(COPY.timelineTitle), 'no heading');
      h.ok(!shown().includes(COPY.timelineEmpty), 'and no empty note');
    });
  });

  await h.test('what happened: an attempt with no readable journal shows the empty note, and the screen is otherwise unchanged', async () => {
    await withFailureScreen({ journal: null, attemptStarted: true }, async (shown) => {
      h.ok(shown().includes(COPY.timelineTitle) && shown().includes(COPY.timelineEmpty), 'the section falls back to its empty note');
      h.ok(shown().includes('Try fewer screens.'), 'and the checklist still shows the hint');
    });
  });

  await h.test('what happened: a journal renders its timeline in addition to the checklist', async () => {
    await withFailureScreen({ journal: JOURNAL, attemptStarted: true }, async (shown) => {
      const rows = runTimelineRows(JOURNAL).map((r) => r.text);
      h.ok(rows.length > 0 && rows.every((row) => shown().includes(row)), 'every timeline row is shown');
      const checklist = failureChecklistRows({ diagnostics: [{ hint: 'Try fewer screens.' }], hasWorkingVersion: false }).map((r) => r.text);
      h.ok(checklist.every((row) => shown().includes(row)), 'and so is every checklist row');
    });
  });

  // ── the checklist: hints and copy strings, nothing else ────────────────────

  await h.test('checklist: reassurance, then one row per hint, then the advisory line', () => {
    const rows = failureChecklistRows({
      diagnostics: [{ hint: 'The sound change is the part that fails' }],
      hasWorkingVersion: true,
    });
    h.eq(rows.map(r => r.kind), ['done', 'bad', 'wait'], 'the design’s three row kinds, in order');
    h.eq(rows[0].text, COPY.failureRowLastVersionWorks, 'the reassurance row is the copy string');
    h.eq(rows[1].text, 'The sound change is the part that fails', 'the failed row is the diagnostic’s own hint');
    h.eq(rows[2].text, COPY.failureRowSayItDifferently, 'the advisory row is the copy string');
  });

  await h.test('checklist: every hint gets its own bad row, and none is prefixed with a bullet', () => {
    const rows = failureChecklistRows({
      diagnostics: [{ hint: 'first thing' }, { hint: 'second thing' }],
      hasWorkingVersion: false,
    });
    h.eq(rows.filter(r => r.kind === 'bad').map(r => r.text), ['first thing', 'second thing'], 'one bad row per hint');
    for (const row of rows) h.ok(!/^[•\-*]/.test(row.text), `"${row.text}" carries no bullet character`);
  });

  await h.test('checklist: the reassurance row is omitted when there is no working version to keep', () => {
    const rows = failureChecklistRows({ diagnostics: [{ hint: 'it broke' }], hasWorkingVersion: false });
    h.eq(rows.map(r => r.kind), ['bad', 'wait'], 'nothing claims a working version exists');
    h.ok(
      !rows.some(r => r.text === COPY.failureRowLastVersionWorks),
      'the reassurance copy is absent, not merely restyled',
    );
    h.ok(
      failureChecklistRows({ diagnostics: [], hasWorkingVersion: true }).some(r => r.kind === 'done'),
      'and it IS present when there is one (the omission is non-vacuous)',
    );
  });

  await h.test('checklist: a failure rewording can’t get past gets no advisory row', () => {
    const rows = failureChecklistRows({ diagnostics: [{ hint: 'it broke' }], hasWorkingVersion: true, rephraseHelps: false });
    h.eq(rows.map(r => r.kind), ['done', 'bad'], 'the reassurance and the hint stay; the advice goes');
    h.eq(failureChecklistRows({ diagnostics: [], hasWorkingVersion: false, rephraseHelps: false }), [], 'with nothing else to say there are no rows at all');
  });

  // ── the advice: rephrasing is offered only where it can help ────────────────

  await h.test('advice: a failure rewording can’t get past offers no rephrasing, and its primary still leads back to the prompt', async () => {
    await withFailureScreen({ rephraseHelps: false, diagnostics: [] }, async (shown, calls, tree) => {
      h.ok(!shown().includes(COPY.failureRowSayItDifferently), 'no advisory row suggests describing it differently');
      h.ok(!shown().includes(COPY.failureRephrase), 'and the primary is not labelled as rephrasing');
      await press(button(tree, COPY.screenErrorRetry));
      h.eq(calls.rephrase, 1, 'the primary performs the same recovery action');
    });
    await withFailureScreen({ diagnostics: [] }, async (shown) => {
      h.ok(shown().includes(COPY.failureRowSayItDifferently) && shown().includes(COPY.failureRephrase), 'a failed generation still advises rephrasing');
    });
  });

  await h.test('what happened: the reason the screen already shows is not repeated in its timeline', async () => {
    const count = (text: string, part: string) => text.split(part).length - 1;
    await withFailureScreen({ journal: JOURNAL, attemptStarted: true }, async (shown) => {
      h.eq(count(shown(), 'It did not build.'), 1, 'the reason reads once');
      const stages = runTimelineRows(JOURNAL).filter((r) => r.kind === 'stage').map((r) => r.text);
      h.ok(stages.length > 0 && stages.every((row) => shown().includes(row)), 'while the timeline still shows what the attempt did');
    });
    const refused = 'Whim is busy right now. Please try again in a few minutes.';
    const journal: RunJournalEntry[] = [
      { t: 1_000, kind: 'stage', stage: 'generate' },
      { t: 2_000, kind: 'terminal', failure: { reason: refused, diagnostics: [] } },
    ];
    await withFailureScreen({ reason: refused, journal, attemptStarted: true, notice: { hint: refused, tone: 'neutral' } }, async (shown) => {
      h.eq(count(shown(), refused), 1, 'a refused Retry’s notice reads once too');
    });
  });

  await h.test('checklist: no row can carry a diagnostic’s kind, symbol or message', () => {
    const diagnostic = { hint: 'Describing the sound differently helps', kind: 'sdk-misuse', symbol: 'useAudio', message: 'TS2554: expected 1 argument' };
    const rows = failureChecklistRows({ diagnostics: [diagnostic], hasWorkingVersion: true });
    const allowed = new Set<string>([...Object.values(COPY), diagnostic.hint]);
    for (const row of rows) {
      h.ok(allowed.has(row.text), `"${row.text}" is a hint or a copy.ts string`);
      for (const leak of [diagnostic.kind, diagnostic.symbol, diagnostic.message]) {
        h.ok(!row.text.includes(leak), `"${row.text}" must not carry the diagnostic’s ${leak}`);
      }
    }
    h.ok(!allowed.has('sdk-misuse'), 'the leak fixtures are genuinely outside the allowed set');
  });

  // ── both surfaces: tokens only ─────────────────────────────────────────────

  await h.test('container: the WebView error reaches the seam with its diagnostic code intact', () => {
    const seam = createSeam({ console: false });
    logWebViewError(
      seam,
      { code: -6, description: 'net::ERR_CONNECTION_REFUSED', domain: 'about:blank', url: 'about:blank' },
      { appId: 'tip-splitter' },
    );

    const [record] = seam.buffer.snapshot();
    h.eq(record.channel, CHANNELS.app, 'the failure is recorded on the mini-app container channel');
    h.eq(record.level, 'error', 'a load failure is an error');
    h.eq(record.message, WEBVIEW_ERROR_MESSAGE, 'the message is the constant; the payload rides as fields');
    h.eq(record.fields.errorCode, -6, 'the native code survives redaction — it is the most diagnostic field');
    h.eq(record.fields.detail, 'net::ERR_CONNECTION_REFUSED', 'the native description is a named field');
    h.eq(record.fields.domain, 'about:blank', 'the native domain is a named field');
    h.eq(record.fields.url, 'about:blank', 'the native url is a named field');
    h.eq(record.fields.appId, 'tip-splitter', 'the caller’s context rides alongside');
    h.ok(!Object.hasOwn(record.fields, 'code'), 'nothing is emitted under the sensitive name `code`');

    // Control: redaction is still on for this very record — `errorCode` survives because it is
    // outside the sensitive set, not because the seam stopped censoring.
    seam.error(CHANNELS.app, WEBVIEW_ERROR_MESSAGE, { code: -6 });
    const control = seam.buffer.snapshot()[1];
    h.eq(control.fields.code, REDACTED, 'a genuinely sensitive field name WOULD have been redacted');
  });

}
