/** The prompt flow's step screens rendered on their own, for what their controls do: chips fill
 *  the field, a loading step offers no primary action, plan rows edit in place, and each exit on
 *  the build and done screens calls its own callback. */
import React from 'react';
import TestRenderer from 'react-test-renderer';
import { Harness } from './harness';
import { COPY, LEGAL_COPY, clarifyBuildInstead } from '../copy';
import { composeStep, planStep, primaryActionLabel, updatePlanRow, withPlan, type FlowNotice, type FlowQuestion } from '../prompt-flow';
import ComposeStep from '../ComposeStep';
import ClarifyStep from '../ClarifyStep';
import PlanStep from '../PlanStep';
import BuildStep from '../BuildStep';
import DoneStep from '../DoneStep';
import ServiceNotice from '../ServiceNotice';
import TermsScreen from '../TermsScreen';
import ReportSheet from '../ReportSheet';
import type { InstalledApp } from '../app-index';
import type { StoreAccess } from '../store-access';
import { reportClientOptions } from '../transport-shared';
import { testAppInfo } from './client-fixtures';
import { SPACING, TYPE_SCALE } from '../../../sdk/theme';
import { StyleSheet } from './native-host';
import { button, press, renderScreen, textOf, unmountScreen } from './react-screen';

type Tree = TestRenderer.ReactTestRenderer;

/** Counts calls per callback name. */
function spies() {
  const calls: Record<string, unknown[][]> = {};
  const fn = (name: string) => (...args: unknown[]) => {
    calls[name] = [...(calls[name] ?? []), args];
  };
  return { calls, fn, count: (name: string) => calls[name]?.length ?? 0 };
}

const isTextInput = (node: TestRenderer.ReactTestInstance) => node.type === 'TextInput';
const touchableWith = (tree: Tree, text: string) => tree.root.find((n) => n.type === 'TouchableOpacity' && textOf(n).includes(text));

async function rendered(element: React.ReactElement, body: (tree: Tree) => Promise<void>): Promise<void> {
  const tree = await renderScreen(element);
  try { await body(tree); } finally { await unmountScreen(tree); }
}

const APP: InstalledApp = { id: 'timer', name: 'Timer', createdAt: 1, lineageId: 'main', record: { appId: 'timer', name: 'Timer', manifest: { capabilities: [] } } };
const QUESTION: FlowQuestion = { id: 'alert', question: 'How should it tell you?', options: ['Sound', 'Buzz'], select: 'one', other: false };
const ROWS = [{ label: 'Timer', text: 'Counts down' }, { label: 'Alert', text: 'Buzzes at zero' }];
const BUSY: FlowNotice = { hint: 'This device is already building an app. Try again when it finishes.', tone: 'neutral' };

type Node = TestRenderer.ReactTestInstance;
const marginOf = (node: Node, side: 'marginTop' | 'marginBottom'): number => {
  const style = StyleSheet.flatten(node.props.style) as Record<string, number | undefined>;
  return style[side] ?? style.marginVertical ?? style.margin ?? 0;
};
const contains = (outer: Node, inner: Node): boolean => {
  for (let at: Node | null = inner; at; at = at.parent) if (at === outer) return true;
  return false;
};

/** The space between the notice's card and `action` below it: every bottom margin from the card up
 *  to the view the two share, and the action's top margin. */
function gapBetween(notice: Node, action: Node): number {
  let gap = marginOf(action, 'marginTop');
  for (let at: Node | null = notice; at && !contains(at, action); at = at.parent) {
    if (typeof at.type === 'string') gap += marginOf(at, 'marginBottom');
  }
  return gap;
}

/** A control's fill, and the colour its outer edge shows: its border's where it draws one. */
function fillAndEdge(node: Node): [unknown, unknown] {
  const style = StyleSheet.flatten(node.props.style) as { backgroundColor?: string; borderColor?: string; borderWidth?: number };
  return [style.backgroundColor, (style.borderWidth ?? 0) > 0 ? style.borderColor : style.backgroundColor];
}

