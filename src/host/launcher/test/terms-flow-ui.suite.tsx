/** The first-run sheet's two acts in the rendered launcher (design-system-v1 task 16.2; specs
 *  terms-acceptance and ai-data-consent): a data-sending action without a current acceptance or
 *  grant opens the sheet, whose terms row shows only when the terms aren't current, agreeing records
 *  each act that was due with its version, declining grants nothing, the send gate needs both
 *  records, reports need neither, and a `consent_required` refusal routes through the sheet without
 *  losing the typed prompt. */
import React from 'react';
import TestRenderer from 'react-test-renderer';
import { Harness } from './harness';
import HomeScreen from '../HomeScreen';
import { DescribePage } from '../DescribePage';
import { FirstRunSheet } from '../FirstRunSheet';
import HistoryScreen from '../HistoryScreen';
import MiniAppView from '../MiniAppView';
import { COPY, CONSENT_SCREEN_COVERAGE, CONSENT_WHATS_NEW, LEGAL_COPY } from '../copy';
import { consentStatus } from '../ai-consent';
import { AI_CONSENT_VERSION, TERMS_VERSION } from '../release-config';
import type { LegalLanguage } from '../legal-language';
import { RELEASE } from '../release-config';
import { LAYOUT } from '../../../design/tokens';
import { StoreAccess } from '../store-access';
import { termsStatus } from '../terms-acceptance';
import type { InstalledApp } from '../app-index';
import type { KVBackend } from '../../version-store/fs/kv-fs';
import { APP_BUNDLES } from '../../../runtime/generated/app-bundles';
import { consentRequiredRefusal } from '../../../../server/src/admission/refusals';
import { androidBack, button, press, renderScreen, textOf, unmountScreen, hostType } from './react-screen';
import { composeAndContinue, firstRunOpen, json, onHome, settle, tap, waitFor, wasSent, withLauncher, type SentRequest, type Tree } from './rendered-launcher';
import { Linking, Platform, StyleSheet, holdModalDismissals, injectedScripts, modalPresentations } from './native-host';

const TERMS_KEY = 'whim.terms:v1';
const CONSENT_KEY = 'whim.ai-consent:v1';
/** The consent grant exactly as the version-1 build stored it. */
const V1_GRANT = '{"version":1,"grantedAt":"2026-09-01T12:00:00.000Z"}';
const APP: InstalledApp = { id: 'timer', name: 'Timer', createdAt: 1, lineageId: 'main', record: { appId: 'timer', name: 'Timer', manifest: { capabilities: [] } } };

const on = (tree: Tree, type: Parameters<Tree['root']['findAllByType']>[0]) => tree.root.findAllByType(type).length === 1;
const home = (tree: Tree) => tree.root.findByType(HomeScreen);
/** The version a store wrote into its record under `key`, or undefined when it wrote none. */
function storedVersion(kv: KVBackend, key: string): number | undefined {
  const raw = kv.getString(key);
  return raw == null ? undefined : (JSON.parse(raw) as { version: number }).version;
}

/** The Tip Splitter example first-run seeding installs, once Home lists it. */
function tipSplitter(tree: Tree): InstalledApp | undefined {
  return home(tree).props.apps.find((a: InstalledApp) => a.name === 'Tip Splitter');
}

/** Let the running app's page finish loading, so the shell delivers its bundle. */
async function loadAppPage(tree: Tree): Promise<void> {
  await TestRenderer.act(async () => tree.root.find((node) => hostType(node) === 'WebView').props.onLoadEnd());
}

/** Home's composer row: the first data-sending action spec terms-acceptance names. */
async function describeAnApp(tree: Tree): Promise<void> {
  await TestRenderer.act(async () => home(tree).props.onCreate());
}

/** The new-app describe page is showing. */
function composingNewApp(tree: Tree): boolean {
  const describe = tree.root.findAllByType(DescribePage);
  return describe.length === 1 && describe[0].props.editing === undefined;
}

