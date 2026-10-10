/** The shell's surfaces (design-system-v1 chain-11; system.md §4.3 rule 6, §4.4 M11/M12/M14, §6,
 *  §7.1): Sheet, ConfirmSheet, ContextMenu, the Toast host, TextField/TextArea, GroupedList and the
 *  app tile's geometry. Drags are played through the gesture detectors' callbacks, the keyboard
 *  through react-native-keyboard-controller's, motion is read from what each surface asks
 *  Reanimated for, and documented numbers are parsed from system.md itself. */
import fs from 'node:fs';
import path from 'node:path';
import React, { useState } from 'react';
import TestRenderer from 'react-test-renderer';
import { Harness } from './harness';
import {
  accessibilityFocus,
  accessibilitySettings,
  announcements,
  appStateListenerCount,
  emitAccessibility,
  hapticCalls,
  holdModalDismissals,
  holdUnmountedModalDismissals,
  modalPresentations,
  Platform,
  refuseModalPresentations,
  setAppState,
  StyleSheet,
  useSafeAreaInsets,
  windowMetrics,
} from './native-host';
import { animations, isStep, type Animation, type Step } from './native-reanimated';
import { pan, type PanConfig } from './native-gesture-handler';
import { keyboardWindow, moveKeyboard, resetKeyboard } from './native-keyboard-controller';
import { captureTimeouts, freshApp, hostType, press, screenReaderElement, textOf } from './react-screen';

/** Every pending `setTimeout`, by delay, without running any. */
function pendingTimeouts() {
  const originalSet = globalThis.setTimeout;
  const originalClear = globalThis.clearTimeout;
  let next = 0;
  const pending = new Map<number, number>();
  globalThis.setTimeout = ((_cb: () => void, delay: number) => { pending.set(++next, delay); return next; }) as unknown as typeof setTimeout;
  globalThis.clearTimeout = ((id: number) => { pending.delete(id); }) as unknown as typeof clearTimeout;
  return {
    delays: () => [...pending.values()],
    restore: () => { globalThis.setTimeout = originalSet; globalThis.clearTimeout = originalClear; },
  };
}
import { Sheet, SHEET_GRABBER, useSheetBack } from '../../ui/Sheet';
import { DISMISS_REPORT_MS, EXIT_CEILING_MS, OverlayModal, SHOW_ATTEMPTS, SHOW_REPORT_MS, SHOW_RETRY_MS, useOverlayTurn } from '../../ui/OverlayModal';
import { ConfirmSheet } from '../../ui/ConfirmSheet';
import { ContextMenu, placeMenu, MENU, type MenuAnchor, type MenuRow } from '../../ui/ContextMenu';
import { ToastHost, useToast, TOAST, type ToastApi } from '../../ui/Toast';
import { TextArea, TextField } from '../../ui/TextField';
import { GroupedRow, GroupedSection } from '../../ui/GroupedList';
import { Icon } from '../../ui/Icon';
import SheetModal from '../SheetModal';
import { gridLayout, TILE, TILE_SIDE } from '../../ui/AppTile-geometry';
import KeyboardShell from '../KeyboardShell';
import { COPY } from '../copy';
import { COLORS, LAYOUT, SPRINGS, TIMINGS, TYPE_SCALE } from '../../../design/tokens';

type Tree = TestRenderer.ReactTestRenderer;
type Node = TestRenderer.ReactTestInstance;
type Style = Record<string, unknown>;

const SYSTEM_MD = fs.readFileSync(path.join(process.cwd(), 'docs/design/system.md'), 'utf8');
const LIGHT = COLORS.light;

const act = (fn: () => void) => TestRenderer.act(async () => { fn(); });
const flat = (node: Node): Style => StyleSheet.flatten(node.props.style) as Style;
const all = (tree: Tree, name: string) => tree.root.findAll((n) => hostType(n) === name);
/** The single springs and timings inside an animation. */
function stepsOf(a: Animation): Step[] {
  if (isStep(a)) return [a];
  if (a.kind === 'sequence') return a.animations.flatMap(stepsOf);
  return stepsOf(a.animation);
}
/** Every spring and timing asked for since `from`. */
const steps = (from: number): Step[] => animations.slice(from).flatMap(stepsOf);
/** The physics config a named spring is passed to Reanimated as. */
const spring = (name: keyof typeof SPRINGS) => ({ mass: 1, stiffness: SPRINGS[name].stiffness, damping: SPRINGS[name].damping });
const sameSpring = (config: Record<string, unknown> | undefined, name: keyof typeof SPRINGS) =>
  config != null && config.mass === 1 && config.stiffness === spring(name).stiffness && config.damping === spring(name).damping;

/** A host node that measures as `rect` (window coordinates), and marks a header so focus can be read. */
function nodeMock(frame: readonly [number, number]) {
  return (element: React.ReactElement<{ collapsable?: boolean; accessibilityRole?: string; children?: unknown }>) => {
    if (element.props.collapsable === false) {
      return { measure: (cb: (x: number, y: number, w: number, h: number, px: number, py: number) => void) => cb(0, 0, 390, frame[1], 0, frame[0]) };
    }
    if (String(element.type) === 'Text' && element.props.accessibilityRole === 'header') return { header: String(element.props.children) };
    return {};
  };
}

/** Every tree rendered here. A test that fails half-way leaves its overlays up, and they would hold
 *  the screen against every test after it, so the next test clears them first. */
const rendered = new Set<Tree>();

async function render(element: React.ReactElement, frame: readonly [number, number] = [0, keyboardWindow.height]): Promise<Tree> {
  let tree!: Tree;
  freshApp();
  await TestRenderer.act(async () => { tree = TestRenderer.create(element, { createNodeMock: nodeMock(frame) }); });
  rendered.add(tree);
  return tree;
}

async function resetPhone(): Promise<void> {
  for (const tree of rendered) await TestRenderer.act(async () => { tree.unmount(); });
  rendered.clear();
  accessibilitySettings.reduceMotion = false;
  accessibilitySettings.screenReader = false;
  windowMetrics.fontScale = 1;
  Platform.OS = 'ios';
  setAppState('active');
  gones.splice(0);
  exits.clear();
  resetKeyboard();
  hapticCalls.splice(0);
  announcements.splice(0);
  accessibilityFocus.splice(0);
}

/** Lets `useTokens`' async accessibility queries land. */
const settle = () => TestRenderer.act(async () => { await new Promise((r) => setImmediate(r)); });

// ── Sheet helpers ───────────────────────────────────────────────────────────

/** A sheet its own state closes, as a screen holds one; `closes` counts `onClose`. */
function HeldSheet({ detent, onCloseCount }: Readonly<{ detent?: 'fit' | 'large'; onCloseCount: { n: number } }>) {
  const [visible, setVisible] = useState(true);
  return (
    <Sheet visible={visible} detent={detent} title="Report this app" onClose={() => { onCloseCount.n += 1; setVisible(false); }}>
      <Body />
    </Sheet>
  );
}
const Body = () => React.createElement('Text', null, 'Body');

/** Whether `node` sits inside `ancestor`. */
function inside(node: Node, ancestor: Node): boolean {
  for (let at: Node | null = node.parent; at; at = at.parent) if (at === ancestor) return true;
  return false;
}

const SHEET_HEIGHT = 400;
const card = (tree: Tree) => tree.root.find((n) => hostType(n) === 'Animated.View' && n.props.accessibilityViewIsModal === true);
const cardY = (tree: Tree) => ((flat(card(tree)).transform as { translateY: number }[] | undefined)?.[0]?.translateY ?? 0);
const scrimOpacity = (tree: Tree) => flat(tree.root.find((n) => hostType(n) === 'Animated.View' && flat(n).backgroundColor === LIGHT.scrim)).opacity;
const dragOf = (tree: Tree) => all(tree, 'GestureDetector')[0].props.gesture as PanConfig;
async function layoutCard(tree: Tree, height = SHEET_HEIGHT): Promise<void> {
  await act(() => card(tree).props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: 390, height } } }));
}
const modalShown = (tree: Tree) => all(tree, 'Modal').length === 1;

// ── GroupedList helpers ─────────────────────────────────────────────────────

/** The host view `node` sits in. */
function hostParentOf(node: Node): Node | null {
  for (let at: Node | null = node.parent; at; at = at.parent) if (typeof hostType(at) === 'string') return at;
  return null;
}
/** A value row and a link row at text size `scale`: whether the value sits under the title, the
 *  value row's spoken label, and how many marks the link row draws. */
async function groupedRowsAt(scale: number) {
  await resetPhone();
  windowMetrics.fontScale = scale;
  const tree = await render(
    <GroupedSection>
      <GroupedRow title="Language" trailing={{ kind: 'value', text: 'Français' }} onPress={() => {}} />
      <GroupedRow title="Privacy policy" trailing={{ kind: 'external' }} onPress={() => {}} />
    </GroupedSection>,
  );
  const texts = all(tree, 'Text');
  const title = texts.find((n) => textOf(n) === 'Language')!;
  const value = texts.find((n) => textOf(n) === 'Français')!;
  const [language, privacy] = all(tree, 'Pressable');
  const result = {
    stacked: hostParentOf(title) === hostParentOf(value),
    label: language.props.accessibilityLabel,
    marks: privacy.findAllByType(Icon).length,
  };
  await act(() => tree.unmount());
  return result;
}
/** A row that opens in place beside a plain chevron row. */
function OpeningRows() {
  const [open, setOpen] = useState(false);
  return (
    <GroupedSection>
      <GroupedRow title="Full details" trailing={{ kind: 'chevron', expanded: open }} onPress={() => setOpen((on) => !on)} />
      <GroupedRow title="Privacy" trailing={{ kind: 'chevron' }} onPress={() => {}} />
    </GroupedSection>
  );
}

// ── Menu helpers ────────────────────────────────────────────────────────────

