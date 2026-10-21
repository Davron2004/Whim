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
import ConsentScreen from '../ConsentScreen';
import { COLORS } from '../../../design/tokens';
import type { InstalledApp } from '../app-index';
import { button, hostType, press, textOf } from './react-screen';
import { backListenerCount, hardwareBack, setColorScheme, setFontScale, StyleSheet, windowMetrics } from './native-host';
import { LARGE_TEXT_FROM } from '../../ui/tokens-pure';
import { androidHeaderBack, iosPop, stackIds, stackItems } from './native-screens';
import { firstRunOpen, json, settle, tap, waitFor, withLauncher, type Tree } from './rendered-launcher';

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

  await h.test('native stack: a text size changed while Advanced shows leaves every way back one screen down, to Settings (#218)', async () => {
    for (const [way, pop] of POPS) {
      try {
        await withLauncher({ server: nothing }, async ({ tree }) => {
          await openSettings(tree);
          await press(button(tree, COPY.settingsAdvancedSectionTitle));
          await TestRenderer.act(async () => setFontScale(1.3));
          h.eq(stackIds(tree), ['home', 'settings', 'advanced'], `${way}: the text size changes nothing on the stack`);
          await pop(tree);
          h.eq([stackIds(tree), showing(tree, SettingsScreen), showing(tree, AdvancedScreen)], [['home', 'settings'], true, false], `${way}: back from Advanced lands on Settings`);
          await TestRenderer.act(async () => setFontScale(1));
          await pop(tree);
          h.eq(stackIds(tree), ['home'], `${way}: and the next back on Home`);
        });
      } finally { windowMetrics.fontScale = 1; }
    }
  });

  await h.test('native stack: system back during the age check over Settings cancels the check, even after a text size change remounted Settings (#218)', async () => {
    let answer: (signal: string) => void = () => {};
    const store = () => new Promise<unknown>((resolve) => { answer = resolve; });
    try {
      await withLauncher({ terms: false, consent: false, ageSignal: store, server: nothing }, async ({ tree }) => {
        await openSettings(tree);
        await press(button(tree, COPY.settingsAISectionTitle));
        await press(button(tree, COPY.consentReviewTurnOn));
        h.eq(stackIds(tree), ['home', 'settings'], 'the silent age check runs over Settings');
        await TestRenderer.act(async () => setFontScale(1.3));
        await TestRenderer.act(async () => { hardwareBack(); });
        h.eq([stackIds(tree), showing(tree, SettingsScreen)], [['home', 'settings'], true], 'back cancels the check: Settings stays, Home is not shown');
        await TestRenderer.act(async () => answer('adult'));
        await settle();
        h.ok(!firstRunOpen(tree), 'the check was cancelled: its late answer opens no first-run sheet');
      });
    } finally { windowMetrics.fontScale = 1; }
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

  await h.test('native stack: at large text the iOS back button is its chevron alone, so it never truncates the screen it returns to; at the default size it names it (#218)', async () => {
    for (const [scale, mode] of [[1, undefined], [LARGE_TEXT_FROM, 'minimal'], [3.12, 'minimal']] as const) {
      windowMetrics.fontScale = scale;
      try {
        await withLauncher({ server: nothing }, async ({ tree }) => {
          await openSettings(tree);
          await press(button(tree, COPY.settingsAdvancedSectionTitle));
          h.eq([header(tree, 'settings').backButtonDisplayMode, header(tree, 'advanced').backButtonDisplayMode], [mode, mode], `text at ${scale}×: back over Settings and over Advanced is ${mode ?? 'the platform default'}`);
          h.eq(header(tree, 'advanced').title, COPY.settingsAdvancedSectionTitle, `text at ${scale}×: the screen keeps its title`);
        });
      } finally {
        windowMetrics.fontScale = 1;
      }
    }
  });

  await h.test('native stack: Home, Settings and AI features follow the scheme: the status bar, the header and the screen itself', async () => {
    for (const scheme of ['light', 'dark'] as const) {
      const c = COLORS[scheme];
      const content = scheme === 'dark' ? 'light-content' : 'dark-content';
      try {
        await withLauncher({ server: nothing }, async ({ tree }) => {
          await TestRenderer.act(async () => setColorScheme(scheme));
          const barStyle = () => statusBarStyle(tree);
          h.eq([barStyle(), stackItems(tree).find((item) => item.props.screenId === 'home')?.props.contentStyle.backgroundColor], [content, c.bg], `${scheme}: Home: ${content} status-bar content, its canvas in the scheme's bg`);
          await openSettings(tree);
          h.eq(barStyle(), content, `${scheme}: Settings: ${content} status-bar content`);
          h.eq([header(tree, 'settings').backgroundColor, header(tree, 'settings').titleColor], [c.bg, c.text], `${scheme}: its header is drawn in the scheme's roles`);
          await press(button(tree, COPY.settingsAISectionTitle));
          h.eq(barStyle(), content, `${scheme}: AI features: ${content} status-bar content`);
          h.eq([header(tree, 'consent').backgroundColor, header(tree, 'consent').titleColor], [c.bg, c.text], `${scheme}: its header is drawn in the scheme's roles`);
          const review = tree.root.findByType(ConsentScreen);
          h.eq(StyleSheet.flatten(review.find((n) => hostType(n) === 'View').props.style).backgroundColor, c.bg, `${scheme}: the screen is on the scheme's bg`);
          const title = review.find((n) => hostType(n) === 'Text' && textOf(n) === COPY.consentTitle);
          h.eq(StyleSheet.flatten(title.props.style).color, c.text, `${scheme}: its title in the scheme's text`);
          // With AI features on, the large action keeps them on: a `secondary` button, `text` on `fill`.
          const keep = review.find((n) => hostType(n) === 'Text' && textOf(n) === COPY.consentReviewKeepOn);
          h.eq(StyleSheet.flatten(keep.props.style).color, c.text, `${scheme}: Keep AI features on is labelled in the scheme's text`);
        });
      } finally {
        await TestRenderer.act(async () => setColorScheme('light'));
      }
    }
  });
}
