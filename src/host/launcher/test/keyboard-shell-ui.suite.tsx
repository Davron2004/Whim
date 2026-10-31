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
import { WhimReportPage } from '../WhimSheet';
import { KeyboardTextInput } from '../KeyboardShell';
import AdvancedScreen from '../AdvancedScreen';
import { FirstRunSheet } from '../FirstRunSheet';
import { LEGAL_COPY } from '../copy';
import { TextArea, TextField } from '../../ui/TextField';
import { Sheet } from '../../ui/Sheet';
import { followOffset, hiddenAtRest, REVEAL_MARGIN, revealOffset, riseProgress, sheetBottomPadding } from '../keyboard-shell';
import { COLORS, LAYOUT } from '../../../design/tokens';
import { ToastHost } from '../../ui/Toast';
import type { InstalledApp } from '../app-index';
import type { StoreAccess } from '../store-access';
import { reportClientOptions } from '../transport-shared';
import { button, freshApp, press, textOf, unmountScreen, hostType } from './react-screen';
import { testAppInfo } from './client-fixtures';
import { Keyboard, Platform, StyleSheet, changeKeyboardFrame, keyboardFrameListenerCount, keyboardShows, refuseModalPresentations, setColorScheme, useSafeAreaInsets } from './native-host';
import { dismissals, dragKeyboard, emitKeyboardEvent, endKeyboard, keyboardRequests, keyboardState, keyboardSubscriptions, keyboardWindow, moveKeyboard, resetKeyboard, startKeyboard, stepKeyboard } from './native-keyboard-controller';
import { elapse, elapseSprings, emitNativeEvent, holdAnimations } from './native-reanimated';

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
/** The footer’s empty space: the view around the pinned footer that takes a touch nothing in the
 *  footer takes. */
const emptySpace = (tree: Tree) => tree.root.find((n) => String(n.type) === 'View' && typeof n.props.onResponderRelease === 'function');
/** A tap that lands on `target` and lifts there, as the responder system delivers it. */
async function tapOn(target: Node): Promise<void> {
  await TestRenderer.act(async () => {
    if (target.props.onStartShouldSetResponder() !== true) throw new Error('the touch was not taken');
    target.props.onResponderRelease();
  });
}
/** The views around `scroll` that would answer a touch on plain content inside it, which nothing
 *  inside answers and React Native's responder system hands outward: a touchable that is not
 *  disabled, or a view whose `onStartShouldSetResponder` says yes. iOS does not scroll while a view
 *  around the scroll view holds the touch (`RCTScrollViewComponentView` will not take a drag from an
 *  ancestor that is the JS responder). */
function answerersAround(scroll: Node): string[] {
  const found: string[] = [];
  for (let at = scroll.parent; at; at = at.parent) {
    const type = hostType(at);
    if (type === undefined) continue;
    const touchable = (type === 'Pressable' || type === 'TouchableOpacity') && at.props.disabled !== true;
    const asks = typeof at.props.onStartShouldSetResponder === 'function' && at.props.onStartShouldSetResponder() === true;
    if (touchable || asks) found.push(String(type));
  }
  return found;
}
/** Every frame that pads itself for the keyboard (the one view measured on its page). */
/** The padded frames: views kept as native views that read their own layout (a sheet's travel layer
 *  and a travelling element's places are kept too, but read none). */
const frames = (tree: Tree) => tree.root.findAll((n) => String(n.type) === 'View' && n.props.collapsable === false && typeof n.props.onLayout === 'function');
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
 *  (a screen on the native stack: its `measure` counts from a root laid out far below the window).
 *  `keyboard` is the height of a keyboard already up as the element mounts. */
interface Geometry {
  frame: Rect; field: Rect; block?: Rect; rootOffset?: number; keyboard?: number;
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

/** Android's side of a request for the keyboard, as measured on a device: a request made before the
 *  focused field is `served` is dropped, leaving the field focused with no keyboard, and so is one
 *  naming any other view ("view is not served"); a field that is already focused ignores `focus()`
 *  (React Native's own guard), so only a request naming the focused field (`WhimKeyboard.showFor`)
 *  made once it is served raises the keyboard. A test turns `served` on when the field is. The
 *  keyboard library's `setFocusTo('current')` names the field the library last saw take focus
 *  (`libraryCurrent`); measured on API 37, a field that took focus before it was attached to its
 *  window is never seen, so that is the page before's field (`PREVIOUS_FIELD`), no longer mounted. */
interface Ime { served: boolean; focused: boolean; focusedTag: number | null; libraryCurrent: number; request: (tag: number) => void }

/** The view tag of a field that took focus on the page before and is no longer mounted. */
const PREVIOUS_FIELD = 1;

/** How many times a field asked for its keyboard by name. */
const fieldAsks = () => keyboardShows.tags.length;

interface Mounted { tree: Tree; geometry: Geometry; scrolls: number[]; focused: () => number; ime: Ime }

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
  // A keyboard already up came up before: its show ended (`keyboardDidShow`) before the element mounts.
  if (geometry.keyboard) {
    Object.assign(keyboardState, { height: geometry.keyboard, visible: true });
    emitKeyboardEvent('keyboardDidShow', geometry.keyboard);
  }
  const scrolls: number[] = [];
  let focusCalls = 0;
  let nextTag = PREVIOUS_FIELD;
  // The rig models the before-attach case for every field (the library's `current` always names the earlier one),
  // even where the real device worked (Describe): only the plan-row failures in the s4b-kb red-check stand for the device bug.
  const ime: Ime = {
    served: false,
    focused: false,
    focusedTag: null,
    libraryCurrent: PREVIOUS_FIELD,
    request: (tag) => { if (ime.served && tag === ime.focusedTag && !keyboardState.visible) moveKeyboard(KEYBOARD_HEIGHT); },
  };
  keyboardRequests.handler = () => ime.request(ime.libraryCurrent);
  keyboardShows.tags.length = 0;
  keyboardShows.handler = ime.request;
  const createNodeMock = (node: React.ReactElement<{ collapsable?: boolean; scrollToOverflowEnabled?: boolean }>) => {
    const type = String(node.type);
    // A scroll lands within the bounds the native scroll view has when it runs, as both platforms
    // clamp it, unless iOS was told not to clamp (`scrollToOverflowEnabled`).
    const clamps = !(device.os === 'ios' && node.props.scrollToOverflowEnabled === true);
    if (type === 'ScrollView') return { scrollTo: ({ y }: { y: number }) => {
      scrolls.push(y);
      const native = geometry.nativeScroll;
      if (native) native.offset = clamps ? Math.max(0, Math.min(y, native.content - native.viewport)) : y;
    }, scrollToEnd: noop };
    if (type === 'TextInput') {
      nextTag += 1;
      const nativeTag = nextTag;
      return { nativeTag, focus: () => { focusCalls += 1; ime.focusedTag = nativeTag; if (!ime.focused) { ime.focused = true; ime.request(nativeTag); } }, measureLayout: (_to: unknown, ok: (x: number, y: number, w: number, h: number) => void) => ok(0, geometry.field[0], 350, geometry.field[1]) };
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
      await body({ tree, geometry, scrolls, focused: () => focusCalls, ime });
    } finally { await unmountScreen(tree); }
  } finally {
    revealFrames.clear();
    globalThis.requestAnimationFrame = animationFrames.request;
    globalThis.cancelAnimationFrame = animationFrames.cancel;
    Object.assign(Platform, before);
    resetKeyboard();
    keyboardShows.handler = null;
  }
}

/** `count` animation frames, each run to its end before the next. */
async function playFrames(count: number): Promise<void> {
  for (let frame = 0; frame < count; frame += 1) await TestRenderer.act(async () => flushRevealFrames());
}

/** While animations are held, `count` UI frames of them pass (60 Hz): a sheet that mounted has begun
 *  to come up by the time anything can close it. */
async function animateFrames(count: number): Promise<void> {
  await TestRenderer.act(async () => {
    elapse((count * 1000) / 60);
    elapseSprings(Math.round((count * 1000) / 60));
  });
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

/** Plays the scroll view's own reports: the height it shows, its content's height, an offset (to
 *  JS, and to the UI thread's handlers, as both hear it). */
const scrollReports = (tree: Tree) => ({
  viewport: (height: number) => TestRenderer.act(async () => { scrollView(tree).props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: 390, height } } }); flushRevealFrames(); }),
  content: (height: number) => TestRenderer.act(async () => { scrollView(tree).props.onContentSizeChange(390, height); flushRevealFrames(); }),
  offset: (y: number) => TestRenderer.act(async () => {
    emitNativeEvent('onScroll', { contentOffset: { x: 0, y } });
    scrollView(tree).props.onScroll({ nativeEvent: { contentOffset: { x: 0, y } } });
  }),
});

