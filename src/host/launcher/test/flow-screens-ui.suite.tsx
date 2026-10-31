/** The making sheet's pages rendered on their own, for what their controls do: idea chips fill the
 *  field, a loading plan offers a busy action in plain words, questions answer as chips or rows with
 *  "Decide for me" exclusive, plan rows edit in place, the can't-make-as-asked state offers its two
 *  actions, and each exit on the running pages calls its own callback. */
import React, { useState } from 'react';
import TestRenderer from 'react-test-renderer';
import { ClarifyQuestion } from '@whim/contract';
import { STUB_LIMIT } from '../../../../server/src/stub-markers';
import { Harness } from './harness';
import { COPY } from '../copy';
import { describeStep, planStep, updatePlanRow, withPlan, withProblem, withQuestions, type FlowNotice, type FlowQuestion, type PlanScreen } from '../prompt-flow';
import { DescribePage } from '../DescribePage';
import { PlanPage } from '../PlanPage';
import BuildStep from '../BuildStep';
import DoneStep from '../DoneStep';
import WhimProse from '../../ui/whim-prose/WhimProse';
import { Sheet } from '../../ui/Sheet';
import { TilePlate } from '../../ui/AppTile';
import { TILE_SIDE } from '../../ui/AppTile-geometry';
import type { InstalledApp } from '../app-index';
import { androidBack, button, press, renderScreen, screenReaderElement, textOf, unmountScreen, hostType } from './react-screen';

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

  await h.test('making: Details and Leave it running each call their own callback', async () => {
    const s = spies();
    await rendered(<BuildStep stage="generate" delivering={false} signals={null} now={0} onBack={s.fn('back')} onShowDetails={s.fn('details')} />, async (tree) => {
      await press(button(tree, COPY.buildDetails));
      h.eq([s.count('details'), s.count('back')], [1, 0], 'Details opens the details');
      await press(button(tree, COPY.buildLeaveRunning));
      h.eq([s.count('details'), s.count('back')], [1, 1], 'Leave it running leaves');
    });
  });

  await h.test('ready: Open it and Back to your apps go to different places', async () => {
    const s = spies();
    await rendered(<DoneStep app={APP} onOpen={s.fn('open')} onBackToApps={s.fn('apps')} onReport={s.fn('report')} />, async (tree) => {
      await press(button(tree, COPY.doneOpen));
      h.eq([s.count('open'), s.count('apps')], [1, 0], 'Open it opens the app');
      await press(button(tree, COPY.doneBackToApps));
      h.eq([s.count('open'), s.count('apps')], [1, 1], 'Back to your apps goes back');
    });
  });
}
