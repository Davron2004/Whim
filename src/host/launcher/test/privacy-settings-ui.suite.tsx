/** Settings' privacy controls and build-dependent sections in the rendered launcher
 *  (legal-surface-v2 tasks 5.1–5.3; specs privacy-settings and app-launcher): the "Send error
 *  details" switch, this phone's ID and "Make a new ID", the server address only in internal
 *  builds, the section order, and "Turn on AI features" never granting without a terms record. */
import React from 'react';
import TestRenderer from 'react-test-renderer';
import { Harness } from './harness';
import HomeScreen from '../HomeScreen';
import SettingsScreen from '../SettingsScreen';
import ConsentScreen from '../ConsentScreen';
import TermsScreen from '../TermsScreen';
import LauncherRoot from '../LauncherRoot';
import { AppIndex, type InstalledApp } from '../app-index';
import { COPY } from '../copy';
import { consentStatus, grantConsent } from '../ai-consent';
import { termsStatus } from '../terms-acceptance';
import { getDeviceId } from '../device-id';
import { errorDetailsEnabled } from '../error-details';
import { RELEASE } from '../release-config';
import { saveServerUrl } from '../server-address';
import type { KVBackend } from '../../version-store/fs/kv-fs';
import { button, press, renderScreen, textOf, unmountScreen } from './react-screen';
import { composeAndContinue, json, withLauncher, type SentRequest, type Tree } from './rendered-launcher';
import { Alert } from './native-host';
import { testAppInfo } from './client-fixtures';

const APP: InstalledApp = { id: 'timer', name: 'Timer', createdAt: 1, lineageId: 'main', record: { appId: 'timer', name: 'Timer', manifest: { capabilities: [] } } };
const OVERRIDE = 'https://lan.example:8787';

/** Answers clarify with no questions; nothing else is expected. */
const clarifyServer = (r: SentRequest): Response | Promise<Response> =>
  r.path === '/v1/clarify' ? json({ questions: [] }) : new Promise<Response>(() => {});

const on = (tree: Tree, type: Parameters<Tree['root']['findAllByType']>[0]) => tree.root.findAllByType(type).length === 1;
const settings = (tree: Tree) => tree.root.findByType(SettingsScreen);

async function openSettings(tree: Tree): Promise<void> {
  await TestRenderer.act(async () => tree.root.findByType(HomeScreen).props.onSettings());
}

async function leaveSettings(tree: Tree): Promise<void> {
  await TestRenderer.act(async () => settings(tree).props.onBack());
}

/** The ID Settings shows: the one selectable text on the screen. */
function shownDeviceId(tree: Tree): string {
  const selectable = tree.root.findAll((node) => node.type === 'Text' && node.props.selectable === true);
  if (selectable.length !== 1) throw new Error(`expected one selectable text, got ${selectable.length}`);
  return textOf(selectable[0]);
}

function errorDetailsSwitch(tree: Tree): TestRenderer.ReactTestInstance {
  return tree.root.find((node) => node.type === 'Switch' && node.props.accessibilityLabel === COPY.settingsErrorDetailsTitle);
}

