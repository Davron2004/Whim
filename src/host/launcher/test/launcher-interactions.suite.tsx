import React from 'react';
import TestRenderer from 'react-test-renderer';
import { Harness } from './harness';
import LauncherRoot from '../LauncherRoot';
import HomeScreen from '../HomeScreen';
import ComposeStep from '../ComposeStep';
import PlanStep from '../PlanStep';
import BuildStep from '../BuildStep';
import SettingsScreen from '../SettingsScreen';
import AdvancedScreen from '../AdvancedScreen';
import { COPY } from '../copy';
import ConsentScreen from '../ConsentScreen';
import { createMmkvBackend } from '../../version-store/fs/mmkv-backend';
import { AppIndex } from '../app-index';
import { SEED_VERSION } from '../seed';
import { grantConsent } from '../ai-consent';
import { acceptTerms } from '../terms-acceptance';
import { acknowledgeOwnServer, saveServerUrl } from '../server-address';
import { resetNativeStorage } from './native-storage';
import { renderScreen, unmountScreen, captureTimeouts, textOf, hostType, press } from './react-screen';
import { testAppInfo } from './client-fixtures';
import { json, settle, waitFor, withLauncher } from './rendered-launcher';
import { chooseRow, dismissToast, longPress, pressToastAction, renderRoot, sheetRows, sheetTitled, tile, tileLabels, toastOf } from './home-rig';
import { accessibilitySettings } from './native-host';
import { open as openNativeDb } from './native-storage';
import MiniAppView from '../MiniAppView';
import { PendingPurgeStore } from '../pending-purge';
import { HomeSkeleton } from '../HomeSkeleton';
import { PendingBuildStore } from '../pending-builds';
import { RunJournalStore } from '../run-journal';
import { StoreAccess } from '../store-access';
import { createPersistentStore } from '../../version-store';
import { tileOf } from '../tile-identity';
import { TINTS } from '../../../design/tokens';

/** The radio (a tint swatch or a glyph) labelled `label` in a sheet. */
const radioNamed = (sheet: TestRenderer.ReactTestInstance, label: string) =>
  sheet.find((n) => hostType(n) === 'Pressable' && n.props.accessibilityRole === 'radio' && n.props.accessibilityLabel === label);

/** The copy made from the app `id`, if the index has one. */
const copyOf = (index: AppIndex, id: string) => index.list().find((a) => a.forkedFrom?.id === id);