/** Lets a sheet's asynchronous first load land. */
const loaded = () => TestRenderer.act(async () => { await new Promise((resolve) => setImmediate(resolve)); });

/** The face of the innermost text holding `words`. */
function faceOf(tree: Tree, words: string): unknown {
  const holds = (n: Node) => String(n.type) === 'Text' && textOf(n).includes(words);
  const innermost = tree.root.findAll((n) => holds(n) && n.findAll((c) => c !== n && holds(c)).length === 0);
  if (innermost.length !== 1) throw new Error(`expected one text holding “${words}”, got ${innermost.length}`);
  return (StyleSheet.flatten(innermost[0].props.style) as { fontFamily?: string }).fontFamily;
}

/** The card `ServiceNotice` draws. */
const noticeCard = (tree: Tree): Node => tree.root.findByType(ServiceNotice).find((n) => typeof n.type === 'string');

export async function runFlowScreensUiTests(h: Harness): Promise<void> {
  await h.test('compose: a starter chip fills the field and does not continue; editing an app shows no chips', async () => {
    const s = spies();
    await rendered(<ComposeStep text="" editing={false} onChangeText={s.fn('change')} onContinue={s.fn('continue')} onBack={s.fn('back')} />, async (tree) => {
      await press(button(tree, COPY.composeChipTimer));
      h.eq(s.calls.change, [[COPY.composeChipTimer]], 'the chip’s words go into the field');
      h.eq(s.count('continue'), 0, 'and the flow does not move on');
    });
    await rendered(<ComposeStep text="" editing editingName="Timer" onChangeText={s.fn('change')} onContinue={s.fn('continue')} onBack={s.fn('back')} />, async (tree) => {
      h.ok(!textOf(tree.root).includes(COPY.composeChipTimer), 'no starter chips while changing an existing app');
    });
  });

  await h.test('clarify and plan: while loading there is no primary action; once loaded it is live, with no answers required', async () => {
    const s = spies();
    const clarify = (loading: boolean) => (
      <ClarifyStep prompt="A tea timer" questions={loading ? [] : [QUESTION]} answers={{}} loading={loading} editing={false}
        onAnswer={s.fn('answer')} onContinue={s.fn('continue')} onBack={s.fn('back')} />
    );
    await rendered(clarify(true), async (tree) => {
      h.ok(!textOf(tree.root).includes(primaryActionLabel('clarify', false)), 'the loading clarify step shows no primary action');
    });
    await rendered(clarify(false), async (tree) => {
      await press(button(tree, primaryActionLabel('clarify', false)));
      h.eq(s.count('continue'), 1, 'the loaded clarify step continues with no question answered');
    });
    const plan = (loading: boolean) => (
      <PlanStep rows={loading ? [] : ROWS} loading={loading} editing={false} onChangeRow={s.fn('row')} onBuild={s.fn('build')} onBack={s.fn('back')} />
    );
    await rendered(plan(true), async (tree) => {
      h.ok(!textOf(tree.root).includes(primaryActionLabel('plan', false)), 'the loading plan step shows no primary action');
    });
    await rendered(plan(false), async (tree) => {
      await press(button(tree, primaryActionLabel('plan', false)));
      h.eq(s.count('build'), 1, 'the loaded plan builds');
    });
  });

  await h.test('a refusal notice stands at least a sibling gap above the action beneath it, on every step that shows one', async () => {
    const noop = () => {};
    const limit = { reason: 'That needs a camera.', alternative: 'a notes app' };
    const steps: [string, React.ReactElement, string][] = [
      ['compose', <ComposeStep text="A tea timer" notice={BUSY} editing={false} onChangeText={noop} onContinue={noop} onBack={noop} />, primaryActionLabel('compose', false)],
      ['clarify', <ClarifyStep prompt="A tea timer" questions={[QUESTION]} answers={{}} loading={false} notice={BUSY} editing={false} onAnswer={noop} onContinue={noop} onBack={noop} />, primaryActionLabel('clarify', false)],
      ['clarify limit', <ClarifyStep prompt="A tea timer" questions={[]} answers={{}} loading={false} notice={BUSY} limit={limit} editing={false} onAnswer={noop} onContinue={noop} onBack={noop} />, clarifyBuildInstead(limit.alternative)],
      ['plan', <PlanStep rows={ROWS} loading={false} notice={BUSY} editing={false} onChangeRow={noop} onBuild={noop} onBack={noop} />, primaryActionLabel('plan', false)],
    ];
    for (const [name, element, action] of steps) {
      await rendered(element, async (tree) => {
        const gap = gapBetween(noticeCard(tree), button(tree, action));
        h.ok(gap >= SPACING.sm, `${name}: the notice stands ${gap} clear of “${action}”, at least the ${SPACING.sm} between siblings`);
      });
    }
  });

  await h.test('every primary action that can be taken is filled edge to edge like the terms step’s Accept, with no ring of another colour', async () => {
    const noop = () => {};
    let accept: [unknown, unknown] = [undefined, undefined];
    await rendered(<TermsScreen language="en" onLanguageChange={noop} onAccept={noop} onClose={noop} />, async (tree) => {
      accept = fillAndEdge(button(tree, LEGAL_COPY.en.termsAccept));
    });
    h.ok(accept[0] !== undefined && accept[0] === accept[1], 'the reference: Accept’s edge is its fill');
    const limit = { reason: 'That needs a camera.', alternative: 'a notes app' };
    const primaries: [string, React.ReactElement, string][] = [
      ['compose', <ComposeStep text="A tea timer" editing={false} onChangeText={noop} onContinue={noop} onBack={noop} />, primaryActionLabel('compose', false)],
      ['clarify', <ClarifyStep prompt="A tea timer" questions={[QUESTION]} answers={{}} loading={false} editing={false} onAnswer={noop} onContinue={noop} onBack={noop} />, primaryActionLabel('clarify', false)],
      ['clarify limit', <ClarifyStep prompt="A tea timer" questions={[]} answers={{}} loading={false} limit={limit} editing={false} onAnswer={noop} onContinue={noop} onBack={noop} />, clarifyBuildInstead(limit.alternative)],
      ['plan', <PlanStep rows={ROWS} loading={false} editing={false} onChangeRow={noop} onBuild={noop} onBack={noop} />, primaryActionLabel('plan', false)],
      ['done', <DoneStep app={APP} onOpen={noop} onBackToApps={noop} onReport={noop} />, COPY.doneOpen],
    ];
    for (const [name, element, label] of primaries) {
      await rendered(element, async (tree) => {
        h.eq(fillAndEdge(button(tree, label)), accept, `${name}: “${label}” is filled and edged like Accept`);
      });
    }
  });

  await h.test('a report reason is picked the way a clarify answer is: the accent, fill and edge, with its label on it', async () => {
    const noop = () => {};
    const labelColour = (node: Node) => (StyleSheet.flatten(node.find((n) => String(n.type) === 'Text').props.style) as { color?: string }).color;
    let answer: unknown[] = [];
    await rendered(
      <ClarifyStep prompt="A tea timer" questions={[QUESTION]} answers={{ alert: { choices: ['Buzz'], other: '', decide: false } }} loading={false} editing={false} onAnswer={noop} onContinue={noop} onBack={noop} />,
      async (tree) => {
        const picked = button(tree, 'Buzz');
        answer = [...fillAndEdge(picked), labelColour(picked)];
      },
    );
    const access = { activeDescription: async () => 'A tea timer', activeSource: async () => undefined } as unknown as StoreAccess;
    const options = reportClientOptions({ kind: 'absent' }, 'https://server.test', 'device', testAppInfo);
    await rendered(<ReportSheet app={APP} access={access} options={options} onClose={noop} onUpdateRequired={noop} legalLanguage="en" />, async (tree) => {
      await loaded();
      await press(button(tree, COPY.reportReasonBroken));
      const picked = button(tree, COPY.reportReasonBroken);
      h.eq([...fillAndEdge(picked), labelColour(picked)], answer, 'the picked reason looks like a picked answer');
      h.ok(fillAndEdge(button(tree, COPY.reportReasonOther))[0] !== answer[0], 'and an unpicked reason does not');
    });
  });

  await h.test('plan: a row the user rewrote shows their words in the body face, a number they typed included, while the model’s rows keep Whim Syntax', async () => {
    const noop = () => {};
    const planned = withPlan(planStep(composeStep(undefined, 'A checklist for the day')), {
      rewrittenPrompt: 'A checklist for the day',
      plan: [
        { label: 'Progress', text: 'A bar that fills as tasks are ticked off.' },
        { label: 'Timer', text: 'Counts down from 90s.' },
      ],
    });
    const edited = updatePlanRow(planned, 0, 'A bar that fills as tasks are ticked off. It turns green at 100.');
    await rendered(<PlanStep rows={edited.rows} loading={false} editing={false} onChangeRow={noop} onBuild={noop} onBack={noop} />, async (tree) => {
      h.eq(faceOf(tree, '100'), TYPE_SCALE.body.fontFamily, 'the 100 the user typed is in the body face, not set as a measure');
      h.ok(faceOf(tree, '90s') !== TYPE_SCALE.body.fontFamily, 'the model’s own row still sets its measure apart');
    });
  });

  await h.test('plan: tapping a row edits it in place; Save commits that row, Cancel commits nothing', async () => {
    const s = spies();
    await rendered(<PlanStep rows={ROWS} loading={false} editing={false} onChangeRow={s.fn('row')} onBuild={s.fn('build')} onBack={s.fn('back')} />, async (tree) => {
      const rowButton = (text: string) => touchableWith(tree, text);
      h.eq(tree.root.findAll((n) => n.type === 'TextInput').length, 0, 'no field until a row is tapped');
      await press(rowButton('Buzzes at zero'));
      const field = tree.root.find((n) => n.type === 'TextInput');
      h.eq(field.props.value, 'Buzzes at zero', 'the tapped row opens as a field holding its text');
      await TestRenderer.act(async () => field.props.onChangeText('Chimes at zero'));
      await press(button(tree, COPY.cancel));
      h.eq(s.count('row'), 0, 'Cancel changes nothing');
      await press(rowButton('Buzzes at zero'));
      await TestRenderer.act(async () => tree.root.find(isTextInput).props.onChangeText('Chimes at zero'));
      await press(button(tree, COPY.planRowSave));
      h.eq(s.calls.row, [[1, 'Chimes at zero']], 'Save commits the edit to that row, by position');
      h.eq(s.count('build'), 0, 'and does not build');
    });
  });

  await h.test('build: Details and Leave it running each call their own callback', async () => {
    const s = spies();
    await rendered(<BuildStep stage="generate" delivering={false} signals={null} now={0} onBack={s.fn('back')} onShowDetails={s.fn('details')} />, async (tree) => {
      await press(button(tree, COPY.buildDetails));
      h.eq([s.count('details'), s.count('back')], [1, 0], 'Details opens the details');
      await press(button(tree, COPY.buildLeaveRunning));
      h.eq([s.count('details'), s.count('back')], [1, 1], 'Leave it running leaves');
    });
  });

  await h.test('done: Open it and Back to your apps go to different places', async () => {
    const s = spies();
    await rendered(<DoneStep app={APP} onOpen={s.fn('open')} onBackToApps={s.fn('apps')} onReport={s.fn('report')} />, async (tree) => {
      await press(button(tree, COPY.doneOpen));
      h.eq([s.count('open'), s.count('apps')], [1, 0], 'Open it opens the app');
      await press(button(tree, COPY.doneBackToApps));
      h.eq([s.count('open'), s.count('apps')], [1, 1], 'Back to your apps goes back');
    });
  });
}
