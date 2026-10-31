/** Changing an app while it is in use (`app-launcher` "Changing an app keeps it running and offers
 *  Reload"; system.md §9 Changing in use), driven through the real shell over a real version store
 *  and a scripted server: the change made from the Whim sheet runs while the same launch stays open
 *  and takes touches, the orb's ember follows the stream, a landed change waits behind a toast, an
 *  orb dot and the sheet's row until Reload recreates the realm in place, a failed change says so
 *  without touching the running version, and closing the app leaves the change going. A change sent
 *  from behind the app's tip lands on its continuation, which Reload opens; another app finishing
 *  marks the orb. */
import TestRenderer from 'react-test-renderer';
import { Harness } from './harness';
import { COPY, changedTitle } from '../copy';
import HomeScreen from '../HomeScreen';
import HistoryScreen from '../HistoryScreen';
import MiniAppView from '../MiniAppView';
import FailurePage from '../FailurePage';
import MakingPage from '../MakingPage';
import { DescribePage } from '../DescribePage';
import { PlanPage } from '../PlanPage';
import { JOURNAL_KEY, RunJournalStore } from '../run-journal';
import { AppIndex, type InstalledApp } from '../app-index';
import type { StoreAccess } from '../store-access';
import { Ember } from '../../ui/Ember';
import { stateLine, tileAccessibilityLabel } from '../../ui/AppTile-states';
import { PendingBuildStore, type PendingBuildRecord } from '../pending-builds';
import type { KVBackend } from '../../version-store/fs/kv-fs';
import { PendingPurgeStore } from '../pending-purge';
import { failNativeStorageRemovalsWhen } from './native-storage';
import { afterRelaunch } from './attempt-lifecycle-ui.suite';
import { button, hostType, press, textOf, unmountScreen } from './react-screen';
import { dismissToast, pressToastAction, tile, tileLabels, toastOf } from './home-rig';
import { makingSheetOpen, planLoaded, resultEvent, settle, sseStream, tap, waitFor, withLauncher, type Tree } from './rendered-launcher';
import { startBuild, streamingServer } from './prompt-flow-ui.suite';
import {
  APP_NAME,
  RELOAD_ROW,
  controlsIn,
  hasButton,
  home,
  openSheet,
  openTipSplitter,
  orb,
  runningApp,
  sheetCard,
  showing,
  typeWords,
  versionLine,
} from './whim-sheet-ui.suite';

type Node = TestRenderer.ReactTestInstance;

const WORDS = 'Add a tip slider';
const isWebView = (n: Node) => hostType(n) === 'WebView';

/** The running launch's WebView: the one no untouchable (waiting) slot holds, so a touch reaches it. */
export function boundWebView(tree: Tree): Node {
  const found = tree.root.findAll(isWebView).filter((web) => {
    for (let n: Node | null = web.parent; n !== null; n = n.parent) {
      if (hostType(n) === 'View' && n.props.pointerEvents === 'none') return false;
    }
    return true;
  });
  if (found.length !== 1) throw new Error(`expected one WebView the app's touches reach, got ${found.length}`);
  return found[0];
}

/** The delivery scripts a WebView was handed, and the generation the latest bound its realm at. */
const deliveriesInto = (web: Node): string[] => (web.props.injected as string[]).filter((s) => s.includes('__whimControl.reinject('));
export const generationIn = (web: Node): number => Number(/,generation:(\d+)/.exec(deliveriesInto(web).at(-1) ?? '')?.[1]);

/** A realm's first paint as the outer page forwards it, stamped with `generation`. */
export const paint = (generation: number) => ({ kind: 'paint', trusted: true, payload: { generation, mountToFirstPaintMs: 42, appName: APP_NAME } });
export const send = (onMessage: (e: { nativeEvent: { data: string } }) => void, frame: unknown) =>
  TestRenderer.act(async () => onMessage({ nativeEvent: { data: JSON.stringify(frame) } }));

/** The opening state is up over the app (its page hidden under the cover). */
export const opening = (tree: Tree) =>
  tree.root.findAll((n) => typeof n.type === 'string' && n.props.accessibilityRole === 'progressbar' && n.props.accessibilityLabel === COPY.appBootA11yLabel).length > 0;

/** The bound WebView's page loads, the realm is delivered and paints: the app is open and in use. */
export async function paintRunningApp(tree: Tree): Promise<Node> {
  const web = boundWebView(tree);
  await TestRenderer.act(async () => web.props.onLoadEnd());
  await send(web.props.onMessage, paint(generationIn(web)));
  await waitFor(() => !opening(tree), 'the app to show');
  return web;
}

/** A run as Home lists it: its id, its words, its state. */
const runOf = (rec: PendingBuildRecord) => [rec.id, rec.prompt, rec.state];

/** The change's record says it failed. */
const changeFailed = (kv: KVBackend) => new PendingBuildStore(kv).list().some((r) => r.state === 'failed');

/** What the orb reads after "Whim menu": its state, or '' at rest. */
export const orbState = (tree: Tree) => String(orb(tree).props.accessibilityLabel).slice(COPY.orbMenuOpenLabel.length).replace(/^, /, '');

