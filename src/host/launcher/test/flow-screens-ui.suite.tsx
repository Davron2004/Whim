/** The making sheet's pages rendered on their own, for what their controls do: idea chips fill the
 *  field, a loading plan offers a busy action in plain words, questions answer as chips or rows with
 *  "Decide for me" exclusive, plan rows edit in place, the can't-make-as-asked state offers its two
 *  actions, and each exit on the running pages calls its own callback. */
import React, { useState } from 'react';
import { StyleSheet } from 'react-native';
import TestRenderer from 'react-test-renderer';
import { ClarifyQuestion } from '@whim/contract';
import { STUB_LIMIT } from '../../../../server/src/stub-markers';
import { Harness } from './harness';
import { COPY } from '../copy';
import { describeStep, planStep, updatePlanRow, withPlan, withProblem, withQuestions, type FlowNotice, type FlowQuestion, type PlanScreen } from '../prompt-flow';
import { DescribePage } from '../DescribePage';
import { OptionMark, PlanPage } from '../PlanPage';
import MakingPage from '../MakingPage';
import ReadyPage from '../ReadyPage';
import WhimProse from '../../ui/whim-prose/WhimProse';
import { Sheet } from '../../ui/Sheet';
import { TilePlate } from '../../ui/AppTile';
import { TILE_SIDE } from '../../ui/AppTile-geometry';
import { Icon } from '../../ui/Icon';
import { AmbientLight, Ember } from '../../ui/Ember';
import { Button } from '../../ui/Button';
import { tileOf } from '../tile-identity';
import { COLORS } from '../../../design/tokens';
import type { InstalledApp } from '../app-index';
import { androidBack, button, press, renderScreen, screenReaderElement, textOf, unmountScreen, hostType } from './react-screen';
import { windowMetrics } from './native-host';

type Tree = TestRenderer.ReactTestRenderer;
type Node = TestRenderer.ReactTestInstance;

/** Counts calls per callback name. */
function spies() {
  const calls: Record<string, unknown[][]> = {};
  const fn = (name: string) => (...args: unknown[]) => {
    calls[name] = [...(calls[name] ?? []), args];
  };
  return { calls, fn, count: (name: string) => calls[name]?.length ?? 0 };
}

const noop = () => {};

async function rendered(element: React.ReactElement, body: (tree: Tree) => Promise<void>): Promise<void> {
  const tree = await renderScreen(element);
  try { await body(tree); } finally { await unmountScreen(tree); }
}

const APP: InstalledApp = { id: 'timer', name: 'Timer', createdAt: 1, lineageId: 'main', record: { appId: 'timer', name: 'Timer', manifest: { capabilities: [] } } };
const BUSY: FlowNotice = { hint: 'This device is already making an app. Try again when it finishes.', tone: 'neutral' };

/** Questions as the contract defines them, so a shape the wire would refuse cannot be tested here. */
const ask = (q: unknown): FlowQuestion => ClarifyQuestion.parse(q);
const SHORT = ask({ id: 'alert', question: 'How should it tell you?', options: ['Sound', 'Buzz'], select: 'one', other: false });
const LONG = ask({ id: 'where', question: 'Where should it keep the history?', options: ['Only on this phone', 'Remember every brew, with my notes'], select: 'one', other: false });
const MANY = ask({ id: 'extras', question: 'What goes in it?', options: ['Honey', 'Lemon', 'Milk'], select: 'many', other: true });
const LONG_MANY = ask({ id: 'keep', question: 'What should it keep?', options: ['Every brew, with my notes', 'Only the last brew I made'], select: 'many', other: false });
const ROWS = [{ label: 'Timer', text: 'Counts down' }, { label: 'Alert', text: 'Buzzes at zero' }];

/** A plan page as the shell holds it once everything has landed. */
function landed(questions: FlowQuestion[] = [], over: Partial<PlanScreen> = {}): PlanScreen {
  const asked = withQuestions(planStep(describeStep(undefined, 'A tea timer')), questions);
  return { ...withPlan(asked, { rewrittenPrompt: 'A tea timer', plan: ROWS }), ...over };
}

function planPage(screen: PlanScreen, s = spies()): React.ReactElement {
  return (
    <PlanPage
      screen={screen}
      onBack={s.fn('back')}
      onAnswer={s.fn('answer')}
      onChangeRow={s.fn('row')}
      onMake={s.fn('make')}
      onTryAgain={s.fn('again')}
      onMakeInstead={s.fn('instead')}
    />
  );
}

/** A plan page in a real sheet that keeps its own screen, as the shell does, so a saved row stays
 *  saved: back and close are what the test counts. */
function HeldPlan({ initial, s }: Readonly<{ initial: PlanScreen; s: ReturnType<typeof spies> }>) {
  const [screen, setScreen] = useState(initial);
  return (
    <Sheet visible detent="large" onClose={s.fn('close')}>
      <PlanPage
        screen={screen}
        onBack={s.fn('back')}
        onAnswer={noop}
        onChangeRow={(index, text) => setScreen((current) => updatePlanRow(current, index, text))}
        onMake={noop}
        onTryAgain={noop}
        onMakeInstead={noop}
      />
    </Sheet>
  );
}

