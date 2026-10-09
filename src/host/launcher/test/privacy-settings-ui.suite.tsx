/** Settings' privacy controls and sections in the rendered launcher (legal-surface-v2 tasks
 *  5.1–5.3; specs privacy-settings and app-launcher): the "Send error details" switch, this phone's
 *  ID and "Make a new ID", the user's own server behind its acknowledgement (beta-1 D20), the
 *  section order, and "Turn on AI features" showing each legal screen at most once and never
 *  granting without a terms record (beta-1 D6). */
import React from 'react';
import TestRenderer from 'react-test-renderer';
import { Harness } from './harness';
import HomeScreen from '../HomeScreen';
import SettingsScreen from '../SettingsScreen';
import ConsentScreen from '../ConsentScreen';
import TermsScreen from '../TermsScreen';
import AgeScreen from '../AgeScreen';
import ConfirmSheet from '../ConfirmSheet';
import LauncherRoot from '../LauncherRoot';
import HistoryScreen from '../HistoryScreen';
import BuildStep from '../BuildStep';
import { AppIndex, type InstalledApp } from '../app-index';
import { COPY, LEGAL_COPY } from '../copy';
import { consentStatus, grantConsent } from '../ai-consent';
import { termsStatus } from '../terms-acceptance';
import { getDeviceId } from '../device-id';
import { errorDetailsEnabled } from '../error-details';
import { RELEASE, TERMS_VERSION } from '../release-config';
import { loadServerUrl, saveServerUrl } from '../server-address';
import { StoreAccess } from '../store-access';
import type { KVBackend } from '../../version-store/fs/kv-fs';
import { activate, button, press, renderScreen, screenReaderElement, textOf, unmountScreen, hostType } from './react-screen';
import { buildIt, composeAndContinue, json, planLoaded, sseStream, waitFor, wasSent, withLauncher, type SentRequest, type Tree } from './rendered-launcher';
import { Alert } from './native-host';
import { testAppInfo } from './client-fixtures';

const APP: InstalledApp = { id: 'timer', name: 'Timer', createdAt: 1, lineageId: 'main', record: { appId: 'timer', name: 'Timer', manifest: { capabilities: [] } } };
const OVERRIDE = 'https://lan.example:8787';
/** A server on the user's own network: plain http, allowed for an IP literal. */
// eslint-disable-next-line sonarjs/no-clear-text-protocols -- a LAN server over plain http is the case under test; the test's fetch stub answers it
const LAN = 'http://192.168.1.20:8787';
/** A public IP literal over plain http: refused, since it isn't on the user's own network. */
// eslint-disable-next-line sonarjs/no-clear-text-protocols -- the refused address under test; nothing is sent to it
const PUBLIC_IP = 'http://8.8.8.8';

/** Answers clarify with no questions; nothing else is expected. */
const clarifyServer = (r: SentRequest): Response | Promise<Response> =>
  r.path === '/v1/clarify' ? json({ questions: [] }) : new Promise<Response>(() => {});

const on = (tree: Tree, type: Parameters<Tree['root']['findAllByType']>[0]) => tree.root.findAllByType(type).length === 1;
const settings = (tree: Tree) => tree.root.findByType(SettingsScreen);

/** Which screen shows: Settings, a legal step, or the consent screen and its mode. */
function shownScreen(tree: Tree): string {
  if (on(tree, SettingsScreen)) return 'settings';
  if (on(tree, AgeScreen)) return 'age';
  if (on(tree, TermsScreen)) return 'terms';
  if (on(tree, ConsentScreen)) return `consent:${tree.root.findByType(ConsentScreen).props.mode}`;
  return 'another screen';
}

/** A terms acceptance for the version before the current one, as an earlier build left it. */
const olderTerms = (kv: KVBackend) =>
  kv.set('whim.terms:v1', JSON.stringify({ version: TERMS_VERSION - 1, acceptedAt: '2026-01-01T00:00:00.000Z' }));

