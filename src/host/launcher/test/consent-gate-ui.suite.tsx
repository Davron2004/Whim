/** Every data-sending entry point in the rendered launcher asks for AI-data consent first (the
 *  terms are already accepted here; `terms-flow-ui.suite.tsx` covers the step before), sends
 *  nothing until the user agrees, and then continues the action the user started. The first-run
 *  sheet and the Settings review screen show the version-2 disclosure in the spec's order, and an
 *  outdated grant (a version-1 one included) adds the outdated line and the what's-new line written
 *  for that version. */
import React from 'react';
import TestRenderer from 'react-test-renderer';
import { Harness } from './harness';
import { COPY, CONSENT_SCREEN_COVERAGE, CONSENT_WHATS_NEW, FIRST_RUN_COVERAGE, FIRST_RUN_SENT_KEYS, firstRunSentText, LEGAL_COPY, type LegalCopyTable } from '../copy';
import { MANIFESTS, latestVersion } from '../../../../contract/src/disclosure-manifest';
import { RELEASE } from '../release-config';
import LauncherRoot from '../LauncherRoot';
import HomeScreen from '../HomeScreen';
import HistoryScreen from '../HistoryScreen';
import MiniAppView from '../MiniAppView';
import FailureScreen from '../FailureScreen';
import { DescribePage } from '../DescribePage';
import ConsentScreen from '../ConsentScreen';
import { FirstRunSheet } from '../FirstRunSheet';
import { Icon } from '../../ui/Icon';
import { StoreAccess } from '../store-access';
import { grantConsent } from '../ai-consent';
import { acceptTerms } from '../terms-acceptance';
import { AppIndex, type InstalledApp } from '../app-index';
import { PendingBuildStore } from '../pending-builds';
import { createMmkvBackend } from '../../version-store/fs/mmkv-backend';
import type { KVBackend } from '../../version-store/fs/kv-fs';
import { SEED_VERSION } from '../seed';
import { resetNativeStorage } from './native-storage';
import { button, press, renderScreen, textOf, unmountScreen, captureTimeouts, hostType } from './react-screen';
import { Linking } from './native-host';
import { testAppInfo } from './client-fixtures';
import { onHome } from './rendered-launcher';

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
  const describe = tree.root.findAllByType(DescribePage);
  if (describe.length !== 1) return `expected the describe page, found ${describe.length}`;
  const scoped = describe[0].props.editing as InstalledApp | undefined;
  if ((scoped != null) !== (editing != null)) return `describe page editing=${scoped?.name}`;
  if (editing != null && scoped?.name !== editing.name) return `describe page is scoped to ${scoped?.name}`;
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

/** The disclosure keys in the order spec ai-data-consent "The disclosure names what is sent…" lists
 *  its sections: title and lead, what gets sent, why, who gets it, what the user saves, what Whim
 *  never does, ask first, the Settings footnote, then (on the review screen) the privacy link. */
const SPEC_ORDER = [
  'consentTitle', 'consentLead',
  'consentSentTitle', 'consentSentRequest', 'consentSentEdit', 'consentSentDevice', 'consentSentErrors',
  'consentWhyTitle', 'consentWhy',
  'consentWhoTitle', 'consentWho', 'consentWhoPlatform', 'consentWhoAuthorities',
  'consentStaysTitle', 'consentStays',
  'consentNeverTitle', 'consentNever',
  'consentAskFirst', 'consentFootnote', 'privacyPolicyLabel',
] as const;

/** The first key of `order` the rendered text doesn't show, in `table`'s wording, after the
 *  previous one, or null. */
function firstOutOfOrder(text: string, table: LegalCopyTable, order: readonly (keyof LegalCopyTable)[] = SPEC_ORDER): string | null {
  let cursor = 0;
  for (const key of order) {
    const at = text.indexOf(table[key], cursor);
    if (at < 0) return key;
    cursor = at + table[key].length;
  }
  return null;
}

