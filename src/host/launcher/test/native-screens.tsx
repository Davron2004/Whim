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

export const ScreenStack = (props: HostProps) => React.createElement('ScreenStack', props, props.children);
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
  await TestRenderer.act(async () => top.props.onDismissed({ nativeEvent: { dismissCount: count } }));
}

/** Android's native header back was tapped on the top screen. */
export async function androidHeaderBack(tree: Tree): Promise<void> {
  const top = topItem(tree);
  await TestRenderer.act(async () => top.props.onHeaderBackButtonClicked());
}
