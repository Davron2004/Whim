/**
 * whim-prose acceptance (shell-redesign-v2 group B; design D7) — the Whim Syntax lexer, the
 * shared renderer, and the discipline caps the renderer must enforce ITSELF rather than trust a
 * producer to respect.
 *
 * Everything under test is pure, so this runs under Node with no rendering. The RN component
 * (`WhimProse.tsx`) is a thin `Text` mapping over `renderProse` + `proseStyle`, both checked
 * here; its own source is asserted textually the way the other launcher screen suites do.
 *
 * Nothing in this suite awaits a promise that could fail to settle — a bare `await` on a pending
 * promise turns one failed check into a whole-suite hang with no test named.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { Harness } from './harness';
import { lexProse, CLASS_PRIORITY, STATE_VOCABULARY } from '../../ui/whim-prose/lex';
import {
  flattenProse,
  isOffering,
  renderProse,
  MAX_SYSTEM_MARKS_PER_SENTENCE,
} from '../../ui/whim-prose/render';
import { proseStyle } from '../../ui/whim-prose/styles';
import type { ProseSegment, WhimClass } from '../../ui/whim-prose/types';
import { appColor, SHELL_COLORS, STATUS_COLORS, STATUS_COLORS_ON_INK } from '../../../sdk/theme';
import {
  COPY,
  addedFieldsLine,
  clarifyHeadline,
  copySheetBody,
  copySheetTitle,
  deleteBody,
  forkedFromLabel,
  historyFilterAll,
  historySubtitle,
  readyTitle,
  restoreSheetBody,
  restoreSheetTitle,
  restoredToast,
} from '../copy';

const POUR_TIMER = { name: 'Pour Timer' };

function classesOf(segments: readonly ProseSegment[]): WhimClass[] {
  return segments.map((s) => s.cls).filter((cls): cls is WhimClass => cls !== null);
}

function countOf(segments: readonly ProseSegment[], cls: WhimClass): number {
  return classesOf(segments).filter((c) => c === cls).length;
}

function textOf(segments: readonly ProseSegment[], cls: WhimClass): string[] {
  return segments.filter((s) => s.cls === cls).map((s) => s.text);
}

function readSource(file: string): string {
  return fs.readFileSync(path.join(process.cwd(), file), 'utf8');
}

/** Every string this table and its helpers can put on screen. */
function everyCopyString(): string[] {
  return [
    ...Object.values(COPY),
    forkedFromLabel('Water Counter'),
    deleteBody('Pour Timer'),
    addedFieldsLine(['notes (text)']),
    readyTitle('Pour Timer'),
    clarifyHeadline(1),
    clarifyHeadline(2),
    clarifyHeadline(3),
    historySubtitle(1, 'today'),
    historySubtitle(7, '3 days ago'),
    historyFilterAll(7),
    copySheetTitle('v6'),
    copySheetBody('Pour Timer'),
    restoreSheetTitle('v6'),
    restoreSheetBody('v6'),
    restoreSheetBody('v6', 'the bigger numbers'),
    restoredToast('v6'),
  ];
}

