/** The keyboard never hides the field or the action it belongs to (app-launcher "Text input never
 *  hides the content or action it belongs to", beta-1 D3): every launcher screen and sheet with a
 *  text field, rendered on each platform, for how its keyboard comes up and goes away. Android is
 *  rendered both before 15, where the window resizes for the keyboard, and from 15, where the app is
 *  drawn edge to edge and nothing resizes. Native geometry is played in through the host views'
 *  measurements: a frame's place in the window, and a field's place in its scroll content. */
import React from 'react';
import TestRenderer from 'react-test-renderer';
import { Harness } from './harness';
import { COPY } from '../copy';
import { primaryActionLabel } from '../prompt-flow';
import ComposeStep from '../ComposeStep';
import ClarifyStep from '../ClarifyStep';
import PlanStep from '../PlanStep';
import ReportSheet from '../ReportSheet';
import SettingsScreen from '../SettingsScreen';
import { SHELL_PALETTE } from '../theme';
import { SPACING } from '../../../sdk/theme';
import type { InstalledApp } from '../app-index';
import type { StoreAccess } from '../store-access';
import { reportClientOptions } from '../transport-shared';
import { AI_CONSENT_VERSION } from '../release-config';
import { button, press, textOf, unmountScreen } from './react-screen';
import { testAppInfo } from './client-fixtures';
import { Keyboard, Platform, StyleSheet, useSafeAreaInsets, type KeyboardListener } from './native-host';

type Tree = TestRenderer.ReactTestRenderer;
type Node = TestRenderer.ReactTestInstance;
type Rect = readonly [top: number, height: number];

const noop = () => {};

/** Counts calls per callback name. */
function spies() {
  const calls: Record<string, number> = {};
  return { fn: (name: string) => () => { calls[name] = (calls[name] ?? 0) + 1; }, count: (name: string) => calls[name] ?? 0 };
}

function nearest(node: Node, type: string): Node | undefined {
  for (let at: Node | null = node.parent; at; at = at.parent) if (at.type === type) return at;
  return undefined;
}

const isType = (type: string) => (n: Node) => String(n.type) === type;
const field = (tree: Tree) => tree.root.find(isType('TextInput'));
const scrollView = (tree: Tree) => tree.root.find(isType('ScrollView'));
const doneBars = (tree: Tree) => tree.root.findAll(isType('InputAccessoryView'));
/** The frame's empty-space target: the one press target screen readers skip. */
const emptySpace = (tree: Tree) => tree.root.find((n) => String(n.type) === 'Pressable' && n.props.accessible === false);
/** Every frame that pads itself for the keyboard (the one view measured on its page). */
const frames = (tree: Tree) => tree.root.findAll((n) => String(n.type) === 'View' && n.props.collapsable === false);
const flat = (node: Node) => StyleSheet.flatten(node.props.style) as Record<string, unknown>;

interface Device { readonly name: string; readonly os: 'ios' | 'android'; readonly version: string | number }
const IOS: Device = { name: 'iOS', os: 'ios', version: '26.0' };
/** Android 14: `adjustResize` still resizes the window. */
const ANDROID_14: Device = { name: 'Android 14', os: 'android', version: 34 };
/** Android 15 and the acceptance emulator's Android 17: drawn edge to edge, nothing resizes. */
const ANDROID_15: Device = { name: 'Android 15', os: 'android', version: 35 };
const ANDROID_17: Device = { name: 'Android 17', os: 'android', version: 37 };
const DEVICES = [IOS, ANDROID_14, ANDROID_15, ANDROID_17] as const;
/** Whether the device's window stays put when the keyboard opens, so a screen lifts itself. */
const windowStaysPut = (device: Device) => device.os === 'ios' || Number(device.version) >= 35;

/** Where things sit, as the native views would measure them. `frame` is a padding frame's place on
 *  its root's page (which fills the window); `field` and `block` are a field's and a named block's
 *  place in the scroll content. */
interface Geometry { frame: Rect; field: Rect; block?: Rect }
/** A screen's frame sits under the status bar and above the home indicator of an 844-high window. */
const SCREEN_FRAME: Rect = [20, 794];
const KEYBOARD_TOP = 500;