/** The activity the orb's ember is drawn at. */
const orbActivity = (tree: Tree): number => orb(tree).findByType(Ember).props.activity;

/** From the running app: orb → type → Send → Make the change, the change's stream open. */
export async function makeChange(tree: Tree, streams: readonly unknown[]): Promise<void> {
  const before = streams.length;
  await openSheet(tree);
  await typeWords(tree, WORDS);
  await press(button(tree, COPY.whimSheetSend));
  await waitFor(() => planLoaded(tree), 'the change’s plan');
  await press(button(tree, COPY.planBuildEdit));
  await waitFor(() => streams.length === before + 1, 'the change being made');
}

/** The change on `streams[at]` lands: its result, its stream's end, its record gone. */
async function landChange(tree: Tree, kv: KVBackend, streams: readonly ReturnType<typeof sseStream>[], at: number): Promise<void> {
  streams[at].push(resultEvent(APP_NAME));
  streams[at].end();
  await waitFor(() => new PendingBuildStore(kv).list().length === 0, 'the change delivered');
  await settle();
}

/** From the running app: orb → History → the version before the current one → Use this version →
 *  History's Back. The app opens again, now behind its own tip, and paints. */
async function runBehindTip(tree: Tree, app: InstalledApp): Promise<void> {
  await openSheet(tree);
  await press(button(tree, COPY.actionHistory));
  await waitFor(() => showing(tree, HistoryScreen), 'History');
  const access: StoreAccess = tree.root.findByType(HistoryScreen).props.access;
  const [tip, older] = await access.timeline(app);
  const rowOf = (id: string) => tree.root.find((n) => typeof n.type === 'function' && typeof n.props.onUseVersion === 'function' && n.props.row?.id === id);
  await waitFor(() => tree.root.findAll((n) => typeof n.type === 'function' && n.props.row?.id === older.id).length > 0, 'the older version’s row');
  await TestRenderer.act(async () => rowOf(older.id).props.onToggle());
  await press(button(tree, COPY.historyUseVersion));
  await settle();
  const active = await access.activeId(app);
  if (active !== older.id || active === tip.id) throw new Error('the older version was not restored');
  await press(button(tree, COPY.backLabel));
  await waitFor(() => showing(tree, MiniAppView) && !showing(tree, HistoryScreen), 'the app to open again');
  await paintRunningApp(tree);
}

