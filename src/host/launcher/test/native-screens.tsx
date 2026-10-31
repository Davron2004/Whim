/** react-native-screens for React interaction tests. `ScreenStack` and `ScreenStackItem` render as
 *  host elements carrying their props, so a suite reads the stack the shell renders and plays the
 *  native side's events into it, as the library delivers them: an iOS pop (the header back, the
 *  edge or content swipe, the back button's long-press menu) arrives as `onDismissed` with the
 *  number of screens UIKit already removed; Android's header back arrives as
 *  `onHeaderBackButtonClicked`, and the JS side pops. Android's hardware back never reaches this
 *  library: it is `BackHandler`'s (`native-host.tsx#hardwareBack`). */
import React from 'react';
import TestRenderer from 'react-test-renderer';

type HostProps = { children?: React.ReactNode; [key: string]: unknown };

/** The stack's moves as iOS makes them. A top screen changed by the JS side (a push, or a pop asked
 *  for by the shell) is animated by UIKit; one already popped by UIKit (`iosPop`) is not animated
 *  again. A stack unmounted while such a move runs keeps it unfinished in the view react-native-screens
 *  recycles, and the next stack mounted shows a blank screen for good (design-system-v1 19f3,
 *  measured on the iOS 27 simulator). A move outlasts any bundle read, so here it runs until the
 *  test ends it (`stackMoveEnds`) or the stack goes. */
let nativePopped = false;
let moving = false;
let unmountsMidMove = 0;

/** How many stacks have been unmounted while a move of theirs was running, since the module loaded. */
export function stackUnmountsMidMove(): number {
  return unmountsMidMove;
}

/** The mounted stack's `onFinishTransitioning`, which react-native-screens calls when a move ends. */
let finishTransitioning: (() => void) | undefined;

/** The platform finished the move the stack was making, and tells the stack so. UIKit takes no touch
 *  while a push or pop runs, so a person's next tap only comes after this. */
export async function stackMoveEnds(): Promise<void> {
  if (!moving) return;
  moving = false;
  await TestRenderer.act(async () => finishTransitioning?.());
}

function topScreenId(children: React.ReactNode): unknown {
  const items = React.Children.toArray(children);
  const top = items.at(-1);
  return React.isValidElement<{ screenId?: unknown }>(top) ? top.props.screenId : undefined;
}

export const ScreenStack = (props: HostProps) => {
  const top = topScreenId(props.children);
  const shown = React.useRef<unknown>(undefined);
  React.useLayoutEffect(() => {
    moving = false;
    return () => {
      if (moving) unmountsMidMove += 1;
      moving = false;
      finishTransitioning = undefined;
    };
  }, []);
  React.useLayoutEffect(() => {
    finishTransitioning = props.onFinishTransitioning as (() => void) | undefined;
    if (shown.current !== undefined && shown.current !== top) {
      moving = !nativePopped;
      nativePopped = false;
    }
    shown.current = top;
  });
  return React.createElement('ScreenStack', props, props.children);
};
export const ScreenStackItem = (props: HostProps) => React.createElement('ScreenStackItem', props, props.children);
export function enableScreens(): void {}

type Tree = TestRenderer.ReactTestRenderer;
type Node = TestRenderer.ReactTestInstance;

/** The items of the one stack `tree` renders, bottom first. */
export function stackItems(tree: Tree): Node[] {
  return tree.root.findAll((node) => String(node.type) === 'ScreenStackItem');
}

/** The `screenId`s of the stack `tree` renders, bottom first; empty when no stack is rendered. */
export function stackIds(tree: Tree): string[] {
  return stackItems(tree).map((item) => String(item.props.screenId));
}

function topItem(tree: Tree): Node {
  const items = stackItems(tree);
  if (items.length < 2) throw new Error(`Expected a pushed screen on the stack, got ${items.length} item(s)`);
  return items[items.length - 1];
}

/** Whether the top item's native header shows a back control. */
export function headerBackShown(tree: Tree): boolean {
  const config = topItem(tree).props.headerConfig as { hidden?: boolean; hideBackButton?: boolean } | undefined;
  return config?.hidden !== true && config?.hideBackButton !== true;
}

/** UIKit popped `count` screens off the top (a swipe, the header back, or its long-press menu). */
export async function iosPop(tree: Tree, count = 1): Promise<void> {
  const top = topItem(tree);
  nativePopped = true;
  await TestRenderer.act(async () => top.props.onDismissed({ nativeEvent: { dismissCount: count } }));
}

/** Android's native header back was tapped on the top screen. */
export async function androidHeaderBack(tree: Tree): Promise<void> {
  const top = topItem(tree);
  await TestRenderer.act(async () => top.props.onHeaderBackButtonClicked());
}
