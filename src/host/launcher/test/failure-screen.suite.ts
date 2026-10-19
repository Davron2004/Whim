/**
 * The Failure page (design-system-v1 17.3; prompt-flow "Failure is shown by kind, honestly, never as
 * a crash", "Details of a run are reachable from its tile and its failure"; system.md §8, §9).
 *
 * Which kind a run ended in, what the page says and offers for it, are pure (`failure-kind.ts`) and
 * run here directly; the page itself is rendered for what it shows and what its controls do.
 */

import React from 'react';
import { Harness } from './harness';
import { COPY, REPAIR_ATTEMPT_LIMIT } from '../copy';
import { failureActions, failureKindOf, failureSentence, type FailureFacts } from '../failure-kind';
import FailurePage, { type FailurePageProps } from '../FailurePage';
import { Ember } from '../../ui/Ember';
import { runTimelineRows } from '../run-timeline-view';
import type { RunJournalEntry } from '../run-journal';
import { WEBVIEW_ERROR_MESSAGE, logWebViewError } from '../webview-error';
import { createSeam } from '../../logging';
import { CHANNELS } from '../../logging/channels';
import { REDACTED } from '../../logging/redact';
import { button, hostType, press, renderScreen, screenReaderElement, textOf, unmountScreen } from './react-screen';

type Rendered = Awaited<ReturnType<typeof renderScreen>>;

/** Render the page with spies on its three actions, run `body`, and unmount. */
async function withFailurePage(
  props: Partial<FailurePageProps>,
  body: (shown: () => string, calls: { change: number; retry: number; dismiss: number }, tree: Rendered) => Promise<void>,
): Promise<void> {
  const calls = { change: 0, retry: 0, dismiss: 0 };
  const tree = await renderScreen(React.createElement(FailurePage, {
    kind: 'other',
    reason: 'It did not build.',
    diagnostics: [{ hint: 'Try fewer screens.' }],
    rephraseHelps: true,
    changing: false,
    onChange: () => { calls.change++; },
    onRetry: () => { calls.retry++; },
    ...props,
  }));
  try {
    await body(() => textOf(tree.root), calls, tree);
  } finally {
    await unmountScreen(tree);
  }
}

const FACTS: FailureFacts = { reason: 'Could not produce a working app after several attempts.', rephraseHelps: true, repairs: 0, refused: false };

const JOURNAL: RunJournalEntry[] = [
  { t: 1_000, kind: 'stage', stage: 'generate' },
  { t: 4_000, kind: 'stage', stage: 'check' },
  { t: 6_000, kind: 'terminal', failure: { reason: 'It did not build.', diagnostics: [{ hint: 'Try fewer screens.' }] } },
];

/** The labels of the page's buttons, in order. */
const buttonLabels = (tree: Rendered) =>
  tree.root.findAll((n) => hostType(n) === 'Pressable' && n.props.accessibilityRole === 'button').map((n) => String(n.props.accessibilityLabel ?? textOf(n)));

