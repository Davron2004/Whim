/** System-back lifetime, boundary recovery, safe-area policy and rendered exit controls. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import React from 'react';
import TestRenderer from 'react-test-renderer';
import { Harness } from './harness';
import { bindSystemBack } from '../system-back';
import type { BackHandlerLike } from '../system-back';
import { useSystemBackWith } from '../use-system-back-with';
import ScreenBoundary from '../ScreenBoundary';
import type { ScreenFallbackProps } from '../ScreenBoundary';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** A fake `BackHandlerLike`: records how many times it was registered, captures the live
 *  listener so a test can fire it, and tracks whether `remove()` was called. */
function fakeBackHandler(): {
  api: BackHandlerLike;
  registrations: () => number;
  fire: () => boolean;
  removed: () => boolean;
} {
  let listener: (() => boolean) | null = null;
  let registrations = 0;
  let removed = false;
  const api: BackHandlerLike = {
    addEventListener(_eventType, l) {
      registrations++;
      listener = l;
      return {
        remove: () => {
          removed = true;
        },
      };
    },
  };
  return {
    api,
    registrations: () => registrations,
    fire: () => listener!(),
    removed: () => removed,
  };
}

function controlledChild(control: { throws: boolean }): () => React.ReactElement {
  return function Child(): React.ReactElement {
    if (control.throws) throw new TypeError('screen exploded');
    return React.createElement('ok');
  };
}

export async function runScreenExitsTests(h: Harness): Promise<void> {
  // ── bindSystemBack (design D9) ──────────────────────────────────────────────

  await h.test('bindSystemBack: always runs the LATEST handler, not the one live at bind time', () => {
    const calls: string[] = [];
    let current: (() => void) | null = () => calls.push('first');
    const fake = fakeBackHandler();
    bindSystemBack(fake.api, () => current);

    current = () => calls.push('second');
    fake.fire();
    h.eq(calls, ['second'], 'the handler current() resolves to NOW runs, not the one bound at mount');
  });

  await h.test('bindSystemBack: returns true with a handler, false with null', () => {
    let current: (() => void) | null = () => {};
    const fake = fakeBackHandler();
    bindSystemBack(fake.api, () => current);
    h.eq(fake.fire(), true, 'system back is handled when current() gives a handler');

    current = null;
    h.eq(fake.fire(), false, 'system back falls through to the platform default when current() is null');
  });

  // ── useSystemBackWith (design D9): the real once-per-mount / latest-handler contract, REALLY
  // rendered — the `[]` deps of its `useEffect` are what `use-system-back.ts` relies on, and no
  // fixed-count of a local variable reassignment can exercise a React re-render at all. ──────────

  await h.test('useSystemBackWith: three re-renders with three different handlers register exactly once', () => {
    const fake = fakeBackHandler();
    const calls: string[] = [];
    function Probe({ label }: Readonly<{ label: string }>) {
      useSystemBackWith(fake.api, () => calls.push(label));
      return React.createElement('probe');
    }

    let tree: TestRenderer.ReactTestRenderer | undefined;
    TestRenderer.act(() => {
      tree = TestRenderer.create(React.createElement(Probe, { label: 'first' }));
    });
    TestRenderer.act(() => tree!.update(React.createElement(Probe, { label: 'second' })));
    TestRenderer.act(() => tree!.update(React.createElement(Probe, { label: 'third' })));

    h.eq(fake.registrations(), 1, 'three re-renders with three different handler closures register only once');

    fake.fire();
    h.eq(calls, ['third'], 'system back runs the LATEST render’s handler, not the one live when the effect first ran');
    TestRenderer.act(() => tree!.unmount());
  });

  // ── ScreenBoundary onLeave pass-through (design D7) ──────────────────────────

  await h.test('boundary: a throwing screen with onLeave hands the fallback that exact function', () => {
    const onLeave = () => {};
    let seen: (() => void) | undefined;
    const Fallback = (props: Readonly<ScreenFallbackProps>) => {
      seen = props.onLeave;
      return React.createElement('fallback');
    };

    let tree: TestRenderer.ReactTestRenderer | undefined;
    TestRenderer.act(() => {
      tree = TestRenderer.create(
        React.createElement(
          ScreenBoundary,
          { screen: 'onleave-given', FallbackComponent: Fallback, onLeave },
          React.createElement(controlledChild({ throws: true })),
        ),
      );
    });
    h.ok(seen === onLeave, 'the fallback receives the exact onLeave function, unchanged');
    TestRenderer.act(() => tree!.unmount());
  });

  await h.test('boundary: a throwing screen with no onLeave hands the fallback none', () => {
    let seen: (() => void) | undefined = () => {};
    const Fallback = (props: Readonly<ScreenFallbackProps>) => {
      seen = props.onLeave;
      return React.createElement('fallback');
    };

    let tree: TestRenderer.ReactTestRenderer | undefined;
    TestRenderer.act(() => {
      tree = TestRenderer.create(
        React.createElement(
          ScreenBoundary,
          { screen: 'onleave-absent', FallbackComponent: Fallback },
          React.createElement(controlledChild({ throws: true })),
        ),
      );
    });
    h.eq(seen, undefined, 'with no onLeave prop given, the fallback gets none — Home stays Try again only');
    TestRenderer.act(() => tree!.unmount());
  });

  await h.test('native system-back subscriptions stay in the two platform adapters', () => {
    const dir = path.join(process.cwd(), 'src/host/launcher');
    for (const file of fs.readdirSync(dir)) {
      if (!/\.tsx?$/.test(file) || ['use-system-back.ts', 'useMiniAppHost.ts'].includes(file)) continue;
      const source = fs.readFileSync(path.join(dir, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
      h.ok(!/\bBackHandler\.addEventListener\s*\(/.test(source), `${file} uses the shared back adapter`);
    }
  });
}
