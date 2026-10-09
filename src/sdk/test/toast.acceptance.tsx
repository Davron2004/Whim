// Node acceptance suite for `toast(text)` (docs/design/system.md §7.2: module-level like `nav`, a
// capsule above the orb's footprint, 4 s, a second call replaces the first, ignored during first
// render, announced politely). In-page UI: it posts nothing to the host. Auto-discovered by
// `src/sdk/test/run.mjs`; the app runs inside `NavRoot`, the root the trusted loader mounts.
import assert from 'node:assert';
import * as React from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import * as publicSdk from '../index';
import { Button, Screen, toast, useEffect, type AppSpec } from '../index';
import { NavRoot } from '../navigation';
import { installFakeClock } from './fake-clock';

const posted: unknown[] = [];
Object.defineProperty(globalThis, 'window', {
  configurable: true,
  value: {
    __whimGeneration: 1,
    parent: { postMessage(message: unknown): void { posted.push(message); } },
    addEventListener(): void {},
    removeEventListener(): void {},
  },
});
(globalThis as { ReactNativeWebView?: unknown }).ReactNativeWebView = { postMessage(message: unknown): void { posted.push(message); } };
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

assert.ok(typeof publicSdk.toast === 'function', 'vc-sdk exports toast');
assert.ok(!('ToastHost' in publicSdk), 'the toast host is not public');

// ── Without a mounted app, a toast is a harmless no-op ────────────────────────
toast('nobody is listening');

function Home(): React.ReactElement {
  // Both first-render paths an app might take: during render and in a mount effect.
  toast('during render');
  useEffect(() => toast('in a mount effect'), []);
  return (
    <Screen>
      <Button label="Save" onPress={() => toast('Saved')} />
    </Screen>
  );
}
const spec: AppSpec = { name: 'Toast acceptance', initial: 'Home', screens: { Home }, capabilities: [] };

function shown(root: ReactTestInstance): string[] {
  return root.findAll((node) => node.type === 'div' && node.props.role === 'status').map((node) => node.children.join(''));
}

const clock = installFakeClock();
try {
  let renderer: ReactTestRenderer | undefined;
  act(() => {
    renderer = create(<NavRoot spec={spec} chromeInsetBottom={84} />);
  });
  const root = (): ReactTestInstance => renderer!.root;

  // ── First render is ignored ───────────────────────────────────────────────
  assert.deepStrictEqual(shown(root()), [], 'toasts from the first render and its effects are ignored');

  // ── A toast after mount shows, announced politely, above the orb ──────────
  const postedBefore = posted.length;
  act(() => toast('Saved'));
  assert.deepStrictEqual(shown(root()), ['Saved'], 'a toast after mount shows its text');
  const status = root().find((node) => node.props.role === 'status');
  assert.deepStrictEqual(status.props['aria-live'], 'polite', 'it is announced politely');
  const bottom = Number.parseFloat(String(status.props.style.bottom));
  assert.ok(status.props.style.position === 'fixed' && bottom > 84, `it floats above the 84 px the orb covers (bottom ${status.props.style.bottom})`);
  assert.deepStrictEqual(posted.length, postedBefore, 'showing a toast posts nothing to the host');

  // ── It lasts 4 s ──────────────────────────────────────────────────────────
  act(() => clock.advance(3999));
  assert.deepStrictEqual(shown(root()), ['Saved'], 'still up just before 4 s');
  act(() => clock.advance(1));
  assert.deepStrictEqual(shown(root()), [], 'gone at 4 s');

  // ── A second call replaces the first and gets its own 4 s ─────────────────
  act(() => toast('First'));
  act(() => clock.advance(3000));
  act(() => toast('Second'));
  assert.deepStrictEqual(shown(root()), ['Second'], 'the second toast replaces the first, never stacks');
  act(() => clock.advance(3000));
  assert.deepStrictEqual(shown(root()), ['Second'], 'the replacement is not cut short by the first one\'s timer');
  act(() => clock.advance(1000));
  assert.deepStrictEqual(shown(root()), [], 'and leaves 4 s after it was shown');

  // ── From an event handler, the usual path ─────────────────────────────────
  act(() => root().find((node) => node.type === 'button').props.onClick());
  assert.deepStrictEqual(shown(root()), ['Saved'], 'a button handler can toast');

  // ── Blank text shows nothing ──────────────────────────────────────────────
  act(() => clock.advance(4000));
  act(() => toast('   '));
  assert.deepStrictEqual(shown(root()), [], 'a blank toast is ignored');

  // ── Unmounting (a realm reset) leaves no timer and no listener ────────────
  act(() => toast('Pending'));
  act(() => renderer!.unmount());
  assert.deepStrictEqual(clock.pending(), 0, 'no toast timer outlives the app');
  toast('after unmount');
} finally {
  clock.restore();
}

console.log('SDK toast acceptance: PASS');