/** Opens the confirm step and returns the dialog it raised. */
async function openMakeNewId(tree: Tree) {
  const before = Alert.shown.length;
  await press(button(tree, COPY.settingsDeviceIdReset));
  const raised = Alert.shown.slice(before);
  if (raised.length !== 1) throw new Error(`expected one confirm dialog, got ${raised.length}`);
  return raised[0];
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
      const restarted = await renderScreen(<LauncherRoot appInfo={testAppInfo} internalBuild deviceLocale={() => 'en-US'} />);
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
      const dialog = await openMakeNewId(tree);
      h.eq(dialog.message, COPY.settingsDeviceIdResetConfirm, 'the confirm step says how long old records are kept');
      h.eq(shownDeviceId(tree), before, 'nothing changes until the user confirms');
      const confirm = dialog.buttons.find((b) => b.text === COPY.settingsDeviceIdReset);
      await TestRenderer.act(async () => confirm?.onPress?.());
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
      const dialog = await openMakeNewId(tree);
      const cancel = dialog.buttons.find((b) => b.style === 'cancel');
      h.eq(cancel?.text, COPY.cancel, 'the confirm step offers Cancel');
      await TestRenderer.act(async () => cancel?.onPress?.());
      h.eq(getDeviceId(kv), before, 'the stored ID is unchanged');
      h.eq(shownDeviceId(tree), before, 'and Settings shows the same ID');
    });
  });

  // ── app-launcher "The Settings screen persists a server address…" / "Settings groups its
  //    controls into titled sections…" ─────────────────────────────────────────────────────────

  await h.test('store build: a saved override is ignored — no Advanced section or address field, and requests go to the compiled-in server', async () => {
    await withLauncher({ internalBuild: false, prepare: (kv) => saveServerUrl(kv, OVERRIDE), server: clarifyServer }, async ({ tree, sent }) => {
      await openSettings(tree);
      const text = textOf(tree.root);
      for (const title of [COPY.settingsAISectionTitle, COPY.highlightingSectionTitle, COPY.settingsAboutSectionTitle]) {
        h.ok(text.includes(title), `the ${title} section is visible`);
      }
      h.ok(!text.includes(COPY.settingsAdvancedSectionTitle), 'no Advanced section');
      h.eq(tree.root.findAll((node) => node.type === 'TextInput').length, 0, 'no server address field');
      await leaveSettings(tree);
      await composeAndContinue(tree, 'a timer');
      h.ok(sent.length > 0 && sent.every((r) => r.url.startsWith(`${RELEASE.serverUrl}/`)), `every request targets ${RELEASE.serverUrl} (got ${sent.map((r) => r.url).join(', ')})`);
    });
  });

  await h.test('internal build: a saved override opens Advanced on the saved address, and requests go there', async () => {
    await withLauncher({ internalBuild: true, prepare: (kv) => saveServerUrl(kv, OVERRIDE), server: clarifyServer }, async ({ tree, sent }) => {
      await openSettings(tree);
      const fields = tree.root.findAll((node) => node.type === 'TextInput');
      h.eq(fields.map((field) => field.props.value), [OVERRIDE], 'Advanced is already open, showing the saved address');
      await leaveSettings(tree);
      await composeAndContinue(tree, 'a timer');
      h.ok(sent.length > 0 && sent.every((r) => r.url.startsWith(`${OVERRIDE}/`)), `every request targets the override (got ${sent.map((r) => r.url).join(', ')})`);
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

  await h.test('Settings: turning AI features on without a terms record opens the terms step and grants nothing until terms, then consent, are agreed', async () => {
    await withLauncher({ terms: false, consent: false, server: clarifyServer }, async ({ tree, kv, sent }) => {
      await openSettings(tree);
      await TestRenderer.act(async () => settings(tree).props.onOpenAIFeatures());
      await press(button(tree, COPY.consentReviewTurnOn));
      h.eq(consentStatus(kv).kind, 'absent', 'no consent grant is stored without a terms record');
      h.ok(on(tree, TermsScreen), 'the terms step opens');
      await press(button(tree, COPY.termsAccept));
      h.eq(consentStatus(kv).kind, 'absent', 'accepting the terms alone grants nothing');
      h.ok(on(tree, ConsentScreen) && tree.root.findByType(ConsentScreen).props.mode === 'ask', 'then the consent screen asks');
      await press(button(tree, COPY.consentAgree));
      h.eq([termsStatus(kv).kind, consentStatus(kv).kind], ['accepted', 'granted'], 'agreeing stores both records');
      h.ok(on(tree, SettingsScreen), 'and returns to Settings');
      h.eq(sent.length, 0, 'no request was sent along the way');
    });
  });

  await h.test('Settings: declining the terms step after "Turn on AI features" returns to Settings with nothing stored', async () => {
    await withLauncher({ terms: false, consent: false, server: clarifyServer }, async ({ tree, kv }) => {
      await openSettings(tree);
      await TestRenderer.act(async () => settings(tree).props.onOpenAIFeatures());
      await press(button(tree, COPY.consentReviewTurnOn));
      await press(button(tree, COPY.termsDecline));
      h.ok(on(tree, SettingsScreen), 'back on Settings');
      h.eq([termsStatus(kv).kind, consentStatus(kv).kind], ['absent', 'absent'], 'no terms record and no grant');
    });
  });
}