const ANCHOR: MenuAnchor = { x: 20, y: 160, width: 88, height: 100 };
function menuRows(log: string[]): MenuRow[] {
  return [
    { key: 'open', label: 'Open', icon: 'arrow-up', onPress: () => log.push('open') },
    { key: 'delete', label: 'Delete', icon: 'trash-2', destructive: true, onPress: () => log.push('delete') },
    { key: 'copy', label: 'Make a copy', icon: 'copy', next: [
      { key: 'share', label: 'Share data', icon: 'share', onPress: () => log.push('share') },
      { key: 'fresh', label: 'Start fresh', icon: 'plus', onPress: () => log.push('fresh') },
    ] },
  ];
}
/** A menu its own state closes, as a screen holds one; `onCloseCount` counts `onClose`. */
function HeldMenu({ title = 'Timer', rows, onCloseCount }: Readonly<{ title?: string; rows: MenuRow[]; onCloseCount: { n: number } }>) {
  const [visible, setVisible] = useState(true);
  return <ContextMenu visible={visible} title={title} anchor={ANCHOR} rows={rows} onClose={() => { onCloseCount.n += 1; setVisible(false); }} />;
}
/** A menu its owner can open again: `control.open()` asks for it once more after it has closed. */
function ToggleMenu({ log, control }: Readonly<{ log: string[]; control: { open: () => void } }>) {
  const [visible, setVisible] = useState(true);
  control.open = () => setVisible(true);
  return <ContextMenu visible={visible} title="Timer" anchor={ANCHOR} rows={menuRows(log)} onClose={() => setVisible(false)} />;
}
/** A menu over a screen that shows a sheet next: from the chosen row, or (`together`) in the very
 *  tick it closes the menu, as a screen that closes one overlay and opens another at once does. */
function MenuThenSheet({ together = false, log }: Readonly<{ together?: boolean; log: string[] }>) {
  const [menu, setMenu] = useState(true);
  const [sheet, setSheet] = useState(false);
  const rows: MenuRow[] = [{ key: 'customize', label: 'Customize tile', icon: 'copy', onPress: () => { log.push('customize'); setSheet(true); } }];
  return (
    <>
      <ContextMenu visible={menu} title="Timer" anchor={ANCHOR} rows={rows} onClose={() => { setMenu(false); if (together) setSheet(true); }} />
      <Sheet visible={sheet} title="Customize tile" onClose={() => setSheet(false)}><Body /></Sheet>
    </>
  );
}
/** Two sheets one screen holds, with `which` of them wanted. */
const sheetPair = (which: 'First' | 'Second' | null) => (
  <>
    <Sheet key="first" visible={which === 'First'} title="First" onClose={() => {}}><Body /></Sheet>
    <Sheet key="second" visible={which === 'Second'} title="Second" onClose={() => {}}><Body /></Sheet>
  </>
);
/** How each probe overlay ends its exit, and which of them reported themselves gone. */
const exits = new Map<string, () => void>();
const gones: string[] = [];
/** An overlay as its owner holds one, with no motion of its own: its exit ends only when a test
 *  says so (`exits`), so a test can play one that never ends. */
function Probe({ name, wanted }: Readonly<{ name: string; wanted: boolean }>) {
  const turn = useOverlayTurn(wanted, { onGone: () => { gones.push(name); }, onRefused: () => {} });
  exits.set(name, turn.exited);
  return (
    <OverlayModal turn={turn} onRequestClose={() => {}}>
      {React.createElement('Text', { accessibilityRole: 'header' }, name)}
    </OverlayModal>
  );
}
/** The probes named in `wanted`, in that order, each wanted or not. */
const probes = (wanted: Record<string, boolean>) => (
  <>{Object.entries(wanted).map(([name, on]) => <Probe key={name} name={name} wanted={on} />)}</>
);
/** Every timer the overlay queue may have pending. */
const queueTimers = (timers: ReturnType<typeof captureTimeouts>) =>
  [0, DISMISS_REPORT_MS, EXIT_CEILING_MS, SHOW_REPORT_MS, SHOW_RETRY_MS].reduce((n, ms) => n + timers.count(ms), 0);
/** Every modal host in the tree: on screen, hidden and not yet reported gone, or refused by the
 *  system. Any of them covers the screen and takes its touches. */
const modalHosts = (tree: Tree) => all(tree, 'Modal');
/** The titles heading the overlays the system has on screen (hosts that are not hidden). */
const overlayTitles = (tree: Tree) => [...new Set(modalHosts(tree).filter((m) => m.props.visible === true)
  .flatMap((m) => m.findAll((n) => hostType(n) === 'Text' && n.props.accessibilityRole === 'header').map(textOf)))];
const menuCard = (tree: Tree) => tree.root.find((n) => hostType(n) === 'Animated.View' && n.props.accessibilityRole === 'menu');
async function layoutMenu(tree: Tree, height = 240): Promise<void> {
  await act(() => menuCard(tree).props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: MENU.width, height } } }));
}
const rowButtons = (tree: Tree) => all(tree, 'Pressable').filter((n) => n.props.accessibilityRole === 'button');

/** Host nodes for a screen whose one field sits 700 pt down its scroll content, 48 tall, in a frame
 *  filling an 844-high window; scrolls land in `scrolls`. */
function fieldScreenMock(scrolls: number[]) {
  const measureField = (_: unknown, ok: (x: number, y: number, w: number, h: number) => void) => ok(0, 700, 350, 48);
  const measureFrame = (cb: (x: number, y: number, w: number, h: number, px: number, py: number) => void) => cb(0, 0, 390, 844, 0, 0);
  const scrollTo = ({ y }: { y: number }) => { scrolls.push(y); };
  return (el: React.ReactElement<{ collapsable?: boolean }>) => {
    if (String(el.type) === 'ScrollView') return { scrollTo };
    if (String(el.type) === 'TextInput') return { focus: () => {}, measureLayout: measureField };
    if (el.props.collapsable === false) return { measure: measureFrame };
    return {};
  };
}

/** §3.2's Sizes row: "24 inline, 40 sheets and headers, 64 grid, 96 hero". */
function documentedTileSizes(): Record<string, number> {
  const row = /\| Sizes \| ([^|]+) \|/.exec(SYSTEM_MD)?.[1] ?? '';
  const sizes: Record<string, number> = {};
  for (const part of row.split(',')) {
    const [size, use] = part.trim().split(' ');
    const m = /^\d+$/.test(size) && use ? [part, size, use] : null;
    if (m) sizes[m[2]] = Number(m[1]);
  }
  return sizes;
}

/** What is wrong with the grid at `scale`, width by width from 280 to 1100 pt: not `columns` whole
 *  columns, a row that outgrows the screen, or a column a whole point short of what fits. */
function gridFitViolations(scale: number, columns: number): string[] {
  const violations: string[] = [];
  for (let width = 280; width <= 1100; width += 1) {
    const grid = gridLayout(width, scale);
    if (grid.kind !== 'grid' || grid.columns !== columns) {
      violations.push(`${width} pt at ${scale}: not ${columns} columns`);
      continue;
    }
    const row = (cell: number) => columns * cell + 2 * grid.gutter;
    if (!Number.isInteger(grid.columnWidth)) violations.push(`${width} pt at ${scale}: ${grid.columnWidth} is not whole points`);
    if (row(grid.columnWidth) > width) violations.push(`${width} pt at ${scale}: ${columns} cells of ${grid.columnWidth} outgrow the screen`);
    if (row(grid.columnWidth + 1) <= width) violations.push(`${width} pt at ${scale}: ${grid.columnWidth} leaves room for a wider cell`);
  }
  return violations;
}

