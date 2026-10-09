/** The shell's native stack in the rendered launcher (design-system-v1 D6, task 14.1; spec
 *  launcher-screen-exits "Pushed shell screens sit on the native stack"): Settings, Advanced, AI
 *  features, History and Report are pushed over Home; every way the platform pops one writes back
 *  to the launcher's machine; a running app is never on the stack; the header and the status bar
 *  follow the screen on top. */
import TestRenderer from 'react-test-renderer';
import { Harness } from './harness';
import HomeScreen from '../HomeScreen';
import SettingsScreen from '../SettingsScreen';
import AdvancedScreen from '../AdvancedScreen';
import HistoryScreen from '../HistoryScreen';
import MiniAppView from '../MiniAppView';
import ReportScreen from '../ReportScreen';
import { poppedEntry } from '../NativeStack';
import { COPY } from '../copy';
import { SHELL_PALETTE } from '../theme';
import { COLORS } from '../../../design/tokens';
import type { InstalledApp } from '../app-index';
import { button, hostType, press } from './react-screen';
import { backListenerCount, hardwareBack, setColorScheme } from './native-host';
import { androidHeaderBack, iosPop, stackIds, stackItems } from './native-screens';
import { json, tap, waitFor, withLauncher, type Tree } from './rendered-launcher';

const nothing = () => json({});
const home = (tree: Tree) => tree.root.findByType(HomeScreen);
const showing = (tree: Tree, type: Parameters<Tree['root']['findAllByType']>[0]) => tree.root.findAllByType(type).length === 1;
const openSettings = (tree: Tree) => TestRenderer.act(async () => home(tree).props.onSettings());
const statusBarStyle = (tree: Tree) => tree.root.find((node) => hostType(node) === 'StatusBar').props.barStyle;
const header = (tree: Tree, id: string) => stackItems(tree).find((item) => item.props.screenId === id)?.props.headerConfig;

/** Every way the platform takes the top screen off: iOS (the header back, the edge or content
 *  swipe), Android's header back, and Android's system back. */
const POPS: readonly [string, (tree: Tree) => Promise<void>][] = [
  ['an iOS pop', (tree) => iosPop(tree)],
  ['Android’s header back', androidHeaderBack],
  ['system back', async () => { await TestRenderer.act(async () => { hardwareBack(); }); }],
];

