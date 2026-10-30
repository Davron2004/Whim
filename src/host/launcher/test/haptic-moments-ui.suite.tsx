/** The shell's ready, failed and handoff haptics (system.md §5 + §4 rule 7; app-launcher "The shell
 *  plays haptics from a fixed map"): each moment plays once, on the frame its page appears or its
 *  control is pressed, and a re-render of the same page never replays it. A tapped sheet plays
 *  nothing: a failure reopened from its tile is silent. Reduce Motion does not silence them. Played
 *  calls are read off the installed `WhimHaptics` module double. */
import React from 'react';
import TestRenderer from 'react-test-renderer';
import { Harness } from './harness';
import { COPY } from '../copy';
import type { InstalledApp } from '../app-index';
import ReadyPage from '../ReadyPage';
import FailurePage, { announceFailure, type FailureAnnouncement } from '../FailurePage';
import HomeScreen from '../HomeScreen';
import { WhimSheet } from '../WhimSheet';
import { PlanPage } from '../PlanPage';
import { PendingBuildStore } from '../pending-builds';
import { appLinkFor } from '../app-link';
import { describeStep, planStep, withPlan, withQuestions } from '../prompt-flow';
import { haptics } from '../../haptics';
import { accessibilitySettings, hapticCalls, openLink } from './native-host';
import { button, press, renderScreen, unmountScreen } from './react-screen';
import { hasInstalled, onHome, resultEvent, sseStream, waitFor, withLauncher, type Tree } from './rendered-launcher';
import { startBuild, streamingServer } from './prompt-flow-ui.suite';

const APP: InstalledApp = { id: 'tea', name: 'Tea Timer', createdAt: 1, lineageId: 'main', record: { appId: 'tea', name: 'Tea Timer', manifest: { capabilities: [] } } };

/** The native call the moment map makes for `moment`, taken from the real map. */
function callOf(moment: Parameters<typeof haptics.play>[0]): string {
  hapticCalls.splice(0);
  haptics.play(moment);
  return hapticCalls.splice(0)[0];
}
const played = (): string[] => hapticCalls.filter((c) => !c.startsWith('prepare:'));

const ready = (onDone = () => {}) => <ReadyPage app={APP} words="A tea timer" changed={false} onOpen={() => {}} onDone={onDone} />;
const failure = (announce?: FailureAnnouncement, onRetry?: () => void) => (
  <FailurePage kind="couldnt-run" reason="It didn't work" diagnostics={[]} rephraseHelps={false} changing={false} onChange={() => {}} onRetry={onRetry} announce={announce} />
);
const whimSheet = (onSend: () => void) => (
  <WhimSheet app={APP} version={null} newVersion={false} changing={false} onStopChange={() => {}} text="Make it blue" onChangeText={() => {}} onSend={onSend} onReload={() => {}} onHistory={() => {}} onReport={() => {}} onExit={() => {}} />
);
const changePlan = (onMake: () => void) => {
  const screen = withPlan(withQuestions(planStep(describeStep(APP, 'Make it blue')), []), { rewrittenPrompt: 'Make it blue', plan: [{ label: 'Colour', text: 'Blue' }] });
  return <PlanPage screen={screen} editing={APP} onBack={() => {}} onAnswer={() => {}} onChangeRow={() => {}} onMake={onMake} onTryAgain={() => {}} onMakeInstead={() => {}} />;
};

const on = (tree: Tree, type: Parameters<Tree['root']['findAllByType']>[0]) => tree.root.findAllByType(type).length === 1;

