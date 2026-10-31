/** Settings and Advanced in the rendered launcher (design-system-v1 task 14.3; specs
 *  privacy-settings and app-launcher "Settings puts common settings first and diagnostics under
 *  Advanced"): the "Send error details" switch, this phone's ID with its copy button and "Make a new
 *  ID", the user's own server behind its acknowledgement (beta-1 D20) and switching back to Whim's
 *  server keeping its address, the section order, and the AI features review screen being the one
 *  consent screen when AI features are turned on (#104), never granting without a terms record. */
import React from 'react';
import TestRenderer from 'react-test-renderer';
import { Harness } from './harness';
import HomeScreen from '../HomeScreen';
import SettingsScreen from '../SettingsScreen';
import ConsentScreen from '../ConsentScreen';
import { FirstRunSheet } from '../FirstRunSheet';
import AgeScreen from '../AgeScreen';
import LauncherRoot from '../LauncherRoot';
import HistoryScreen from '../HistoryScreen';
import BuildStep from '../BuildStep';
import { Button } from '../../ui/Button';
import { Sheet } from '../../ui/Sheet';
import { AppIndex, type InstalledApp } from '../app-index';
import { COPY, LEGAL_COPY } from '../copy';
import { consentStatus } from '../ai-consent';
import { termsStatus } from '../terms-acceptance';
import { getDeviceId } from '../device-id';
import { errorDetailsEnabled } from '../error-details';
import { RELEASE, TERMS_VERSION } from '../release-config';
import { loadServerUrl, saveServerUrl } from '../server-address';
import { middleTruncated } from '../settings-sections';
import { StoreAccess } from '../store-access';
import type { KVBackend } from '../../version-store/fs/kv-fs';
import { activate, button, press, renderScreen, screenReaderElement, textOf, unmountScreen, hostType } from './react-screen';
import { buildIt, composeAndContinue, firstRunOpen, json, planLoaded, sseStream, waitFor, wasSent, withLauncher, type SentRequest, type Tree } from './rendered-launcher';
import { Alert, Clipboard, Linking } from './native-host';
import { stackIds } from './native-screens';
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

/** Which screen shows on top: the consent screen and its mode, a legal step, or Settings (which
 *  stays mounted under the screens it pushes). */
