/**
 * observability-ui acceptance (obs-v1 chain-C; host-observability "Every screen renders inside a
 * recoverable error boundary" + "The dev log overlay reads the ring buffer and cannot reach a
 * shipping build"; app-launcher "Production builds hide developer diagnostics surfaces").
 *
 * `ScreenBoundary` is deliberately free of `react-native`, so it is REALLY RENDERED here with
 * `react-test-renderer` (the launcher runner bundles the whole graph and cannot bundle React
 * Native): the throwing child, the report-before-render ordering, retry and the reset key are
 * behavioural checks, not source greps. The overlay's ordering/filtering/gate live in the equally
 * RN-free `dev-log-view.ts` and are exercised the same way. The error screen, the overlay and the
 * launcher shell around a failing screen are rendered too.
 *
 * Nothing here awaits a promise that could fail to settle — a bare `await` on a pending promise
 * turns one failed check into a whole-suite hang with no test named.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import React from 'react';
import TestRenderer from 'react-test-renderer';
import { Harness } from './harness';
import { COPY } from '../copy';
import ScreenBoundary from '../ScreenBoundary';
import ScreenErrorFallback from '../ScreenErrorFallback';
import DevLogOverlay from '../DevLogOverlay';
import HomeScreen from '../HomeScreen';
import { PendingBuildStore } from '../pending-builds';
import { JOURNAL_KEY } from '../run-journal';
import { withLauncher } from './rendered-launcher';
import { button, press, textOf } from './react-screen';
import type { ScreenFallbackProps } from '../ScreenBoundary';
import {
  ALL_CHANNELS_FILTER,
  DEFAULT_DEV_LOG_FILTER,
  SHOW_DEV_LOG_OVERLAY,
  devLogOverlayEnabled,
  formatFields,
  formatRecordTime,
  visibleRecords,
} from '../dev-log-view';
import { log } from '../../logging';
import { CHANNELS } from '../../logging/channels';
import { LogRing } from '../../logging/ring-buffer';
import type { DevLogRecord } from '@whim/contract';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function readSource(file: string): string {
  return fs.readFileSync(path.join(process.cwd(), file), 'utf8');
}

/** Records the seam holds for one screen identifier. */
function recordsFor(screen: string): DevLogRecord[] {
  return log.buffer
    .snapshot()
    .filter(r => r.channel === CHANNELS.screen && r.fields.screen === screen) as DevLogRecord[];
}

/**
 * A child that throws while `control.throws` is set and renders `<ok/>` once it is cleared.
 * Deliberately NOT "throws on the first render": React 19 retries a failed render once before it
 * gives up on the subtree, so a render-counting child would recover inside React's own retry and
 * the boundary would never be reached.
 */
function controlledChild(control: { throws: boolean }): () => React.ReactElement {
  return function Child(): React.ReactElement {
    if (control.throws) throw new TypeError('screen exploded');
    return React.createElement('ok');
  };
}

function record(at: number, level: DevLogRecord['level'], channel: string, message: string): DevLogRecord {
  return { at, level, channel, message, fields: {} };
}