export async function runChangingInUseUiTests(h: Harness): Promise<void> {
  await h.test('changing in use: Make the change collapses the sheet into the orb; the same launch keeps running in the same realm, shown and taking touches', async () => {
    const streams: ReturnType<typeof sseStream>[] = [];
    await withLauncher({ examples: true, server: streamingServer(streams) }, async ({ tree, sent }) => {
      await openTipSplitter(tree);
      const web = await paintRunningApp(tree);
      const launch = runningApp(tree).props.tappedAt;
      await makeChange(tree, streams);
      h.eq(sent.filter((r) => r.path === '/v1/generate').length, 1, 'the change is being made');
      h.ok(!makingSheetOpen(tree), 'the sheet has collapsed into the orb');
      h.ok(showing(tree, MiniAppView) && !showing(tree, HomeScreen), 'the app is on screen, not Home');
      h.eq(runningApp(tree).props.tappedAt, launch, 'the same launch');
      h.ok(boundWebView(tree) === web && deliveriesInto(web).length === 1, 'in the same WebView, its realm delivered once and never again');
      h.ok(!opening(tree), 'its page shown, not covered');
      h.eq(orbState(tree), COPY.orbStateChanging, 'the orb says a change is being made');
    });
  });

  await h.test('changing in use: the orb’s ember follows the change’s stream: dark until tokens arrive, lit and flickering while they do', async () => {
    const streams: ReturnType<typeof sseStream>[] = [];
    await withLauncher({ examples: true, server: streamingServer(streams) }, async ({ tree }) => {
      await openTipSplitter(tree);
      await paintRunningApp(tree);
      h.eq(orbActivity(tree), 1, 'at rest the ember is fully lit, as everywhere nothing streams');
      await makeChange(tree, streams);
      h.eq(orbActivity(tree), 0, 'a stream that has written nothing yet leaves it at the bottom of its range');
      for (let i = 0; i < 80; i++) streams[0].push({ type: 'token', text: 'x' });
      await waitFor(() => orbActivity(tree) > 0, 'the ember to follow the tokens', 4000);
      h.ok(showing(tree, MiniAppView) && !makingSheetOpen(tree), 'over the running app');
      const pulse = orb(tree).findByType(Ember).props.flicker as { value: number; listen: (fn: () => void) => () => void } | undefined;
      h.ok(pulse !== undefined, 'the orb’s ember reads the change’s flicker pulse');
      let kicks = 0;
      const stop = pulse?.listen(() => { if (pulse.value !== 0) kicks += 1; });
      streams[0].push({ type: 'token', text: 'y' });
      await waitFor(() => kicks > 0, 'a token to flicker the orb');
      stop?.();
      await waitFor(() => orbActivity(tree) === 0, 'the ember to fall back when the stream goes quiet', 4000);
      streams[0].end();
    });
  });

  await h.test('changing in use: a landed change reloads nothing; a toast offers Reload, and the orb dot and the sheet’s row stay after the toast until Reload', async () => {
    const streams: ReturnType<typeof sseStream>[] = [];
    await withLauncher({ examples: true, server: streamingServer(streams) }, async ({ tree, kv }) => {
      await openTipSplitter(tree);
      const web = await paintRunningApp(tree);
      const launch = runningApp(tree).props.tappedAt;
      await makeChange(tree, streams);
      streams[0].push(resultEvent(APP_NAME));
      streams[0].end();
      await waitFor(() => new PendingBuildStore(kv).list().length === 0, 'the change delivered');
      await settle();
      h.eq(toastOf(tree), { message: changedTitle(APP_NAME), action: COPY.actionReload }, '"Tip Splitter changed", with Reload');
      h.ok(runningApp(tree).props.tappedAt === launch && boundWebView(tree) === web && deliveriesInto(web).length === 1, 'the app runs on as it was: nothing reloads by itself');
      h.eq(orbState(tree), COPY.orbStateReady, 'the orb carries the new-version dot');
      await dismissToast(tree);
      h.eq(toastOf(tree), null, 'the toast is gone');
      h.eq(orbState(tree), COPY.orbStateReady, 'the dot stays');
      await openSheet(tree);
      await waitFor(() => hasButton(tree, RELOAD_ROW), 'the Reload row');
      h.eq(controlsIn(tree)[0], RELOAD_ROW, 'on top of the sheet');
    });
  });

  await h.test('changing in use: Reload opens the new version in place — no Home frame, a new WebView and realm at a new generation, the old realm’s late frames refused', async () => {
    const streams: ReturnType<typeof sseStream>[] = [];
    let watching = false;
    const frames: { home: boolean; app: boolean }[] = [];
    const onCommit = (tree: Tree) => {
      if (watching) frames.push({ home: tree.root.findAllByType(HomeScreen).length > 0, app: tree.root.findAllByType(MiniAppView).length > 0 });
    };
    const realNow = Date.now;
    try {
      await withLauncher({ examples: true, server: streamingServer(streams), onCommit }, async ({ tree, kv }) => {
        const app = await openTipSplitter(tree);
        const old = await paintRunningApp(tree);
        const oldGeneration = generationIn(old);
        const fromOld = old.props.onMessage;
        const launch = runningApp(tree).props.tappedAt;
        await makeChange(tree, streams);
        // The change lands a minute later: a version's time is its commit's, to the second.
        Date.now = () => realNow() + 60_000;
        streams[0].push(resultEvent(APP_NAME));
        streams[0].end();
        await waitFor(() => new PendingBuildStore(kv).list().length === 0, 'the change delivered');
        await settle();

        watching = true;
        await pressToastAction(tree);
        await waitFor(() => showing(tree, MiniAppView) && runningApp(tree).props.tappedAt !== launch, 'the app to open again');
        await settle();
        watching = false;
        h.ok(frames.length > 0 && frames.every((f) => f.app && !f.home), `every frame from Reload on shows the app and never Home (${frames.length} frames)`);
        h.eq(runningApp(tree).props.installedApp.id, app.id, 'the same app');
        const fresh = boundWebView(tree);
        h.ok(fresh !== old && !tree.root.findAll(isWebView).includes(old), 'in a new WebView; the old one is gone');
        await TestRenderer.act(async () => fresh.props.onLoadEnd());
        const generation = generationIn(fresh);
        h.ok(Number.isFinite(generation) && generation !== oldGeneration, 'its realm bound at a generation of its own');
        await send(fromOld, paint(generation));
        await send(fromOld, paint(oldGeneration));
        h.ok(opening(tree), 'a paint still queued from the old realm’s WebView opens nothing, even one claiming the new generation');
        await send(fresh.props.onMessage, paint(generation));
        await waitFor(() => !opening(tree), 'the new realm’s own paint to show it');
        h.eq(orbState(tree), '', 'the orb is at rest again');
        await openSheet(tree);
        await waitFor(() => versionLine(tree) === 'Version 2 · changed just now', 'the new version’s line');
        h.ok(!hasButton(tree, RELOAD_ROW), 'on the new version, no Reload');
      });
    } finally {
      Date.now = realNow;
    }
  });

  await h.test('changing in use: the Whim sheet’s Reload row starts closing the sheet at the press, over the running app, before the new version’s bundle is read', async () => {
    const streams: ReturnType<typeof sseStream>[] = [];
    let watching = false;
    const frames: { sheet: boolean; launch: number | undefined }[] = [];
    const onCommit = (tree: Tree) => {
      if (watching) frames.push({ sheet: makingSheetOpen(tree), launch: tree.root.findAllByType(MiniAppView)[0]?.props.tappedAt });
    };
    await withLauncher({ examples: true, server: streamingServer(streams), onCommit }, async ({ tree, kv }) => {
      await openTipSplitter(tree);
      await paintRunningApp(tree);
      const launch = runningApp(tree).props.tappedAt;
      await makeChange(tree, streams);
      streams[0].push(resultEvent(APP_NAME));
      streams[0].end();
      await waitFor(() => new PendingBuildStore(kv).list().length === 0, 'the change delivered');
      await settle();
      await dismissToast(tree);
      await openSheet(tree);
      await waitFor(() => hasButton(tree, RELOAD_ROW), 'the Reload row');
      watching = true;
      await press(button(tree, RELOAD_ROW));
      await waitFor(() => runningApp(tree).props.tappedAt !== launch, 'the app to open again');
      watching = false;
      h.ok(frames.length > 0 && frames.every((f) => !f.sheet), `no frame from the press on wants the sheet (${frames.map((f) => f.sheet).join(', ')})`);
      h.eq(frames[0]?.launch, launch, 'the first of them still shows the launch Reload was pressed in: the sheet goes before the new launch replaces it');
    });
  });

  await h.test('changing in use: a failed change leaves the running version untouched, sets the failed dot and offers See why, which opens its Failure page over the app', async () => {
    const streams: ReturnType<typeof sseStream>[] = [];
    await withLauncher({ examples: true, server: streamingServer(streams) }, async ({ tree, kv }) => {
      await openTipSplitter(tree);
      const web = await paintRunningApp(tree);
      const launch = runningApp(tree).props.tappedAt;
      await makeChange(tree, streams);
      streams[0].push({ type: 'failure', reason: 'The change did not build.', attempts: 1, diagnostics: [] });
      streams[0].end();
      await waitFor(() => changeFailed(kv), 'the change to fail');
      await settle();
      h.ok(!makingSheetOpen(tree), 'nothing takes over the screen');
      h.ok(runningApp(tree).props.tappedAt === launch && boundWebView(tree) === web && deliveriesInto(web).length === 1, 'the running version runs on, untouched');
      h.eq(orbState(tree), COPY.orbStateFailed, 'the orb carries the failed dot');
      h.eq(toastOf(tree), { message: COPY.changeFailedToast, action: COPY.toastSeeWhy }, '"The change didn’t work", with See why');

      await pressToastAction(tree);
      await waitFor(() => showing(tree, FailurePage), 'the Failure page');
      h.ok(makingSheetOpen(tree) && runningApp(tree).props.tappedAt === launch && !showing(tree, HomeScreen), 'in the sheet, over the same running app');
      h.eq(tree.root.findByType(FailurePage).props.changing, true, 'for a change: it says the current version still works');
      h.ok(textOf(tree.root.findByType(FailurePage)).includes(COPY.failureCurrentVersionWorks), 'and says so');
      await press(button(tree, COPY.sheetClose));
      h.ok(!makingSheetOpen(tree) && runningApp(tree).props.tappedAt === launch && boundWebView(tree) === web, 'closing it returns to the same running app');
      h.eq(orbState(tree), COPY.orbStateFailed, 'the dot stays');
    });
  });

  await h.test('changing in use: closing the app mid-change keeps the change going; its tile shows it being changed, and it lands', async () => {
    const streams: ReturnType<typeof sseStream>[] = [];
    await withLauncher({ examples: true, server: streamingServer(streams) }, async ({ tree, kv }) => {
      await waitFor(() => showing(tree, HomeScreen) && home(tree).props.apps.length > 0, 'the example apps');
      const atRest = tile(tree, APP_NAME).props.accessibilityLabel;
      await openTipSplitter(tree);
      await paintRunningApp(tree);
      await makeChange(tree, streams);
      await openSheet(tree);
      await press(button(tree, COPY.whimSheetBackToApps));
      h.ok(showing(tree, HomeScreen) && !showing(tree, MiniAppView) && !makingSheetOpen(tree), 'Home, the app closed, no sheet');
      h.eq(tile(tree, APP_NAME).props.accessibilityLabel, tileAccessibilityLabel(APP_NAME, stateLine('changing', {})), 'its tile shows the change being made');
      streams[0].push(resultEvent(APP_NAME));
      streams[0].end();
      await waitFor(() => new PendingBuildStore(kv).list().length === 0, 'the change delivered');
      await settle();
      h.eq(tile(tree, APP_NAME).props.accessibilityLabel, atRest, 'the change landed: the tile is as it was before');
    });
  });

  await h.test('changing in use: while a change is being made the Whim sheet sends no second one: "Changing…" and Stop the change stand where the send area was, and the change runs on to land with its own record and report', async () => {
    const streams: ReturnType<typeof sseStream>[] = [];
    await withLauncher({ examples: true, server: streamingServer(streams) }, async ({ tree, kv, sent }) => {
      await openTipSplitter(tree);
      await paintRunningApp(tree);
      await makeChange(tree, streams);
      streams[0].push({ type: 'stage', stage: 'generate', status: 'start' });
      await settle();
      const id = new PendingBuildStore(kv).list()[0]!.id;
      const kept = [kv.getString(`pending:${id}`), kv.getString(JOURNAL_KEY(id))];

      await openSheet(tree);
      h.eq(controlsIn(tree), [COPY.actionStopChange, COPY.actionHistory, COPY.reportScreenTitle, COPY.whimSheetBackToApps],
        'Stop the change where the send area was: no field and no Send to start a second change with');
      h.ok(textOf(sheetCard(tree)).includes(COPY.tileChanging), 'under "Changing…"');
      await press(button(tree, COPY.sheetClose));
      const generate = sent.filter((r) => r.path === '/v1/generate');
      h.ok(generate.length === 1 && generate[0].signal?.aborted !== true, 'the change’s one request is still open');
      h.eq([kv.getString(`pending:${id}`), kv.getString(JOURNAL_KEY(id))], kept, 'its record and journal are as they were');

      streams[0].push(resultEvent(APP_NAME));
      streams[0].end();
      await waitFor(() => new PendingBuildStore(kv).list().length === 0, 'the change delivered');
      await settle();
      h.eq(orbState(tree), COPY.orbStateReady, 'it landed');
      h.eq(new RunJournalStore(kv).getLastRun(id)?.filter((entry) => entry.kind === 'stage').map((entry) => entry.stage), ['generate'], 'its own run is the report it left');
      await openSheet(tree);
      h.ok(controlsIn(tree).includes(COPY.whimSheetAsk) && !hasButton(tree, COPY.actionStopChange), 'with nothing being made, the send area is back');
    });
  });

  await h.test('changing in use: Stop the change in the Whim sheet ends the change at once, leaves nothing of it and the app running, and the send area takes its place', async () => {
    const streams: ReturnType<typeof sseStream>[] = [];
    await withLauncher({ examples: true, server: streamingServer(streams) }, async ({ tree, kv, sent }) => {
      await openTipSplitter(tree);
      const web = await paintRunningApp(tree);
      const launch = runningApp(tree).props.tappedAt;
      await makeChange(tree, streams);
      const id = new PendingBuildStore(kv).list()[0]!.id;
      await openSheet(tree);
      await press(button(tree, COPY.actionStopChange));
      h.eq(sent.filter((r) => r.path === '/v1/generate')[0]?.signal?.aborted, true, 'its request is aborted');
      h.eq([new PendingBuildStore(kv).list(), kv.getString(JOURNAL_KEY(id)) ?? null], [[], null], 'a stopped change leaves no record and no journal');
      h.ok(runningApp(tree).props.tappedAt === launch && boundWebView(tree) === web && deliveriesInto(web).length === 1, 'the app runs on as it was');
      h.eq(orbState(tree), '', 'the orb is at rest');
      await waitFor(() => controlsIn(tree).includes(COPY.whimSheetAsk), 'the send area in the open sheet');

      await typeWords(tree, 'Make it purple');
      await press(button(tree, COPY.whimSheetSend));
      await waitFor(() => planLoaded(tree), 'the new change’s plan');
      await press(button(tree, COPY.planBuildEdit));
      await waitFor(() => streams.length === 2, 'the new change being made');
      h.eq(new PendingBuildStore(kv).get(id)?.prompt, 'Make it purple', 'a new change can be sent');
    });
  });

  await h.test('changing in use: History’s Change from here while a change is being made shows that change, and starts no second one', async () => {
    const streams: ReturnType<typeof sseStream>[] = [];
    await withLauncher({ examples: true, server: streamingServer(streams) }, async ({ tree, kv, sent }) => {
      const app = await openTipSplitter(tree);
      await paintRunningApp(tree);
      await makeChange(tree, streams);
      const id = new PendingBuildStore(kv).list()[0]!.id;
      const kept = kv.getString(`pending:${id}`);
      await openSheet(tree);
      await press(button(tree, COPY.actionHistory));
      await waitFor(() => showing(tree, HistoryScreen), 'History');
      await TestRenderer.act(async () => tree.root.findByType(HistoryScreen).props.onChangeIt(app));
      h.ok(!showing(tree, DescribePage) && !showing(tree, PlanPage), 'no page to describe a second change');
      h.ok(showing(tree, MakingPage) && tree.root.findByType(MakingPage).props.words === WORDS, 'the change being made shows instead, its own words');
      h.eq([sent.filter((r) => r.path === '/v1/generate').length, kv.getString(`pending:${id}`)], [1, kept], 'one request, one record, as they were');
    });
  });

  await h.test('changing in use: a failed change’s See why, pressed after a new change of the app started, opens nothing that could start it again', async () => {
    const streams: ReturnType<typeof sseStream>[] = [];
    await withLauncher({ examples: true, server: streamingServer(streams) }, async ({ tree, kv, sent }) => {
      await openTipSplitter(tree);
      await paintRunningApp(tree);
      await makeChange(tree, streams);
      streams[0].push({ type: 'failure', reason: 'The change did not build.', attempts: 1, diagnostics: [] });
      streams[0].end();
      await waitFor(() => changeFailed(kv), 'the change to fail');
      await settle();
      h.eq(toastOf(tree)?.action, COPY.toastSeeWhy, 'its toast offers See why');

      await openSheet(tree);
      await typeWords(tree, 'Make it purple');
      await press(button(tree, COPY.whimSheetSend));
      await waitFor(() => planLoaded(tree), 'the new change’s plan');
      await press(button(tree, COPY.planBuildEdit));
      await waitFor(() => streams.length === 2 && !makingSheetOpen(tree), 'the new change being made');
      const id = new PendingBuildStore(kv).list()[0]!.id;
      const kept = [kv.getString(`pending:${id}`), kv.getString(JOURNAL_KEY(id))];

      await pressToastAction(tree);
      await settle();
      h.ok(!showing(tree, FailurePage) && !makingSheetOpen(tree), 'no Failure page opens over the app');
      h.eq([sent.filter((r) => r.path === '/v1/generate').length, kv.getString(`pending:${id}`), kv.getString(JOURNAL_KEY(id))], [2, ...kept], 'the new change runs on, its record and journal as they were');
      h.eq(orbState(tree), COPY.orbStateChanging, 'and the orb follows it');
    });
  });

  for (const via of ['toast', 'row'] as const) {
    await h.test(`changing in use: a change sent from an app running behind its own tip lands on its continuation with "<name> changed", the dot and the sheet’s row, and the ${via}’s Reload opens that continuation in place`, async () => {
      const streams: ReturnType<typeof sseStream>[] = [];
      let watching = false;
      const homeFrames: boolean[] = [];
      const onCommit = (tree: Tree) => {
        if (watching) homeFrames.push(tree.root.findAllByType(HomeScreen).length > 0);
      };
      const realNow = Date.now;
      try {
        await withLauncher({ examples: true, server: streamingServer(streams), onCommit }, async ({ tree, kv }) => {
          const app = await openTipSplitter(tree);
          await paintRunningApp(tree);
          // Two changes land, each a minute after the last: a version's time is its commit's, to the second.
          for (const at of [0, 1]) {
            await makeChange(tree, streams);
            Date.now = () => realNow() + 60_000 * (at + 1);
            await landChange(tree, kv, streams, at);
            await dismissToast(tree);
          }
          await runBehindTip(tree, app);
          const launch = runningApp(tree).props.tappedAt;
          await makeChange(tree, streams);
          Date.now = () => realNow() + 180_000;
          await landChange(tree, kv, streams, 2);

          const continuation = new AppIndex(kv).list().find((entry) => entry.name === APP_NAME && entry.id !== app.id);
          h.ok(continuation !== undefined, 'the change landed on a new entry continuing the restored version');
          h.ok(runningApp(tree).props.tappedAt === launch && runningApp(tree).props.installedApp.id === app.id, 'the app runs on as it was');
          h.eq(toastOf(tree), { message: changedTitle(APP_NAME), action: COPY.actionReload }, '"Tip Splitter changed", with Reload');
          h.eq(orbState(tree), COPY.orbStateReady, 'the orb carries the new-version dot');
          if (via === 'row') {
            await dismissToast(tree);
            await openSheet(tree);
            await waitFor(() => hasButton(tree, RELOAD_ROW), 'the Reload row');
          }

          watching = true;
          await (via === 'toast' ? pressToastAction(tree) : press(button(tree, RELOAD_ROW)));
          await waitFor(() => showing(tree, MiniAppView) && runningApp(tree).props.tappedAt !== launch, 'the continuation to open');
          await settle();
          watching = false;
          h.eq(runningApp(tree).props.installedApp.id, continuation?.id, 'Reload opens the entry the change landed on');
          h.ok(homeFrames.length > 0 && homeFrames.every((shown) => !shown), `in place: no frame shows Home (${homeFrames.length} frames)`);
          h.eq(orbState(tree), '', 'on the new version the orb is at rest');
        });
      } finally {
        Date.now = realNow;
      }
    });
  }

  await h.test('changing in use: the "<name> changed" toast’s Reload, pressed after the app was opened again behind its tip, opens the continuation the toast told of', async () => {
    const streams: ReturnType<typeof sseStream>[] = [];
    const realNow = Date.now;
    try {
      await withLauncher({ examples: true, server: streamingServer(streams) }, async ({ tree, kv }) => {
        const app = await openTipSplitter(tree);
        await paintRunningApp(tree);
        for (const at of [0, 1]) {
          await makeChange(tree, streams);
          Date.now = () => realNow() + 60_000 * (at + 1);
          await landChange(tree, kv, streams, at);
          await dismissToast(tree);
        }
        await runBehindTip(tree, app);
        await makeChange(tree, streams);
        Date.now = () => realNow() + 180_000;
        await landChange(tree, kv, streams, 2);
        const continuation = new AppIndex(kv).list().find((entry) => entry.name === APP_NAME && entry.id !== app.id);
        h.ok(continuation !== undefined, 'the change landed on a new entry continuing the restored version');

        await openSheet(tree);
        await press(button(tree, COPY.whimSheetBackToApps));
        await tap(() => home(tree).props.onOpen(app));
        await waitFor(() => showing(tree, MiniAppView), 'the app to open again');
        await paintRunningApp(tree);
        const reopened = runningApp(tree).props.tappedAt;
        h.eq(runningApp(tree).props.installedApp.id, app.id, 'the app opened again, still behind its tip');
        h.eq(toastOf(tree), { message: changedTitle(APP_NAME), action: COPY.actionReload }, 'the toast still offers Reload');

        await pressToastAction(tree);
        await waitFor(() => showing(tree, MiniAppView) && runningApp(tree).props.tappedAt !== reopened, 'Reload to open');
        await settle();
        h.eq(runningApp(tree).props.installedApp.id, continuation?.id, 'Reload opens the entry the change landed on');
      });
    } finally {
      Date.now = realNow;
    }
  });

  await h.test('changing in use: another app finishing while one runs puts the ember dot on the orb, reloads nothing and covers nothing; the dot goes with that launch', async () => {
    const streams: ReturnType<typeof sseStream>[] = [];
    await withLauncher({ examples: true, server: streamingServer(streams) }, async ({ tree, kv }) => {
      await waitFor(() => showing(tree, HomeScreen) && home(tree).props.apps.length > 0, 'the example apps');
      await startBuild(tree, 'A tea timer');
      await press(button(tree, COPY.sheetClose));
      await openTipSplitter(tree);
      const web = await paintRunningApp(tree);
      const launch = runningApp(tree).props.tappedAt;
      h.eq(orbState(tree), '', 'at rest while the other app is being made');

      streams[0].push(resultEvent('Tea Timer'));
      streams[0].end();
      await waitFor(() => new PendingBuildStore(kv).list().length === 0, 'the other app delivered');
      await settle();
      h.ok(new AppIndex(kv).list().some((entry) => entry.name === 'Tea Timer'), 'it is installed');
      h.eq(orbState(tree), COPY.orbStateFinished, 'the orb says an app finished');
      h.ok(runningApp(tree).props.tappedAt === launch && boundWebView(tree) === web && deliveriesInto(web).length === 1, 'the running app runs on as it was');
      h.ok(!makingSheetOpen(tree), 'nothing opens over it');

      await openSheet(tree);
      await press(button(tree, COPY.whimSheetBackToApps));
      await openTipSplitter(tree);
      h.eq(orbState(tree), '', 'opened again, the orb is at rest');
    });
  });

  // The phone's storage refusing to remove a change's record or journal: the removal throws, or says it
  // did and did not.
  for (const fault of ['return-false', 'throw'] as const) {
    const refusing = (on: () => boolean) => failNativeStorageRemovalsWhen(({ id, key }) =>
      (on() && id === 'whim.launcher' && (key.startsWith('pending:') || key.startsWith('journal:')) ? fault : undefined));

    await h.test(`changing in use: Stop the change whose record cannot be removed (${fault}) still ends it: the orb, the sheet and Home stop showing it, and a new change of the app starts`, async () => {
      const streams: ReturnType<typeof sseStream>[] = [];
      let refuse = false;
      await withLauncher({ examples: true, server: streamingServer(streams) }, async ({ tree, kv, sent }) => {
        const clear = refusing(() => refuse);
        try {
          await waitFor(() => showing(tree, HomeScreen) && home(tree).props.apps.length > 0, 'the example apps');
          const atRest = tile(tree, APP_NAME).props.accessibilityLabel;
          await openTipSplitter(tree);
          await paintRunningApp(tree);
          await makeChange(tree, streams);
          const id = new PendingBuildStore(kv).list()[0]!.id;
          refuse = true;
          await openSheet(tree);
          await press(button(tree, COPY.actionStopChange));
          await settle();
          h.ok(kv.getString(`pending:${id}`) != null, 'its record is still in storage');
          h.eq(sent.filter((r) => r.path === '/v1/generate')[0]?.signal?.aborted, true, 'its request is aborted');
          h.eq(orbState(tree), '', 'the orb is at rest');
          await waitFor(() => controlsIn(tree).includes(COPY.whimSheetAsk), 'the send area in the open sheet');

          await typeWords(tree, 'Make it purple');
          await press(button(tree, COPY.whimSheetSend));
          await waitFor(() => planLoaded(tree), 'the new change’s plan');
          await press(button(tree, COPY.planBuildEdit));
          await waitFor(() => streams.length === 2, 'the new change being made');
          h.eq([new PendingBuildStore(kv).get(id)?.prompt, orbState(tree)], ['Make it purple', COPY.orbStateChanging], 'a new change of the app starts, and the orb follows it');
          streams[1].push(resultEvent(APP_NAME));
          streams[1].end();
          await waitFor(() => toastOf(tree)?.message === changedTitle(APP_NAME), 'the new change to land');
          await openSheet(tree);
          await press(button(tree, COPY.whimSheetBackToApps));
          h.eq(tile(tree, APP_NAME).props.accessibilityLabel, atRest, 'Home shows the app at rest, nothing being made');
        } finally {
          clear();
        }
      });
    });

    await h.test(`changing in use: what a stopped change left in storage (${fault}) stays out of sight and the next launch removes it`, async () => {
      const streams: ReturnType<typeof sseStream>[] = [];
      let refuse = false;
      await withLauncher({ examples: true, server: streamingServer(streams) }, async ({ tree, kv }) => {
        const clear = refusing(() => refuse);
        let id = '';
        try {
          await waitFor(() => showing(tree, HomeScreen) && home(tree).props.apps.length > 0, 'the example apps');
          const atRest = tile(tree, APP_NAME).props.accessibilityLabel;
          const tilesBefore = tileLabels(tree);
          await openTipSplitter(tree);
          await paintRunningApp(tree);
          await makeChange(tree, streams);
          id = new PendingBuildStore(kv).list()[0]!.id;
          refuse = true;
          await openSheet(tree);
          await press(button(tree, COPY.actionStopChange));
          await settle();
          h.ok(kv.getString(`pending:${id}`) != null, 'its record is still in storage');
          await press(button(tree, COPY.whimSheetBackToApps));
          h.ok(showing(tree, HomeScreen) && tile(tree, APP_NAME).props.accessibilityLabel === atRest, 'Home shows the app at rest');
          h.eq(tileLabels(tree), tilesBefore, 'and no tile for the stopped change');
        } finally {
          clear();
        }
        await afterRelaunch(async (next) => {
          h.eq([kv.getString(`pending:${id}`) ?? null, kv.getString(JOURNAL_KEY(id)) ?? null], [null, null], 'the next launch removed its record and journal');
          h.eq(new PendingBuildStore(kv).list(), [], 'and left no order entry');
          h.eq(new PendingPurgeStore(kv).list(), [], 'and nothing armed');
          h.eq(next.root.findByType(HomeScreen).props.pending, [], 'Home shows nothing of it');
        });
      });
    });

    await h.test(`changing in use: a new change made after a stopped one left its record (${fault}) is spared by the next launch: it comes back interrupted, with its journal`, async () => {
      const streams: ReturnType<typeof sseStream>[] = [];
      let refuse = false;
      await withLauncher({ examples: true, server: streamingServer(streams) }, async ({ tree, kv }) => {
        const clear = refusing(() => refuse);
        let id = '';
        try {
          await openTipSplitter(tree);
          await paintRunningApp(tree);
          await makeChange(tree, streams);
          id = new PendingBuildStore(kv).list()[0]!.id;
          refuse = true;
          await openSheet(tree);
          await press(button(tree, COPY.actionStopChange));
          await settle();
          h.ok(kv.getString(`pending:${id}`) != null && new PendingPurgeStore(kv).has('attempt', id), 'its record is still in storage, its purge armed');
          refuse = false;
          await waitFor(() => controlsIn(tree).includes(COPY.whimSheetAsk), 'the send area in the open sheet');
          await press(button(tree, COPY.sheetClose));
          await makeChange(tree, streams);
          streams[1].push({ type: 'stage', stage: 'generate', status: 'start' });
          await settle();
          h.eq(new PendingBuildStore(kv).get(id)?.state, 'building', 'a new change of the app is being made');
        } finally {
          clear();
        }
        await unmountScreen(tree);
        await afterRelaunch(async (next) => {
          h.eq(next.root.findByType(HomeScreen).props.pending.map(runOf), [[id, WORDS, 'interrupted']], 'the new change comes back interrupted, not purged');
          h.ok((new RunJournalStore(kv).get(id) ?? []).length > 0, 'with its journal');
          h.eq(new PendingPurgeStore(kv).list(), [], 'and the stopped change’s marker is gone');
        });
      });
    });

    await h.test(`changing in use: a change delivered whose record cannot be removed (${fault}) lands as delivered: its toast, the dot, never a failure; the next change starts and the next launch removes what was left`, async () => {
      const streams: ReturnType<typeof sseStream>[] = [];
      let refuse = false;
      await withLauncher({ examples: true, server: streamingServer(streams) }, async ({ tree, kv, sent }) => {
        const clear = refusing(() => refuse);
        let id = '';
        try {
          await openTipSplitter(tree);
          await paintRunningApp(tree);
          await makeChange(tree, streams);
          id = new PendingBuildStore(kv).list()[0]!.id;
          refuse = true;
          streams[0].push(resultEvent(APP_NAME));
          streams[0].end();
          await waitFor(() => toastOf(tree) !== null, 'the change to end');
          await settle();
          h.ok(kv.getString(`pending:${id}`) != null, 'its record is still in storage');
          h.eq(toastOf(tree), { message: changedTitle(APP_NAME), action: COPY.actionReload }, '"Tip Splitter changed", with Reload');
          h.eq(orbState(tree), COPY.orbStateReady, 'the orb carries the new-version dot');
          h.ok(new PendingBuildStore(kv).list().every((rec) => rec.state !== 'failed'), 'no failure recorded');
          await openSheet(tree);
          h.ok(hasButton(tree, RELOAD_ROW) && controlsIn(tree).includes(COPY.whimSheetAsk), 'the sheet offers Reload and takes a new change');
          await press(button(tree, COPY.sheetClose));

          refuse = false;
          await makeChange(tree, streams);
          h.eq(sent.filter((r) => r.path === '/v1/generate').length, 2, 'a new change of the app starts');
          await openSheet(tree);
          await press(button(tree, COPY.actionStopChange));
        } finally {
          clear();
        }
        await afterRelaunch(async (next) => {
          h.eq([kv.getString(`pending:${id}`) ?? null, kv.getString(JOURNAL_KEY(id)) ?? null], [null, null], 'the next launch removed its record and journal');
          h.eq(new PendingPurgeStore(kv).list(), [], 'and nothing armed');
          h.eq(next.root.findByType(HomeScreen).props.pending, [], 'Home shows nothing of it');
        });
      });
    });
  }
}
