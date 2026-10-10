/** The legal language in the rendered launcher (legal-surface-v2 task 6.2; spec
 *  legal-text-localization "Legal text is French first on a French-language phone, with an
 *  express choice of English"): a French phone gets the terms step and the consent screen in
 *  French, each with a one-tap switch to English; the switch's choice is kept, across a restart
 *  too; an English phone gets English with a switch to French; and every legal link — the terms
 *  step's, the consent screen's and Settings' — opens the page in the active language. */
import React from 'react';
import TestRenderer from 'react-test-renderer';
import { Harness } from './harness';
import HomeScreen from '../HomeScreen';
import { DescribePage } from '../DescribePage';
import ConsentScreen from '../ConsentScreen';
import { FirstRunSheet } from '../FirstRunSheet';
import SettingsScreen from '../SettingsScreen';
import LauncherRoot from '../LauncherRoot';
import { COPY, CONSENT_SCREEN_COVERAGE, CONSENT_WHATS_NEW, LEGAL_COPY, type LegalCopyTable } from '../copy';
import { RELEASE } from '../release-config';
import { button, press, renderScreen, textOf, unmountScreen } from './react-screen';
import { json, withLauncher, type SentRequest, type Tree } from './rendered-launcher';
import { Linking } from './native-host';
import { testAppInfo } from './client-fixtures';

const FR = LEGAL_COPY.fr;
/** The switch labels, as the spec words them. */
const TO_ENGLISH = 'Continue in English';
const TO_FRENCH = 'Continuer en français';
const CONSENT_KEY = 'whim.ai-consent:v1';
const V1_GRANT = '{"version":1,"grantedAt":"2026-09-01T12:00:00.000Z"}';

const clarifyServer = (r: SentRequest): Response | Promise<Response> =>
  r.path === '/v1/clarify' ? json({ questions: [] }) : new Promise<Response>(() => {});

const on = (tree: Tree, type: Parameters<Tree['root']['findAllByType']>[0]) => tree.root.findAllByType(type).length === 1;

/** Home's composer row: the first data-sending action. */
async function describeAnApp(tree: Tree): Promise<void> {
  await TestRenderer.act(async () => tree.root.findByType(HomeScreen).props.onCreate());
}

async function openSettings(tree: Tree): Promise<void> {
  await TestRenderer.act(async () => tree.root.findByType(HomeScreen).props.onSettings());
}

/** Settings → the AI features row: the consent screen in review mode. */
async function reviewConsentFromSettings(tree: Tree): Promise<void> {
  await openSettings(tree);
  await TestRenderer.act(async () => tree.root.findByType(SettingsScreen).props.onOpenAIFeatures());
}

/** The URLs pressing `label` opened. */
async function opens(tree: Tree, label: string): Promise<string[]> {
  const before = Linking.opened.length;
  await press(button(tree, label));
  return Linking.opened.slice(before);
}

/** Every disclosure line that names a manifest category or role, in `table`. */
function coveredLines(table: LegalCopyTable): string[] {
  return [...Object.values(CONSENT_SCREEN_COVERAGE.categories), ...Object.values(CONSENT_SCREEN_COVERAGE.roles)].flat().map((key) => table[key]);
}

/** The sheet shows `table`'s terms row and none of `other`'s. */
function termsIn(text: string, table: LegalCopyTable, other: LegalCopyTable): boolean {
  return text.includes(table.firstRunTermsCheck) && !text.includes(other.firstRunTermsCheck);
}

/** The Language row, whose value is the one-tap switch to the other language. */
const languageRow = (tree: Tree, table: LegalCopyTable) => button(tree, `${table.firstRunLanguage}, ${table.legalLanguageSwitch}`);

/** Ticks the terms and agrees on the first-run sheet. */
async function acceptAndAgree(tree: Tree, table: LegalCopyTable): Promise<void> {
  await press(button(tree, table.firstRunTermsCheck));
  await press(button(tree, table.consentAgree));
}

/** The screen shows `table`'s consent disclosure and none of `other`'s covered lines. */
function consentIn(text: string, table: LegalCopyTable, other: LegalCopyTable): boolean {
  return (
    text.includes(table.consentTitle) &&
    text.includes(table.consentLead) &&
    coveredLines(table).every((line) => text.includes(line)) &&
    coveredLines(other).every((line) => !text.includes(line))
  );
}