export async function runLauncherInteractionTests(h: Harness): Promise<void> {
  for (const change of ['server', 'consent', 'same'] as const) {
    for (const responseKind of ['refusal', 'result'] as const) {
    await h.test(`launcher: detached ${responseKind}, ${change} configuration`, async () => {
    resetNativeStorage();
    const kv = createMmkvBackend('whim.launcher');
    new AppIndex(kv).markSeeded(SEED_VERSION);
    acceptTerms(kv, '2026-09-18T12:00:00.000Z');
    grantConsent(kv, '2026-09-18T12:00:00.000Z');
    acknowledgeOwnServer(kv);
    saveServerUrl(kv, 'https://s1.example');
    const clock = captureTimeouts();
    const originalFetch = globalThis.fetch;
    let finish!: (response: Response) => void;
    const generation = new Promise<Response>(resolve => { finish = resolve; });
    globalThis.fetch = (async (url: string) => {
      if (String(url).endsWith('/health')) return new Response('', { status: 503 });
      if (String(url).endsWith('/clarify')) return new Response(JSON.stringify({ questions: [] }));
      if (String(url).endsWith('/rewrite')) return new Response(JSON.stringify({ rewrittenPrompt: 'A timer', plan: [] }));
      return generation;
    }) as typeof fetch;
    let tree: TestRenderer.ReactTestRenderer | undefined;
    try {
      tree = await renderScreen(<LauncherRoot appInfo={testAppInfo} deviceLocale={() => 'en-US'} />);
      await TestRenderer.act(async () => tree!.root.findByType(HomeScreen).props.onCreate());
      await TestRenderer.act(async () => tree!.root.findByType(ComposeStep).props.onChangeText('A timer'));
      await TestRenderer.act(async () => tree!.root.findByType(ComposeStep).props.onContinue());
      let attempt!: Promise<void>;
      await TestRenderer.act(async () => { attempt = tree!.root.findByType(PlanStep).props.onBuild(); });
      await TestRenderer.act(async () => tree!.root.findByType(BuildStep).props.onBack());
      await TestRenderer.act(async () => tree!.root.findByType(HomeScreen).props.onSettings());
      const advanced = async () => {
        await TestRenderer.act(async () => tree!.root.findByType(SettingsScreen).props.onOpenAdvanced());
        return tree!.root.findByType(AdvancedScreen);
      };
      if (change === 'server') {
        const screen = await advanced();
        await TestRenderer.act(async () => screen.props.onServerUrlChange('https://s2.example'));
      } else if (change === 'consent') {
        await TestRenderer.act(async () => tree!.root.findByType(SettingsScreen).props.onOpenAIFeatures());
        await TestRenderer.act(async () => tree!.root.findByType(ConsentScreen).props.onTurnOff());
        h.eq(clock.count(2000), 0, 'revoking consent cancels retries');
        await TestRenderer.act(async () => tree!.root.findByType(SettingsScreen).props.onOpenAIFeatures());
        await TestRenderer.act(async () => tree!.root.findByType(ConsentScreen).props.onAgree());
      } else {
        const screen = await advanced();
        await TestRenderer.act(async () => screen.props.onServerUrlChange('https://s1.example/'));
      }
      await TestRenderer.act(async () => tree!.root.findByType(SettingsScreen).props.onBack());
      h.eq(tree.root.findByType(HomeScreen).props.offline, change !== 'same', 'new session starts offline; unchanged session stays online');
      h.eq(clock.count(2000), change === 'same' ? 0 : 1, 'only a new offline session has a retry');
      await TestRenderer.act(async () => {
        finish(responseKind === 'refusal'
          ? new Response(JSON.stringify({ error: 'server_busy', hint: 'Try again later' }), { status: 429 })
          : new Response('data: ' + JSON.stringify({ type: 'result', app: {
            name: 'Timer', source: 'export default {}', bundle: 'window.__WHIM_APP_MODULE__ = {};',
            manifest: { capabilities: [] }, schema: { collections: [] },
          } }) + '\n\n', { headers: { 'Content-Type': 'text/event-stream' } }));
        await attempt;
      });
      h.eq(tree.root.findByType(HomeScreen).props.offline, change !== 'same', 'late response cannot validate a different configuration');
      h.eq(clock.count(2000), change === 'same' ? 0 : 1, 'late response preserves the new session retry');
    } finally {
      if (tree) await unmountScreen(tree);
      globalThis.fetch = originalFetch;
      clock.restore();
    }
    });
    }
  }
  await h.test('launcher: current rewrite success cancels retries and beats an in-flight failed probe', async () => {
    resetNativeStorage();
    const kv = createMmkvBackend('whim.launcher');
    new AppIndex(kv).markSeeded(SEED_VERSION);
    acceptTerms(kv, '2026-09-18T12:00:00.000Z');
    grantConsent(kv, '2026-09-18T12:00:00.000Z');
    acknowledgeOwnServer(kv);
    saveServerUrl(kv, 'https://current.example');
    const clock = captureTimeouts();
    const originalFetch = globalThis.fetch;
    let finishProbe!: (response: Response) => void;
    const probe = new Promise<Response>(resolve => { finishProbe = resolve; });
    let probes = 0;
    globalThis.fetch = (async (url: string) => {
      if (String(url).endsWith('/health')) return ++probes === 1 ? new Response('', { status: 503 }) : probe;
      if (String(url).endsWith('/clarify')) return new Response('{}', { status: 502 });
      if (String(url).endsWith('/rewrite')) return new Response(JSON.stringify({ rewrittenPrompt: 'A timer' }));
      throw new Error(`Unexpected request ${url}`);
    }) as typeof fetch;
    let tree: TestRenderer.ReactTestRenderer | undefined;
    try {
      tree = await renderScreen(<LauncherRoot appInfo={testAppInfo} deviceLocale={() => 'en-US'} />);
      h.eq(tree.root.findByType(HomeScreen).props.offline, true, 'startup probe reports offline');
      await TestRenderer.act(async () => clock.fire(2000));
      h.eq(probes, 2, 'retry probe is now in flight');
      await TestRenderer.act(async () => tree!.root.findByType(HomeScreen).props.onCreate());
      await TestRenderer.act(async () => tree!.root.findByType(ComposeStep).props.onChangeText('A timer'));
      await TestRenderer.act(async () => tree!.root.findByType(ComposeStep).props.onContinue());
      await TestRenderer.act(async () => tree!.root.findByType(PlanStep).props.onBack());
      await TestRenderer.act(async () => tree!.root.findByType(ComposeStep).props.onBack());
      h.eq(tree.root.findByType(HomeScreen).props.offline, false, 'successful current rewrite proves connectivity');
      await TestRenderer.act(async () => { finishProbe(new Response('', { status: 503 })); await probe; });
      h.eq(tree.root.findByType(HomeScreen).props.offline, false, 'late failed probe cannot undo current request success');
      h.eq(clock.count(4000), 0, 'no retry or probe timeout survives');
    } finally {
      if (tree) await unmountScreen(tree);
      globalThis.fetch = originalFetch;
      clock.restore();
    }
  });

  await h.test('launcher: typing a server address in Advanced probes the finished address once per typing pause, never a half-typed one, and shows that one result (#130)', async () => {
    resetNativeStorage();
    const kv = createMmkvBackend('whim.launcher');
    new AppIndex(kv).markSeeded(SEED_VERSION);
    acceptTerms(kv, '2026-09-18T12:00:00.000Z');
    grantConsent(kv, '2026-09-18T12:00:00.000Z');
    acknowledgeOwnServer(kv);
    saveServerUrl(kv, 'https://s1.example');
    const clock = captureTimeouts();
    const originalFetch = globalThis.fetch;
    const probed: string[] = [];
    globalThis.fetch = (async (url: string) => {
      if (!String(url).endsWith('/health')) throw new Error(`Unexpected request ${url}`);
      probed.push(String(url));
      return new Response(JSON.stringify({ service: 'whim-server' }));
    }) as typeof fetch;
    let tree: TestRenderer.ReactTestRenderer | undefined;
    try {
      tree = await renderScreen(<LauncherRoot appInfo={testAppInfo} deviceLocale={() => 'en-US'} />);
      await TestRenderer.act(async () => tree!.root.findByType(HomeScreen).props.onSettings());
      await TestRenderer.act(async () => tree!.root.findByType(SettingsScreen).props.onOpenAdvanced());
      h.eq(probed, ['https://s1.example/health'], 'the saved address was probed once, at startup');
      const shown = () => textOf(tree!.root.findByType(AdvancedScreen));
      h.ok(shown().includes(COPY.serverProbeVerified), 'Advanced shows the session’s result for the saved address, with no probe of its own');
      const addressField = () => tree!.root.findByType(AdvancedScreen).find(node => String(node.type) === 'TextInput');
      for (const keystroke of ['https://s', 'https://s2', 'https://s2.', 'https://s2.example']) {
        await TestRenderer.act(async () => addressField().props.onChangeText(keystroke));
      }
      h.eq(probed.length, 1, 'typing probes nothing');
      h.ok(!shown().includes(COPY.serverProbeVerified), 'mid-edit, no result claims anything about the new address');
      await TestRenderer.act(async () => clock.fire(600));
      h.eq(probed.slice(1), ['https://s2.example/health'], 'the pause probes the finished address exactly once');
      h.ok(shown().includes(COPY.serverProbeVerified), 'and that one probe’s result shows under the field');
      await TestRenderer.act(async () => tree!.root.findByType(SettingsScreen).props.onBack());
      h.eq(tree.root.findByType(HomeScreen).props.offline, false, 'the new address is the one the session is online with');
    } finally {
      if (tree) await unmountScreen(tree);
      globalThis.fetch = originalFetch;
      clock.restore();
    }
  });

  // ── Delete and Discard: soft delete on the pending-purge marker (tasks 15.4, spec "Deleting an
  //    app leaves no residue") ──────────────────────────────────────────────────────────────────

  const idle = () => json({});
  const ready = async (tree: TestRenderer.ReactTestRenderer) => waitFor(() => tileLabels(tree).length === 3, 'the three example apps');

  await h.test('delete: the tile leaves at once; Undo restores it whole and it still opens; nothing is removed during the window', async () => {
    await withLauncher({ examples: true, server: idle }, async ({ tree, kv }) => {
      await ready(tree);
      const index = new AppIndex(kv);
      const purges = new PendingPurgeStore(kv);
      const before = tileLabels(tree);
      const record = index.get('water-counter');
      await longPress(tree, 'Water Counter');
      await chooseRow(tree, COPY.actionDelete);
      h.ok(!tileLabels(tree).some((l) => l.startsWith('Water Counter')), 'the tile is gone from the grid at once');
      h.eq(toastOf(tree), { message: 'Water Counter deleted', action: COPY.toastUndo }, 'a toast offers Undo');
      h.eq(index.get('water-counter'), record, 'its record is still whole while Undo is offered');
      h.ok(purges.has('app', 'water-counter'), 'and the purge is armed on its marker');
      await pressToastAction(tree);
      h.eq(tileLabels(tree), before, 'Undo brings the tile back in its place');
      h.ok(!purges.has('app', 'water-counter'), 'the marker is cleared');
      h.eq(index.get('water-counter'), record, 'the record is unchanged');
      await TestRenderer.act(async () => tile(tree, 'Water Counter').props.onPress());
      await waitFor(() => tree.root.findAllByType(MiniAppView).length === 1, 'the restored app to open');
    });
  });

  await h.test('delete: when the 10 s window ends the app’s record is removed, its marker cleared and the tile stays gone', async () => {
    await withLauncher({ examples: true, server: idle }, async ({ tree, kv, clock }) => {
      await ready(tree);
      const index = new AppIndex(kv);
      const purges = new PendingPurgeStore(kv);
      await longPress(tree, 'Water Counter');
      await chooseRow(tree, COPY.actionDelete);
      h.ok(clock.count(10_000) >= 1, 'the Undo toast is running its 10 s');
      h.ok(index.get('water-counter') !== null, 'and nothing is removed while it does');
      await TestRenderer.act(async () => { clock.fire(10_000); });
      await waitFor(() => index.get('water-counter') === null, 'the purge to finish');
      h.eq(purges.list(), [], 'the marker is cleared last');
      h.eq(tileLabels(tree).length, 2, 'the other two apps remain');
      h.eq(toastOf(tree), null, 'and the toast has left');
    });
  });

  await h.test('delete: closing Whim during the window still completes the delete at the next launch, before the grid is drawn', async () => {
    await withLauncher({ examples: true, server: idle }, async ({ tree, kv }) => {
      await ready(tree);
      const index = new AppIndex(kv);
      await longPress(tree, 'Water Counter');
      await chooseRow(tree, COPY.actionDelete);
      await unmountScreen(tree);
      h.ok(index.get('water-counter') !== null, 'the closed process had not finished it');
      h.ok(new PendingPurgeStore(kv).has('app', 'water-counter'), 'closing the toast’s host did not end the window: the marker waits for the next launch');
      const relaunched = await renderRoot(<LauncherRoot appInfo={testAppInfo} deviceLocale={() => 'en-US'} />);
      try {
        await waitFor(() => tileLabels(relaunched).length === 2, 'the relaunched grid');
        h.ok(!tileLabels(relaunched).some((l) => l.startsWith('Water Counter')), 'the app does not reappear');
        h.eq(index.get('water-counter'), null, 'its record is gone');
        h.eq(new PendingPurgeStore(kv).list(), [], 'and its marker with it');
      } finally {
        await unmountScreen(relaunched);
      }
    });
  });

  await h.test('discard: a failed attempt leaves at once with 6 s to Undo; Undo keeps the record, the window’s end removes it and its journal', async () => {
    const attempt = (kv: Parameters<NonNullable<Parameters<typeof withLauncher>[0]['prepare']>>[0]) => {
      const pending = new PendingBuildStore(kv);
      pending.create({ id: 'failed-1', prompt: 'A dice roller game', workingTitle: 'A dice roller' });
      pending.setFailed('failed-1', { reason: 'It did not build.' });
    };
    await withLauncher({ prepare: attempt, server: idle }, async ({ tree, kv, clock }) => {
      await waitFor(() => tileLabels(tree).length === 1, 'the failed attempt');
      const pending = new PendingBuildStore(kv);
      const journal = new RunJournalStore(kv);
      await longPress(tree, 'Dice roller game');
      await chooseRow(tree, COPY.actionDiscard);
      h.eq(tileLabels(tree), [], 'the tile leaves at once');
      h.eq(toastOf(tree), { message: COPY.discardedToast, action: COPY.toastUndo }, 'with a toast offering Undo');
      h.ok(pending.get('failed-1') !== null, 'the record stays while Undo is offered');
      await pressToastAction(tree);
      h.eq(tileLabels(tree), ['Dice roller game, didn’t work'], 'Undo returns the tile');
      await longPress(tree, 'Dice roller game');
      await chooseRow(tree, COPY.actionDiscard);
      await TestRenderer.act(async () => { clock.fire(6_000); });
      await waitFor(() => pending.get('failed-1') === null, 'the discard to finish');
      h.eq(journal.get('failed-1'), null, 'its journal goes with it');
      h.eq(new PendingPurgeStore(kv).list(), [], 'and its marker');
      h.eq(tileLabels(tree), [], 'the tile stays gone');
    });
  });

  await h.test('launch: the skeleton promises no cell for an app whose delete the launch sweep is about to finish', async () => {
    let release: (() => void) | undefined;
    const original = StoreAccess.prototype.remove;
    StoreAccess.prototype.remove = () => new Promise<void>((resolve) => { release = resolve; });
    const kept = { id: 'kept', name: 'Kept', createdAt: 1, lineageId: 'main', record: { appId: 'kept', name: 'Kept', manifest: { capabilities: [] } } };
    const going = { ...kept, id: 'going', name: 'Going', createdAt: 2, record: { appId: 'going', name: 'Going', manifest: { capabilities: [] } } };
    try {
      await withLauncher({ apps: [kept, going], prepare: (kv) => new PendingPurgeStore(kv).armApp(going), server: idle }, async ({ tree }) => {
        await waitFor(() => release !== undefined, 'the sweep to reach the delete');
        h.eq(tree.root.findAllByType(HomeScreen).length, 0, 'the sweep is still running, so the grid is not drawn yet');
        h.eq(tree.root.findByType(HomeSkeleton).props.count, 1, 'and the skeleton draws a cell for the one app that will stay');
        release?.();
        await waitFor(() => tree.root.findAllByType(HomeScreen).length === 1, 'the grid, once the sweep is done');
      });
    } finally {
      release?.();
      StoreAccess.prototype.remove = original;
    }
  });

  await h.test('delete with a screen reader: the Undo toast stays while it is offered, so Undo restores the app whole however long it takes; dismissing the toast completes the delete', async () => {
    accessibilitySettings.screenReader = true;
    try {
      await withLauncher({ examples: true, server: idle }, async ({ tree, kv, clock }) => {
        await ready(tree);
        const index = new AppIndex(kv);
        const purges = new PendingPurgeStore(kv);
        const before = tileLabels(tree);
        const record = index.get('water-counter');
        await longPress(tree, 'Water Counter');
        await chooseRow(tree, COPY.actionDelete);
        await settle();
        h.eq(clock.count(10_000), 0, 'the toast runs no time under a screen reader, and neither does the delete');
        h.eq(toastOf(tree)?.action, COPY.toastUndo, 'Undo is still on offer');
        h.ok(index.get('water-counter') !== null && purges.has('app', 'water-counter'), 'the app is hidden, not removed');
        await pressToastAction(tree);
        h.eq(tileLabels(tree), before, 'Undo brings the tile back in its place');
        h.eq(index.get('water-counter'), record, 'with its record whole');
        h.eq(purges.list(), [], 'and no purge left armed');
        await longPress(tree, 'Water Counter');
        await chooseRow(tree, COPY.actionDelete);
        await settle();
        h.ok(index.get('water-counter') !== null, 'a second delete waits too');
        await dismissToast(tree);
        await waitFor(() => index.get('water-counter') === null, 'the delete to finish once the toast was dismissed');
        h.eq(purges.list(), [], 'its marker is cleared last');
      });
    } finally {
      accessibilitySettings.screenReader = false;
    }
  });

  await h.test('delete: a second delete while the first toast shows completes the first delete at once and keeps the second’s Undo', async () => {
    await withLauncher({ examples: true, server: idle }, async ({ tree, kv }) => {
      await ready(tree);
      const index = new AppIndex(kv);
      const purges = new PendingPurgeStore(kv);
      const record = index.get('tip-splitter');
      await longPress(tree, 'Water Counter');
      await chooseRow(tree, COPY.actionDelete);
      await longPress(tree, 'Tip Splitter');
      await chooseRow(tree, COPY.actionDelete);
      await waitFor(() => index.get('water-counter') === null, 'the first delete to finish when its toast was replaced');
      h.eq(toastOf(tree)?.message, 'Tip Splitter deleted', 'the second toast shows');
      h.ok(index.get('tip-splitter') !== null && purges.has('app', 'tip-splitter'), 'the second app is hidden and whole');
      await pressToastAction(tree);
      h.eq(index.get('tip-splitter'), record, 'its Undo restores it');
      h.ok(tileLabels(tree).some((l) => l.startsWith('Tip Splitter')) && !tileLabels(tree).some((l) => l.startsWith('Water Counter')), 'the second tile is back and the first stays gone');
      h.eq(purges.list(), [], 'no marker left');
    });
  });

  await h.test('delete: deleting the original spares a surviving copy — it stays on the grid with its own data and the shared history', async () => {
    await withLauncher({ examples: true, server: idle }, async ({ tree, kv, clock }) => {
      await ready(tree);
      const index = new AppIndex(kv);
      await longPress(tree, 'Water Counter, example');
      await chooseRow(tree, COPY.actionMakeCopy);
      const startFresh = sheetRows(tree, COPY.copyQuestionTitle).find((r) => String(r.props.accessibilityLabel).startsWith(COPY.copyQuestionFresh))!;
      await press(startFresh);
      await waitFor(() => copyOf(index, 'water-counter') !== undefined, 'the copy');
      const copy = copyOf(index, 'water-counter')!;
      const access = new StoreAccess({ store: createPersistentStore(createMmkvBackend('whim-version-store')), index });
      const historyBefore = (await access.history(copy)).map((s) => s.id);
      h.ok(historyBefore.length > 0, 'the copy has history to lose');
      const keep = (id: string) => openNativeDb({ name: `${id}.db` }).executeSync('CREATE TABLE IF NOT EXISTS kept (x)');
      keep(copy.id);
      keep('water-counter');
      const tables = (id: string) => openNativeDb({ name: `${id}.db` }).executeSync("SELECT name FROM sqlite_master WHERE type = 'table'").rows.length;

      await longPress(tree, 'Water Counter, example');
      await chooseRow(tree, COPY.actionDelete);
      await TestRenderer.act(async () => { clock.fire(10_000); });
      await waitFor(() => index.get('water-counter') === null, 'the original to be removed');
      h.eq(tables('water-counter'), 0, 'the original’s own data went with it');
      h.eq(tileLabels(tree).filter((l) => l.startsWith('Water Counter')), ['Water Counter, copy'], 'the copy is the Water Counter still on the grid');
      h.eq(tables(copy.id), 1, 'with its data');
      h.eq((await access.history(copy)).map((s) => s.id), historyBefore, 'and its history unchanged');
    });
  });

  // ── Customize tile persists on the host, and survives a change ──────────────────────────────

  await h.test('customize tile: the pick is stored as the override, shows on the tile, and survives the app being changed', async () => {
    await withLauncher({ examples: true, server: idle }, async ({ tree, kv }) => {
      await ready(tree);
      const index = new AppIndex(kv);
      await longPress(tree, 'Tip Splitter');
      await chooseRow(tree, COPY.actionCustomize);
      const sheet = sheetTitled(tree, COPY.customizeTitle)!;
      await TestRenderer.act(async () => radioNamed(sheet, 'Violet').props.onPress());
      await TestRenderer.act(async () => radioNamed(sheet, 'music').props.onPress());
      h.eq(index.get('tip-splitter')?.tileOverride, { tint: 'violet', icon: 'music' }, 'stored host-side');
      const plateFill = tile(tree, 'Tip Splitter').findAll((n) => hostType(n) === 'Path')[0].props.fill;
      h.eq(plateFill, TINTS.violet.light, 'and the tile behind the sheet shows it');

      const store = createPersistentStore(createMmkvBackend('whim-version-store'));
      const access = new StoreAccess({ store, index });
      const installed = index.get('tip-splitter')!;
      await access.update(installed, { record: installed.record, bundleSource: 'BUNDLE_V2', prompt: 'make it better' });
      h.eq(tileOf(index.get('tip-splitter')!), { tint: 'violet', icon: 'music' }, 'a change to the app leaves the tile as chosen');
    });
  });

  // ── The offline notice follows the session's connectivity live ─────────────────────────────

  await h.test('offline notice: appears when the server cannot be reached and is gone when a probe succeeds again, with no relaunch; nothing shows before consent', async () => {
    const notices = (tree: TestRenderer.ReactTestRenderer) =>
      tree.root.findAll((n) => hostType(n) === 'View' && n.props.accessibilityLabel === COPY.homeOfflineNotice).length;
    let healthy = false;
    await withLauncher({ health: () => (healthy ? json({ service: 'whim-server' }) : new Response('', { status: 503 })), server: idle }, async ({ tree, clock }) => {
      await waitFor(() => notices(tree) === 1, 'the offline notice');
      healthy = true;
      await TestRenderer.act(async () => { clock.fire(2000); });
      await waitFor(() => notices(tree) === 0, 'the notice to go');
    });
    await withLauncher({ consent: false, health: () => new Response('', { status: 503 }), server: idle }, async ({ tree }) => {
      await settle();
      h.eq(notices(tree), 0, 'before consent the connectivity is unknown, and the notice stays away');
    });
  });
}
