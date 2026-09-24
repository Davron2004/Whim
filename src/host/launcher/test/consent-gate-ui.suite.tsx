/** Every data-sending entry point in the rendered launcher asks for AI-data consent first, sends
 *  nothing until the user agrees, and then continues the action the user started. The consent
 *  screen shows the version-2 disclosure in the spec's order, and an outdated grant (a version-1
 *  one included) adds the outdated line and the what's-new line written for that version. */
import React from 'react';
import TestRenderer from 'react-test-renderer';
import { Harness } from './harness';
import { COPY, CONSENT_SCREEN_COVERAGE, CONSENT_WHATS_NEW } from '../copy';
import { RELEASE } from '../release-config';
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
import { button, press, renderScreen, textOf, unmountScreen, captureTimeouts } from './react-screen';
import { Linking } from './native-host';
import { testAppInfo } from './client-fixtures';

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

/** A grant made at another consent version: the real grant, with its version moved by `shift`. */
function grantShiftedConsent(kv: KVBackend, shift: number): void {
  grantConsent(kv, '2026-09-01T12:00:00.000Z');
  const key = 'whim.ai-consent:v1';
  const grant = JSON.parse(kv.getString(key) ?? 'null') as { version: number };
  kv.set(key, JSON.stringify({ ...grant, version: grant.version + shift }));
}

/** `outdated`: a grant one version back. `v1`: the record exactly as the version-1 build stored it.
 *  `newer`: a grant from a build newer than this one, which has no what's-new line written. */
type ConsentSeed = 'none' | 'outdated' | 'v1' | 'newer';

function seedConsent(kv: KVBackend, consent: ConsentSeed): void {
  if (consent === 'outdated') grantShiftedConsent(kv, -1);
  if (consent === 'newer') grantShiftedConsent(kv, 1);
  if (consent === 'v1') kv.set('whim.ai-consent:v1', '{"version":1,"grantedAt":"2026-09-01T12:00:00.000Z"}');
}

/** The consent screen's disclosure keys in the order spec ai-data-consent "The disclosure names
 *  what is sent…" lists its sections: title and lead, what gets sent, why, who gets it, what the
 *  user saves, what Whim never does, ask first, the Settings footnote, then the privacy link. */
const SPEC_ORDER = [
  'consentTitle', 'consentLead',
  'consentSentTitle', 'consentSentRequest', 'consentSentEdit', 'consentSentDevice', 'consentSentErrors',
  'consentWhyTitle', 'consentWhy',
  'consentWhoTitle', 'consentWho', 'consentWhoPlatform', 'consentWhoAuthorities',
  'consentStaysTitle', 'consentStays',
  'consentNeverTitle', 'consentNever',
  'consentAskFirst', 'consentFootnote', 'privacyPolicyLabel',
] as const;

/** The first key of `SPEC_ORDER` the rendered text doesn't show after the previous one, or null. */
function firstOutOfOrder(text: string): string | null {
  let cursor = 0;
  for (const key of SPEC_ORDER) {
    const at = text.indexOf(COPY[key], cursor);
    if (at < 0) return key;
    cursor = at + COPY[key].length;
  }
  return null;
}

/** Every what's-new line, in every language, for every version. */
function everyWhatsNewLine(): string[] {
  return Object.values(CONSENT_WHATS_NEW).flatMap((byVersion) => Object.values(byVersion).map((line) => line.text));
}

async function withLauncher(consent: ConsentSeed, body: (tree: Tree, requests: string[], headers: Headers[]) => Promise<void>): Promise<void> {
  resetNativeStorage();
  const kv = createMmkvBackend('whim.launcher');
  const index = new AppIndex(kv);
  index.markSeeded(SEED_VERSION);
  index.put(app);
  const pending = new PendingBuildStore(kv);
  pending.create({ id: 'failed', prompt: 'A tea timer', workingTitle: 'Tea timer' });
  pending.setFailed('failed', { reason: 'Server stopped', diagnostics: '' });
  seedConsent(kv, consent);
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
    tree = await renderScreen(<LauncherRoot appInfo={testAppInfo} />);
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

  for (const mode of ['ask', 'review'] as const) {
    await h.test(`consent screen (${mode}): the disclosure is complete, in order, with the privacy link and no terms`, async () => {
      const tree = await renderScreen(<ConsentScreen mode={mode} consentOn={false} onAgree={() => {}} onClose={() => {}} />);
      try {
        const text = textOf(tree.root);
        const outOfOrder = firstOutOfOrder(text);
        h.ok(outOfOrder === null, `every section renders in the spec's order (first missing or out of order: ${outOfOrder ?? 'none'})`);
        const covered = [...Object.entries(CONSENT_SCREEN_COVERAGE.categories), ...Object.entries(CONSENT_SCREEN_COVERAGE.roles)];
        for (const [id, keys] of covered) {
          h.ok(keys.every((key) => text.includes(COPY[key])), `the screen shows what names ${id}`);
        }
        h.ok(!/terms/i.test(text), 'nothing on the screen is about the terms of use');
        const opened = Linking.opened.length;
        await press(button(tree, COPY.privacyPolicyLabel));
        h.eq(Linking.opened.slice(opened), [RELEASE.privacyPolicyUrl], 'the privacy link opens the English policy');
      } finally {
        await unmountScreen(tree);
      }
    });
  }

  await h.test('consent gate: a version-1 grant asks again, saying in full what changed since version 1', async () => {
    const whatsNew = CONSENT_WHATS_NEW.en[1]?.text ?? '';
    h.ok(whatsNew.length > 0, 'English has a what’s-new line for version 1');
    await withLauncher('v1', async (tree, requests) => {
      await ENTRIES[0].trigger(tree);
      const text = textOf(tree.root);
      const [outdatedAt, whatsNewAt, titleAt] = [text.indexOf(COPY.consentOutdatedLine), text.indexOf(whatsNew), text.indexOf(COPY.consentTitle)];
      h.ok(outdatedAt >= 0 && whatsNewAt > outdatedAt && titleAt > whatsNewAt, 'the outdated line, then version 1’s what’s-new line, both above the title');
      const line = tree.root.findAll((node) => node.type === 'Text' && node.children.join('') === whatsNew);
      h.ok(line.length === 1 && line[0].props.numberOfLines === undefined, 'the what’s-new line is one text, never truncated');
      h.eq(requests, [], 'nothing is sent before agreeing again');
      await press(button(tree, COPY.consentAgree));
      h.ok(composeFor(null)(tree) === null, 'agreeing continues the action the user started');
    });
  });

  await h.test('consent gate: a grant from a newer build asks again without a what’s-new line', async () => {
    await withLauncher('newer', async (tree, requests) => {
      await ENTRIES[0].trigger(tree);
      const text = textOf(tree.root);
      h.ok(text.includes(COPY.consentOutdatedLine), 'the outdated line still says it changed');
      h.ok(everyWhatsNewLine().every((line) => !text.includes(line)), 'and no line written for another version stands in');
      h.eq(requests, [], 'nothing is sent');
    });
  });
}
