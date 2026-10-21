/**
 * whim-prose acceptance (design-system-v1 task 21.3; `app-launcher` "Shell prose renders through one
 * Whim Syntax renderer with simplified channels") — the Whim Syntax lexer, the shared renderer, the
 * discipline caps the renderer must enforce ITSELF rather than trust a producer to respect, and the
 * removal of the stored highlighting preference.
 *
 * The lexer, renderer and styles are pure and run directly; the component (`WhimProse.tsx`, a thin
 * `Text` mapping over `renderProse` + `proseStyle`) is rendered at the end.
 *
 * Nothing in this suite awaits a promise that could fail to settle — a bare `await` on a pending
 * promise turns one failed check into a whole-suite hang with no test named.
 */

import React from 'react';
import TestRenderer from 'react-test-renderer';
import { Harness } from './harness';
import WhimProse from '../../ui/whim-prose/WhimProse';
import { renderScreen, textOf as screenText, unmountScreen, hostType } from './react-screen';
import { lexProse, STATE_VOCABULARY } from '../../ui/whim-prose/lex';
import {
  flattenProse,
  isOffering,
  renderProse,
  MAX_SYSTEM_MARKS_PER_SENTENCE,
} from '../../ui/whim-prose/render';
import { proseStyle } from '../../ui/whim-prose/styles';
import type { ProseSegment, WhimClass } from '../../ui/whim-prose/types';
import { COLORS, TINTS } from '../../../design/tokens';
import { MapKVBackend, type KVBackend } from '../../version-store/fs/kv-fs';
import { sweepRetiredKeys } from '../retired-keys';
import { setColorScheme, StyleSheet } from './native-host';
import {
  COPY,
  CONSENT_WHATS_NEW,
  LEGAL_COPY,
  addedFieldsLine,
  composerContinueLine,
  planMakeHeader,
  copyQuestionDataSubtitle,
  deletedToast,
  discardedManyToast,
  historyQuotedPrompt,
  historyRowMeta,
  historyVersionCount,
  readyTitle,
  failureCouldntRunLine,
  makingQueueLine,
  makingRepairLine,
  makingStallLine,
  makingTitle,
  versionSwitchToast,
  tileOlderLine,
} from '../copy';

const POUR_TIMER = { name: 'Pour Timer', color: TINTS.blue.light };
const WATER_COUNTER = { name: 'Water Counter', color: TINTS.ocean.light };

/** A KVBackend over `inner` that counts what is done to it. */
function counted(inner: KVBackend) {
  const ops = { reads: 0, writes: 0, deletes: 0 };
  const kv: KVBackend = {
    getString: (key) => { ops.reads++; return inner.getString(key); },
    set: (key, value) => { ops.writes++; inner.set(key, value); },
    delete: (key) => { ops.deletes++; inner.delete(key); },
    getAllKeys: () => inner.getAllKeys(),
  };
  return { kv, ops };
}

function classesOf(segments: readonly ProseSegment[]): WhimClass[] {
  return segments.map((s) => s.cls).filter((cls): cls is WhimClass => cls !== null);
}

function countOf(segments: readonly ProseSegment[], cls: WhimClass): number {
  return classesOf(segments).filter((c) => c === cls).length;
}

function textOf(segments: readonly ProseSegment[], cls: WhimClass): string[] {
  return segments.filter((s) => s.cls === cls).map((s) => s.text);
}

/** Every string this table and its helpers can put on screen. */
function everyCopyString(): string[] {
  return [
    ...Object.values(COPY),
    ...Object.values(LEGAL_COPY.fr),
    ...Object.values(CONSENT_WHATS_NEW).flatMap((lines) => Object.values(lines).map((line) => line.text)),
    copyQuestionDataSubtitle('Water Counter'),
    deletedToast('Pour Timer'),
    discardedManyToast(2),
    tileOlderLine(2),
    addedFieldsLine(['notes (text)']),
    readyTitle('Pour Timer'),
    makingTitle('Pour Timer', false),
    makingTitle('Pour Timer', true),
    makingRepairLine(2, 3),
    makingQueueLine(3),
    makingStallLine(40),
    failureCouldntRunLine(3, true),
    failureCouldntRunLine(3, false),
    composerContinueLine('A timer for my…'),
    planMakeHeader(false),
    planMakeHeader(true),
    historyVersionCount(1),
    historyVersionCount(7),
    historyRowMeta('v6', 0, 3 * 86_400_000),
    historyQuotedPrompt('make the numbers bigger'),
    versionSwitchToast(6, 7),
    versionSwitchToast(6, 3),
  ];
}