function shownScreen(tree: Tree): string {
  const sheet = tree.root.findAllByType(FirstRunSheet).find((open) => open.props.visible);
  if (sheet) return sheet.props.termsDue ? 'terms' : 'consent:ask';
  if (on(tree, ConsentScreen)) return 'consent:review';
  if (on(tree, AgeScreen)) return 'age';
  if (on(tree, SettingsScreen)) return 'settings';
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

/** Settings, then its Advanced row, which pushes Advanced. */
async function openAdvanced(tree: Tree): Promise<void> {
  await openSettings(tree);
  await press(button(tree, COPY.settingsAdvancedSectionTitle));
}

/** The phone ID's copy button, and the ID it put on the clipboard. */
async function copiedDeviceId(tree: Tree): Promise<string> {
  const before = Clipboard.copied.length;
  await press(button(tree, COPY.settingsDeviceIdCopy));
  if (Clipboard.copied.length !== before + 1) throw new Error('the copy button copied nothing');
  return Clipboard.copied[before];
}

/** The "Send error details" row: one switch element, read and flipped as a screen reader does. */
function errorDetailsRow(tree: Tree): TestRenderer.ReactTestInstance {
  return tree.root.find((node) => hostType(node) === 'Pressable' && node.props.accessibilityRole === 'switch' && node.props.accessibilityLabel === COPY.settingsErrorDetailsTitle);
}

/** Whether the server row with this title reads chosen: a radio, checked. */
function serverRowChosen(tree: Tree, title: string): boolean {
  const row = tree.root.find((node) => hostType(node) === 'Pressable' && node.props.accessibilityLabel === title);
  return row.props.accessibilityRole === 'radio' && row.props.accessibilityState.checked === true;
}

/** The open confirm sheet: what it says, and its two choices. */
function confirmSheet(tree: Tree, keepLabel: string, confirmLabel: string) {
  const modal = tree.root.find((node) => String(node.type) === 'Modal');
  const control = (label: string) => modal.find((node) => hostType(node) === 'Pressable' && node.props.accessibilityLabel === label);
  return { modal, text: textOf(modal), keep: control(keepLabel), confirm: control(confirmLabel) };
}

/** Opens the confirm sheet for "Make a new ID": the launcher's own sheet, never a system alert. */
async function openMakeNewId(tree: Tree) {
  const alerts = Alert.shown.length;
  await press(button(tree, COPY.settingsDeviceIdReset));
  if (Alert.shown.length !== alerts) throw new Error('"Make a new ID" raised a system alert');
  return confirmSheet(tree, COPY.settingsDeviceIdKeep, COPY.settingsDeviceIdReset);
}

const isCloseButton = (node: TestRenderer.ReactTestInstance) => hostType(node) === 'Pressable' && node.props.accessibilityLabel === COPY.sheetClose;
/** The sheet's scrim: a touchable screen readers skip. */
const isScrim = (node: TestRenderer.ReactTestInstance) => hostType(node) === 'Pressable' && node.props.accessible === false;

const sheetsOpen = (tree: Tree) => tree.root.findAll((node) => String(node.type) === 'Modal').length;

/** Answers clarify with no questions, rewrite with an empty plan, a report as accepted, and a
 *  generation with a stream that stays open. */
const ownServer = (r: SentRequest): Response | Promise<Response> => {
  if (r.path === '/v1/clarify') return json({ questions: [] });
  if (r.path === '/v1/rewrite') return json({ rewrittenPrompt: String(r.body?.prompt), plan: [] });
  if (r.path === '/v1/report') return json({ reportId: 'r-1' }, 202);
  return sseStream(r.signal).response;
};

const addressFields = (tree: Tree) => tree.root.findAll((node) => hostType(node) === 'TextInput');

/** Takes "Your own server" before it was ever acknowledged: the confirm sheet, and its two choices. */
async function openOwnServerSheet(tree: Tree, copy = LEGAL_COPY.en) {
  await press(button(tree, COPY.settingsServerOwn));
  return confirmSheet(tree, COPY.ownServerKeep, copy.ownServerConfirm);
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

  await h.test('error details: never set, the module reports on and Advanced’s switch reads on, over its explanation', async () => {
    await withLauncher({ server: clarifyServer }, async ({ tree, kv }) => {
      h.ok(errorDetailsEnabled(kv), 'the module reports on');
      await openAdvanced(tree);
      h.eq(errorDetailsRow(tree).props.accessibilityState.checked, true, 'the switch reads on');
      h.ok(textOf(tree.root).includes(COPY.settingsErrorDetailsHint), 'with the explanation from the copy table');
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
      await openAdvanced(tree);
      await press(errorDetailsRow(tree));
      h.eq(errorDetailsEnabled(kv), false, 'the module reports off before any next upload decision');
      h.eq(errorDetailsRow(tree).props.accessibilityState.checked, false, 'the switch reads off');
      await unmountScreen(tree);
      const restarted = await renderScreen(<LauncherRoot appInfo={testAppInfo} deviceLocale={() => 'en-US'} />);
      try {
        await openAdvanced(restarted);
        h.eq(errorDetailsEnabled(kv), false, 'after a restart the module still reports off');
        h.eq(errorDetailsRow(restarted).props.accessibilityState.checked, false, 'and the switch still reads off');
      } finally {
        await unmountScreen(restarted);
      }
    });
  });

  // ── privacy-settings "Settings shows this phone's ID and can make a new one" ─────────────────

  await h.test('phone ID: the ID copied in Advanced, shown there truncated under its hint, is the x-whim-device header of the next request', async () => {
    await withLauncher({ server: clarifyServer }, async ({ tree, sent, kv }) => {
      await openAdvanced(tree);
      const copied = await copiedDeviceId(tree);
      h.eq(copied, getDeviceId(kv), 'the copy button copies the whole stored ID');
      h.ok(textOf(tree.root).includes(middleTruncated(copied)) && !textOf(tree.root).includes(copied), 'the row shows it truncated in the middle');
      h.ok(textOf(tree.root).includes(COPY.settingsDeviceIdCopied), 'and the copy is confirmed');
      h.ok(textOf(tree.root).includes(COPY.settingsDeviceIdHint), 'with the hint to include it when asking about one’s data');
      await leaveSettings(tree);
      h.eq(await headerOfNextRequest(tree, sent), copied, 'the header equals the ID copied');
    });
  });

  await h.test('phone ID: confirming "Make a new ID" shows a different ID, persists it, the next request carries it, and consent, terms and apps stay', async () => {
    await withLauncher({ apps: [APP], server: clarifyServer }, async ({ tree, kv, sent }) => {
      await openAdvanced(tree);
      const before = await copiedDeviceId(tree);
      const sheet = await openMakeNewId(tree);
      h.ok(sheet.text.includes(COPY.settingsDeviceIdResetTitle), 'the sheet asks');
      h.ok(sheet.text.includes(COPY.settingsDeviceIdResetConfirm), 'and says how long old records are kept and that they can go sooner');
      h.eq(getDeviceId(kv), before, 'nothing changes until the user confirms');
      await press(sheet.confirm);
      const after = await copiedDeviceId(tree);
      h.ok(after !== before, 'Advanced shows a different ID');
      h.ok(textOf(tree.root).includes(middleTruncated(after)), 'in its row');
      h.eq(getDeviceId(kv), after, 'the new ID is the stored one, so a restart keeps it');
      h.eq(consentStatus(kv).kind, 'granted', 'consent stays granted');
      h.eq(termsStatus(kv).kind, 'accepted', 'the terms acceptance stays');
      h.eq(new AppIndex(kv).list().map((app) => app.id), [APP.id], 'installed apps stay');
      await leaveSettings(tree);
      h.eq(await headerOfNextRequest(tree, sent), after, 'the next request carries the new ID');
    });
  });

  await h.test('phone ID: "Keep this ID", the close button and a tap on the scrim each keep the stored ID', async () => {
    await withLauncher({ server: clarifyServer }, async ({ tree, kv }) => {
      await openAdvanced(tree);
      const before = getDeviceId(kv);
      const ways: Array<[string, (sheet: Awaited<ReturnType<typeof openMakeNewId>>) => Promise<void>]> = [
        ['Keep this ID', (sheet) => press(sheet.keep)],
        ['the close button', (sheet) => press(sheet.modal.find(isCloseButton))],
        ['the scrim', (sheet) => press(sheet.modal.find(isScrim))],
      ];
      for (const [way, leave] of ways) {
        await leave(await openMakeNewId(tree));
        h.eq(getDeviceId(kv), before, `${way}: the stored ID is unchanged`);
        h.eq(tree.root.findAllByType(Sheet).filter((sheet) => sheet.props.visible).length, 0, `${way}: the sheet closes`);
      }
    });
  });

  await h.test('phone ID: the confirm sheet’s safe choice is the large ink "Keep this ID", over a danger "Make a new ID", each a labelled button of its own', async () => {
    await withLauncher({ server: clarifyServer }, async ({ tree, kv }) => {
      await openAdvanced(tree);
      const before = getDeviceId(kv);
      const sheet = await openMakeNewId(tree);
      h.eq(sheet.modal.findAllByType(Button).map((b) => [b.props.label, b.props.variant]), [[COPY.settingsDeviceIdKeep, 'ink'], [COPY.settingsDeviceIdReset, 'danger']], 'keep first and ink, the new ID under it as danger');
      for (const [label, control] of [[COPY.settingsDeviceIdKeep, sheet.keep], [COPY.settingsDeviceIdReset, sheet.confirm]] as const) {
        h.ok(screenReaderElement(control) === control, `"${label}" is an element of its own, not read as part of one around it`);
        h.eq([control.props.accessibilityRole, control.props.accessibilityLabel], ['button', label], `"${label}" is announced as a button, in its own words`);
      }
      await activate(sheet.confirm);
      h.ok(getDeviceId(kv) !== before, 'activating "Make a new ID" makes a new one rather than keeping');
    });
  });

  // ── app-launcher "Settings puts common settings first and diagnostics under Advanced" ────────

  await h.test('own server: an address an earlier build saved stays unread until acknowledged — Whim’s server chosen, no field, every request to the compiled-in server', async () => {
    await withLauncher({ prepare: (kv) => saveServerUrl(kv, OVERRIDE), server: clarifyServer }, async ({ tree, sent }) => {
      await openAdvanced(tree);
      h.ok(serverRowChosen(tree, COPY.settingsServerWhim) && !serverRowChosen(tree, COPY.settingsServerOwn), 'Whim’s server is the chosen row');
      h.eq(addressFields(tree).length, 0, 'no address field');
      await leaveSettings(tree);
      await composeAndContinue(tree, 'a timer');
      h.ok(sent.length > 0 && sent.every((r) => r.url.startsWith(`${RELEASE.serverUrl}/`)), `every request targets ${RELEASE.serverUrl} (got ${sent.map((r) => r.url).join(', ')})`);
    });
  });

  await h.test('own server: the confirm sheet says what that server gets and that the policy does not cover it; keeping Whim’s server leaves no field and no override', async () => {
    await withLauncher({ prepare: (kv) => saveServerUrl(kv, OVERRIDE), server: clarifyServer }, async ({ tree, sent }) => {
      await openAdvanced(tree);
      const sheet = await openOwnServerSheet(tree);
      h.ok(sheet.text.includes(LEGAL_COPY.en.ownServerConfirmBody), 'the sheet carries the acknowledgement text');
      await press(sheet.keep);
      h.eq(tree.root.findAllByType(Sheet).filter((open) => open.props.visible).length, 0, 'the sheet closes');
      h.eq(addressFields(tree).length, 0, 'no address field');
      h.ok(serverRowChosen(tree, COPY.settingsServerWhim), 'Whim’s server stays chosen');
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
        await openAdvanced(tree);
        await press((await openOwnServerSheet(tree)).confirm);
        h.ok(serverRowChosen(tree, COPY.settingsServerOwn), 'your own server is the chosen row');
        h.eq(addressFields(tree).map((field) => field.props.value), [''], 'the empty address field shows');
        h.ok(!textOf(tree.root).includes(LEGAL_COPY.en.ownServerCaption), 'no caption while no address is saved');
        await typeAddress(tree, LAN);
        h.ok(textOf(tree.root).includes(LEGAL_COPY.en.ownServerCaption), 'the saved address carries the responsibility caption');
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

  await h.test('own server: switching to Whim’s server and back keeps the address, with nothing confirmed or erased, across a restart', async () => {
    await withLauncher({ server: clarifyServer }, async ({ tree, kv, sent }) => {
      await openAdvanced(tree);
      await press((await openOwnServerSheet(tree)).confirm);
      await typeAddress(tree, LAN);
      await unmountScreen(tree);
      const restarted = await renderScreen(<LauncherRoot appInfo={testAppInfo} deviceLocale={() => 'en-US'} />);
      try {
        await openAdvanced(restarted);
        h.eq(addressFields(restarted).map((field) => field.props.value), [LAN], 'after a restart your own server is chosen, on the saved address');
        await press(button(restarted, COPY.settingsServerWhim));
        h.ok(serverRowChosen(restarted, COPY.settingsServerWhim), 'Whim’s server is chosen');
        h.eq(addressFields(restarted).length, 0, 'the field goes with your own server');
        h.eq(loadServerUrl(kv), LAN, 'the saved address stays');
        const before = sent.length;
        await leaveSettings(restarted);
        await composeAndContinue(restarted, 'a timer');
        h.ok(sent.length > before && sent.slice(before).every((r) => r.url.startsWith(`${RELEASE.serverUrl}/`)), `meanwhile requests target ${RELEASE.serverUrl}`);
      } finally {
        await unmountScreen(restarted);
      }
      const again = await renderScreen(<LauncherRoot appInfo={testAppInfo} deviceLocale={() => 'en-US'} />);
      try {
        await openAdvanced(again);
        h.ok(serverRowChosen(again, COPY.settingsServerWhim), 'the choice of Whim’s server survives a restart');
        const alerts = Alert.shown.length;
        await press(button(again, COPY.settingsServerOwn));
        h.eq([sheetsOpen(again), Alert.shown.length], [0, alerts], 'switching back asks nothing again');
        h.eq(addressFields(again).map((field) => field.props.value), [LAN], 'and the address is there');
        const before = sent.length;
        await leaveSettings(again);
        await composeAndContinue(again, 'a timer');
        h.ok(sent.length > before && sent.slice(before).every((r) => r.url.startsWith(`${LAN}/`)), 'requests target the address again');
      } finally {
        await unmountScreen(again);
      }
    });
  });

  await h.test('own server: with the French legal text the confirm sheet speaks French', async () => {
    await withLauncher({ locale: 'fr-CA', server: clarifyServer }, async ({ tree }) => {
      await openAdvanced(tree);
      const sheet = await openOwnServerSheet(tree, LEGAL_COPY.fr);
      h.ok(sheet.text.includes(LEGAL_COPY.fr.ownServerConfirmBody) && sheet.text.includes(LEGAL_COPY.fr.ownServerConfirm), 'in the French table’s words');
    });
  });

  await h.test('Settings: AI features, Language, About (privacy, terms, support, report a problem, version), then Advanced; no Highlighting', async () => {
    await withLauncher({ server: clarifyServer }, async ({ tree }) => {
      await openSettings(tree);
      const text = textOf(settings(tree));
      const order = [
        COPY.settingsAISectionTitle, COPY.settingsAISubtitle, COPY.settingsLanguageTitle, COPY.settingsAboutSectionTitle,
        COPY.privacyPolicyLabel, COPY.termsOfUseLabel, COPY.supportLabel, COPY.settingsReportProblem,
        COPY.settingsVersionTitle, COPY.settingsAdvancedSectionTitle,
      ];
      const positions = order.map((label) => text.indexOf(label));
      h.ok(positions.every((at) => at >= 0), `every row is shown (missing: ${order.filter((_, i) => positions[i] < 0).join(', ')})`);
      h.ok(positions.every((at, i) => i === 0 || at > positions[i - 1]), `in spec order (positions ${positions.join(', ')})`);
      const info = testAppInfo();
      h.ok(text.includes(`${info.version} (${info.build})`), 'the version row shows the installed version and build');
      h.ok(!/highlight/i.test(text) && tree.root.findAll((node) => hostType(node) === 'Switch').length === 0, 'no Highlighting and no switch at all on Settings');
      for (const diagnostic of [COPY.settingsErrorDetailsTitle, COPY.settingsDeviceIdTitle, COPY.settingsServerSection]) {
        h.ok(!text.includes(diagnostic), `${diagnostic} is under Advanced, not on Settings`);
      }
    });
  });

  await h.test('Settings: Language names the legal language in itself and one tap switches to the other, which About’s links then follow', async () => {
    await withLauncher({ server: clarifyServer }, async ({ tree }) => {
      await openSettings(tree);
      await press(button(tree, `${COPY.settingsLanguageTitle}, English`));
      h.eq(settings(tree).props.legalLanguage, 'fr', 'the legal language is French');
      h.ok(textOf(settings(tree)).includes('Français'), 'and the row says so in French');
      const opened = Linking.opened.length;
      await press(button(tree, COPY.termsOfUseLabel));
      h.eq(Linking.opened.slice(opened), [RELEASE.termsUrlFr], 'the terms row now opens the French terms');
    });
  });

  await h.test('Settings: Report a problem pushes the Report screen for no particular app, and back returns to Settings', async () => {
    await withLauncher({ server: clarifyServer }, async ({ tree }) => {
      await openSettings(tree);
      await press(button(tree, COPY.settingsReportProblem));
      await waitFor(() => textOf(tree.root).includes(COPY.reportReasonBroken), 'the report draft');
      h.eq(stackIds(tree), ['home', 'settings', 'report'], 'Report sits on the stack over Settings');
      h.ok(!textOf(tree.root).includes(COPY.reportFieldAppName) && !textOf(tree.root).includes(COPY.reportIncludePrompt), 'it names no app and offers no prompt to include');
      await press(button(tree, COPY.cancel));
      h.eq(stackIds(tree), ['home', 'settings'], 'Cancel returns to Settings');
    });
  });

  // terms-acceptance "One pass through the legal flow shows each legal screen at most once" (beta-1
  // D6, #104): AI features is the consent screen in review mode on the stack; turning AI features
  // on from it is the consent, so the flow shows it once. Each journey is the screen on top after
  // every step, from Settings back to Settings.

  await h.test('Settings: turning AI features on with outdated terms shows the review, then the terms step, and grants nothing before both', async () => {
    const prepare = (kv: KVBackend) => { olderTerms(kv); freshAgeCheck(kv); };
    await withLauncher({ consent: false, prepare, server: clarifyServer }, async ({ tree, kv, sent }) => {
      await openSettings(tree);
      const journey = [shownScreen(tree)];
      await press(button(tree, COPY.settingsAISectionTitle));
      journey.push(shownScreen(tree));
      h.eq(stackIds(tree), ['home', 'settings', 'consent'], 'AI features is pushed over Settings');
      await press(button(tree, COPY.consentReviewTurnOn));
      journey.push(shownScreen(tree));
      h.eq(consentStatus(kv).kind, 'absent', 'nothing is granted before the terms are accepted');
      await press(button(tree, COPY.firstRunTermsCheck));
      await press(button(tree, COPY.consentAgree));
      journey.push(shownScreen(tree));
      h.eq(journey, ['settings', 'consent:review', 'terms', 'settings'], 'the disclosure once, then the first-run sheet with its terms row, then Settings');
      h.eq([termsStatus(kv).kind, consentStatus(kv).kind], ['accepted', 'granted'], 'AI features are on after that one consent');
      h.eq(sent.length, 0, 'no request was sent along the way');
    });
  });

  await h.test('Settings: turning AI features on with current terms shows exactly one consent screen and no terms step', async () => {
    await withLauncher({ consent: false, server: clarifyServer }, async ({ tree, kv }) => {
      const termsBefore = kv.getString('whim.terms:v1');
      await openSettings(tree);
      const journey = [shownScreen(tree)];
      await press(button(tree, COPY.settingsAISectionTitle));
      journey.push(shownScreen(tree));
      await press(button(tree, COPY.consentReviewTurnOn));
      journey.push(shownScreen(tree));
      h.eq(journey, ['settings', 'consent:review', 'settings'], 'one consent screen, then Settings');
      h.eq(consentStatus(kv).kind, 'granted', 'AI features are on');
      h.eq(kv.getString('whim.terms:v1'), termsBefore, 'the terms were not asked again, and their record was not rewritten');
      h.ok(!firstRunOpen(tree), 'and the first-run sheet never opened');
    });
  });

  await h.test('Settings: one pass through "Turn on AI features" shows each legal screen at most once, the age check included', async () => {
    let answer: (signal: string) => void = () => {};
    const store = () => new Promise<unknown>((resolve) => { answer = resolve; });
    await withLauncher({ terms: false, consent: false, ageSignal: store, server: clarifyServer }, async ({ tree, kv }) => {
      await openSettings(tree);
      const journey = [shownScreen(tree)];
      await press(button(tree, COPY.settingsAISectionTitle));
      journey.push(shownScreen(tree));
      await press(button(tree, COPY.consentReviewTurnOn));
      journey.push(shownScreen(tree));
      await TestRenderer.act(async () => answer('adult'));
      await waitFor(() => shownScreen(tree) === 'terms', 'the age check to finish');
      journey.push(shownScreen(tree));
      await press(button(tree, COPY.firstRunTermsCheck));
      await press(button(tree, COPY.consentAgree));
      journey.push(shownScreen(tree));
      h.eq(journey, ['settings', 'consent:review', 'settings', 'terms', 'settings'], 'the disclosure, the silent age check (Settings stays in view) and the first-run sheet, once each');
      h.eq([termsStatus(kv).kind, consentStatus(kv).kind], ['accepted', 'granted'], 'and AI features are on');
    });
  });

  await h.test('Settings: with AI features on and the terms outdated, the row still opens review mode, so they can be turned off without the new terms', async () => {
    await withLauncher({ prepare: olderTerms, server: clarifyServer }, async ({ tree, kv }) => {
      await openSettings(tree);
      await press(button(tree, COPY.settingsAISectionTitle));
      h.eq(shownScreen(tree), 'consent:review', 'the consent screen in review mode, not the terms step');
      await press(button(tree, COPY.consentReviewTurnOff));
      h.eq(shownScreen(tree), 'settings', 'turning off returns to Settings');
      h.eq([termsStatus(kv).kind, consentStatus(kv).kind], ['outdated', 'absent'], 'the grant is gone and the terms are untouched');
    });
  });

  await h.test('Settings: declining the first-run sheet after "Turn on AI features" returns to Settings with nothing stored', async () => {
    await withLauncher({ terms: false, consent: false, server: clarifyServer }, async ({ tree, kv }) => {
      await openSettings(tree);
      await press(button(tree, COPY.settingsAISectionTitle));
      await press(button(tree, COPY.consentReviewTurnOn));
      await waitFor(() => shownScreen(tree) === 'terms', 'the first-run sheet');
      await press(button(tree, COPY.consentDecline));
      h.eq(shownScreen(tree), 'settings', 'back on Settings');
      h.eq([termsStatus(kv).kind, consentStatus(kv).kind], ['absent', 'absent'], 'no terms record and no grant');
    });
  });
}
