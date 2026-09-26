import React from 'react';
import TestRenderer from 'react-test-renderer';
import { Harness } from './harness';
import SettingsScreen, { type SettingsScreenProps } from '../SettingsScreen';
import { COPY } from '../copy';
import { AI_CONSENT_VERSION, RELEASE, WHIM_DOMAIN } from '../release-config';
import { STATUS_COLORS } from '../../../sdk/theme';
import { SHELL_PALETTE } from '../theme';
import ReportSheet from '../ReportSheet';
import type { InstalledApp } from '../app-index';
import type { StoreAccess } from '../store-access';
import { reportClientOptions } from '../transport-shared';
import { testAppInfo } from './client-fixtures';
import { button, captureTimeouts, press, renderScreen, unmountScreen } from './react-screen';
import { Linking, StyleSheet } from './native-host';

const noop = () => {};
const isAdvancedTitle = (node: TestRenderer.ReactTestInstance) => String(node.type) === 'Text' && node.children.includes(COPY.settingsAdvancedSectionTitle);
const advancedHeader = (tree: TestRenderer.ReactTestRenderer) => tree.root.find(node => String(node.type) === 'TouchableOpacity' && node.findAll(isAdvancedTitle).length > 0);
function isProbeResult(node: TestRenderer.ReactTestInstance): boolean {
  return String(node.type) === 'Text' && [COPY.serverProbeVerified, COPY.serverProbeUnverified, COPY.serverProbeUnreachable].some(text => node.children.includes(text));
}
const addressField = (tree: TestRenderer.ReactTestRenderer) => tree.root.find(node => String(node.type) === 'TextInput');
const isScrollView = (node: TestRenderer.ReactTestInstance) => String(node.type) === 'ScrollView';
const type = (tree: TestRenderer.ReactTestRenderer, text: string) => TestRenderer.act(async () => addressField(tree).props.onChangeText(text));
const props: SettingsScreenProps = {
  serverUrl: 'https://saved.example', highlighting: true, canProbe: true,
  consentStatus: { kind: 'granted', version: AI_CONSENT_VERSION, grantedAt: '2026-09-18' },
  onBack: noop, onServerUrlChange: noop, onUseDefaultServer: noop,
  onHighlightingChange: noop, onOpenAIFeatures: noop,
  internalBuild: true, errorDetails: true, onErrorDetailsChange: noop, deviceId: 'test-device', onResetDeviceId: noop,
  legalLanguage: 'en',
};
export async function runSettingsScreenTests(h: Harness): Promise<void> {
  for (const [status, body, label, color] of [
    [200, { service: 'whim-server' }, COPY.serverProbeVerified, STATUS_COLORS.done],
    [200, {}, COPY.serverProbeUnverified, STATUS_COLORS.waiting],
    [503, {}, COPY.serverProbeUnreachable, SHELL_PALETTE.danger],
  ] as const) {
    await h.test(`Settings: an edit saves once typing pauses, and renders ${label} after verification`, async () => {
      const clock = captureTimeouts();
      const originalFetch = globalThis.fetch;
      const requested: string[] = [];
      const saved: string[] = [];
      let resolve!: (response: Response) => void;
      const response = new Promise<Response>(done => { resolve = done; });
      globalThis.fetch = (async (url: string) => { requested.push(String(url)); return response; }) as typeof fetch;
      let tree: TestRenderer.ReactTestRenderer | undefined;
      try {
        tree = await renderScreen(<SettingsScreen {...props} onServerUrlChange={url => saved.push(url)} />);
        const results = () => tree!.root.findAll(isProbeResult);
        h.eq(results().length, 0, 'untouched address has no probe result');
        await type(tree, 'https://edited.example/');
        h.eq([saved, requested], [[], []], 'typing alone saves and sends nothing');
        h.eq(clock.count(600), 2, 'the edit waits on one pause for the save and one for the probe');
        await TestRenderer.act(async () => clock.fire(600));
        h.eq(saved, ['https://edited.example/'], 'the pause saves the edit');
        h.eq(requested, ['https://edited.example/healthz'], 'probe uses the sanitized saved address');
        h.eq(results().length, 0, 'in-flight probe has no settled result');
        await TestRenderer.act(async () => { resolve(new Response(JSON.stringify(body), { status })); await response; });
        h.eq(results().map(node => node.children.join('')), [label], 'the actual screen renders the classification');
        h.eq(StyleSheet.flatten(results()[0].props.style).color, color, 'classification uses its status color');
        await type(tree, '');
        h.eq(results().length, 0, 'cleared address removes the result at once');
        h.eq(clock.count(600), 1, 'clearing waits on the save alone, with no probe');
        await TestRenderer.act(async () => clock.fire(600));
        h.eq(saved, ['https://edited.example/', ''], 'clearing saves once typing pauses');
      } finally {
        if (tree) await unmountScreen(tree);
        globalThis.fetch = originalFetch;
        clock.restore();
      }
    });
  }
  await h.test('Settings: without consent an edit still saves but does not probe', async () => {
    const clock = captureTimeouts();
    const saved: string[] = [];
    const tree = await renderScreen(<SettingsScreen {...props} canProbe={false} onServerUrlChange={url => saved.push(url)} />);
    try {
      await type(tree, 'https://new.example');
      h.eq(clock.count(600), 1, 'only the save waits on the pause: no probe without consent');
      await TestRenderer.act(async () => clock.fire(600));
      h.eq(saved, ['https://new.example'], 'consent does not gate saving');
      h.eq(tree.root.findAll(node => String(node.type) === 'Text' && node.children.includes(COPY.settingsProbeNeutral)).length, 1, 'neutral consent explanation is visible');
    } finally { await unmountScreen(tree); clock.restore(); }
  });
  await h.test('Settings: Advanced starts collapsed with no saved address, and open with one', async () => {
    for (const serverUrl of [undefined, '   ']) {
      const tree = await renderScreen(<SettingsScreen {...props} serverUrl={serverUrl} />);
      try {
        h.eq(tree.root.findAll(node => String(node.type) === 'TextInput').length, 0, `no address field while collapsed (saved: ${JSON.stringify(serverUrl)})`);
        await TestRenderer.act(async () => advancedHeader(tree).props.onPress());
        h.eq(tree.root.findAll(node => String(node.type) === 'TextInput').length, 1, 'opening Advanced shows the address field');
      } finally { await unmountScreen(tree); }
    }
    const saved = await renderScreen(<SettingsScreen {...props} serverUrl="192.168.1.20:4000" />);
    try {
      h.eq(saved.root.findAll(node => String(node.type) === 'TextInput').length, 1, 'a saved override opens Advanced already');
    } finally { await unmountScreen(saved); }
  });
  await h.test('Settings: About’s Terms of use opens the English terms page on the Whim web host', async () => {
    const tree = await renderScreen(<SettingsScreen {...props} />);
    try {
      const opened = Linking.opened.length;
      await press(button(tree, COPY.termsOfUseLabel));
      const urls = Linking.opened.slice(opened);
      h.eq(urls, [RELEASE.termsUrl], 'the English terms URL, not the privacy policy or a French twin');
      const host = new URL(urls[0] ?? 'about:blank').host;
      h.ok(host === RELEASE.webHost && host.endsWith(`.${WHIM_DOMAIN}`), `on the host derived from the release domain (got ${host})`);
    } finally { await unmountScreen(tree); }
  });
  await h.test('Settings: leaving before the pause saves the edit and cancels the pending probe', async () => {
    const clock = captureTimeouts();
    const saved: string[] = [];
    const tree = await renderScreen(<SettingsScreen {...props} onServerUrlChange={url => saved.push(url)} />);
    let mounted = true;
    try {
      await type(tree, 'https://new.example');
      h.eq([saved, clock.count(600)], [[], 2], 'the save and the probe are pending before leaving');
      mounted = false;
      await unmountScreen(tree);
      h.eq(saved, ['https://new.example'], 'leaving saves what was typed');
      h.eq(clock.count(600), 0, 'screen cleanup cancels its debounces');
    } finally {
      if (mounted) await unmountScreen(tree);
      clock.restore();
    }
  });

  await h.test('Settings: typing an address saves it once per pause, not per keystroke; submit and blur save it at once', async () => {
    const clock = captureTimeouts();
    const saved: string[] = [];
    const cleared = { count: 0 };
    const tree = await renderScreen(<SettingsScreen {...props} canProbe={false} onServerUrlChange={url => saved.push(url)} onUseDefaultServer={() => { cleared.count += 1; }} />);
    let mounted = true;
    try {
      for (const keystroke of ['localhost:', 'localhost:8', 'localhost:87', 'localhost:8787']) await type(tree, keystroke);
      h.eq([saved, clock.count(600)], [[], 1], 'four keystrokes save nothing yet and leave one pause pending');
      await TestRenderer.act(async () => clock.fire(600));
      h.eq(saved, ['localhost:8787'], 'the pause saves the finished address once');
      await type(tree, 'localhost:9');
      await TestRenderer.act(async () => addressField(tree).props.onSubmitEditing());
      h.eq([saved.at(-1), clock.count(600)], ['localhost:9', 0], 'submitting saves at once, with nothing left pending');
      await type(tree, 'localhost:90');
      await TestRenderer.act(async () => addressField(tree).props.onBlur());
      h.eq([saved.at(-1), clock.count(600)], ['localhost:90', 0], 'leaving the field saves at once');
      await TestRenderer.act(async () => addressField(tree).props.onBlur());
      h.eq(saved.length, 3, 'a blur with nothing new saves nothing');
      await type(tree, 'localhost:900');
      await press(button(tree, COPY.settingsUseDefaultServer));
      mounted = false;
      await unmountScreen(tree);
      h.eq([saved.length, cleared.count, clock.count(600)], [3, 1, 0], '"Use the default server" drops the unsaved edit instead of saving it later');
    } finally {
      if (mounted) await unmountScreen(tree);
      clock.restore();
    }
  });

  await h.test('Settings: submitting the address verifies it at once', async () => {
    const clock = captureTimeouts();
    const originalFetch = globalThis.fetch;
    const requested: string[] = [];
    globalThis.fetch = (async (url: string) => { requested.push(String(url)); return new Response(JSON.stringify({ service: 'whim-server' })); }) as typeof fetch;
    const tree = await renderScreen(<SettingsScreen {...props} />);
    try {
      await type(tree, 'https://typed.example');
      h.eq(requested, [], 'typing alone sends nothing');
      await TestRenderer.act(async () => addressField(tree).props.onSubmitEditing());
      h.eq([requested, clock.count(600)], [['https://typed.example/healthz'], 0], 'submitting probes the address without waiting for the pause');
    } finally {
      await unmountScreen(tree);
      globalThis.fetch = originalFetch;
      clock.restore();
    }
  });

  await h.test('Settings: expanding Advanced scrolls the revealed address field into view', async () => {
    const scrolls: unknown[] = [];
    const createNodeMock = (element: React.ReactElement) => (String(element.type) === 'ScrollView' ? { scrollToEnd: (options: unknown) => scrolls.push(options) } : null);
    const open = async (serverUrl: string | undefined) => {
      let tree!: TestRenderer.ReactTestRenderer;
      await TestRenderer.act(async () => { tree = TestRenderer.create(<SettingsScreen {...props} serverUrl={serverUrl} />, { createNodeMock }); });
      return tree;
    };
    const grow = (tree: TestRenderer.ReactTestRenderer) => {
      const scroll = tree.root.find(isScrollView);
      return TestRenderer.act(async () => scroll.props.onContentSizeChange(390, 1200));
    };
    const collapsed = await open(undefined);
    try {
      await grow(collapsed);
      h.eq(scrolls, [], 'opening Settings scrolls nowhere');
      await TestRenderer.act(async () => advancedHeader(collapsed).props.onPress());
      await grow(collapsed);
      h.eq(scrolls, [{ animated: true }], 'once Advanced has grown the content, the scroll view scrolls to its end, where the field is');
      await grow(collapsed);
      h.eq(scrolls.length, 1, 'later growth (typing, the probe line) leaves the scroll where the user put it');
      await TestRenderer.act(async () => advancedHeader(collapsed).props.onPress());
      await grow(collapsed);
      h.eq(scrolls.length, 1, 'collapsing Advanced scrolls nowhere');
    } finally { await unmountScreen(collapsed); }
    const alreadyOpen = await open('192.168.1.20:4000');
    try {
      await grow(alreadyOpen);
      h.eq(scrolls.length, 1, 'Advanced already open for a saved address scrolls nowhere on arrival');
    } finally { await unmountScreen(alreadyOpen); }
  });

  await h.test('Settings: the report sheet’s switch wears the same colours as the Settings switches', async () => {
    const settings = await renderScreen(<SettingsScreen {...props} />);
    const colours = (node: TestRenderer.ReactTestInstance) => ({ trackColor: node.props.trackColor, thumbColor: node.props.thumbColor });
    const settingsSwitches = settings.root.findAll(node => String(node.type) === 'Switch').map(colours);
    await unmountScreen(settings);
    const app: InstalledApp = { id: 'timer', name: 'Timer', createdAt: 1, lineageId: 'main', record: { appId: 'timer', name: 'Timer', manifest: { capabilities: [] } } };
    const access = { activeDescription: async () => 'A tea timer', activeSource: async () => undefined } as unknown as StoreAccess;
    const sheet = await renderScreen(<ReportSheet app={app} access={access} options={reportClientOptions({ kind: 'absent' }, 'https://server.test', 'device', testAppInfo)} onClose={noop} onUpdateRequired={noop} legalLanguage="en" />);
    try {
      await TestRenderer.act(async () => { await new Promise(resolve => setImmediate(resolve)); });
      const reportSwitches = sheet.root.findAll(node => String(node.type) === 'Switch').map(colours);
      h.ok(settingsSwitches.length === 2 && settingsSwitches.every(c => c.trackColor !== undefined && c.thumbColor !== undefined), 'the Settings switches are coloured');
      h.eq(reportSwitches, [settingsSwitches[0]], 'the report sheet’s one switch matches them, not the platform default');
    } finally { await unmountScreen(sheet); }
  });
}
