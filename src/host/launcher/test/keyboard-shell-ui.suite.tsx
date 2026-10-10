/** The keyboard never hides the field or the action it belongs to (app-launcher "Text input never
 *  hides the content or action it belongs to", beta-1 D3, design-system-v1 11.3): every launcher
 *  screen and sheet with a text field, rendered on each platform, for how its keyboard comes up,
 *  moves and goes away. Android is rendered before 15 and from 15: the app is drawn edge to edge on
 *  both, so no window resizes for the keyboard and every frame lifts itself. The keyboard is played
 *  in through react-native-keyboard-controller's events (`native-keyboard-controller.tsx`); native
 *  geometry through the host views' measurements: a frame's place in the window, and a field's
 *  place in its scroll content. */
import React from 'react';
import TestRenderer from 'react-test-renderer';
import { Harness } from './harness';
import { COPY } from '../copy';
import { DescribePage } from '../DescribePage';
import { PlanPage } from '../PlanPage';
import type { PlanScreen } from '../prompt-flow';
import { ReportSheet } from '../ReportScreen';
import { KeyboardTextInput } from '../KeyboardShell';
import AdvancedScreen from '../AdvancedScreen';
import { SHELL_PALETTE } from '../theme';
import { TextArea, TextField } from '../../ui/TextField';
import { Sheet } from '../../ui/Sheet';
import { sheetBottomPadding } from '../keyboard-shell';
import { COLORS, LAYOUT } from '../../../design/tokens';
import { ToastHost } from '../../ui/Toast';
import { SPACING } from '../../../sdk/theme';
import type { InstalledApp } from '../app-index';
import type { StoreAccess } from '../store-access';
import { reportClientOptions } from '../transport-shared';
import { button, freshApp, press, textOf, unmountScreen, hostType } from './react-screen';
import { testAppInfo } from './client-fixtures';
import { Keyboard, Platform, StyleSheet, changeKeyboardFrame, keyboardFrameListenerCount, refuseModalPresentations, setColorScheme, useSafeAreaInsets } from './native-host';
import { dragKeyboard, emitKeyboardEvent, endKeyboard, keyboardSubscriptions, keyboardWindow, moveKeyboard, resetKeyboard, stepKeyboard } from './native-keyboard-controller';

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
/** Android 14, which draws edge to edge only because Whim asks it to (`edgeToEdgeEnabled`). */
const ANDROID_14: Device = { name: 'Android 14', os: 'android', version: 34 };
/** Android 15 and the acceptance emulator's Android 17, which force edge to edge. */
const ANDROID_15: Device = { name: 'Android 15', os: 'android', version: 35 };
const ANDROID_17: Device = { name: 'Android 17', os: 'android', version: 37 };
const DEVICES = [IOS, ANDROID_14, ANDROID_15, ANDROID_17] as const;

/** Where things sit, as the native views would measure them. `frame` is a padding frame's place on
 *  its root's page (which fills the window); `field` and `block` are a field's and a named block's
 *  place in the scroll content. `rootOffset` is how far below the window its root's page starts
 *  (a screen on the native stack: its `measure` counts from a root laid out far below the window). */
interface Geometry {
  frame: Rect; field: Rect; block?: Rect; rootOffset?: number;
  nativeScroll?: { viewport: number; content: number; offset: number };
}

// Native layout can finish after its JS onLayout notification. Advance frames explicitly so
// tests can place the native commit between the notification and a reveal measurement.
const revealFrames = new Map<number, (time: number) => void>();
function flushRevealFrames(): void {
  const pending = [...revealFrames.values()];
  revealFrames.clear();
  for (const callback of pending) callback(0);
}
/** A screen's frame sits under the status bar and above the home indicator of an 844-high window. */
const SCREEN_FRAME: Rect = [20, 794];
const KEYBOARD_TOP = 500;
/** The keyboard's height above the window's bottom edge, as the library reports it. */
const KEYBOARD_HEIGHT = keyboardWindow.height - KEYBOARD_TOP;
/** How far a keyboard whose top edge is at `top` covers a frame at `frame`. */
const overlapOf = (frame: Rect, top: number) => Math.max(0, frame[0] + frame[1] - top);

interface Mounted { tree: Tree; geometry: Geometry; scrolls: number[]; focused: () => number }

/** Renders `element` on `device` with the keyboard down, its host views measuring as `geometry`
 *  says, and unmounts and restores the platform after `body`. */
async function on(device: Device, element: React.ReactElement, body: (m: Mounted) => Promise<void>, geometry: Geometry = { frame: SCREEN_FRAME, field: [300, 60] }): Promise<void> {
  const before = { OS: Platform.OS, Version: Platform.Version };
  const animationFrames = { request: globalThis.requestAnimationFrame, cancel: globalThis.cancelAnimationFrame };
  let frameId = 0;
  globalThis.requestAnimationFrame = (callback) => { revealFrames.set(++frameId, callback); return frameId; };
  globalThis.cancelAnimationFrame = (id) => { if (typeof id === 'number') revealFrames.delete(id); };
  Platform.OS = device.os;
  Platform.Version = device.version;
  resetKeyboard();
  const scrolls: number[] = [];
  let focusCalls = 0;
  const createNodeMock = (node: React.ReactElement<{ collapsable?: boolean }>) => {
    const type = String(node.type);
    if (type === 'ScrollView') return { scrollTo: ({ y }: { y: number }) => {
      scrolls.push(y);
      const native = geometry.nativeScroll;
      if (native) native.offset = Math.max(0, Math.min(y, native.content - native.viewport));
    }, scrollToEnd: noop };
    if (type === 'TextInput') {
      return { focus: () => { focusCalls += 1; }, measureLayout: (_to: unknown, ok: (x: number, y: number, w: number, h: number) => void) => ok(0, geometry.field[0], 350, geometry.field[1]) };
    }
    if (node.props.collapsable === false) {
      return { measure: (cb: (x: number, y: number, w: number, h: number, pageX: number, pageY: number) => void) => cb(0, 0, 390, geometry.frame[1], 0, geometry.frame[0] + (geometry.rootOffset ?? 0)) };
    }
    return { measureLayout: (_to: unknown, ok: (x: number, y: number, w: number, h: number) => void) => { if (geometry.block) ok(0, geometry.block[0], 350, geometry.block[1]); } };
  };
  try {
    let tree!: Tree;
    freshApp();
    await TestRenderer.act(async () => { tree = TestRenderer.create(element, { createNodeMock }); });
    try {
      await body({ tree, geometry, scrolls, focused: () => focusCalls });
    } finally { await unmountScreen(tree); }
  } finally {
    revealFrames.clear();
    globalThis.requestAnimationFrame = animationFrames.request;
    globalThis.cancelAnimationFrame = animationFrames.cancel;
    Object.assign(Platform, before);
    resetKeyboard();
  }
}

