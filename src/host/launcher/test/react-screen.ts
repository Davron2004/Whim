import React from 'react';
import TestRenderer from 'react-test-renderer';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

export async function renderScreen(element: React.ReactElement): Promise<TestRenderer.ReactTestRenderer> {
  let tree!: TestRenderer.ReactTestRenderer;
  await TestRenderer.act(async () => { tree = TestRenderer.create(element); });
  return tree;
}
export async function unmountScreen(tree: TestRenderer.ReactTestRenderer): Promise<void> {
  await TestRenderer.act(async () => tree.unmount());
}
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