export async function runShellSurfacesUiTests(h: Harness): Promise<void> {
  // ── Sheet ──────────────────────────────────────────────────────────────────

  await h.test('Sheet: a full-window modal card with the grabber, a title2 title screen-reader focus lands on, and a close control', async () => {
    await resetPhone();
    const closes = { n: 0 };
    const tree = await render(<HeldSheet onCloseCount={closes} />);
    const modal = all(tree, 'Modal')[0];
    h.eq([modal.props.transparent, modal.props.statusBarTranslucent, modal.props.navigationBarTranslucent], [true, true, true], 'its own transparent window, under both system bars, so the scrim dims them');
    const grabber = tree.root.find((n) => hostType(n) === 'View' && flat(n).width === SHEET_GRABBER.width && flat(n).height === SHEET_GRABBER.height);
    h.eq([flat(grabber).backgroundColor, grabber.props.importantForAccessibility], [LIGHT['fill-strong'], 'no-hide-descendants'], 'a fill-strong grabber, hidden from screen readers');
    const title = tree.root.find((n) => hostType(n) === 'Text' && n.props.accessibilityRole === 'header');
    h.eq([textOf(title), flat(title).fontSize, flat(title).fontWeight], ['Report this app', TYPE_SCALE.title2.size, String(TYPE_SCALE.title2.weight)], 'a title2 title');
    h.eq(accessibilityFocus, [{ header: 'Report this app' }], 'screen-reader focus moves to the title on open');
    h.ok(card(tree).props.accessibilityViewIsModal === true, 'modal to screen readers');
    const close = rowButtons(tree).filter((n) => n.props.accessibilityLabel === COPY.sheetClose);
    h.eq(close.length, 1, 'one close control, read as “Close”');
    const scrim = tree.root.find((n) => hostType(n) === 'Pressable' && n.props.accessible === false);
    h.eq([scrim.props.importantForAccessibility, inside(card(tree), scrim), inside(title, scrim)], ['no', false, false], 'the scrim is a sibling screen readers skip, never a parent of the card');
    await act(() => tree.unmount());
  });

  await h.test('Sheet: opens from off-screen on the smooth spring; under Reduce Motion it cross-fades in place for 160 ms', async () => {
    await resetPhone();
    let from = animations.length;
    let tree = await render(<HeldSheet onCloseCount={{ n: 0 }} />);
    const opening = steps(from);
    h.ok(opening.some((s) => s.kind === 'spring' && s.to === 0 && sameSpring(s.config, 'smooth')), 'the card springs to its open place with smooth');
    h.eq(cardY(tree), 0, 'and rests open');
    await act(() => tree.unmount());
    accessibilitySettings.reduceMotion = true;
    tree = await render(<HeldSheet onCloseCount={{ n: 0 }} />);
    await settle();
    await act(() => tree.unmount());
    from = animations.length;
    tree = await render(<HeldSheet onCloseCount={{ n: 0 }} />);
    const reduced = steps(from);
    h.ok(!reduced.some((s) => s.kind === 'spring'), 'no spring under Reduce Motion');
    h.ok(reduced.some((s) => s.kind === 'timing' && s.to === 1 && s.config?.duration === TIMINGS.fadeIn && s.config?.reduceMotion === 'never'), 'a 160 ms fade the system setting cannot skip');
    await act(() => tree.unmount());
  });

  await h.test('Sheet: the scrim, close, Android back and the screen reader’s escape each close it once; it leaves on smooth, then its window goes', async () => {
    const ways: [string, (tree: Tree) => Promise<void>][] = [
      ['scrim', (tree) => press(tree.root.find((n) => hostType(n) === 'Pressable' && n.props.accessible === false))],
      ['close', (tree) => press(rowButtons(tree).find((n) => n.props.accessibilityLabel === COPY.sheetClose)!)],
      ['Android back', (tree) => act(() => all(tree, 'Modal')[0].props.onRequestClose())],
      ['screen-reader escape', (tree) => act(() => card(tree).props.onAccessibilityEscape())],
    ];
    for (const [way, close] of ways) {
      await resetPhone();
      const closes = { n: 0 };
      const tree = await render(<HeldSheet onCloseCount={closes} />);
      await layoutCard(tree);
      const from = animations.length;
      await close(tree);
      h.eq(closes.n, 1, `${way}: closes it once`);
      h.ok(steps(from).some((s) => s.kind === 'spring' && s.to === SHEET_HEIGHT && sameSpring(s.config, 'smooth')), `${way}: the card leaves by its own height on smooth`);
      h.ok(!modalShown(tree), `${way}: its window goes once it has left`);
      await act(() => tree.unmount());
    }
  });

  await h.test('Sheet: a page that takes Android back with useSheetBack gets it in place of the close; the close control and the scrim still close, and a page that has gone gives back to close', async () => {
    await resetPhone();
    const calls = { back: 0, close: 0 };
    const BackPage = () => { useSheetBack(() => { calls.back += 1; }); return <Body />; };
    const sheet = (page: boolean) => <Sheet visible detent="large" onClose={() => { calls.close += 1; }}>{page ? <BackPage /> : <Body />}</Sheet>;
    const tree = await render(sheet(true));
    await act(() => all(tree, 'Modal')[0].props.onRequestClose());
    h.eq([calls.back, calls.close], [1, 0], 'Android back goes to the page, and the sheet stays');
    await act(() => card(tree).props.onAccessibilityEscape());
    await press(rowButtons(tree).find((n) => n.props.accessibilityLabel === COPY.sheetClose)!);
    await press(tree.root.find((n) => hostType(n) === 'Pressable' && n.props.accessible === false));
    h.eq([calls.back, calls.close], [1, 3], 'the screen reader’s escape, the close control and the scrim still close it');
    await act(() => tree.update(sheet(false)));
    await act(() => all(tree, 'Modal')[0].props.onRequestClose());
    h.eq([calls.back, calls.close], [1, 4], 'once the page is gone Android back closes again');
    await act(() => tree.unmount());
  });

  await h.test('Sheet: its window goes after it has finished closing — on Android as the exit ends, on iOS only when the system reports the dismissal', async () => {
    try {
      for (const os of ['android', 'ios'] as const) {
        await resetPhone();
        Platform.OS = os;
        const tree = await render(<HeldSheet onCloseCount={{ n: 0 }} />);
        await layoutCard(tree);
        h.eq(modalHosts(tree).length, 1, `${os}: the open sheet has its window`);
        const release = holdModalDismissals();
        try {
          await press(rowButtons(tree).find((n) => n.props.accessibilityLabel === COPY.sheetClose)!);
          h.eq(modalHosts(tree).length, os === 'android' ? 0 : 1, os === 'android' ? 'android: the window goes as the exit animation ends' : 'ios: the exit animation is over but the system has not said the modal is gone, so its window is still mounted');
          await act(() => release());
          h.eq(modalHosts(tree).length, 0, `${os}: gone once the system has said so`);
        } finally {
          release();
        }
        await act(() => tree.unmount());
      }
    } finally {
      Platform.OS = 'ios';
    }
  });

  await h.test('Sheet: a sheet that closes by a drag has left no window behind', async () => {
    await resetPhone();
    const tree = await render(<HeldSheet onCloseCount={{ n: 0 }} />);
    await layoutCard(tree);
    await act(() => pan(dragOf(tree), [100, 220, 330], 600));
    h.eq(modalHosts(tree).length, 0, 'no window');
    await act(() => tree.unmount());
  });

  await h.test('Sheet: a release closes it only when its projected end passes half its height and it isn’t flicked back; it springs back otherwise; position alone never decides', async () => {
    const cases: [string, number[], number, boolean][] = [
      ['a slow short drag', [20, 60, 100], 0, false],
      ['a short flick down', [20, 60, 100], 800, true],
      ['dragged far past half, flicked back up', [100, 300, 430], -100, false],
      ['dragged past half, let go', [100, 220, 330], 0, true],
    ];
    for (const [name, moves, velocity, closes] of cases) {
      await resetPhone();
      const count = { n: 0 };
      const tree = await render(<HeldSheet onCloseCount={count} />);
      await layoutCard(tree);
      const from = animations.length;
      await act(() => pan(dragOf(tree), moves, velocity));
      const flung = steps(from).filter((s) => s.kind === 'spring' && sameSpring(s.config, 'fling'));
      h.eq(count.n, closes ? 1 : 0, `${name}: ${closes ? 'closes' : 'stays'}`);
      h.ok(flung.length === 1 && flung[0].to === (closes ? SHEET_HEIGHT : 0) && flung[0].config?.velocity === velocity, `${name}: hands its release velocity to fling, toward ${closes ? 'off-screen' : 'open'}`);
      h.eq(modalShown(tree), !closes, `${name}: its window ${closes ? 'goes' : 'stays'}`);
      await act(() => tree.unmount());
    }
  });

  await h.test('Sheet: a drag tracks the finger 1:1 after the 10 pt slop, rubber-bands above its open place, and the scrim follows the card', async () => {
    await resetPhone();
    const tree = await render(<HeldSheet onCloseCount={{ n: 0 }} />);
    await layoutCard(tree);
    const drag = dragOf(tree);
    h.eq(drag.activeOffsetY, [-10, 10], 'it takes over after 10 pt either way');
    await act(() => { drag.onActivate!({ translationX: 0, translationY: 10, velocityX: 0, velocityY: 0 }); drag.onUpdate!({ translationX: 0, translationY: 110, velocityX: 0, velocityY: 0 }); });
    h.eq(cardY(tree), 100, 'down: 1:1 with the finger past the slop');
    h.eq(scrimOpacity(tree), 1 - 100 / SHEET_HEIGHT, 'the scrim fades as the card goes');
    await act(() => drag.onUpdate!({ translationX: 0, translationY: -90, velocityX: 0, velocityY: 0 }));
    const up = -cardY(tree);
    h.ok(up > 0 && up < 100, `up past its open place it gives, but less than the finger moved (${up.toFixed(1)} of 100)`);
    await act(() => drag.onUpdate!({ translationX: 0, translationY: -190, velocityX: 0, velocityY: 0 }));
    const further = -cardY(tree);
    h.ok(further > up && further - up < 100 - up, 'and gives less the further it is pulled');
    await act(() => tree.unmount());
  });

  await h.test('Sheet: crossing the commit point plays the commit haptic on that frame, once per crossing, prepared on touch-down', async () => {
    await resetPhone();
    const tree = await render(<HeldSheet onCloseCount={{ n: 0 }} />);
    await layoutCard(tree);
    const drag = dragOf(tree);
    const at = (translationY: number, velocityY = 0) => ({ translationX: 0, translationY, velocityX: 0, velocityY });
    const commits = () => hapticCalls.filter((c) => c === 'impact:rigid,0.6,GESTURE_THRESHOLD_ACTIVATE').length;
    await act(() => { drag.onBegin!(at(0)); drag.onActivate!(at(0)); });
    h.ok(hapticCalls.includes('prepare:rigid'), 'the commit generator is warmed on touch-down');
    await act(() => drag.onUpdate!(at(150)));
    h.eq(commits(), 0, 'short of the commit point: nothing');
    await act(() => drag.onUpdate!(at(250)));
    h.eq(commits(), 1, 'past it: one commit haptic');
    await act(() => { drag.onUpdate!(at(260)); drag.onUpdate!(at(280)); });
    h.eq(commits(), 1, 'staying past it plays nothing more');
    await act(() => { drag.onUpdate!(at(120)); drag.onUpdate!(at(260)); });
    h.eq(commits(), 2, 'back and across again: one more');
    await act(() => tree.unmount());
  });

  await h.test('Sheet: the card lifts on the keyboard frame by frame, continuing behind it, and drops back to the safe area', async () => {
    await resetPhone();
    const tree = await render(<HeldSheet onCloseCount={{ n: 0 }} />);
    const safe = useSafeAreaInsets().bottom;
    const padding = () => flat(card(tree)).paddingBottom;
    h.eq(padding(), safe, 'keyboard down: the safe area');
    await act(() => moveKeyboard(300, [100, 200]));
    h.eq(padding(), 300, 'keyboard up: the keyboard’s height, not the safe area as well');
    await act(() => moveKeyboard(0));
    h.eq(padding(), safe, 'keyboard down again');
    await act(() => tree.unmount());
  });

  await h.test('Sheet: fit grows to 92% of the window, large is 92%', async () => {
    await resetPhone();
    for (const [detent, key] of [['fit', 'maxHeight'], ['large', 'height']] as const) {
      const tree = await render(<HeldSheet detent={detent} onCloseCount={{ n: 0 }} />);
      h.eq(flat(card(tree))[key], '92%', `${detent}: ${key} 92%`);
      await act(() => tree.unmount());
    }
  });

  // ── ConfirmSheet ───────────────────────────────────────────────────────────

  await h.test('ConfirmSheet: the safe choice is the large ink button above the danger one; only the danger choice plays the warning haptic; every other way out keeps', async () => {
    await resetPhone();
    const log: string[] = [];
    const tree = await render(
      <ConfirmSheet visible title="Make a new ID?" body="Your reports will start fresh." keepLabel="Keep this ID" confirmLabel="Make a new ID"
        onKeep={() => log.push('keep')} onConfirm={() => log.push('confirm')} />,
    );
    const buttons = rowButtons(tree).filter((n) => ['Keep this ID', 'Make a new ID'].includes(n.props.accessibilityLabel));
    h.eq(buttons.map((b) => b.props.accessibilityLabel), ['Keep this ID', 'Make a new ID'], 'the safe choice comes first');
    const fill = (b: Node) => flat(b.find((n) => hostType(n) === 'Animated.View')).backgroundColor;
    h.eq(buttons.map(fill), [LIGHT.ink, LIGHT['danger-soft']], 'ink, then the soft danger capsule');
    h.ok(textOf(tree.root).includes('Your reports will start fresh.'), 'the body says what changes');
    await press(buttons[0]);
    h.eq([log, hapticCalls.filter((c) => c.startsWith('notification')).length], [['keep'], 0], 'keeping plays nothing');
    await press(buttons[1]);
    h.eq([log.at(-1), hapticCalls.includes('notification:warning,REJECT')], ['confirm', true], 'the consequential choice plays the warning haptic');
    await press(tree.root.find((n) => hostType(n) === 'Pressable' && n.props.accessible === false));
    h.eq(log.at(-1), 'keep', 'the scrim keeps');
    await act(() => tree.unmount());
  });

  // ── ContextMenu ────────────────────────────────────────────────────────────

  await h.test('ContextMenu: announced as a menu headed by the full name; every row its own button a screen reader reaches and activates on its own; destructive rows last, after a separator, in danger-text', async () => {
    await resetPhone();
    const log: string[] = [];
    const closes = { n: 0 };
    const tree = await render(<HeldMenu title="Pour-Over Timer" rows={menuRows(log)} onCloseCount={closes} />);
    await layoutMenu(tree);
    const menu = menuCard(tree);
    h.eq([menu.props.accessibilityRole, menu.props.accessibilityLabel], ['menu', 'Pour-Over Timer'], 'a menu, named by the app');
    h.ok(textOf(menu).startsWith('Pour-Over Timer'), 'headed by the full name');
    const rows = rowButtons(tree);
    h.eq(rows.map((r) => r.props.accessibilityLabel), ['Open', 'Make a copy', 'Delete'], 'every row, destructive last');
    h.ok(rows.every((r) => screenReaderElement(r) === r), 'each row is its own element, not part of a joined one');
    const deleteText = rows[2].find((n) => hostType(n) === 'Text');
    h.eq(flat(deleteText).color, LIGHT['danger-text'], 'Delete in danger-text');
    const separators = menu.findAll((n) => hostType(n) === 'View' && flat(n).height === StyleSheet.hairlineWidth);
    h.eq(separators.length, 1, 'one separator before the destructive row');
    await press(rows[0]);
    h.eq([closes.n, log], [1, ['open']], 'a row closes the menu and runs its action');
    await act(() => tree.unmount());
  });

  await h.test('ContextMenu: a row’s action runs once the menu has gone from the screen, never while it is still there; a second row tapped as it leaves chooses nothing', async () => {
    try {
      for (const os of ['ios', 'android'] as const) {
        await resetPhone();
        Platform.OS = os;
        const log: string[] = [];
        const closes = { n: 0 };
        const tree = await render(<HeldMenu rows={menuRows(log)} onCloseCount={closes} />);
        await layoutMenu(tree);
        const [open, , remove] = rowButtons(tree);
        const release = holdModalDismissals();
        try {
          await TestRenderer.act(async () => { open.props.onPress(); remove.props.onPress(); });
          if (os === 'ios') {
            h.eq([closes.n, log, modalHosts(tree).length], [1, [], 1], 'ios: the menu has faded but the system has not said it is gone: nothing has run');
            await act(() => release());
          }
          h.eq([closes.n, log, modalHosts(tree).length], [1, ['open'], 0], `${os}: with the menu gone, the first row chosen ran, alone`);
        } finally {
          release();
        }
        await act(() => tree.unmount());
      }
    } finally {
      Platform.OS = 'ios';
    }
  });

  await h.test('ContextMenu: a row with a second step swaps the rows in place with a back row, without closing', async () => {
    await resetPhone();
    const log: string[] = [];
    const closes = { n: 0 };
    const tree = await render(<HeldMenu rows={menuRows(log)} onCloseCount={closes} />);
    await layoutMenu(tree);
    const from = animations.length;
    await press(rowButtons(tree).find((r) => r.props.accessibilityLabel === 'Make a copy')!);
    h.eq(rowButtons(tree).map((r) => r.props.accessibilityLabel), [COPY.backLabel, 'Share data', 'Start fresh'], 'the second step, with Back first');
    h.ok(steps(from).some((s) => s.kind === 'timing' && s.to === 1 && s.config?.duration === 120), 'the rows swap over 120 ms');
    h.eq(closes.n, 0, 'the menu stays');
    await press(rowButtons(tree)[0]);
    h.eq(rowButtons(tree).map((r) => r.props.accessibilityLabel), ['Open', 'Make a copy', 'Delete'], 'Back returns to the first step');
    await press(rowButtons(tree).find((r) => r.props.accessibilityLabel === 'Make a copy')!);
    await press(rowButtons(tree).find((r) => r.props.accessibilityLabel === 'Start fresh')!);
    h.eq([closes.n, log], [1, ['fresh']], 'a second-step row closes and runs its action');
    await act(() => tree.unmount());
  });

  await h.test('ContextMenu: the scrim, Android back and the screen reader’s escape close it', async () => {
    const ways: [string, (tree: Tree) => Promise<void>][] = [
      ['scrim', (tree) => press(tree.root.find((n) => hostType(n) === 'Pressable' && n.props.accessible === false))],
      ['Android back', (tree) => act(() => all(tree, 'Modal')[0].props.onRequestClose())],
      ['escape', (tree) => act(() => menuCard(tree).props.onAccessibilityEscape())],
    ];
    for (const [way, close] of ways) {
      await resetPhone();
      let closes = 0;
      const tree = await render(<ContextMenu visible title="Timer" anchor={ANCHOR} rows={menuRows([])} onClose={() => { closes += 1; }} />);
      await close(tree);
      h.eq(closes, 1, `${way} closes it`);
      await act(() => tree.unmount());
    }
  });

  await h.test('ContextMenu: placed 8 pt under the cell, above it when there is no room, inside the gutters, and never over the cell it opens from', async () => {
    const screen = { width: 390, height: 844 };
    const insets = { top: 47, bottom: 34 };
    const size = { width: MENU.width, height: 300 };
    const below = placeMenu({ x: 20, y: 160, width: 88, height: 100 }, size, screen, insets);
    h.eq([below.below, below.top], [true, 160 + 100 + 8], 'room below: 8 pt under the cell');
    const above = placeMenu({ x: 20, y: 600, width: 88, height: 100 }, size, screen, insets);
    h.eq([above.below, above.top + size.height], [false, 600 - 8], 'no room below: 8 pt above it');
    let overlaps = 0;
    let outside = 0;
    for (let x = 20; x <= 282; x += 87) {
      for (let y = 60; y <= 720; y += 20) {
        const anchor = { x, y, width: 88, height: 100 };
        const at = placeMenu(anchor, size, screen, insets);
        const clear = at.top + size.height <= anchor.y || at.top >= anchor.y + anchor.height;
        if (!clear) overlaps += 1;
        if (at.left < LAYOUT.gutter || at.left + size.width > screen.width - LAYOUT.gutter) outside += 1;
      }
    }
    h.eq([overlaps, outside], [0, 0], 'for every cell on a 4-column grid: never over the cell, never past a gutter');
  });

  await h.test('ContextMenu: grows from the cell 0.92 → 1 on smooth; under Reduce Motion it only fades', async () => {
    await resetPhone();
    let from = animations.length;
    let tree = await render(<ContextMenu visible title="Timer" anchor={ANCHOR} rows={menuRows([])} onClose={() => {}} />);
    await layoutMenu(tree);
    h.ok(steps(from).some((s) => s.kind === 'spring' && s.to === 1 && sameSpring(s.config, 'smooth')), 'grows to full size on smooth');
    h.eq(flat(menuCard(tree)).transformOrigin, 'top', 'from its top edge, which faces the cell under it');
    await act(() => tree.unmount());
    accessibilitySettings.reduceMotion = true;
    tree = await render(<ContextMenu visible title="Timer" anchor={ANCHOR} rows={menuRows([])} onClose={() => {}} />);
    await settle();
    await act(() => tree.unmount());
    from = animations.length;
    tree = await render(<ContextMenu visible title="Timer" anchor={ANCHOR} rows={menuRows([])} onClose={() => {}} />);
    await layoutMenu(tree);
    const reduced = steps(from);
    h.ok(!reduced.some((s) => s.kind === 'spring') && reduced.some((s) => s.kind === 'timing' && s.to === 1 && s.config?.reduceMotion === 'never'), 'Reduce Motion: a fade, no scale');
    await act(() => tree.unmount());
  });

  // ── Overlays take turns ────────────────────────────────────────────────────

  await h.test('Overlays: a sheet a menu row shows is presented only after the menu’s modal has dismissed, and the system refuses nothing', async () => {
    try {
      for (const os of ['ios', 'android'] as const) {
        await resetPhone();
        Platform.OS = os;
        const refused = modalPresentations.refused;
        const log: string[] = [];
        const tree = await render(<MenuThenSheet log={log} />);
        await layoutMenu(tree);
        const release = holdModalDismissals();
        try {
          await press(rowButtons(tree).find((r) => r.props.accessibilityLabel === 'Customize tile')!);
          if (os === 'ios') {
            h.eq([log, overlayTitles(tree)], [[], []], 'ios: the menu is still dismissing: its row has not run and no sheet is presented');
            await act(() => release());
          }
          h.eq([log, overlayTitles(tree), modalHosts(tree).length], [['customize'], ['Customize tile'], 1], `${os}: the sheet is presented once the menu has gone, alone`);
          h.eq(modalPresentations.refused - refused, 0, `${os}: no presentation met another still on screen`);
        } finally {
          release();
        }
        await act(() => tree.unmount());
      }
    } finally {
      Platform.OS = 'ios';
    }
  });

  await h.test('Overlays: a sheet shown in the very tick a menu closes waits for the menu’s exit and its dismissal, whoever shows it', async () => {
    await resetPhone();
    const refused = modalPresentations.refused;
    const tree = await render(<MenuThenSheet together log={[]} />);
    await layoutMenu(tree);
    const release = holdModalDismissals();
    try {
      await press(tree.root.find((n) => hostType(n) === 'Pressable' && n.props.accessible === false));
      h.eq([overlayTitles(tree), modalHosts(tree).length], [[], 1], 'the menu is still dismissing: the sheet the screen already asked for is not presented');
      await act(() => release());
      h.eq([overlayTitles(tree), modalHosts(tree).length], [['Customize tile'], 1], 'the sheet is presented once the menu has gone');
      h.eq(modalPresentations.refused - refused, 0, 'and the system refused no presentation on the way');
    } finally {
      release();
    }
    await act(() => tree.unmount());
  });

  await h.test('Overlays: one sheet replacing another is presented only after the first has dismissed; on Android, which reports nothing, as its exit ends', async () => {
    try {
      for (const os of ['ios', 'android'] as const) {
        await resetPhone();
        Platform.OS = os;
        const refused = modalPresentations.refused;
        const tree = await render(sheetPair('First'));
        h.eq(overlayTitles(tree), ['First'], `${os}: the first sheet is up`);
        const release = holdModalDismissals();
        try {
          await act(() => tree.update(sheetPair('Second')));
          if (os === 'ios') {
            h.eq([overlayTitles(tree), modalHosts(tree).length], [[], 1], 'ios: the first is still dismissing: the second is not presented');
            await act(() => release());
          }
          h.eq([overlayTitles(tree), modalHosts(tree).length], [['Second'], 1], `${os}: the second is presented, alone`);
          h.eq(modalPresentations.refused - refused, 0, `${os}: the system refused no presentation`);
        } finally {
          release();
        }
        await act(() => tree.unmount());
      }
    } finally {
      Platform.OS = 'ios';
    }
  });

  await h.test('Overlays: a dismissal the system never reports cannot hold the screen: the hidden modal is unmounted and the next overlay is presented', async () => {
    await resetPhone();
    const timers = captureTimeouts();
    const release = holdModalDismissals();
    try {
      const tree = await render(sheetPair('First'));
      await act(() => tree.update(sheetPair('Second')));
      h.eq([overlayTitles(tree), modalHosts(tree).length], [[], 1], 'unreported: the first sheet’s hidden modal is still mounted, and the second waits');
      await act(() => timers.fire(DISMISS_REPORT_MS));
      h.eq([overlayTitles(tree), modalHosts(tree).length], [['Second'], 1], 'the wait is bounded: the first’s modal is unmounted and the second is presented');
      await act(() => tree.update(sheetPair(null)));
      await act(() => timers.fire(DISMISS_REPORT_MS));
      h.eq(modalHosts(tree).length, 0, 'and a sheet that closes with nothing after it leaves no modal over the screen either');
      await act(() => tree.unmount());
    } finally {
      release();
      timers.restore();
    }
  });

  await h.test('Overlays: a presentation the system refuses is unmounted, so the screen takes touches again, and presented again; refused every time, the sheet closes itself', async () => {
    await resetPhone();
    const timers = captureTimeouts();
    let allow = refuseModalPresentations();
    try {
      const closes = { n: 0 };
      let tree = await render(<HeldSheet onCloseCount={closes} />);
      h.eq(modalHosts(tree).length, 1, 'refused: the sheet’s modal is mounted but not on screen');
      await act(() => timers.fire(SHOW_REPORT_MS));
      await act(() => timers.fire(0));
      h.eq(modalHosts(tree).length, 0, 'unconfirmed, it is unmounted: nothing unseen is left over the screen');
      allow();
      await act(() => timers.fire(SHOW_RETRY_MS));
      h.eq([overlayTitles(tree), closes.n], [['Report this app'], 0], 'and presented again, this time for real');
      h.eq(timers.count(SHOW_REPORT_MS), 0, 'a confirmed presentation is not watched any more');
      await act(() => tree.unmount());

      allow = refuseModalPresentations();
      tree = await render(<HeldSheet onCloseCount={closes} />);
      for (let attempt = 1; attempt <= SHOW_ATTEMPTS; attempt += 1) {
        h.eq([closes.n, modalHosts(tree).length], [0, 1], `attempt ${attempt}: the sheet is still trying`);
        await act(() => timers.fire(SHOW_REPORT_MS));
        await act(() => timers.fire(0));
        if (attempt < SHOW_ATTEMPTS) await act(() => timers.fire(SHOW_RETRY_MS));
      }
      h.eq([closes.n, modalHosts(tree).length], [1, 0], 'refused every time: it closes as its close control would, leaving nothing mounted');
      h.eq(timers.count(SHOW_RETRY_MS) + timers.count(SHOW_REPORT_MS), 0, 'and stops trying');
      await act(() => tree.unmount());
    } finally {
      allow();
      timers.restore();
    }
  });

  await h.test('Overlays: a sheet told of another modal’s dismissal while it is up still closes cleanly: nothing waits for a report the system will not send', async () => {
    await resetPhone();
    const timers = captureTimeouts();
    const release = holdModalDismissals();
    try {
      const tree = await render(sheetPair('First'));
      await act(() => modalHosts(tree)[0].props.onDismiss());
      h.eq(overlayTitles(tree), ['First'], 'the stray report closes nothing');
      await act(() => tree.update(sheetPair('Second')));
      h.eq([overlayTitles(tree), modalHosts(tree).length, timers.count(DISMISS_REPORT_MS)], [['Second'], 1, 0], 'the first is unmounted as its exit ends and the second presented, with no wait');
      await act(() => tree.unmount());
    } finally {
      release();
      timers.restore();
    }
  });

  await h.test('Overlays: a sheet inside another sheet’s content is presented over it at once: it takes turns with its own siblings, not with the sheet it sits in', async () => {
    await resetPhone();
    const refused = modalPresentations.refused;
    const tree = await render(
      <Sheet visible title="Making" onClose={() => {}}>
        <Sheet visible title="Details" onClose={() => {}}><Body /></Sheet>
      </Sheet>,
    );
    h.eq([overlayTitles(tree), modalHosts(tree).length], [['Making', 'Details'], 2], 'both are on screen, the inner over the outer');
    h.eq(modalPresentations.refused - refused, 0, 'and the system refused neither');
    await act(() => tree.unmount());
  });

  const reportHeader = React.createElement('Text', { accessibilityRole: 'header' }, 'Report');

  await h.test('SheetModal: it takes its turn with a sheet like any overlay: shown as a sheet is leaving it waits, and the system refuses nothing', async () => {
    await resetPhone();
    const refused = modalPresentations.refused;
    const pair = (sheet: boolean, report: boolean) => (
      <>
        <Sheet visible={sheet} title="Making" onClose={() => {}}><Body /></Sheet>
        <SheetModal visible={report} onClose={() => {}}>{reportHeader}</SheetModal>
      </>
    );
    const tree = await render(pair(true, false));
    const release = holdModalDismissals();
    try {
      await act(() => tree.update(pair(false, true)));
      h.eq([overlayTitles(tree), modalPresentations.refused - refused], [[], 0], 'the sheet has left but its dismissal is not reported: the report form is not presented into it');
      await act(() => release());
      h.eq([overlayTitles(tree), modalPresentations.refused - refused], [['Report'], 0], 'once it is, the report form is presented');
      await act(() => tree.update(pair(false, false)));
      h.eq(modalHosts(tree).length, 0, 'and closing it leaves no window behind');
    } finally {
      release();
      await act(() => tree.unmount());
    }
  });

  await h.test('SheetModal: its close ends its turn at once on Android, and on iOS when the system reports the dismissal', async () => {
    try {
      for (const os of ['android', 'ios'] as const) {
        await resetPhone();
        Platform.OS = os;
        const timers = captureTimeouts();
        const release = holdModalDismissals();
        try {
          const element = (visible: boolean) => <SheetModal visible={visible} onClose={() => {}}>{reportHeader}</SheetModal>;
          const tree = await render(element(true));
          await act(() => tree.update(element(false)));
          h.eq([modalHosts(tree).length, timers.count(EXIT_CEILING_MS)], [os === 'android' ? 0 : 1, 0], `${os}: closing has no exit to wait for: ${os === 'android' ? 'its window is gone' : 'its window waits for the system'}, and no ceiling runs`);
          await act(() => release());
          h.eq(modalHosts(tree).length, 0, `${os}: gone`);
          await act(() => tree.unmount());
        } finally {
          release();
          timers.restore();
        }
      }
    } finally {
      Platform.OS = 'ios';
    }
  });

  await h.test('Overlays: a text-size change while a sheet holds another overlay builds the content again without presenting into the dismissal under way, and the inner overlay comes back', async () => {
    await resetPhone();
    const timers = captureTimeouts();
    let dismissing = holdUnmountedModalDismissals();
    try {
      const refused = modalPresentations.refused;
      const element = () => (
        <Sheet visible title="Making" onClose={() => {}}>
          <SheetModal visible onClose={() => {}}>{reportHeader}</SheetModal>
        </Sheet>
      );
      const tree = await render(element());
      h.eq([overlayTitles(tree), modalPresentations.refused - refused], [['Making', 'Report'], 0], 'setup: the report form is up over the sheet');
      for (const scale of [3, 1, 3]) {
        windowMetrics.fontScale = scale;
        await act(() => tree.update(element()));
        h.eq([overlayTitles(tree), modalPresentations.refused - refused], [['Making'], 0], `text at ${scale * 100}%: the content is built again and the form waits, not presented into the one it replaced`);
        dismissing();
        await act(() => timers.fire(DISMISS_REPORT_MS));
        h.eq([overlayTitles(tree), modalPresentations.refused - refused, modalHosts(tree).length], [['Making', 'Report'], 0, 2], `text at ${scale * 100}%: and the form is back, nothing refused, no window left over`);
        dismissing = holdUnmountedModalDismissals();
      }
      await act(() => tree.unmount());
    } finally {
      dismissing();
      timers.restore();
    }
  });

  await h.test('Overlays: an overlay whose owner stops wanting it in the very commit it is granted its turn ends at once: no exit to wait for, and no invisible window taking touches until the ceiling', async () => {
    try {
      for (const os of ['ios', 'android'] as const) {
        for (const kind of ['menu', 'sheet'] as const) {
          await resetPhone();
          Platform.OS = os;
          const timers = captureTimeouts();
          try {
            const Withdrawn = () => {
              const [visible, setVisible] = useState(true);
              React.useEffect(() => { setVisible(false); }, []);
              return kind === 'menu'
                ? <ContextMenu visible={visible} title="Timer" anchor={ANCHOR} rows={menuRows([])} onClose={() => {}} />
                : <Sheet visible={visible} title="Report this app" onClose={() => {}}><Body /></Sheet>;
            };
            const tree = await render(<Withdrawn />);
            h.eq([modalHosts(tree).length, timers.count(EXIT_CEILING_MS)], [0, 0], `${os} ${kind}: nothing is left over the screen and no ceiling is running`);
            await act(() => tree.unmount());
          } finally { timers.restore(); }
        }
      }
    } finally {
      Platform.OS = 'ios';
    }
  });

  await h.test('Overlays: an exit that never ends cannot hold the screen: an overlay no longer wanted is ended after a bounded wait and the next is presented; a normal exit passes the turn before it and leaves no wait', async () => {
    try {
      for (const os of ['ios', 'android'] as const) {
        await resetPhone();
        Platform.OS = os;
        const timers = captureTimeouts();
        try {
          const refused = modalPresentations.refused;
          const tree = await render(probes({ A: true, B: false }));
          await act(() => tree.update(probes({ A: false, B: true })));
          h.eq([overlayTitles(tree), timers.count(EXIT_CEILING_MS)], [['A'], 1], `${os}: A’s exit has not ended: it is still up, B waits, and one bounded wait is running`);
          await act(() => timers.fire(EXIT_CEILING_MS));
          h.eq([overlayTitles(tree), modalHosts(tree).length, gones], [['B'], 1, ['A']], `${os}: the wait is up: A is ended and B is presented, alone`);
          h.eq([modalPresentations.refused - refused, queueTimers(timers)], [0, 0], `${os}: the system refused nothing and nothing is left running`);
          await act(() => tree.unmount());
        } finally { timers.restore(); }
      }
    } finally {
      Platform.OS = 'ios';
    }
  });

  await h.test('Overlays: an exit that ends in time passes the turn at once and cancels the wait', async () => {
    await resetPhone();
    const timers = captureTimeouts();
    try {
      const tree = await render(probes({ A: true, B: false }));
      await act(() => tree.update(probes({ A: false, B: true })));
      await act(() => exits.get('A')!());
      h.eq([overlayTitles(tree), timers.count(EXIT_CEILING_MS), queueTimers(timers)], [['B'], 0, 0], 'B is up as A’s exit ends, and no wait is left for A');
      await act(() => tree.unmount());
    } finally { timers.restore(); }
  });

  await h.test('Overlays: wanted again while its exit is still running, an overlay stays up and its wait is cancelled', async () => {
    await resetPhone();
    const timers = captureTimeouts();
    try {
      const tree = await render(probes({ A: true }));
      await act(() => tree.update(probes({ A: false })));
      h.eq(timers.count(EXIT_CEILING_MS), 1, 'no longer wanted: the wait runs');
      await act(() => tree.update(probes({ A: true })));
      h.eq([timers.count(EXIT_CEILING_MS), overlayTitles(tree), gones], [0, ['A'], []], 'wanted again: the wait is cancelled, A is still up and has not gone');
      await act(() => tree.update(probes({ A: false })));
      await act(() => exits.get('A')!());
      h.eq([overlayTitles(tree), modalHosts(tree).length, gones, queueTimers(timers)], [[], 0, ['A'], 0], 'then it leaves once, for good, with nothing running');
      await act(() => tree.unmount());
    } finally { timers.restore(); }
  });

  await h.test('Overlays: a wanted that goes off and on within one tick leaves the overlay up, never reported gone and never waiting', async () => {
    await resetPhone();
    const timers = captureTimeouts();
    try {
      const tree = await render(probes({ A: true }));
      await TestRenderer.act(async () => { tree.update(probes({ A: false })); tree.update(probes({ A: true })); });
      h.eq([overlayTitles(tree), modalHosts(tree).length, gones, queueTimers(timers)], [['A'], 1, [], 0], 'still up, once, with nothing running');
      await act(() => tree.unmount());
    } finally { timers.restore(); }
  });

  await h.test('Overlays: an overlay unmounted while up on iOS keeps the screen taken until its dismissal is over: the next is not presented into it, then is presented without the system reporting anything', async () => {
    await resetPhone();
    const timers = captureTimeouts();
    const dismissing = holdUnmountedModalDismissals();
    try {
      const refused = modalPresentations.refused;
      const tree = await render(probes({ A: true }));
      await act(() => tree.update(probes({ B: true })));
      h.eq([overlayTitles(tree), modalPresentations.refused - refused, timers.count(DISMISS_REPORT_MS)], [[], 0, 1], 'A is gone while its dismissal is under way: B is not presented yet, and the queue holds the turn for a bounded time');
      dismissing();
      await act(() => timers.fire(DISMISS_REPORT_MS));
      h.eq([overlayTitles(tree), modalPresentations.refused - refused, queueTimers(timers)], [['B'], 0, 0], 'once it is over B is presented, and nothing is refused or left running');
      await act(() => tree.unmount());
    } finally {
      dismissing();
      timers.restore();
    }
  });

  await h.test('Overlays: an overlay unmounted while up on Android passes the turn at once: nothing is dismissed there that anyone would wait for', async () => {
    try {
      await resetPhone();
      Platform.OS = 'android';
      const timers = captureTimeouts();
      try {
        const tree = await render(probes({ A: true }));
        await act(() => tree.update(probes({ B: true })));
        h.eq([overlayTitles(tree), queueTimers(timers)], [['B'], 0], 'B is presented as A goes, with no wait');
        await act(() => tree.unmount());
      } finally { timers.restore(); }
    } finally {
      Platform.OS = 'ios';
    }
  });

  await h.test('Overlays: an overlay unmounted while its modal is hiding (iOS) also holds the turn for the dismissal, which was never going to be reported', async () => {
    await resetPhone();
    const timers = captureTimeouts();
    const release = holdModalDismissals();
    try {
      const tree = await render(probes({ A: true, B: true }));
      await act(() => tree.update(probes({ A: false, B: true })));
      await act(() => exits.get('A')!());
      h.eq([overlayTitles(tree), modalHosts(tree).length], [[], 1], 'A is hiding, its dismissal unreported, and B waits');
      await act(() => tree.update(probes({ B: true })));
      h.eq([overlayTitles(tree), timers.count(DISMISS_REPORT_MS)], [[], 1], 'unmounted there, A leaves one bounded wait, and B still waits');
      await act(() => timers.fire(DISMISS_REPORT_MS));
      h.eq([overlayTitles(tree), queueTimers(timers)], [['B'], 0], 'B is presented when it is up, with nothing left running');
      await act(() => tree.unmount());
    } finally {
      release();
      timers.restore();
    }
  });

  await h.test('Overlays: an overlay unmounted while it waits, or in the gap between two tries at presenting, gives up its place and its timers and the next in line is presented', async () => {
    await resetPhone();
    const timers = captureTimeouts();
    let allow = () => {};
    try {
      let tree = await render(probes({ A: true, B: true, C: true }));
      await act(() => tree.update(probes({ A: true, C: true })));
      h.eq([overlayTitles(tree), queueTimers(timers)], [['A'], 0], 'B, waiting, is gone: A is up, C waits, and nothing is running');
      await act(() => tree.update(probes({ A: false, C: true })));
      await act(() => exits.get('A')!());
      h.eq([overlayTitles(tree), gones], [['C'], ['A']], 'A leaves and C, not the B that went, is next');
      await act(() => tree.unmount());

      allow = refuseModalPresentations();
      tree = await render(probes({ A: true }));
      await act(() => timers.fire(SHOW_REPORT_MS));
      await act(() => timers.fire(0));
      await act(() => tree.update(probes({ A: true, B: true })));
      h.eq([modalHosts(tree).length, timers.count(SHOW_RETRY_MS)], [0, 1], 'A is between two tries, B waits behind it');
      allow();
      await act(() => tree.update(probes({ B: true })));
      h.eq([overlayTitles(tree), queueTimers(timers)], [['B'], 0], 'A unmounted in the gap: B is presented at once and A’s retry is not left running');
      await act(() => tree.unmount());
    } finally {
      allow();
      timers.restore();
    }
  });

  await h.test('Overlays: an overlay that closed and is wanted again lines up like any other, behind the one that took the screen meanwhile', async () => {
    try {
      for (const os of ['ios', 'android'] as const) {
        await resetPhone();
        Platform.OS = os;
        const tree = await render(probes({ A: true, B: false }));
        await act(() => tree.update(probes({ A: false, B: true })));
        await act(() => exits.get('A')!());
        h.eq([overlayTitles(tree), gones], [['B'], ['A']], `${os}: A has closed and B has the screen`);
        await act(() => tree.update(probes({ A: true, B: true })));
        h.eq([overlayTitles(tree), modalHosts(tree).length], [['B'], 1], `${os}: A is asked for again but waits its turn`);
        await act(() => tree.update(probes({ A: true, B: false })));
        await act(() => exits.get('B')!());
        h.eq([overlayTitles(tree), gones], [['A'], ['A', 'B']], `${os}: B closes and A is presented again`);
        await act(() => tree.unmount());
      }
    } finally {
      Platform.OS = 'ios';
    }
  });

  await h.test('Overlays: an unconfirmed presentation is only timed while the app is active: asked for in the background it waits, and nothing closes the sheet meanwhile', async () => {
    await resetPhone();
    const timers = captureTimeouts();
    const allow = refuseModalPresentations();
    try {
      setAppState('inactive');
      const closes = { n: 0 };
      const tree = await render(<HeldSheet onCloseCount={closes} />);
      h.eq([modalHosts(tree).length, timers.count(SHOW_REPORT_MS)], [1, 0], 'asked for while inactive: the modal is mounted and nothing times it');
      await act(() => setAppState('active'));
      h.eq(timers.count(SHOW_REPORT_MS), 1, 'back to active: the timing starts');
      await act(() => setAppState('background'));
      h.eq(timers.count(SHOW_REPORT_MS), 0, 'sent to the background while it waits: the timing stops');
      await act(() => setAppState('active'));
      h.eq([timers.count(SHOW_REPORT_MS), closes.n], [1, 0], 'and starts over on return, with the sheet still wanted');
      allow();
      await act(() => timers.fire(SHOW_REPORT_MS));
      await act(() => timers.fire(0));
      await act(() => timers.fire(SHOW_RETRY_MS));
      h.eq([overlayTitles(tree), closes.n], [['Report this app'], 0], 'it is presented once the system takes it');
      await act(() => tree.unmount());
    } finally {
      allow();
      timers.restore();
    }
  });

  await h.test('Overlays: no overlay keeps listening to the app’s state once it is unmounted', async () => {
    await resetPhone();
    const before = appStateListenerCount();
    const tree = await render(sheetPair('First'));
    h.ok(appStateListenerCount() > before, 'mounted overlays listen');
    await act(() => tree.unmount());
    h.eq(appStateListenerCount(), before, 'unmounted ones stop');
  });

  await h.test('ContextMenu: a card measured after the menu has closed does not grow in, which would cancel the exit that hands the screen on', async () => {
    await resetPhone();
    const release = holdModalDismissals();
    try {
      const tree = await render(<HeldMenu rows={menuRows([])} onCloseCount={{ n: 0 }} />);
      await press(tree.root.find((n) => hostType(n) === 'Pressable' && n.props.accessible === false));
      const from = animations.length;
      await layoutMenu(tree);
      h.eq(steps(from).filter((s) => s.to === 1).length, 0, 'no fade or spring toward open once it is closing');
      await act(() => tree.unmount());
    } finally {
      release();
    }
  });

  await h.test('ContextMenu: a row chosen as the menu’s owner goes away is dropped: the screen that would have run it is gone', async () => {
    await resetPhone();
    const timers = captureTimeouts();
    const release = holdModalDismissals();
    try {
      const log: string[] = [];
      const tree = await render(<HeldMenu rows={menuRows(log)} onCloseCount={{ n: 0 }} />);
      await layoutMenu(tree);
      await press(rowButtons(tree)[0]);
      h.eq(log, [], 'chosen, but the menu has not gone from the screen yet');
      await act(() => tree.unmount());
      release();
      await act(() => timers.fire(DISMISS_REPORT_MS));
      h.eq(log, [], 'and it never runs once the owner is gone');
    } finally {
      release();
      timers.restore();
    }
  });

  await h.test('ContextMenu: asked for again, the menu takes one row once more; a row chosen before it went still runs, and only that one', async () => {
    await resetPhone();
    const release = holdModalDismissals();
    try {
      const log: string[] = [];
      const control = { open: () => {} };
      const tree = await render(<ToggleMenu log={log} control={control} />);
      await layoutMenu(tree);
      await press(rowButtons(tree)[0]);
      await act(() => control.open());
      await act(() => release());
      h.eq(log, ['open'], 'the row chosen before the menu closed ran once it had gone, though the menu was asked for again');
      await layoutMenu(tree);
      await press(rowButtons(tree).find((r) => r.props.accessibilityLabel === 'Delete')!);
      h.eq(log, ['open', 'delete'], 'the second opening takes the row chosen in it');
      await act(() => tree.unmount());
    } finally {
      release();
    }
  });

  // ── Toast ──────────────────────────────────────────────────────────────────

  await h.test('Toast: shows 4 s, 6 s with an action, 10 s for Undo, then goes; a new toast replaces the one showing in place and restarts the time', async () => {
    await resetPhone();
    const timers = captureTimeouts();
    let api!: ToastApi;
    const Grab = () => { api = useToast(); return null; };
    try {
      const tree = await render(<ToastHost bottomOffset={64}><Grab /></ToastHost>);
      const capsules = () => tree.root.findAll((n) => hostType(n) === 'Animated.View' && n.props.accessibilityLiveRegion === 'polite');
      for (const [spec, ms] of [[{ message: 'Copied' }, 4000], [{ message: 'Saved', action: { label: 'Open', onPress: () => {} } }, 6000], [{ message: 'Deleted', undo: true, action: { label: 'Undo', onPress: () => {} } }, 10000]] as const) {
        await act(() => api.show(spec));
        await settle();
        h.ok(textOf(tree.root).includes(spec.message) && timers.count(ms) === 1, `“${spec.message}” shows for ${ms / 1000} s`);
        await act(() => timers.fire(ms));
        h.eq(capsules().length, 0, `“${spec.message}”: gone after its time`);
      }
      await act(() => api.show({ message: 'One' }));
      await act(() => api.show({ message: 'Two', action: { label: 'Open', onPress: () => {} } }));
      await settle();
      h.eq([capsules().length, textOf(tree.root).includes('One'), textOf(tree.root).includes('Two')], [1, false, true], 'one capsule, with the new words');
      h.eq([timers.count(4000), timers.count(6000)], [0, 1], 'the old time is dropped and the new one runs');
      await act(() => tree.unmount());
    } finally { timers.restore(); }
  });

  await h.test('Toast: the time pauses while touched and stops while a screen reader runs, which can still dismiss it; it is announced politely', async () => {
    await resetPhone();
    const timers = pendingTimeouts();
    let api!: ToastApi;
    const Grab = () => { api = useToast(); return null; };
    try {
      const tree = await render(<ToastHost><Grab /></ToastHost>);
      const capsule = () => tree.root.find((n) => hostType(n) === 'Animated.View' && n.props.accessibilityLiveRegion === 'polite');
      await act(() => api.show({ message: 'Copied' }));
      await settle();
      h.eq(announcements, ['Copied'], 'iOS announces it');
      h.eq(timers.delays(), [4000], 'its 4 s run');
      await act(() => capsule().props.onTouchStart());
      h.eq(timers.delays(), [], 'touched: its time stops');
      await act(() => capsule().props.onTouchEnd());
      h.ok(timers.delays().length === 1 && timers.delays()[0] <= 4000 && timers.delays()[0] > 3000, 'let go: the rest of its time runs');
      await act(() => { accessibilitySettings.screenReader = true; emitAccessibility('screenReaderChanged', true); });
      h.eq(timers.delays(), [], 'a screen reader running: no time at all');
      await act(() => capsule().props.onAccessibilityAction({ nativeEvent: { actionName: 'dismiss' } }));
      h.eq(tree.root.findAll((n) => n.props.accessibilityLiveRegion === 'polite').length, 0, 'its dismiss action takes it away');
      await act(() => tree.unmount());
    } finally { timers.restore(); }
    Platform.OS = 'android';
    const tree = await render(<ToastHost><Grab /></ToastHost>);
    await act(() => api.show({ message: 'Saved' }));
    h.eq(announcements, ['Copied'], 'Android: no announcement call; the polite live region reads it');
    await act(() => tree.unmount());
  });

  await h.test('Toast: a swipe down past the projection rule dismisses it on fling; a nudge springs it back; its action runs and dismisses', async () => {
    await resetPhone();
    let api!: ToastApi;
    const Grab = () => { api = useToast(); return null; };
    const ran: string[] = [];
    const tree = await render(<ToastHost><Grab /></ToastHost>);
    const shown = () => tree.root.findAll((n) => hostType(n) === 'Animated.View' && n.props.accessibilityLiveRegion === 'polite').length;
    await act(() => api.show({ message: 'Copied' }));
    const swipe = () => all(tree, 'GestureDetector')[0].props.gesture as PanConfig;
    await act(() => pan(swipe(), [12, 16], 0));
    h.eq(shown(), 1, 'a nudge: it stays');
    const from = animations.length;
    await act(() => pan(swipe(), [12, 40, 60], 600));
    h.ok(steps(from).some((s) => s.kind === 'spring' && sameSpring(s.config, 'fling') && s.config?.velocity === 600), 'a swipe hands its velocity to fling');
    h.eq(shown(), 0, 'and dismisses it');
    await act(() => api.show({ message: 'Deleted', undo: true, action: { label: 'Undo', onPress: () => ran.push('undo') } }));
    await press(rowButtons(tree).find((n) => n.props.accessibilityLabel === 'Undo')!);
    h.eq([ran, shown()], [['undo'], 0], 'Undo runs and the toast goes');
    await act(() => tree.unmount());
    const floating = await render(<ToastHost bottomOffset={64}><Grab /></ToastHost>);
    await act(() => api.show({ message: 'Copied' }));
    const slot = floating.root.find((n) => hostType(n) === 'View' && n.props.pointerEvents === 'box-none');
    h.eq(flat(slot).bottom, useSafeAreaInsets().bottom + 64 + 12, '12 pt above what floats over the safe area');
    h.eq(flat(floating.root.find((n) => n.props.accessibilityLiveRegion === 'polite')).maxWidth, TOAST.maxWidth, 'at most 360 wide');
    await act(() => floating.unmount());
  });

  await h.test('Toast: its action reaches the platform’s touch target — 44 on iOS, 48 on Android — through its hit slop, whatever the words measure', async () => {
    try {
      for (const os of ['ios', 'android'] as const) {
        await resetPhone();
        Platform.OS = os;
        let api!: ToastApi;
        const Grab = () => { api = useToast(); return null; };
        const tree = await render(<ToastHost><Grab /></ToastHost>);
        await act(() => api.show({ message: 'Tip Splitter deleted', undo: true, action: { label: 'Undo', onPress: () => {} } }));
        const undo = rowButtons(tree).find((n) => n.props.accessibilityLabel === 'Undo')!;
        const slop = undo.props.hitSlop as number;
        h.ok(TYPE_SCALE.headline.lineHeight + 2 * slop >= LAYOUT.touchTarget[os], `${os}: ${TYPE_SCALE.headline.lineHeight} pt of text and ${slop} of slop on each side reach ${LAYOUT.touchTarget[os]}`);
        await act(() => tree.unmount());
      }
    } finally {
      Platform.OS = 'ios';
    }
  });

  // ── TextField ──────────────────────────────────────────────────────────────

  await h.test('TextField: label above, read as the field’s name; focus draws a 2 pt text border, an error a 2 pt danger one with its words and icon under the field; the box never changes size', async () => {
    await resetPhone();
    const Field = ({ error }: { error?: string }) => <TextField label="Server address" value="https://x" onChangeText={() => {}} error={error} />;
    const tree = await render(<Field />);
    const input = () => tree.root.find((n) => hostType(n) === 'TextInput');
    const boxOf = () => tree.root.find((n) => hostType(n) === 'View' && flat(n).borderRadius === 14);
    const extent = () => { const st = flat(boxOf()); return [Number(st.borderWidth) + Number(st.paddingVertical), Number(st.borderWidth) + Number(st.paddingHorizontal)]; };
    h.eq(input().props.accessibilityLabel, 'Server address', 'the label names the field');
    h.eq([flat(boxOf()).borderWidth, flat(boxOf()).borderColor], [1, LIGHT.border], 'at rest: 1 pt border');
    const rest = extent();
    await act(() => input().props.onFocus({}));
    h.eq([flat(boxOf()).borderWidth, flat(boxOf()).borderColor], [2, LIGHT.text], 'focused: 2 pt text');
    h.eq(extent(), rest, 'the same outer size focused');
    h.eq(input().props.selectionColor, LIGHT.ink, 'iOS: an ink caret');
    await act(() => tree.update(<Field error="That address didn’t answer." />));
    h.eq([flat(boxOf()).borderWidth, flat(boxOf()).borderColor], [2, LIGHT.danger], 'error: 2 pt danger');
    h.ok(textOf(tree.root).includes('That address didn’t answer.') && tree.root.findAll((n) => hostType(n) === 'Path').length >= 1, 'its words, with an icon, under the field');
    h.eq(input().props.accessibilityHint, 'That address didn’t answer.', 'and read with the field');
    await act(() => tree.unmount());
  });

  await h.test('TextField: a clear button only on a non-empty single-line field, which empties it; a text area shows 3 lines and grows to 8', async () => {
    await resetPhone();
    const changes: string[] = [];
    let tree = await render(<TextField value="" onChangeText={(v) => changes.push(v)} accessibilityLabel="Name" />);
    h.eq(rowButtons(tree).filter((n) => n.props.accessibilityLabel === COPY.fieldClear).length, 0, 'empty: no clear button');
    await act(() => tree.update(<TextField value="Ada" onChangeText={(v) => changes.push(v)} accessibilityLabel="Name" />));
    await press(rowButtons(tree).find((n) => n.props.accessibilityLabel === COPY.fieldClear)!);
    h.eq(changes, [''], 'clear empties it');
    await act(() => tree.unmount());
    tree = await render(<TextArea value="Some words" onChangeText={() => {}} accessibilityLabel="Note" />);
    h.eq(rowButtons(tree).filter((n) => n.props.accessibilityLabel === COPY.fieldClear).length, 0, 'a text area has none');
    const area = flat(tree.root.find((n) => hostType(n) === 'TextInput'));
    const line = TYPE_SCALE.body.lineHeight;
    const pad = Number(area.borderWidth) + Number(area.paddingVertical);
    h.eq([area.minHeight, area.maxHeight], [3 * line + 2 * pad, 8 * line + 2 * pad], '3 body lines tall, growing to 8');
    await act(() => tree.unmount());
  });

  await h.test('TextField in a screen: focused near the bottom, the keyboard up, it scrolls to sit 16 pt above the keyboard', async () => {
    await resetPhone();
    const scrolls: number[] = [];
    let tree!: Tree;
    await TestRenderer.act(async () => {
      tree = TestRenderer.create(
        <KeyboardShell><TextField label="Server address" value="" onChangeText={() => {}} /></KeyboardShell>,
        { createNodeMock: fieldScreenMock(scrolls) },
      );
    });
    const frames = { request: globalThis.requestAnimationFrame, cancel: globalThis.cancelAnimationFrame };
    globalThis.requestAnimationFrame = (cb) => { cb(0); return 0; };
    globalThis.cancelAnimationFrame = () => {};
    try {
      const scroll = tree.root.find((n) => hostType(n) === 'ScrollView');
      scroll.props.innerViewRef.current = {};
      await act(() => scroll.props.onLayout({ nativeEvent: { layout: { height: 800 } } }));
      await act(() => tree.root.find((n) => hostType(n) === 'TextInput').props.onFocus({}));
      await act(() => moveKeyboard(344));
      await act(() => scroll.props.onLayout({ nativeEvent: { layout: { height: 456 } } }));
      h.eq(scrolls.at(-1), 700 + 48 + 16 - 456, 'the field’s bottom 16 pt above the keyboard');
    } finally {
      await act(() => tree.unmount());
      globalThis.requestAnimationFrame = frames.request;
      globalThis.cancelAnimationFrame = frames.cancel;
    }
  });

  // ── GroupedList ────────────────────────────────────────────────────────────

  await h.test('GroupedList: every row its own element; separators between rows, inset 16, 52 under an icon; a switch row is one switch that flips with the toggle haptic; copy is a button of its own; destructive titles in danger-text', async () => {
    await resetPhone();
    const log: string[] = [];
    const Group = () => {
      const [on, setOn] = useState(false);
      return (
        <GroupedSection header="Advanced" footer="Only you see this." on="sheet">
          <GroupedRow title="Send error details" icon="info" trailing={{ kind: 'switch', value: on, onValueChange: setOn }} />
          <GroupedRow title="Phone ID" trailing={{ kind: 'copy', label: 'Copy phone ID', onCopy: () => log.push('copy') }} />
          <GroupedRow title="Language" trailing={{ kind: 'value', text: 'English' }} onPress={() => log.push('lang')} />
          <GroupedRow title="Make a new ID" destructive onPress={() => log.push('reset')} />
        </GroupedSection>
      );
    };
    const tree = await render(<Group />);
    const rows = all(tree, 'Pressable');
    h.eq(rows.map((r) => r.props.accessibilityLabel), ['Send error details', 'Phone ID', 'Copy phone ID', 'Language, English', 'Make a new ID'], 'each row, and the copy button, its own element');
    h.ok(rows.every((r) => screenReaderElement(r) === r), 'none inside another');
    const group = tree.root.find((n) => hostType(n) === 'View' && flat(n).borderRadius === 20);
    h.eq(flat(group).backgroundColor, LIGHT['sheet-group'], 'in a sheet: sheet-group');
    const insets = group.findAll((n) => hostType(n) === 'View' && flat(n).height === StyleSheet.hairlineWidth).map((n) => flat(n).marginLeft);
    h.eq(insets, [LAYOUT.separatorInset, LAYOUT.separatorInset, LAYOUT.separatorInset], 'three separators for four rows, inset 16');
    h.eq([rows[0].props.accessibilityRole, rows[0].props.accessibilityState.checked], ['switch', false], 'the switch row reads as a switch, off');
    await press(rows[0]);
    h.eq([all(tree, 'Pressable')[0].props.accessibilityState.checked, hapticCalls.some((c) => c.includes('TOGGLE_ON'))], [true, true], 'pressing the row flips it, with the toggle haptic');
    h.eq(all(tree, 'Switch')[0].props.trackColor.true, LIGHT.ink, 'on-track ink');
    await press(rows[2]);
    h.eq(log, ['copy'], 'copy runs on its own button');
    const resetTitle = rows[4].find((n) => hostType(n) === 'Text');
    h.eq(flat(resetTitle).color, LIGHT['danger-text'], 'destructive title in danger-text');
    await act(() => tree.unmount());
    const withIcons = await render(
      <GroupedSection>
        <GroupedRow title="A" icon="info" />
        <GroupedRow title="B" icon="info" />
      </GroupedSection>,
    );
    const iconInset = withIcons.root.findAll((n) => hostType(n) === 'View' && flat(n).height === StyleSheet.hairlineWidth).map((n) => flat(n).marginLeft);
    h.eq([iconInset, flat(withIcons.root.find((n) => hostType(n) === 'View' && flat(n).borderRadius === 20)).backgroundColor], [[LAYOUT.separatorInsetWithIcon], LIGHT.surface], 'under an icon: inset 52; on the canvas: surface');
    await act(() => withIcons.unmount());
  });

  await h.test('GroupedList: from 135% text a trailing value goes under its title, so the title keeps the row’s width; the spoken label and the other trailing marks stay where they were', async () => {
    const seen = new Map<number, Awaited<ReturnType<typeof groupedRowsAt>>>();
    for (const scale of [1, 1.2, 1.35, 2, 3]) seen.set(scale, await groupedRowsAt(scale));
    h.eq([...seen].map(([scale, row]) => [scale, row.stacked]), [[1, false], [1.2, false], [1.35, true], [2, true], [3, true]], 'beside its title below 135%, under it from 135%');
    h.ok([...seen.values()].every((row) => row.label === 'Language, Français' && row.marks === 1), 'the row reads the same to a screen reader, and a link row keeps its mark, at every size');
    await resetPhone();
  });

  await h.test('GroupedList: a chevron row that opens in place says whether it is open — its chevron turns down and the state is announced; a plain chevron row says nothing', async () => {
    await resetPhone();
    const tree = await render(<OpeningRows />);
    const look = () => all(tree, 'Pressable').map((row) => [row.findAllByType(Icon)[0].props.name, row.props.accessibilityState.expanded]);
    h.eq(look(), [['chevron-right', false], ['chevron-right', undefined]], 'closed: pointing right and not expanded; the plain row has no state to give');
    await press(all(tree, 'Pressable')[0]);
    h.eq(look(), [['chevron-down', true], ['chevron-right', undefined]], 'open: pointing down and expanded');
    await press(all(tree, 'Pressable')[0]);
    h.eq(look()[0], ['chevron-right', false], 'closed again');
    await act(() => tree.unmount());
  });

  // ── AppTile geometry ───────────────────────────────────────────────────────

  await h.test('AppTile geometry: the documented sizes, four columns of (screen − 40) / 4, three from 135% text, a list of 40 tiles from 200%, and cells at least 64 × 84', async () => {
    const documented = documentedTileSizes();
    h.eq([documented.inline, documented.sheets, documented.grid, documented.hero], [TILE_SIDE.inline, TILE_SIDE.menu, TILE_SIDE.grid, TILE_SIDE.hero], `the sizes system.md §3.2 lists (${JSON.stringify(documented)})`);
    for (const width of [320, 390, 430]) {
      const grid = gridLayout(width, 1);
      h.ok(grid.kind === 'grid' && grid.columns === 4 && grid.columnWidth === Math.floor((width - 40) / 4) && grid.tile === 64, `${width} pt: four columns of (screen − 40) / 4, rounded down, with the 64 tile`);
      h.ok(grid.kind === 'grid' && grid.columnWidth >= 64 && grid.cellHeight >= 84, `${width} pt: each cell at least 64 × 84`);
    }
    const large = gridLayout(390, 1.35);
    h.ok(large.kind === 'grid' && large.columns === 3, '135%: three columns');
    const list = gridLayout(390, 2);
    h.ok(list.kind === 'list' && list.tile === 40, '200%: a list of rows with the 40 tile');
    const cell = (part: string) => SYSTEM_MD.split('\n').find((l) => l.startsWith(`| ${part} |`)) ?? '';
    const glyph = cell('Glyph');
    h.eq([TILE.glyph * 100, TILE.glyphStroke], [Number(/(\d{1,3})% of the tile/.exec(glyph)?.[1]), Number(/stroke (\d{1,2})/.exec(glyph)?.[1])], `the glyph as §3.2 draws it (${glyph})`);
    h.eq(TILE.badge, Number(/(\d{1,3}) pt/.exec(cell('Badge'))?.[1]), 'the badge as §3.2 sizes it');
    h.eq(TILE.corner * 100, Number(/corner (\d{1,2}(?:\.\d{1,2})?)% of side/.exec(SYSTEM_MD)?.[1]), 'the squircle corner §2.9 gives');
    const grown = gridLayout(390, 1.3);
    h.ok(grown.kind === 'grid' && grown.cellHeight > (gridLayout(390, 1) as { cellHeight: number }).cellHeight, 'a cell grows with its label’s text size');
  });

  await h.test('AppTile geometry: at any width a row of cells and the gutters fit the screen, rounded down so no cell wraps; a degenerate width still gives a real cell', async () => {
    h.eq(gridFitViolations(1, 4).concat(gridFitViolations(1.35, 3)), [], 'from 280 to 1100 pt, four columns and three, every cell fits and none is smaller than it could be');
    const degenerate: string[] = [];
    for (const width of [0, -1, -390, 40, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      for (const scale of [1, 1.35]) {
        const grid = gridLayout(width, scale);
        if (grid.kind !== 'grid' || !Number.isFinite(grid.columnWidth) || grid.columnWidth <= 0) degenerate.push(`${width} at ${scale}`);
      }
    }
    h.eq(degenerate, [], 'a width of 0, negative, too small, NaN or infinite never yields a zero, negative or NaN cell');
    for (const width of [0, 320, 390, Number.NaN]) {
      const list = gridLayout(width, 2);
      h.ok(list.kind === 'list' && list.tile === 40 && Number.isFinite(list.rowHeight) && list.rowHeight > 0, `width ${width}: the list at 200% is rows of the 40 tile`);
    }
  });

  await resetPhone();
}