/** Plays the keyboard coming up (top edge at `KEYBOARD_TOP`) or going away, through two frames on
 *  the way, with every event the library sends for it on both platforms. */
async function keyboard(_device: Device, shown: boolean): Promise<void> {
  await TestRenderer.act(async () => {
    moveKeyboard(shown ? KEYBOARD_HEIGHT : 0, shown ? [KEYBOARD_HEIGHT / 3, (2 * KEYBOARD_HEIGHT) / 3] : [(2 * KEYBOARD_HEIGHT) / 3, KEYBOARD_HEIGHT / 3]);
    flushRevealFrames();
  });
}

/** Plays the keyboard changing height while up, its top edge moving to `top` (the emoji panel,
 *  another keyboard, a suggestion bar). */
async function keyboardTo(top: number): Promise<void> {
  await TestRenderer.act(async () => {
    moveKeyboard(keyboardWindow.height - top);
    flushRevealFrames();
  });
}

/** Plays the scroll view's own reports: the height it shows, its content's height, an offset. */
const scrollReports = (tree: Tree) => ({
  viewport: (height: number) => TestRenderer.act(async () => { scrollView(tree).props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: 390, height } } }); flushRevealFrames(); }),
  content: (height: number) => TestRenderer.act(async () => { scrollView(tree).props.onContentSizeChange(390, height); flushRevealFrames(); }),
  offset: (y: number) => TestRenderer.act(async () => scrollView(tree).props.onScroll({ nativeEvent: { contentOffset: { x: 0, y } } })),
});

/** Hands the scroll view its inner content view, which native mounting would attach. */
function mountContent(tree: Tree): void {
  scrollView(tree).props.innerViewRef.current = {};
}

/** The view inside a measured frame that carries its keyboard padding. */
const padded = (frame: Node) => frame.find((n) => String(n.type) === 'Animated.View');
/** The padding the (single) screen frame carries now. */
const framePadding = (tree: Tree) => flat(padded(frames(tree)[0])).paddingBottom;

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

