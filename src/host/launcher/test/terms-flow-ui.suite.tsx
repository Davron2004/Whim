/** The terms step in the rendered launcher (legal-surface-v2 tasks 4.2/4.3; spec terms-acceptance):
 *  a data-sending action without a current acceptance opens the terms step before the consent
 *  screen, each step shows only when it isn't current, declining either grants nothing, the send
 *  gate needs both records, reports need neither, and a `consent_required` refusal routes through
 *  the terms when they are missing without losing the typed prompt. */
import React from 'react';
import TestRenderer from 'react-test-renderer';
import { Harness } from './harness';
import HomeScreen from '../HomeScreen';
import ComposeStep from '../ComposeStep';
import ConsentScreen from '../ConsentScreen';
import HistoryScreen from '../HistoryScreen';
import MiniAppView from '../MiniAppView';
import TermsScreen from '../TermsScreen';
import { COPY, CONSENT_SCREEN_COVERAGE, CONSENT_WHATS_NEW, LEGAL_COPY } from '../copy';
import type { LegalLanguage } from '../legal-language';
import { RELEASE } from '../release-config';
import { StoreAccess } from '../store-access';
import { termsStatus } from '../terms-acceptance';
import type { InstalledApp } from '../app-index';
import type { KVBackend } from '../../version-store/fs/kv-fs';
import { APP_BUNDLES } from '../../../runtime/generated/app-bundles';
import { consentRequiredRefusal } from '../../../../server/src/admission/refusals';
import { button, press, renderScreen, textOf, unmountScreen } from './react-screen';
import { composeAndContinue, json, tap, waitFor, wasSent, withLauncher, type SentRequest, type Tree } from './rendered-launcher';
import { Linking, injectedScripts } from './native-host';

const TERMS_KEY = 'whim.terms:v1';
const CONSENT_KEY = 'whim.ai-consent:v1';
/** The consent grant exactly as the version-1 build stored it. */
const V1_GRANT = '{"version":1,"grantedAt":"2026-09-01T12:00:00.000Z"}';
const APP: InstalledApp = { id: 'timer', name: 'Timer', createdAt: 1, lineageId: 'main', record: { appId: 'timer', name: 'Timer', manifest: { capabilities: [] } } };

const on = (tree: Tree, type: Parameters<Tree['root']['findAllByType']>[0]) => tree.root.findAllByType(type).length === 1;
const home = (tree: Tree) => tree.root.findByType(HomeScreen);

/** The Tip Splitter example first-run seeding installs, once Home lists it. */
function tipSplitter(tree: Tree): InstalledApp | undefined {
  return home(tree).props.apps.find((a: InstalledApp) => a.name === 'Tip Splitter');
}

/** Let the running app's page finish loading, so the shell delivers its bundle. */
async function loadAppPage(tree: Tree): Promise<void> {
  await TestRenderer.act(async () => tree.root.find((node) => node.type === 'WebView').props.onLoadEnd());
}

/** Home's composer row: the first data-sending action spec terms-acceptance names. */
async function describeAnApp(tree: Tree): Promise<void> {
  await TestRenderer.act(async () => home(tree).props.onCreate());
}

/** The new-app composer is showing. */
function composingNewApp(tree: Tree): boolean {
  const compose = tree.root.findAllByType(ComposeStep);
  return compose.length === 1 && compose[0].props.editing === false;
}

/** Answers clarify with no questions; nothing else is expected. */
const clarifyServer = (r: SentRequest): Response | Promise<Response> =>
  r.path === '/v1/clarify' ? json({ questions: [] }) : new Promise<Response>(() => {});

/** Word stems, per language, that would make the terms step a data disclosure: what is sent, to
 *  whom, or why. */
const DATA_STEMS: Readonly<Record<LegalLanguage, readonly string[]>> = {
  en: [
    'data', 'send', 'sent', 'share', 'collect', 'information', 'personal', 'privacy', 'phone', 'device',
    'server', 'provider', 'compan', 'anycognition', 'apple', 'google', 'advertis', 'track', 'error',
  ],
  fr: [
    'donn', 'envo', 'partag', 'recueil', 'collect', 'renseign', 'personnel', 'confidentialit', 'téléphone',
    'appareil', 'serveur', 'fournisseur', 'entreprise', 'anycognition', 'apple', 'google', 'publicit', 'suiv',
    'erreur', 'identifiant',
  ],
};

