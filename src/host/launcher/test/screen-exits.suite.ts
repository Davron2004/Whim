/**
 * screen-exits Node suite (tasks 1.1, 1.4, 1.5) — locks the pure system-back seam
 * (`bindSystemBack`), the root frame's safe-area edges (`frameEdgesFor`), and `ScreenBoundary`'s
 * `onLeave` pass-through (design D7/D9/D10; spec launcher-screen-exits "System back and the
 * visible control perform the same action", "Controls at the bottom of a screen clear the bottom
 * system area"). `ScreenBoundary` is React Native-free, so it is REALLY RENDERED here with
 * `react-test-renderer`, the idiom `observability-ui.suite.ts` established.
 *
 * The gate scanner over `SCREEN_EXITS` (design D8; spec launcher-screen-exits "A screen without a
 * declared exit fails the fast gate") is chain-3's, once every screen has moved onto the seam.
 */
import React from 'react';
import TestRenderer from 'react-test-renderer';
import { Harness } from './harness';
import { bindSystemBack } from '../system-back';
import type { BackHandlerLike } from '../system-back';
import { frameEdgesFor } from '../screen-exits';
import type { ScreenKind } from '../screen-exits';
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

  await h.test('bindSystemBack: registers exactly one listener across three handler swaps', () => {
    const fake = fakeBackHandler();
    let current: (() => void) | null = () => {};
    bindSystemBack(fake.api, () => current);
    h.eq(fake.registrations(), 1, 'one registration at bind time');

    current = () => {};
    current = () => {};
    current = () => {};
    h.eq(fake.registrations(), 1, 'swapping the handler three times registers no new listener');
  });

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

  await h.test('bindSystemBack: the returned unsubscribe removes the listener', () => {
    const fake = fakeBackHandler();
    const unsubscribe = bindSystemBack(fake.api, () => null);
    h.ok(!fake.removed(), 'not removed before unsubscribe is called');
    unsubscribe();
    h.ok(fake.removed(), 'unsubscribe removes the underlying listener');
  });

  // ── frameEdgesFor (design D10) ───────────────────────────────────────────────

  const ALL_KINDS: readonly ScreenKind[] = [
    'home',
    'app',
    'dev',
    'settings',
    'history',
    'link-missing',
    'consent',
    'compose',
    'clarify',
    'plan',
    'build',
    'done',
    'failure',
  ];

  for (const kind of ALL_KINDS) {
    const expected = kind === 'app' || kind === 'dev' ? ['top'] : ['top', 'bottom'];
    await h.test(`frameEdgesFor: ${kind} gets ${JSON.stringify(expected)}`, () => {
      h.eq(frameEdgesFor(kind), expected, `${kind}'s root frame applies exactly these safe-area edges`);
    });
  }

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

  await h.test('boundary: invoking the passed-through onLeave calls the spy exactly once', () => {
    let calls = 0;
    const onLeave = () => {
      calls++;
    };
    let received: (() => void) | undefined;
    const Fallback = (props: Readonly<ScreenFallbackProps>) => {
      received = props.onLeave;
      return React.createElement('fallback');
    };

    let tree: TestRenderer.ReactTestRenderer | undefined;
    TestRenderer.act(() => {
      tree = TestRenderer.create(
        React.createElement(
          ScreenBoundary,
          { screen: 'onleave-invoked', FallbackComponent: Fallback, onLeave },
          React.createElement(controlledChild({ throws: true })),
        ),
      );
    });
    TestRenderer.act(() => received!());
    h.eq(calls, 1, 'the fallback’s call to onLeave reaches the exact function the boundary was given, once');
    TestRenderer.act(() => tree!.unmount());
  });

  await h.test('boundary: a changed screen still resets the boundary with onLeave given', () => {
    const onLeave = () => {};
    const Fallback = () => React.createElement('fallback');

    let tree: TestRenderer.ReactTestRenderer | undefined;
    TestRenderer.act(() => {
      tree = TestRenderer.create(
        React.createElement(
          ScreenBoundary,
          { screen: 'screen-a', FallbackComponent: Fallback, onLeave },
          React.createElement(controlledChild({ throws: true })),
        ),
      );
    });
    h.eq((tree!.toJSON() as { type: string }).type, 'fallback', 'screen-a is in its error state');

    TestRenderer.act(() => {
      tree!.update(
        React.createElement(
          ScreenBoundary,
          { screen: 'screen-b', FallbackComponent: Fallback, onLeave },
          React.createElement('ok'),
        ),
      );
    });
    h.eq((tree!.toJSON() as { type: string }).type, 'ok', 'the changed reset key still clears the error state with onLeave given');
    TestRenderer.act(() => tree!.unmount());
  });
}