/** An allowed age check made just now, so no check is due. */
const freshAgeCheck = (kv: KVBackend) =>
  kv.set('whim.age-check:v1', JSON.stringify({ outcome: 'allowed', checkedAt: new Date().toISOString() }));

async function openSettings(tree: Tree): Promise<void> {
  await TestRenderer.act(async () => tree.root.findByType(HomeScreen).props.onSettings());
}

async function leaveSettings(tree: Tree): Promise<void> {
  await TestRenderer.act(async () => settings(tree).props.onBack());
}

/** The ID Settings shows: the one selectable text on the screen. */
function shownDeviceId(tree: Tree): string {
  const selectable = tree.root.findAll((node) => hostType(node) === 'Text' && node.props.selectable === true);
  if (selectable.length !== 1) throw new Error(`expected one selectable text, got ${selectable.length}`);
  return textOf(selectable[0]);
}

function errorDetailsSwitch(tree: Tree): TestRenderer.ReactTestInstance {
  return tree.root.find((node) => hostType(node) === 'Switch' && node.props.accessibilityLabel === COPY.settingsErrorDetailsTitle);
}

/** Opens the confirm step: the launcher's own confirm sheet, never a system alert. Returns what the
 *  sheet shows, and its two controls. */
async function openMakeNewId(tree: Tree) {
  const alerts = Alert.shown.length;
  await press(button(tree, COPY.settingsDeviceIdReset));
  if (Alert.shown.length !== alerts) throw new Error('"Make a new ID" raised a system alert');
  const sheet = tree.root.find((node) => String(node.type) === 'Modal');
  const control = (label: string) => sheet.find((node) => String(node.type) === 'TouchableOpacity' && textOf(node) === label);
  return { modal: sheet, text: textOf(sheet), cancel: control(COPY.cancel), confirm: control(COPY.settingsDeviceIdReset) };
}

/** Answers clarify with no questions, rewrite with an empty plan, a report as accepted, and a
 *  generation with a stream that stays open. */
const ownServer = (r: SentRequest): Response | Promise<Response> => {
  if (r.path === '/v1/clarify') return json({ questions: [] });
  if (r.path === '/v1/rewrite') return json({ rewrittenPrompt: String(r.body?.prompt), plan: [] });
  if (r.path === '/v1/report') return json({ reportId: 'r-1' }, 202);
  return sseStream(r.signal).response;
};

const addressFields = (tree: Tree) => tree.root.findAll((node) => hostType(node) === 'TextInput');

async function openAdvanced(tree: Tree): Promise<void> {
  await press(button(tree, COPY.settingsAdvancedSectionTitle));
}

/** Takes "Use your own server" and returns what the confirm sheet shows, and its two controls. */
async function openOwnServerSheet(tree: Tree, copy = LEGAL_COPY.en) {
  await press(button(tree, copy.ownServerAction));
  const sheet = tree.root.find((node) => String(node.type) === 'Modal');
  const control = (label: string) => sheet.find((node) => String(node.type) === 'TouchableOpacity' && textOf(node) === label);
  return { text: textOf(sheet), cancel: control(COPY.cancel), confirm: control(copy.ownServerConfirm) };
}

/** Types an address into the field and submits it, which settles its save at once. */
async function typeAddress(tree: Tree, address: string): Promise<void> {
  const [field] = addressFields(tree);
  await TestRenderer.act(async () => field.props.onChangeText(address));
  await TestRenderer.act(async () => addressFields(tree)[0].props.onSubmitEditing());
}

/** Home → compose → Continue, until the plan has loaded. */
async function composeToPlan(tree: Tree): Promise<void> {
  await composeAndContinue(tree, 'a timer');
  await waitFor(() => planLoaded(tree), 'the plan');
}

const flatStyle = (node: TestRenderer.ReactTestInstance) => Object.assign({}, ...[node.props.style].flat(Infinity)) as { height?: number; backgroundColor?: string; paddingBottom?: number };