/** The words of `text` that start with one of `language`'s data stems, or are the bare word "ID". */
function dataWords(text: string, language: LegalLanguage): string[] {
  const words = text.toLowerCase().split(/[^a-zà-öø-ÿœ]+/);
  return words.filter((word) => word === 'id' || DATA_STEMS[language].some((stem) => word.startsWith(stem)));
}

/** Every consent-screen disclosure string in `language`: the covered category and role lines and
 *  the prose sections around them. */
function disclosureStrings(language: LegalLanguage): string[] {
  const covered = [...Object.values(CONSENT_SCREEN_COVERAGE.categories), ...Object.values(CONSENT_SCREEN_COVERAGE.roles)].flat();
  const prose = ['consentLead', 'consentWhy', 'consentStays', 'consentNever', 'consentAskFirst', 'consentFootnote'] as const;
  return [...covered, ...prose].map((key) => LEGAL_COPY[language][key]);
}

export async function runTermsFlowUiTests(h: Harness): Promise<void> {
  await h.test('terms: a fresh install’s first data-sending action shows the terms, then consent, then the composer', async () => {
    await withLauncher({ terms: false, consent: false, server: clarifyServer }, async ({ tree, kv, sent, probes }) => {
      await describeAnApp(tree);
      h.ok(on(tree, TermsScreen) && !on(tree, ConsentScreen), 'the terms step opens, before any consent screen');
      h.ok(textOf(tree.root).includes(COPY.termsLead), 'with its lead');
      const opened = Linking.opened.length;
      await press(button(tree, COPY.termsLabel));
      h.eq(Linking.opened.slice(opened), [RELEASE.termsUrl], 'its link opens the English terms of use');
      await press(button(tree, COPY.termsAccept));
      h.eq(termsStatus(kv).kind, 'accepted', 'Accept stores a current acceptance');
      h.ok(on(tree, ConsentScreen) && tree.root.findByType(ConsentScreen).props.mode === 'ask', 'then the consent screen opens, in ask mode');
      h.eq([sent.length, probes.length], [0, 0], 'nothing was sent yet, not even a connectivity probe');
      await press(button(tree, COPY.consentAgree));
      h.ok(composingNewApp(tree), 'agreeing opens the composer the user asked for');
    });
  });

  await h.test('terms: Not now stores nothing, skips the consent screen, sends nothing, and installed apps keep working', async () => {
    await withLauncher({ examples: true, terms: false, consent: false, server: clarifyServer }, async ({ tree, kv, sent, probes }) => {
      await waitFor(() => on(tree, HomeScreen) && tipSplitter(tree) !== undefined, 'the example apps');
      await describeAnApp(tree);
      await press(button(tree, COPY.termsDecline));
      h.ok(on(tree, HomeScreen), 'declining returns to Home, where the action started');
      h.ok(!on(tree, ConsentScreen), 'the consent screen is not shown');
      h.ok(kv.getString(TERMS_KEY) == null, 'no acceptance record is stored');
      h.eq([sent.length, probes.length], [0, 0], 'no request was sent');
      injectedScripts.length = 0;
      await TestRenderer.act(async () => home(tree).props.onOpen(tipSplitter(tree)));
      await waitFor(() => on(tree, MiniAppView), 'the example to open');
      await loadAppPage(tree);
      h.ok(injectedScripts.length === 1 && injectedScripts[0].includes(JSON.stringify(APP_BUNDLES['tip-splitter'])), 'an installed app still opens and runs');
    });
  });

  await h.test('terms: with the terms current, an outdated consent grant opens the consent screen directly — a consent bump never re-shows the terms', async () => {
    await withLauncher({ consent: false, prepare: (kv) => kv.set(CONSENT_KEY, V1_GRANT), server: clarifyServer }, async ({ tree }) => {
      await describeAnApp(tree);
      h.ok(on(tree, ConsentScreen) && !on(tree, TermsScreen), 'only the consent screen is shown');
      h.ok(textOf(tree.root).includes(COPY.consentOutdatedLine), 'saying consent changed');
      await press(button(tree, COPY.consentAgree));
      h.ok(composingNewApp(tree) && !on(tree, TermsScreen), 'agreeing continues, with no terms step after it either');
    });
  });

  await h.test('terms: an existing tester with a version-1 grant and no terms record sees the terms, then consent with what changed, then continues', async () => {
    const whatsNew = CONSENT_WHATS_NEW.en[1]?.text ?? '';
    h.ok(whatsNew.length > 0, 'English has a what’s-new line for version 1');
    await withLauncher({ terms: false, consent: false, prepare: (kv) => kv.set(CONSENT_KEY, V1_GRANT), server: clarifyServer }, async ({ tree, sent }) => {
      await describeAnApp(tree);
      h.ok(on(tree, TermsScreen), 'the terms step first');
      h.ok(!textOf(tree.root).includes(COPY.termsUpdatedLine), 'as a first acceptance, not an update');
      await press(button(tree, COPY.termsAccept));
      const text = textOf(tree.root);
      h.ok(on(tree, ConsentScreen) && text.includes(COPY.consentOutdatedLine) && text.includes(whatsNew), 'then consent, with the outdated line and version 1’s what’s-new line');
      h.eq(sent.length, 0, 'nothing sent before agreeing');
      await press(button(tree, COPY.consentAgree));
      h.ok(composingNewApp(tree), 'agreeing continues the action');
    });
  });

  await h.test('terms: an acceptance of another terms version shows the updated-terms line in place of the lead', async () => {
    // The acceptance `withLauncher` stored, as a build shipping the next terms version finds it.
    const otherTerms = (kv: KVBackend) => {
      const stored = JSON.parse(kv.getString(TERMS_KEY) ?? 'null') as { version: number; acceptedAt: string };
      kv.set(TERMS_KEY, JSON.stringify({ ...stored, version: stored.version - 1 }));
    };
    await withLauncher({ prepare: otherTerms, server: clarifyServer }, async ({ tree }) => {
      await describeAnApp(tree);
      const text = textOf(tree.root);
      h.ok(on(tree, TermsScreen), 'the terms step opens');
      h.ok(text.includes(COPY.termsUpdatedLine) && !text.includes(COPY.termsLead), 'with the updated-terms line instead of the lead');
      await press(button(tree, COPY.termsAccept));
      h.ok(composingNewApp(tree) && !on(tree, ConsentScreen), 'with consent current, Accept goes straight to the action');
    });
  });

  await h.test('terms gate: a current grant without terms sends nothing, not even a probe, until the terms are accepted', async () => {
    await withLauncher({ terms: false, server: clarifyServer }, async ({ tree, sent, probes }) => {
      h.eq(probes.length, 0, 'no connectivity probe at launch');
      await describeAnApp(tree);
      h.ok(on(tree, TermsScreen), 'the data-sending action opens the terms step');
      h.eq([sent.length, probes.length], [0, 0], 'nothing was sent');
      await press(button(tree, COPY.termsAccept));
      h.ok(composingNewApp(tree) && !on(tree, ConsentScreen), 'with the grant current, Accept continues straight to the composer');
      await TestRenderer.act(async () => tree.root.findByType(ComposeStep).props.onChangeText('A tea timer'));
      await tap(() => tree.root.findByType(ComposeStep).props.onContinue());
      await waitFor(() => wasSent(sent, '/v1/clarify'), 'the clarify request');
      await waitFor(() => probes.length > 0, 'the connectivity probe');
    });
  });

  await h.test('terms gate: a report sent with neither record sends exactly that report, and neither screen appears', async () => {
    const { timeline, activeId, activeDescription, activeSource } = StoreAccess.prototype;
    const original = { timeline, activeId, activeDescription, activeSource };
    StoreAccess.prototype.timeline = async () => [];
    StoreAccess.prototype.activeId = async () => null;
    StoreAccess.prototype.activeDescription = async () => 'A tea timer';
    StoreAccess.prototype.activeSource = async () => 'export default {}';
    try {
      await withLauncher({ terms: false, consent: false, apps: [APP], server: () => json({ reportId: 'r-1' }, 202) }, async ({ tree, sent, probes }) => {
        await TestRenderer.act(async () => home(tree).props.onHistory(APP));
        await TestRenderer.act(async () => tree.root.findByType(HistoryScreen).props.onReport());
        await waitFor(() => textOf(tree.root).includes(COPY.reportReasonBroken), 'the report draft');
        await press(button(tree, COPY.reportReasonBroken));
        await press(button(tree, COPY.reportSend));
        await waitFor(() => sent.length > 0, 'the report request');
        h.eq(sent.map((r) => r.path), ['/v1/report'], 'exactly the report was sent');
        h.eq(probes.length, 0, 'and no probe');
        h.ok(!on(tree, TermsScreen) && !on(tree, ConsentScreen), 'neither the terms step nor the consent screen appeared');
      });
    } finally {
      Object.assign(StoreAccess.prototype, original);
    }
  });

  // A `consent_required` refusal arriving after the terms record went missing (the request was
  // gated on it, so it can only vanish in between): the refusal routes through the terms first.
  let store: KVBackend | undefined;
  const refusesAndLosesTerms = (): Response => {
    store?.delete(TERMS_KEY);
    const refusal = consentRequiredRefusal();
    return new Response(JSON.stringify(refusal.body), { status: refusal.status, headers: { 'Content-Type': 'application/json', ...refusal.headers } });
  };
  const keepStore = (kv: KVBackend) => { store = kv; };

  await h.test('consent_required without terms: the terms step comes first, and Not now returns to compose with the typed prompt', async () => {
    await withLauncher({ prepare: keepStore, server: refusesAndLosesTerms }, async ({ tree, kv }) => {
      await composeAndContinue(tree, 'A tea timer');
      await waitFor(() => on(tree, TermsScreen), 'the terms step');
      h.ok(!on(tree, ConsentScreen), 'before the consent screen');
      await press(button(tree, COPY.termsDecline));
      h.ok(on(tree, ComposeStep), 'Not now returns to compose');
      h.eq(tree.root.findByType(ComposeStep).props.text, 'A tea timer', 'with the typed prompt');
      h.eq(termsStatus(kv).kind, 'absent', 'and accepts nothing');
    });
  });

  await h.test('consent_required without terms: Accept leads to the consent screen saying why, and agreeing returns to compose with the typed prompt', async () => {
    await withLauncher({ prepare: keepStore, server: refusesAndLosesTerms }, async ({ tree, sent }) => {
      await composeAndContinue(tree, 'A tea timer');
      await waitFor(() => on(tree, TermsScreen), 'the terms step');
      await press(button(tree, COPY.termsAccept));
      h.ok(on(tree, ConsentScreen), 'the consent screen follows, though the local grant is current: the server refused it');
      h.ok(textOf(tree.root).includes(COPY.permissionRequiredLine), 'saying why it is back');
      await press(button(tree, COPY.consentAgree));
      h.ok(on(tree, ComposeStep), 'agreeing returns to compose');
      h.eq([tree.root.findByType(ComposeStep).props.text, tree.root.findByType(ComposeStep).props.notice], ['A tea timer', undefined], 'with the typed prompt and no stale notice');
      h.eq(sent.filter((r) => r.path === '/v1/clarify').length, 1, 'accepting and agreeing sent nothing by themselves');
    });
  });

  for (const language of ['en', 'fr'] as const) {
    for (const outdated of [false, true]) {
      await h.test(`terms step (${language}, ${outdated ? 'updated terms' : 'first acceptance'}): it says nothing about data`, async () => {
        const copy = LEGAL_COPY[language];
        const tree = await renderScreen(<TermsScreen language={language} onLanguageChange={() => {}} outdated={outdated} onAccept={() => {}} onClose={() => {}} />);
        try {
          const text = textOf(tree.root);
          h.ok(text.includes(copy.termsTitle) && text.includes(copy.termsAccept) && text.includes(copy.termsDecline), 'the step rendered its title and actions');
          h.ok(text.includes(outdated ? copy.termsUpdatedLine : copy.termsLead), 'and its lead or updated-terms line');
          h.eq(disclosureStrings(language).filter((line) => text.includes(line)), [], 'no consent disclosure line appears');
          h.eq(dataWords(text, language), [], 'no word about what is sent, to whom or why');
          h.ok(!text.includes(copy.privacyPolicyLabel), 'and no privacy policy link');
        } finally {
          await unmountScreen(tree);
        }
      });
    }
  }
}