interface Mounted { tree: Tree; geometry: Geometry; scrolls: number[]; focused: () => number }

/** Renders `element` on `device` with the keyboard down, its host views measuring as `geometry`
 *  says, and unmounts and restores the platform after `body`. */
async function on(device: Device, element: React.ReactElement, body: (m: Mounted) => Promise<void>, geometry: Geometry = { frame: SCREEN_FRAME, field: [300, 60] }): Promise<void> {
  const before = { OS: Platform.OS, Version: Platform.Version };
  Platform.OS = device.os;
  Platform.Version = device.version;
  Keyboard.visible = false;
  const scrolls: number[] = [];
  let focusCalls = 0;
  const createNodeMock = (node: React.ReactElement<{ collapsable?: boolean }>) => {
    const type = String(node.type);
    if (type === 'ScrollView') return { scrollTo: ({ y }: { y: number }) => { scrolls.push(y); }, scrollToEnd: noop };
    if (type === 'TextInput') {
      return { focus: () => { focusCalls += 1; }, measureLayout: (_to: unknown, ok: (x: number, y: number, w: number, h: number) => void) => ok(0, geometry.field[0], 350, geometry.field[1]) };
    }
    if (node.props.collapsable === false) {
      return { measure: (cb: (x: number, y: number, w: number, h: number, pageX: number, pageY: number) => void) => cb(0, 0, 390, geometry.frame[1], 0, geometry.frame[0]) };
    }
    return { measureLayout: (_to: unknown, ok: (x: number, y: number, w: number, h: number) => void) => { if (geometry.block) ok(0, geometry.block[0], 350, geometry.block[1]); } };
  };
  try {
    let tree!: Tree;
    await TestRenderer.act(async () => { tree = TestRenderer.create(element, { createNodeMock }); });
    try {
      await body({ tree, geometry, scrolls, focused: () => focusCalls });
    } finally { await unmountScreen(tree); }
  } finally {
    Object.assign(Platform, before);
    Keyboard.visible = false;
  }
}

/** Plays the keyboard coming up (top edge at `KEYBOARD_TOP`) or going away with every event the
 *  platform sends for it: iOS announces the show or hide and the frame change, before the keyboard
 *  moves; Android only the show or hide, after. */
async function keyboard(device: Device, shown: boolean): Promise<void> {
  const top = shown ? KEYBOARD_TOP : 844;
  const events = device.os === 'ios'
    ? [shown ? 'keyboardWillShow' : 'keyboardWillHide', 'keyboardWillChangeFrame'] as const
    : [shown ? 'keyboardDidShow' : 'keyboardDidHide'] as const;
  await TestRenderer.act(async () => { for (const event of events) Keyboard.emit(event, top); });
}

/** Plays the scroll view's own reports: the height it shows, its content's height, an offset. */
const scrollReports = (tree: Tree) => ({
  viewport: (height: number) => TestRenderer.act(async () => scrollView(tree).props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: 390, height } } })),
  content: (height: number) => TestRenderer.act(async () => scrollView(tree).props.onContentSizeChange(390, height)),
  offset: (y: number) => TestRenderer.act(async () => scrollView(tree).props.onScroll({ nativeEvent: { contentOffset: { x: 0, y } } })),
});

/** Hands the scroll view its inner content view, which native mounting would attach. */
function mountContent(tree: Tree): void {
  scrollView(tree).props.innerViewRef.current = {};
}

/** The padding the (single) screen frame carries now. */
const framePadding = (tree: Tree) => flat(frames(tree)[0]).paddingBottom;

/** The frame's padding with the keyboard down, up, then down again. */
async function paddingAcrossKeyboard(tree: Tree, device: Device): Promise<unknown[]> {
  const seen = [framePadding(tree)];
  await keyboard(device, true);
  seen.push(framePadding(tree));
  await keyboard(device, false);
  seen.push(framePadding(tree));
  return seen;
}

/** Presses Done, then empty space; returns how many times the keyboard went away. */
async function dismissBoth(tree: Tree): Promise<number> {
  const before = Keyboard.dismissed;
  await press(button(tree, COPY.keyboardDone));
  await press(emptySpace(tree));
  return Keyboard.dismissed - before;
}

