import React from 'react';
import TestRenderer from 'react-test-renderer';
import { Harness } from './harness';
import { button, press, renderScreen, unmountScreen, textOf } from './react-screen';
import { finishAnimations, hardwareBack, backListenerCount } from './native-host';
import { COPY } from '../copy';
import type { ScreenKind } from '../screen-exits';
import type { InstalledApp } from '../app-index';
import type { StoreAccess } from '../store-access';
import SettingsScreen from '../SettingsScreen';
import HistoryScreen from '../HistoryScreen';
import AppLinkMissingScreen from '../AppLinkMissingScreen';
import UpdateRequiredScreen from '../UpdateRequiredScreen';
import ConsentScreen from '../ConsentScreen';
import TermsScreen from '../TermsScreen';
import AgeScreen from '../AgeScreen';
import ComposeStep from '../ComposeStep';
import ClarifyStep from '../ClarifyStep';
import PlanStep from '../PlanStep';
import BuildStep from '../BuildStep';
import DoneStep from '../DoneStep';
import FailureScreen from '../FailureScreen';
import ScreenErrorFallback from '../ScreenErrorFallback';
import Orb from '../Orb';

export const SCREEN_APP: InstalledApp = {
  id: 'timer', name: 'Timer', createdAt: 1, lineageId: 'main',
  record: { appId: 'timer', name: 'Timer', manifest: { capabilities: [] } },
};
const noop = () => {};
const access = { timeline: async () => [], activeId: async () => null } as unknown as StoreAccess;
// Adding a screen kind requires a behavioral fixture (home and mini-app exits have separate
// contracts). These are real screens with only their outside callbacks/storage supplied.
const cases: Record<Exclude<ScreenKind, 'home' | 'app' | 'dev'>, { label: string; render: (leave: () => void) => React.ReactElement }> = {
  settings: { label: COPY.backLabel, render: leave => <SettingsScreen onBack={leave} highlighting canProbe={false} consentStatus={{ kind: 'absent' }} onServerUrlChange={noop} onUseDefaultServer={noop} onHighlightingChange={noop} onOpenAIFeatures={noop} internalBuild errorDetails onErrorDetailsChange={noop} deviceId="test-device" onResetDeviceId={noop} legalLanguage="en" /> },
  history: { label: COPY.backLabel, render: leave => <HistoryScreen app={SCREEN_APP} access={access} onBack={leave} onReport={noop} /> },
  'link-missing': { label: COPY.appLinkMissingBack, render: leave => <AppLinkMissingScreen onBackToApps={leave} /> },
  'update-required': { label: COPY.updateNotNow, render: leave => <UpdateRequiredScreen onNotNow={leave} /> },
  age: { label: COPY.ageBack, render: leave => <AgeScreen language="en" onLanguageChange={noop} blocked onClose={leave} /> },
  terms: { label: COPY.termsDecline, render: leave => <TermsScreen language="en" onLanguageChange={noop} onClose={leave} onAccept={noop} /> },
  consent: { label: COPY.consentDecline, render: leave => <ConsentScreen mode="ask" language="en" onLanguageChange={noop} onClose={leave} onAgree={noop} /> },
  compose: { label: COPY.backLabel, render: leave => <ComposeStep text="" editing={false} onChangeText={noop} onContinue={noop} onBack={leave} /> },
  clarify: { label: COPY.backLabel, render: leave => <ClarifyStep prompt="Timer" questions={[]} answers={{}} loading editing={false} onAnswer={noop} onContinue={noop} onBack={leave} /> },
  plan: { label: COPY.backLabel, render: leave => <PlanStep rows={[]} loading editing={false} onChangeRow={noop} onBuild={noop} onBack={leave} /> },
  build: { label: COPY.buildLeaveRunning, render: leave => <BuildStep stage={null} delivering={false} signals={null} now={0} onBack={leave} /> },
  done: { label: COPY.doneBackToApps, render: leave => <DoneStep app={SCREEN_APP} onOpen={noop} onBackToApps={leave} onReport={noop} /> },
  failure: { label: COPY.failureBack, render: leave => <FailureScreen reason="Unavailable" diagnostics={[]} retryable onRephrase={noop} onBack={leave} /> },
};

