import React from 'react';
import TestRenderer from 'react-test-renderer';
import { Harness } from './harness';
import { androidBack, button, press, renderScreen, unmountScreen, hostType, textOf } from './react-screen';
import { hardwareBack, backListenerCount, setColorScheme, StyleSheet } from './native-host';
import { androidHeaderBack, headerBackShown, iosPop } from './native-screens';
import { COPY } from '../copy';
import type { ScreenKind } from '../screen-exits';
import type { InstalledApp } from '../app-index';
import type { StoreAccess } from '../store-access';
import SettingsScreen from '../SettingsScreen';
import AdvancedScreen from '../AdvancedScreen';
import ReportScreen from '../ReportScreen';
import NativeStack from '../NativeStack';
import { ToastHost } from '../../ui/Toast';
import { COLORS } from '../../../design/tokens';
import { reportClientOptions } from '../transport-shared';
import { testAppInfo } from './client-fixtures';
import HistoryScreen from '../HistoryScreen';
import AppLinkMissingScreen from '../AppLinkMissingScreen';
import UpdateRequiredScreen from '../UpdateRequiredScreen';
import ConsentScreen from '../ConsentScreen';
import { FirstRunSheet } from '../FirstRunSheet';
import AgeScreen from '../AgeScreen';
import { DescribePage } from '../DescribePage';
import { PlanPage } from '../PlanPage';
import { MakingSheet } from '../MakingSheet';
import { describeStep, planStep } from '../prompt-flow';
import MakingPage from '../MakingPage';
import ReadyPage from '../ReadyPage';
import FailurePage from '../FailurePage';
import ScreenErrorFallback from '../ScreenErrorFallback';

export const SCREEN_APP: InstalledApp = {
  id: 'timer', name: 'Timer', createdAt: 1, lineageId: 'main',
  record: { appId: 'timer', name: 'Timer', manifest: { capabilities: [] } },
};
const noop = () => {};
const access = { timeline: async () => [], activeId: async () => null } as unknown as StoreAccess;

/** `screen` pushed over Home on the native stack, its header's back leaving through `leave` — the
 *  same handler the shell gives the screen's own system back. */
function pushed(title: string, leave: () => void, screen: React.ReactElement): React.ReactElement {
  const look = { background: COLORS.light.bg, foreground: COLORS.light.text };
  return (
    <ToastHost>
      <NativeStack entries={[{ key: 'home', onLeave: noop, ...look, children: null }, { key: 'pushed', title, onLeave: leave, ...look, children: screen }]} />
    </ToastHost>
  );
}

/** `page` in the making sheet, whose close control calls `close`. */
function sheeted(close: () => void, page: React.ReactElement): React.ReactElement {
  return <MakingSheet content={{ key: 'page', node: page }} onClose={close} />;
}

/** The visible control that leaves a screen: a labelled control of its own, or, on the native
 *  stack, the stack's header back (an iOS pop, or Android's header back button). */
type Exit = string | 'native header';

