import React from 'react';
import TestRenderer from 'react-test-renderer';
import { Harness } from './harness';
import SettingsScreen, { type SettingsScreenProps } from '../SettingsScreen';
import { COPY } from '../copy';
import { STATUS_COLORS } from '../../../sdk/theme';
import { SHELL_PALETTE } from '../theme';
import { captureTimeouts, renderScreen, unmountScreen } from './react-screen';
import { StyleSheet } from './native-host';

const noop = () => {};
const isAdvancedTitle = (node: TestRenderer.ReactTestInstance) => node.type === 'Text' && node.children.includes(COPY.settingsAdvancedSectionTitle);
const advancedHeader = (tree: TestRenderer.ReactTestRenderer) => tree.root.find(node => node.type === 'TouchableOpacity' && node.findAll(isAdvancedTitle).length > 0);
function isProbeResult(node: TestRenderer.ReactTestInstance): boolean {
  return node.type === 'Text' && [COPY.serverProbeVerified, COPY.serverProbeUnverified, COPY.serverProbeUnreachable].some(text => node.children.includes(text));
}
const props: SettingsScreenProps = {
  serverUrl: 'https://saved.example', highlighting: true, canProbe: true,
  consentStatus: { kind: 'granted', grantedAt: '2026-09-18' },
  onBack: noop, onServerUrlChange: noop, onUseDefaultServer: noop,
  onHighlightingChange: noop, onOpenAIFeatures: noop,
};
export async function runSettingsScreenTests(h: Harness): Promise<void> {
  for (const [status, body, label, color] of [
    [200, { service: 'whim-server' }, COPY.serverProbeVerified, STATUS_COLORS.done],
    [200, {}, COPY.serverProbeUnverified, STATUS_COLORS.waiting],
    [503, {}, COPY.serverProbeUnreachable, SHELL_PALETTE.danger],
  ] as const) {
    await h.test(`Settings: edit saves immediately and renders ${label} after verification`, async () => {
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
        await TestRenderer.act(async () => tree!.root.findByType('TextInput').props.onChangeText('https://edited.example/'));
        h.eq(saved, ['https://edited.example/'], 'save occurs before verification');
        h.eq(requested, [], 'typing alone sends nothing');
        h.eq(clock.count(600), 1, 'edit schedules one debounce');
        await TestRenderer.act(async () => clock.fire(600));
        h.eq(requested, ['https://edited.example/healthz'], 'probe uses the sanitized saved address');
        h.eq(results().length, 0, 'in-flight probe has no settled result');
        await TestRenderer.act(async () => { resolve(new Response(JSON.stringify(body), { status })); await response; });
        h.eq(results().map(node => node.children.join('')), [label], 'the actual screen renders the classification');
        h.eq(StyleSheet.flatten(results()[0].props.style).color, color, 'classification uses its status color');
        await TestRenderer.act(async () => tree!.root.findByType('TextInput').props.onChangeText(''));
        h.eq(saved, ['https://edited.example/', ''], 'clearing still saves immediately');
        h.eq(results().length, 0, 'cleared address removes the result');
        h.eq(clock.count(600), 0, 'clearing leaves no debounce');
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
      await TestRenderer.act(async () => tree.root.findByType('TextInput').props.onChangeText('https://new.example'));
      h.eq(saved, ['https://new.example'], 'consent does not gate saving');
      h.eq(clock.count(600), 0, 'no probe scheduled without consent');
      h.eq(tree.root.findAll(node => node.type === 'Text' && node.children.includes(COPY.settingsProbeNeutral)).length, 1, 'neutral consent explanation is visible');
    } finally { await unmountScreen(tree); clock.restore(); }
  });
  await h.test('Settings: Advanced starts collapsed with no saved address, and open with one', async () => {
    for (const serverUrl of [undefined, '   ']) {
      const tree = await renderScreen(<SettingsScreen {...props} serverUrl={serverUrl} />);
      try {
        h.eq(tree.root.findAll(node => node.type === 'TextInput').length, 0, `no address field while collapsed (saved: ${JSON.stringify(serverUrl)})`);
        await TestRenderer.act(async () => advancedHeader(tree).props.onPress());
        h.eq(tree.root.findAll(node => node.type === 'TextInput').length, 1, 'opening Advanced shows the address field');
      } finally { await unmountScreen(tree); }
    }
    const saved = await renderScreen(<SettingsScreen {...props} serverUrl="192.168.1.20:4000" />);
    try {
      h.eq(saved.root.findAll(node => node.type === 'TextInput').length, 1, 'a saved override opens Advanced already');
    } finally { await unmountScreen(saved); }
  });
  await h.test('Settings: leaving before debounce cancels the pending probe', async () => {
    const clock = captureTimeouts();
    const tree = await renderScreen(<SettingsScreen {...props} />);
    try {
      await TestRenderer.act(async () => tree.root.findByType('TextInput').props.onChangeText('https://new.example'));
      h.eq(clock.count(600), 1, 'probe is pending before leaving');
      await unmountScreen(tree);
      h.eq(clock.count(600), 0, 'screen cleanup cancels its debounce');
    } finally { clock.restore(); }
  });
}