export async function runObservabilityUiTests(h: Harness): Promise<void> {
  // ── the boundary, really rendered ───────────────────────────────────────────

  await h.test('boundary: a throwing screen renders the fallback, and the shell around it survives', () => {
    const screen = 'boundary-catches';
    const Fallback = (props: Readonly<ScreenFallbackProps>) =>
      React.createElement('fallback', { screen: props.screen });

    let tree: TestRenderer.ReactTestRenderer | undefined;
    TestRenderer.act(() => {
      tree = TestRenderer.create(
        React.createElement(
          'shell',
          null,
          React.createElement(
            ScreenBoundary,
            { screen, FallbackComponent: Fallback },
            React.createElement(controlledChild({ throws: true })),
          ),
        ),
      );
    });

    const json = tree!.toJSON() as { type: string; children: { type: string; props: Record<string, unknown> }[] };
    h.eq(json.type, 'shell', 'the tree around the boundary is not unmounted');
    h.eq(json.children.length, 1, 'the boundary rendered exactly one child in place of the screen');
    h.eq(json.children[0].type, 'fallback', 'the recoverable error screen replaced the failed screen');
    h.eq(json.children[0].props.screen, screen, 'the fallback is told which screen failed');
    TestRenderer.act(() => tree!.unmount());
  });

  await h.test('boundary: the report reaches the seam BEFORE the fallback renders', () => {
    const screen = 'boundary-reports-first';
    let seenAtFallbackRender: DevLogRecord[] = [];
    const Fallback = () => {
      seenAtFallbackRender = recordsFor(screen);
      return React.createElement('fallback');
    };

    let tree: TestRenderer.ReactTestRenderer | undefined;
    TestRenderer.act(() => {
      tree = TestRenderer.create(
        React.createElement(
          ScreenBoundary,
          { screen, FallbackComponent: Fallback },
          React.createElement(controlledChild({ throws: true })),
        ),
      );
    });

    h.eq(seenAtFallbackRender.length, 1, 'the record was already in the buffer when the fallback rendered');
    const reported = seenAtFallbackRender[0];
    h.eq(reported.level, 'error', 'reported at error level');
    h.eq(reported.channel, CHANNELS.screen, 'reported on the screen channel');
    h.eq(reported.fields.errorClass, 'TypeError', 'the error class is carried as a field');
    h.eq(reported.fields.detail, 'screen exploded', 'the message is carried as a field');
    h.ok(typeof reported.fields.stack === 'string' && (reported.fields.stack as string).length > 0, 'the stack is carried as a field');
    h.eq(recordsFor(screen).length, 1, 'one caught error is reported exactly once, not once per render');
    TestRenderer.act(() => tree!.unmount());
  });

  await h.test('boundary: retry remounts the failed subtree, and a transient failure then renders', () => {
    const screen = 'boundary-retry';
    let retry: (() => void) | undefined;
    const Fallback = (props: Readonly<ScreenFallbackProps>) => {
      retry = props.resetErrorBoundary;
      return React.createElement('fallback');
    };
    const control = { throws: true };
    const Child = controlledChild(control);

    let tree: TestRenderer.ReactTestRenderer | undefined;
    TestRenderer.act(() => {
      tree = TestRenderer.create(
        React.createElement(ScreenBoundary, { screen, FallbackComponent: Fallback }, React.createElement(Child)),
      );
    });
    h.eq((tree!.toJSON() as { type: string }).type, 'fallback', 'the failed screen shows the error screen first');
    h.eq(recordsFor(screen).length, 1, 'the first failure is reported once');

    // Retry into the SAME failure: a fresh attempt that fails again is a second failure, and the
    // report-once rule must not swallow it.
    TestRenderer.act(() => retry!());
    h.eq((tree!.toJSON() as { type: string }).type, 'fallback', 'a screen that fails again stays on the error screen');
    h.eq(recordsFor(screen).length, 2, 'the second, identical failure is reported too');

    control.throws = false; // the failure was transient
    TestRenderer.act(() => retry!());
    h.eq((tree!.toJSON() as { type: string }).type, 'ok', 'after retry the screen is mounted again and renders');
    TestRenderer.act(() => tree!.unmount());
  });

  await h.test('boundary: a changed reset key clears the error state without a retry tap', () => {
    const Fallback = () => React.createElement('fallback');
    const failing = controlledChild({ throws: true });

    let tree: TestRenderer.ReactTestRenderer | undefined;
    TestRenderer.act(() => {
      tree = TestRenderer.create(
        React.createElement(
          ScreenBoundary,
          { screen: 'screen-a', FallbackComponent: Fallback },
          React.createElement(failing),
        ),
      );
    });
    h.eq((tree!.toJSON() as { type: string }).type, 'fallback', 'screen-a is in its error state');

    // Navigate away: a different screen identifier, and a screen that does not throw.
    TestRenderer.act(() => {
      tree!.update(
        React.createElement(
          ScreenBoundary,
          { screen: 'screen-b', FallbackComponent: Fallback },
          React.createElement('ok'),
        ),
      );
    });
    h.eq((tree!.toJSON() as { type: string }).type, 'ok', 'the changed reset key cleared the error state');
    TestRenderer.act(() => tree!.unmount());
  });

  await h.test('boundary: a screen that does not throw is passed through untouched (non-vacuity control)', () => {
    const screen = 'boundary-happy';
    const Fallback = () => React.createElement('fallback');
    let tree: TestRenderer.ReactTestRenderer | undefined;
    TestRenderer.act(() => {
      tree = TestRenderer.create(
        React.createElement(ScreenBoundary, { screen, FallbackComponent: Fallback }, React.createElement('ok')),
      );
    });
    h.eq((tree!.toJSON() as { type: string }).type, 'ok', 'the screen renders itself');
    h.eq(recordsFor(screen).length, 0, 'nothing is reported when nothing fails');
    TestRenderer.act(() => tree!.unmount());
  });

  // ── the error screen, rendered ──────────────────────────────────────────────

  await h.test('error screen: plain words and a retry, and the thrown error never reaches the surface', () => {
    const control = { throws: true };
    let tree: TestRenderer.ReactTestRenderer | undefined;
    TestRenderer.act(() => {
      tree = TestRenderer.create(
        React.createElement(ScreenBoundary, { screen: 'sentinel-screen', FallbackComponent: ScreenErrorFallback },
          React.createElement(function Child(): React.ReactElement {
            if (control.throws) throw new TypeError('SENTINEL_BOOM at renderRow (HomeScreen.tsx:42)');
            return React.createElement('ok');
          })),
      );
    });
    const shown = textOf(tree!.root);
    h.ok(shown.includes(COPY.screenErrorTitle) && shown.includes(COPY.screenErrorBody), 'the fallback shows its plain-words title and body');
    h.ok(!shown.includes('SENTINEL') && !shown.includes('HomeScreen.tsx'), 'the thrown message and its location never render');
    for (const text of [COPY.screenErrorTitle, COPY.screenErrorBody, COPY.screenErrorRetry]) {
      h.ok(!/\b(stack|exception|undefined|null|render)\b/i.test(text), `"${text}" stays plain English`);
    }
    control.throws = false;
    TestRenderer.act(() => { button(tree!, COPY.screenErrorRetry).props.onPress(); });
    h.eq(tree!.root.findAll((n) => n.type === 'ok').length, 1, 'Retry remounts the screen');
    TestRenderer.act(() => tree!.unmount());
  });

  // ── the overlay: what it lists, and what it filters ─────────────────────────

  await h.test('overlay: lists everything the buffer holds, newest-first', () => {
    const ring = new LogRing(10);
    ring.push(record(1, 'debug', CHANNELS.app, 'first'));
    ring.push(record(2, 'info', CHANNELS.gen, 'second'));
    ring.push(record(3, 'error', CHANNELS.screen, 'third'));

    const rows = visibleRecords(ring.snapshot());
    h.eq(rows.map(r => r.message), ['third', 'second', 'first'], 'newest-first, nothing missing');
    h.eq(rows.map(r => `${r.level}/${r.channel}`), ['error/whim:screen', 'info/whim:gen', 'debug/whim'], 'each row carries its level and channel');
  });

  await h.test('overlay: filtering narrows without mutating, and clearing restores the full list', () => {
    const ring = new LogRing(10);
    ring.push(record(1, 'debug', CHANNELS.app, 'app one'));
    ring.push(record(2, 'warn', CHANNELS.gen, 'gen one'));
    ring.push(record(3, 'error', CHANNELS.app, 'app two'));
    const snapshot = ring.snapshot();
    const before = snapshot.map(r => r.message);

    const onlyGen = visibleRecords(snapshot, { channel: CHANNELS.gen, minLevel: 'debug' });
    h.eq(onlyGen.map(r => r.message), ['gen one'], 'only the chosen channel is listed');

    const warnAndAbove = visibleRecords(snapshot, { channel: ALL_CHANNELS_FILTER, minLevel: 'warn' });
    h.eq(warnAndAbove.map(r => r.message), ['app two', 'gen one'], 'the minimum-level filter hides quieter records');

    h.eq(snapshot.map(r => r.message), before, 'the snapshot itself was never reordered or filtered in place');
    h.eq(
      visibleRecords(snapshot, DEFAULT_DEV_LOG_FILTER).map(r => r.message),
      ['app two', 'gen one', 'app one'],
      'clearing the filter restores the full list unchanged',
    );
  });

  await h.test('overlay: a row shows its time and its structured fields', () => {
    h.eq(formatRecordTime(Date.UTC(2026, 7, 8, 9, 30, 15, 250)), '09:30:15.250', 'timestamps render as HH:MM:SS.mmm');
    h.eq(formatFields({}), '', 'a record with no fields adds no field line');
    h.eq(formatFields({ screen: 'home', tries: 2 }), 'screen=home · tries=2', 'fields render as name=value');
  });

  // ── the gate ────────────────────────────────────────────────────────────────

  await h.test('overlay gate: __DEV__ OR the explicit flag — and the flag ships false', () => {
    h.eq(SHOW_DEV_LOG_OVERLAY, false, 'the build-time flag defaults to false, so a shipping build has no overlay');
    h.eq(devLogOverlayEnabled(false, false), false, 'both gates off: unreachable');
    h.eq(devLogOverlayEnabled(true, false), true, 'reachable under a debug build');
    h.eq(devLogOverlayEnabled(false, true), true, 'reachable in a locally-built RELEASE apk with the flag on');
    h.eq(devLogOverlayEnabled(false), false, 'the committed default is what an unqualified call gets');
  });

  await h.test('overlay: in a build with __DEV__ off and the flag off, the overlay renders nothing even when asked to open', () => {
    const ring = new LogRing(10);
    ring.push(record(1, 'error', CHANNELS.app, 'SENTINEL_LOG_LINE'));
    let tree: TestRenderer.ReactTestRenderer | undefined;
    TestRenderer.act(() => { tree = TestRenderer.create(React.createElement(DevLogOverlay, { visible: true, onClose: () => {}, buffer: ring })); });
    h.ok(tree!.toJSON() === null, 'nothing is rendered');
    TestRenderer.act(() => tree!.unmount());
  });

  await h.test('launcher: a screen that throws is replaced by the error screen inside the shell, whose way out returns Home; no log affordance ships', async () => {
    // A failed build whose persisted journal is corrupt (a terminal entry whose hints are not a
    // list): opening its ghost renders a failure screen that throws while drawing the timeline.
    await withLauncher({
      prepare: (kv) => {
        const pending = new PendingBuildStore(kv);
        pending.create({ id: 'broken', prompt: 'A tea timer', workingTitle: 'Tea timer' });
        pending.setFailed('broken', { reason: 'It did not build.', diagnostics: '' });
        kv.set(JOURNAL_KEY('broken'), JSON.stringify([{ t: 1, kind: 'terminal', failure: { reason: 'It did not build.', diagnostics: 5 } }]));
      },
      server: () => new Response('{}'),
    }, async ({ tree }) => {
      h.eq(tree.root.findAll((n) => n.props.accessibilityLabel === 'Logs').length, 0, 'the developer log affordance is not in a shipping shell');
      h.eq(tree.root.findAllByType(DevLogOverlay).length, 0, 'nor is the overlay');
      const ghost = tree.root.findByType(HomeScreen).props.pending[0];
      await TestRenderer.act(async () => tree.root.findByType(HomeScreen).props.onOpenPending(ghost));
      const fallback = tree.root.findAllByType(ScreenErrorFallback);
      h.eq(fallback.length, 1, 'the error screen replaces the failed screen');
      const frame = tree.root.find((n) => n.type === 'SafeAreaView');
      h.ok(frame.findAllByType(ScreenErrorFallback).length === 1, 'inside the shell’s safe-area frame, which survives');
      await press(button(tree, COPY.screenErrorBack));
      h.eq(tree.root.findAllByType(HomeScreen).length, 1, 'its way out returns Home');
      h.eq(tree.root.findAllByType(ScreenErrorFallback).length, 0, 'and Home renders normally');
    });
  });

  // ── review fix F9: no developer diagnostics surface is gated on __DEV__ alone ────────────────
  // decision #60(c) / app-launcher "Production builds hide developer diagnostics surfaces": every
  // `__DEV__` in launcher source must be the sole argument of a gate call (`devLogOverlayEnabled`
  // today), never a bare condition — this project ships RELEASE builds where `__DEV__` is false,
  // and a bare `__DEV__ ? a : b` reaches production with no build-time flag to override it.
  function withoutComments(text: string): string {
    return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  }

  function bareDevFlag(text: string): boolean {
    const gated = text.replace(/\w\(__DEV__\)/g, '');
    return /__DEV__/.test(gated);
  }

  await h.test('gate (non-vacuity): the bare-__DEV__ scan tells a gated read from a bare condition', () => {
    h.ok(!bareDevFlag('gate(__DEV__)'), 'a gate call must not fire the scan');
    h.ok(bareDevFlag('__DEV__ ? a : b'), 'a bare conditional must fire the scan');
  });

  await h.test('gate: LauncherRoot.tsx never reads __DEV__ outside a gate call', () => {
    const src = withoutComments(readSource('src/host/launcher/LauncherRoot.tsx'));
    const hits: number[] = [];
    src.split('\n').forEach((line, i) => {
      if (bareDevFlag(line)) hits.push(i + 1);
    });
    h.eq(hits, [], 'every __DEV__ read in LauncherRoot.tsx must be the sole argument of a gate call, e.g. devLogOverlayEnabled(__DEV__)');
  });
}