/** The person puts a finger on the content and starts to drag it: the UI thread hears it at once. */
const beginDrag = (y: number) => TestRenderer.act(async () => { emitNativeEvent('onScrollBeginDrag', { contentOffset: { x: 0, y } }); });

/** Hands the scroll view its inner content view, which native mounting would attach. */
function mountContent(tree: Tree): void {
  scrollView(tree).props.innerViewRef.current = {};
}

/** The view inside a measured frame that carries its keyboard padding: a sheet's card (its scrim is
 *  an Animated.View too), else the screen frame's only one. */
const padded = (frame: Node) => {
  const isAnimated = (n: Node) => String(n.type) === 'Animated.View';
  const cards = frame.findAll((n) => isAnimated(n) && n.props.accessibilityViewIsModal === true);
  return cards.length > 0 ? cards[0] : frame.find(isAnimated);
};
/** The padding the (single) screen frame carries now. */
const framePadding = (tree: Tree) => flat(padded(frames(tree)[0])).paddingBottom;

/**
 * Sets up a scroll view `native` describes, with its field focused, then sets the keyboard off as the
 * platform does and returns its frames, six to the top. Android focuses the field before it asks for
 * the keyboard; on iOS the field's focus reaches JS after the keyboard has set off and taken its first
 * frame (measured on the iOS 27 simulator). Each frame is the library's `onMove` on the UI thread,
 * whose scroll lands against the bounds the last frame left; then that frame's padding, read off the
 * rendered frame or sheet card, shrinks the native scroll view; then the scroll view reports.
 */
async function riseThrough(tree: Tree, device: Device, native: { viewport: number; content: number; offset: number }): Promise<{ frame: (step: number) => Promise<void> }> {
  const reports = scrollReports(tree);
  const start = native.viewport;
  await reports.viewport(start);
  await reports.content(native.content);
  mountContent(tree);
  const focus = () => TestRenderer.act(async () => { field(tree).props.onFocus({}); flushRevealFrames(); });
  if (device.os === 'android') await focus();
  const padding = () => Number(flat(padded(frames(tree)[0])).paddingBottom);
  const rest = padding();
  await TestRenderer.act(async () => { startKeyboard(KEYBOARD_HEIGHT); emitKeyboardEvent('keyboardWillShow', KEYBOARD_HEIGHT); flushRevealFrames(); });
  return {
    frame: async (step) => {
      await TestRenderer.act(async () => { stepKeyboard((KEYBOARD_HEIGHT * step) / 6); });
      native.viewport = start - (padding() - rest);
      if (step === 1 && device.os === 'ios') await focus();
      await reports.viewport(native.viewport);
      await reports.offset(native.offset);
    },
  };
}

/**
 * A keyboard that is up changing height from `from` to `to` (the emoji keyboard, another accessory),
 * played as `riseThrough` plays a rise: in each of six frames the library's `onMove`, then that
 * frame's padding resizing the native scroll view `native` describes, then its reports. `settle`
 * plays the end and `keyboardDidShow`.
 */
async function changeThrough(tree: Tree, native: { viewport: number; content: number; offset: number }, from: number, to: number) {
  const reports = scrollReports(tree);
  const padding = () => Number(flat(padded(frames(tree)[0])).paddingBottom);
  const start = native.viewport;
  const rest = padding();
  await TestRenderer.act(async () => { startKeyboard(to); emitKeyboardEvent('keyboardWillShow', to); flushRevealFrames(); });
  return {
    frame: async (step: number) => {
      await TestRenderer.act(async () => { stepKeyboard(from + ((to - from) * step) / 6); });
      native.viewport = start - (padding() - rest);
      await reports.viewport(native.viewport);
      await reports.offset(native.offset);
    },
    settle: async () => {
      await TestRenderer.act(async () => { endKeyboard(to); emitKeyboardEvent('keyboardDidShow', to); flushRevealFrames(); });
      await reports.offset(native.offset);
    },
  };
}

/** The frame's padding with the keyboard down, up, then down again. */
async function paddingAcrossKeyboard(tree: Tree, device: Device): Promise<unknown[]> {
  const seen = [framePadding(tree)];
  await keyboard(device, true);
  seen.push(framePadding(tree));
  await keyboard(device, false);
  seen.push(framePadding(tree));
  return seen;
}