/** The background a field paints behind its text: its own, or its box's around it. */
function paintedBackground(input: Node): string | undefined {
  for (let at: Node | null = input; at; at = at.parent) {
    if (typeof at.type !== 'string') continue;
    const fill = flat(at).backgroundColor;
    if (typeof fill === 'string') return fill;
    if (isType('ScrollView')(at)) return undefined;
  }
  return undefined;
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
const PLAN: PlanScreen = { kind: 'plan', text: 'A tea timer', questions: [], answers: {}, asking: false, rewritten: 'A tea timer', rows: ROWS, loading: false, edited: false };

const compose = (onContinue = noop, onChangeText = noop) => <DescribePage text="A tea timer" onChangeText={onChangeText} onContinue={onContinue} />;
const plan = (onChangeRow = noop, onMake = noop) => <PlanPage screen={PLAN} onBack={noop} onAnswer={noop} onChangeRow={onChangeRow} onMake={onMake} onTryAgain={noop} onMakeInstead={noop} />;
/** A page in a real sheet, as the making flow shows it. */
const sheeted = (page: React.ReactElement) => <Sheet visible detent="large" onClose={noop}>{page}</Sheet>;
const sheetCard = (tree: Tree) => tree.root.find((n) => String(n.type) === 'Animated.View' && n.props.accessibilityViewIsModal === true);
const advanced = () => (
  <ToastHost>
    <AdvancedScreen
      onBack={noop}
      errorDetails
      onErrorDetailsChange={noop}
      deviceId="test-device"
      onResetDeviceId={noop}
      serverChoice="own"
      ownServerAcknowledged
      onAcknowledgeOwnServer={noop}
      onChooseServer={noop}
      savedAddress="https://saved.example"
      onServerUrlChange={noop}
      canProbe={false}
      probe={null}
      legalLanguage="en"
    />
  </ToastHost>
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
const editFourthRow = (tree: Tree) => press(tree.root.find((n) => String(n.type) === 'Pressable' && n.props.accessibilityRole === 'button' && textOf(n).includes('A soft chime')));

export async function runKeyboardShellUiTests(h: Harness): Promise<void> {
  await h.test('describe opens with the keyboard: its field takes focus once mounted, and the idea chips wait for the keyboard to go down', async () => {
    for (const device of [IOS, ANDROID_17]) {
      await on(device, <DescribePage text="" onChangeText={noop} onContinue={noop} />, async ({ tree, focused }) => {
        await TestRenderer.act(async () => flushRevealFrames());
        h.ok(focused() >= 1, `${device.name}: the description field is focused on open`);
        const shown = textOf(tree.root);
        h.ok([COPY.homeIdeaTimer, COPY.homeIdeaTracker, COPY.homeIdeaDice].every((chip) => shown.includes(chip)), `${device.name}: with no keyboard up yet, the suggestions show`);
        await keyboard(device, true);
        h.ok(![COPY.homeIdeaTimer, COPY.homeIdeaTracker, COPY.homeIdeaDice].some((chip) => textOf(tree.root).includes(chip)), `${device.name}: with the keyboard up they step aside`);
      });
    }
  });

  await h.test('every screen pads its frame by the keyboard on iOS and every Android version, Android 14 included; no scroll view insets itself as well', async () => {
    const screens = [
      { name: 'advanced', element: advanced(), action: null },
    ];
    const overlap = SCREEN_FRAME[0] + SCREEN_FRAME[1] - KEYBOARD_TOP;
    for (const device of DEVICES) {
      for (const screen of screens) {
        await on(device, screen.element, async ({ tree }) => {
          h.eq(frames(tree).length, 1, `${device.name} ${screen.name}: one frame, the screen's`);
          h.eq(await paddingAcrossKeyboard(tree, device), [0, overlap, 0], `${device.name} ${screen.name}: the frame ends at the keyboard while it is up`);
          h.ok(scrollView(tree).props.automaticallyAdjustKeyboardInsets !== true, `${device.name} ${screen.name}: the scroll view adds no keyboard inset on top of the frame's padding`);
          if (screen.action) {
            const action = button(tree, screen.action);
            h.ok(nearest(action, 'ScrollView') == null && frames(tree).includes(nearestFrame(action)), `${device.name} ${screen.name}: its action is pinned in the padded frame, below the scrolling content`);
          }
        });
      }
    }
  });

  await h.test('a screen measured mid-push, still below the window, pads nothing when a sheet opening reports the keyboard down (Android native stack)', async () => {
    // The native stack slides a pushed screen in; measured on its first layout, its frame still sat
    // off the bottom of the window. A sheet opening then reports the keyboard at 0 with no show event,
    // so nothing re-measured: the padding must not swallow the screen.
    const midPush: Geometry = { frame: [keyboardWindow.height * 2, keyboardWindow.height - 100], field: [300, 60] };
    await on(ANDROID_17, advanced(), async ({ tree }) => {
      await TestRenderer.act(async () => { frames(tree)[0].props.onLayout(); });
      await TestRenderer.act(async () => { stepKeyboard(0); flushRevealFrames(); });
      h.eq(framePadding(tree), 0, 'with the keyboard down, no part of the screen is padded away');
    }, midPush);
  });

  await h.test('a keyboard that grows or shrinks while up (the emoji panel, another keyboard, a suggestion bar) moves the footer with it, on iOS and every Android version', async () => {
    const taller = KEYBOARD_TOP - 60;
    for (const device of DEVICES) {
      await on(device, advanced(), async ({ tree }) => {
        await keyboard(device, true);
        await keyboardTo(taller);
        h.eq(framePadding(tree), overlapOf(SCREEN_FRAME, taller), `${device.name}: the frame ends at the taller keyboard’s top edge`);
        await keyboardTo(KEYBOARD_TOP);
        h.eq(framePadding(tree), overlapOf(SCREEN_FRAME, KEYBOARD_TOP), `${device.name}: and follows it back down`);
      });
    }
  });

  await h.test('iOS: the first keyboard of a process reports a height without the Done bar that attaches a moment later; the frame iOS reports then moves the footer, on a screen and in a sheet', async () => {
    const withoutBar = KEYBOARD_HEIGHT - 44;
    await on(IOS, advanced(), async ({ tree }) => {
      await TestRenderer.act(async () => { moveKeyboard(withoutBar); flushRevealFrames(); });
      h.eq(framePadding(tree), overlapOf(SCREEN_FRAME, keyboardWindow.height - withoutBar), 'the screen first ends at the height the library reported');
      await TestRenderer.act(async () => { changeKeyboardFrame(KEYBOARD_HEIGHT); });
      h.eq(framePadding(tree), overlapOf(SCREEN_FRAME, KEYBOARD_TOP), 'and clears the whole keyboard, bar included, once iOS reports its frame');
      await TestRenderer.act(async () => { endKeyboard(withoutBar); });
      h.eq(framePadding(tree), overlapOf(SCREEN_FRAME, KEYBOARD_TOP), 'the library then ends where it started, without the bar: the footer stays clear of the bar');
      await TestRenderer.act(async () => { dragKeyboard(KEYBOARD_HEIGHT / 2); });
      h.eq(framePadding(tree), overlapOf(SCREEN_FRAME, keyboardWindow.height - KEYBOARD_HEIGHT / 2), 'a drag still takes the footer wherever the keyboard is');
      await TestRenderer.act(async () => { moveKeyboard(KEYBOARD_HEIGHT - 100); flushRevealFrames(); });
      h.eq(framePadding(tree), overlapOf(SCREEN_FRAME, keyboardWindow.height - KEYBOARD_HEIGHT + 100), 'a keyboard that then changes height is followed to it, not held at the earlier report');
      await TestRenderer.act(async () => { moveKeyboard(0); changeKeyboardFrame(0); });
      h.eq(framePadding(tree), 0, 'a keyboard that has left covers nothing');
      await TestRenderer.act(async () => { moveKeyboard(withoutBar); });
      h.eq(framePadding(tree), overlapOf(SCREEN_FRAME, keyboardWindow.height - withoutBar), 'the next keyboard starts from what the library says: nothing is kept from the last');
    });
    await on(IOS, sheeted(compose()), async ({ tree }) => {
      const safe = useSafeAreaInsets().bottom;
      await TestRenderer.act(async () => { moveKeyboard(withoutBar); flushRevealFrames(); });
      await TestRenderer.act(async () => { changeKeyboardFrame(KEYBOARD_HEIGHT); });
      h.eq(flat(sheetCard(tree)).paddingBottom, sheetBottomPadding(overlapOf(SCREEN_FRAME, KEYBOARD_TOP), safe), 'the sheet’s card ends at the whole keyboard’s top edge, so Continue is not under the bar');
    });
  });

  await h.test('the frame follows the keyboard frame by frame, on its own curve and under an interactive drag, not only where it ends', async () => {
    for (const device of DEVICES) {
      await on(device, advanced(), async ({ tree }) => {
        await TestRenderer.act(async () => { emitKeyboardEvent('keyboardWillShow', KEYBOARD_HEIGHT); stepKeyboard(KEYBOARD_HEIGHT / 2); });
        h.eq(framePadding(tree), overlapOf(SCREEN_FRAME, keyboardWindow.height - KEYBOARD_HEIGHT / 2), `${device.name}: halfway up, the footer sits on the keyboard halfway up`);
        await keyboard(device, true);
        await TestRenderer.act(async () => { dragKeyboard(KEYBOARD_HEIGHT / 4); });
        h.eq(framePadding(tree), overlapOf(SCREEN_FRAME, keyboardWindow.height - KEYBOARD_HEIGHT / 4), `${device.name}: a drag pulling the keyboard down takes the footer with it`);
      });
    }
  });

  await h.test('as the keyboard sets off, the focused field scrolls once to where the keyboard is heading, not on every frame in between, and stays put once it settles', async () => {
    for (const device of DEVICES) {
      await on(device, advanced(), async ({ tree, scrolls }) => {
        const reports = scrollReports(tree);
        await reports.viewport(700);
        await reports.content(1200);
        mountContent(tree);
        await TestRenderer.act(async () => { field(tree).props.onFocus({}); flushRevealFrames(); });
        await TestRenderer.act(async () => { emitKeyboardEvent('keyboardWillShow', KEYBOARD_HEIGHT); flushRevealFrames(); });
        const settledViewport = 700 - overlapOf(SCREEN_FRAME, KEYBOARD_TOP);
        const target = 500 + 60 + SPACING.md - settledViewport;
        h.eq(scrolls, [target], `${device.name}: one scroll as it sets off, putting the field 16 pt above where the keyboard will stop`);
        await reports.offset(target);
        await TestRenderer.act(async () => { stepKeyboard(KEYBOARD_HEIGHT / 2); });
        await reports.viewport(550);
        await TestRenderer.act(async () => { stepKeyboard(KEYBOARD_HEIGHT); });
        await reports.viewport(settledViewport);
        h.eq(scrolls, [target], `${device.name}: none on the frames in between`);
        await TestRenderer.act(async () => { emitKeyboardEvent('keyboardDidShow', KEYBOARD_HEIGHT); flushRevealFrames(); });
        h.eq(scrolls, [target], `${device.name}: settled where it was heading: no second scroll`);
      }, { frame: SCREEN_FRAME, field: [500, 60], block: [500, 60] });
    }
  });

  await h.test('in a sheet, whose host pads outside the scroll view, the focused note waits for the keyboard to settle and then scrolls once, not on every frame', async () => {
    for (const device of [IOS, ANDROID_17]) {
      await on(device, report(), async ({ tree, scrolls }) => {
        await draftLoaded();
        const reports = scrollReports(tree);
        await reports.viewport(500);
        await reports.content(900);
        mountContent(tree);
        await TestRenderer.act(async () => { field(tree).props.onFocus({}); flushRevealFrames(); });
        await TestRenderer.act(async () => { emitKeyboardEvent('keyboardWillShow', KEYBOARD_HEIGHT); stepKeyboard(KEYBOARD_HEIGHT / 2); });
        await reports.viewport(350);
        await TestRenderer.act(async () => { stepKeyboard(KEYBOARD_HEIGHT); });
        await reports.viewport(200);
        h.eq(scrolls, [], `${device.name}: no scroll while the keyboard moves`);
        await TestRenderer.act(async () => { emitKeyboardEvent('keyboardDidShow', KEYBOARD_HEIGHT); flushRevealFrames(); });
        h.eq(scrolls, [300 + 140 + SPACING.md - 200], `${device.name}: once settled, one scroll that puts the note and its switch 16 pt above the sheet’s actions`);
      }, { frame: [0, 844], field: [300, 90], block: [300, 140] });
    }
  });

  await h.test('on iOS a screen on the native stack never reads as running below the home indicator it keeps clear of: `measure` there counts from a root far below the window, which would pad the frame by the home indicator’s inset on top of what the keyboard covers', async () => {
    const overlap = overlapOf(SCREEN_FRAME, KEYBOARD_TOP);
    await on(IOS, advanced(), async ({ tree }) => {
      h.eq(await paddingAcrossKeyboard(tree, IOS), [0, overlap, 0], 'the frame ends at the keyboard, not above it, while it is up');
    }, { frame: SCREEN_FRAME, field: [300, 60], rootOffset: 1546 });
  });

  await h.test('a frame pads only by the part of it the keyboard covers: never twice, never for a keyboard below it', async () => {
    // A frame above a bottom bar (or a window resized for the keyboard after all) ends 124 above the
    // window's bottom; one in the top half of a split screen ends above where the keyboard reaches.
    const cases: [string, Rect, number][] = [
      ['a frame ending above the window’s bottom', [20, 700], overlapOf([20, 700], KEYBOARD_TOP)],
      ['a frame wholly above the keyboard', [0, 480], 0],
    ];
    for (const device of DEVICES) {
      for (const [name, frame, expected] of cases) {
        await on(device, advanced(), async ({ tree }) => {
          await keyboard(device, true);
          h.eq(framePadding(tree), expected, `${device.name}, ${name}: pads ${expected}`);
        }, { frame, field: [300, 60] });
      }
    }
  });

  await h.test('the sheet-hosted pages pad by the keyboard frame: Describe and Plan lift the sheet’s card to the keyboard, and Continue and Make it stay pinned above it', async () => {
    const pages: [string, React.ReactElement, string][] = [
      ['describe', sheeted(compose()), COPY.flowContinue],
      ['plan', sheeted(plan()), COPY.planBuild],
    ];
    const overlap = overlapOf(SCREEN_FRAME, KEYBOARD_TOP);
    for (const device of DEVICES) {
      for (const [name, element, action] of pages) {
        await on(device, element, async ({ tree }) => {
          const safe = useSafeAreaInsets().bottom;
          const padding = () => flat(sheetCard(tree)).paddingBottom;
          h.eq(padding(), sheetBottomPadding(0, safe), `${device.name} ${name}: with the keyboard down the card clears the home indicator`);
          await keyboard(device, true);
          h.eq(padding(), sheetBottomPadding(overlap, safe), `${device.name} ${name}: with the keyboard up the card ends at its top edge`);
          const pinned = button(tree, action);
          h.ok(nearest(pinned, 'ScrollView') == null, `${device.name} ${name}: ${action} sits below the scroll view, in the padded card, so it is above the keyboard`);
          await keyboard(device, false);
          h.eq(padding(), sheetBottomPadding(0, safe), `${device.name} ${name}: back down, the card drops back`);
        });
      }
    }
  });

  await h.test('describe opens with the keyboard: Continue is in the card the keyboard lifts, so it is above the keyboard with the field focused', async () => {
    for (const device of [IOS, ANDROID_17]) {
      await on(device, sheeted(compose()), async ({ tree, focused }) => {
        await TestRenderer.act(async () => flushRevealFrames());
        h.ok(focused() >= 1, `${device.name}: the field is focused on open`);
        await keyboard(device, true);
        const continueButton = button(tree, COPY.flowContinue);
        const ancestors: Node[] = [];
        for (let at: Node | null = continueButton; at; at = at.parent) ancestors.push(at);
        h.ok(ancestors.includes(sheetCard(tree)) && nearest(continueButton, 'ScrollView') == null, `${device.name}: Continue rides in the lifted card, not in the scrolling content under the keyboard`);
      });
    }
  });

  await h.test('a large sheet hands its page the whole card, so the footer sits at the sheet’s bottom whatever the page holds: nothing between the card and the page’s frame is sized by its content', async () => {
    for (const [name, page] of [['describe', compose()], ['plan', plan()]] as const) {
      await on(IOS, sheeted(page), async ({ tree }) => {
        const card = sheetCard(tree);
        const chain: Node[] = [];
        const pageFrame = card.find((n) => String(n.type) === 'Pressable' && n.props.accessible === false);
        for (let at: Node | null = pageFrame; at && at !== card; at = hostParent(at)) chain.push(at);
        h.ok(chain.length >= 2, `${name}: setup: the page's frame sits inside the card's body`);
        h.ok(chain.every((link) => Number(flat(link).flexGrow) >= 1), `${name}: the frame and the body around it grow to fill the card`);
      });
    }
  });

  await h.test('Android raises the keyboard for an overlay’s field only once the overlay has reported it is shown; iOS does not wait for the report', async () => {
    const emptyDescribe = sheeted(<DescribePage text="" onChangeText={noop} onContinue={noop} />);
    const release = refuseModalPresentations();
    try {
      await on(ANDROID_17, emptyDescribe, async ({ tree, focused }) => {
        await TestRenderer.act(async () => flushRevealFrames());
        h.eq(focused(), 0, 'Android: the window is not shown yet, so the field has not asked for focus');
        await TestRenderer.act(async () => tree.root.find(isType('Modal')).props.onShow());
        await TestRenderer.act(async () => flushRevealFrames());
        h.ok(focused() >= 1, 'Android: once the window reports it is shown, the field asks for focus');
      });
      await on(IOS, emptyDescribe, async ({ focused }) => {
        await TestRenderer.act(async () => flushRevealFrames());
        h.ok(focused() >= 1, 'iOS: the field asks for focus a frame after it mounts, shown or not');
      });
    } finally {
      release();
    }
  });

  await h.test('a sheet footer that has outgrown its share of the window (the largest text size) scrolls with the content, edge to edge; a footer of ordinary height stays pinned', async () => {
    await on(IOS, sheeted(compose()), async ({ tree }) => {
      const action = () => button(tree, COPY.flowContinue);
      const footerBox = () => measuredFooterAround(action());
      const measure = (height: number) => measureFooter(footerBox(), height);
      await measure(140);
      h.ok(nearest(action(), 'ScrollView') == null, 'an ordinary footer is pinned below the scroll view');
      await measure(keyboardWindow.height * 0.4);
      h.ok(nearest(action(), 'ScrollView') != null, 'a footer taking two fifths of the window moves into the scrolling content');
      h.eq(flat(footerBox()).marginHorizontal, -LAYOUT.gutter, 'where it runs edge to edge: the content pads its sides and the actions already do');
      await measure(140);
      h.ok(nearest(action(), 'ScrollView') == null, 'and is pinned again once the text gets smaller');
    });
  });

  await h.test('a sheet’s content fades out under the header in proportion to how far it has scrolled, over 16 pt, and is not faded at rest', async () => {
    await on(IOS, sheeted(compose()), async ({ tree }) => {
      const fade = () => flat(topFadeOf(tree)).opacity;
      const reports = scrollReports(tree);
      h.eq(fade(), 0, 'at rest nothing is faded');
      await reports.offset(8);
      h.eq(fade(), 0.5, 'half its height scrolled: half faded');
      await reports.offset(300);
      h.eq(fade(), 1, 'scrolled well past: fully faded');
      await reports.offset(0);
      h.eq(fade(), 0, 'back at the top: nothing faded again');
    });
  });

  await h.test('every launcher field wears ink for its caret and selection handles, selected text stays readable on its highlight, it paints its own background, and on iOS a one-line field sets no line height', async () => {
    for (const scheme of ['light', 'dark'] as const) {
      await TestRenderer.act(async () => setColorScheme(scheme));
      try {
        const ink = COLORS[scheme].ink;
        for (const device of [IOS, ANDROID_17]) {
          const fields: [string, React.ReactElement, (tree: Tree) => Promise<void>, boolean][] = [
            ['text field', <TextField value="Ada" onChangeText={noop} accessibilityLabel="Name" />, async () => {}, false],
            ['text area', <TextArea value="Ada" onChangeText={noop} accessibilityLabel="Notes" />, async () => {}, true],
            ['describe', compose(), async () => {}, true],
            ['plan row', plan(), editFourthRow, true],
          ];
          for (const [name, element, open, multiline] of fields) {
            await on(device, element, async ({ tree }) => {
              await open(tree);
              const input = field(tree);
              const where = `${scheme} ${device.name} ${name}`;
              const background = paintedBackground(input);
              h.ok(background !== undefined, `${where}: it paints its own background, which covers Android's default field underline`);
              if (device.os === 'ios') {
                h.eq(input.props.selectionColor, ink, `${where}: ink tints the caret, the handles and the highlight iOS draws translucent itself`);
              } else {
                h.eq([input.props.cursorColor, input.props.selectionHandleColor], [ink, ink], `${where}: ink caret and selection handles`);
                const contrast = contrastOnHighlight(String(flat(input).color), String(input.props.selectionColor), String(background));
                h.ok(contrast >= 4.5, `${where}: the text Android paints its highlight over stays readable (${contrast.toFixed(2)}:1, at least 4.5:1)`);
              }
              const oneLineOnIos = device.os === 'ios' && !multiline;
              h.eq(typeof flat(input).lineHeight, oneLineOnIos ? 'undefined' : 'number', `${where}: ${oneLineOnIos ? 'no line height, so iOS keeps its descenders' : 'its type’s line height'}`);
            });
          }
        }
      } finally {
        await TestRenderer.act(async () => setColorScheme('light'));
      }
    }
  });

  await h.test('describe on iOS: Done, empty space and a drag put the keyboard away without continuing', async () => {
    const s = spies();
    await on(IOS, compose(s.fn('continue'), s.fn('change')), async ({ tree }) => {
      h.eq(field(tree).props.inputAccessoryViewID != null && doneBars(tree).some((bar) => bar.props.nativeID === field(tree).props.inputAccessoryViewID), true, 'the field has a Done bar');
      h.eq(scrollView(tree).props.keyboardDismissMode, 'interactive', 'dragging the content pulls the keyboard down');
      h.eq(scrollView(tree).props.keyboardShouldPersistTaps, 'handled', 'a tap a control handles reaches the control');
      h.eq(await dismissBoth(tree), 2, 'Done and a tap on empty space each put the keyboard away');
      h.eq([s.count('continue'), s.count('change')], [0, 0], 'without continuing or changing the text');
    });
  });

  await h.test('describe on Android: a drag dismisses, there is no Done bar, and empty space puts the keyboard away', async () => {
    const s = spies();
    await on(ANDROID_17, compose(s.fn('continue')), async ({ tree }) => {
      h.eq([scrollView(tree).props.keyboardDismissMode, doneBars(tree).length], ['on-drag', 0], 'a drag dismisses; no Done bar');
      const before = Keyboard.dismissed;
      await press(emptySpace(tree));
      h.eq([Keyboard.dismissed - before, s.count('continue')], [1, 0], 'a tap on empty space puts the keyboard away, without continuing');
    });
  });

  await h.test('plan: editing the 4th row focuses it once mounted, and keeps the whole row (field, Save, Cancel) in view above Make it as the keyboard arrives and as the row grows', async () => {
    const s = spies();
    for (const device of [IOS, ANDROID_14, ANDROID_17]) {
      const geometry: Geometry = { frame: SCREEN_FRAME, field: [630, 60], block: [600, 180] };
      await on(device, plan(s.fn('row'), s.fn('build')), async ({ tree, scrolls, focused }) => {
        const reports = scrollReports(tree);
        await reports.viewport(700);
        await reports.content(1000);
        mountContent(tree);
        await editFourthRow(tree);
        h.eq([field(tree).props.autoFocus, focused()], [undefined, device.os === 'android' ? 1 : 0], `${device.name}: the row's field is not focused natively on mount; ${device.os === 'android' ? 'Android focuses it at once' : 'iOS waits a frame for the Done bar to link'}`);
        await TestRenderer.act(async () => flushRevealFrames());
        h.eq(focused(), device.os === 'android' ? 2 : 1, `${device.name}: ${device.os === 'android' ? 'and asks again a frame later, which Android needs to show the keyboard for a field it hasn’t served yet' : 'then focuses it once'}`);
        if (device.os === 'ios') h.ok(doneBars(tree).some((bar) => bar.props.nativeID === field(tree).props.inputAccessoryViewID), 'iOS: its Done bar mounts with it');
        await TestRenderer.act(async () => field(tree).props.onFocus({}));
        await keyboard(device, true);
        await reports.viewport(400);
        h.eq(scrolls.at(-1), 600 + 180 + SPACING.md - 400, `${device.name}: with the keyboard up, the row's bottom (Save and Cancel), not just its field, sits clear above the scroll view's end`);
        geometry.block = [600, 220];
        await reports.content(1040);
        h.eq(scrolls.at(-1), 600 + 220 + SPACING.md - 400, `${device.name}: as typing grows the row, it stays in view`);
        h.ok(nearest(button(tree, COPY.planBuild), 'ScrollView') == null, `${device.name}: Make it stays pinned below the scroll view`);
      }, geometry);
    }
    await on(IOS, plan(s.fn('row'), s.fn('build')), async ({ tree }) => {
      await press(tree.root.find((n) => String(n.type) === 'Pressable' && n.props.accessibilityRole === 'button' && textOf(n).includes('A big dial')));
      h.eq(await dismissBoth(tree), 2, 'Done and empty space put the keyboard away');
      h.eq(field(tree).props.value, 'A big dial', 'leaving the row open');
      h.eq([s.count('row'), s.count('build')], [0, 0], 'saving and building nothing');
    });
  });

  await h.test('iOS plan: focus before native keyboard layout settles still reveals the whole row, including later typing and refocus', async () => {
    for (const settledBy of ['frame', 'keyboard'] as const) {
      // 08-edit-settled device evidence: viewport y103–409 (306pt), row bottom y668,
      // content offset 77. Before the keyboard, the viewport is 644pt high.
      const native = { viewport: 644, content: 812, offset: 77 };
      const geometry: Geometry = { frame: SCREEN_FRAME, field: [536, 63], block: [497, 145], nativeScroll: native };
      await on(IOS, plan(), async ({ tree, scrolls }) => {
        const reports = scrollReports(tree);
        await reports.viewport(644);
        await reports.content(native.content);
        await reports.offset(native.offset);
        mountContent(tree);
        await editFourthRow(tree);
        await TestRenderer.act(async () => field(tree).props.onFocus({}));
        await keyboard(IOS, true);
        // JS has the final Yoga viewport before the native view has adopted it. An immediate
        // scroll command is clamped against the old 644pt viewport by RCTScrollViewComponentView.
        await TestRenderer.act(async () => {
          scrollView(tree).props.onLayout({ nativeEvent: { layout: { height: 306 } } });
          if (settledBy === 'frame') native.viewport = 306;
          flushRevealFrames();
        });
        if (settledBy === 'keyboard') {
          await reports.offset(native.offset);
          native.viewport = 306;
          await TestRenderer.act(async () => { emitKeyboardEvent('keyboardDidShow', KEYBOARD_HEIGHT); flushRevealFrames(); });
        }
        const wholeRowVisible = () => geometry.block![0] >= native.offset &&
          geometry.block![0] + geometry.block![1] + SPACING.md <= native.offset + native.viewport;
        h.ok(wholeRowVisible(), 'after the native commit, the full row and its actions clear the keyboard and pinned footer');
        await reports.offset(native.offset);
        geometry.block = [497, 210];
        await TestRenderer.act(async () => {
          scrollView(tree).props.onContentSizeChange(390, 877);
          native.content = 877;
          flushRevealFrames();
        });
        h.ok(wholeRowVisible(), 'typing reveals the grown row after native content layout');
        await reports.offset(native.offset);
        await TestRenderer.act(async () => field(tree).props.onBlur({}));
        await reports.offset(77);
        native.offset = 77;
        await TestRenderer.act(async () => { field(tree).props.onFocus({}); flushRevealFrames(); });
        h.ok(wholeRowVisible(), 'refocus reveals the same unsaved row');
        const settledScrolls = scrolls.length;
        await TestRenderer.act(async () => { flushRevealFrames(); flushRevealFrames(); });
        h.eq(scrolls.length, settledScrolls, 'a reveal does not schedule itself in a layout loop');
        await TestRenderer.act(async () => { field(tree).props.onFocus({}); field(tree).props.onBlur({}); flushRevealFrames(); });
        h.eq(scrolls.length, settledScrolls, 'blur cancels a pending reveal');
      }, geometry);
    }
  });

  await h.test('Advanced’s server field with the lines under it, are kept in view above the keyboard; one line, so Return puts the keyboard away', async () => {
    // Advanced's field names its block: the field, its helper line and the check line, 100 tall.
    const cases: [string, React.ReactElement, Geometry, string][] = [
      ['advanced', advanced(), { frame: SCREEN_FRAME, field: [500, 60], block: [500, 100] }, 'the field and its helper line'],
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
          if (name === 'advanced') h.ok(textOf(revealedBlock(tree)).includes(COPY.settingsProbeNeutral), `${device.name} advanced: the check line is in the block kept above the keyboard`);
        }, geometry);
      }
    }
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
        const card = padded(frame[0]);
        const cardPadding = () => flat(card).paddingBottom;
        const seen = [cardPadding()];
        await keyboard(device, true);
        h.ok(Number(flat(frame[0]).paddingBottom ?? 0) <= 0, `${device.name}: with the keyboard up the frame still runs to the window's bottom, so the dim continues behind the keyboard`);
        seen.push(cardPadding());
        await keyboard(device, false);
        seen.push(cardPadding());
        h.eq(seen, [insets.bottom + SPACING.md, KEYBOARD_HEIGHT + SPACING.md, insets.bottom + SPACING.md],
          `${device.name}: the card grows down behind the keyboard while it is up, on every Android version too, and drops back`);
        h.ok(nearest(button(tree, COPY.reportSend), 'ScrollView') == null && nearest(button(tree, COPY.cancel), 'ScrollView') == null, `${device.name}: Send and Cancel are pinned below the note`);
        const note = around(field(tree));
        h.eq([note.scrolls, note.doneBarLinked(tree)], [true, device.os === 'ios'], `${device.name}: the note scrolls in the sheet; iOS links a Done bar`);
        h.eq(revealedBlock(tree).findAll(isType('Switch')).length, 1, `${device.name}: the note keeps the include row under it in view too, so Send never cuts its switch`);
      }, { frame: [0, 844], field: [300, 90] });
    }
    await on(IOS, report(s.fn('close')), async ({ tree }) => {
      await draftLoaded();
      h.eq(await dismissBoth(tree), 2, 'Done and empty space put the keyboard away');
      h.eq(s.count('close'), 0, 'without closing the sheet');
    });
  });

  await h.test('the footer hairline shows while content continues below, in a sheet’s page, and no hairline sits under the sheet’s header', async () => {
    await on(IOS, sheeted(compose()), async ({ tree }) => {
      const reports = scrollReports(tree);
      const lines = () => edgeLines(tree).map(drawn);
      await reports.viewport(600);
      await reports.content(500);
      h.eq(lines(), [false], 'all content in view: no hairline');
      await reports.content(900);
      h.eq(lines(), [true], 'content running past the footer: its hairline shows');
      await reports.offset(120);
      h.eq(lines(), [true], 'scrolled, content still continuing: the one hairline is the footer’s, nothing appears under the header');
      await reports.offset(300);
      h.eq(lines(), [false], 'scrolled to the end: no hairline');
    });
  });

  await h.test('a keyboard frame, a screen’s or a sheet’s, removes every keyboard subscription it added once it unmounts', async () => {
    for (const device of DEVICES) {
      const frameHosts: [string, React.ReactElement, () => Promise<void>][] = [
        ['advanced', advanced(), async () => {}],
        ['report sheet', report(), draftLoaded],
      ];
      for (const [name, element, open] of frameHosts) {
        const before = keyboardSubscriptions();
        const framesBefore = keyboardFrameListenerCount();
        let added: unknown[] = [];
        let framesWhile = 0;
        await on(device, element, async () => {
          await open();
          added = [...keyboardSubscriptions()].filter((subscription) => !before.has(subscription));
          framesWhile = keyboardFrameListenerCount();
        });
        h.ok(added.length > 0, `${device.name} ${name}: setup: the frame listens to the keyboard while it pads`);
        const after = keyboardSubscriptions();
        h.eq(added.filter((listener) => after.has(listener)).length, 0, `${device.name} ${name}: none of the subscriptions it added outlive it`);
        h.eq([framesWhile > framesBefore, keyboardFrameListenerCount()], [device.os === 'ios', framesBefore], `${device.name} ${name}: iOS listens to the system’s keyboard frame while it pads, and stops once it unmounts`);
      }
    }
  });
}

