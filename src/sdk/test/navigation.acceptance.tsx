import * as React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { NavRoot, nav, type AppSpec } from '../index';

type MessageListener = (event: { data: unknown }) => void;

function fail(message: string): never {
  throw new Error(message);
}

function equal(actual: unknown, expected: unknown): void {
  if (actual !== expected) fail(`expected ${String(expected)}, received ${String(actual)}`);
}

function deepEqual(actual: unknown, expected: unknown): void {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) fail(`expected ${expectedJson}, received ${actualJson}`);
}

function match(actual: string, expected: RegExp): void {
  if (!expected.test(actual)) fail(`expected ${JSON.stringify(actual)} to match ${String(expected)}`);
}

const posted: string[] = [];
const messageListeners = new Set<MessageListener>();

const testWindow = {
  __whimGeneration: 7,
  parent: {
    postMessage(message: string): void {
      posted.push(message);
    },
  },
  addEventListener(type: string, listener: MessageListener): void {
    if (type === 'message') messageListeners.add(listener);
  },
  removeEventListener(type: string, listener: MessageListener): void {
    if (type === 'message') messageListeners.delete(listener);
  },
};

Object.defineProperty(globalThis, 'window', {
  configurable: true,
  value: testWindow,
});
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Home(): React.ReactElement {
  return React.createElement('span', null, 'Home');
}

function Details(): React.ReactElement {
  return React.createElement('span', null, 'Details');
}

const spec: AppSpec = {
  name: 'Navigation acceptance',
  initial: 'Home',
  screens: { Home, Details },
  capabilities: [],
};

function renderedText(renderer: ReactTestRenderer): string {
  const tree = renderer.toJSON();
  if (tree === null || Array.isArray(tree)) fail('expected one rendered host element');
  return String(tree.children?.[0]);
}

function depthFrames(): Array<{ __whimNavDepth: true; depth: number; generation: number }> {
  return posted.map((message) => JSON.parse(message));
}

let renderer: ReactTestRenderer;
await act(async () => {
  renderer = create(React.createElement(NavRoot, { spec }));
});

equal(renderedText(renderer!), 'Home');
deepEqual(depthFrames(), [{ __whimNavDepth: true, depth: 0, generation: 7 }]);

await act(async () => nav.navigate('Details'));
equal(renderedText(renderer!), 'Details');
deepEqual(depthFrames().map((frame) => frame.depth), [0, 1]);

await act(async () => nav.navigate('Details'));
equal(renderedText(renderer!), 'Details');
deepEqual(depthFrames().map((frame) => frame.depth), [0, 1, 2]);

await act(async () => nav.back());
equal(renderedText(renderer!), 'Details');
deepEqual(depthFrames().map((frame) => frame.depth), [0, 1, 2, 1]);

await act(async () => {
  for (const listener of messageListeners) {
    listener({ data: { __whimNavBack: true } });
  }
});
equal(renderedText(renderer!), 'Home');
deepEqual(depthFrames().map((frame) => frame.depth), [0, 1, 2, 1, 0]);

const warnings: unknown[][] = [];
const originalWarn = console.warn;
console.warn = (...args: unknown[]) => warnings.push(args);
try {
  await act(async () => nav.navigate('Missing'));
} finally {
  console.warn = originalWarn;
}
equal(renderedText(renderer!), 'Home');
equal(depthFrames().length, 5);
equal(warnings.length, 1);
match(String(warnings[0]?.[0]), /Missing/);
match(String(warnings[0]?.[0]), /Home/);
match(String(warnings[0]?.[0]), /Details/);

await act(async () => nav.back());
equal(renderedText(renderer!), 'Home');
equal(depthFrames().length, 5);

await act(async () => {
  for (const listener of messageListeners) {
    listener({ data: { __whimNavBack: true } });
  }
});
equal(renderedText(renderer!), 'Home');
equal(depthFrames().length, 5);

await act(async () => renderer!.unmount());
equal(messageListeners.size, 0);

console.log('SDK navigation acceptance: PASS');
