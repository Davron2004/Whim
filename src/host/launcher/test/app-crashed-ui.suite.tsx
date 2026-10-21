/** A running app that crashes (`app-launcher` "A crashed app keeps the orb and offers a way forward";
 *  system.md §9 App crashed), driven through the real shell over a real version store: the crash
 *  screen in the app's place with the orb over it, Reload opening the app again in place in a fresh
 *  realm, "Ask Whim to fix it" opening the Whim sheet with the request prefilled and the error
 *  attached as plain, capped text, and never a second change while one is being made, Back to your
 *  apps, and crash frames from a replaced realm or without the page's authentication changing nothing. */
import TestRenderer from 'react-test-renderer';
import { StyleSheet, type FlexStyle } from 'react-native';
import { Harness } from './harness';
import { chromeInsetBottom } from '../orb-geometry';
import { COPY, appCrashedTitle } from '../copy';
import HomeScreen from '../HomeScreen';
import MiniAppView from '../MiniAppView';
import { AppCrashed } from '../AppCrashed';
import { PlanPage } from '../PlanPage';
import { CRASH_CLASS_MAX } from '../crash-report';
import HistoryScreen from '../HistoryScreen';
import { PendingBuildStore } from '../pending-builds';
import type { StoreAccess } from '../store-access';
import { button, hostType, isHost, press, renderScreen, textOf, unmountScreen } from './react-screen';
import { Platform, setColorScheme } from './native-host';
import { resolveTokens } from '../../ui/tokens-pure';
import { COLORS } from '../../../design/tokens';
import { planLoaded, resultEvent, settle, sseStream, waitFor, withLauncher, type Tree } from './rendered-launcher';
import { streamingServer } from './prompt-flow-ui.suite';
import { dismissToast, pressToastAction, toastOf } from './home-rig';
import { APP_NAME, controlsIn, hasButton, openSheet, openTipSplitter, orb, runningApp, sheetCard, showing } from './whim-sheet-ui.suite';
import { boundWebView, generationIn, makeChange, opening, paint, paintRunningApp, send } from './changing-in-use-ui.suite';
import RENDER_ERROR_FRAME from './render-error-frame.json';

type Node = TestRenderer.ReactTestInstance;

/** The crash screen is up in the app's place. */
const crashShown = (tree: Tree) => tree.root.findAllByType(AppCrashed).length === 1;

/** The crash screen's actions, in the order they are drawn, by the name a screen reader reads. */
const crashActions = (tree: Tree) =>
  tree.root.findByType(AppCrashed).findAll((n) => hostType(n) === 'Pressable').map((n) => String(n.props.accessibilityLabel));

/** The views `node` draws directly inside it: each child component stands for the first view it draws. */
function drawnChildren(node: Node): Node[] {
  const firstView = (n: Node): Node => (typeof n.type === 'string' ? n : firstView(n.children.find((c): c is Node => typeof c !== 'string')!));
  return node.children.filter((c): c is Node => typeof c !== 'string').map(firstView);
}

/** The Whim sheet's field. */
const field = (tree: Tree): Node => sheetCard(tree).find((n) => hostType(n) === 'TextInput' && n.props.accessibilityLabel === COPY.whimSheetAsk);

/** A render error no boundary in the app caught, as the outer page forwards it, the error named `name`. */
const renderError = (name: string) => ({ ...RENDER_ERROR_FRAME, payload: { ...RENDER_ERROR_FRAME.payload, name } });

type OnMessage = (e: { nativeEvent: { data: string } }) => void;

/** Tip Splitter open and painted, then crashed by a render error: the crashed WebView's frame handler,
 *  as RN still holds it once the WebView is gone. */
async function crashRunningApp(tree: Tree, frame: unknown = RENDER_ERROR_FRAME): Promise<OnMessage> {
  await openTipSplitter(tree);
  const fromCrashed = (await paintRunningApp(tree)).props.onMessage as OnMessage;
  await send(fromCrashed, frame);
  await waitFor(() => crashShown(tree), 'the crash screen');
  return fromCrashed;
}

const never = () => new Promise<Response>(() => {});

/** History's components drawing the version `id`'s row. */
const versionRows = (tree: Tree, id: string): Node[] => tree.root.findAll((n) => typeof n.type === 'function' && n.props.row?.id === id);