/** Each legal language, with the word the terms of use go by in it and its privacy policy page. */
const LANGUAGES = [
  { language: 'en', termsWord: /terms/i, privacyUrl: RELEASE.privacyPolicyUrl },
  { language: 'fr', termsWord: /conditions/i, privacyUrl: RELEASE.privacyPolicyUrlFr },
] as const;

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
  acceptTerms(kv, '2026-09-01T12:00:00.000Z');
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
    if (String(url).endsWith('/health')) return new Response(JSON.stringify({ service: 'whim-server' }));
    if (String(url).endsWith('/clarify')) return new Response(JSON.stringify({ questions: [] }));
    if (String(url).endsWith('/rewrite')) return new Response(JSON.stringify({ rewrittenPrompt: 'A tea timer', plan: [] }));
    return new Promise<Response>(() => {});
  }) as typeof fetch;
  let tree: Tree | undefined;
  try {
    tree = await renderScreen(<LauncherRoot appInfo={testAppInfo} deviceLocale={() => 'en-US'} />);
    await body(tree, requests, headers);
  } finally {
    if (tree) await unmountScreen(tree);
    globalThis.fetch = originalFetch;
    Object.assign(StoreAccess.prototype, { activeBundle, timeline, activeId });
    clock.restore();
  }
}

/** The first four consecutive words of `a` that `b` also has in a row, or null: a lead and a row
 *  that say the same thing in the same words, however the sentences around them are cut. */
function sharedPhrase(a: string, b: string): string | null {
  const RUN = 4;
  const words = (text: string) => text.toLowerCase().split(/[^a-zà-öø-ÿœ’]+/).filter((word) => word !== '');
  const haystack = ` ${words(b).join(' ')} `;
  const mine = words(a);
  for (let i = 0; i + RUN <= mine.length; i++) {
    const phrase = mine.slice(i, i + RUN).join(' ');
    if (haystack.includes(` ${phrase} `)) return phrase;
  }
  return null;
}