/** A `#rrggbb` or `rgba(r,g,b,a)` colour as 0–255 channels and an alpha. */
function rgba(color: string): [number, number, number, number] {
  const hex = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color);
  if (hex) return [parseInt(hex[1], 16), parseInt(hex[2], 16), parseInt(hex[3], 16), 1];
  const fn = /^rgba\((\d+),(\d+),(\d+),([\d.]+)\)$/.exec(color);
  if (fn) return [Number(fn[1]), Number(fn[2]), Number(fn[3]), Number(fn[4])];
  throw new Error(`not a colour this suite reads: ${color}`);
}

/** WCAG relative luminance of opaque channels. */
function luminance([r, g, b]: readonly number[]): number {
  const lin = (c: number) => (c / 255 <= 0.03928 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** The contrast of `text` on a highlight painted over the field's `background`, as Android paints a
 *  selection. */
function contrastOnHighlight(text: string, highlight: string, background: string): number {
  const [hr, hg, hb, ha] = rgba(highlight);
  const under = rgba(background);
  const painted = [hr, hg, hb].map((c, i) => c * ha + under[i] * (1 - ha));
  const [light, dark] = [luminance(painted), luminance(rgba(text))].sort((a, b) => b - a);
  return (light + 0.05) / (dark + 0.05);
}

/** Lets the report sheet's draft load (`reportDraftFor` reads the store). */
const draftLoaded = () => TestRenderer.act(async () => { await new Promise((r) => setImmediate(r)); });

const APP: InstalledApp = { id: 'timer', name: 'Timer', createdAt: 1, lineageId: 'main', record: { appId: 'timer', name: 'Timer', manifest: { capabilities: [] } } };
const ACCESS = { activeDescription: async () => 'A tea timer', activeSource: async () => 'export default {}' } as unknown as StoreAccess;
/** Four rows: the fourth sits lowest, where the keyboard and the pinned footer meet. */
const ROWS = [
  { label: 'Timer', text: 'Counts down' },
  { label: 'Alert', text: 'Buzzes at zero' },
  { label: 'Look', text: 'A big dial' },
  { label: 'Sound', text: 'A soft chime' },
];
const OTHER_QUESTION = { id: 'cup', question: 'What size is the cup?', options: ['Small', 'Large'], select: 'one', other: true } as const;

const compose = (onContinue = noop, onChangeText = noop) => <ComposeStep text="A tea timer" editing={false} onChangeText={onChangeText} onContinue={onContinue} onBack={noop} />;
const clarify = () => <ClarifyStep prompt="A tea timer" questions={[OTHER_QUESTION]} answers={{}} loading={false} editing={false} onAnswer={noop} onContinue={noop} onBack={noop} />;
const plan = (onChangeRow = noop, onBuild = noop) => <PlanStep rows={ROWS} loading={false} editing={false} onChangeRow={onChangeRow} onBuild={onBuild} onBack={noop} />;
const settings = () => (
  <SettingsScreen
    onBack={noop}
    legalLanguage="en"
    internalBuild
    serverUrl="https://saved.example"
    onServerUrlChange={noop}
    onUseDefaultServer={noop}
    highlighting
    onHighlightingChange={noop}
    consentStatus={{ kind: 'granted', version: AI_CONSENT_VERSION, grantedAt: '2026-09-18' }}
    canProbe={false}
    onOpenAIFeatures={noop}
    errorDetails
    onErrorDetailsChange={noop}
    deviceId="test-device"
    onResetDeviceId={noop}
  />
);
const report = (onClose = noop) => (
  <ReportSheet
    app={APP}
    access={ACCESS}
    options={reportClientOptions({ kind: 'absent' }, 'https://server.test', 'device', testAppInfo)}
    onClose={onClose}
    onUpdateRequired={noop}
    legalLanguage="en"
  />
);
const editFourthRow = (tree: Tree) => press(tree.root.find((n) => String(n.type) === 'TouchableOpacity' && textOf(n).includes('A soft chime')));

export async function runKeyboardShellUiTests(h: Harness): Promise<void> {
  await h.test('compose opens without the keyboard, with the suggestions in view', async () => {
    await on(IOS, <ComposeStep text="" editing={false} onChangeText={noop} onContinue={noop} onBack={noop} />, async ({ tree }) => {
      h.ok(field(tree).props.autoFocus !== true, 'the description field is not focused on open');
      const shown = textOf(tree.root);
      h.ok([COPY.composeChipTimer, COPY.composeChipTracker, COPY.composeChipDice].every((chip) => shown.includes(chip)), 'the suggestions show');
    });
  });

  await h.test('every screen pads its frame by the keyboard where the window stays put (iOS, Android 15+) and nowhere it resizes (Android 14); no scroll view insets itself as well', async () => {
    const screens = [
      { name: 'compose', element: compose(), action: primaryActionLabel('compose', false) },
      { name: 'clarify', element: clarify(), action: primaryActionLabel('clarify', false) },
      { name: 'plan', element: plan(), action: primaryActionLabel('plan', false) },
      { name: 'settings', element: settings(), action: null },
    ];
    const overlap = SCREEN_FRAME[0] + SCREEN_FRAME[1] - KEYBOARD_TOP;
    for (const device of DEVICES) {
      for (const screen of screens) {
        await on(device, screen.element, async ({ tree }) => {
          h.eq(frames(tree).length, 1, `${device.name} ${screen.name}: one frame, the screen's`);
          h.eq(await paddingAcrossKeyboard(tree, device), windowStaysPut(device) ? [0, overlap, 0] : [0, 0, 0],
            `${device.name} ${screen.name}: ${windowStaysPut(device) ? 'the frame ends at the keyboard while it is up' : 'the resized window lifts everything, so nothing pads twice'}`);
          h.ok(scrollView(tree).props.automaticallyAdjustKeyboardInsets !== true, `${device.name} ${screen.name}: the scroll view adds no keyboard inset on top of the frame's padding`);
          if (screen.action) {
            const action = button(tree, screen.action);
            h.ok(nearest(action, 'ScrollView') == null && frames(tree).includes(nearestFrame(action)), `${device.name} ${screen.name}: its action is pinned in the padded frame, below the scrolling content`);
          }
        });
      }
    }
  });

  await h.test('iOS: a keyboard that grows or shrinks while up (another keyboard, a suggestion bar) moves the footer with it', async () => {
    const taller = KEYBOARD_TOP - 60;
    await on(IOS, compose(), async ({ tree }) => {
      await keyboard(IOS, true);
      await TestRenderer.act(async () => { Keyboard.emit('keyboardWillChangeFrame', taller); });
      h.eq(framePadding(tree), SCREEN_FRAME[0] + SCREEN_FRAME[1] - taller, 'the frame ends at the taller keyboard’s top edge');
      await TestRenderer.act(async () => { Keyboard.emit('keyboardWillChangeFrame', KEYBOARD_TOP); });
      h.eq(framePadding(tree), SCREEN_FRAME[0] + SCREEN_FRAME[1] - KEYBOARD_TOP, 'and follows it back down');
    });
  });

  await h.test('compose on iOS: Done, empty space and a drag put the keyboard away without continuing', async () => {
    const s = spies();
    await on(IOS, compose(s.fn('continue'), s.fn('change')), async ({ tree }) => {
      h.eq(field(tree).props.inputAccessoryViewID != null && doneBars(tree).some((bar) => bar.props.nativeID === field(tree).props.inputAccessoryViewID), true, 'the field has a Done bar');
      h.eq(scrollView(tree).props.keyboardDismissMode, 'interactive', 'dragging the content pulls the keyboard down');
      h.eq(scrollView(tree).props.keyboardShouldPersistTaps, 'handled', 'a tap a control handles reaches the control');
      h.eq(await dismissBoth(tree), 2, 'Done and a tap on empty space each put the keyboard away');
      h.eq([s.count('continue'), s.count('change')], [0, 0], 'without continuing or changing the text');
    });
  });

  await h.test('compose on Android: a drag dismisses, there is no Done bar, and empty space puts the keyboard away', async () => {
    const s = spies();
    await on(ANDROID_17, compose(s.fn('continue')), async ({ tree }) => {
      h.eq([scrollView(tree).props.keyboardDismissMode, doneBars(tree).length], ['on-drag', 0], 'a drag dismisses; no Done bar');
      const before = Keyboard.dismissed;
      await press(emptySpace(tree));
      h.eq([Keyboard.dismissed - before, s.count('continue')], [1, 0], 'a tap on empty space puts the keyboard away, without continuing');
    });
  });

  await h.test('plan: editing the 4th row focuses it once mounted, and keeps the whole row (field, Save, Cancel) in view above Build it as the keyboard arrives and as the row grows', async () => {
    const s = spies();
    for (const device of [IOS, ANDROID_14, ANDROID_17]) {
      const geometry: Geometry = { frame: SCREEN_FRAME, field: [630, 60], block: [600, 180] };
      await on(device, plan(s.fn('row'), s.fn('build')), async ({ tree, scrolls, focused }) => {
        const reports = scrollReports(tree);
        await reports.viewport(700);
        await reports.content(1000);
        mountContent(tree);
        await editFourthRow(tree);
        h.eq([field(tree).props.autoFocus, focused()], [undefined, 1], `${device.name}: the row's field takes focus after it mounts, not natively on mount`);
        if (device.os === 'ios') h.ok(doneBars(tree).some((bar) => bar.props.nativeID === field(tree).props.inputAccessoryViewID), 'iOS: its Done bar mounts with it');
        await TestRenderer.act(async () => field(tree).props.onFocus({}));
        await keyboard(device, true);
        await reports.viewport(400);
        h.eq(scrolls.at(-1), 600 + 180 + SPACING.md - 400, `${device.name}: with the keyboard up, the row's bottom (Save and Cancel), not just its field, sits clear above the scroll view's end`);
        geometry.block = [600, 220];
        await reports.content(1040);
        h.eq(scrolls.at(-1), 600 + 220 + SPACING.md - 400, `${device.name}: as typing grows the row, it stays in view`);
        h.ok(nearest(button(tree, primaryActionLabel('plan', false)), 'ScrollView') == null, `${device.name}: Build it stays pinned below the scroll view`);
      }, geometry);
    }
    await on(IOS, plan(s.fn('row'), s.fn('build')), async ({ tree }) => {
      await press(tree.root.find((n) => String(n.type) === 'TouchableOpacity' && textOf(n).includes('A big dial')));
      h.eq(await dismissBoth(tree), 2, 'Done and empty space put the keyboard away');
      h.eq(field(tree).props.value, 'A big dial', 'leaving the row open');
      h.eq([s.count('row'), s.count('build')], [0, 0], 'saving and building nothing');
    });
  });

  await h.test('clarify "Other", and the Settings server field with the helper line under it, are kept in view above the keyboard; one line, so Return puts the keyboard away', async () => {
    // The Settings field names its block: the field, its helper line and the probe's line, 100 tall.
    const cases: [string, React.ReactElement, Geometry, string][] = [
      ['clarify', clarify(), { frame: SCREEN_FRAME, field: [500, 60] }, 'the field'],
      ['settings', settings(), { frame: SCREEN_FRAME, field: [500, 60], block: [500, 100] }, 'the field and its helper line'],
    ];
    for (const device of [IOS, ANDROID_14, ANDROID_17]) {
      for (const [name, element, geometry, shown] of cases) {
        const [top, height] = geometry.block ?? geometry.field;
        await on(device, element, async ({ tree, scrolls }) => {
          const reports = scrollReports(tree);
          await reports.viewport(700);
          await reports.content(1200);
          mountContent(tree);
          await TestRenderer.act(async () => field(tree).props.onFocus({}));
          h.eq(scrolls, [], `${device.name} ${name}: a field already in view is left where it is`);
          await keyboard(device, true);
          await reports.viewport(400);
          h.eq(scrolls.at(-1), top + height + SPACING.md - 400, `${device.name} ${name}: once the keyboard shrinks the scroll view, ${shown} scroll clear above its end`);
          h.eq([field(tree).props.multiline === true, doneBars(tree).length], [false, 0], `${device.name} ${name}: one line, with no Done bar`);
          h.eq(scrollView(tree).props.keyboardShouldPersistTaps, 'handled', `${device.name} ${name}: the controls around it take their taps while typing`);
        }, geometry);
      }
    }
    await on(IOS, clarify(), async ({ tree }) => {
      h.eq(field(tree).props.returnKeyType, 'done', 'Return is its Done');
    });
  });

  await h.test('the report sheet: its dim covers the whole window, bars and keyboard included, its card continues behind the keyboard, and Send and Cancel ride above it', async () => {
    const s = spies();
    const insets = useSafeAreaInsets();
    for (const device of [IOS, ANDROID_14, ANDROID_17]) {
      await on(device, report(s.fn('close')), async ({ tree }) => {
        await draftLoaded();
        const modal = tree.root.find(isType('Modal'));
        h.eq([modal.props.statusBarTranslucent, modal.props.navigationBarTranslucent], [true, true], `${device.name}: the sheet's window reaches under the status bar and the navigation bar`);
        const frame = frames(tree);
        h.eq(frame.length, 1, `${device.name}: one padding frame, the sheet's; the shell inside it pads nothing`);
        h.ok(nearest(frame[0], 'SafeAreaProvider') != null && nearest(frame[0], 'Modal') != null, `${device.name}: the sheet keeps clear of the bars with its own window's insets`);
        const scrim = tree.root.find((n) => String(n.type) === 'Pressable' && n.props.accessibilityRole === 'none');
        h.eq([hostParent(scrim) === frame[0], flat(scrim).position, flat(scrim).top, flat(scrim).bottom], [true, 'absolute', 0, 0],
          `${device.name}: the dim fills the whole window frame`);
        const card = tree.root.find((n) => String(n.type) === 'View' && flat(n).maxHeight === '100%');
        const cardPadding = () => flat(card).paddingBottom;
        const seen = [cardPadding()];
        await keyboard(device, true);
        h.ok(Number(flat(frame[0]).paddingBottom ?? 0) <= 0, `${device.name}: with the keyboard up the frame still runs to the window's bottom, so the dim continues behind the keyboard`);
        seen.push(cardPadding());
        await keyboard(device, false);
        seen.push(cardPadding());
        h.eq(seen, [insets.bottom + SPACING.md, 844 - KEYBOARD_TOP + SPACING.md, insets.bottom + SPACING.md],
          `${device.name}: the card grows down behind the keyboard while it is up, on every Android version too, and drops back`);
        h.ok(nearest(button(tree, COPY.reportSend), 'ScrollView') == null && nearest(button(tree, COPY.cancel), 'ScrollView') == null, `${device.name}: Send and Cancel are pinned below the note`);
        const note = around(field(tree));
        h.eq([note.scrolls, note.doneBarLinked(tree)], [true, device.os === 'ios'], `${device.name}: the note scrolls in the sheet; iOS links a Done bar`);
      }, { frame: [0, 844], field: [300, 90] });
    }
    await on(IOS, report(s.fn('close')), async ({ tree }) => {
      await draftLoaded();
      h.eq(await dismissBoth(tree), 2, 'Done and empty space put the keyboard away');
      h.eq(s.count('close'), 0, 'without closing the sheet');
    });
  });

  await h.test('the header hairline shows once content scrolls beneath it, and the footer hairline while content continues below', async () => {
    await on(IOS, compose(), async ({ tree }) => {
      const reports = scrollReports(tree);
      const lines = () => edgeLines(tree).map(drawn);
      await reports.viewport(600);
      await reports.content(500);
      h.eq(lines(), [false, false], 'all content in view: no hairline');
      await reports.content(900);
      h.eq(lines(), [false, true], 'content running past the footer: its hairline shows');
      await reports.offset(120);
      h.eq(lines(), [true, true], 'scrolled: the header hairline shows too');
      await reports.offset(300);
      h.eq(lines(), [true, false], 'scrolled to the end: only the header hairline');
    });
  });

  await h.test('every launcher field wears Whim’s accent for its caret and selection handles, selected text stays readable on its highlight, it paints its own background, and on iOS a one-line field sets no line height', async () => {
    for (const device of [IOS, ANDROID_17]) {
      const fields: [string, React.ReactElement, (tree: Tree) => Promise<void>][] = [
        ['compose', compose(), async () => {}],
        ['clarify', clarify(), async () => {}],
        ['plan row', plan(), editFourthRow],
        ['settings', settings(), async () => {}],
        ['report note', report(), draftLoaded],
      ];
      for (const [name, element, open] of fields) {
        await on(device, element, async ({ tree }) => {
          await open(tree);
          const input = field(tree);
          h.ok(typeof flat(input).backgroundColor === 'string', `${device.name} ${name}: it paints its own background, which covers Android's default field underline`);
          if (device.os === 'ios') {
            h.eq(input.props.selectionColor, SHELL_PALETTE.accent, `${device.name} ${name}: the accent tints the caret, the handles and the highlight iOS draws translucent itself`);
          } else {
            h.eq([input.props.cursorColor, input.props.selectionHandleColor], [SHELL_PALETTE.accent, SHELL_PALETTE.accent], `${device.name} ${name}: accent caret and selection handles`);
            const contrast = contrastOnHighlight(String(flat(input).color), String(input.props.selectionColor), String(flat(input).backgroundColor));
            h.ok(contrast >= 4.5, `${device.name} ${name}: the text Android paints its highlight over stays readable (${contrast.toFixed(2)}:1, at least 4.5:1)`);
          }
          const oneLineOnIos = device.os === 'ios' && input.props.multiline !== true;
          h.eq(typeof flat(input).lineHeight, oneLineOnIos ? 'undefined' : 'number', `${device.name} ${name}: ${oneLineOnIos ? 'no line height, so iOS keeps its descenders' : 'its type’s line height'}`);
        });
      }
    }
  });

  await h.test('a keyboard frame, a screen’s or a sheet’s, removes every keyboard subscription it added once it unmounts', async () => {
    for (const device of DEVICES) {
      const frameHosts: [string, React.ReactElement, () => Promise<void>, boolean][] = [
        ['compose', compose(), async () => {}, windowStaysPut(device)],
        ['report sheet', report(), draftLoaded, true],
      ];
      for (const [name, element, open, pads] of frameHosts) {
        const before = Keyboard.listening();
        let added: KeyboardListener[] = [];
        await on(device, element, async () => {
          await open();
          added = [...Keyboard.listening()].filter((listener) => !before.has(listener));
        });
        if (pads) h.ok(added.length > 0, `${device.name} ${name}: setup: the frame listens to the keyboard while it pads`);
        const after = Keyboard.listening();
        h.eq(added.filter((listener) => after.has(listener)).length, 0, `${device.name} ${name}: none of the subscriptions it added outlive it`);
      }
    }
  });
}

/** The frame's edge hairlines, header's first, outside the scrolling content. */
const isEdgeLine = (n: Node) => String(n.type) === 'View' && flat(n).height === StyleSheet.hairlineWidth && nearest(n, 'ScrollView') == null;
const edgeLines = (tree: Tree) => emptySpace(tree).findAll(isEdgeLine);
/** Whether a hairline is drawn (it is always laid out). */
const drawn = (line: Node) => flat(line).backgroundColor === SHELL_PALETTE.cardBorder;

/** The host view `node` sits in. */
function hostParent(node: Node): Node | null {
  for (let at: Node | null = node.parent; at; at = at.parent) if (typeof at.type === 'string') return at;
  return null;
}

/** The nearest padding frame around `node`. */
function nearestFrame(node: Node): Node {
  for (let at: Node | null = node.parent; at; at = at.parent) if (String(at.type) === 'View' && at.props.collapsable === false) return at;
  throw new Error('no padding frame around the node');
}

/** Whether a field scrolls, and whether iOS linked its Done bar. */
function around(input: Node) {
  return {
    scrolls: nearest(input, 'ScrollView') != null,
    doneBarLinked: (tree: Tree) => doneBars(tree).some((bar) => bar.props.nativeID != null && bar.props.nativeID === input.props.inputAccessoryViewID),
  };
}
