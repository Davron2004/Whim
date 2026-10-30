/** The shell's ready, failed and handoff haptics (system.md §5 + §4 rule 7; app-launcher "The shell
 *  plays haptics from a fixed map"): each moment plays once, on the frame its page appears or its
 *  control is pressed, and a re-render of the same page never replays it. Reduce Motion does not
 *  silence them. Played calls are read off the installed `WhimHaptics` module double. */
import React from 'react';
import TestRenderer from 'react-test-renderer';
import { Harness } from './harness';
import { COPY } from '../copy';
import type { InstalledApp } from '../app-index';
import ReadyPage from '../ReadyPage';
import FailurePage from '../FailurePage';
import { WhimSheet } from '../WhimSheet';
import { haptics } from '../../haptics';
import { accessibilitySettings, hapticCalls } from './native-host';
import { button, press, renderScreen, unmountScreen } from './react-screen';

const APP: InstalledApp = { id: 'tea', name: 'Tea Timer', createdAt: 1, lineageId: 'main', record: { appId: 'tea', name: 'Tea Timer', manifest: { capabilities: [] } } };

/** The native call the moment map makes for `moment`, taken from the real map. */
function callOf(moment: Parameters<typeof haptics.play>[0]): string {
  hapticCalls.splice(0);
  haptics.play(moment);
  return hapticCalls.splice(0)[0];
}
const played = (): string[] => hapticCalls.filter((c) => !c.startsWith('prepare:'));

const ready = (onDone = () => {}) => <ReadyPage app={APP} words="A tea timer" changed={false} onOpen={() => {}} onDone={onDone} />;
const failure = (onRetry?: () => void) => (
  <FailurePage kind="couldnt-run" reason="It didn't work" diagnostics={[]} rephraseHelps={false} changing={false} onChange={() => {}} onRetry={onRetry} />
);
const whimSheet = (onSend: () => void) => (
  <WhimSheet app={APP} version={null} newVersion={false} changing={false} onStopChange={() => {}} text="Make it blue" onChangeText={() => {}} onSend={onSend} onReload={() => {}} onHistory={() => {}} onReport={() => {}} onExit={() => {}} />
);

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

    await h.test(`haptics: the Failure page plays failure once as it appears, ${mode}, and a re-render does not replay it`, async () => {
      accessibilitySettings.reduceMotion = reduced;
      const failed = callOf('failure');
      hapticCalls.splice(0);
      const tree = await renderScreen(failure());
      h.eq(played(), [failed], 'failure plays as the page mounts');
      await TestRenderer.act(async () => tree.update(failure(() => {})));
      h.eq(played(), [failed], 'a re-render of the same page plays nothing more');
      await unmountScreen(tree);
      accessibilitySettings.reduceMotion = false;
    });
  }

  await h.test('haptics: Try again on the Failure page plays handoff once, on the press', async () => {
    const handoff = callOf('handoff');
    let retried = 0;
    const tree = await renderScreen(failure(() => { retried++; }));
    hapticCalls.splice(0);
    await press(button(tree, COPY.actionTryAgain));
    h.eq([retried, played()], [1, [handoff]], 'the retry ran and handoff played once');
    await unmountScreen(tree);
  });

  await h.test('haptics: the Whim sheet’s send plays handoff once, on the press', async () => {
    const handoff = callOf('handoff');
    let sent = 0;
    const tree = await renderScreen(whimSheet(() => { sent++; }));
    hapticCalls.splice(0);
    await press(button(tree, COPY.whimSheetSend));
    h.eq([sent, played()], [1, [handoff]], 'the words were sent and handoff played once');
    await unmountScreen(tree);
  });
}