export async function runConsentGateUiTests(h: Harness): Promise<void> {
  for (const consent of ['none', 'outdated'] as const) {
    for (const entry of ENTRIES) {
      await h.test(`consent gate (${consent === 'none' ? 'no grant' : 'outdated grant'}): ${entry.name} asks first, sends nothing, then continues on agree`, async () => {
        await withLauncher(consent, async (tree, requests) => {
          await entry.trigger(tree);
          const firstRun = tree.root.findAllByType(FirstRunSheet).filter((sheet) => sheet.props.visible);
          h.eq(firstRun.length, 1, 'the first-run sheet opens in place of the action');
          h.eq(firstRun[0]?.props.termsDue, false, 'asking for consent alone: the terms are already accepted');
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
      await TestRenderer.act(async () => tree.root.findByType(DescribePage).props.onChangeText('A tea timer'));
      await TestRenderer.act(async () => tree.root.findByType(DescribePage).props.onContinue());
      const clarify = requests.indexOf('/v1/clarify');
      h.ok(clarify >= 0, `continuing sends the clarify request (sent ${JSON.stringify(requests)})`);
      h.ok((headers[clarify]?.get('x-whim-device') ?? '').length > 0, 'with the device header');
    });
  });

  await h.test('consent gate: declining from a running app lands on Home and sends nothing', async () => {
    await withLauncher('none', async (tree, requests) => {
      await ENTRIES[3].trigger(tree);
      await press(button(tree, COPY.consentDecline));
      h.ok(onHome(tree), 'declining returns to Home, not to the torn-down app');
      h.eq(requests, [], 'nothing was sent');
    });
  });

  for (const { language, termsWord, privacyUrl } of LANGUAGES) {
    const table = LEGAL_COPY[language];

    /** What the disclosure must say, wherever it is shown: complete, and in the spec's order. */
    const checkDisclosure = (text: string, order: readonly (keyof LegalCopyTable)[]) => {
      const outOfOrder = firstOutOfOrder(text, table, order);
      h.ok(outOfOrder === null, `every section renders in the spec's order (first missing or out of order: ${outOfOrder ?? 'none'})`);
      const covered = [...Object.entries(CONSENT_SCREEN_COVERAGE.categories), ...Object.entries(CONSENT_SCREEN_COVERAGE.roles)];
      for (const [id, keys] of covered) {
        h.ok(keys.every((key) => text.includes(table[key])), `the screen shows what names ${id}`);
      }
    };

    await h.test(`consent review (${language}): the disclosure is complete, in order, with the privacy link and no terms`, async () => {
      const tree = await renderScreen(<ConsentScreen language={language} onLanguageChange={() => {}} consentOn={false} onAgree={() => {}} onClose={() => {}} />);
      try {
        const text = textOf(tree.root);
        checkDisclosure(text, SPEC_ORDER);
        h.ok(!termsWord.test(text), 'nothing on the screen is about the terms of use');
        const opened = Linking.opened.length;
        await press(button(tree, table.privacyPolicyLabel));
        h.eq(Linking.opened.slice(opened), [privacyUrl], 'the privacy link opens the policy in the screen’s language');
      } finally {
        await unmountScreen(tree);
      }
    });

    await h.test(`first-run sheet (${language}): the first layer names every category sent and every screen-named recipient role of the current manifest, with nothing expanded`, async () => {
      const manifest = MANIFESTS[latestVersion()];
      const sent = manifest.categories.filter((category) => category.onScreen);
      const named = manifest.roles.filter((role) => role.namedOnScreen);
      h.ok(sent.length > 0 && named.length > 0, 'the manifest puts something on the screen, so this cannot pass vacuously');
      const tree = await renderScreen(<FirstRunSheet visible language={language} onLanguageChange={() => {}} termsDue={false} consentDue onAgree={() => {}} onClose={() => {}} />);
      try {
        const visible = textOf(tree.root);
        h.ok(!visible.includes(table.consentWho), 'Full details is collapsed, so none of this comes from the long disclosure');
        for (const [what, id, keys] of [
          ...sent.map((category) => ['category', category.id, FIRST_RUN_COVERAGE.categories[category.id]] as const),
          ...named.map((role) => ['role', role.id, FIRST_RUN_COVERAGE.roles[role.id]] as const),
          ['purpose', 'of the data', FIRST_RUN_COVERAGE.purpose] as const,
        ]) {
          h.ok(keys !== undefined && keys.length > 0, `${what} ${id}: the first layer declares which text names it`);
          h.ok((keys ?? []).every((key) => visible.includes(table[key])), `${what} ${id}: that text is on the sheet before anything is expanded`);
        }
        h.ok(visible.includes(table.firstRunStays) && visible.includes(table.firstRunNever), 'what stays on the phone and what Whim never does are there too');
        h.ok(visible.includes(table.privacyPolicyLabel) && !termsWord.test(visible), 'with the privacy link and no wording about the terms of use');
      } finally {
        await unmountScreen(tree);
      }
    });

    await h.test(`first-run sheet (${language}): the lead says no sentence the first row says, and every sentence of the row shows exactly once`, async () => {
      const tree = await renderScreen(<FirstRunSheet visible language={language} onLanguageChange={() => {}} termsDue={false} consentDue onAgree={() => {}} onClose={() => {}} />);
      try {
        const visible = textOf(tree.root);
        h.eq(sharedPhrase(table.firstRunLead, firstRunSentText(table)), null, 'no run of words in the lead recurs in the row');
        for (const key of FIRST_RUN_SENT_KEYS) {
          h.eq(visible.split(table[key]).length - 1, 1, `${key} appears once on the sheet`);
        }
        h.ok(!visible.includes(table.consentLead), 'and the sheet does not carry the consent screen’s lead, whose sentences the row already says');
      } finally {
        await unmountScreen(tree);
      }
    });

    await h.test(`first-run sheet (${language}): the Full details row shows whether it is open, to the eye and to a screen reader, and closes again`, async () => {
      const tree = await renderScreen(<FirstRunSheet visible language={language} onLanguageChange={() => {}} termsDue={false} consentDue onAgree={() => {}} onClose={() => {}} />);
      try {
        const row = () => button(tree, table.firstRunDetails);
        const glyph = () => row().findByType(Icon).props.name;
        const [closedGlyph, closedState] = [glyph(), row().props.accessibilityState?.expanded];
        h.eq(closedState, false, 'closed, the row says it is not expanded');
        await press(row());
        h.eq(row().props.accessibilityState?.expanded, true, 'open, the row says it is expanded');
        h.ok(glyph() !== closedGlyph, 'and its chevron no longer points the way the closed one does');
        await press(row());
        h.eq([row().props.accessibilityState?.expanded, glyph()], [false, closedGlyph], 'pressed again, both go back');
      } finally {
        await unmountScreen(tree);
      }
    });

    await h.test(`first-run sheet (${language}): Full details opens before the terms box is ticked or anything is agreed, and shows every section in order, naming every screen-named role`, async () => {
      const manifest = MANIFESTS[latestVersion()];
      const tree = await renderScreen(<FirstRunSheet visible language={language} onLanguageChange={() => {}} termsDue consentDue onAgree={() => { throw new Error('nothing was agreed'); }} onClose={() => {}} />);
      try {
        await press(button(tree, table.firstRunDetails));
        const text = textOf(tree.root);
        const outOfOrder = firstOutOfOrder(text, table, SPEC_ORDER.filter((key) => key !== 'privacyPolicyLabel'));
        h.ok(outOfOrder === null, `with the terms still due and the box unticked, every section renders in the spec's order (first missing or out of order: ${outOfOrder ?? 'none'})`);
        for (const role of manifest.roles.filter((r) => r.namedOnScreen)) {
          const keys = CONSENT_SCREEN_COVERAGE.roles[role.id];
          h.ok(keys !== undefined && keys.every((key) => text.includes(table[key])), `the details name ${role.id}`);
        }
        for (const category of manifest.categories.filter((c) => c.onScreen)) {
          const keys = CONSENT_SCREEN_COVERAGE.categories[category.id];
          h.ok(keys !== undefined && keys.every((key) => text.includes(table[key])), `the details name ${category.id}`);
        }
      } finally {
        await unmountScreen(tree);
      }
    });

    await h.test(`first-run sheet (${language}): the summary shows at first; Full details expands the complete disclosure in place, in order; the privacy link follows the language`, async () => {
      const tree = await renderScreen(<FirstRunSheet visible language={language} onLanguageChange={() => {}} termsDue={false} consentDue onAgree={() => {}} onClose={() => {}} />);
      try {
        const summary = textOf(tree.root);
        h.ok(summary.includes(table.consentTitle) && summary.includes(table.firstRunLead), 'the title and the lead');
        h.ok([table.firstRunSentTitle, table.firstRunStaysTitle, table.firstRunNeverTitle].every((title) => summary.includes(title)), 'three summary rows: what is sent, what stays on the phone, what is never done');
        h.ok(!summary.includes(table.consentWhy), 'the long disclosure is folded away');
        await press(button(tree, table.firstRunDetails));
        const text = textOf(tree.root);
        checkDisclosure(text, SPEC_ORDER.filter((key) => key !== 'privacyPolicyLabel'));
        h.ok(!termsWord.test(text), 'with no terms row when the terms are already accepted');
        const opened = Linking.opened.length;
        await press(button(tree, table.privacyPolicyLabel));
        h.eq(Linking.opened.slice(opened), [privacyUrl], 'the privacy row opens the policy in the sheet’s language');
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
      const line = tree.root.findAll((node) => hostType(node) === 'Text' && node.children.join('') === whatsNew);
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