/** Presses Done, then the pinned footer’s empty space; returns how many times the keyboard went away. */
async function dismissBoth(tree: Tree): Promise<number> {
  const before = Keyboard.dismissed;
  await press(button(tree, COPY.keyboardDone));
  await tapOn(emptySpace(tree));
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

/** The contrast between two opaque colours. */
function contrastOf(a: string, b: string): number {
  const [light, dark] = [luminance(rgba(a)), luminance(rgba(b))].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

/** The largest text-size multiplier iOS gives React Native (`RCTFontSizeMultiplier`, the largest
 *  accessibility size). */
const IOS_LARGEST_TEXT = 3.571;

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
const ACCESS = { activeWords: async () => ({ prompt: 'A tea timer', source: 'export default {}' }) } as unknown as StoreAccess;
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
/** The report as the Whim sheet shows it (`LauncherRoot`'s `whimSheetPage`): its report page, the
 *  sheet fitting it; `onClose` is what its back control, Cancel and the thanks page's Done run. */
const report = (onClose = noop) => (
  <Sheet visible detent="fit" onClose={noop}>
    <WhimReportPage
      app={APP}
      access={ACCESS}
      options={reportClientOptions({ kind: 'absent' }, 'https://server.test', 'device', testAppInfo)}
      onBack={onClose}
      onUpdateRequired={noop}
      legalLanguage="en"
    />
  </Sheet>
);
const editFourthRow = (tree: Tree) => press(tree.root.find((n) => String(n.type) === 'Pressable' && n.props.accessibilityRole === 'button' && textOf(n).includes('A soft chime')));

/** Describe in a large sheet that `close.current()` closes, as a person's close does. */
function closableSheet(close: { current: () => void }) {
  return function Closable() {
    const [visible, setVisible] = React.useState(true);
    close.current = () => setVisible(false);
    return <Sheet visible={visible} detent="large" onClose={noop}><DescribePage text="" onChangeText={noop} onContinue={noop} /></Sheet>;
  };
}

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

  await h.test('as the keyboard sets off, no frame or sheet jumps to where it is heading: the library already reports it visible at its destination, yet the padding starts where the keyboard is and reaches the destination only through its frames', async () => {
    const third = KEYBOARD_HEIGHT / 3;
    for (const device of DEVICES) {
      const surfaces: [string, React.ReactElement, (tree: Tree) => unknown, (overlap: number) => unknown][] = [
        ['advanced', advanced(), framePadding, (overlap) => overlap],
        ['a page in a sheet', sheeted(compose()), (tree) => flat(sheetCard(tree)).paddingBottom, (overlap) => sheetBottomPadding(overlap, useSafeAreaInsets().bottom)],
      ];
      for (const [name, element, padding, expected] of surfaces) {
        await on(device, element, async ({ tree }) => {
          await TestRenderer.act(async () => { emitKeyboardEvent('keyboardWillShow', KEYBOARD_HEIGHT); flushRevealFrames(); });
          h.eq(padding(tree), expected(0), `${device.name} ${name}: the keyboard has set off but not moved, so nothing is cut away yet`);
          await TestRenderer.act(async () => { stepKeyboard(third); });
          h.eq(padding(tree), expected(overlapOf(SCREEN_FRAME, keyboardWindow.height - third)), `${device.name} ${name}: a third of the way up, the padding is a third of the way`);
          await TestRenderer.act(async () => { stepKeyboard(KEYBOARD_HEIGHT); endKeyboard(KEYBOARD_HEIGHT); emitKeyboardEvent('keyboardDidShow', KEYBOARD_HEIGHT); flushRevealFrames(); });
          h.eq(padding(tree), expected(overlapOf(SCREEN_FRAME, KEYBOARD_TOP)), `${device.name} ${name}: and at the keyboard's top edge once it is up`);
        });
      }
    }
  });

  await h.test('as the keyboard rises, the focused block rises with it on a screen and in a sheet: in every keyboard frame, the frame that pads for it, it is kept clear of the scroll view’s end (where the scroll view clamps a scroll to its last bounds, within that frame’s travel), even though on iOS the field’s focus reaches JS after the keyboard has set off; at most one scroll a frame and none once it is where it is kept', async () => {
    // Advanced at the default text size: everything fits, so the scroll view can scroll only as far
    // as each frame's padding has shrunk it. The report sheet: its card pads, so the scroll view
    // shrinks under a note that is in view when the keyboard sets off.
    for (const device of [IOS, ANDROID_17]) {
      const surfaces: [string, () => React.ReactElement, Geometry & { nativeScroll: { viewport: number; content: number; offset: number } }, Rect][] = [
        ['advanced', advanced, { frame: SCREEN_FRAME, field: [520, 60], block: [520, 100], nativeScroll: { viewport: 700, content: 640, offset: 0 } }, [520, 100]],
        ['the report sheet', report, { frame: [0, 844], field: [300, 90], block: [300, 140], nativeScroll: { viewport: 500, content: 900, offset: 0 } }, [300, 140]],
      ];
      for (const [name, element, geometry, [top, height]] of surfaces) {
        await on(device, element(), async ({ tree, scrolls }) => {
          await draftLoaded();
          const native = geometry.nativeScroll;
          const rise = await riseThrough(tree, device, native);
          const below = () => Math.max(0, top + height + REVEAL_MARGIN - (native.offset + native.viewport));
          const visible = () => below() < 0.01;
          // A scroll view that clamps a scroll to the bounds it has when the scroll runs (Android's,
          // and a sheet's, whose card pads outside it) lands each frame's scroll before that frame's
          // padding has shrunk it: there the block may trail its place by that frame's travel, and
          // no more. An iOS screen knows its every frame's height: there it is exact.
          const clamps = device.os === 'android' || name !== 'advanced';
          h.eq(scrolls, [], `${device.name} ${name}: setup: the block is in view before the keyboard`);
          const hidden: number[] = [];
          for (let step = 1; step <= 6; step += 1) {
            const before = scrolls.length;
            const was = native.viewport;
            await rise.frame(step);
            h.ok(scrolls.length - before <= 1, `${device.name} ${name}: frame ${step}: at most one scroll`);
            if (below() > (clamps ? was - native.viewport : 0) + 0.01) hidden.push(step);
          }
          h.ok(scrolls.length > 0, `${device.name} ${name}: setup: the block had to be scrolled to stay in view`);
          h.eq(hidden, [], `${device.name} ${name}: on no frame of the rise is the block under the keyboard or what pads for it`);
          const risen = scrolls.length;
          await playFrames(3);
          h.eq(scrolls.length, risen, `${device.name} ${name}: once the block is where it is kept, no more scrolls`);
          await TestRenderer.act(async () => { endKeyboard(KEYBOARD_HEIGHT); emitKeyboardEvent('keyboardDidShow', KEYBOARD_HEIGHT); flushRevealFrames(); });
          await scrollReports(tree).offset(native.offset);
          h.ok(visible(), `${device.name} ${name}: and it stays in view once the keyboard has settled`);
          if (!clamps) h.eq(scrolls.length, risen, `${device.name} ${name}: where the rise kept it exactly, the settled keyboard’s recheck scrolls nothing`);
        }, geometry);
      }
    }
  });

  await h.test('iOS: a block already partly out of view as the keyboard sets off with its focus comes into view over the rise, not all in one frame, and once JS has heard of the focus is never more out of view than it was', async () => {
    // Android focuses the field, and JS scrolls it into view, before it asks for the keyboard.
    const native = { viewport: 500, content: 900, offset: 0 };
    const [top, height] = [420, 140];
    await on(IOS, report(), async ({ tree }) => {
      await draftLoaded();
      const rise = await riseThrough(tree, IOS, native);
      const below = () => Math.max(0, top + height + REVEAL_MARGIN - (native.offset + native.viewport));
      const atRest = below();
      h.ok(atRest > 0, 'setup: the block is partly below the scroll view’s end at rest');
      const seen: number[] = [];
      for (let step = 1; step <= 6; step += 1) {
        await rise.frame(step);
        seen.push(below());
      }
      const known = seen.slice(1);
      h.ok(known[0] > 0, `the first frame that knows the block leaves some of it to come (seen ${seen.join(', ')})`);
      h.ok(known.every((left) => left <= atRest + 0.01), `no later frame shows less of it than at rest (seen ${seen.join(', ')}, at rest ${atRest})`);
      h.ok(seen.at(-1)! < 0.01, `and it is all in view as the keyboard arrives (seen ${seen.join(', ')})`);
    }, { frame: [0, 844], field: [420, 90], block: [top, height], nativeScroll: native });
  });

  await h.test('a drag while the keyboard rises is the person’s own scroll: the UI thread stops following at once, before JS hears of it, and nothing scrolls the content back when the keyboard settles', async () => {
    for (const device of [IOS, ANDROID_17]) {
      const native = { viewport: 700, content: 640, offset: 0 };
      await on(device, advanced(), async ({ tree, scrolls }) => {
        const rise = await riseThrough(tree, device, native);
        await rise.frame(1);
        await rise.frame(2);
        await rise.frame(3);
        h.ok(scrolls.length > 0, `${device.name}: setup: the block is rising with the keyboard`);
        const before = scrolls.length;
        await beginDrag(native.offset);
        await rise.frame(4);
        await rise.frame(5);
        await rise.frame(6);
        await TestRenderer.act(async () => { endKeyboard(KEYBOARD_HEIGHT); emitKeyboardEvent('keyboardDidShow', KEYBOARD_HEIGHT); flushRevealFrames(); });
        await playFrames(3);
        h.eq(scrolls.length, before, `${device.name}: after the drag, no scroll on the frames that follow or once the keyboard settles`);
      }, { frame: SCREEN_FRAME, field: [520, 60], block: [520, 100], nativeScroll: native });
    }
  });

  await h.test('the reveal’s arithmetic: a block is scrolled just clear of the viewport’s nearer edge, a tall one shows its bottom, a rise scrolls only up and never past the content’s end, and a block hidden as the keyboard set off comes in over the rise', async () => {
    const at = { offset: 100, viewport: 400 };
    h.eq(revealOffset(at, 200, 300, 16), null, 'a block inside the viewport stays where it is');
    h.eq(revealOffset(at, 450, 520, 16), 136, 'a block running past the end is scrolled until its bottom is the margin above the end');
    h.eq(revealOffset(at, 60, 120, 16), 44, 'a block above the start is scrolled until its top is the margin below the start');
    h.eq(revealOffset({ offset: 10, viewport: 400 }, 5, 50, 16), 0, 'never to an offset above the content’s top');
    h.eq(revealOffset(at, 0, 900, 16), 516, 'a block taller than the viewport shows its bottom, where the caret and a row’s actions sit');
    h.eq(revealOffset(at, 0, 480, 16), null, 'and one whose bottom already shows is not scrolled to its top');
    h.eq(followOffset({ offset: 0, viewport: 300, content: 640 }, 580, 640, 16), 340, 'a block at the content’s end rises to the content’s end, not the margin past it');
    h.eq(followOffset({ offset: 0, viewport: 290, content: 280 }, 240, 280, 16), null, 'content shorter than the viewport is not scrolled at all, even for the margin');
    h.eq(followOffset({ offset: 200, viewport: 300, content: 1000 }, 100, 150, 16), null, 'a block above the viewport is left: a rising keyboard never scrolls the content down');
    h.eq(followOffset({ offset: 0, viewport: 300, content: 1000 }, 300, 360, 16), 76, 'a block below the end rises until it is the margin clear of it');
    h.eq(followOffset({ offset: 0, viewport: 300, content: 1000 }, 300, 360, 16, 50), 26, 'less the part still allowed to be hidden');
    h.eq(followOffset({ offset: 30, viewport: 300, content: 1000 }, 300, 360, 16, 50), null, 'and not at all while that part is already in view');
    h.eq(hiddenAtRest(at, 200, 300, 16), 0, 'a block in view as the keyboard sets off has nothing hidden');
    h.eq(hiddenAtRest(at, 450, 520, 16), 36, 'one running past the end has hidden as much as it runs past, margin included');
    h.eq(hiddenAtRest(at, 60, 120, 16), 0, 'one above the start has nothing hidden below');
    h.eq([riseProgress(100, 300, 100), riseProgress(100, 300, 200), riseProgress(100, 300, 300)], [0, 0.5, 1], 'a rise is as far along as the keyboard is between where it set off and where it is heading');
    h.eq([riseProgress(100, 300, 40), riseProgress(100, 300, 380)], [0, 1], 'never before its start or past its end');
    h.eq([riseProgress(300, 300, 0), riseProgress(300, 100, 200)], [1, 1], 'a keyboard that takes nothing more is already there');
  });

  await h.test('iOS: a field at the content’s end rises with the keyboard to the content’s end and no further, on every frame and once the keyboard has settled; a screen’s scroll view does not clamp a scroll itself, and a scroll past the end would leave a blank strip above the footer', async () => {
    const native = { viewport: 700, content: 640, offset: 0 };
    await on(IOS, advanced(), async ({ tree, scrolls }) => {
      const rise = await riseThrough(tree, IOS, native);
      const end = () => Math.max(0, native.content - native.viewport);
      const past: string[] = [];
      for (let step = 1; step <= 6; step += 1) {
        await rise.frame(step);
        if (native.offset > end() + 0.01) past.push(`frame ${step}: ${native.offset} past ${end()}`);
      }
      h.ok(scrolls.length > 0, 'setup: the rise scrolled the field up');
      h.eq(past, [], 'no frame of the rise scrolls past the content’s end');
      h.ok(Math.abs(native.offset - end()) < 0.01, `the rise ends with the content’s end at the scroll view’s end (offset ${native.offset}, end ${end()})`);
      const risen = scrolls.length;
      await TestRenderer.act(async () => { endKeyboard(KEYBOARD_HEIGHT); emitKeyboardEvent('keyboardDidShow', KEYBOARD_HEIGHT); flushRevealFrames(); });
      h.ok(native.offset <= end() + 0.01, `nor does the recheck once the keyboard has settled (offset ${native.offset}, end ${end()})`);
      h.eq(scrolls.length, risen, 'which, with the field already as far up as the content goes, scrolls nothing');
      native.offset = end() + 40;
      await scrollReports(tree).offset(native.offset);
      await TestRenderer.act(async () => { emitKeyboardEvent('keyboardDidShow', KEYBOARD_HEIGHT); flushRevealFrames(); });
      h.ok(Math.abs(native.offset - end()) < 0.01, `a scroll left past the content’s end is pulled back to it when the keyboard settles (offset ${native.offset}, end ${end()})`);
    }, { frame: SCREEN_FRAME, field: [580, 60], block: [580, 60], nativeScroll: native });
  });

  await h.test('a keyboard that changes height while up (the emoji keyboard) scrolls the field exactly as far as the change takes from the scroll view: on a screen mounted with the keyboard already up, and after iOS’s first keyboard, whose Done bar the library’s end report leaves out, on a screen and in a sheet', async () => {
    const withoutBar = KEYBOARD_HEIGHT - 44;
    const grown = KEYBOARD_HEIGHT + 100;
    /** Plays the change; returns every frame, and the settled keyboard, that left the block's bottom
     *  anywhere but its margin above the scroll view's end (or where it already was, if higher). */
    const misplaced = async (tree: Tree, native: { viewport: number; content: number; offset: number }, bottom: number): Promise<string[]> => {
      const change = await changeThrough(tree, native, KEYBOARD_HEIGHT, grown);
      const off: string[] = [];
      const check = (when: string, before: number) => {
        const kept = Math.max(before, bottom + REVEAL_MARGIN - native.viewport);
        if (Math.abs(native.offset - kept) > 0.01) off.push(`${when}: offset ${native.offset}, kept at ${kept}`);
      };
      for (let step = 1; step <= 6; step += 1) {
        const before = native.offset;
        await change.frame(step);
        check(`frame ${step}`, before);
      }
      const before = native.offset;
      await change.settle();
      check('settled', before);
      return off;
    };
    const focus = async (tree: Tree, native: { viewport: number; content: number }) => {
      const reports = scrollReports(tree);
      await reports.viewport(native.viewport);
      await reports.content(native.content);
      mountContent(tree);
      await TestRenderer.act(async () => { field(tree).props.onFocus({}); flushRevealFrames(); });
    };
    const mountedUp = { viewport: 700 - overlapOf(SCREEN_FRAME, KEYBOARD_TOP), content: 1200, offset: 0 };
    await on(IOS, advanced(), async ({ tree, scrolls }) => {
      await TestRenderer.act(async () => { frames(tree)[0].props.onLayout(); });
      h.eq(framePadding(tree), overlapOf(SCREEN_FRAME, KEYBOARD_TOP), 'setup: the screen mounted padded for the keyboard already up');
      await focus(tree, mountedUp);
      h.eq(scrolls, [], 'setup: the field is in view');
      h.eq(await misplaced(tree, mountedUp, 360), [], 'mounted with the keyboard up: the field rises by what the change takes, not by the whole keyboard');
    }, { frame: SCREEN_FRAME, field: [300, 60], block: [300, 60], keyboard: KEYBOARD_HEIGHT, nativeScroll: mountedUp });
    // What each pads for the whole keyboard, Done bar included.
    const surfaces: [string, () => React.ReactElement, Geometry & { nativeScroll: { viewport: number; content: number; offset: number } }, number, number][] = [
      ['advanced', advanced, { frame: SCREEN_FRAME, field: [300, 60], block: [300, 60], nativeScroll: { viewport: 700, content: 1200, offset: 0 } }, 360, overlapOf(SCREEN_FRAME, KEYBOARD_TOP)],
      ['the report page in a sheet', report, { frame: [0, 844], field: [40, 60], block: [40, 60], nativeScroll: { viewport: 500, content: 900, offset: 0 } }, 100, sheetBottomPadding(KEYBOARD_HEIGHT, useSafeAreaInsets().bottom)],
    ];
    for (const [name, element, geometry, bottom, whole] of surfaces) {
      await on(IOS, element(), async ({ tree, scrolls }) => {
        await draftLoaded();
        const native = geometry.nativeScroll;
        await focus(tree, native);
        const rest = Number(flat(padded(frames(tree)[0])).paddingBottom);
        await TestRenderer.act(async () => { moveKeyboard(withoutBar, [withoutBar / 2]); flushRevealFrames(); });
        await TestRenderer.act(async () => { changeKeyboardFrame(KEYBOARD_HEIGHT); });
        await TestRenderer.act(async () => { endKeyboard(withoutBar); });
        const up = Number(flat(padded(frames(tree)[0])).paddingBottom);
        native.viewport -= up - rest;
        await scrollReports(tree).viewport(native.viewport);
        h.eq([up, scrolls], [whole, []], `setup: ${name} is padded for the keyboard with its Done bar, and the field is in view`);
        h.eq(await misplaced(tree, native, bottom), [], `${name}: after the first keyboard, the field rises by what the change takes, not by the Done bar as well`);
      }, geometry);
    }
  });

  await h.test('iOS: a keyboard that changes height at once (the emoji keyboard: a start with no duration, its end some frames later, no frames between) pads for its new height and keeps the field in view in the start’s own frame, on a screen and in a sheet', async () => {
    const grown = KEYBOARD_HEIGHT + 100;
    const instantly = (to: number) => TestRenderer.act(async () => { startKeyboard(to, 0); emitKeyboardEvent('keyboardWillShow', to); });
    const settle = (to: number) => TestRenderer.act(async () => { endKeyboard(to); emitKeyboardEvent('keyboardDidShow', to); flushRevealFrames(); });
    const native = { viewport: 700 - overlapOf(SCREEN_FRAME, KEYBOARD_TOP), content: 1200, offset: 0 };
    await on(IOS, advanced(), async ({ tree, scrolls }) => {
      await TestRenderer.act(async () => { frames(tree)[0].props.onLayout(); });
      const reports = scrollReports(tree);
      await reports.viewport(native.viewport);
      await reports.content(native.content);
      mountContent(tree);
      await TestRenderer.act(async () => { field(tree).props.onFocus({}); flushRevealFrames(); });
      h.eq(scrolls, [], 'setup: the field is in view above the keyboard');
      await instantly(grown);
      const kept = 360 + REVEAL_MARGIN - (native.viewport - (grown - KEYBOARD_HEIGHT));
      h.eq([framePadding(tree), native.offset], [overlapOf(SCREEN_FRAME, keyboardWindow.height - grown), kept], 'a screen: in the start’s own frame the frame ends at the new keyboard and the field sits its margin above it');
      await settle(grown);
      h.eq([framePadding(tree), native.offset], [overlapOf(SCREEN_FRAME, keyboardWindow.height - grown), kept], 'a screen: the end, frames later, moves nothing');
    }, { frame: SCREEN_FRAME, field: [300, 60], block: [300, 60], keyboard: KEYBOARD_HEIGHT, nativeScroll: native });
    const safe = useSafeAreaInsets().bottom;
    await on(IOS, report(), async ({ tree }) => {
      await draftLoaded();
      await keyboard(IOS, true);
      const card = () => flat(padded(frames(tree)[0])).paddingBottom;
      h.eq(card(), sheetBottomPadding(KEYBOARD_HEIGHT, safe), 'setup: the sheet’s card is padded for the keyboard');
      await instantly(grown);
      h.eq(card(), sheetBottomPadding(grown, safe), 'a sheet: in the start’s own frame its card is padded for the new keyboard');
      await settle(grown);
      h.eq(card(), sheetBottomPadding(grown, safe), 'a sheet: the end moves nothing');
    }, { frame: [0, 844], field: [300, 90] });
  });

  await h.test('a frame mounted after a hide has ended on the UI thread, before JS hears keyboardDidHide, pads for no keyboard; and the next show of that height still rises with the keyboard frame by frame', async () => {
    const gate = mountsLater(advanced());
    const native = { viewport: 700, content: 1200, offset: 0 };
    await on(IOS, gate.element, async ({ tree, scrolls }) => {
      await TestRenderer.act(async () => moveKeyboard(KEYBOARD_HEIGHT));
      // The hide sets off and ends on the UI thread; JS has not yet heard keyboardDidHide.
      await TestRenderer.act(async () => { emitKeyboardEvent('keyboardWillHide', 0); startKeyboard(0); stepKeyboard(KEYBOARD_HEIGHT / 2); endKeyboard(0); });
      await TestRenderer.act(async () => gate.open());
      await TestRenderer.act(async () => { frames(tree)[0].props.onLayout(); });
      h.eq(framePadding(tree), 0, 'mounted in that window, the screen pads for no keyboard');
      await TestRenderer.act(async () => emitKeyboardEvent('keyboardDidHide', 0));
      h.eq(framePadding(tree), 0, 'nor once JS hears the hide');
      const rise = await riseThrough(tree, IOS, native);
      await rise.frame(1);
      await rise.frame(2);
      await rise.frame(3);
      h.ok(scrolls.length > 0, `the next show of the same height is a rise: the field follows it in its frames, before it settles (${scrolls.length} scrolls by the third frame)`);
    }, { frame: SCREEN_FRAME, field: [600, 60], block: [600, 60], nativeScroll: native });
  });

  await h.test('Android: a frame mounted after a show has ended on the UI thread, before JS hears keyboardDidShow, is padded for the keyboard as JS hears it settle; and the hide after it lowers it frame by frame', async () => {
    const gate = mountsLater(advanced());
    await on(ANDROID_15, gate.element, async ({ tree }) => {
      // The show sets off and ends on the UI thread; JS has heard keyboardWillShow, not yet keyboardDidShow.
      await TestRenderer.act(async () => { emitKeyboardEvent('keyboardWillShow', KEYBOARD_HEIGHT); startKeyboard(KEYBOARD_HEIGHT); stepKeyboard(KEYBOARD_HEIGHT / 2); endKeyboard(KEYBOARD_HEIGHT); });
      await TestRenderer.act(async () => gate.open());
      await TestRenderer.act(async () => { frames(tree)[0].props.onLayout(); });
      h.eq(framePadding(tree), 0, 'mounted in that window, the screen does not yet know the keyboard has settled');
      await TestRenderer.act(async () => emitKeyboardEvent('keyboardDidShow', KEYBOARD_HEIGHT));
      h.eq(framePadding(tree), overlapOf(SCREEN_FRAME, KEYBOARD_TOP), 'once JS hears it settle, the screen ends at the keyboard');
      const half = KEYBOARD_HEIGHT / 2;
      await TestRenderer.act(async () => { emitKeyboardEvent('keyboardWillHide', 0); startKeyboard(0); stepKeyboard(half); });
      h.eq(framePadding(tree), overlapOf(SCREEN_FRAME, keyboardWindow.height - half), 'the hide lowers it in its frames');
      await TestRenderer.act(async () => { endKeyboard(0); emitKeyboardEvent('keyboardDidHide', 0); });
      h.eq(framePadding(tree), 0, 'and ends it at no keyboard');
    });
  });

  await h.test('iOS: a field focused before its scroll view has reported its content waits for it, so a screen’s reveal, which iOS does not clamp, never runs past the content’s end', async () => {
    await on(IOS, advanced(), async ({ tree, scrolls }) => {
      const reports = scrollReports(tree);
      await reports.viewport(400);
      mountContent(tree);
      await TestRenderer.act(async () => { field(tree).props.onFocus({}); flushRevealFrames(); });
      h.eq(scrolls, [], 'nothing scrolls while the content’s size is unknown');
      await reports.content(560);
      h.eq(scrolls, [560 - 400], 'once it is known, the field is scrolled as far as the content’s end, and no further');
    }, { frame: SCREEN_FRAME, field: [500, 60], block: [500, 100] });
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
        // The page's frame: the view around the box that holds its scroll view and the header fade.
        const pageFrame = hostParent(hostParent(scrollView(tree))!)!;
        for (let at: Node | null = pageFrame; at && at !== card; at = hostParent(at)) chain.push(at);
        h.ok(chain.length >= 2, `${name}: setup: the page's frame sits inside the card's body`);
        h.ok(chain.every((link) => Number(flat(link).flexGrow) >= 1), `${name}: the frame and the body around it grow to fill the card`);
      });
    }
  });

  await h.test('an overlay’s field asks for focus only once the overlay has reported it is shown, on Android and on iOS (a Describe mounted while another sheet still holds the screen opened unfocused, with no keyboard); iOS then focuses it exactly once, a frame later', async () => {
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
      await on(IOS, emptyDescribe, async ({ tree, focused }) => {
        await playFrames(5);
        h.eq(focused(), 0, 'iOS: the sheet is not presented yet, so the field has not called focus(), which would land nowhere');
        await TestRenderer.act(async () => tree.root.find(isType('Modal')).props.onShow());
        h.eq(focused(), 0, 'iOS: the report alone focuses nothing in its own frame: the Done bar links first');
        await playFrames(1);
        h.eq(focused(), 1, 'iOS: a frame after the report, the field is focused');
        await playFrames(5);
        h.eq([focused(), fieldAsks()], [1, 0], 'iOS: focused exactly once, and never asks for the keyboard by name');
      });
    } finally {
      release();
    }
  });

  await h.test('Android: a sheet that is leaving asks for no keyboard — closed before its window reports it is shown, or while its field is still asking (the keyboard would rise over a sheet on its way out)', async () => {
    const close = { current: noop };
    const Closable = closableSheet(close);
    const release = refuseModalPresentations();
    const hold = holdAnimations();
    try {
      await on(ANDROID_17, <Closable />, async ({ tree, focused }) => {
        await animateFrames(1);
        await TestRenderer.act(async () => close.current());
        await TestRenderer.act(async () => tree.root.find(isType('Modal')).props.onShow());
        await playFrames(5);
        h.eq([focused(), fieldAsks()], [0, 0], 'closed before the report: the field neither takes focus nor asks');
      });
      await on(ANDROID_17, <Closable />, async ({ tree }) => {
        await TestRenderer.act(async () => tree.root.find(isType('Modal')).props.onShow());
        await playFrames(2);
        await animateFrames(2);
        const asked = fieldAsks();
        h.ok(asked > 0, 'setup: shown, the field is asking');
        await TestRenderer.act(async () => close.current());
        await playFrames(5);
        h.eq(fieldAsks(), asked, 'closed while asking: it asks no more');
      });
    } finally {
      hold();
      release();
    }
  });

  await h.test('Android: a close that starts while the keyboard is still on its way cancels it — the show that comes after the close began is cut away at once, unanimated; a sheet that stays keeps its keyboard', async () => {
    const close = { current: noop };
    const Closable = closableSheet(close);
    const release = refuseModalPresentations();
    const hold = holdAnimations();
    try {
      await on(ANDROID_17, <Closable />, async ({ tree }) => {
        await TestRenderer.act(async () => tree.root.find(isType('Modal')).props.onShow());
        await playFrames(2);
        await TestRenderer.act(async () => moveKeyboard(KEYBOARD_HEIGHT));
        h.eq(dismissals.length, 0, 'control: open, the keyboard it asked for stays');
      });
      await on(ANDROID_17, <Closable />, async ({ tree }) => {
        await TestRenderer.act(async () => tree.root.find(isType('Modal')).props.onShow());
        await playFrames(2);
        await animateFrames(2);
        h.ok(fieldAsks() > 0 && !keyboardState.visible, 'setup: the field has asked, and no keyboard has come yet');
        await TestRenderer.act(async () => close.current());
        h.eq(dismissals.length, 0, 'setup: no keyboard to put away as the close starts');
        await TestRenderer.act(async () => moveKeyboard(KEYBOARD_HEIGHT));
        h.eq(dismissals, [{ animated: false }], 'the keyboard that comes once the close began is cut away at once, with no frames');
      });
    } finally {
      hold();
      release();
    }
  });

  await h.test('Android: the window is shown before it is served, so the first request is dropped and focus() cannot repeat it; the field keeps asking, frame by frame, until the keyboard comes, then stops', async () => {
    const emptyDescribe = sheeted(<DescribePage text="" onChangeText={noop} onContinue={noop} />);
    const release = refuseModalPresentations();
    try {
      await on(ANDROID_17, emptyDescribe, async ({ tree, focused, ime }) => {
        await TestRenderer.act(async () => tree.root.find(isType('Modal')).props.onShow());
        await playFrames(1);
        h.eq([focused(), keyboardState.visible], [1, false], 'the window reports it is shown: the field takes focus, and the keyboard does not come, as its window is not served yet');
        await playFrames(12);
        h.eq([focused(), keyboardState.visible], [1, false], 'many frames on, it is still focused with no keyboard, and has not called focus() again, which would do nothing');
        ime.served = true;
        await playFrames(1);
        h.eq(keyboardState.visible, true, 'the first frame after the window is served raises the keyboard, without a tap');
        const asked = fieldAsks();
        await playFrames(10);
        h.eq(fieldAsks(), asked, 'once the keyboard is on its way it asks no more');
      });
    } finally {
      release();
    }
  });

  await h.test('Android stops asking for the keyboard when the field loses focus, when the keyboard is already up, and after a bounded number of frames; iOS focuses once and never asks the keyboard library', async () => {
    const emptyDescribe = sheeted(<DescribePage text="" onChangeText={noop} onContinue={noop} />);
    const shown = (tree: Tree) => TestRenderer.act(async () => tree.root.find(isType('Modal')).props.onShow());
    const release = refuseModalPresentations();
    try {
      await on(ANDROID_17, emptyDescribe, async ({ tree }) => {
        await shown(tree);
        await playFrames(300);
        const given = fieldAsks();
        h.ok(given > 0, 'setup: a window that is never served is asked');
        await playFrames(100);
        h.eq(fieldAsks(), given, 'a window that is never served (no soft keyboard with a hardware one) is not asked for ever');
      });
      await on(ANDROID_17, emptyDescribe, async ({ tree }) => {
        await shown(tree);
        await playFrames(2);
        const before = fieldAsks();
        h.ok(before > 0, 'setup: the field is asking');
        await TestRenderer.act(async () => field(tree).props.onBlur({}));
        await playFrames(5);
        h.eq(fieldAsks(), before, 'the person put the keyboard away: the field stops asking');
      });
      await on(ANDROID_17, emptyDescribe, async ({ tree }) => {
        await keyboard(ANDROID_17, true);
        await shown(tree);
        await playFrames(5);
        h.eq(fieldAsks(), 0, 'a keyboard that is already up (the page before it had one) is not asked for');
      });
      await on(IOS, emptyDescribe, async ({ tree, focused }) => {
        await shown(tree);
        await playFrames(5);
        h.eq([focused(), fieldAsks()], [1, 0], 'iOS focuses the field once, a frame after it is shown, and does not ask');
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

  await h.test('the first-run sheet: the terms checkbox is pinned with the action it unlocks, never below the fold of a disabled Agree; its blocks are spaced once, a group gap apart and a group gap from the footer', async () => {
    const firstRun = <FirstRunSheet visible language="en" onLanguageChange={noop} termsDue consentDue onAgree={noop} onClose={noop} />;
    await on(IOS, firstRun, async ({ tree }) => {
      const box = () => tree.root.find(isCheckbox);
      const agree = () => button(tree, LEGAL_COPY.en.consentAgree);
      await measureFooter(measuredFooterAround(agree()), 200);
      h.ok(nearest(box(), 'ScrollView') == null && measuredFooterAround(box()) === measuredFooterAround(agree()), 'at default size the checkbox is in the pinned footer, with Agree');
      const blocks = hostChildrenOf(scrollView(tree));
      const space = (node: Node, side: 'marginTop' | 'marginBottom' | 'paddingBottom') => Number(flat(node)[side] ?? 0);
      const content = StyleSheet.flatten(scrollView(tree).props.contentContainerStyle) as Record<string, unknown>;
      const gaps = blocks.slice(1).map((next, i) => space(blocks[i], 'marginBottom') + Number(content.gap ?? 0) + space(next, 'marginTop'));
      h.eq(gaps, gaps.map(() => LAYOUT.gapBetweenGroups), 'every block one group gap from the next');
      h.eq(space(blocks.at(-1)!, 'marginBottom') + Number(content.paddingBottom ?? 0), LAYOUT.gapBetweenGroups, 'and the last one a group gap from the footer, no band of more');
    });
  });

  await h.test('the first-run sheet on a small phone (360 × 640 dp): at default size the checkbox, Agree and Not now stay pinned in English and in French; at the largest text size the footer, checkbox and all, scrolls with the content', async () => {
    // The footer's height as the Android emulator laid it out (uiautomator bounds, Whim_Verify at
    // 1080 × 1920 px, 480 dpi), from its top padding to its bottom one.
    const measured: [string, 'en' | 'fr', number, boolean][] = [
      ['English at default size', 'en', 204, true],
      ['French at default size (checkbox label and Agree on two lines)', 'fr', 232, true],
      ['English at 200%', 'en', 282, false],
      ['French at 200%', 'fr', 318, false],
    ];
    const window = keyboardWindow.height;
    keyboardWindow.height = 640;
    try {
      for (const [what, language, footer, pinned] of measured) {
        const firstRun = <FirstRunSheet visible language={language} onLanguageChange={noop} termsDue consentDue onAgree={noop} onClose={noop} />;
        await on(ANDROID_15, firstRun, async ({ tree }) => {
          const agree = () => button(tree, LEGAL_COPY[language].consentAgree);
          await measureFooter(measuredFooterAround(agree()), footer);
          const scrolled = [tree.root.find(isCheckbox), agree(), button(tree, LEGAL_COPY[language].consentDecline)].map((node) => nearest(node, 'ScrollView') != null);
          h.eq(scrolled, [!pinned, !pinned, !pinned], `${what}: a ${footer} dp footer ${pinned ? 'stays pinned, in reach without a scroll' : 'scrolls with the content'}`);
        });
      }
    } finally {
      keyboardWindow.height = window;
    }
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

  await h.test('every launcher field wears ink for its caret and selection handles, selected text stays readable on its highlight, it paints its own background, and on iOS a one-line field sets no line height and a different selection colour from a multiline one (#218)', async () => {
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
          // iOS selection colours by line count: one recycled native field crossing between the two
          // keeps its old tint unless the colour differs (`fieldSelection`).
          const iosSelections = new Map<boolean, Set<string>>([[false, new Set()], [true, new Set()]]);
          for (const [name, element, open, multiline] of fields) {
            await on(device, element, async ({ tree }) => {
              await open(tree);
              const input = field(tree);
              const where = `${scheme} ${device.name} ${name}`;
              const background = paintedBackground(input);
              h.ok(background !== undefined, `${where}: it paints its own background, which covers Android's default field underline`);
              if (device.os === 'ios') {
                const [r, g, b, a] = rgba(String(input.props.selectionColor));
                h.ok(JSON.stringify([r, g, b]) === JSON.stringify(rgba(ink).slice(0, 3)) && a >= 0.99, `${where}: ink tints the caret, the handles and the highlight iOS draws translucent itself (${input.props.selectionColor})`);
                iosSelections.get(multiline)?.add(String(input.props.selectionColor));
              } else {
                h.eq([input.props.cursorColor, input.props.selectionHandleColor], [ink, ink], `${where}: ink caret and selection handles`);
                const contrast = contrastOnHighlight(String(flat(input).color), String(input.props.selectionColor), String(background));
                h.ok(contrast >= 4.5, `${where}: the text Android paints its highlight over stays readable (${contrast.toFixed(2)}:1, at least 4.5:1)`);
              }
              const oneLineOnIos = device.os === 'ios' && !multiline;
              h.eq(typeof flat(input).lineHeight, oneLineOnIos ? 'undefined' : 'number', `${where}: ${oneLineOnIos ? 'no line height, so iOS keeps its descenders' : 'its type’s line height'}`);
            });
          }
          if (device.os === 'ios') {
            const [oneLine, multiline] = [[...(iosSelections.get(false) ?? [])], [...(iosSelections.get(true) ?? [])]];
            h.ok(oneLine.length > 0 && multiline.length > 0 && oneLine.every((colour) => !multiline.includes(colour)),
              `${scheme} iOS: a one-line field's selection colour (${oneLine.join(', ')}) differs from a multiline one's (${multiline.join(', ')}), so a recycled native field that changes line mode applies its ink again`);
          }
        }
      } finally {
        await TestRenderer.act(async () => setColorScheme('light'));
      }
    }
  });

  await h.test('iOS: the keyboard’s Done bar is drawn in the scheme the shell is in, Done readable on it, and its label never outgrows the bar, at any text size', async () => {
    for (const scheme of ['light', 'dark'] as const) {
      await TestRenderer.act(async () => setColorScheme(scheme));
      try {
        await on(IOS, report(), async ({ tree }) => {
          await draftLoaded();
          const bar = doneBars(tree)[0];
          const strip = bar.find((n) => String(n.type) === 'View' && flat(n).borderTopWidth === StyleSheet.hairlineWidth);
          const label = bar.find((n) => String(n.type) === 'Text' && textOf(n) === COPY.keyboardDone);
          const fill = String(bar.props.backgroundColor);
          const ink = String(flat(label).color);
          const readable = contrastOf(fill, ink);
          h.ok(readable >= 4.5, `${scheme}: Done stands ${readable.toFixed(2)}:1 on its bar (at least 4.5:1)`);
          // The bar sits between the sheet and the keyboard: it is nearer this scheme's sheet than the other's.
          const own = contrastOf(fill, COLORS[scheme].sheet);
          const other = contrastOf(fill, COLORS[scheme === 'light' ? 'dark' : 'light'].sheet);
          h.ok(own < other, `${scheme}: the bar is a ${scheme} strip (${own.toFixed(2)}:1 from this scheme's sheet, ${other.toFixed(2)}:1 from the other's)`);
          const largest = Number(flat(label).lineHeight) * Math.min(IOS_LARGEST_TEXT, Number(label.props.maxFontSizeMultiplier ?? Infinity));
          h.ok(largest <= Number(flat(strip).height), `${scheme}: at iOS's largest text size Done's line (${largest.toFixed(1)}) fits the ${String(flat(strip).height)} pt bar`);
        }, { frame: [0, 844], field: [300, 90] });
      } finally {
        await TestRenderer.act(async () => setColorScheme('light'));
      }
    }
  });

  await h.test('describe on iOS: Done, the footer’s empty space and a drag put the keyboard away without continuing', async () => {
    const s = spies();
    await on(IOS, compose(s.fn('continue'), s.fn('change')), async ({ tree }) => {
      h.eq(field(tree).props.inputAccessoryViewID != null && doneBars(tree).some((bar) => bar.props.nativeID === field(tree).props.inputAccessoryViewID), true, 'the field has a Done bar');
      h.eq(scrollView(tree).props.keyboardDismissMode, 'interactive', 'dragging the content pulls the keyboard down');
      h.eq(scrollView(tree).props.keyboardShouldPersistTaps, 'handled', 'a tap a control handles reaches the control');
      h.eq(await dismissBoth(tree), 2, 'Done and a tap on the footer’s empty space each put the keyboard away');
      h.eq([s.count('continue'), s.count('change')], [0, 0], 'without continuing or changing the text');
    });
  });

  await h.test('describe on Android: a drag dismisses, there is no Done bar, and the footer’s empty space puts the keyboard away', async () => {
    const s = spies();
    await on(ANDROID_17, compose(s.fn('continue')), async ({ tree }) => {
      h.eq([scrollView(tree).props.keyboardDismissMode, doneBars(tree).length], ['on-drag', 0], 'a drag dismisses; no Done bar');
      const before = Keyboard.dismissed;
      await tapOn(emptySpace(tree));
      h.eq([Keyboard.dismissed - before, s.count('continue')], [1, 0], 'a tap on the footer’s empty space puts the keyboard away, without continuing');
    });
  });

  await h.test('a drag that starts on plain content can scroll every keyboard frame on iOS, a screen’s or a sheet’s: no view around its scroll view answers the touch', async () => {
    const surfaces: [string, React.ReactElement][] = [
      ['Describe', compose()],
      ['Plan', plan()],
      ['Advanced', advanced()],
      ['the report page in a sheet', report()],
      ['a page in a sheet', sheeted(compose())],
    ];
    for (const [name, element] of surfaces) {
      await on(IOS, element, async ({ tree }) => {
        await draftLoaded();
        const scrolls = tree.root.findAll(isType('ScrollView'));
        h.ok(scrolls.length > 0, `setup: ${name} scrolls`);
        for (const scroll of scrolls) h.eq(answerersAround(scroll), [], `${name}: a touch nothing in the scroll view takes is left to the scroll view`);
      });
    }
  });

  await h.test('a tap on empty content inside every keyboard frame, a screen’s or a sheet’s, on iOS and Android, is the scroll view’s own to answer: it keeps taps “handled”, so with the keyboard up it takes the tap a control does not and puts the keyboard away, and no view around it takes the tap first', async () => {
    // React Native's ScrollView does the putting away itself (`keyboardShouldPersistTaps="handled"`:
    // it answers a touch no child answers while a field is focused and the keyboard is up, and blurs
    // the field on release); this rig draws a ScrollView as a plain host view, so what is locked here
    // is the arrangement that behaviour rests on. Seen on an iOS 27 simulator and an Android 17
    // emulator in Advanced and in the report sheet.
    const surfaces: [string, React.ReactElement][] = [
      ['Describe', compose()],
      ['Plan', plan()],
      ['Advanced', advanced()],
      ['the report page in a sheet', report()],
      ['a page in a sheet', sheeted(compose())],
    ];
    for (const device of [IOS, ANDROID_17]) {
      for (const [name, element] of surfaces) {
        await on(device, element, async ({ tree }) => {
          await draftLoaded();
          const scrolls = tree.root.findAll(isType('ScrollView'));
          h.ok(scrolls.length > 0, `setup: ${device.name} ${name} scrolls`);
          for (const scroll of scrolls) {
            h.eq([scroll.props.keyboardShouldPersistTaps, answerersAround(scroll)], ['handled', []], `${device.name} ${name}: the scroll view keeps taps “handled”, with nothing around it to take them`);
          }
        });
      }
    }
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
        h.eq([focused(), fieldAsks()], device.os === 'android' ? [1, 1] : [1, 0], `${device.name}: ${device.os === 'android' ? 'and a frame later asks for its keyboard by name, since focus() of a focused field does nothing' : 'then focuses it once'}`);
        if (device.os === 'ios') h.ok(doneBars(tree).some((bar) => bar.props.nativeID === field(tree).props.inputAccessoryViewID), 'iOS: its Done bar mounts with it');
        await TestRenderer.act(async () => field(tree).props.onFocus({}));
        await keyboard(device, true);
        await reports.viewport(400);
        h.eq(scrolls.at(-1), 600 + 180 + REVEAL_MARGIN - 400, `${device.name}: with the keyboard up, the row's bottom (Save and Cancel), not just its field, sits clear above the scroll view's end`);
        geometry.block = [600, 220];
        await reports.content(1040);
        h.eq(scrolls.at(-1), 600 + 220 + REVEAL_MARGIN - 400, `${device.name}: as typing grows the row, it stays in view`);
        h.ok(nearest(button(tree, COPY.planBuild), 'ScrollView') == null, `${device.name}: Make it stays pinned below the scroll view`);
      }, geometry);
    }
    await on(IOS, plan(s.fn('row'), s.fn('build')), async ({ tree }) => {
      await press(tree.root.find((n) => String(n.type) === 'Pressable' && n.props.accessibilityRole === 'button' && textOf(n).includes('A big dial')));
      h.eq(await dismissBoth(tree), 2, 'Done and the footer’s empty space put the keyboard away');
      h.eq(field(tree).props.value, 'A big dial', 'leaving the row open');
      h.eq([s.count('row'), s.count('build')], [0, 0], 'saving and building nothing');
    });
  });

  await h.test('Android plan: the edited row’s field keeps asking until the keyboard is up — through a show that sets off and ends hidden, one that reports nothing after it set off, and a blur and refocus while the row is revealed — then stops', async () => {
    const geometry: Geometry = { frame: SCREEN_FRAME, field: [630, 60], block: [600, 180] };
    for (const device of [ANDROID_14, ANDROID_17]) {
      await on(device, plan(), async ({ tree, ime }) => {
        await editFourthRow(tree);
        await playFrames(3);
        const asked = fieldAsks();
        h.ok(asked >= 1 && !keyboardState.visible, `${device.name}: setup: the field asks, its window not served yet`);
        await TestRenderer.act(async () => emitKeyboardEvent('keyboardWillShow', KEYBOARD_HEIGHT));
        await playFrames(5);
        h.eq(fieldAsks(), asked, `${device.name}: while a keyboard is on its way, the field waits for it`);
        await TestRenderer.act(async () => emitKeyboardEvent('keyboardDidHide', 0));
        ime.served = true;
        await playFrames(1);
        h.eq([fieldAsks(), keyboardState.visible], [asked + 1, true], `${device.name}: the show ended hidden, so the next frame asks again and the keyboard comes, without a tap`);
        await playFrames(10);
        h.eq(fieldAsks(), asked + 1, `${device.name}: once the keyboard is up it asks no more`);
      }, geometry);
      await on(device, plan(), async ({ tree }) => {
        await editFourthRow(tree);
        await playFrames(1);
        await TestRenderer.act(async () => emitKeyboardEvent('keyboardWillShow', KEYBOARD_HEIGHT));
        await playFrames(10);
        const waited = fieldAsks();
        h.eq(waited, 1, `${device.name}: setup: asked once, then waiting for the keyboard on its way`);
        // The cut-short show leaves the library reporting a keyboard; the platform shows one once asked.
        const shows: number[] = [];
        keyboardShows.handler = () => { shows.push(fieldAsks()); moveKeyboard(KEYBOARD_HEIGHT); };
        await playFrames(40);
        h.eq([shows, fieldAsks()], [[waited + 1], waited + 1], `${device.name}: a show that reports nothing after it set off is asked for again, once, and the keyboard comes`);
      }, geometry);
      await on(device, plan(), async ({ tree, ime }) => {
        await editFourthRow(tree);
        await TestRenderer.act(async () => field(tree).props.onFocus({}));
        await playFrames(2);
        await TestRenderer.act(async () => field(tree).props.onBlur({}));
        const blurredAt = fieldAsks();
        await playFrames(5);
        h.eq(fieldAsks(), blurredAt, `${device.name}: while the field is not focused, it asks nothing (a request would focus it again)`);
        await TestRenderer.act(async () => field(tree).props.onFocus({}));
        ime.served = true;
        await playFrames(1);
        h.eq([fieldAsks(), keyboardState.visible], [blurredAt + 1, true], `${device.name}: focused again before the keyboard came, it asks again, and the keyboard comes`);
      }, geometry);
    }
  });

  await h.test('Android plan: a row field that took focus before it was attached (the keyboard library still names the page before’s field, gone from the screen) gets its keyboard once the system serves it, without a tap, as every request names the field itself', async () => {
    const geometry: Geometry = { frame: SCREEN_FRAME, field: [630, 60], block: [600, 180] };
    for (const device of [ANDROID_14, ANDROID_17]) {
      await on(device, plan(), async ({ tree, ime }) => {
        await editFourthRow(tree);
        await playFrames(6);
        h.ok(fieldAsks() > 0 && !keyboardState.visible, `${device.name}: setup: the field is focused and asking, and the system does not serve it yet`);
        h.ok(ime.focusedTag !== null && ime.focusedTag !== ime.libraryCurrent, `${device.name}: setup: the field the library last saw focused is another one`);
        ime.served = true;
        await playFrames(1);
        h.eq(keyboardState.visible, true, `${device.name}: the first frame after the field is served raises its keyboard`);
        h.eq([...new Set(keyboardShows.tags)], [ime.focusedTag], `${device.name}: every request named the focused row field, none the page before’s field`);
      }, geometry);
    }
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
          geometry.block![0] + geometry.block![1] + REVEAL_MARGIN <= native.offset + native.viewport;
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
          h.eq(scrolls.at(-1), top + height + REVEAL_MARGIN - 400, `${device.name} ${name}: once the keyboard shrinks the scroll view, ${shown} scroll clear above its end`);
          h.eq([field(tree).props.multiline === true, doneBars(tree).length], [false, 0], `${device.name} ${name}: one line, with no Done bar`);
          h.eq(scrollView(tree).props.keyboardShouldPersistTaps, 'handled', `${device.name} ${name}: the controls around it take their taps while typing`);
          if (name === 'advanced') h.ok(textOf(revealedBlock(tree)).includes(COPY.settingsProbeNeutral), `${device.name} advanced: the check line is in the block kept above the keyboard`);
        }, geometry);
      }
    }
  });

  await h.test('the report page in a sheet: the dim covers the whole window, bars and keyboard included, the card continues behind the keyboard, and Send and Cancel ride above it', async () => {
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
        const tap = tree.root.find((n) => String(n.type) === 'Pressable' && n.props.accessibilityRole === 'none');
        const scrim = hostParent(tap)!;
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
        h.eq(seen, [sheetBottomPadding(0, insets.bottom), sheetBottomPadding(KEYBOARD_HEIGHT, insets.bottom), sheetBottomPadding(0, insets.bottom)],
          `${device.name}: the card grows down behind the keyboard while it is up, on every Android version too, and drops back`);
        h.ok(nearest(button(tree, COPY.reportSend), 'ScrollView') == null && nearest(button(tree, COPY.cancel), 'ScrollView') == null, `${device.name}: Send and Cancel are pinned below the note`);
        const note = around(field(tree));
        h.eq([note.scrolls, note.doneBarLinked(tree)], [true, device.os === 'ios'], `${device.name}: the note scrolls in the sheet; iOS links a Done bar`);
        h.eq(revealedBlock(tree).findAll(isType('Switch')).length, 1, `${device.name}: the note keeps the include row under it in view too, so Send never cuts its switch`);
      }, { frame: [0, 844], field: [300, 90] });
    }
    await on(IOS, report(s.fn('close')), async ({ tree }) => {
      await draftLoaded();
      h.eq(await dismissBoth(tree), 2, 'Done and the footer’s empty space put the keyboard away');
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
        ['report page in a sheet', report(), draftLoaded],
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
const drawn = (line: Node) => flat(line).backgroundColor !== undefined;

/** `child`, held back until the test calls `open`: a frame that mounts at a moment the test picks. */
function mountsLater(child: React.ReactElement): { element: React.ReactElement; open: () => void } {
  const gate = { element: <></>, open: noop };
  function Later() {
    const [shown, setShown] = React.useState(false);
    gate.open = () => setShown(true);
    return shown ? child : null;
  }
  gate.element = <Later />;
  return gate;
}

const isCheckbox = (n: Node) => String(n.type) === 'Pressable' && n.props.accessibilityRole === 'checkbox';

/** The first host views under `node`, looking through components. */
function hostChildrenOf(node: Node): Node[] {
  return node.children.flatMap((child) => {
    if (typeof child === 'string') return [];
    return typeof child.type === 'string' ? [child] : hostChildrenOf(child);
  });
}

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
