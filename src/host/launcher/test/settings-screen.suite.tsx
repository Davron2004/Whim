/** Settings and Advanced rendered on their own (design-system-v1 task 14.3): Advanced's server
 *  address saves once per typing pause and sends no request of its own, showing the session probe's
 *  result for the address in the field (#130); Settings' About links; the Report screen's recovery
 *  from a draft that failed to load. */
import React from 'react';
import TestRenderer from 'react-test-renderer';
import { Harness } from './harness';
import SettingsScreen, { type SettingsScreenProps } from '../SettingsScreen';
import AdvancedScreen, { type AdvancedScreenProps } from '../AdvancedScreen';
import ReportScreen from '../ReportScreen';
import { Text } from '../../ui/Text';
import { ToastHost } from '../../ui/Toast';
import { COPY, LEGAL_COPY } from '../copy';
import { RELEASE, WHIM_DOMAIN } from '../release-config';
import { addressCheck, middleTruncated, versionLabel } from '../settings-sections';
import type { InstalledApp } from '../app-index';
import type { StoreAccess } from '../store-access';
import { reportClientOptions } from '../transport-shared';
import { testAppInfo } from './client-fixtures';
import { button, captureTimeouts, press, renderScreen, textOf, unmountScreen } from './react-screen';
import { Linking } from './native-host';
import { log } from '../../logging';

const noop = () => {};
const addressField = (tree: TestRenderer.ReactTestRenderer) => tree.root.find(node => String(node.type) === 'TextInput');
const type = (tree: TestRenderer.ReactTestRenderer, text: string) => TestRenderer.act(async () => addressField(tree).props.onChangeText(text));
const PROBE_LABELS: readonly string[] = [COPY.serverProbeVerified, COPY.serverProbeUnverified, COPY.serverProbeUnreachable, COPY.settingsProbeNeutral];
/** The check line under the field, as the `Text` that draws it: its words and colour role. */
const checkLines = (tree: TestRenderer.ReactTestRenderer) =>
  tree.root.findAllByType(Text).filter(node => PROBE_LABELS.includes(textOf(node))).map(node => [textOf(node), node.props.color]);

const advancedProps: AdvancedScreenProps = {
  onBack: noop, errorDetails: true, onErrorDetailsChange: noop, deviceId: '0123456789abcdef-device-id-fedcba9876543210', onResetDeviceId: noop,
  serverChoice: 'own', ownServerAcknowledged: true, onAcknowledgeOwnServer: noop, onChooseServer: noop,
  savedAddress: 'https://saved.example', onServerUrlChange: noop, canProbe: true, probe: null, legalLanguage: 'en',
};
const advanced = (props: Partial<AdvancedScreenProps> = {}) => <ToastHost><AdvancedScreen {...advancedProps} {...props} /></ToastHost>;

const settingsProps: SettingsScreenProps = {
  onBack: noop, onOpenAIFeatures: noop, legalLanguage: 'en', onLegalLanguageChange: noop, onReportProblem: noop, onOpenAdvanced: noop,
};

/** A `fetch` that records every URL it is asked for and fails the test's expectation by answering. */
function recordFetch(): { urls: string[]; restore: () => void } {
  const original = globalThis.fetch;
  const urls: string[] = [];
  globalThis.fetch = (async (url: string) => { urls.push(String(url)); return new Response(JSON.stringify({ service: 'whim-server' })); }) as typeof fetch;
  return { urls, restore: () => { globalThis.fetch = original; } };
}

