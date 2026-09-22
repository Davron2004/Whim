/** Every data-sending entry point in the rendered launcher asks for AI-data consent first, sends
 *  nothing until the user agrees, and then continues the action the user started. */
import React from 'react';
import TestRenderer from 'react-test-renderer';
import { Harness } from './harness';
import { COPY } from '../copy';
import LauncherRoot from '../LauncherRoot';
import HomeScreen from '../HomeScreen';
import HistoryScreen from '../HistoryScreen';
import MiniAppView from '../MiniAppView';
import FailureScreen from '../FailureScreen';
import ComposeStep from '../ComposeStep';
import ConsentScreen from '../ConsentScreen';
import { StoreAccess } from '../store-access';
import { grantConsent } from '../ai-consent';
import { AppIndex, type InstalledApp } from '../app-index';
import { PendingBuildStore } from '../pending-builds';
import { createMmkvBackend } from '../../version-store/fs/mmkv-backend';
import type { KVBackend } from '../../version-store/fs/kv-fs';
import { SEED_VERSION } from '../seed';
import { resetNativeStorage } from './native-storage';
import { button, press, renderScreen, unmountScreen, captureTimeouts } from './react-screen';

const app: InstalledApp = { id: 'timer', name: 'Timer', createdAt: 1, lineageId: 'main', record: { appId: 'timer', name: 'Timer', manifest: { capabilities: [] } } };

type Tree = TestRenderer.ReactTestRenderer;
type Entry = {
  name: string;
  /** Drives the rendered launcher to the entry point and takes the data-sending action. */
  trigger: (tree: Tree) => Promise<void>;
  /** After agreeing, the action the user started has continued. */
  continued: (tree: Tree, requests: string[]) => string | null;
};

const composeFor = (editing: InstalledApp | null) => (tree: Tree): string | null => {
  const compose = tree.root.findAllByType(ComposeStep);
  if (compose.length !== 1) return `expected the composer, found ${compose.length}`;
  if (compose[0].props.editing !== (editing != null)) return `composer editing=${compose[0].props.editing}`;
  if (editing != null && compose[0].props.editingName !== editing.name) return `composer is scoped to ${compose[0].props.editingName}`;
  return null;
};

const ENTRIES: Entry[] = [
  {
    name: 'Home: create',
    trigger: async (tree) => { await TestRenderer.act(async () => tree.root.findByType(HomeScreen).props.onCreate()); },
    continued: composeFor(null),
  },
  {
    name: 'Home: prompt again',
    trigger: async (tree) => { await TestRenderer.act(async () => tree.root.findByType(HomeScreen).props.onPromptAgain(app)); },
    continued: composeFor(app),
  },
  {
    name: 'History: change it from here',
    trigger: async (tree) => {
      await TestRenderer.act(async () => tree.root.findByType(HomeScreen).props.onHistory(app));
      await TestRenderer.act(async () => tree.root.findByType(HistoryScreen).props.onChangeIt(app));
    },
    continued: composeFor(app),
  },
  {
    name: 'running app: change it',
    trigger: async (tree) => {
      await TestRenderer.act(async () => tree.root.findByType(HomeScreen).props.onOpen(app));
      await TestRenderer.act(async () => tree.root.findByType(MiniAppView).props.onChangeIt());
    },
    continued: composeFor(app),
  },
  {
    name: 'failed build: retry',
    trigger: async (tree) => {
      const ghost = tree.root.findByType(HomeScreen).props.pending.find((p: { id: string }) => p.id === 'failed');
      await TestRenderer.act(async () => tree.root.findByType(HomeScreen).props.onOpenPending(ghost));
      await TestRenderer.act(async () => tree.root.findByType(FailureScreen).props.onRephrase());
    },
    continued: (_tree, requests) => requests.some((url) => url.endsWith('/v1/generate')) ? null : `no generate request after agreeing (sent ${JSON.stringify(requests)})`,
  },
];

/** A grant made at an earlier consent version: the real grant, with its version moved back. */
function grantOutdatedConsent(kv: KVBackend): void {
  grantConsent(kv, '2026-09-01T12:00:00.000Z');
  const key = 'whim.ai-consent:v1';
  const grant = JSON.parse(kv.getString(key) ?? 'null') as { version: number };
  kv.set(key, JSON.stringify({ ...grant, version: grant.version - 1 }));
}