export async function runScreenControlTests(h: Harness): Promise<void> {
  for (const [kind, fixture] of Object.entries(cases)) {
    await h.test(`${kind}: enabled visible exit and system back invoke the same action`, async () => {
      let leaves = 0;
      // A valid wrapper is intentional: behavior must not require a bare handler identifier.
      const tree = await renderScreen(fixture.render(() => { leaves++; }));
      try {
        h.eq(backListenerCount(), 1, 'screen owns one system-back subscription');
        await press(button(tree, fixture.label));
        h.eq(leaves, 1, 'visible exit leaves once');
        await TestRenderer.act(async () => { h.eq(hardwareBack(), true, 'system back is handled'); });
        h.eq(leaves, 2, 'system back performs the same exit');
      } finally { await unmountScreen(tree); }
      h.eq(backListenerCount(), 0, 'unmount removes the listener');
    });
  }
  for (const consentOn of [false, true]) {
    await h.test(`consent review (${consentOn}): safe exit neither grants nor revokes`, async () => {
      let closed = 0;
      let changes = 0;
      const tree = await renderScreen(<ConsentScreen mode="review" language="en" onLanguageChange={() => {}} consentOn={consentOn} onClose={() => { closed++; }} onAgree={() => { changes++; }} onTurnOff={() => { changes++; }} />);
      try {
        await press(button(tree, consentOn ? COPY.consentReviewKeepOn : COPY.consentDecline));
        await TestRenderer.act(async () => { hardwareBack(); });
        h.eq([closed, changes], [2, 0], 'both exits preserve the current grant');
      } finally { await unmountScreen(tree); }
    });
  }
  await h.test('plan: back cancels a row edit before leaving, for visible and system back', async () => {
    let leaves = 0;
    let saves = 0;
    const tree = await renderScreen(<PlanStep rows={[{ label: '', text: 'Track time' }]} loading={false} editing={false} onChangeRow={() => { saves++; }} onBuild={noop} onBack={() => { leaves++; }} />);
    try {
      for (const system of [false, true]) {
        await press(button(tree, 'Track time'));
        h.eq(tree.root.findAllByType('TextInput').length, 1, 'row edit is visible');
        if (system) await TestRenderer.act(async () => { hardwareBack(); });
        else await press(button(tree, COPY.backLabel));
        h.eq(tree.root.findAllByType('TextInput').length, 0, 'back dismisses the editor');
        h.eq([leaves, saves], [0, 0], 'cancel does not leave or save');
      }
      await press(button(tree, COPY.backLabel));
      h.eq(leaves, 1, 'next back leaves the plan');
    } finally { await unmountScreen(tree); }
  });
  await h.test('error fallback: leave is visible only when supplied, and differs from retry', async () => {
    let leaves = 0;
    let retries = 0;
    const tree = await renderScreen(<ScreenErrorFallback resetErrorBoundary={() => { retries++; }} onLeave={() => { leaves++; }} />);
    try {
      await press(button(tree, COPY.screenErrorBack));
      await TestRenderer.act(async () => { hardwareBack(); });
      h.eq([leaves, retries], [2, 0], 'both leave controls navigate without retrying');
      await TestRenderer.act(async () => tree.update(<ScreenErrorFallback resetErrorBoundary={() => { retries++; }} />));
      h.eq(backListenerCount(), 0, 'home fallback has no back listener');
      h.eq(tree.root.findAll(node => node.type === 'Text' && node.children.includes(COPY.screenErrorBack)).length, 0, 'home fallback hides leave');
      await press(button(tree, COPY.screenErrorRetry));
      h.eq(retries, 1, 'home fallback can retry');
    } finally { await unmountScreen(tree); }
  });
  await h.test('mini-app orb: Home remains an enabled host control', async () => {
    let leaves = 0;
    const tree = await renderScreen(<Orb onExit={() => { leaves++; }} onVersions={noop} onChangeIt={noop} onReport={noop} />);
    try {
      const orb = tree.root.findAll(node => node.type === 'Pressable' && typeof node.props.onPress === 'function')[0];
      await press(orb);
      await TestRenderer.act(async () => { finishAnimations(); });
      await press(tree.root.find(node => node.type === 'Pressable' && textOf(node).endsWith(COPY.orbActionHome)));
      h.eq(leaves, 1, 'orb Home invokes the exit callback');
    } finally { await unmountScreen(tree); }
  });
}