export async function runSettingsScreenTests(h: Harness): Promise<void> {
  await h.test('Advanced: an edit saves once typing pauses and sends nothing itself; the session probe’s result for that address shows under the field, in its colour', async () => {
    for (const [result, label, color] of [
      ['verified', COPY.serverProbeVerified, 'positive-text'],
      ['unverified', COPY.serverProbeUnverified, 'text-2'],
      ['unreachable', COPY.serverProbeUnreachable, 'danger-text'],
    ] as const) {
      const clock = captureTimeouts();
      const fetches = recordFetch();
      const saved: string[] = [];
      const tree = await renderScreen(advanced({ onServerUrlChange: url => saved.push(url) }));
      try {
        await type(tree, 'https://edited.example/');
        h.eq([saved, clock.count(600)], [[], 1], `${result}: typing alone saves nothing; one pause waits`);
        await TestRenderer.act(async () => clock.fire(600));
        h.eq(saved, ['https://edited.example/'], `${result}: the pause saves the edit`);
        h.eq(checkLines(tree), [], `${result}: no line until the session has probed the address`);
        await TestRenderer.act(async () => tree.update(advanced({ onServerUrlChange: url => saved.push(url), probe: { address: 'https://saved.example', result } })));
        h.eq(checkLines(tree), [], `${result}: a result for another address is not this one’s`);
        await TestRenderer.act(async () => tree.update(advanced({ onServerUrlChange: url => saved.push(url), probe: { address: 'https://edited.example', result } })));
        h.eq(checkLines(tree), [[label, color]], `${result}: the session’s result for the saved address shows`);
        await type(tree, 'https://edited.example/x');
        h.eq(checkLines(tree), [], `${result}: a new edit clears it at once`);
        h.eq(fetches.urls, [], `${result}: the screen sent no request of its own`);
      } finally {
        await unmountScreen(tree);
        fetches.restore();
        clock.restore();
      }
    }
  });

  await h.test('Advanced: without consent an edit still saves, and the line says the address is checked once AI features are on', async () => {
    const clock = captureTimeouts();
    const saved: string[] = [];
    const tree = await renderScreen(advanced({ canProbe: false, onServerUrlChange: url => saved.push(url) }));
    try {
      await type(tree, 'https://new.example');
      await TestRenderer.act(async () => clock.fire(600));
      h.eq(saved, ['https://new.example'], 'consent does not gate saving');
      h.eq(checkLines(tree), [[COPY.settingsProbeNeutral, 'text-2']], 'the neutral explanation is the line');
    } finally { await unmountScreen(tree); clock.restore(); }
  });

  await h.test('Advanced: a plain-http public address is not saved, and the field says why', async () => {
    const clock = captureTimeouts();
    const saved: string[] = [];
    const tree = await renderScreen(advanced({ onServerUrlChange: url => saved.push(url), probe: { address: 'http://api.example.com', result: 'verified' } }));
    try {
      await type(tree, 'http://api.example.com');
      await TestRenderer.act(async () => clock.fire(600));
      await TestRenderer.act(async () => addressField(tree).props.onSubmitEditing());
      h.eq(saved, [], 'nothing saved, after the pause or on submit');
      h.ok(textOf(tree.root).includes(COPY.serverAddressRefused), 'the refusal is explained under the field');
      h.eq(checkLines(tree), [], 'and no check line claims anything about it');
      await type(tree, 'http://api.example.org');
      h.ok(!textOf(tree.root).includes(COPY.serverAddressRefused), 'a new edit clears the note until it settles');
    } finally {
      await unmountScreen(tree);
      clock.restore();
    }
    h.eq(saved, [], 'leaving with the refused edit saves nothing either');
  });

  await h.test('Advanced: typing saves once per pause, not per keystroke; submit, blur and leaving save at once', async () => {
    const clock = captureTimeouts();
    const saved: string[] = [];
    const tree = await renderScreen(advanced({ canProbe: false, onServerUrlChange: url => saved.push(url) }));
    let mounted = true;
    try {
      for (const keystroke of ['http://localhost:', 'http://localhost:8', 'http://localhost:87', 'http://localhost:8787']) await type(tree, keystroke);
      h.eq([saved, clock.count(600)], [[], 1], 'four keystrokes save nothing yet and leave one pause pending');
      await TestRenderer.act(async () => clock.fire(600));
      h.eq(saved, ['http://localhost:8787'], 'the pause saves the finished address once');
      await type(tree, 'http://localhost:9');
      await TestRenderer.act(async () => addressField(tree).props.onSubmitEditing());
      h.eq([saved.at(-1), clock.count(600)], ['http://localhost:9', 0], 'submitting saves at once, with nothing left pending');
      await type(tree, 'http://localhost:90');
      await TestRenderer.act(async () => addressField(tree).props.onBlur());
      h.eq([saved.at(-1), clock.count(600)], ['http://localhost:90', 0], 'leaving the field saves at once');
      await TestRenderer.act(async () => addressField(tree).props.onBlur());
      h.eq(saved.length, 3, 'a blur with nothing new saves nothing');
      await type(tree, 'http://localhost:900');
      mounted = false;
      await unmountScreen(tree);
      h.eq([saved.at(-1), clock.count(600)], ['http://localhost:900', 0], 'leaving the screen saves the edit still waiting on its pause');
    } finally {
      if (mounted) await unmountScreen(tree);
      clock.restore();
    }
  });

  await h.test('Advanced: choosing Whim’s server keeps an edit waiting on its pause, saving it rather than dropping it', async () => {
    const clock = captureTimeouts();
    const saved: string[] = [];
    const chosen: string[] = [];
    const tree = await renderScreen(advanced({ onServerUrlChange: url => saved.push(url), onChooseServer: choice => chosen.push(choice) }));
    try {
      await type(tree, 'https://kept.example');
      await press(button(tree, COPY.settingsServerWhim));
      h.eq([chosen, saved, clock.count(600)], [['whim'], ['https://kept.example'], 0], 'Whim’s server is chosen and the typed address is saved for later');
      await TestRenderer.act(async () => tree.update(advanced({ serverChoice: 'whim', savedAddress: 'https://kept.example' })));
      h.eq(tree.root.findAll(node => String(node.type) === 'TextInput').length, 0, 'the field goes with your own server');
    } finally {
      await unmountScreen(tree);
      clock.restore();
    }
  });

  await h.test('Advanced: "Your own server" asks once before it is acknowledged, then never again', async () => {
    const chosen: string[] = [];
    let acknowledged = 0;
    const props = { serverChoice: 'whim' as const, onChooseServer: (choice: string) => chosen.push(choice), onAcknowledgeOwnServer: () => { acknowledged++; } };
    const tree = await renderScreen(advanced({ ...props, ownServerAcknowledged: false }));
    try {
      await press(button(tree, COPY.settingsServerOwn));
      h.eq([chosen, acknowledged], [[], 0], 'the row alone chooses nothing before the acknowledgement');
      await press(tree.root.find(node => String(node.type) === 'Modal').find(node => String(node.type) === 'Pressable' && node.props.accessibilityLabel === COPY.ownServerKeep));
      h.eq([chosen, acknowledged], [[], 0], 'keeping Whim’s server records nothing');
      await press(button(tree, COPY.settingsServerOwn));
      await press(tree.root.find(node => String(node.type) === 'Modal').find(node => String(node.type) === 'Pressable' && node.props.accessibilityLabel === LEGAL_COPY.en.ownServerConfirm));
      h.eq(acknowledged, 1, 'confirming records the acknowledgement');
      await TestRenderer.act(async () => tree.update(advanced({ ...props, ownServerAcknowledged: true })));
      await press(button(tree, COPY.settingsServerOwn));
      h.eq([chosen, tree.root.findAll(node => String(node.type) === 'Modal').length], [['own'], 0], 'acknowledged, the row just chooses your own server');
    } finally { await unmountScreen(tree); }
  });

  await h.test('addressCheck: the session’s result only for the address in the field as it was saved; none for another or a refused one', () => {
    const probe = { address: 'https://whim.example.org', result: 'unverified' } as const;
    h.eq(addressCheck(true, ' https://whim.example.org// ', probe), 'unverified', 'the address saved from this field (spaces and trailing slashes go when it saves)');
    h.eq(addressCheck(true, 'https://whim.example.org:8443', probe), null, 'another port is another server');
    h.eq(addressCheck(true, 'https://whim.example.org/v2', probe), null, 'another path is another address');
    h.eq(addressCheck(true, '', probe), null, 'an empty field');
    // eslint-disable-next-line sonarjs/no-clear-text-protocols -- the refused address under test; nothing is sent to it
    h.eq(addressCheck(true, 'http://8.8.8.8', { address: 'http://8.8.8.8', result: 'verified' }), null, 'a refused address is never sent, so never checked');
    h.eq(addressCheck(false, 'https://whim.example.org', probe), 'neutral', 'without consent nothing is probed');
  });

  await h.test('Phone ID: shown with its start and end; the copy button copies all of it', () => {
    const id = '0123456789abcdef-device-id-fedcba9876543210';
    const shown = middleTruncated(id);
    h.ok(shown.length < id.length && id.startsWith(shown.split('…')[0]) && id.endsWith(shown.split('…')[1]), `the start and end of the ID, shorter (got ${shown})`);
    h.eq(middleTruncated('short-id'), 'short-id', 'an ID that fits is shown whole');
  });

  await h.test('Settings: Version is the installed version and build, and left out when the app can’t say', () => {
    const info = testAppInfo();
    h.eq(versionLabel(testAppInfo), `${info.version} (${info.build})`, 'version and build');
    h.eq(versionLabel(() => { throw new Error('WhimAppInfo: version is missing'); }), undefined, 'no row without one');
  });

  await h.test('Settings: About’s Terms of use opens the English terms page on the Whim web host', async () => {
    const tree = await renderScreen(<SettingsScreen {...settingsProps} />);
    try {
      const opened = Linking.opened.length;
      await press(button(tree, COPY.termsOfUseLabel));
      const urls = Linking.opened.slice(opened);
      h.eq(urls, [RELEASE.termsUrl], 'the English terms URL, not the privacy policy or a French twin');
      const host = new URL(urls[0] ?? 'about:blank').host;
      h.ok(host === RELEASE.webHost && host.endsWith(`.${WHIM_DOMAIN}`), `on the host derived from the release domain (got ${host})`);
    } finally { await unmountScreen(tree); }
  });

  for (const failedRead of ['activeDescription', 'activeSource'] as const) {
    await h.test(`Report: rejected ${failedRead} offers content-free recovery and reopening reads a complete draft`, async () => {
      const secret = 'private-report-content';
      const app: InstalledApp = { id: 'timer', name: `${secret}-app`, createdAt: 1, lineageId: 'main', record: { appId: 'timer', name: `${secret}-app`, manifest: { capabilities: [] } } };
      let rejectRead!: (error: Error) => void;
      const pending = new Promise<string>((_resolve, reject) => { rejectRead = reject; });
      const reads: string[] = [];
      let retry = false;
      const read = (operation: string, value: string) => {
        reads.push(operation);
        return !retry && operation === failedRead ? pending : Promise.resolve(value);
      };
      const access = {
        activeDescription: () => read('activeDescription', `${secret}-prompt`),
        activeSource: () => read('activeSource', `${secret}-source`),
      } as unknown as StoreAccess;
      const unhandled: unknown[] = [];
      const captureRejection = (reason: unknown) => { unhandled.push(reason); };
      process.on('unhandledRejection', captureRejection);
      const before = new Set(log.buffer.snapshot());
      let left = 0;
      const screenProps = { app, access, options: reportClientOptions({ kind: 'absent' } as const, 'https://server.test', `${secret}-device`, testAppInfo), onLeave: () => { left++; }, onUpdateRequired: noop, legalLanguage: 'en' as const };
      let screen = await renderScreen(<ReportScreen {...screenProps} />);
      try {
        await TestRenderer.act(async () => {
          rejectRead(new Error(`${secret}-raw-error`));
          await new Promise(resolve => setImmediate(resolve));
        });
        h.eq(unhandled, [], 'the rejected mandatory read is handled after promise settlement');
        h.ok(textOf(screen.root).includes(COPY.reportDraftLoadFailed), 'the screen explains that loading failed');
        h.eq(screen.root.findAll(node => String(node.type) === 'TextInput').length, 0, 'no partial report editor is offered');
        h.eq(screen.root.findAll(node => String(node.type) === 'Pressable' && node.props.accessibilityLabel === COPY.reportSend).length, 0, 'and no Send');
        h.ok(!textOf(screen.root).includes(secret), 'failure UI exposes no report content or raw error');
        const records = log.buffer.snapshot().filter(record => !before.has(record));
        h.eq(records.map(record => [record.message, record.fields]), [['report draft load failed', { outcome: 'failed' }]], 'only the failed operation and outcome are logged');
        h.ok(!JSON.stringify(records).includes(secret), 'logs exclude the app, prompt, source, device ID and raw error');
        await press(button(screen, COPY.reportDraftClose));
        h.eq(left, 1, 'the recovery action leaves the screen');
        await unmountScreen(screen);
        retry = true;
        screen = await renderScreen(<ReportScreen {...screenProps} />);
        await TestRenderer.act(async () => { await new Promise(resolve => setImmediate(resolve)); });
        h.eq(reads, ['activeDescription', 'activeSource', 'activeDescription', 'activeSource'], 'reopening retries both mandatory reads');
        h.ok(!textOf(screen.root).includes(COPY.reportDraftLoadFailed), 'a successful fresh read clears the failure');
        h.eq(button(screen, COPY.reportSend).props.disabled, true, 'the fresh complete draft still requires a reason');
        await press(button(screen, COPY.reportReasonBroken));
        h.eq(button(screen, COPY.reportSend).props.disabled, false, 'a complete draft with a reason can be sent');
        await press(button(screen, COPY.reportPreviewTitle));
        const codeLabel = screen.root.find(node => String(node.type) === 'Text' && node.children.includes(COPY.reportFieldSource));
        let header = codeLabel.parent;
        while (header && !header.findAll(node => String(node.type) === 'Pressable').length) header = header.parent;
        await press(header!.find(node => String(node.type) === 'Pressable' && node.props.accessibilityLabel === COPY.reportShowMore));
        h.ok(textOf(screen.root).includes(`${secret}-source`), 'the recovered draft includes the mandatory original source');
      } finally {
        await unmountScreen(screen);
        process.off('unhandledRejection', captureRejection);
      }
    });
  }
}