const picked = (node: Node) => node.props.accessibilityState?.checked === true;
const labelled = (tree: Tree, label: string) => tree.root.findAll((n) => hostType(n) === 'Pressable' && n.props.accessibilityLabel === label);
/** The screen reader elements every control labelled `label` is read as. */
const readAs = (tree: Tree, label: string) => labelled(tree, label).map((node) => screenReaderElement(node));
/** The one text field showing. */
const textField = (tree: Tree) => tree.root.find((n) => hostType(n) === 'TextInput');

/** A sheet's close control as drawn at a text size: its glyph's side and its box's side. */
async function closeControlAt(scale: number): Promise<{ side: number; target: number }> {
  windowMetrics.fontScale = scale;
  const tree = await renderScreen(<Sheet visible detent="fit" onClose={noop}><DescribePage text="" onChangeText={noop} onContinue={noop} /></Sheet>);
  try {
    const close = button(tree, COPY.sheetClose);
    return {
      side: Number(close.find((n) => hostType(n) === 'Svg').props.width),
      target: Number(flat(close.find((n) => String(n.type) === 'Animated.View').props.style).width),
    };
  } finally {
    windowMetrics.fontScale = 1;
    await unmountScreen(tree);
  }
}

/** A style prop as the one flat object a device would draw, whatever nesting the component gave it. */
function flat(style: unknown): Record<string, unknown> {
  if (Array.isArray(style)) return Object.assign({}, ...style.map(flat));
  return style !== null && typeof style === 'object' ? (style as Record<string, unknown>) : {};
}
/** The outermost text node showing exactly `words`. */
const textShowing = (tree: Tree, words: string) => tree.root.findAll((n) => hostType(n) === 'Text' && textOf(n) === words)[0];
/** The colour of the text showing exactly `words` inside `control`. */
const colourOf = (control: Node, words: string) => flat(control.findAll((n) => hostType(n) === 'Text' && textOf(n) === words)[0].props.style).color;
/** What the radio or checkbox in an option row draws: its border and fill, the colour of the dot
 *  inside a radio, and of the check inside a checkbox. */
function drawnMark(row: Node) {
  const marks = row.findAllByType(OptionMark);
  if (marks.length !== 1) throw new Error(`Expected one mark in the row, got ${marks.length}`);
  const [mark] = marks;
  const box = flat(mark.find((n) => hostType(n) === 'View').props.style);
  const insideIcon = (n: Node): boolean => n.type === Icon || (n.parent !== null && insideIcon(n.parent));
  const dot = mark.findAll((n) => hostType(n) === 'View' && !insideIcon(n)).slice(1).map((n) => flat(n.props.style).backgroundColor);
  return { multiple: mark.props.multiple, border: box.borderColor, fill: box.backgroundColor, dots: dot, checks: mark.findAllByType(Icon).map((icon) => [icon.props.name, icon.props.color]) };
}

/** The mark each full-width option of `LONG` (radios) and `LONG_MANY` (checkboxes) should draw when the
 *  first option is `firstPicked` and Decide for me is `decidePicked`: ordinary options in `ink`,
 *  Decide for me in `ember`, a picked mark filled and an unpicked one an empty `text-2` outline. */
function expectedMarks(firstPicked: boolean, decidePicked: boolean) {
  const c = COLORS.light;
  return ([[LONG, 'radio'], [LONG_MANY, 'checkbox']] as const).flatMap(([question, kind]) => {
    const many = kind === 'checkbox';
    const markOf = (accent: 'ink' | 'ember', on: 'on-ink' | 'on-ember', isPicked: boolean) => ({
      multiple: many,
      border: isPicked ? c[accent] : c['text-2'],
      fill: isPicked && many ? c[accent] : 'transparent',
      dots: isPicked && !many ? [c[accent]] : [],
      checks: isPicked && many ? [['check', c[on]]] : [],
    });
    return [
      { kind, label: question.options[0], index: 0, drawn: markOf('ink', 'on-ink', firstPicked) },
      { kind, label: question.options[1], index: 0, drawn: markOf('ink', 'on-ink', false) },
      { kind, label: COPY.clarifyDecide, index: many ? 1 : 0, drawn: markOf('ember', 'on-ember', decidePicked) },
    ];
  });
}

/** Pre-order position of the first text holding `words`, to read the page's top-to-bottom order. */
function positionOf(tree: Tree, words: string): number {
  const order: Node[] = [];
  const walk = (node: Node) => { order.push(node); node.children.forEach((child) => { if (typeof child !== 'string') walk(child); }); };
  walk(tree.root);
  return order.findIndex((n) => hostType(n) === 'Text' && textOf(n).includes(words));
}