export async function runWhimProseTests(h: Harness): Promise<void> {
  // ── the lexer: deterministic, four classes, nothing inferred ────────────────

  await h.test('lexer: the same input lexes the same way, every run', () => {
    const text = 'Pour Timer is working again after 2 tries, you said “go faster”.';
    const once = lexProse(text, [POUR_TIMER], 'go faster');
    const twice = lexProse(text, [POUR_TIMER], 'go faster');
    h.eq(once, twice, 'two runs over the same input must produce identical spans');
    h.ok(once.length > 0, 'the fixture must actually lex something (non-vacuous)');
  });

  await h.test('lexer: `app` matches the installed list, whole-word, in that app’s own hue', () => {
    const text = 'Pour Timer got faster.';
    const spans = lexProse(text, [POUR_TIMER]);
    const app = spans.find((s) => s.cls === 'app');
    h.eq(app?.start, 0, 'the app span starts at the mention');
    h.eq(app?.end, 'Pour Timer'.length, 'the app span covers exactly the name');
    h.eq(app?.color, appColor('Pour Timer'), 'an undeclared app falls back to the one appColor');

    const declared = lexProse(text, [{ name: 'Pour Timer', color: '#123456' }]);
    h.eq(declared.find((s) => s.cls === 'app')?.color, '#123456', 'a declared colour wins');

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

  await h.test('lexer: `state` is the fixed three words, never a synonym', () => {
    for (const word of STATE_VOCABULARY) {
      const spans = lexProse(`It is ${word} now.`).filter((s) => s.cls === 'state');
      h.eq(spans.length, 1, `"${word}" is in the vocabulary`);
    }
    for (const synonym of ['fine', 'failed', 'pending', 'healthy', 'stuck', 'brokenish']) {
      const spans = lexProse(`It is ${synonym} now.`).filter((s) => s.cls === 'state');
      h.eq(spans.length, 0, `"${synonym}" is a synonym, not a state`);
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
      'You said “go faster” and it is broken now.',
      ...everyCopyString(),
    ];
    for (const text of fixtures) {
      const segments = renderProse(text, { apps: [POUR_TIMER], storedPrompt: 'go faster' });
      h.eq(flattenProse(segments), text, `"${text}" survives rendering intact`);
    }
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
    const text = 'Pour Timer is working again.';
    const segments = renderProse(text, { apps: [POUR_TIMER] });
    h.eq(countOf(segments, 'app'), 1, 'the app mention keeps the sentence’s one colour');
    h.eq(countOf(segments, 'state'), 0, 'a second hue in the same sentence renders flat');
    h.eq(flattenProse(segments), text, 'and keeps its words');

    const twoApps = renderProse('Pour Timer and Water Counter both ran.', {
      apps: [POUR_TIMER, { name: 'Water Counter' }],
    });
    h.eq(countOf(twoApps, 'app'), 1, 'two different apps in one sentence: only one is coloured');

    const sameApp = renderProse('Pour Timer replaced Pour Timer.', { apps: [POUR_TIMER] });
    h.eq(countOf(sameApp, 'app'), 2, 'the same hue twice is one colour, so both mentions keep it');
  });

  await h.test('renderer: `yours` is exempt from the mark cap', () => {
    const text = 'It took 1 2 3 4 tries after you said “go faster”.';
    const segments = renderProse(text, { storedPrompt: 'go faster' });
    h.eq(countOf(segments, 'measure'), MAX_SYSTEM_MARKS_PER_SENTENCE, 'the system cap is spent');
    h.eq(textOf(segments, 'yours'), ['go faster'], 'the user’s words are marked anyway');
  });

  await h.test('renderer: overlapping spans resolve by priority, dropped whole', () => {
    h.ok(
      CLASS_PRIORITY.yours < CLASS_PRIORITY.app &&
        CLASS_PRIORITY.app < CLASS_PRIORITY.chg &&
        CLASS_PRIORITY.chg < CLASS_PRIORITY.state &&
        CLASS_PRIORITY.state < CLASS_PRIORITY.measure &&
        CLASS_PRIORITY.measure < CLASS_PRIORITY.hedge,
      'the priority order is yours > app > chg > state > measure > hedge',
    );

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

    const stateOverHedge = renderProse('Nothing is broken now.', {
      marks: [{ cls: 'hedge', start: 12, end: 18 }],
    });
    h.eq(textOf(stateOverHedge, 'state'), ['broken'], 'a status word outranks a hedge over it');
  });

  await h.test('renderer: `state` is suppressed when a status indicator is already adjacent', () => {
    const text = 'The timer is broken.';
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

  // ── the off-switch ──────────────────────────────────────────────────────────

  await h.test('off-switch: highlighting off emits no class-bearing span, anywhere', () => {
    const fixtures = [
      'Pour Timer is working again after 2 tries.',
      'You said “go faster” and it took 0:45.',
      'It ran 1 2 3 4 5 6 times.',
    ];
    for (const text of fixtures) {
      const flat = renderProse(text, {
        apps: [POUR_TIMER],
        storedPrompt: 'go faster',
        marks: [{ cls: 'chg', start: 0, end: 2 }],
        highlighting: false,
      });
      h.eq(classesOf(flat).length, 0, `"${text}" renders flat`);
      h.eq(flattenProse(flat), text, 'and reads identically');
      h.ok(
        classesOf(renderProse(text, { apps: [POUR_TIMER], storedPrompt: 'go faster' })).length > 0,
        'the same fixture DOES mark with highlighting on (the switch is non-vacuous)',
      );
    }
  });

  // ── rule 5 (survives being flat) and rule 7 (agent prose only) ──────────────

  await h.test('copy: every string in the table renders flat — nothing is offering-marked', () => {
    for (const text of Object.values(COPY)) {
      const segments = renderProse(text, { apps: [POUR_TIMER, { name: 'timer' }], storedPrompt: text });
      h.eq(classesOf(segments).length, 0, `"${text}" is an offering and carries no class`);
      h.eq(flattenProse(segments), text, `"${text}" is unchanged`);
    }
  });

  await h.test('copy: the offering guard is non-vacuous — the same words as agent prose DO mark', () => {
    h.ok(isOffering(COPY.composeChipTimer), 'a copy-table string is an offering');
    h.ok(!isOffering(`${COPY.composeChipTimer} today`), 'agent prose is not');
    const asProse = renderProse(`${COPY.composeChipTimer} today`, { apps: [{ name: 'timer' }] });
    h.eq(countOf(asProse, 'app'), 1, 'the identical words outside the table lex normally');
  });

  await h.test('copy: every string the launcher can show survives being rendered flat', () => {
    for (const text of everyCopyString()) {
      h.ok(text.trim().length > 0, 'no empty string reaches the surface');
      h.ok(!text.includes('!'), `"${text}" carries no exclamation mark (house voice)`);
      h.eq(
        flattenProse(renderProse(text, { apps: [POUR_TIMER], storedPrompt: 'go faster' })),
        text,
        `"${text}" reads identically with every mark removed`,
      );
    }
  });

  await h.test('copy: the v2 screens have their strings — no screen chain needs to invent one', () => {
    const required = [
      'homeComposerPlaceholder', 'flowBusy', 'flowContinue', 'composeHeadline', 'composeHelper',
      'composeChipsEyebrow', 'clarifyHelper', 'planHeadline', 'planSubhead', 'planFooter',
      'planBuild', 'buildTitle', 'buildSubtitle', 'buildStepReading', 'buildStepWriting',
      'buildStepChecking', 'buildStepInstalling', 'buildLeaveRunning', 'doneBody', 'doneOpen',
      'doneBackToApps', 'historyTitleSuffix', 'historyOriginYouSaid', 'historyOriginUnprompted',
      'historyCurrentMarker', 'historyTouchedEyebrow', 'historyChangeFromHere',
      'historyGoBackToThis', 'historyStartCopyHere', 'historyFilterWhatItDoes', 'historyFilterLook',
      'historyFilterFixes', 'historyRestoreConfirm', 'historyCopyConfirm', 'historyCopyToast',
      'orbActionChangeIt', 'orbActionHome', 'orbActionVersions', 'orbActionCopy',
    ] as const;
    for (const key of required) {
      h.ok(typeof COPY[key] === 'string' && COPY[key].length > 0, `COPY.${key} is seeded`);
    }
    h.eq(COPY.flowBusy, 'One moment', 'the busy label keeps its words');
    h.eq(
      [COPY.buildStepReading, COPY.buildStepWriting, COPY.buildStepChecking, COPY.buildStepInstalling],
      ['Reading your plan', 'Writing the app', 'Checking it runs safely', 'Putting it on your home screen'],
      'the four build steps are the design’s, in order',
    );
  });

  // ── channels ────────────────────────────────────────────────────────────────

  await h.test('styles: one channel per class — `yours` is the only two-channel span', () => {
    const style = (cls: WhimClass, color?: string) => proseStyle({ text: 'x', cls, color }) ?? {};
    h.eq(style('app', '#2563eb').color, '#2563eb', 'app is colour');
    h.ok(style('app', '#2563eb').fontWeight === undefined, 'app carries no weight');
    h.ok(style('chg').color === undefined, 'chg is weight, never colour');
    h.eq(style('chg').fontWeight, '500', 'chg is weight 500');
    h.ok(style('measure').color === undefined, 'measure is face, never colour');
    h.ok(style('measure').fontFamily?.startsWith('IBMPlexMono') === true, 'measure is the mono face');
    h.eq(style('hedge', SHELL_COLORS.faint).color, SHELL_COLORS.faint, 'hedge is faint');
    const yours = style('yours', SHELL_COLORS.yours);
    h.ok(
      yours.fontStyle === 'italic' && yours.color === SHELL_COLORS.yours,
      'yours alone carries both italic Newsreader and the brown',
    );
    h.ok(proseStyle({ text: 'x', cls: null }) === undefined, 'flat text has no style');
  });

  await h.test('renderer: colours resolve through the shell tokens, on paper and on ink', () => {
    const onPaper = renderProse('It is broken now.');
    h.eq(onPaper.find((s) => s.cls === 'state')?.color, STATUS_COLORS.broken, 'status hue on paper');
    const onInk = renderProse('It is broken now.', { onInk: true });
    h.eq(onInk.find((s) => s.cls === 'state')?.color, STATUS_COLORS_ON_INK.broken, 'status hue on ink');

    const quote = { storedPrompt: 'go faster' };
    h.eq(
      renderProse('You said “go faster”.', quote).find((s) => s.cls === 'yours')?.color,
      SHELL_COLORS.yours,
      'the brown on paper',
    );
    h.eq(
      renderProse('You said “go faster”.', { ...quote, onInk: true }).find((s) => s.cls === 'yours')?.color,
      SHELL_COLORS.yoursOnDark,
      'the brown on ink',
    );
  });

  // ── placement (design D7): shell-side, one renderer ─────────────────────────

  await h.test('placement: Whim Syntax is shell-side and is never exported from vc-sdk', () => {
    const sdk = fs
      .readdirSync(path.join(process.cwd(), 'src/sdk'))
      .filter((f) => f.endsWith('.ts') || f.endsWith('.tsx'))
      .map((f) => readSource(path.join('src/sdk', f)))
      .join('\n');
    h.ok(!sdk.includes('whim-prose'), 'vc-sdk must not reach into the shell renderer');

    for (const file of ['lex.ts', 'render.ts', 'styles.ts', 'types.ts']) {
      const src = readSource(path.join('src/host/ui/whim-prose', file));
      h.ok(!src.includes("from 'react-native'"), `${file} stays pure so it is Node-checkable`);
    }

    const component = readSource('src/host/ui/whim-prose/WhimProse.tsx');
    h.ok(component.includes('renderProse('), 'the component renders through the shared renderer');
    h.ok(component.includes('HighlightingProvider'), 'the off-switch reaches every screen by context');
    h.ok(!/Animated|setTimeout|fadeIn/.test(component), 'arriving prose is never faded or typed in');
  });
}
