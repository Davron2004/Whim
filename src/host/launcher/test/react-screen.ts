import React from 'react';
import TestRenderer from 'react-test-renderer';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// React Native's frame callbacks, which Node lacks: one frame is the next timer turn.
globalThis.requestAnimationFrame ??= (callback) => setTimeout(() => callback(Date.now()), 0) as unknown as number;
globalThis.cancelAnimationFrame ??= (handle) => clearTimeout(handle);

export async function renderScreen(element: React.ReactElement, options?: TestRenderer.TestRendererOptions): Promise<TestRenderer.ReactTestRenderer> {
  let tree!: TestRenderer.ReactTestRenderer;
  await TestRenderer.act(async () => { tree = TestRenderer.create(element, options); });
  return tree;
}
export async function unmountScreen(tree: TestRenderer.ReactTestRenderer): Promise<void> {
  await TestRenderer.act(async () => tree.unmount());
}
/** The name of the host component `node` is ('View', 'Text', 'TextInput', ...), or undefined for a
 *  composite. The native-host double renders React Native's host components as plain string types,
 *  which `ReactTestInstance.type` (typed for react-dom's intrinsic elements) cannot name. */
export function hostType(node: TestRenderer.ReactTestInstance): string | undefined {
  const type: unknown = node.type;
  return typeof type === 'string' ? type : undefined;
}
/** A `find`/`findAll` predicate for the host component named `name`. */
export const isHost = (name: string) => (node: TestRenderer.ReactTestInstance): boolean => hostType(node) === name;
export function textOf(node: TestRenderer.ReactTestInstance): string {
  return node.children.map(child => typeof child === 'string' ? child : textOf(child)).join('');
}
export function button(tree: TestRenderer.ReactTestRenderer, label: string): TestRenderer.ReactTestInstance {
  const matches = tree.root.findAll(node =>
    typeof node.type === 'string' && ['TouchableOpacity', 'Pressable'].includes(node.type) &&
    (node.props.accessibilityLabel === label || textOf(node) === label),
  );
  if (matches.length !== 1) throw new Error(`Expected one visible button "${label}", got ${matches.length}`);
  return matches[0];
}
export async function press(node: TestRenderer.ReactTestInstance): Promise<void> {
  for (let ancestor: TestRenderer.ReactTestInstance | null = node; ancestor; ancestor = ancestor.parent) {
    if (ancestor.props.disabled || ancestor.props.accessibilityState?.disabled || ancestor.props.pointerEvents === 'none') {
      throw new Error('Cannot press a disabled control');
    }
  }
  if (typeof node.props.onPress !== 'function') throw new Error('Control has no press handler');
  await TestRenderer.act(async () => { node.props.onPress(); });
}

/** Android back as a device delivers it while a sheet is up: to the topmost `Modal`'s
 *  `onRequestClose`, never to `BackHandler` (a Modal consumes the press). The last `Modal` in tree
 *  order is the one presented last. */
export async function androidBack(tree: TestRenderer.ReactTestRenderer): Promise<void> {
  const modals = tree.root.findAll(isHost('Modal'));
  const top = modals.at(-1);
  if (!top || typeof top.props.onRequestClose !== 'function') throw new Error('No modal is up to take Android back');
  await TestRenderer.act(async () => { top.props.onRequestClose(); });
}

/** React Native's touchables, text and inputs are accessibility elements unless `accessible={false}`
 *  (`Pressable` passes `accessible !== false`); a plain View is one only with `accessible`. */
const ACCESSIBLE_BY_DEFAULT = new Set(['TouchableOpacity', 'Pressable', 'Text', 'TextInput', 'Switch']);

const isAccessibilityElement = (node: TestRenderer.ReactTestInstance) =>
  typeof node.type === 'string' && node.props.accessible !== false && (node.props.accessible === true || ACCESSIBLE_BY_DEFAULT.has(node.type));

/** The element VoiceOver reads `node` as: the outermost accessibility element around it, itself
 *  included. iOS reads an accessibility element and everything inside it as one element, with one
 *  joined label, and activating it runs that element's own press. */
export function screenReaderElement(node: TestRenderer.ReactTestInstance): TestRenderer.ReactTestInstance | null {
  let element: TestRenderer.ReactTestInstance | null = null;
  for (let up: TestRenderer.ReactTestInstance | null = node; up; up = up.parent) if (isAccessibilityElement(up)) element = up;
  return element;
}

/** A VoiceOver double-tap on `control`: it presses the element the control is read as. */
export async function activate(control: TestRenderer.ReactTestInstance): Promise<void> {
  const element = screenReaderElement(control);
  if (!element) throw new Error('A screen reader cannot reach this control');
  await press(element);
}

/** Advance only a named timeout, leaving promise settlement to React.act. */
export function captureTimeouts() {
  const originalSet = globalThis.setTimeout;
  const originalClear = globalThis.clearTimeout;
  let next = 0;
  const pending = new Map<number, { callback: () => void; delay: number }>();
  globalThis.setTimeout = ((callback: () => void, delay: number) => {
    const id = ++next;
    pending.set(id, { callback, delay });
    return id;
  }) as unknown as typeof setTimeout;
  globalThis.clearTimeout = ((id: number) => { pending.delete(id); }) as unknown as typeof clearTimeout;
  return {
    count: (delay: number) => [...pending.values()].filter(timer => timer.delay === delay).length,
    fire: (delay: number) => {
      const matches = [...pending].filter(([, timer]) => timer.delay === delay);
      if (!matches.length) throw new Error(`No pending ${delay}ms timeout`);
      for (const [id, timer] of matches) { pending.delete(id); timer.callback(); }
    },
    restore: () => { globalThis.setTimeout = originalSet; globalThis.clearTimeout = originalClear; },
  };
}