export async function runFlowScreensUiTests(h: Harness): Promise<void> {
  await h.test('describe: an idea chip fills the field and does not continue; changing an app shows no chips and says which app', async () => {
    const s = spies();
    await rendered(<DescribePage text="" onChangeText={s.fn('change')} onContinue={s.fn('continue')} />, async (tree) => {
      await press(button(tree, COPY.homeIdeaTimer));
      h.eq(s.calls.change, [[COPY.homeIdeaTimer]], 'the chip’s words go into the field');
      h.eq(s.count('continue'), 0, 'and the flow does not move on');
    });
    await rendered(<DescribePage text="" editing={APP} onChangeText={noop} onContinue={noop} />, async (tree) => {
      h.ok(!textOf(tree.root).includes(COPY.homeIdeaTimer), 'no idea chips while changing an existing app');
      h.ok(textOf(tree.root).includes(COPY.composeHeadlineEdit) && textOf(tree.root).includes('Changing Timer'), 'the header names the app and asks what should change');
    });
  });

  await h.test('describe: Continue waits for words, and is disabled through a refusal’s retry window', async () => {
    const s = spies();
    await rendered(<DescribePage text="  " onChangeText={noop} onContinue={s.fn('continue')} />, async (tree) => {
      h.eq(button(tree, COPY.flowContinue).props.disabled, true, 'no words, no Continue');
    });
    await rendered(<DescribePage text="A tea timer" onChangeText={noop} onContinue={s.fn('continue')} />, async (tree) => {
      await press(button(tree, COPY.flowContinue));
      h.eq(s.count('continue'), 1, 'with words it continues');
    });
    await rendered(<DescribePage text="A tea timer" notice={{ ...BUSY, retryAt: Date.now() + 60_000 }} onChangeText={noop} onContinue={s.fn('continue')} />, async (tree) => {
      h.eq(button(tree, COPY.flowContinue).props.disabled, true, 'a retry window disables it');
      h.ok(positionOf(tree, BUSY.hint) < positionOf(tree, COPY.flowContinue), 'with the refusal above it');
    });
  });

  for (const machine of ['ar-EG', 'ko-KR']) {
    await h.test(`describe: a retry window's clock time is written in the copy's English on a ${machine} phone (#214)`, async () => {
      const PhoneFormat = Intl.DateTimeFormat;
      // The phone's locale is whatever a formatter given no locale resolves to.
      const onThePhone = function DateTimeFormat(locales?: string | string[], options?: Intl.DateTimeFormatOptions) {
        return new PhoneFormat(locales ?? machine, options);
      } as unknown as typeof Intl.DateTimeFormat;
      // On a whole minute: the line names the window's end to the nearest minute.
      const retryAt = Math.round((Date.now() + 2 * 60 * 60_000) / 60_000) * 60_000;
      const englishTime = new PhoneFormat('en', { hour: 'numeric', minute: '2-digit' }).format(new Date(retryAt));
      Intl.DateTimeFormat = onThePhone;
      try {
        h.ok(new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(retryAt)) !== englishTime, `the ${machine} phone writes the time its own way`);
        await rendered(<DescribePage text="A tea timer" notice={{ ...BUSY, retryAt }} onChangeText={noop} onContinue={noop} />, async (tree) => {
          const shown = textOf(tree.root);
          h.ok(shown.includes(`after ${englishTime}`), `the retry line reads the English time ${englishTime}: ${shown}`);
        });
      } finally {
        Intl.DateTimeFormat = PhoneFormat;
      }
    });
  }

  await h.test('plan: while its rows are coming Make it is busy in plain words and takes no taps; once they land it makes', async () => {
    const s = spies();
    await rendered(planPage(planStep(describeStep(undefined, 'A tea timer')), s), async (tree) => {
      h.eq(button(tree, COPY.planBusy).props.accessibilityState.busy, true, 'the action says what is happening instead of Make it');
      h.ok(tree.root.findAll((n) => n.props.accessibilityRole === 'progressbar').length >= 2, 'with skeletons standing in for the questions and for the plan');
      await press(button(tree, COPY.planBusy));
      h.eq(s.count('make'), 0, 'a tap while busy does nothing');
    });
    await rendered(planPage(landed([SHORT]), s), async (tree) => {
      await press(button(tree, COPY.planBuild));
      h.eq(s.count('make'), 1, 'the landed plan makes, with no question touched');
    });
  });

  await h.test('plan: the person’s words are quoted, and change mode says what changes', async () => {
    await rendered(planPage(landed()), async (tree) => {
      h.ok(textOf(tree.root).includes('“A tea timer”'), 'the words are quoted exactly');
      h.ok(textOf(tree.root).includes(COPY.planHeadline) && textOf(tree.root).includes(COPY.planMakeHeader), 'under "Here’s the plan", with "What I’ll make"');
    });
    const changing = { ...landed(), editing: APP };
    await rendered(<PlanPage screen={changing} editing={APP} onBack={noop} onAnswer={noop} onChangeRow={noop} onMake={noop} onTryAgain={noop} onMakeInstead={noop} />, async (tree) => {
      h.ok(textOf(tree.root).includes(COPY.planHeadlineEdit) && textOf(tree.root).includes(COPY.planMakeHeaderEdit), 'the headline and section say change');
      h.ok(textOf(tree.root).includes('Changing Timer'), 'the page says which app it changes');
      h.eq(tree.root.findAllByType(TilePlate).map((tile) => TILE_SIDE[tile.props.size as keyof typeof TILE_SIDE]), [24], 'beside the app’s 24 pt tile');
      h.ok(button(tree, COPY.planBuildEdit) != null, 'and the action is Make the change');
    });
  });

  await h.test('questions: all-short options are chips and a 34-character option makes every option of that question a full-width row; Decide for me ends both', async () => {
    h.eq(LONG.options[1].length, 34, 'the long option is the 34 characters the spec names');
    await rendered(planPage(landed([SHORT, LONG])), async (tree) => {
      const roleOf = (label: string) => labelled(tree, label)[0].props.accessibilityRole;
      h.eq([roleOf('Sound'), roleOf('Buzz')], ['radio', 'radio'], 'a one-pick question with short options is chips (radios)');
      const chips = labelled(tree, 'Sound')[0];
      h.ok(JSON.stringify(chips.findAll((n) => hostType(n) === 'Animated.View').map((n) => n.props.style)).includes('999'), 'drawn as capsules');
      const rowOption = labelled(tree, LONG.options[0])[0];
      h.ok(!JSON.stringify(rowOption.findAll((n) => hostType(n) === 'Animated.View').map((n) => n.props.style)).includes('999'), 'a long option makes the whole question rows, not capsules');
      h.eq(labelled(tree, COPY.clarifyDecide).length, 2, 'each question ends with Decide for me');
    });
  });

  await h.test('questions: Decide for me starts selected and is exclusive both ways, in one-pick and several-picks questions', async () => {
    const s = spies();
    const screen = landed([SHORT, MANY]);
    await rendered(planPage(screen, s), async (tree) => {
      h.eq(labelled(tree, COPY.clarifyDecide).map(picked), [true, true], 'every question starts on Decide for me');
      await press(labelled(tree, 'Buzz')[0]);
      await press(labelled(tree, COPY.clarifyDecide)[1]);
      await press(labelled(tree, 'Lemon')[0]);
      h.eq(s.calls.answer, [['alert', { kind: 'pick', option: 'Buzz' }], ['extras', { kind: 'decide' }], ['extras', { kind: 'pick', option: 'Lemon' }]], 'each tap reports its change to the shell, which folds it in');
    });
    const answered = { ...screen, answers: { alert: { choices: ['Buzz'], other: '', decide: false }, extras: { choices: ['Honey', 'Lemon'], other: '', decide: false } } };
    await rendered(planPage(answered), async (tree) => {
      h.eq(labelled(tree, COPY.clarifyDecide).map(picked), [false, false], 'picking something clears Decide for me on both kinds of question');
      h.eq(['Buzz', 'Sound', 'Honey', 'Lemon', 'Milk'].map((option) => picked(labelled(tree, option)[0])), [true, false, true, true, false], 'and the picks show');
      h.eq(labelled(tree, 'Honey')[0].props.accessibilityRole, 'checkbox', 'a several-picks question reads as checkboxes');
    });
  });

  await h.test('questions: every option, Decide for me and every plan row is its own accessibility element', async () => {
    await rendered(planPage(landed([SHORT, LONG])), async (tree) => {
      const labels = ['Sound', 'Buzz', COPY.clarifyDecide, LONG.options[0], LONG.options[1], 'Timer, Counts down', 'Alert, Buzzes at zero'];
      const elements = labels.flatMap((label) => readAs(tree, label));
      h.eq(elements.length, labels.length + 1, 'each label found, Decide for me once per question');
      h.eq(new Set(elements).size, elements.length, 'and no two share a screen reader element');
    });
  });

  await h.test('plan: a question with no questions asked shows no "A few choices"; with questions it does, and an answered one folds to one line when scrolled past', async () => {
    await rendered(planPage(landed()), async (tree) => {
      h.ok(!textOf(tree.root).includes(COPY.planChoicesHeader), 'nothing to choose, nothing to head');
    });
    const answered = { ...landed([SHORT, MANY]), answers: { alert: { choices: ['Buzz'], other: '', decide: false }, extras: { choices: [], other: '', decide: true } } };
    await rendered(planPage(answered), async (tree) => {
      h.ok(textOf(tree.root).includes(COPY.planChoicesHeader), 'the choices are headed');
      const scroll = tree.root.find((n) => hostType(n) === 'ScrollView');
      const questionBlock = tree.root.find((n) => hostType(n) === 'View' && typeof n.props.onLayout === 'function' && textOf(n).includes(SHORT.question));
      await TestRenderer.act(async () => questionBlock.props.onLayout({ nativeEvent: { layout: { x: 0, y: 100, width: 350, height: 90 } } }));
      await TestRenderer.act(async () => scroll.props.onScroll({ nativeEvent: { contentOffset: { x: 0, y: 200 } } }));
      h.eq(textOf(tree.root).includes(SHORT.question), false, 'scrolled wholly past, the answered question is one line');
      const line = button(tree, `${SHORT.question}, Buzz`);
      h.ok(textOf(line).includes('Buzz'), 'holding its answer');
      await press(line);
      h.ok(textOf(tree.root).includes(SHORT.question) && labelled(tree, 'Buzz').length === 1, 'and tapping it reopens the question');
    });
  });

  await h.test('plan: tapping a row edits it in place; Save commits that row, Cancel commits nothing, and an edited row says so', async () => {
    const s = spies();
    await rendered(planPage(landed(), s), async (tree) => {
      h.eq(tree.root.findAll((n) => hostType(n) === 'TextInput').length, 0, 'no field until a row is tapped');
      await press(button(tree, 'Alert, Buzzes at zero'));
      const field = textField(tree);
      h.eq(field.props.value, 'Buzzes at zero', 'the tapped row opens as a field holding its text');
      h.eq(button(tree, COPY.planBuild).props.disabled, true, 'Make it waits for Save or Cancel');
      await TestRenderer.act(async () => field.props.onChangeText('Chimes at zero'));
      await press(button(tree, COPY.cancel));
      h.eq(s.count('row'), 0, 'Cancel changes nothing');
      await press(button(tree, 'Alert, Buzzes at zero'));
      await TestRenderer.act(async () => textField(tree).props.onChangeText('Chimes at zero'));
      await press(button(tree, COPY.planRowSave));
      h.eq(s.calls.row, [[1, 'Chimes at zero']], 'Save commits the edit to that row, by position');
      h.eq(s.count('make'), 0, 'and does not make');
    });
    const edited = updatePlanRow(landed(), 0, 'Counts down from 90s and then rings.');
    await rendered(planPage(edited), async (tree) => {
      h.ok(textOf(button(tree, 'Timer, Counts down from 90s and then rings., Edited')).includes(COPY.planRowEdited), 'the edited row says Edited');
      h.eq(tree.root.findAllByType(WhimProse).length, 1, 'only the model’s other row goes through the prose renderer; the person’s own words are shown as typed');
    });
  });

  await h.test('plan: back cancels an open row edit first, then returns to Describe; the visible control and Android back through the sheet’s Modal do the same', async () => {
    for (const via of ['visible control', 'Android back'] as const) {
      const s = spies();
      const back = async (tree: Tree) => (via === 'Android back' ? androidBack(tree) : press(button(tree, COPY.backLabel)));
      await rendered(<HeldPlan initial={landed()} s={s} />, async (tree) => {
        await press(button(tree, 'Timer, Counts down'));
        await TestRenderer.act(async () => textField(tree).props.onChangeText('Counts down in minutes'));
        await press(button(tree, COPY.planRowSave));
        await press(button(tree, 'Alert, Buzzes at zero'));
        await TestRenderer.act(async () => textField(tree).props.onChangeText('Half-typed and never saved'));
        await back(tree);
        h.eq([tree.root.findAll((n) => hostType(n) === 'TextInput').length, s.count('back'), s.count('close')], [0, 0, 0], `${via}: with a row open it closes the edit and stays`);
        h.ok(labelled(tree, 'Timer, Counts down in minutes, Edited').length === 1 && labelled(tree, 'Alert, Buzzes at zero').length === 1, `${via}: the saved row keeps its text and the cancelled one reverts`);
        await back(tree);
        h.eq([s.count('back'), s.count('close')], [1, 0], `${via}: the next back leaves for Describe, and does not close the sheet`);
      });
    }
  });

  await h.test('plan: the back control sits in the sheet’s header row beside the close control, not in a row of its own under it; Describe, which cannot go back, has none', async () => {
    const rowOf = (node: Node) => {
      for (let at = node.parent; at; at = at.parent) if (typeof hostType(at) === 'string') return at;
      return null;
    };
    await rendered(<HeldPlan initial={landed()} s={spies()} />, async (tree) => {
      const back = labelled(tree, COPY.backLabel);
      h.eq(back.length, 1, 'one back control');
      h.ok(rowOf(back[0]) !== null && rowOf(back[0]) === rowOf(button(tree, COPY.sheetClose)), 'it shares its row with the close control');
    });
    await rendered(<Sheet visible detent="large" onClose={noop}><DescribePage text="A tea timer" onChangeText={noop} onContinue={noop} /></Sheet>, async (tree) => {
      h.eq(labelled(tree, COPY.backLabel).length, 0, 'Describe has no back control');
    });
  });

  await h.test('a sheet’s close glyph is 24 at the default text size and grows with the text, to a cap, inside the same 44 target', async () => {
    const [normal, large, huge, max] = [await closeControlAt(1), await closeControlAt(1.35), await closeControlAt(2), await closeControlAt(3)];
    h.eq(normal.side, 24, 'at the default size, the 24 headers use');
    h.ok(large.side > normal.side && huge.side >= large.side, 'larger text, a larger glyph');
    h.eq(max.side, huge.side, 'which stops growing past the cap');
    h.ok([normal, large, huge, max].every((glyph) => glyph.target === 44 && glyph.side <= glyph.target), 'in a target that stays 44 and holds the glyph');
  });

  await h.test('a sheet whose text size changes while it is up lays its content out again: iOS keeps every text measured at the old size otherwise', async () => {
    const mounts = { count: 0 };
    const Probe = () => { React.useEffect(() => { mounts.count += 1; }, []); return null; };
    const sheet = <Sheet visible detent="large" onClose={noop}><Probe /></Sheet>;
    const tree = await renderScreen(sheet);
    try {
      h.eq(mounts.count, 1, 'setup: mounted once');
      windowMetrics.fontScale = 2;
      await TestRenderer.act(async () => tree.update(<Sheet visible detent="large" onClose={noop}><Probe /></Sheet>));
      h.eq(mounts.count, 2, 'the text size changed: the content is built again');
      await TestRenderer.act(async () => tree.update(<Sheet visible detent="large" onClose={noop}><Probe /></Sheet>));
      h.eq(mounts.count, 2, 'and only then, not on every render');
    } finally {
      windowMetrics.fontScale = 1;
      await unmountScreen(tree);
    }
  });

  await h.test('describe: Android back through the sheet’s Modal closes the sheet, as the close control does', async () => {
    for (const via of ['close control', 'Android back'] as const) {
      let closes = 0;
      await rendered(<Sheet visible detent="large" onClose={() => { closes++; }}><DescribePage text="A tea timer" onChangeText={noop} onContinue={noop} /></Sheet>, async (tree) => {
        if (via === 'Android back') await androidBack(tree);
        else await press(button(tree, COPY.sheetClose));
        h.eq(closes, 1, `${via}: closes once`);
      });
    }
  });

  await h.test('questions: every full-width option shows a radio (one pick) or a checkbox (several); a picked one is filled in its role’s colour, Decide for me in ember, an unpicked one is empty', async () => {
    const picks = { where: { choices: [LONG.options[0]], other: '', decide: false }, keep: { choices: [LONG_MANY.options[0]], other: '', decide: false } };
    const screens = [
      { screen: landed([LONG, LONG_MANY]), rows: expectedMarks(false, true), what: 'Decide for me picked, nothing else' },
      { screen: { ...landed([LONG, LONG_MANY]), answers: picks }, rows: expectedMarks(true, false), what: 'the first option picked, Decide for me not' },
    ];
    for (const { screen, rows, what } of screens) {
      await rendered(planPage(screen), async (tree) => {
        for (const { kind, label, index, drawn } of rows) {
          h.eq(drawnMark(labelled(tree, label)[index]), drawn, `${what}: ${label} draws its ${kind} mark`);
        }
      });
    }
  });

  await h.test('questions: in a full-width list "Decide for me" keeps the ember treatment its chip has, and fills when picked', async () => {
    const answered = { ...landed([SHORT, LONG]), answers: { alert: { choices: [], other: '', decide: true }, where: { choices: [LONG.options[0]], other: '', decide: false } } };
    await rendered(planPage(landed([SHORT, LONG])), async (tree) => {
      const [chip, row] = labelled(tree, COPY.clarifyDecide);
      h.ok(colourOf(row, COPY.clarifyDecide) !== undefined && colourOf(row, COPY.clarifyDecide) === colourOf(chip, COPY.clarifyDecide), 'the row’s label is the chip’s colour');
      h.ok(colourOf(row, COPY.clarifyDecide) !== flat(textShowing(tree, LONG.options[0]).props.style).color, 'and not the colour of an ordinary option');
      const fill = (node: Node) => flat(node.props.style({ pressed: false })).backgroundColor;
      h.ok(typeof fill(row) === 'string', 'picked, the row is filled');
      h.eq(fill(labelled(tree, LONG.options[0])[0]), undefined, 'an ordinary option unpicked is not');
    });
    await rendered(planPage(answered), async (tree) => {
      const row = labelled(tree, COPY.clarifyDecide)[1];
      h.eq(flat(row.props.style({ pressed: false })).backgroundColor, undefined, 'another option picked, Decide for me gives up its fill');
    });
  });

  await h.test('plan: a plan row’s words are body text in the text colour, the same as the words of a row the person rewrote; Save and Cancel are full-height targets', async () => {
    const mixed = updatePlanRow(landed(), 0, 'Counts down from 90s and then rings.');
    await rendered(planPage(mixed), async (tree) => {
      const ours = flat(textShowing(tree, 'Buzzes at zero').props.style);
      const theirs = flat(textShowing(tree, 'Counts down from 90s and then rings.').props.style);
      h.eq([ours.fontSize, ours.lineHeight, ours.color], [theirs.fontSize, theirs.lineHeight, theirs.color], 'the model’s words and the person’s share size, line height and colour');
      const label = flat(textShowing(tree, 'Alert').props.style);
      h.ok(Number(ours.fontSize) > Number(label.fontSize) && ours.color !== label.color, 'larger than the label above and not its dimmer colour');
    });
    await rendered(planPage(landed()), async (tree) => {
      await press(button(tree, 'Timer, Counts down'));
      for (const label of [COPY.cancel, COPY.planRowSave]) {
        const capsule = button(tree, label).findAll((n) => hostType(n) === 'Animated.View')[0];
        h.ok(Number(flat(capsule.props.style).minHeight) >= 44, `${label} is at least 44 high`);
      }
    });
  });

  await h.test('plan: with no rows and nothing on the way, "What I’ll make" is not drawn above an empty gap; skeletons and rows bring it back', async () => {
    const notArrived = { ...planStep(describeStep(undefined, 'A tea timer')), asking: false, loading: false, notice: BUSY };
    await rendered(planPage(notArrived), async (tree) => {
      h.ok(textOf(tree.root).includes(BUSY.hint), 'the notice shows');
      h.ok(!textOf(tree.root).includes(COPY.planMakeHeader), 'with no label over nothing');
    });
    const failed = { ...withProblem(planStep(describeStep(undefined, 'A tea timer')), { request: 'rewrite', reason: 'I couldn’t reach the server.' }), asking: false };
    await rendered(planPage(failed), async (tree) => {
      h.ok(!textOf(tree.root).includes(COPY.planMakeHeader), 'a plan that failed to come has no label either');
    });
    await rendered(planPage(planStep(describeStep(undefined, 'A tea timer'))), async (tree) => {
      h.ok(textOf(tree.root).includes(COPY.planMakeHeader), 'rows on their way: the label shows over the skeletons');
    });
    await rendered(planPage(landed()), async (tree) => {
      h.ok(textOf(tree.root).includes(COPY.planMakeHeader), 'rows landed: the label shows');
    });
  });

  await h.test('plan: a request the page could not send shows its sentence and Try again in place of Make it', async () => {
    const s = spies();
    const problem = withProblem(planStep(describeStep(undefined, 'A tea timer')), { request: 'rewrite', reason: 'I couldn’t reach the server.' });
    await rendered(planPage(problem, s), async (tree) => {
      h.ok(textOf(tree.root).includes('I couldn’t reach the server.'), 'the sentence shows');
      h.eq(tree.root.findAll((n) => hostType(n) === 'Pressable' && n.props.accessibilityLabel === COPY.planBuild).length, 0, 'and Make it is not offered');
      await press(button(tree, COPY.planTryAgain));
      h.eq(s.count('again'), 1, 'Try again asks for the request again');
    });
  });

  await h.test('plan: a server notice stands above Make it', async () => {
    await rendered(planPage({ ...landed(), notice: BUSY }), async (tree) => {
      const notice = positionOf(tree, BUSY.hint);
      h.ok(notice >= 0 && notice < positionOf(tree, COPY.planBuild), 'the notice comes before the action in the page');
    });
  });

  await h.test('can’t make as asked: the reason, a card with the alternative, Make that instead and Change my idea', async () => {
    const limit = STUB_LIMIT.limit!;
    const s = spies();
    const screen = { ...planStep(describeStep(undefined, 'What to wear today')), asking: false, loading: false, limit };
    await rendered(planPage(screen, s), async (tree) => {
      const shown = textOf(tree.root);
      h.ok(shown.includes(COPY.planLimitHeadline) && shown.includes('“What to wear today”'), 'the headline and the quote');
      h.ok(shown.includes(limit.reason) && shown.includes(COPY.planLimitCardLead) && shown.includes(limit.alternative), 'the reason, and the card offering the alternative');
      h.ok(!shown.includes(COPY.planChoicesHeader), 'no questions on a request that cannot be made');
      await press(button(tree, COPY.planMakeInstead));
      await press(button(tree, COPY.planChangeIdea));
      h.eq([s.count('instead'), s.count('back')], [1, 1], 'Make that instead and Change my idea each do their own thing');
      h.eq(s.count('make'), 0, 'and nothing is made');
    });
  });

  await h.test('making: the run’s name and words, its steps with the time on the current one, the time line, and Stop', async () => {
    const s = spies();
    const signals = { startedAt: 0, aggregates: { chars: 1204, tokens: 300 }, lastTokenAt: 41_000, lastThinkingAt: null, lastFrameAt: 41_000 };
    await rendered(<MakingPage name="Tea timer" changing={false} words="A tea timer" stage="generate" delivering={false} stepSince={1_000} signals={signals} now={42_000} activity={0.6} onStop={s.fn('stop')} />, async (tree) => {
      const shown = textOf(tree.root);
      h.ok(shown.includes('Making Tea timer') && shown.includes('“A tea timer”'), 'the headline names the app, over the person’s words');
      h.ok(shown.includes(COPY.makingTimeUsual), 'at 42 s the time line is the usual one');
      h.eq(stepLabels(tree), [`${COPY.buildStepReading}, ${COPY.makingStepDone}`, `${COPY.buildStepWriting}, ${COPY.makingStepCurrent}, 0:41`, `${COPY.buildStepChecking}, ${COPY.makingStepWaiting}`, `${COPY.buildStepInstalling}, ${COPY.makingStepWaiting}`], 'one element per step: done, current with the time since it began, waiting');
      h.eq([tree.root.findByType(Ember).props.state, tree.root.findByType(Ember).props.activity], ['working', 0.6], 'the ember follows this run’s stream');
      h.ok(!/1,?204|characters|Details|Leave it running/.test(shown), 'no output counter, and no Details or leave control: the sheet’s close is the way out');
      await press(button(tree, COPY.actionStop));
      h.eq(s.count('stop'), 1, 'Stop stops');
    });
    await rendered(<MakingPage name="Water Counter" changing words="Count glasses" stage={null} delivering={false} signals={null} now={0} activity={0} onStop={noop} />, async (tree) => {
      h.ok(textOf(tree.root).includes('Changing Water Counter'), 'a change says so');
    });
  });

  await h.test('making: in line the page says how many are ahead, nothing has started, and the ember is still and dim', async () => {
    const signals = { startedAt: 0, aggregates: { chars: 0, tokens: 0 }, lastTokenAt: null, lastThinkingAt: null, lastFrameAt: 0, inLine: true };
    await rendered(<MakingPage name="Tea timer" changing={false} words="A tea timer" stage={null} delivering={false} queuedPosition={3} stepSince={0} signals={signals} now={5_000} activity={0.9} onStop={noop} />, async (tree) => {
      h.ok(textOf(tree.root).includes('2 ahead of you.'), 'position 3 is two ahead');
      h.ok(stepLabels(tree).every((label) => label.endsWith(COPY.makingStepWaiting)), 'no step has started');
      const ember = tree.root.findByType(Ember).props;
      h.eq(ember.activity, 0, 'the ember is still, whatever the sample says');
      await rendered(<TilePlate size="grid" state="queued" tint="rose" glyph="coffee" />, async (tile) => {
        h.eq(ember.state, tile.root.findByType(Ember).props.state, 'and dim as the waiting tile’s ember');
      });
      await rendered(<TilePlate size="grid" state="making" tint="rose" glyph="coffee" />, async (tile) => {
        h.ok(ember.state !== tile.root.findByType(Ember).props.state, 'not burning like a tile being made');
      });
      h.ok(button(tree, COPY.actionStop) != null, 'and Stop is there');
    });
  });

  await h.test('making: 40 s with no frame at all is a stall, said with the ember stuck', async () => {
    const signals = { startedAt: 0, aggregates: { chars: 10, tokens: 3 }, lastTokenAt: 5_000, lastThinkingAt: null, lastFrameAt: 5_000 };
    await rendered(<MakingPage name="Tea timer" changing={false} words="A tea timer" stage="generate" delivering={false} stepSince={0} signals={signals} now={46_000} activity={0.4} onStop={noop} />, async (tree) => {
      h.ok(textOf(tree.root).includes('No word from the server for 40 s. Still waiting.'), 'the stall line replaces the time line');
      h.eq(tree.root.findByType(Ember).props.state, 'stuck', 'and the ember is stuck');
    });
  });

  await h.test('making: the ambient light fades into the sheet where the page’s top cuts it off and is whole by the ember, so the cut shows no edge', async () => {
    await rendered(<MakingPage name="Tea timer" changing={false} words="A tea timer" stage="generate" delivering={false} stepSince={0} signals={null} now={0} activity={1} onStop={noop} />, async (tree) => {
      const light = tree.root.findByType(AmbientLight);
      // The light hangs above the page's first row by its wrapper's negative top; the page's own
      // top edge (where the scroll view clips) is that far down the light's box.
      const cut = -Number(StyleSheet.flatten(light.parent!.props.style).top);
      const height = Number(light.props.height);
      const rects = light.findAll((n) => hostType(n) === 'Rect');
      const glowAt = rects.findIndex((r) => !String(r.props.fill).includes('fade'));
      const veil = rects.find((r, i) => i > glowAt && String(r.props.fill).includes('fade'));
      h.ok(veil !== undefined, 'something is drawn over the glow');
      const fade = light.find((n) => hostType(n) === 'LinearGradient' && veil!.props.fill === `url(#${String(n.props.id)})`);
      const stops = fade.findAll((n) => hostType(n) === 'Stop');
      h.eq(stops.map((s) => s.props.stopColor), [COLORS.light.sheet, COLORS.light.sheet], 'in the sheet’s own colour');
      const [from, to] = stops.map((s) => Number(s.props.stopOpacity));
      const covered = (y: number) => {
        if (y < Number(veil!.props.y) || y > Number(veil!.props.y) + Number(veil!.props.height)) return 0;
        const along = Math.min(1, Math.max(0, (y - Number(fade.props.y1)) / (Number(fade.props.y2) - Number(fade.props.y1))));
        return from + (to - from) * along;
      };
      h.ok(cut > 0, `the light reaches above the page (${cut} pt)`);
      h.eq([covered(0), covered(cut)], [1, 1], 'the sheet covers it wholly at and above the page’s top edge');
      h.eq(covered(height / 2), 0, 'and not at all at its centre, behind the ember');
    });
  });

  await h.test('making: a repair adds its row under the check, and the marker is on it', async () => {
    await rendered(<MakingPage name="Tea timer" changing={false} words="A tea timer" stage="check" delivering={false} repairAttempt={2} stepSince={60_000} signals={null} now={75_000} activity={0} onStop={noop} />, async (tree) => {
      h.eq(stepLabels(tree), [
        `${COPY.buildStepReading}, ${COPY.makingStepDone}`,
        `${COPY.buildStepWriting}, ${COPY.makingStepDone}`,
        `${COPY.buildStepChecking}, ${COPY.makingStepDone}`,
        `Fixing a problem · try 2 of 3, ${COPY.makingStepCurrent}, 0:15`,
        `${COPY.buildStepInstalling}, ${COPY.makingStepWaiting}`,
      ], 'the check found the problem, the fix is current, and the marker never goes back up to the check');
    });
  });

  await h.test('ready: the app’s tile, its name and the words; Open it in the app’s tint opens it, Done goes home', async () => {
    const s = spies();
    await rendered(<ReadyPage app={APP} words="A tea timer" changed={false} onOpen={s.fn('open')} onDone={s.fn('done')} />, async (tree) => {
      const shown = textOf(tree.root);
      h.ok(shown.includes('Timer') && shown.includes('“A tea timer”') && shown.includes(COPY.readyOnHome), 'the name, the words and where it is');
      h.eq(tree.root.findByType(TilePlate).props.size, 'hero', 'the 96 pt tile');
      const open = tree.root.findAllByType(Button).find((b) => b.props.label === COPY.readyOpen);
      h.eq([open?.props.variant, open?.props.tint], ['tint', tileOf(APP).tint], 'Open it is in the app’s own tint');
      h.eq(tree.root.findAllByType(Button).map((b) => b.props.label), [COPY.readyOpen, COPY.readyDone], 'and the page carries no other action, no report among them');
      await press(button(tree, COPY.readyOpen));
      h.eq([s.count('open'), s.count('done')], [1, 0], 'Open it opens the app');
      await press(button(tree, COPY.readyDone));
      h.eq([s.count('open'), s.count('done')], [1, 1], 'Done goes home');
    });
  });
}

/** The Making page's step rows as a screen reader hears them, one element each. */
function stepLabels(tree: Tree): string[] {
  return tree.root
    .findAll((n) => hostType(n) === 'View' && n.props.accessible === true && typeof n.props.accessibilityLabel === 'string')
    .map((n) => String(n.props.accessibilityLabel))
    .filter((label) => [COPY.makingStepDone, COPY.makingStepCurrent, COPY.makingStepWaiting].some((state) => label.includes(`, ${state}`)));
}