const isModal = (n: TestRenderer.ReactTestInstance) => hostType(n) === 'Modal';
/** Every modal host mounted: on screen, or hidden and not yet reported dismissed. */
const modalHosts = (tree: Tree) => tree.root.findAll(isModal);
/** How many modals the system has on screen. */
const modalCount = (tree: Tree) => modalHosts(tree).filter((modal) => modal.props.visible === true).length;
/** `type` is drawn inside a modal the system has on screen. */
const presented = (tree: Tree, type: Parameters<Tree['root']['findAllByType']>[0]) =>
  modalHosts(tree).some((modal) => modal.props.visible === true && modal.findAllByType(type).length > 0);
/** The first-run sheet is drawn in a modal the system has on screen. */
const firstRunPresented = (tree: Tree) => modalHosts(tree).some((modal) => modal.props.visible === true && textOf(modal).includes(COPY.consentDecline));
/** The first-run sheet that is open, if one is. */
const firstRun = (tree: Tree) => tree.root.findAllByType(FirstRunSheet).filter((sheet) => sheet.props.visible)[0];
const agree = (tree: Tree) => button(tree, COPY.consentAgree);
/** The action when only the terms are due. */
const proceed = (tree: Tree) => button(tree, COPY.firstRunContinue);
const termsRow = (tree: Tree) => button(tree, COPY.firstRunTermsCheck);

/** Answers clarify with no questions; nothing else is expected. */
const clarifyServer = (r: SentRequest): Response | Promise<Response> =>
  r.path === '/v1/clarify' ? json({ questions: [] }) : new Promise<Response>(() => {});

