/** The prompt flow's step screens rendered on their own, for what their controls do: chips fill
 *  the field, a loading step offers no primary action, plan rows edit in place, and each exit on
 *  the build and done screens calls its own callback. */
import React from 'react';
import TestRenderer from 'react-test-renderer';
import { Harness } from './harness';
import { COPY } from '../copy';
import { primaryActionLabel } from '../prompt-flow';
import ComposeStep from '../ComposeStep';
import ClarifyStep from '../ClarifyStep';
import PlanStep from '../PlanStep';
import BuildStep from '../BuildStep';
import DoneStep from '../DoneStep';
import type { InstalledApp } from '../app-index';
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
const QUESTION = { id: 'alert', question: 'How should it tell you?', options: ['Sound', 'Buzz'] };
const ROWS = [{ label: 'Timer', text: 'Counts down' }, { label: 'Alert', text: 'Buzzes at zero' }];

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