export async function runWhimProseTests(h: Harness): Promise<void> {
  // ── the lexer: deterministic, four classes, nothing inferred ────────────────

  await h.test('lexer: `app` matches the installed list, whole-word, in that app’s own hue', () => {
    const text = 'Pour Timer got faster.';
    const spans = lexProse(text, [POUR_TIMER]);
    const app = spans.find((s) => s.cls === 'app');
    h.eq(app?.start, 0, 'the app span starts at the mention');
    h.eq(app?.end, 'Pour Timer'.length, 'the app span covers exactly the name');
    h.eq(app?.color, TINTS.blue.light, 'the span carries the tint text colour the caller resolved for that app');

    h.eq(
      lexProse('Pour Timerish got faster.', [POUR_TIMER]).filter((s) => s.cls === 'app').length,
      0,
      'a name inside a longer word is not a mention',
    );
  });

  await h.test('lexer: `measure` covers numbers, clocks, durations and version ids', () => {
    const cases: Array<[string, string]> = [
      ['it waits 0:45 now', '0:45'],
      ['back on v4 now', 'v4'],
      ['it took 3m 30s', '3m 30s'],
      ['after 3 taps', '3'],
      ['at 20% now', '20%'],
    ];
    for (const [text, expected] of cases) {
      const spans = lexProse(text).filter((s) => s.cls === 'measure');
      h.eq(spans.map((s) => text.slice(s.start, s.end)), [expected], `measure in "${text}"`);
    }
  });

  await h.test('lexer: `state` is only “ready” and “failed”, never another status word', () => {
    h.eq([...STATE_VOCABULARY].sort((a, b) => a.localeCompare(b)), ['failed', 'ready'], 'the vocabulary is the two words');
    for (const text of ['It is ready now.', 'Ready to open.', 'The last change failed.']) {
      h.eq(lexProse(text).filter((s) => s.cls === 'state').length, 1, `"${text}" marks its status word`);
    }
    for (const word of ['working', 'broken', 'waiting', 'building', 'stopped', 'fine', 'pending', 'readying', 'unfailed']) {
      const spans = lexProse(`It is ${word} now.`).filter((s) => s.cls === 'state');
      h.eq(spans.length, 0, `"${word}" is not a state`);
    }
  });

  await h.test('lexer: `state` is a whole word — letters and hyphens join it, sentence punctuation ends it', () => {
    for (const text of ['It is already open.', 'A ready-made list.', 'It failed-over twice.', 'It is unfailed.', 'It is readying.']) {
      h.eq(lexProse(text).filter((s) => s.cls === 'state').length, 0, `"${text}" marks no status word`);
    }
    for (const [text, word] of [['It is ready.', 'ready'], ['It failed, then ran.', 'failed']] as const) {
      const spans = lexProse(text).filter((s) => s.cls === 'state');
      h.eq(spans.map((s) => text.slice(s.start, s.end)), [word], `"${text}" marks “${word}”`);
    }
  });

  await h.test('lexer: `yours` is matched verbatim, never reconstructed from a paraphrase', () => {
    const prompt = 'make the numbers bigger';

    const quoted = 'You said “make the numbers bigger” and it did.';
    h.eq(textOf(renderProse(quoted, { storedPrompt: prompt }), 'yours'), [prompt], 'exact quote is yours');

    const substring = 'You said “the numbers bigger” and it did.';
    h.eq(
      textOf(renderProse(substring, { storedPrompt: prompt }), 'yours'),
      ['the numbers bigger'],
      'an exact fragment of the stored prompt is still the user’s words',
    );

    const paraphrase = 'You said “make the digits bigger” and it did.';
    h.eq(countOf(renderProse(paraphrase, { storedPrompt: prompt }), 'yours'), 0, 'a paraphrase is never attributed');

    const whole = renderProse(prompt, { storedPrompt: prompt });
    h.eq(textOf(whole, 'yours'), [prompt], 'a headline that IS the prompt is entirely the user’s words');

    h.eq(countOf(renderProse(quoted, { storedPrompt: null }), 'yours'), 0, 'no stored prompt, no attribution');
  });

  await h.test('lexer: `yours` matches the person’s words whatever their case, and keeps the text as written', () => {
    const prompt = 'Make a packing list';
    const summary = 'I made what you asked for: “make a packing list”, with a tick box on each item.';
    const segments = renderProse(summary, { storedPrompt: prompt });
    h.eq(textOf(segments, 'yours'), ['make a packing list'], 'a lowercased quote of a capitalised prompt is still the user’s words, as the producer wrote it');
    h.eq(segments.map((s) => s.text).join(''), summary, 'the rendered text is the producer’s, letter for letter');
    h.eq(textOf(renderProse('MAKE A PACKING LIST', { storedPrompt: prompt }), 'yours'), ['MAKE A PACKING LIST'], 'the prompt as a headline matches in any case');
    h.eq(countOf(renderProse('You said “make a packing app”.', { storedPrompt: prompt }), 'yours'), 0, 'case folding attributes no paraphrase');
  });

  await h.test('lexer: `chg` and `hedge` are never inferred on device', () => {
    const text = 'The countdown changed, and it may be about 2 seconds off.';
    const spans = lexProse(text, [POUR_TIMER], text);
    h.eq(spans.filter((s) => s.cls === 'chg' || s.cls === 'hedge').length, 0, 'the lexer emits neither');
    const marked = renderProse(text, { marks: [{ cls: 'chg', start: 4, end: 13 }] });
    h.eq(textOf(marked, 'chg'), ['countdown'], 'they arrive only as producer marks');
  });

  // ── the renderer: caps, flattening, precedence ──────────────────────────────

  await h.test('renderer: text is never lost — every render reproduces its input exactly', () => {
    const fixtures = [
      'Pour Timer is working again after 2 tries.',
      'It ran 1 2 3 4 5 6 times.',
      'You said “go faster” and it failed now.',
      ...everyCopyString(),
    ];
    for (const text of fixtures) {
      const segments = renderProse(text, { apps: [POUR_TIMER], storedPrompt: 'go faster' });
      h.eq(flattenProse(segments), text, `"${text}" survives rendering intact`);
    }
  });

  await h.test('renderer: a producer marking five spans in one sentence shows at most four marks', () => {
    const text = 'The timer, chime, colour, font and size changed.';
    const word = (w: string) => ({ cls: 'chg' as const, start: text.indexOf(w), end: text.indexOf(w) + w.length });
    const marks = ['timer', 'chime', 'colour', 'font', 'size'].map(word);
    const segments = renderProse(text, { marks });
    h.eq(textOf(segments, 'chg'), ['timer', 'chime', 'colour', 'font'], 'four marks render, the fifth is flat');
    h.eq(flattenProse(segments), text, 'and the fifth keeps its word');
  });

  await h.test('renderer: at most four system marks per sentence, the rest flat', () => {
    const text = 'It ran 1 2 3 4 5 6 times.';
    const segments = renderProse(text);
    h.eq(countOf(segments, 'measure'), MAX_SYSTEM_MARKS_PER_SENTENCE, 'the cap holds at four');
    h.eq(textOf(segments, 'measure'), ['1', '2', '3', '4'], 'the kept marks are the first four');
    h.eq(flattenProse(segments), text, 'the dropped marks keep their words');
    h.ok(
      segments.some((s) => s.cls === null && s.text.includes('5') && s.text.includes('6')),
      'over-cap marks render as flat text, not truncated',
    );
  });

  await h.test('renderer: the cap is per sentence, not per string', () => {
    const text = 'It ran 1 2 3 4 5 times. Then 6 7 8 9 10 more.';
    const segments = renderProse(text);
    h.eq(countOf(segments, 'measure'), 8, 'four marks in each of the two sentences');
    h.eq(textOf(segments, 'measure'), ['1', '2', '3', '4', '6', '7', '8', '9'], 'first four of each');
  });

  await h.test('renderer: one colour per sentence — the second coloured span renders flat', () => {
    const text = 'Pour Timer is ready again.';
    const segments = renderProse(text, { apps: [POUR_TIMER] });
    h.eq(countOf(segments, 'app'), 1, 'the app mention keeps the sentence’s one colour');
    h.eq(countOf(segments, 'state'), 0, 'a second hue in the same sentence renders flat');
    h.eq(flattenProse(segments), text, 'and keeps its words');

    const twoApps = renderProse('Pour Timer and Water Counter both ran.', {
      apps: [POUR_TIMER, WATER_COUNTER],
    });
    h.eq(countOf(twoApps, 'app'), 1, 'two different apps in one sentence: only one is coloured');

    const sameApp = renderProse('Pour Timer replaced Pour Timer.', { apps: [POUR_TIMER] });
    h.eq(countOf(sameApp, 'app'), 2, 'the same hue twice is one colour, so both mentions keep it');
  });

  await h.test('renderer: `yours` never spends the sentence’s one colour', () => {
    const withApp = renderProse('You said “go faster” and Pour Timer did.', {
      apps: [POUR_TIMER],
      storedPrompt: 'go faster',
    });
    h.eq(textOf(withApp, 'yours'), ['go faster'], 'the person’s words are marked');
    h.eq(textOf(withApp, 'app'), ['Pour Timer'], 'and the app mention keeps its hue beside them');

    const withState = renderProse('You said “go faster” and it failed.', { storedPrompt: 'go faster' });
    h.eq(textOf(withState, 'yours'), ['go faster'], 'the person’s words are marked');
    h.eq(textOf(withState, 'state'), ['failed'], 'and “failed” keeps its colour beside them');
  });

  await h.test('renderer: `yours` is exempt from the mark cap', () => {
    const text = 'It took 1 2 3 4 tries after you said “go faster”.';
    const segments = renderProse(text, { storedPrompt: 'go faster' });
    h.eq(countOf(segments, 'measure'), MAX_SYSTEM_MARKS_PER_SENTENCE, 'the system cap is spent');
    h.eq(textOf(segments, 'yours'), ['go faster'], 'the user’s words are marked anyway');
  });

  await h.test('renderer: overlapping spans resolve by priority, dropped whole', () => {
    const quotedApp = renderProse('You asked to “rename Pour Timer” today.', {
      apps: [POUR_TIMER],
      storedPrompt: 'rename Pour Timer',
    });
    h.eq(textOf(quotedApp, 'yours'), ['rename Pour Timer'], 'the quote wins the overlap');
    h.eq(countOf(quotedApp, 'app'), 0, 'the app mention inside it is dropped, not trimmed');
    h.eq(flattenProse(quotedApp), 'You asked to “rename Pour Timer” today.', 'no characters lost');

    const chgOverMeasure = renderProse('It waited 45s longer.', {
      marks: [{ cls: 'chg', start: 10, end: 13 }],
    });
    h.eq(textOf(chgOverMeasure, 'chg'), ['45s'], 'the one thing that changed outranks the count');
    h.eq(countOf(chgOverMeasure, 'measure'), 0, 'the measure span is dropped whole');

    const stateOverHedge = renderProse('Nothing has failed now.', {
      marks: [{ cls: 'hedge', start: 12, end: 18 }],
    });
    h.eq(textOf(stateOverHedge, 'state'), ['failed'], 'a status word outranks a hedge over it');
  });

  await h.test('renderer: `state` is suppressed when a status indicator is already adjacent', () => {
    const text = 'The timer failed.';
    h.eq(countOf(renderProse(text), 'state'), 1, 'marked on its own');
    h.eq(
      countOf(renderProse(text, { statusIndicatorAdjacent: true }), 'state'),
      0,
      'not marked beside a status indicator',
    );
  });

  await h.test('renderer: producer marks that do not resolve mark nothing', () => {
    const text = 'It ran again.';
    const bad = renderProse(text, {
      marks: [
        { cls: 'chg', start: 5, end: 3 },
        { cls: 'hedge', start: 0, end: 0 },
        { cls: 'chg', start: 3, end: 999 },
        { cls: 'hedge', start: -2, end: 4 },
      ],
    });
    h.eq(classesOf(bad).length, 0, 'inverted, empty and out-of-range marks are dropped');
    h.eq(flattenProse(bad), text, 'and the text is untouched');
  });

  // ── rule 5 (survives being flat) and rule 7 (agent prose only) ──────────────

  await h.test('copy: every string in the table renders flat — nothing is offering-marked', () => {
    for (const text of Object.values(COPY)) {
      const segments = renderProse(text, { apps: [POUR_TIMER, { name: 'timer', color: TINTS.slate.light }], storedPrompt: text });
      h.eq(classesOf(segments).length, 0, `"${text}" is an offering and carries no class`);
      h.eq(flattenProse(segments), text, `"${text}" is unchanged`);
    }
  });

  await h.test('copy: the offering guard is non-vacuous — the same words as agent prose DO mark', () => {
    h.ok(isOffering(COPY.homeIdeaTimer), 'a copy-table string is an offering');
    h.ok(!isOffering(`${COPY.homeIdeaTimer} today`), 'agent prose is not');
    const asProse = renderProse(`${COPY.homeIdeaTimer} today`, { apps: [{ name: 'timer', color: TINTS.slate.light }] });
    h.eq(countOf(asProse, 'app'), 1, 'the identical words outside the table lex normally');
  });

  // That every one of these strings also survives being rendered flat is the first renderer test.
  await h.test('copy: every string the launcher can show is non-empty and carries no exclamation mark', () => {
    for (const text of everyCopyString()) {
      h.ok(text.trim().length > 0, 'no empty string reaches the surface');
      h.ok(!text.includes('!'), `"${text}" carries no exclamation mark (house voice)`);
    }
  });

  // ── channels ────────────────────────────────────────────────────────────────

  await h.test('styles: one channel per class, on the system font', () => {
    const style = (cls: WhimClass, color?: string) => proseStyle({ text: 'x', cls, color }) ?? {};
    h.eq(style('app', TINTS.blue.light), { color: TINTS.blue.light }, 'app is its colour alone');
    h.eq(style('chg'), { fontWeight: '600' }, 'chg is weight 600, no colour');
    h.eq(style('measure'), { fontVariant: ['tabular-nums'] }, 'measure is tabular figures, no colour');
    h.eq(style('hedge', COLORS.light['text-2']), { color: COLORS.light['text-2'] }, 'hedge is `text-2`');
    h.eq(style('state', COLORS.light['positive-text']), { color: COLORS.light['positive-text'] }, 'state is its colour alone');
    h.eq(style('yours', COLORS.light.text), { fontStyle: 'italic', color: COLORS.light.text }, 'yours is italic in `text`');
    h.ok(proseStyle({ text: 'x', cls: null }) === undefined, 'flat text has no style');
  });

  await h.test('renderer: no retired faces — `measure` and `yours` render in the system font', () => {
    const segments = renderProse('You said “go faster” and it took 0:45.', { storedPrompt: 'go faster' });
    for (const cls of ['measure', 'yours'] as const) {
      const segment = segments.find((s) => s.cls === cls);
      h.ok(segment !== undefined, `the fixture renders a \`${cls}\` span`);
      h.ok(!Object.keys(proseStyle(segment ?? { text: '', cls }) ?? {}).includes('fontFamily'), `\`${cls}\` names no face, so it draws the system font`);
    }
  });

  await h.test('renderer: colours resolve through the token roles, in light and dark', () => {
    for (const scheme of ['light', 'dark'] as const) {
      const colors = COLORS[scheme];
      const colourOf = (text: string, cls: WhimClass, options = {}) => renderProse(text, { colors, ...options }).find((s) => s.cls === cls)?.color;
      h.eq(colourOf('It is ready now.', 'state'), colors['positive-text'], `${scheme}: “ready” in \`positive-text\``);
      h.eq(colourOf('The change failed.', 'state'), colors['danger-text'], `${scheme}: “failed” in \`danger-text\``);
      h.eq(colourOf('You said “go faster”.', 'yours', { storedPrompt: 'go faster' }), colors.text, `${scheme}: the person’s words in \`text\`, never a brown`);
      h.eq(colourOf('It may be off.', 'hedge', { marks: [{ cls: 'hedge', start: 3, end: 13 }] }), colors['text-2'], `${scheme}: a hedge in \`text-2\``);
    }
    h.eq(renderProse('It is ready now.').find((s) => s.cls === 'state')?.color, COLORS.light['positive-text'], 'with no colours given, the light roles');
  });

  // ── placement (design D7): shell-side, one renderer ─────────────────────────

  // ── the component, rendered ─────────────────────────────────────────────────

  await h.test('component: WhimProse always styles its spans, in the phone’s scheme', async () => {
    const text = 'Pour Timer failed after 2 tries.';
    const spans = (tree: Awaited<ReturnType<typeof renderScreen>>) =>
      tree.root.findAll((n) => hostType(n) === 'Text').slice(1).map((n) => ({ text: screenText(n), style: StyleSheet.flatten(n.props.style) }));
    const light = await renderScreen(React.createElement(WhimProse, { text, apps: [POUR_TIMER] }));
    let dark: Awaited<ReturnType<typeof renderScreen>> | undefined;
    try {
      h.eq(spans(light), [
        { text: 'Pour Timer', style: { color: TINTS.blue.light } },
        { text: '2', style: { fontVariant: ['tabular-nums'] } },
      ], 'the app name in its tint and the count in tabular figures (the sentence’s one colour is the app’s)');
      h.eq(screenText(light.root), text, 'and the words are unchanged');
      await TestRenderer.act(async () => setColorScheme('dark'));
      dark = await renderScreen(React.createElement(WhimProse, { text: 'It failed.' }));
      h.eq(spans(dark), [{ text: 'failed', style: { color: COLORS.dark['danger-text'] } }], 'in dark, “failed” takes the dark `danger-text`');
    } finally {
      await TestRenderer.act(async () => setColorScheme('light'));
      await unmountScreen(light);
      if (dark) await unmountScreen(dark);
    }
  });

  // ── the retired highlighting preference ─────────────────────────────────────

  await h.test('retired preference: a phone already swept once still loses the stored highlighting switch, and keeps everything else', () => {
    const phone = new MapKVBackend(new Map([['retired-keys-sweep', '1'], ['highlighting', '0'], ['device-id', 'd-1'], ['orb-corner:app-a', 'leading']]));
    sweepRetiredKeys(phone);
    h.eq(phone.getString('highlighting'), undefined, 'the stored switch is gone');
    h.eq([phone.getString('device-id'), phone.getString('orb-corner:app-a')], ['d-1', 'leading'], 'the other settings are untouched');
    const later = counted(phone);
    sweepRetiredKeys(later.kv);
    h.eq(later.ops, { reads: 1, writes: 0, deletes: 0 }, 'the next launch reads its marker and does nothing else');
  });

  await h.test('retired preference: a fresh install gains only the sweep’s marker', () => {
    const fresh = new MapKVBackend(new Map([['device-id', 'd-1']]));
    sweepRetiredKeys(fresh);
    h.eq(fresh.getAllKeys().filter((key) => key !== 'device-id').length, 1, 'one new key, the marker');
    h.eq(fresh.getString('device-id'), 'd-1', 'and nothing it had is lost');
    const later = counted(fresh);
    sweepRetiredKeys(later.kv);
    h.eq(later.ops, { reads: 1, writes: 0, deletes: 0 }, 'a second launch reads one key and changes nothing');
  });
}