async function withLauncher(consent: 'none' | 'outdated', body: (tree: Tree, requests: string[], headers: Headers[]) => Promise<void>): Promise<void> {
  resetNativeStorage();
  const kv = createMmkvBackend('whim.launcher');
  const index = new AppIndex(kv);
  index.markSeeded(SEED_VERSION);
  index.put(app);
  const pending = new PendingBuildStore(kv);
  pending.create({ id: 'failed', prompt: 'A tea timer', workingTitle: 'Tea timer' });
  pending.setFailed('failed', { reason: 'Server stopped', diagnostics: '' });
  if (consent === 'outdated') grantOutdatedConsent(kv);
  const clock = captureTimeouts();
  const originalFetch = globalThis.fetch;
  // The test app has no version-store repo; stub the reads the app and history screens make.
  const { activeBundle, timeline, activeId } = StoreAccess.prototype;
  StoreAccess.prototype.activeBundle = async () => 'window.__WHIM_APP_MODULE__ = {};';
  StoreAccess.prototype.timeline = async () => [];
  StoreAccess.prototype.activeId = async () => null;
  const requests: string[] = [];
  const headers: Headers[] = [];
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    requests.push(new URL(String(url)).pathname);
    headers.push(new Headers(init?.headers));
    if (String(url).endsWith('/healthz')) return new Response(JSON.stringify({ service: 'whim-server' }));
    if (String(url).endsWith('/clarify')) return new Response(JSON.stringify({ questions: [] }));
    if (String(url).endsWith('/rewrite')) return new Response(JSON.stringify({ rewrittenPrompt: 'A tea timer', plan: [] }));
    return new Promise<Response>(() => {});
  }) as typeof fetch;
  let tree: Tree | undefined;
  try {
    tree = await renderScreen(<LauncherRoot />);
    await body(tree, requests, headers);
  } finally {
    if (tree) await unmountScreen(tree);
    globalThis.fetch = originalFetch;
    Object.assign(StoreAccess.prototype, { activeBundle, timeline, activeId });
    clock.restore();
  }
}

export async function runConsentGateUiTests(h: Harness): Promise<void> {
  for (const consent of ['none', 'outdated'] as const) {
    for (const entry of ENTRIES) {
      await h.test(`consent gate (${consent === 'none' ? 'no grant' : 'outdated grant'}): ${entry.name} asks first, sends nothing, then continues on agree`, async () => {
        await withLauncher(consent, async (tree, requests) => {
          await entry.trigger(tree);
          const consentScreens = tree.root.findAllByType(ConsentScreen);
          h.eq(consentScreens.length, 1, 'the consent screen opens in place of the action');
          h.eq(consentScreens[0]?.props.mode, 'ask', 'in ask mode');
          h.eq(requests, [], 'nothing was sent before agreeing');
          await press(button(tree, COPY.consentAgree));
          const problem = entry.continued(tree, requests);
          h.ok(problem === null, 'agreeing continues the action the user started: ' + (problem ?? 'yes'));
        });
      });
    }
  }

  await h.test('consent gate: agreeing from Home, the first request carries the device id', async () => {
    await withLauncher('none', async (tree, requests, headers) => {
      await ENTRIES[0].trigger(tree);
      await press(button(tree, COPY.consentAgree));
      await TestRenderer.act(async () => tree.root.findByType(ComposeStep).props.onChangeText('A tea timer'));
      await TestRenderer.act(async () => tree.root.findByType(ComposeStep).props.onContinue());
      const clarify = requests.indexOf('/v1/clarify');
      h.ok(clarify >= 0, `continuing sends the clarify request (sent ${JSON.stringify(requests)})`);
      h.ok((headers[clarify]?.get('x-whim-device') ?? '').length > 0, 'with the device header');
    });
  });

  await h.test('consent gate: declining from a running app lands on Home and sends nothing', async () => {
    await withLauncher('none', async (tree, requests) => {
      await ENTRIES[3].trigger(tree);
      await press(button(tree, COPY.consentDecline));
      h.eq(tree.root.findAllByType(HomeScreen).length, 1, 'declining returns to Home, not to the torn-down app');
      h.eq(requests, [], 'nothing was sent');
    });
  });
}