export async function runFailureScreenTests(h: Harness): Promise<void> {
  // ── the kind: read from what the run left behind ────────────────────────────

  await h.test('kind: a run that used every repair try couldn’t run; with fewer, the server’s own reason is the sentence', () => {
    const exhausted = { ...FACTS, repairs: REPAIR_ATTEMPT_LIMIT };
    h.eq(failureKindOf(exhausted), 'couldnt-run', 'every try used');
    h.eq(failureSentence('couldnt-run', exhausted), 'I tried 3 times and couldn’t get it to run. Describing it differently often helps.', 'system.md §8, with the rewording hint');
    h.eq(failureSentence('couldnt-run', { ...exhausted, rephraseHelps: false }), 'I tried 3 times and couldn’t get it to run.', 'and without it where rewording won’t help');
    h.eq(failureKindOf({ ...FACTS, repairs: 1 }), 'other', 'one try is not "3 times"');
    h.eq(failureSentence('other', FACTS), FACTS.reason, 'an unknown reason shows the server’s text');
  });

  await h.test('kind: a refusal, an interruption and a dropped connection are each their own kind', () => {
    h.eq(failureKindOf({ ...FACTS, refused: true, repairs: REPAIR_ATTEMPT_LIMIT }), 'refused', 'a refused Try again is a refusal, whatever came before');
    h.eq(failureSentence('refused', FACTS), null, 'whose notice carries the reason');
    h.eq([failureKindOf({ ...FACTS, interrupted: 'closed' }), failureSentence('closed', FACTS)], ['closed', 'Making stopped when Whim closed.'], 'Whim closed under it');
    h.eq([failureKindOf({ ...FACTS, interrupted: 'stopped' }), failureSentence('stopped', FACTS)], ['stopped', COPY.failureStopped], 'the person stopped it');
    h.eq(failureKindOf({ ...FACTS, reason: COPY.failureConnection }), 'connection', 'the stream dropped');
    h.eq(failureSentence('connection', FACTS), 'I lost the connection to the server partway through.', '#151: said as what happened');
  });

  await h.test('actions: rewording is offered only where it can help, and a dropped connection never suggests it', () => {
    const shape = (kind: Parameters<typeof failureActions>[0], helps: boolean, canRetry = true) =>
      failureActions(kind, helps, canRetry).map((a) => [a.label, a.variant]);
    const reword = [[COPY.failureChangeDescription, 'ink'], [COPY.failureTryAgainAsIs, 'plain']];
    h.eq(shape('couldnt-run', true), reword, 'couldn’t run, rewording helps: Change the description, then Try again as it is');
    h.eq(shape('other', true), reword, 'the same for a reason the server worded');
    h.eq(shape('couldnt-run', false), [[COPY.actionTryAgain, 'ember']], 'rewording won’t help: Try again, Whim’s action');
    for (const kind of ['connection', 'closed'] as const) {
      h.eq(shape(kind, true), [[COPY.actionTryAgain, 'ember']], `${kind}: Try again alone, even when the record says rewording could help`);
    }
    h.eq(shape('stopped', true), [[COPY.actionTryAgain, 'ember'], [COPY.failureChangeDescription, 'plain']], 'a stopped run: try it again, or describe it again');
    h.eq(shape('couldnt-run', true, false), [[COPY.failureChangeDescription, 'ink']], 'with no attempt left to run again, describing it again is the way on');
  });

  // ── the page ────────────────────────────────────────────────────────────────

  await h.test('page: the ember out, "Couldn’t make this", the sentence, and what is safe', async () => {
    await withFailurePage({}, async (shown, _calls, tree) => {
      h.eq([tree.root.findByType(Ember).props.state, tree.root.findByType(Ember).props.size], ['out', 96], 'the 96 pt ember, out');
      h.ok(shown().includes(COPY.failureTitle) && shown().includes('It did not build.'), 'the title and the sentence');
      h.ok(shown().includes(COPY.failureOtherAppsUntouched) && !shown().includes(COPY.failureCurrentVersionWorks), 'a new app: the other apps are untouched');
    });
    await withFailurePage({ changing: true }, async (shown) => {
      h.ok(shown().includes(COPY.failureCurrentVersionWorks) && !shown().includes(COPY.failureOtherAppsUntouched), 'a change: the current version still works');
    });
  });

  await h.test('page: each action does its own thing', async () => {
    await withFailurePage({}, async (_shown, calls, tree) => {
      await press(button(tree, COPY.failureChangeDescription));
      h.eq([calls.change, calls.retry], [1, 0], 'Change the description describes it again');
      await press(button(tree, COPY.failureTryAgainAsIs));
      h.eq([calls.change, calls.retry], [1, 1], 'Try again as it is runs it again');
    });
  });

  await h.test('page: a lost connection waits for the phone to be back online before Try again', async () => {
    await withFailurePage({ kind: 'connection', reason: COPY.failureConnection, rephraseHelps: false, offline: true }, async (shown, calls, tree) => {
      h.ok(shown().includes(COPY.failureConnection) && shown().includes(COPY.failureOfflineNotice), 'it says what happened, and that Try again waits for the connection');
      await h.throws(() => press(button(tree, COPY.actionTryAgain)), 'disabled', 'Try again is off while offline');
      h.eq(calls.retry, 0, 'and sends nothing');
      h.ok(!shown().includes(COPY.failureChangeDescription), 'no rewording is suggested');
    });
    await withFailurePage({ kind: 'connection', reason: COPY.failureConnection, rephraseHelps: false, offline: false }, async (shown, calls, tree) => {
      h.ok(!shown().includes(COPY.failureOfflineNotice), 'back online, the notice goes');
      await press(button(tree, COPY.actionTryAgain));
      h.eq(calls.retry, 1, 'and Try again runs it again');
    });
  });

  await h.test('page: a refused Try again shows the reason once, as a notice, and holds Try again until its window ends', async () => {
    const hint = 'Whim is busy right now. Please try again in a few minutes.';
    await withFailurePage({ kind: 'refused', reason: hint, rephraseHelps: false, notice: { hint, tone: 'neutral', retryAt: Date.now() + 60_000 } }, async (shown, calls, tree) => {
      h.eq(shown().split(hint).length - 1, 1, 'the reason reads once');
      await h.throws(() => press(button(tree, COPY.actionTryAgain)), 'disabled', 'Try again waits for the window');
      h.eq(calls.retry, 0, 'and sends nothing');
    });
  });

  await h.test('discard: in the body when there is an attempt to discard, and nowhere when there is not', async () => {
    let dismissed = 0;
    await withFailurePage({ onDismiss: () => { dismissed++; } }, async (_shown, calls, tree) => {
      const discard = tree.root.findAll((n) => n.props.label === COPY.actionDiscard && n.props.variant === 'danger');
      h.eq(discard.length, 1, 'a danger Discard');
      await press(button(tree, COPY.actionDiscard));
      h.eq([dismissed, calls.change, calls.retry], [1, 0, 0], 'which discards, and does nothing else');
    });
    await withFailurePage({}, async (shown) => {
      h.ok(!shown().includes(COPY.actionDiscard), 'no Discard with nothing to discard');
    });
  });

  // ── what happened ───────────────────────────────────────────────────────────

  await h.test('what happened: collapsed until opened; then every timeline row, each its own screen-reader element (#136)', async () => {
    await withFailurePage({ journal: JOURNAL, attemptStarted: true }, async (shown, _calls, tree) => {
      const rows = runTimelineRows(JOURNAL, false, 'It did not build.', true).map((r) => r.text);
      h.ok(rows.length > 1, 'the fixture has several rows');
      h.ok(shown().includes(COPY.timelineTitle) && rows.every((row) => !shown().includes(row)), 'collapsed: the row is there, its contents are not');
      const toggle = button(tree, COPY.timelineTitle);
      h.eq(toggle.props.accessibilityState?.expanded, false, 'announced as collapsed');
      await press(toggle);
      h.eq(button(tree, COPY.timelineTitle).props.accessibilityState?.expanded, true, 'and as expanded once opened');
      for (const row of rows) {
        const text = tree.root.findAll((n) => hostType(n) === 'Text' && textOf(n) === row)[0];
        const element = text ? screenReaderElement(text) : null;
        h.eq(element?.props.accessibilityLabel, row, `"${row}" is read as itself, not as part of the whole list`);
      }
      h.eq(shown().split('It did not build.').length - 1, 1, 'the reason the page already states is not repeated');
    });
  });

  await h.test('what happened: absent for a failure that never started an attempt; an attempt with no journal says nothing was recorded', async () => {
    await withFailurePage({ journal: null, attemptStarted: false, diagnostics: [] }, async (shown) => {
      h.ok(!shown().includes(COPY.timelineTitle), 'no row for a run that never was');
    });
    await withFailurePage({ journal: null, attemptStarted: true, diagnostics: [] }, async (shown, _calls, tree) => {
      await press(button(tree, COPY.timelineTitle));
      h.ok(shown().includes(COPY.timelineEmpty), 'the empty note, never an invented run');
    });
  });

  await h.test('what happened: hints only — never a diagnostic’s kind, symbol or message', async () => {
    const diagnostic = { hint: 'Describing the sound differently helps', kind: 'sdk-misuse', symbol: 'useAudio', message: 'TS2554: expected 1 argument' };
    const journal: RunJournalEntry[] = [{ t: 1, kind: 'stage', stage: 'check' }, { t: 2, kind: 'terminal', failure: { reason: 'It did not build.', diagnostics: [diagnostic] } }];
    await withFailurePage({ journal, attemptStarted: true, diagnostics: [diagnostic] }, async (shown, _calls, tree) => {
      await press(button(tree, COPY.timelineTitle));
      h.ok(shown().includes(diagnostic.hint), 'the hint is shown');
      for (const leak of [diagnostic.kind, diagnostic.symbol, diagnostic.message]) h.ok(!shown().includes(leak), `"${leak}" is not`);
      h.eq(shown().split(diagnostic.hint).length - 1, 1, 'and the hint reads once');
    });
  });

  await h.test('what happened: a hint the journal does not hold is still shown', async () => {
    await withFailurePage({ journal: null, attemptStarted: false, diagnostics: [{ hint: 'Try fewer screens.' }] }, async (shown, _calls, tree) => {
      await press(button(tree, COPY.timelineTitle));
      h.ok(shown().includes('Try fewer screens.'), 'the saved hint, from the record');
      h.ok(buttonLabels(tree).includes(COPY.timelineTitle), 'under What happened');
    });
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