/** The view that measures a sheet's footer: the nearest one around `node` that reports its layout. */
function measuredFooterAround(node: Node): Node {
  for (let at: Node | null = node; at; at = at.parent) if (String(at.type) === 'View' && typeof at.props.onLayout === 'function') return at;
  throw new Error('no measured footer around the node');
}

/** Plays the native layout pass reporting the footer `height` tall. */
const measureFooter = (box: Node, height: number) => TestRenderer.act(async () => box.props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: 390, height } } }));

/** The edge fade under a sheet's header: the one non-touchable animated overlay. */
const topFadeOf = (tree: Tree) => tree.root.find((n) => String(n.type) === 'Animated.View' && n.props.pointerEvents === 'none');

/** The hairlines of the sheet's page frame, outside the scrolling content. */
const isEdgeLine = (n: Node) => String(n.type) === 'View' && flat(n).height === StyleSheet.hairlineWidth && nearest(n, 'ScrollView') == null;
const edgeLines = (tree: Tree) => sheetCard(tree).findAll(isEdgeLine);
/** Whether a hairline is drawn (it is always laid out). */
const drawn = (line: Node) => flat(line).backgroundColor === SHELL_PALETTE.cardBorder;

/** The host view `node` sits in. */
function hostParent(node: Node): Node | null {
  for (let at: Node | null = node.parent; at; at = at.parent) if (typeof hostType(at) === 'string') return at;
  return null;
}

/** The nearest padding frame around `node`. */
function nearestFrame(node: Node): Node {
  for (let at: Node | null = node.parent; at; at = at.parent) if (String(at.type) === 'View' && at.props.collapsable === false) return at;
  throw new Error('no padding frame around the node');
}

/** Whether a field scrolls, and whether iOS linked its Done bar. */
/** What a screen's one field keeps in view while focused: the block it names (`revealTarget`, the
 *  view wrapping the field, or the `TextField`/`TextArea` it sits in), or the field alone. */
function revealedBlock(tree: Tree): Node {
  const input = tree.root.findByType(KeyboardTextInput);
  if (input.props.revealTarget == null) return input;
  const owner = [...tree.root.findAllByType(TextField), ...tree.root.findAllByType(TextArea)][0] ?? input;
  return owner.parent ?? input;
}

function around(input: Node) {
  return {
    scrolls: nearest(input, 'ScrollView') != null,
    doneBarLinked: (tree: Tree) => doneBars(tree).some((bar) => bar.props.nativeID != null && bar.props.nativeID === input.props.inputAccessoryViewID),
  };
}