export async function runHapticMomentsUiTests(h: Harness): Promise<void> {
  for (const reduced of [false, true]) {
    const mode = reduced ? 'under Reduce Motion' : 'with motion';
    await h.test(`haptics: the Ready page plays success once as it appears, ${mode}, and a re-render does not replay it`, async () => {
      accessibilitySettings.reduceMotion = reduced;
      const success = callOf('success');
      hapticCalls.splice(0);
      const tree = await renderScreen(ready());
      h.eq(played(), [success], 'success plays as the page mounts');
      await TestRenderer.act(async () => tree.update(ready(() => {})));
      h.eq(played(), [success], 'a re-render of the same page plays nothing more');
      await unmountScreen(tree);
      accessibilitySettings.reduceMotion = false;
    });

    await h.test(`haptics: a live failure’s page plays failure once as it appears, ${mode}; neither a re-render nor a remount of the same failure replays it`, async () => {
      accessibilitySettings.reduceMotion = reduced;
      const failed = callOf('failure');
      const live = announceFailure();
      hapticCalls.splice(0);
      const tree = await renderScreen(failure(live));
      h.eq(played(), [failed], 'failure plays as the page mounts');
      await TestRenderer.act(async () => tree.update(failure(live, () => {})));
      h.eq(played(), [failed], 'a re-render of the same page plays nothing more');
      await unmountScreen(tree);
      const remounted = await renderScreen(failure(live));
      h.eq(played(), [failed], 'the same failure mounted again plays nothing more');
      await unmountScreen(remounted);
      accessibilitySettings.reduceMotion = false;
    });
  }

  await h.test('haptics: a Failure page with no live failure to announce, as its tile reopens it, plays nothing', async () => {
    hapticCalls.splice(0);
    const tree = await renderScreen(failure());
    h.eq(played(), [], 'the reopened page is silent');
    await unmountScreen(tree);
  });

  await h.test('haptics: Try again on the Failure page plays handoff once, on the press', async () => {
    const handoff = callOf('handoff');
    let retried = 0;
    const tree = await renderScreen(failure(undefined, () => { retried++; }));
    hapticCalls.splice(0);
    await press(button(tree, COPY.actionTryAgain));
    h.eq([retried, played()], [1, [handoff]], 'the retry ran and handoff played once');
    await unmountScreen(tree);
  });

  await h.test('haptics: the Whim sheet’s send hands nothing to Whim yet, so it plays nothing', async () => {
    let sent = 0;
    const tree = await renderScreen(whimSheet(() => { sent++; }));
    hapticCalls.splice(0);
    await press(button(tree, COPY.whimSheetSend));
    h.eq([sent, played()], [1, []], 'the words were sent and no haptic played');
    await unmountScreen(tree);
  });

  await h.test('haptics: Make the change on a change’s plan plays handoff once, on the press', async () => {
    const handoff = callOf('handoff');
    let made = 0;
    const tree = await renderScreen(changePlan(() => { made++; }));
    hapticCalls.splice(0);
    await press(button(tree, COPY.planBuildEdit));
    h.eq([made, played()], [1, [handoff]], 'the change was handed over and handoff played once');
    await unmountScreen(tree);
  });

  await h.test('haptics: a run that fails with the sheet open plays failure once; its tile and an app link reopening it play nothing', async () => {
    const streams: ReturnType<typeof sseStream>[] = [];
    await withLauncher({ server: streamingServer(streams) }, async ({ tree, kv }) => {
      const failed = callOf('failure');
      await startBuild(tree, 'A tea timer');
      const id = new PendingBuildStore(kv).list()[0]!.id;
      hapticCalls.splice(0);
      streams[0].push({ type: 'failure', reason: 'The app did not build.', attempts: 1, diagnostics: [] });
      streams[0].end();
      await waitFor(() => on(tree, FailurePage), 'the failure page');
      await waitFor(() => new PendingBuildStore(kv).get(id)?.state === 'failed', 'the failed record');
      h.eq(played(), [failed], 'the failure replacing the Making page plays failure once');
      await press(button(tree, COPY.sheetClose));
      await waitFor(() => onHome(tree), 'Home');
      await TestRenderer.act(async () => tree.root.findByType(HomeScreen).props.onOpenPending(new PendingBuildStore(kv).get(id)!));
      await waitFor(() => on(tree, FailurePage), 'the failure its tile reopens');
      h.eq(played(), [failed], 'its tile reopening the page plays nothing');
      await press(button(tree, COPY.sheetClose));
      await waitFor(() => onHome(tree), 'Home again');
      await TestRenderer.act(async () => openLink(appLinkFor(id)));
      await waitFor(() => on(tree, FailurePage), 'the failure its app link reopens');
      h.eq(played(), [failed], 'an app link reopening the page plays nothing');
    });
  });

  await h.test('haptics: a run that delivers with the sheet open plays success once on its Ready page, and nothing more through Done', async () => {
    const streams: ReturnType<typeof sseStream>[] = [];
    await withLauncher({ server: streamingServer(streams) }, async ({ tree }) => {
      const success = callOf('success');
      await startBuild(tree, 'A tea timer');
      hapticCalls.splice(0);
      streams[0].push(resultEvent('Tea Timer'));
      streams[0].end();
      await waitFor(() => on(tree, ReadyPage), 'the ready page');
      h.eq(played(), [success], 'the delivery replacing the Making page plays success once');
      await press(button(tree, COPY.readyDone));
      await waitFor(() => onHome(tree) && hasInstalled(tree, 'Tea Timer'), 'Home with the new app');
      h.eq(played(), [success], 'the screen updates up to Home play nothing more');
    });
  });
}