// Adding a screen kind requires a behavioral fixture (home and mini-app exits have separate
// contracts). These are real screens with only their outside callbacks/storage supplied.
const cases: Record<Exclude<ScreenKind, 'home' | 'app' | 'dev'>, { label: Exit; render: (leave: () => void) => React.ReactElement; sheet?: true }> = {
  settings: { label: 'native header', render: leave => pushed(COPY.settingsTitle, leave, <SettingsScreen onBack={leave} onOpenAIFeatures={noop} legalLanguage="en" onLegalLanguageChange={noop} onReportProblem={noop} onOpenAdvanced={noop} />) },
  advanced: { label: 'native header', render: leave => pushed(COPY.settingsAdvancedSectionTitle, leave, <AdvancedScreen onBack={leave} errorDetails onErrorDetailsChange={noop} deviceId="test-device" onResetDeviceId={noop} serverChoice="whim" ownServerAcknowledged={false} onAcknowledgeOwnServer={noop} onChooseServer={noop} onServerUrlChange={noop} canProbe={false} probe={null} legalLanguage="en" />) },
  report: { label: 'native header', render: leave => pushed(COPY.reportScreenTitle, leave, <ReportScreen app={null} access={access} options={reportClientOptions({ kind: 'absent' }, 'https://server.test', 'device', testAppInfo)} onLeave={leave} onUpdateRequired={noop} legalLanguage="en" />) },
  history: { label: COPY.backLabel, render: leave => <ToastHost><HistoryScreen app={SCREEN_APP} access={access} onBack={leave} onReport={noop} onFork={async () => null} onOpen={noop} onUseVersion={async () => {}} /></ToastHost> },
  'link-missing': { label: COPY.appLinkMissingBack, render: leave => <AppLinkMissingScreen onBackToApps={leave} /> },
  'update-required': { label: COPY.updateNotNow, render: leave => <UpdateRequiredScreen onNotNow={leave} /> },
  age: { label: COPY.ageBack, render: leave => <AgeScreen language="en" onLanguageChange={noop} held="minor-not-approved" onClose={leave} /> },
  terms: { label: COPY.consentDecline, render: leave => <FirstRunSheet visible language="en" onLanguageChange={noop} termsDue consentDue onAgree={noop} onClose={leave} />, sheet: true },
  consent: { label: COPY.consentDecline, render: leave => <FirstRunSheet visible language="en" onLanguageChange={noop} termsDue={false} consentDue onAgree={noop} onClose={leave} />, sheet: true },
  describe: { label: COPY.sheetClose, render: leave => sheeted(leave, <DescribePage text="" onChangeText={noop} onContinue={noop} />), sheet: true },
  plan: { label: COPY.backLabel, render: leave => sheeted(noop, <PlanPage screen={planStep(describeStep(undefined, 'Timer'))} onBack={leave} onAnswer={noop} onChangeRow={noop} onMake={noop} onTryAgain={noop} onMakeInstead={noop} />), sheet: true },
  making: { label: COPY.sheetClose, render: leave => sheeted(leave, <MakingPage name="Timer" changing={false} words="A timer" stage={null} delivering={false} signals={null} now={0} activity={0} onStop={noop} />), sheet: true },
  ready: { label: COPY.readyDone, render: leave => sheeted(leave, <ReadyPage app={SCREEN_APP} words="A timer" onOpen={noop} onDone={leave} />), sheet: true },
  failure: { label: COPY.sheetClose, render: leave => sheeted(leave, <FailurePage kind="other" reason="Unavailable" diagnostics={[]} rephraseHelps changing={false} onChange={noop} onRetry={noop} />), sheet: true },
};

