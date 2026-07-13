import * as React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import type { AppSpec } from '../index';
import * as publicSdk from '../index';
import { NavRoot, nav } from '../navigation';

type MessageListener = (event: { data: unknown; source?: unknown }) => void;

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

function publicSdkMustNotAcceptHostRootProps(
  // @ts-expect-error NavRootProps is repository-internal and must never be public vc-sdk API.
  props: import('vc-sdk').NavRootProps,
): unknown {
  return props;
}

equal(Object.prototype.hasOwnProperty.call(publicSdk, 'NavRoot'), false);
equal(Object.prototype.hasOwnProperty.call(publicSdk, 'NavRootProps'), false);
equal(typeof publicSdkMustNotAcceptHostRootProps, 'function');

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
    listener({ data: JSON.stringify({ __whimNavBack: true }), source: testWindow.parent });
  }
});
equal(renderedText(renderer!), 'Home');
deepEqual(depthFrames().map((frame) => frame.depth), [0, 1, 2, 1, 0]);

await act(async () => nav.navigate('Details'));
equal(renderedText(renderer!), 'Details');
deepEqual(depthFrames().map((frame) => frame.depth), [0, 1, 2, 1, 0, 1]);

await act(async () => {
  for (const listener of messageListeners) {
    listener({ data: '{', source: testWindow.parent });
    listener({ data: JSON.stringify(null), source: testWindow.parent });
    listener({ data: JSON.stringify(1), source: testWindow.parent });
    listener({ data: JSON.stringify([]), source: testWindow.parent });
    listener({ data: { __whimNavBack: true }, source: testWindow.parent });
    listener({ data: JSON.stringify({ __whimNavBack: false }), source: testWindow.parent });
    listener({ data: JSON.stringify({ unrelated: true }), source: testWindow.parent });
  }
});
equal(renderedText(renderer!), 'Details');
deepEqual(depthFrames().map((frame) => frame.depth), [0, 1, 2, 1, 0, 1]);

// Sender-origin guard: a __whimNavBack frame whose source is not window.parent (e.g. forged by
// a bundle sharing the realm, or the frame's own window) must be ignored, not popped.
await act(async () => {
  for (const listener of messageListeners) {
    listener({ data: JSON.stringify({ __whimNavBack: true }), source: testWindow });
    listener({ data: JSON.stringify({ __whimNavBack: true }), source: {} });
    listener({ data: JSON.stringify({ __whimNavBack: true }) });
  }
});
equal(renderedText(renderer!), 'Details');
deepEqual(depthFrames().map((frame) => frame.depth), [0, 1, 2, 1, 0, 1]);

await act(async () => {
  for (const listener of messageListeners) {
    listener({
      data: JSON.stringify({ __whimNavBack: true, futureField: 'ignored' }),
      source: testWindow.parent,
    });
  }
});
equal(renderedText(renderer!), 'Home');
deepEqual(depthFrames().map((frame) => frame.depth), [0, 1, 2, 1, 0, 1, 0]);

const warnings: unknown[][] = [];
const originalWarn = console.warn;
console.warn = (...args: unknown[]) => warnings.push(args);
try {
  await act(async () => nav.navigate('Missing'));
} finally {
  console.warn = originalWarn;
}
equal(renderedText(renderer!), 'Home');
equal(depthFrames().length, 7);
equal(warnings.length, 1);
match(String(warnings[0]?.[0]), /Missing/);
match(String(warnings[0]?.[0]), /Home/);
match(String(warnings[0]?.[0]), /Details/);

await act(async () => nav.back());
equal(renderedText(renderer!), 'Home');
equal(depthFrames().length, 7);

await act(async () => {
  for (const listener of messageListeners) {
    listener({ data: JSON.stringify({ __whimNavBack: true }), source: testWindow.parent });
  }
});
equal(renderedText(renderer!), 'Home');
equal(depthFrames().length, 7);

await act(async () => renderer!.unmount());
equal(messageListeners.size, 0);

console.log('SDK navigation acceptance: PASS');