export async function runLegalLanguageUiTests(h: Harness): Promise<void> {
  await h.test('legal language: a fr-CA phone sees the first-run sheet in French, with its terms row, its disclosure and a "Continue in English" switch', async () => {
    await withLauncher({ terms: false, consent: false, locale: 'fr-CA', server: clarifyServer }, async ({ tree }) => {
      await describeAnApp(tree);
      h.ok(on(tree, FirstRunSheet) && termsIn(textOf(tree.root), FR, COPY), 'the sheet renders in French, with the terms row');
      h.ok(textOf(languageRow(tree, FR)).includes(TO_ENGLISH), 'the Language row carries a "Continue in English" switch');
      h.eq(await opens(tree, FR.termsLabel), [RELEASE.termsUrlFr], 'the terms link opens /fr/terms');
      h.eq(await opens(tree, FR.privacyPolicyLabel), [RELEASE.privacyPolicyUrlFr], 'the privacy row opens /fr/privacy');
      await press(button(tree, FR.firstRunDetails));
      h.ok(consentIn(textOf(tree.root), FR, COPY), 'and Full details shows the French disclosure');
      await acceptAndAgree(tree, FR);
      h.ok(on(tree, DescribePage), 'agreeing in French continues the action');
    });
  });

  await h.test('legal language: choosing English is remembered — after a restart, the consent screen from Settings is English and opens /privacy', async () => {
    await withLauncher({ terms: false, consent: false, locale: 'fr-CA', server: clarifyServer }, async ({ tree }) => {
      await describeAnApp(tree);
      await press(languageRow(tree, FR));
      h.ok(termsIn(textOf(tree.root), COPY, FR), 'the sheet switches to English in place');
      h.ok(textOf(languageRow(tree, COPY)).includes(TO_FRENCH), 'now offering French');
      await press(button(tree, COPY.firstRunDetails));
      h.ok(consentIn(textOf(tree.root), COPY, FR), 'the disclosure is English too');
      await acceptAndAgree(tree, COPY);
      await unmountScreen(tree);
      const restarted = await renderScreen(<LauncherRoot appInfo={testAppInfo} deviceLocale={() => 'fr-CA'} />);
      try {
        await reviewConsentFromSettings(restarted);
        h.ok(on(restarted, ConsentScreen) && consentIn(textOf(restarted.root), COPY, FR), 'the fr-CA phone still gets the consent screen in English');
        const before = Linking.opened.length;
        await press(restarted.root.findByType(ConsentScreen).find((node) => String(node.type) === 'TouchableOpacity' && textOf(node) === COPY.privacyPolicyLabel));
        h.eq(Linking.opened.slice(before), [RELEASE.privacyPolicyUrl], 'and its privacy link opens /privacy');
      } finally {
        await unmountScreen(restarted);
      }
    });
  });

  await h.test('legal language: an en-US phone sees the sheet in English with "Continuer en français", which switches and is kept', async () => {
    await withLauncher({ terms: false, consent: false, locale: 'en-US', server: clarifyServer }, async ({ tree }) => {
      await describeAnApp(tree);
      h.ok(on(tree, FirstRunSheet) && termsIn(textOf(tree.root), COPY, FR), 'the sheet renders in English');
      h.ok(!textOf(tree.root).includes(TO_ENGLISH), 'with no switch to the language already shown');
      h.eq(await opens(tree, COPY.termsLabel), [RELEASE.termsUrl], 'its terms link opens /terms');
      await press(languageRow(tree, COPY));
      h.ok(termsIn(textOf(tree.root), FR, COPY), '"Continuer en français" switches the sheet to French');
      await press(button(tree, FR.firstRunDetails));
      h.ok(consentIn(textOf(tree.root), FR, COPY), 'and its disclosure');
    });
  });

  await h.test('legal language: on a French phone, an outdated version-1 grant shows the French outdated and what’s-new lines', async () => {
    const whatsNew = CONSENT_WHATS_NEW.fr[1]?.text ?? '';
    h.ok(whatsNew.length > 0 && whatsNew !== CONSENT_WHATS_NEW.en[1]?.text, 'French has its own what’s-new line for version 1');
    await withLauncher({ consent: false, locale: 'fr-CA', prepare: (kv) => kv.set(CONSENT_KEY, V1_GRANT), server: clarifyServer }, async ({ tree }) => {
      await describeAnApp(tree);
      const text = textOf(tree.root);
      const [outdatedAt, whatsNewAt, titleAt] = [text.indexOf(FR.consentOutdatedLine), text.indexOf(whatsNew), text.indexOf(FR.consentTitle)];
      h.ok(outdatedAt >= 0 && whatsNewAt > outdatedAt && titleAt > whatsNewAt, 'the French outdated line, then the French what’s-new line, above the French title');
    });
  });

  await h.test('legal language: Settings’ privacy and terms rows open the pages in the active language', async () => {
    await withLauncher({ locale: 'fr-CA', server: clarifyServer }, async ({ tree }) => {
      await openSettings(tree);
      h.eq(await opens(tree, COPY.privacyPolicyLabel), [RELEASE.privacyPolicyUrlFr], 'a French phone’s privacy row opens /fr/privacy');
      h.eq(await opens(tree, COPY.termsOfUseLabel), [RELEASE.termsUrlFr], 'and its terms row opens /fr/terms');
    });
    await withLauncher({ locale: 'fr-CA', prepare: (kv) => kv.set('whim.legal-language:v1', 'en'), server: clarifyServer }, async ({ tree }) => {
      await openSettings(tree);
      h.eq(await opens(tree, COPY.privacyPolicyLabel), [RELEASE.privacyPolicyUrl], 'with English chosen, the privacy row opens /privacy');
      h.eq(await opens(tree, COPY.termsOfUseLabel), [RELEASE.termsUrl], 'and the terms row opens /terms');
    });
  });
}