export async function runNativeStackUiTests(h: Harness): Promise<void> {
  await h.test('native stack: Settings and Advanced push over Home, which stays mounted; each way of popping lands one screen down, and the launcher follows', async () => {
    for (const [way, pop] of POPS) {
      await withLauncher({ server: nothing }, async ({ tree }) => {
        h.eq(stackIds(tree), ['home'], `${way}: Home is the stack’s root`);
        await openSettings(tree);
        h.eq(stackIds(tree), ['home', 'settings'], `${way}: Settings is pushed`);
        await press(button(tree, COPY.settingsAdvancedSectionTitle));
        h.eq(stackIds(tree), ['home', 'settings', 'advanced'], `${way}: Advanced is pushed over Settings`);
        h.ok(showing(tree, HomeScreen) && showing(tree, SettingsScreen), `${way}: the screens under it stay mounted`);
        await pop(tree);
        h.eq([stackIds(tree), showing(tree, AdvancedScreen)], [['home', 'settings'], false], `${way}: one pop leaves Advanced for Settings`);
        await pop(tree);
        h.eq([stackIds(tree), showing(tree, SettingsScreen)], [['home'], false], `${way}: the next leaves Settings for Home`);
      });
    }
  });

  await h.test('native stack: the iOS back menu popping two screens at once lands on Home, and the launcher follows', async () => {
    await withLauncher({ server: nothing }, async ({ tree }) => {
      await openSettings(tree);
      await press(button(tree, COPY.settingsAdvancedSectionTitle));
      await iosPop(tree, 2);
      h.eq(stackIds(tree), ['home'], 'Home, with nothing left pushed');
    });
    h.eq([poppedEntry(2, 1), poppedEntry(2, 2), poppedEntry(3, 2), poppedEntry(2, 9)], [2, 1, 2, 1], 'a pop leaves through the lowest screen it took, never the root');
  });

  await h.test('native stack: AI features and Report are pushed over Settings; Report from History over History; back returns to where each was opened', async () => {
    await withLauncher({ examples: true, server: nothing }, async ({ tree }) => {
      await waitFor(() => showing(tree, HomeScreen) && home(tree).props.apps.length > 0, 'the example apps');
      const app: InstalledApp = home(tree).props.apps[0];
      await openSettings(tree);
      await press(button(tree, COPY.settingsAISectionTitle));
      h.eq(stackIds(tree), ['home', 'settings', 'consent'], 'AI features over Settings');
      await iosPop(tree);
      await press(button(tree, COPY.settingsReportProblem));
      h.eq(stackIds(tree), ['home', 'settings', 'report'], 'Report over Settings');
      await androidHeaderBack(tree);
      h.eq(stackIds(tree), ['home', 'settings'], 'back to Settings');
      await TestRenderer.act(async () => tree.root.findByType(SettingsScreen).props.onBack());
      await TestRenderer.act(async () => home(tree).props.onHistory(app));
      h.eq(stackIds(tree), ['home', 'history'], 'History over Home');
      await TestRenderer.act(async () => tree.root.findByType(HistoryScreen).props.onReport());
      h.eq(stackIds(tree), ['home', 'history', 'report'], 'Report over History');
      h.eq(tree.root.findByType(ReportScreen).props.app.id, app.id, 'reporting the app History is about');
      await iosPop(tree);
      h.eq(stackIds(tree), ['home', 'history'], 'back to History');
      await iosPop(tree);
      h.eq([stackIds(tree), showing(tree, HistoryScreen)], [['home'], false], 'a swipe takes History back to Home');
    });
  });

  await h.test('native stack: a running app is never on it — no screen to swipe away — and its Android back keeps its own seam', async () => {
    await withLauncher({ examples: true, server: nothing }, async ({ tree }) => {
      await waitFor(() => showing(tree, HomeScreen) && home(tree).props.apps.length > 0, 'the example apps');
      await tap(() => home(tree).props.onOpen(home(tree).props.apps[0]));
      await waitFor(() => showing(tree, MiniAppView), 'the app to open');
      h.eq(stackIds(tree), [], 'the app is a full-screen layer, with no stack under it to pop');
      h.eq(backListenerCount(), 1, 'Android back has one listener: the running app’s own seam (in-app depth, then close)');
    });
  });

  await h.test('native stack: pushed screens carry the platform header (Settings with its large title); Home and History draw their own', async () => {
    await withLauncher({ examples: true, server: nothing }, async ({ tree }) => {
      await waitFor(() => showing(tree, HomeScreen) && home(tree).props.apps.length > 0, 'the example apps');
      await openSettings(tree);
      h.eq(header(tree, 'home').hidden, true, 'Home has no platform header');
      h.eq([header(tree, 'settings').title, header(tree, 'settings').largeTitle], [COPY.settingsTitle, true], 'Settings: its title, large on iOS');
      await press(button(tree, COPY.settingsAdvancedSectionTitle));
      h.eq([header(tree, 'advanced').title, header(tree, 'advanced').largeTitle, header(tree, 'advanced').hidden], [COPY.settingsAdvancedSectionTitle, false, undefined], 'Advanced: its title in the bar');
      await TestRenderer.act(async () => tree.root.findByType(SettingsScreen).props.onBack());
      await TestRenderer.act(async () => home(tree).props.onHistory(home(tree).props.apps[0]));
      h.eq(header(tree, 'history').hidden, true, 'History draws its own header with its own back');
    });
  });

  await h.test('native stack: in dark mode the token screens’ header and the status bar follow the scheme, while Home keeps the light shell', async () => {
    try {
      await withLauncher({ server: nothing }, async ({ tree }) => {
        await TestRenderer.act(async () => setColorScheme('dark'));
        const barStyle = () => statusBarStyle(tree);
        h.eq(barStyle(), 'dark-content', 'Home still draws the light shell, so dark status-bar content');
        await openSettings(tree);
        h.eq(barStyle(), 'light-content', 'Settings follows the dark scheme: light status-bar content');
        h.eq([header(tree, 'settings').backgroundColor, header(tree, 'settings').titleColor], [COLORS.dark.bg, COLORS.dark.text], 'its header is drawn in the dark roles');
        await press(button(tree, COPY.settingsAISectionTitle));
        h.eq(barStyle(), 'dark-content', 'AI features still draws the light shell');
        h.eq(header(tree, 'consent').backgroundColor, SHELL_PALETTE.bg, 'and its header matches it');
      });
    } finally {
      await TestRenderer.act(async () => setColorScheme('light'));
    }
  });
}