/** The server refusing a request for want of consent, as the real one does. */
const consentRefusedResponse = (): Response => {
  const refusal = consentRequiredRefusal();
  return new Response(JSON.stringify(refusal.body), { status: refusal.status, headers: { 'Content-Type': 'application/json', ...refusal.headers } });
};

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
  await h.test('first run: a fresh install’s first data-sending action opens the sheet; Agree waits for the terms, the Terms link does not tick the box, and Agree records both acts with their versions', async () => {
    await withLauncher({ terms: false, consent: false, server: clarifyServer }, async ({ tree, kv, sent, probes }) => {
      await describeAnApp(tree);
      h.ok(firstRunOpen(tree) && firstRun(tree).props.termsDue === true, 'the first-run sheet opens, with its terms row');
      h.eq(termsRow(tree).props.accessibilityState.checked, false, 'the box starts unticked');
      h.eq(agree(tree).props.disabled, true, 'Agree to send descriptions is disabled');
      await h.throws(() => press(agree(tree)), 'disabled', 'Agree cannot be pressed');
      h.eq([termsStatus(kv).kind, consentStatus(kv).kind], ['absent', 'absent'], 'a tap on the disabled Agree records nothing');
      const opened = Linking.opened.length;
      await press(button(tree, COPY.termsLabel));
      h.eq(Linking.opened.slice(opened), [RELEASE.termsUrl], 'the Terms link opens the English terms of use');
      h.eq([termsRow(tree).props.accessibilityState.checked, agree(tree).props.disabled], [false, true], 'and does not tick the box');
      h.eq(termsRow(tree).findAll((n) => n === button(tree, COPY.termsLabel)).length, 0, 'the link sits outside the row’s hit area');
      await press(termsRow(tree));
      h.eq([termsRow(tree).props.accessibilityState.checked, agree(tree).props.disabled], [true, false], 'ticking the box enables Agree');
      h.eq([sent.length, probes.length], [0, 0], 'nothing was sent yet, not even a connectivity probe');
      await press(agree(tree));
      const terms = termsStatus(kv);
      const consent = consentStatus(kv);
      h.ok(terms.kind === 'accepted' && terms.version === TERMS_VERSION, 'the terms are accepted at the current terms version');
      h.ok(consent.kind === 'granted' && consent.version === AI_CONSENT_VERSION, 'and consent is granted at the current consent version');
      h.ok(composingNewApp(tree), 'the describe page the user asked for opens');
      h.ok(!firstRunOpen(tree), 'with the sheet gone');
    });
  });

  await h.test('first run: Not now stores nothing, sends nothing, and installed apps keep working', async () => {
    await withLauncher({ examples: true, terms: false, consent: false, server: clarifyServer }, async ({ tree, kv, sent, probes }) => {
      await waitFor(() => on(tree, HomeScreen) && tipSplitter(tree) !== undefined, 'the example apps');
      await describeAnApp(tree);
      await press(termsRow(tree));
      await press(button(tree, COPY.consentDecline));
      h.ok(onHome(tree), 'declining returns to Home, where the action started');
      h.eq([termsStatus(kv).kind, consentStatus(kv).kind], ['absent', 'absent'], 'neither act is recorded, even with the box ticked');
      h.ok(kv.getString(TERMS_KEY) == null, 'no acceptance record is stored');
      h.eq([sent.length, probes.length], [0, 0], 'no request was sent');
      injectedScripts.length = 0;
      await TestRenderer.act(async () => home(tree).props.onOpen(tipSplitter(tree)));
      await waitFor(() => on(tree, MiniAppView), 'the example to open');
      await loadAppPage(tree);
      h.ok(injectedScripts.length === 1 && injectedScripts[0].includes(JSON.stringify(APP_BUNDLES['tip-splitter'])), 'an installed app still opens and runs');
    });
  });

  await h.test('first run: the sheet’s close, scrim and Android back are Not now as well', async () => {
    for (const exit of ['close', 'back'] as const) {
      await withLauncher({ terms: false, consent: false, server: clarifyServer }, async ({ tree, kv }) => {
        await describeAnApp(tree);
        if (exit === 'close') await press(button(tree, COPY.sheetClose));
        else await androidBack(tree);
        h.ok(onHome(tree), `${exit} returns to Home`);
        h.eq([termsStatus(kv).kind, consentStatus(kv).kind], ['absent', 'absent'], `${exit} records nothing`);
      });
    }
  });

  await h.test('first run: with the terms current, an outdated consent grant opens the sheet without a terms row — a consent bump never re-shows the terms', async () => {
    await withLauncher({ consent: false, prepare: (kv) => kv.set(CONSENT_KEY, V1_GRANT), server: clarifyServer }, async ({ tree, kv }) => {
      const before = kv.getString(TERMS_KEY);
      await describeAnApp(tree);
      h.ok(firstRunOpen(tree) && firstRun(tree).props.termsDue === false, 'the sheet shows no terms row');
      h.ok(textOf(tree.root).includes(COPY.consentOutdatedLine), 'saying consent changed');
      h.eq(agree(tree).props.disabled, false, 'and Agree is live at once');
      await press(agree(tree));
      h.ok(composingNewApp(tree), 'agreeing continues');
      h.eq([kv.getString(TERMS_KEY), consentStatus(kv).kind], [before, 'granted'], 'only the consent act was recorded; the terms record is untouched');
    });
  });

  await h.test('first run: an existing tester with a version-1 grant and no terms record sees one sheet with the terms row and what changed, then continues', async () => {
    const whatsNew = CONSENT_WHATS_NEW.en[1]?.text ?? '';
    h.ok(whatsNew.length > 0, 'English has a what’s-new line for version 1');
    await withLauncher({ terms: false, consent: false, prepare: (kv) => kv.set(CONSENT_KEY, V1_GRANT), server: clarifyServer }, async ({ tree, kv, sent }) => {
      await describeAnApp(tree);
      const text = textOf(tree.root);
      h.ok(firstRun(tree)?.props.termsDue === true && !text.includes(COPY.termsUpdatedLine), 'the terms row, as a first acceptance and not an update');
      h.ok(text.includes(COPY.consentOutdatedLine) && text.includes(whatsNew), 'with the outdated line and version 1’s what’s-new line');
      h.eq(sent.length, 0, 'nothing sent before agreeing');
      await press(termsRow(tree));
      await press(agree(tree));
      h.eq([termsStatus(kv).kind, consentStatus(kv).kind], ['accepted', 'granted'], 'both acts recorded');
      h.ok(composingNewApp(tree), 'agreeing continues the action');
    });
  });

  await h.test('first run: an acceptance of another terms version shows the updated-terms line, and Agree records the terms alone while consent is current', async () => {
    // The acceptance `withLauncher` stored, as a build shipping the next terms version finds it.
    const otherTerms = (kv: KVBackend) => {
      const stored = JSON.parse(kv.getString(TERMS_KEY) ?? 'null') as { version: number; acceptedAt: string };
      kv.set(TERMS_KEY, JSON.stringify({ ...stored, version: stored.version - 1 }));
    };
    await withLauncher({ prepare: otherTerms, server: clarifyServer }, async ({ tree, kv }) => {
      const grant = kv.getString(CONSENT_KEY);
      await describeAnApp(tree);
      h.ok(firstRun(tree)?.props.termsDue === true && textOf(tree.root).includes(COPY.termsUpdatedLine), 'the terms row, headed by the updated-terms line');
      h.eq(tree.root.findAll((n) => hostType(n) === 'Pressable' && n.props.accessibilityLabel === COPY.consentAgree).length, 0, 'the action does not ask to agree to send descriptions, which the person already has');
      h.eq(proceed(tree).props.disabled, true, 'it reads as continuing, and waits for the box');
      await press(termsRow(tree));
      await press(proceed(tree));
      h.ok(composingNewApp(tree), 'it goes straight to the action');
      h.eq([termsStatus(kv).kind, kv.getString(CONSENT_KEY)], ['accepted', grant], 'the terms were accepted again; the stored grant is byte for byte what it was');
    });
  });

  await h.test('terms gate: a current grant without terms sends nothing, not even a probe, until the terms are accepted', async () => {
    await withLauncher({ terms: false, server: clarifyServer }, async ({ tree, sent, probes }) => {
      h.eq(probes.length, 0, 'no connectivity probe at launch');
      await describeAnApp(tree);
      h.ok(firstRunOpen(tree) && firstRun(tree).props.termsDue, 'the data-sending action opens the sheet with its terms row');
      h.eq([sent.length, probes.length], [0, 0], 'nothing was sent');
      await press(termsRow(tree));
      await press(proceed(tree));
      h.ok(composingNewApp(tree), 'with the grant current, Agree continues straight to the describe page');
      await TestRenderer.act(async () => tree.root.findByType(DescribePage).props.onChangeText('A tea timer'));
      await tap(() => tree.root.findByType(DescribePage).props.onContinue());
      await waitFor(() => wasSent(sent, '/v1/clarify'), 'the clarify request');
      await waitFor(() => probes.length > 0, 'the connectivity probe');
    });
  });

  await h.test('terms gate: a report sent with neither record sends exactly that report, and no first-run sheet appears', async () => {
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
        h.ok(!firstRunOpen(tree), 'the first-run sheet did not appear');
      });
    } finally {
      Object.assign(StoreAccess.prototype, original);
    }
  });

  await h.test('first run: ticking the box alone records nothing — closing leaves no record and no request, and the box is unticked the next time the sheet opens', async () => {
    await withLauncher({ terms: false, consent: false, server: clarifyServer }, async ({ tree, kv, sent, probes }) => {
      await describeAnApp(tree);
      await press(termsRow(tree));
      h.eq(termsRow(tree).props.accessibilityState.checked, true, 'the box is ticked');
      h.eq([termsStatus(kv).kind, consentStatus(kv).kind, kv.getString(TERMS_KEY)], ['absent', 'absent', undefined], 'ticking recorded neither act');
      await press(button(tree, COPY.sheetClose));
      h.eq([termsStatus(kv).kind, consentStatus(kv).kind, sent.length, probes.length], ['absent', 'absent', 0, 0], 'closing records nothing and sends nothing');
      await describeAnApp(tree);
      h.eq(termsRow(tree).props.accessibilityState.checked, false, 'the next time the sheet opens the box is unticked');
      h.eq(agree(tree).props.disabled, true, 'and the action waits for it again');
    });
  });

  await h.test('first run: the first request leaves only after the action has recorded both acts, each under its own key and version', async () => {
    let held: KVBackend | undefined;
    let atFirstRequest: unknown;
    const watch = (r: SentRequest): Response | Promise<Response> => {
      atFirstRequest ??= held && [storedVersion(held, TERMS_KEY), storedVersion(held, CONSENT_KEY)];
      return clarifyServer(r);
    };
    await withLauncher({ terms: false, consent: false, prepare: (kv) => { held = kv; }, server: watch }, async ({ tree, kv, sent, probes }) => {
      await describeAnApp(tree);
      await press(termsRow(tree));
      h.eq([sent.length, probes.length], [0, 0], 'with the box ticked and the action not yet taken, nothing has left the phone');
      await press(agree(tree));
      h.eq(sent.length, 0, 'taking the action sends no request by itself');
      await TestRenderer.act(async () => tree.root.findByType(DescribePage).props.onChangeText('A tea timer'));
      await tap(() => tree.root.findByType(DescribePage).props.onContinue());
      await waitFor(() => wasSent(sent, '/v1/clarify'), 'the first request');
      h.eq(atFirstRequest, [TERMS_VERSION, AI_CONSENT_VERSION], 'when it left, both acts were already stored, each with its own version');
      h.ok(kv.getString(TERMS_KEY) != null && kv.getString(CONSENT_KEY) != null, 'under two keys');
    });
  });

  await h.test('first run: the terms link and the checkbox are two touch targets that do not overlap, each at least the platform’s minimum', async () => {
    const tree = await renderScreen(<FirstRunSheet visible language="en" onLanguageChange={() => {}} termsDue consentDue onAgree={() => {}} onClose={() => {}} />);
    try {
      const row = termsRow(tree);
      const link = button(tree, COPY.termsLabel);
      const style = (node: TestRenderer.ReactTestInstance) => StyleSheet.flatten(node.props.style) as { flex?: number; minWidth?: number; minHeight?: number };
      h.eq([row.props.hitSlop, link.props.hitSlop], [undefined, undefined], 'neither target reaches past its own box with a hit slop');
      const line = (node: TestRenderer.ReactTestInstance) => {
        let up = node.parent;
        while (up && hostType(up) !== 'View') up = up.parent;
        return up;
      };
      h.ok(line(row) != null && line(row) === line(link), 'they sit in one row');
      h.eq(line(row)!.findAll((n) => n === row || n === link), [row, link], 'the checkbox first, the link after it');
      h.eq((StyleSheet.flatten(line(row)!.props.style) as { flexDirection?: string }).flexDirection, 'row', 'side by side, so the two boxes share no pixel');
      h.ok(style(row).flex === 1, 'the checkbox takes what the link leaves');
      const touch = LAYOUT.touchTarget[Platform.OS === 'android' ? 'android' : 'ios'];
      h.ok((style(link).minWidth ?? 0) >= touch && (style(link).minHeight ?? 0) >= touch, `the link’s own box is at least ${touch} pt each way`);
      h.ok((style(row).minHeight ?? 0) >= touch, `and the checkbox row is at least ${touch} pt tall`);
    } finally {
      await unmountScreen(tree);
    }
  });

  for (const language of ['en', 'fr'] as const) {
    await h.test(`first run (${language}): the action agrees to send descriptions when consent is due and reads as continuing when only the terms are`, async () => {
      const copy = LEGAL_COPY[language];
      const render = (consentDue: boolean) => <FirstRunSheet visible language={language} onLanguageChange={() => {}} termsDue consentDue={consentDue} onAgree={() => {}} onClose={() => {}} />;
      const tree = await renderScreen(render(true));
      try {
        h.ok(button(tree, copy.consentAgree) != null, 'consent due: the agree action');
        await TestRenderer.act(async () => tree.update(render(false)));
        h.ok(button(tree, copy.firstRunContinue) != null, 'only the terms due: the continue action');
        h.ok(copy.firstRunContinue.trim() !== '' && copy.firstRunContinue !== copy.consentAgree, 'a plain word of its own, in this language');
        h.ok(!textOf(tree.root).includes(copy.consentAgree), 'and nowhere does the sheet ask to agree to send descriptions');
      } finally {
        await unmountScreen(tree);
      }
    });
  }

  await h.test('first run: agreeing hands over to the Describe sheet only after the first-run sheet has finished closing, so two modals never overlap', async () => {
    await withLauncher({ terms: false, consent: false, server: clarifyServer }, async ({ tree }) => {
      const refused = modalPresentations.refused;
      await describeAnApp(tree);
      h.eq(modalCount(tree), 1, 'the first-run sheet is the one modal up');
      await press(termsRow(tree));
      const release = holdModalDismissals();
      try {
        await press(agree(tree));
        h.eq([on(tree, DescribePage), modalCount(tree)], [false, 0], 'the first-run sheet has left, but the system has not said it is dismissed: Describe is not presented yet');
        await TestRenderer.act(async () => release());
        h.eq([composingNewApp(tree), presented(tree, DescribePage), modalCount(tree), modalHosts(tree).length], [true, true, 1, 1], 'once it has, Describe is presented, alone');
        h.eq(modalPresentations.refused - refused, 0, 'and the system refused no presentation on the way');
      } finally {
        release();
      }
    });
  });

  await h.test('first run: the sheet leaves reading as it did when the person agreed — its action and its notice do not change while it closes', async () => {
    await withLauncher({ terms: false, consent: false, prepare: (kv) => kv.set(CONSENT_KEY, V1_GRANT), server: clarifyServer }, async ({ tree, kv }) => {
      await describeAnApp(tree);
      await press(termsRow(tree));
      const release = holdModalDismissals();
      try {
        await press(agree(tree));
        h.eq([termsStatus(kv).kind, consentStatus(kv).kind], ['accepted', 'granted'], 'both acts are recorded, so the store now says nothing is due');
        const closing = modalHosts(tree).find((modal) => modal.props.visible === false);
        h.ok(closing !== undefined && textOf(closing).includes(COPY.firstRunTermsCheck), 'the first-run sheet is still drawn, on its way out');
        h.eq(closing!.findAll((n) => hostType(n) === 'Pressable' && n.props.accessibilityLabel === COPY.consentAgree).length, 1, 'its action still reads Agree to send descriptions');
        h.eq(closing!.findAll((n) => hostType(n) === 'Pressable' && n.props.accessibilityLabel === COPY.firstRunContinue).length, 0, 'and has not turned into Continue');
        h.ok(textOf(closing!).includes(COPY.consentOutdatedLine), 'and the line saying consent changed is still there');
      } finally {
        release();
      }
    });
  });

  await h.test('first run: if the system never reports the dismissal, Describe is presented anyway after a bounded wait, with no hidden modal left over the screen', async () => {
    await withLauncher({ terms: false, consent: false, server: clarifyServer }, async ({ tree, clock }) => {
      await describeAnApp(tree);
      await press(termsRow(tree));
      const release = holdModalDismissals();
      try {
        await press(agree(tree));
        h.eq([on(tree, DescribePage), modalHosts(tree).length], [false, 1], 'held while the dismissal is unreported: the first-run sheet’s hidden modal is still mounted');
        let fired = 0;
        await TestRenderer.act(async () => { fired = clock.fireWithin(1000); });
        h.ok(fired > 0, 'a wait of at most a second is running, and it is up');
        h.eq([composingNewApp(tree), presented(tree, DescribePage), modalHosts(tree).length], [true, true, 1], 'when the wait is up that modal is unmounted and Describe is presented');
      } finally {
        release();
      }
    });
  });

  await h.test('first run: a refusal that reopens the first-run sheet waits for the making sheet to finish closing', async () => {
    await withLauncher({ server: consentRefusedResponse }, async ({ tree }) => {
      const refused = modalPresentations.refused;
      const release = holdModalDismissals();
      try {
        await composeAndContinue(tree, 'A tea timer');
        await waitFor(() => firstRunOpen(tree), 'the refusal to ask for the first-run sheet');
        await settle();
        h.eq([firstRunPresented(tree), modalCount(tree)], [false, 0], 'the making sheet has left but is not reported dismissed: the first-run sheet is not presented yet');
        await TestRenderer.act(async () => release());
        await waitFor(() => firstRunPresented(tree), 'the first-run sheet once the making sheet is gone');
        h.eq([modalCount(tree), modalHosts(tree).length], [1, 1], 'alone');
        h.eq(modalPresentations.refused - refused, 0, 'and the system refused no presentation on the way');
      } finally {
        release();
      }
    });
  });

  // A `consent_required` refusal arriving after the terms record went missing (the request was
  // gated on it, so it can only vanish in between): the refusal routes through the sheet.
  let store: KVBackend | undefined;
  const refusesAndLosesTerms = (): Response => {
    store?.delete(TERMS_KEY);
    return consentRefusedResponse();
  };
  const keepStore = (kv: KVBackend) => { store = kv; };

  await h.test('consent_required without terms: the sheet shows the terms row and says why, and Not now returns to describe with the typed prompt', async () => {
    await withLauncher({ prepare: keepStore, server: refusesAndLosesTerms }, async ({ tree, kv }) => {
      await composeAndContinue(tree, 'A tea timer');
      await waitFor(() => firstRunOpen(tree), 'the first-run sheet');
      h.ok(firstRun(tree).props.termsDue === true && textOf(tree.root).includes(COPY.permissionRequiredLine), 'with its terms row, saying why it is back');
      await press(button(tree, COPY.consentDecline));
      h.ok(on(tree, DescribePage), 'Not now returns to describe');
      h.eq(tree.root.findByType(DescribePage).props.text, 'A tea timer', 'with the typed prompt');
      h.eq(termsStatus(kv).kind, 'absent', 'and accepts nothing');
    });
  });

  await h.test('consent_required without terms: Agree records both acts even though the local grant is current, and returns to describe with the typed prompt', async () => {
    await withLauncher({ prepare: keepStore, server: refusesAndLosesTerms }, async ({ tree, sent, kv }) => {
      await composeAndContinue(tree, 'A tea timer');
      await waitFor(() => firstRunOpen(tree), 'the first-run sheet');
      await press(termsRow(tree));
      await press(agree(tree));
      h.eq([termsStatus(kv).kind, consentStatus(kv).kind], ['accepted', 'granted'], 'the terms accepted and the grant renewed: the server refused the old one');
      h.ok(on(tree, DescribePage), 'agreeing returns to describe');
      h.eq([tree.root.findByType(DescribePage).props.text, tree.root.findByType(DescribePage).props.notice], ['A tea timer', undefined], 'with the typed prompt and no stale notice');
      h.eq(sent.filter((r) => r.path === '/v1/clarify').length, 1, 'accepting and agreeing sent nothing by themselves');
    });
  });

  for (const language of ['en', 'fr'] as const) {
    await h.test(`first run (${language}): the terms row and its link say nothing about data`, async () => {
      const copy = LEGAL_COPY[language];
      const tree = await renderScreen(<FirstRunSheet visible language={language} onLanguageChange={() => {}} termsDue consentDue onAgree={() => {}} onClose={() => {}} />);
      try {
        const row = textOf(button(tree, copy.firstRunTermsCheck));
        h.ok(row === copy.firstRunTermsCheck, 'the checkbox row carries the terms line');
        h.eq(dataWords(`${copy.firstRunTermsCheck} ${copy.termsLabel}`, language), [], 'no word about what is sent, to whom or why');
        h.eq(disclosureStrings(language).filter((line) => line.includes(copy.firstRunTermsCheck)), [], 'and the disclosure does not carry it');
      } finally {
        await unmountScreen(tree);
      }
    });
  }
}
