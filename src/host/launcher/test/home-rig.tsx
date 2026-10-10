/** Driving Home as a person does: render it under a toast host, long-press a tile by its name, read
 *  the menu and the toast, choose a row. The menu anchors to the cell it opens from, so every host
 *  node here measures as one fixed rect. */
import React from 'react';
import TestRenderer from 'react-test-renderer';
import HomeScreen, { type HomeScreenProps } from '../HomeScreen';
import { ToastHost } from '../../ui/Toast';
import { press, textOf, hostType } from './react-screen';

export type Tree = TestRenderer.ReactTestRenderer;
type Node = TestRenderer.ReactTestInstance;

export const CELL_RECT = { x: 20, y: 160, width: 88, height: 100 } as const;

/** How far below the top of the root Android's `measureInWindow` starts counting: the status bar's
 *  height on the device the menu was seen 53 dp too high on. */
export const STATUS_BAR_OFFSET = 53;

/** Only a tile (a pressable with a long-press) measures; every other host node stays unmocked. It
 *  measures as the native views do on Android: `measure`'s page offsets from the top of the root, which
 *  is where a Modal's content starts, and `measureInWindow` from below the status bar. */
export const tileNodeMock = (element: React.ReactElement<{ onLongPress?: unknown }>) =>
  typeof element.props.onLongPress === 'function'
    ? {
        measure: (cb: (x: number, y: number, w: number, h: number, pageX: number, pageY: number) => void) =>
          cb(0, 0, CELL_RECT.width, CELL_RECT.height, CELL_RECT.x, CELL_RECT.y),
        measureInWindow: (cb: (x: number, y: number, w: number, h: number) => void) =>
          cb(CELL_RECT.x, CELL_RECT.y - STATUS_BAR_OFFSET, CELL_RECT.width, CELL_RECT.height),
      }
    : null;

/** Render any screen (the whole `LauncherRoot`) so its tiles measure as `CELL_RECT`. */
export async function renderRoot(element: React.ReactElement): Promise<Tree> {
  let tree!: Tree;
  await TestRenderer.act(async () => { tree = TestRenderer.create(element, { createNodeMock: tileNodeMock }); });
  return tree;
}

const noop = () => {};
const never = async () => null;
const restored = () => true;

/** Home's props with every callback a no-op, for a test to override the ones it watches. */
export function homeProps(over: Partial<HomeScreenProps> = {}): HomeScreenProps {
  return {
    apps: [],
    onOpen: noop,
    onFork: never,
    onDelete: noop,
    onUndoDelete: restored,
    onSettleDelete: noop,
    onDiscard: noop,
    onUndoDiscard: restored,
    onSettleDiscard: noop,
    onHistory: noop,
    onPromptAgain: noop,
    onCreate: noop,
    onSettings: noop,
    onCustomizeTile: noop,
    onResetTile: noop,
    ...over,
  };
}

export const renderHome = (over: Partial<HomeScreenProps> = {}): Promise<Tree> =>
  renderRoot(
    <ToastHost>
      <HomeScreen {...homeProps(over)} />
    </ToastHost>,
  );

/** Re-render the same tree with other Home props. */
export async function updateHome(tree: Tree, over: Partial<HomeScreenProps>): Promise<void> {
  await TestRenderer.act(async () => {
    tree.update(
      <ToastHost>
        <HomeScreen {...homeProps(over)} />
      </ToastHost>,
    );
  });
}

/** Lets `useTokens`' async accessibility queries land. */
export const settle = () => TestRenderer.act(async () => { await new Promise((r) => setImmediate(r)); });

const buttons = (tree: Tree) => tree.root.findAll((n) => hostType(n) === 'Pressable' && n.props.accessibilityRole === 'button');

/** The tile cells in reading order: each is a button whose label starts with the tile's name. */
export const tiles = (tree: Tree): Node[] => buttons(tree).filter((n) => typeof n.props.onLongPress === 'function');

export const tileLabels = (tree: Tree): string[] => tiles(tree).map((n) => String(n.props.accessibilityLabel));

export function tile(tree: Tree, name: string): Node {
  const matches = tiles(tree).filter((n) => String(n.props.accessibilityLabel) === name || String(n.props.accessibilityLabel).startsWith(`${name},`));
  if (matches.length !== 1) throw new Error(`expected one tile "${name}", got ${matches.length} among ${tileLabels(tree).join(' | ')}`);
  return matches[0];
}

export async function longPress(tree: Tree, name: string): Promise<void> {
  await TestRenderer.act(async () => tile(tree, name).props.onLongPress());
}

export const menuCard = (tree: Tree): Node | undefined =>
  tree.root.findAll((n) => hostType(n) === 'Animated.View' && n.props.accessibilityRole === 'menu')[0];

/** The menu's rows (buttons inside the menu card), top to bottom. */
export function menuRows(tree: Tree): Node[] {
  const card = menuCard(tree);
  return card ? card.findAll((n) => hostType(n) === 'Pressable' && n.props.accessibilityRole === 'button') : [];
}

export const menuLabels = (tree: Tree): string[] => menuRows(tree).map((n) => String(n.props.accessibilityLabel));

export async function chooseRow(tree: Tree, label: string): Promise<void> {
  const row = menuRows(tree).find((n) => n.props.accessibilityLabel === label);
  if (!row) throw new Error(`no menu row "${label}" among ${menuLabels(tree).join(' | ')}`);
  await press(row);
}

/** The toast on screen: its words and its action's label, or null. */
export function toastOf(tree: Tree): { message: string; action?: string } | null {
  const capsule = tree.root.findAll((n) => hostType(n) === 'Animated.View' && n.props.accessibilityLiveRegion === 'polite')[0];
  if (!capsule) return null;
  const action = capsule.findAll((n) => hostType(n) === 'Pressable')[0];
  const message = capsule.findAll((n) => hostType(n) === 'Text')[0];
  return { message: textOf(message), ...(action ? { action: String(action.props.accessibilityLabel) } : {}) };
}

export async function pressToastAction(tree: Tree): Promise<void> {
  const capsule = tree.root.findAll((n) => hostType(n) === 'Animated.View' && n.props.accessibilityLiveRegion === 'polite')[0];
  await press(capsule.findAll((n) => hostType(n) === 'Pressable')[0]);
}

/** Dismiss the toast on screen the way a screen reader does (its `dismiss` action). */
export async function dismissToast(tree: Tree): Promise<void> {
  const capsule = tree.root.findAll((n) => hostType(n) === 'Animated.View' && n.props.accessibilityLiveRegion === 'polite')[0];
  await TestRenderer.act(async () => capsule.props.onAccessibilityAction({ nativeEvent: { actionName: 'dismiss' } }));
}

/** A sheet by title: the Modal whose card is headed by it. */
export const sheetTitled = (tree: Tree, title: string): Node | undefined =>
  tree.root.findAll((n) => hostType(n) === 'Modal' && n.findAll((m) => hostType(m) === 'Text' && textOf(m) === title).length > 0)[0];

/** Every row button of the sheet titled `title`, by label. */
export const sheetRows = (tree: Tree, title: string): Node[] =>
  (sheetTitled(tree, title)?.findAll((n) => hostType(n) === 'Pressable' && n.props.accessibilityRole !== undefined) ?? []);