export async function runAppCrashedUiTests(h: Harness): Promise<void> {
  await h.test('app crashed: its actions draw in the frame’s scheme, not the phone’s — Reload ink, Ask Whim to fix it ember text, Back text — dark over a light phone and light over a dark one', async () => {
    const noop = () => {};
    for (const [phone, frame] of [['light', 'dark'], ['dark', 'light']] as const) {
      await TestRenderer.act(async () => { setColorScheme(phone); });
      const tokens = resolveTokens({ scheme: frame, fontScale: 1, platform: Platform.OS, reduceMotion: false, increaseContrast: false });
      const tree = await renderScreen(<AppCrashed name={APP_NAME} tokens={tokens} bottomClearance={0} behind={false} onReload={noop} onAskFix={noop} onExit={noop} />);
      try {
        const drawn = tree.root.findAll(isHost('Pressable')).map((action) => {
          const capsule = StyleSheet.flatten(action.find(isHost('Animated.View')).props.style) as { backgroundColor?: string };
          const label = StyleSheet.flatten(action.find(isHost('Text')).props.style) as { color?: string };
          return [String(action.props.accessibilityLabel), capsule.backgroundColor, label.color];
        });
        const c = COLORS[frame];
        h.eq(drawn, [
          [COPY.actionReload, c.ink, c['on-ink']],
          [COPY.appCrashedAskFix, 'transparent', c['ember-text']],
          [COPY.launchFailedBack, 'transparent', c.text],
        ], `${frame} actions on a ${phone} phone`);
        h.ok(c.ink !== COLORS[phone].ink && c.text !== COLORS[phone].text, 'the two schemes’ colours differ, so the phone’s would be caught');
      } finally {
        await unmountScreen(tree);
      }
    }
    await TestRenderer.act(async () => { setColorScheme('light'); });
  });

  await h.test('app crashed: a render error puts the crash screen in the app’s place — its name, that it stopped and its data is safe, Reload, Ask Whim to fix it, Back to your apps — and the orb stays', async () => {
    await withLauncher({ examples: true, server: never }, async ({ tree }) => {
      await openTipSplitter(tree);
      const web = await paintRunningApp(tree);
      const launch = runningApp(tree).props.tappedAt;
      await send(web.props.onMessage, RENDER_ERROR_FRAME);
      await waitFor(() => crashShown(tree), 'the crash screen');
      const shown = textOf(tree.root.findByType(AppCrashed));
      h.ok(shown.includes(appCrashedTitle(APP_NAME)) && shown.includes(COPY.appCrashedBody), `"${appCrashedTitle(APP_NAME)}", and that it stopped and the data is safe`);
      h.eq(crashActions(tree), [COPY.actionReload, COPY.appCrashedAskFix, COPY.launchFailedBack], 'Reload, Ask Whim to fix it, Back to your apps, in that order');
      h.ok(!textOf(tree.root).includes(RENDER_ERROR_FRAME.payload.name), 'the error itself is not shown');
      h.ok(showing(tree, MiniAppView) && !showing(tree, HomeScreen) && runningApp(tree).props.tappedAt === launch, 'in the app’s place: the same launch, not Home');
      await press(orb(tree));
      await waitFor(() => hasButton(tree, COPY.whimSheetBackToApps), 'the Whim sheet');
      h.ok(crashShown(tree), 'the orb stays over it and opens the Whim sheet');
    });
  });

  await h.test('app crashed: the mark, title and body are centred in the height the actions leave; the actions sit at the bottom, just above the orb', async () => {
    await withLauncher({ examples: true, server: never }, async ({ tree }) => {
      await crashRunningApp(tree);
      const screen = tree.root.findByType(AppCrashed);
      const scroll = screen.find((n) => typeof n.type === 'string' && n.props.contentContainerStyle !== undefined);
      const content = StyleSheet.flatten(scroll.props.contentContainerStyle) as FlexStyle;
      h.ok((content.flexGrow ?? 0) >= 1, 'the content fills the screen’s height');
      h.ok(content.paddingBottom === screen.props.bottomClearance && screen.props.bottomClearance >= chromeInsetBottom(0),
        `and ends where the orb’s area begins (${String(content.paddingBottom)})`);
      const blocks = drawnChildren(scroll);
      h.eq(blocks.length, 2, 'two blocks: the message, then the actions');
      const [message, actions] = blocks;
      const m = StyleSheet.flatten(message.props.style) as FlexStyle;
      h.ok((m.flexGrow ?? 0) >= 1 && m.justifyContent === 'center' && m.alignItems === 'center',
        'the message takes the height the actions leave and is centred in it');
      h.ok(textOf(message).includes(appCrashedTitle(APP_NAME)) && textOf(message).includes(COPY.appCrashedBody) && message.findAll(isHost('Pressable')).length === 0,
        'it holds the title and body, and no action');
      h.eq(actions.findAll(isHost('Pressable')).map((n) => String(n.props.accessibilityLabel)), [COPY.actionReload, COPY.appCrashedAskFix, COPY.launchFailedBack],
        'the three actions come last, at the bottom');
      h.ok(!((StyleSheet.flatten(actions.props.style) as FlexStyle).flexGrow ?? 0), 'and take only their own height');
    });
  });

  await h.test('app crashed: Reload opens the app again in place — no Home frame, a new launch in a new WebView and realm at a new generation', async () => {
    let watching = false;
    const frames: { home: boolean; app: boolean }[] = [];
    const onCommit = (tree: Tree) => {
      if (watching) frames.push({ home: tree.root.findAllByType(HomeScreen).length > 0, app: tree.root.findAllByType(MiniAppView).length > 0 });
    };
    await withLauncher({ examples: true, server: never, onCommit }, async ({ tree }) => {
      await openTipSplitter(tree);
      const old = await paintRunningApp(tree);
      const oldGeneration = generationIn(old);
      const launch = runningApp(tree).props.tappedAt;
      await send(old.props.onMessage, RENDER_ERROR_FRAME);
      await waitFor(() => crashShown(tree), 'the crash screen');
      watching = true;
      await press(button(tree, COPY.actionReload));
      await waitFor(() => showing(tree, MiniAppView) && runningApp(tree).props.tappedAt !== launch, 'the app to open again');
      await settle();
      watching = false;
      h.ok(frames.length > 0 && frames.every((f) => f.app && !f.home), `every frame from Reload on shows the app and never Home (${frames.length} frames)`);
      h.ok(!crashShown(tree) && opening(tree), 'the crash screen gives way to the app opening');
      const fresh = boundWebView(tree);
      h.ok(fresh !== old && !tree.root.findAll((n) => hostType(n) === 'WebView').includes(old), 'in a new WebView');
      await TestRenderer.act(async () => fresh.props.onLoadEnd());
      const generation = generationIn(fresh);
      h.ok(Number.isFinite(generation) && generation !== oldGeneration, 'its realm bound at a generation of its own');
      await send(fresh.props.onMessage, paint(generation));
      await waitFor(() => !opening(tree), 'the new realm’s own paint to show it');
    });
  });

  await h.test('app crashed: Ask Whim to fix it opens the Whim sheet over the app, the request prefilled and the error attached as one capped line of plain text; sending it reaches the plan', async () => {
    const streams: ReturnType<typeof sseStream>[] = [];
    // The realm names its error: anything, of any length, with direction overrides, line breaks and markup.
    const hostile = `Ledger${String.fromCharCode(0x202e)}Error <b>**x**</b>${String.fromCharCode(10, 0)}${'Z'.repeat(5_000)}`;
    await withLauncher({ examples: true, server: streamingServer(streams) }, async ({ tree, sent }) => {
      await crashRunningApp(tree, renderError(hostile));
      const launch = runningApp(tree).props.tappedAt;
      await press(button(tree, COPY.appCrashedAskFix));
      await waitFor(() => hasButton(tree, COPY.whimSheetBackToApps), 'the Whim sheet');
      const words = String(field(tree).props.value);
      const lead = `${COPY.appCrashedFixRequest}\n\n`;
      h.ok(words.startsWith(lead), 'the field holds "Fix the error that stops this app.", the error under it');
      const attached = words.slice(lead.length);
      h.ok(attached.startsWith('Error: Ledger Error <b>**x**</b> ZZZ') && attached.endsWith('… (render)'),
        `the error’s class and where it failed, its markup kept as plain characters (${attached.slice(0, 60)}…)`);
      h.ok(Array.from(attached).every((ch) => ch.charCodeAt(0) >= 0x20 && ch.charCodeAt(0) !== 0x202e), 'one line, with no control or direction characters');
      h.ok(Array.from(attached).length <= 'Error: '.length + CRASH_CLASS_MAX + ' (render)'.length && attached.length < 200, `capped (${attached.length} characters of ${hostile.length})`);
      h.ok(crashShown(tree) && runningApp(tree).props.tappedAt === launch && !showing(tree, HomeScreen), 'the app is not closed: its crash screen stays under the sheet');

      await press(button(tree, COPY.whimSheetSend));
      await waitFor(() => planLoaded(tree), 'the change’s plan');
      const clarify = sent.find((r) => r.path === '/v1/clarify');
      h.ok(String(clarify?.body?.prompt).includes(attached), 'the request sent carries the attached error');
      h.ok(textOf(tree.root.findByType(PlanPage)).includes('<b>**x**</b>'), 'the plan quotes it as text, not as markup');
      h.ok(crashShown(tree) && runningApp(tree).props.tappedAt === launch, 'over the same crashed launch');
    });
  });

  await h.test('app crashed: Ask Whim to fix it while a change of the app is being made shows that change, with no field to send a second one, and starts nothing', async () => {
    const streams: ReturnType<typeof sseStream>[] = [];
    await withLauncher({ examples: true, server: streamingServer(streams) }, async ({ tree, kv, sent }) => {
      await openTipSplitter(tree);
      const web = await paintRunningApp(tree);
      await makeChange(tree, streams);
      const id = new PendingBuildStore(kv).list()[0]!.id;
      const kept = kv.getString(`pending:${id}`);
      const before = sent.length;
      await send(web.props.onMessage, RENDER_ERROR_FRAME);
      await waitFor(() => crashShown(tree), 'the crash screen');
      await press(button(tree, COPY.appCrashedAskFix));
      await waitFor(() => hasButton(tree, COPY.whimSheetBackToApps), 'the Whim sheet');
      h.eq(controlsIn(tree), [COPY.actionStopChange, COPY.actionHistory, COPY.reportScreenTitle, COPY.whimSheetBackToApps],
        'the change being made, Stop the change where the send area was');
      h.ok(textOf(sheetCard(tree)).includes(COPY.tileChanging), 'under "Changing…"');
      await settle();
      const changeRequests = sent.slice(before).map((r) => r.path).filter((path) => ['/v1/clarify', '/v1/rewrite', '/v1/generate'].includes(path));
      h.eq([changeRequests, streams.length, kv.getString(`pending:${id}`)], [[], 1, kept],
        'nothing of a change is sent, the change’s one stream runs on and its record is as it was');
    });
  });

  await h.test('app crashed: behind a change that landed unreloaded, the crash screen says a newer version is ready and offers Reload and Back, no fix of the old code’s error; on the new version a crash offers the fix again', async () => {
    const streams: ReturnType<typeof sseStream>[] = [];
    await withLauncher({ examples: true, server: streamingServer(streams) }, async ({ tree, kv }) => {
      await openTipSplitter(tree);
      const web = await paintRunningApp(tree);
      await makeChange(tree, streams);
      streams[0].push(resultEvent(APP_NAME));
      streams[0].end();
      await waitFor(() => new PendingBuildStore(kv).list().length === 0, 'the change delivered');
      await settle();
      await dismissToast(tree);
      const launch = runningApp(tree).props.tappedAt;
      await send(web.props.onMessage, RENDER_ERROR_FRAME);
      await waitFor(() => crashShown(tree), 'the crash screen');
      h.ok(textOf(tree.root.findByType(AppCrashed)).includes(COPY.appCrashedBehindBody), 'it says a newer version is ready');
      h.eq(crashActions(tree), [COPY.actionReload, COPY.launchFailedBack], 'Reload first, then Back to your apps; no Ask Whim to fix it');

      await press(button(tree, COPY.actionReload));
      await waitFor(() => showing(tree, MiniAppView) && runningApp(tree).props.tappedAt !== launch, 'the new version to open');
      const fresh = await paintRunningApp(tree);
      await send(fresh.props.onMessage, RENDER_ERROR_FRAME);
      await waitFor(() => crashShown(tree), 'the new version’s crash screen');
      await settle();
      h.ok(textOf(tree.root.findByType(AppCrashed)).includes(COPY.appCrashedBody), 'on the current version, the crash screen as always');
      h.eq(crashActions(tree), [COPY.actionReload, COPY.appCrashedAskFix, COPY.launchFailedBack], 'with Ask Whim to fix it');
    });
  });

  await h.test('app crashed: an Undo that moved the app after it opened makes its crash screen lead with Reload too, with no fix of the old code’s error', async () => {
    const streams: ReturnType<typeof sseStream>[] = [];
    const realNow = Date.now;
    try {
      await withLauncher({ examples: true, server: streamingServer(streams) }, async ({ tree, kv }) => {
        const app = await openTipSplitter(tree);
        await paintRunningApp(tree);
        await makeChange(tree, streams);
        // The change lands a minute later: a version's time is its commit's, to the second.
        Date.now = () => realNow() + 60_000;
        streams[0].push(resultEvent(APP_NAME));
        streams[0].end();
        await waitFor(() => new PendingBuildStore(kv).list().length === 0, 'the change delivered');
        await settle();
        await dismissToast(tree);
        // History over the app: the version before, then Back, which opens the app again on it.
        await openSheet(tree);
        await press(button(tree, COPY.actionHistory));
        await waitFor(() => showing(tree, HistoryScreen), 'History');
        const access: StoreAccess = tree.root.findByType(HistoryScreen).props.access;
        const [tip, older] = await access.timeline(app);
        await waitFor(() => versionRows(tree, older.id).length > 0, 'the older version’s row');
        const row = versionRows(tree, older.id).find((n) => typeof n.props.onUseVersion === 'function');
        await TestRenderer.act(async () => row?.props.onToggle());
        await press(button(tree, COPY.historyUseVersion));
        await settle();
        await press(button(tree, COPY.backLabel));
        await waitFor(() => showing(tree, MiniAppView) && !showing(tree, HistoryScreen), 'the app to open again');
        const web = await paintRunningApp(tree);
        h.eq(await access.activeId(app), older.id, 'setup: the app runs the older version, current');
        // The switch's Undo, after the app opened again on the version it left.
        h.eq(toastOf(tree)?.action, COPY.toastUndo, 'setup: the switch’s Undo is still offered');
        await pressToastAction(tree);
        await settle();
        h.eq(await access.activeId(app), tip.id, 'setup: the Undo made the newer version current again');
        await send(web.props.onMessage, RENDER_ERROR_FRAME);
        await waitFor(() => crashShown(tree), 'the crash screen');
        h.ok(textOf(tree.root.findByType(AppCrashed)).includes(COPY.appCrashedBehindBody), 'it says a newer version is ready');
        h.eq(crashActions(tree), [COPY.actionReload, COPY.launchFailedBack], 'Reload first, then Back to your apps; no Ask Whim to fix it');
      });
    } finally {
      Date.now = realNow;
    }
  });

  await h.test('app crashed: Back to your apps closes the app to Home', async () => {
    await withLauncher({ examples: true, server: never }, async ({ tree }) => {
      await crashRunningApp(tree);
      await press(button(tree, COPY.launchFailedBack));
      await waitFor(() => showing(tree, HomeScreen), 'Home');
      h.ok(!showing(tree, MiniAppView) && !crashShown(tree), 'the app is closed');
    });
  });

  await h.test('app crashed: a crash frame from the realm Reload replaced, or one the page did not authenticate, leaves the running launch as it is', async () => {
    await withLauncher({ examples: true, server: never }, async ({ tree }) => {
      const fromCrashed = await crashRunningApp(tree);
      await press(button(tree, COPY.actionReload));
      await waitFor(() => !crashShown(tree) && showing(tree, MiniAppView), 'the app to open again');
      const launch = runningApp(tree).props.tappedAt;
      const fresh = await paintRunningApp(tree);
      await send(fromCrashed, RENDER_ERROR_FRAME);
      await send(fresh.props.onMessage, { ...RENDER_ERROR_FRAME, trusted: false });
      await send(fresh.props.onMessage, { kind: 'rejected-forgery', trusted: false, forgedKind: 'error', payload: RENDER_ERROR_FRAME.payload });
      await settle();
      h.ok(!crashShown(tree) && runningApp(tree).props.tappedAt === launch && !opening(tree), 'the replaced realm’s crash and the unauthenticated ones show nothing');
      await send(fresh.props.onMessage, RENDER_ERROR_FRAME);
      await waitFor(() => crashShown(tree), 'the crash screen');
      h.ok(crashShown(tree), 'while the running realm’s own crash does');
    });
  });
}