/** Home → compose → Continue, and the `x-whim-device` header the clarify request carried. */
async function headerOfNextRequest(tree: Tree, sent: SentRequest[]): Promise<string | null> {
  const before = sent.length;
  await composeAndContinue(tree, 'a timer');
  const request = sent.slice(before).find((r) => r.path === '/v1/clarify');
  if (!request) throw new Error('no clarify request was sent');
  return request.headers.get('x-whim-device');
}

export async function runPrivacySettingsUiTests(h: Harness): Promise<void> {
  // ── privacy-settings "Settings carries a 'Send error details' switch, on by default" ────────

  await h.test('error details: never set, the module reports on and the Settings switch reads on, under its hint', async () => {
    await withLauncher({ server: clarifyServer }, async ({ tree, kv }) => {
      h.ok(errorDetailsEnabled(kv), 'the module reports on');
      await openSettings(tree);
      h.eq(errorDetailsSwitch(tree).props.value, true, 'the switch reads on');
      h.ok(textOf(tree.root).includes(COPY.settingsErrorDetailsHint), 'with the hint from the copy table');
    });
  });

  await h.test('error details: a missing or unreadable value means on', () => {
    const throwing: KVBackend = { getString: () => { throw new Error('storage unavailable'); }, set: () => {}, delete: () => {}, getAllKeys: () => [] };
    h.ok(errorDetailsEnabled(throwing), 'a read that throws means on');
    const garbled: KVBackend = { getString: () => 'maybe', set: () => {}, delete: () => {}, getAllKeys: () => [] };
    h.ok(errorDetailsEnabled(garbled), 'a value that is not the off marker means on');
  });

  await h.test('error details: turning the switch off takes effect at once and survives a restart', async () => {
    await withLauncher({ server: clarifyServer }, async ({ tree, kv }) => {
      await openSettings(tree);
      await TestRenderer.act(async () => errorDetailsSwitch(tree).props.onValueChange(false));
      h.eq(errorDetailsEnabled(kv), false, 'the module reports off before any next upload decision');
      h.eq(errorDetailsSwitch(tree).props.value, false, 'the switch reads off');
      await unmountScreen(tree);
      const restarted = await renderScreen(<LauncherRoot appInfo={testAppInfo} deviceLocale={() => 'en-US'} />);
      try {
        await openSettings(restarted);
        h.eq(errorDetailsEnabled(kv), false, 'after a restart the module still reports off');
        h.eq(errorDetailsSwitch(restarted).props.value, false, 'and the switch still reads off');
      } finally {
        await unmountScreen(restarted);
      }
    });
  });

  // ── privacy-settings "Settings shows this phone's ID and can make a new one" ─────────────────

  await h.test('phone ID: the ID Settings shows, under its hint, is the x-whim-device header of the next build request', async () => {
    await withLauncher({ server: clarifyServer }, async ({ tree, sent }) => {
      await openSettings(tree);
      const shown = shownDeviceId(tree);
      h.ok(shown.length > 0, 'an ID is shown');
      h.ok(textOf(tree.root).includes(COPY.settingsDeviceIdHint), 'with the hint to include it when asking about one’s data');
      await leaveSettings(tree);
      h.eq(await headerOfNextRequest(tree, sent), shown, 'the header equals the ID shown');
    });
  });

  await h.test('phone ID: confirming "Make a new ID" shows a different ID, persists it, the next request carries it, and consent, terms and apps stay', async () => {
    await withLauncher({ apps: [APP], server: clarifyServer }, async ({ tree, kv, sent }) => {
      await openSettings(tree);
      const before = shownDeviceId(tree);
      const sheet = await openMakeNewId(tree);
      h.ok(sheet.text.includes(COPY.settingsDeviceIdResetConfirm), 'the confirm step says how long old records are kept');
      h.eq(shownDeviceId(tree), before, 'nothing changes until the user confirms');
      await press(sheet.confirm);
      const after = shownDeviceId(tree);
      h.ok(after !== before, 'Settings shows a different ID');
      h.eq(getDeviceId(kv), after, 'the new ID is the stored one, so a restart keeps it');
      h.eq(consentStatus(kv).kind, 'granted', 'consent stays granted');
      h.eq(termsStatus(kv).kind, 'accepted', 'the terms acceptance stays');
      h.eq(new AppIndex(kv).list().map((app) => app.id), [APP.id], 'installed apps stay');
      await leaveSettings(tree);
      h.eq(await headerOfNextRequest(tree, sent), after, 'the next request carries the new ID');
    });
  });

  await h.test('phone ID: cancelling the confirm step keeps the stored ID', async () => {
    await withLauncher({ server: clarifyServer }, async ({ tree, kv }) => {
      await openSettings(tree);
      const before = shownDeviceId(tree);
      const sheet = await openMakeNewId(tree);
      await press(sheet.cancel);
      h.eq(getDeviceId(kv), before, 'the stored ID is unchanged');
      h.eq(shownDeviceId(tree), before, 'and Settings shows the same ID');
      h.eq(tree.root.findAll((node) => String(node.type) === 'Modal').length, 0, 'and the sheet is gone');
    });
  });

  await h.test('phone ID: to VoiceOver the confirm step is two labelled buttons, activating "Make a new ID" makes one rather than cancelling, and a tap on the dim still cancels', async () => {
    await withLauncher({ server: clarifyServer }, async ({ tree, kv }) => {
      await openSettings(tree);
      const before = shownDeviceId(tree);
      let sheet = await openMakeNewId(tree);
      for (const [label, control] of [[COPY.cancel, sheet.cancel], [COPY.settingsDeviceIdReset, sheet.confirm]] as const) {
        h.ok(screenReaderElement(control) === control, `"${label}" is an element of its own, not read as part of one around it`);
        h.eq([control.props.accessibilityRole, control.props.accessibilityLabel], ['button', label], `"${label}" is announced as a button, in its own words`);
      }
      await activate(sheet.confirm);
      const made = shownDeviceId(tree);
      h.ok(made !== before && getDeviceId(kv) === made, 'activating "Make a new ID" makes and stores a new ID');
      sheet = await openMakeNewId(tree);
      const dim = sheet.modal.findAll((node) => ['Pressable', 'TouchableOpacity'].includes(String(node.type)) && textOf(node) === '');
      h.eq(dim.length, 1, 'behind the card, the dim is one touchable with no words of its own');
      await press(dim[0]);
      h.eq([tree.root.findAll((node) => String(node.type) === 'Modal').length, getDeviceId(kv)], [0, made], 'a tap on the dim closes the sheet and keeps the ID');
    });
  });

  await h.test('phone ID: "Make a new ID" asks in the confirm sheet History asks in, on either platform: Cancel the large button, the new ID plain text beneath it', async () => {
    await withLauncher({ apps: [APP], server: clarifyServer }, async ({ tree }) => {
      await openSettings(tree);
      const sheet = await openMakeNewId(tree);
      h.eq(tree.root.findAllByType(ConfirmSheet).filter((open) => open.props.confirm != null).length, 1, 'the launcher’s own confirm sheet, not a system alert');
      const [cancel, confirm] = [flatStyle(sheet.cancel), flatStyle(sheet.confirm)];
      h.ok((cancel.height ?? 0) > (confirm.height ?? 0) && cancel.backgroundColor !== undefined && confirm.backgroundColor === undefined, 'the safe Cancel is the large filled button; making a new ID is plain text under it');
    });
  });

  await h.test('phone ID: the confirmation window dims through both system bars and leaves its controls above the bottom safe area', async () => {
    await withLauncher({ apps: [APP], server: clarifyServer }, async ({ tree }) => {
      await openSettings(tree);
      const sheet = await openMakeNewId(tree);
      h.ok(sheet.modal.props.statusBarTranslucent === true && sheet.modal.props.navigationBarTranslucent === true, 'the dim uses the modal window through both system bars');
      const cards = sheet.modal.findAll((node) => hostType(node) === 'View' && (flatStyle(node).paddingBottom ?? 0) > 30);
      h.eq(cards.length, 1, 'the card leaves room below its last control for the bottom safe area');
    });
  });

  // ── app-launcher "The Settings screen persists a server address…" / "Settings groups its
  //    controls into titled sections…" ─────────────────────────────────────────────────────────

  await h.test('own server: an address an earlier build saved stays unread until acknowledged — Advanced closed, no field, every request to the compiled-in server', async () => {
    await withLauncher({ prepare: (kv) => saveServerUrl(kv, OVERRIDE), server: clarifyServer }, async ({ tree, sent }) => {
      await openSettings(tree);
      const text = textOf(tree.root);
      for (const title of [COPY.settingsAISectionTitle, COPY.highlightingSectionTitle, COPY.settingsAboutSectionTitle, COPY.settingsAdvancedSectionTitle]) {
        h.ok(text.includes(title), `the ${title} section is visible`);
      }
      h.eq(addressFields(tree).length, 0, 'Advanced starts collapsed: the saved address does not open it');
      await openAdvanced(tree);
      h.eq(addressFields(tree).length, 0, 'opened, Advanced shows no address field');
      h.ok(textOf(tree.root).includes(LEGAL_COPY.en.ownServerAction), 'only the "Use your own server" action');
      await leaveSettings(tree);
      await composeAndContinue(tree, 'a timer');
      h.ok(sent.length > 0 && sent.every((r) => r.url.startsWith(`${RELEASE.serverUrl}/`)), `every request targets ${RELEASE.serverUrl} (got ${sent.map((r) => r.url).join(', ')})`);
    });
  });

  await h.test('own server: the confirm step says what that server gets and that the policy does not cover it; Cancel leaves no field and no override', async () => {
    await withLauncher({ prepare: (kv) => saveServerUrl(kv, OVERRIDE), server: clarifyServer }, async ({ tree, sent }) => {
      await openSettings(tree);
      await openAdvanced(tree);
      const sheet = await openOwnServerSheet(tree);
      h.ok(sheet.text.includes(LEGAL_COPY.en.ownServerConfirmBody), 'the sheet carries the acknowledgement text');
      await press(sheet.cancel);
      h.eq(tree.root.findAll((node) => String(node.type) === 'Modal').length, 0, 'the sheet is gone');
      h.eq(addressFields(tree).length, 0, 'no address field');
      await leaveSettings(tree);
      await composeAndContinue(tree, 'a timer');
      h.ok(sent.length > 0 && sent.every((r) => r.url.startsWith(`${RELEASE.serverUrl}/`)), `no override: every request targets ${RELEASE.serverUrl} (got ${sent.map((r) => r.url).join(', ')})`);
    });
  });

  await h.test('own server: confirming shows the field; a LAN http:// address typed there gets clarify, rewrite, generate and report, under the responsibility caption', async () => {
    const { timeline, activeId, activeDescription, activeSource } = StoreAccess.prototype;
    const original = { timeline, activeId, activeDescription, activeSource };
    StoreAccess.prototype.timeline = async () => [];
    StoreAccess.prototype.activeId = async () => null;
    StoreAccess.prototype.activeDescription = async () => 'A tea timer';
    StoreAccess.prototype.activeSource = async () => 'export default {}';
    try {
      await withLauncher({ apps: [APP], server: ownServer }, async ({ tree, sent }) => {
        await openSettings(tree);
        await openAdvanced(tree);
        await press((await openOwnServerSheet(tree)).confirm);
        h.eq(addressFields(tree).map((field) => field.props.value), [''], 'the empty address field shows');
        h.ok(!textOf(tree.root).includes(LEGAL_COPY.en.ownServerCaption), 'no caption while no override is saved');
        await typeAddress(tree, LAN);
        h.ok(textOf(tree.root).includes(LEGAL_COPY.en.ownServerCaption), 'the saved override carries the responsibility caption');
        await leaveSettings(tree);
        await composeToPlan(tree);
        await buildIt(tree);
        await waitFor(() => wasSent(sent, '/v1/generate'), 'the generate request');
        await TestRenderer.act(async () => tree.root.findByType(BuildStep).props.onBack());
        await TestRenderer.act(async () => tree.root.findByType(HomeScreen).props.onHistory(APP));
        await TestRenderer.act(async () => tree.root.findByType(HistoryScreen).props.onReport());
        await waitFor(() => textOf(tree.root).includes(COPY.reportReasonBroken), 'the report draft');
        await press(button(tree, COPY.reportReasonBroken));
        await press(button(tree, COPY.reportSend));
        await waitFor(() => wasSent(sent, '/v1/report'), 'the report request');
        h.eq(sent.map((r) => r.url), ['/v1/clarify', '/v1/rewrite', '/v1/generate', '/v1/report'].map((path) => LAN + path), 'every request targets the typed address');
      });
    } finally {
      Object.assign(StoreAccess.prototype, original);
    }
  });

  await h.test('own server: http:// to a public host or a public IP is refused inline and not saved; a LAN address then saves and clears the note', async () => {
    await withLauncher({ server: clarifyServer }, async ({ tree, kv, sent }) => {
      await openSettings(tree);
      await openAdvanced(tree);
      await press((await openOwnServerSheet(tree)).confirm);
      for (const refused of ['http://example.com', PUBLIC_IP]) {
        await typeAddress(tree, refused);
        h.ok(textOf(tree.root).includes(COPY.serverAddressRefused), `${refused}: the refusal is explained under the field`);
        h.eq(loadServerUrl(kv), undefined, `${refused}: nothing was saved`);
      }
      await typeAddress(tree, LAN);
      h.ok(!textOf(tree.root).includes(COPY.serverAddressRefused), 'an allowed address clears the note');
      h.eq(loadServerUrl(kv), LAN, 'and is saved');
      await typeAddress(tree, 'http://example.com');
      await leaveSettings(tree);
      h.eq(loadServerUrl(kv), LAN, 'leaving with a refused draft keeps the saved address');
      await composeAndContinue(tree, 'a timer');
      h.ok(sent.length > 0 && sent.every((r) => r.url.startsWith(`${LAN}/`)), `requests target the saved LAN address, never the refused one (got ${sent.map((r) => r.url).join(', ')})`);
    });
  });

  await h.test('own server: "Use Whim’s server" clears the address and keeps the acknowledgement, across a restart', async () => {
    await withLauncher({ server: clarifyServer }, async ({ tree, kv, sent }) => {
      await openSettings(tree);
      await openAdvanced(tree);
      await press((await openOwnServerSheet(tree)).confirm);
      await typeAddress(tree, LAN);
      await unmountScreen(tree);
      const restarted = await renderScreen(<LauncherRoot appInfo={testAppInfo} deviceLocale={() => 'en-US'} />);
      try {
        await openSettings(restarted);
        h.eq(addressFields(restarted).map((field) => field.props.value), [LAN], 'after a restart Advanced is already open on the saved address');
        h.ok(textOf(restarted.root).includes(LEGAL_COPY.en.ownServerCaption), 'under the responsibility caption');
        await press(button(restarted, COPY.settingsUseDefaultServer));
        h.eq(addressFields(restarted).map((field) => field.props.value), [''], 'the field is empty and still there');
        h.eq(loadServerUrl(kv), undefined, 'the saved address is gone');
        await TestRenderer.act(async () => settings(restarted).props.onBack());
        await openSettings(restarted);
        await openAdvanced(restarted);
        h.eq(addressFields(restarted).length, 1, 'the field is available again with no second acknowledgement');
        await TestRenderer.act(async () => settings(restarted).props.onBack());
        await composeAndContinue(restarted, 'a timer');
        h.ok(sent.length > 0 && sent.every((r) => r.url.startsWith(`${RELEASE.serverUrl}/`)), `the next request targets ${RELEASE.serverUrl} (got ${sent.map((r) => r.url).join(', ')})`);
      } finally {
        await unmountScreen(restarted);
      }
    });
  });

  await h.test('own server: with the French legal text the confirm step speaks French', async () => {
    await withLauncher({ locale: 'fr-CA', server: clarifyServer }, async ({ tree }) => {
      await openSettings(tree);
      await openAdvanced(tree);
      const sheet = await openOwnServerSheet(tree, LEGAL_COPY.fr);
      h.ok(sheet.text.includes(LEGAL_COPY.fr.ownServerConfirmBody) && sheet.text.includes(LEGAL_COPY.fr.ownServerConfirm), 'in the French table’s words');
    });
  });

  await h.test('Settings: AI features (consent row, error details), Highlighting, About (privacy, terms, support, this phone’s ID), then Advanced', async () => {
    await withLauncher({ server: clarifyServer }, async ({ tree }) => {
      await openSettings(tree);
      const text = textOf(tree.root);
      const order = [
        COPY.settingsAISectionTitle, COPY.settingsErrorDetailsTitle, COPY.highlightingSectionTitle,
        COPY.settingsAboutSectionTitle, COPY.privacyPolicyLabel, COPY.termsOfUseLabel, COPY.supportLabel,
        COPY.settingsDeviceIdTitle, COPY.settingsAdvancedSectionTitle,
      ];
      const positions = order.map((label) => text.indexOf(label));
      h.ok(positions.every((at) => at >= 0), `every control is shown (missing: ${order.filter((_, i) => positions[i] < 0).join(', ')})`);
      h.ok(positions.every((at, i) => i === 0 || at > positions[i - 1]), `in spec order (positions ${positions.join(', ')})`);
    });
  });

  // ── Settings' "Turn on AI features" routes through the terms step ────────────────────────────

  await h.test('Settings: the AI features row dates the grant with its month named — the phone’s locale, or Canadian French with the French legal text', async () => {
    // Noon local time, so every time zone formats the same calendar day.
    const grantedAt = new Date(2026, 8, 24, 12).toISOString();
    const cases: Array<[locale: string, line: string]> = [
      ['en-CA', 'On since Sep 24, 2026'],
      ['en-US', 'On since Sep 24, 2026'],
      ['fr-CA', 'On since 24 sept. 2026'],
    ];
    for (const [locale, line] of cases) {
      await withLauncher({ locale, consent: false, prepare: (kv) => grantConsent(kv, grantedAt), server: clarifyServer }, async ({ tree }) => {
        await openSettings(tree);
        h.ok(textOf(tree.root).includes(line), `${locale}: "${line}"`);
        h.ok(!textOf(tree.root).includes('9/24/2026'), `${locale}: never the month-first number date`);
      });
    }
  });

  // terms-acceptance "One pass through the legal flow shows each legal screen at most once" (beta-1
  // D6, #104): each journey is the screen shown after every step, from Settings back to Settings.

  await h.test('Settings: turning AI features on with outdated terms shows the terms step, then one consent screen, and grants nothing before both', async () => {
    const prepare = (kv: KVBackend) => { olderTerms(kv); freshAgeCheck(kv); };
    await withLauncher({ consent: false, prepare, server: clarifyServer }, async ({ tree, kv, sent }) => {
      await openSettings(tree);
      const journey = [shownScreen(tree)];
      await TestRenderer.act(async () => settings(tree).props.onOpenAIFeatures());
      journey.push(shownScreen(tree));
      await press(button(tree, COPY.termsAccept));
      journey.push(shownScreen(tree));
      h.eq(consentStatus(kv).kind, 'absent', 'accepting the terms alone grants nothing');
      await press(button(tree, COPY.consentAgree));
      journey.push(shownScreen(tree));
      h.eq(journey, ['settings', 'terms', 'consent:ask', 'settings'], 'the terms step, then the consent screen once, then Settings');
      h.eq([termsStatus(kv).kind, consentStatus(kv).kind], ['accepted', 'granted'], 'AI features are on after that one consent');
      h.eq(sent.length, 0, 'no request was sent along the way');
    });
  });

  await h.test('Settings: turning AI features on with current terms shows exactly one consent screen and no terms step', async () => {
    await withLauncher({ consent: false, server: clarifyServer }, async ({ tree, kv }) => {
      await openSettings(tree);
      const journey = [shownScreen(tree)];
      await TestRenderer.act(async () => settings(tree).props.onOpenAIFeatures());
      journey.push(shownScreen(tree));
      await press(button(tree, COPY.consentAgree));
      journey.push(shownScreen(tree));
      h.eq(journey, ['settings', 'consent:ask', 'settings'], 'one consent screen, then Settings');
      h.eq(consentStatus(kv).kind, 'granted', 'AI features are on');
    });
  });

  await h.test('Settings: one pass through "Turn on AI features" shows each legal screen at most once, the age check included', async () => {
    let answer: (signal: string) => void = () => {};
    const store = () => new Promise<unknown>((resolve) => { answer = resolve; });
    await withLauncher({ terms: false, consent: false, ageSignal: store, server: clarifyServer }, async ({ tree, kv }) => {
      await openSettings(tree);
      const journey = [shownScreen(tree)];
      await TestRenderer.act(async () => settings(tree).props.onOpenAIFeatures());
      journey.push(shownScreen(tree));
      await TestRenderer.act(async () => answer('adult'));
      await waitFor(() => !on(tree, AgeScreen), 'the age check to finish');
      journey.push(shownScreen(tree));
      await press(button(tree, COPY.termsAccept));
      journey.push(shownScreen(tree));
      await press(button(tree, COPY.consentAgree));
      journey.push(shownScreen(tree));
      h.eq(journey, ['settings', 'age', 'terms', 'consent:ask', 'settings'], 'the age check, the terms step and the consent screen, once each');
      h.eq([termsStatus(kv).kind, consentStatus(kv).kind], ['accepted', 'granted'], 'and AI features are on');
    });
  });

  await h.test('Settings: with AI features on and the terms outdated, the row still opens review mode, so they can be turned off without the new terms', async () => {
    await withLauncher({ prepare: olderTerms, server: clarifyServer }, async ({ tree, kv }) => {
      await openSettings(tree);
      await TestRenderer.act(async () => settings(tree).props.onOpenAIFeatures());
      h.eq(shownScreen(tree), 'consent:review', 'the consent screen in review mode, not the terms step');
      await press(button(tree, COPY.consentReviewTurnOff));
      h.eq(shownScreen(tree), 'settings', 'turning off returns to Settings');
      h.eq([termsStatus(kv).kind, consentStatus(kv).kind], ['outdated', 'absent'], 'the grant is gone and the terms are untouched');
    });
  });

  await h.test('Settings: declining the terms step after "Turn on AI features" returns to Settings with nothing stored', async () => {
    await withLauncher({ terms: false, consent: false, server: clarifyServer }, async ({ tree, kv }) => {
      await openSettings(tree);
      await TestRenderer.act(async () => settings(tree).props.onOpenAIFeatures());
      await waitFor(() => on(tree, TermsScreen), 'the terms step');
      await press(button(tree, COPY.termsDecline));
      h.ok(on(tree, SettingsScreen), 'back on Settings');
      h.eq([termsStatus(kv).kind, consentStatus(kv).kind], ['absent', 'absent'], 'no terms record and no grant');
    });
  });
}