export async function runScreenControlTests(h: Harness): Promise<void> {
  for (const [kind, fixture] of Object.entries(cases)) {
    await h.test(`${kind}: enabled visible exit and system back invoke the same action`, async () => {
      let leaves = 0;
      // A valid wrapper is intentional: behavior must not require a bare handler identifier.
      const tree = await renderScreen(fixture.render(() => { leaves++; }));
      try {
        // A sheet's Modal takes Android back itself: nothing registers on `BackHandler`, and the press
        // reaches the page through the Modal's `onRequestClose`.
        h.eq(backListenerCount(), fixture.sheet ? 0 : 1, fixture.sheet ? 'a sheet-hosted page registers no BackHandler listener, which a Modal would starve' : 'screen owns one system-back subscription');
        let visible = 1;
        if (fixture.label === 'native header') {
          h.ok(headerBackShown(tree), 'the stack’s header shows its back control');
          await iosPop(tree);
          h.eq(leaves, 1, 'an iOS pop (header back or swipe) leaves once');
          await androidHeaderBack(tree);
          visible = 2;
          h.eq(leaves, 2, 'Android’s header back leaves once');
        } else {
          await press(button(tree, fixture.label));
          h.eq(leaves, 1, 'visible exit leaves once');
        }
        if (fixture.sheet) await androidBack(tree);
        else await TestRenderer.act(async () => { h.eq(hardwareBack(), true, 'system back is handled'); });
        h.eq(leaves, visible + 1, 'system back performs the same exit');
      } finally { await unmountScreen(tree); }
      h.eq(backListenerCount(), 0, 'unmount removes the listener');
    });
  }
  for (const consentOn of [false, true]) {
    await h.test(`consent review (${consentOn}): safe exit neither grants nor revokes`, async () => {
      let closed = 0;
      let changes = 0;
      const tree = await renderScreen(<ConsentScreen language="en" onLanguageChange={() => {}} consentOn={consentOn} onClose={() => { closed++; }} onAgree={() => { changes++; }} onTurnOff={() => { changes++; }} />);
      try {
        await press(button(tree, consentOn ? COPY.consentReviewKeepOn : COPY.consentDecline));
        await TestRenderer.act(async () => { hardwareBack(); });
        h.eq([closed, changes], [2, 0], 'both exits preserve the current grant');
      } finally { await unmountScreen(tree); }
    });
  }
  // The full screens and the AI features review draw from the phone's scheme: each one's canvas, title,
  // second line and `ink` action are the scheme's roles, and the legal language switch is a `text` action.
  const drawn: [string, React.ReactElement, { title: string; line: string; lineRole: 'text' | 'text-2'; action: string; switch?: string }][] = [
    ['link-missing', <AppLinkMissingScreen onBackToApps={noop} />, { title: COPY.appLinkMissingTitle, line: COPY.appLinkMissingBody, lineRole: 'text-2', action: COPY.appLinkMissingBack }],
    ['update-required', <UpdateRequiredScreen onNotNow={noop} />, { title: COPY.updateTitle, line: COPY.updateBody, lineRole: 'text-2', action: COPY.updateAction }],
    ['age', <AgeScreen language="en" onLanguageChange={noop} held="minor-not-approved" onClose={noop} />, { title: COPY.ageBlockedTitle, line: COPY.ageBlockedBody, lineRole: 'text', action: COPY.ageBack, switch: COPY.legalLanguageSwitch }],
    ['consent review', <ConsentScreen language="en" onLanguageChange={noop} consentOn={false} onAgree={noop} onClose={noop} />, { title: COPY.consentTitle, line: COPY.consentLead, lineRole: 'text', action: COPY.consentReviewTurnOn, switch: COPY.legalLanguageSwitch }],
    ['error fallback', <ScreenErrorFallback error={new Error('screen failed')} screen="history" resetErrorBoundary={noop} />, { title: COPY.screenErrorTitle, line: COPY.screenErrorBody, lineRole: 'text-2', action: COPY.screenErrorRetry }],
  ];
  for (const [name, element, want] of drawn) {
    await h.test(`${name}: drawn in the phone's scheme, light and dark`, async () => {
      for (const scheme of ['light', 'dark'] as const) {
        const c = COLORS[scheme];
        await TestRenderer.act(async () => setColorScheme(scheme));
        const tree = await renderScreen(element);
        try {
          const colour = (text: string) => StyleSheet.flatten(tree.root.find((n) => hostType(n) === 'Text' && textOf(n) === text).props.style).color;
          h.eq(StyleSheet.flatten(tree.root.find((n) => hostType(n) === 'View').props.style).backgroundColor, c.bg, `${scheme}: on the scheme's bg`);
          h.eq([colour(want.title), colour(want.line), colour(want.action)], [c.text, c[want.lineRole], c['on-ink']], `${scheme}: title in text, the line under it in ${want.lineRole}, the action's label on ink`);
          if (want.switch !== undefined) h.eq(colour(want.switch), c.text, `${scheme}: the language switch is a text action`);
        } finally {
          await unmountScreen(tree);
          await TestRenderer.act(async () => setColorScheme('light'));
        }
      }
    });
  }
  await h.test('error fallback: leave is visible only when supplied, and differs from retry', async () => {
    let leaves = 0;
    let retries = 0;
    const tree = await renderScreen(<ScreenErrorFallback error={new Error('screen failed')} screen="history" resetErrorBoundary={() => { retries++; }} onLeave={() => { leaves++; }} />);
    try {
      await press(button(tree, COPY.screenErrorBack));
      await TestRenderer.act(async () => { hardwareBack(); });
      h.eq([leaves, retries], [2, 0], 'both leave controls navigate without retrying');
      await TestRenderer.act(async () => tree.update(<ScreenErrorFallback error={new Error('screen failed')} screen="history" resetErrorBoundary={() => { retries++; }} />));
      h.eq(backListenerCount(), 0, 'home fallback has no back listener');
      h.eq(tree.root.findAll(node => hostType(node) === 'Text' && node.children.includes(COPY.screenErrorBack)).length, 0, 'home fallback hides leave');
      await press(button(tree, COPY.screenErrorRetry));
      h.eq(retries, 1, 'home fallback can retry');
    } finally { await unmountScreen(tree); }
  });
}
