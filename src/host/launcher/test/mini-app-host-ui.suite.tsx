/** A rendered mini-app container (`MiniAppView` over `useMiniAppHost`) driven the way its WebView
 *  drives it: page-load events and frames from the sandbox page. Covers the boot surface and the
 *  startup deadline, which frames it trusts, delivering once per WebView mount, the recovery screen
 *  for a bundle that fails, launch refusal, and releasing the app's storage on unmount. */
import React from 'react';
import TestRenderer from 'react-test-renderer';
import { Harness } from './harness';
import { COPY } from '../copy';
import MiniAppView from '../MiniAppView';
import { STARTUP_DEADLINE_MS } from '../boot-state';
import type { InstalledApp } from '../app-index';
import type { StoreAccess } from '../store-access';
import type { AppRecord } from '../../bridge';
import { createStorageEngine } from '../../storage-engine';
import { DEFAULT_THEME } from '../../../sdk/theme';
import { APP_BUNDLES } from '../../../runtime/generated/app-bundles';
import { APP_RECORDS } from '../../../runtime/generated/app-records';
import { log } from '../../logging';
import { injectedScripts } from './native-host';
import { closedDatabases, resetNativeStorage } from './native-storage';
import { button, captureTimeouts, press, renderScreen, textOf, unmountScreen } from './react-screen';
import { grantedOptions } from './client-fixtures';

type Tree = TestRenderer.ReactTestRenderer;

const TIP: AppRecord = APP_RECORDS['tip-splitter'];
const WATER: AppRecord = APP_RECORDS['water-counter'];

interface Mounted {
  tree: Tree;
  exits: () => number;
  clock: ReturnType<typeof captureTimeouts>;
  webView: () => TestRenderer.ReactTestInstance | undefined;
  loadEnd: () => Promise<void>;
  frame: (frame: unknown) => Promise<void>;
  shown: () => string;
}

/** Mount the container for `record`, run `body`, and unmount. */
async function withMiniApp(record: AppRecord, body: (m: Mounted) => Promise<void>): Promise<void> {
  resetNativeStorage();
  injectedScripts.length = 0;
  const clock = captureTimeouts();
  let exits = 0;
  const app: InstalledApp = { id: record.appId, name: record.name, createdAt: 1, lineageId: 'main', record };
  const tree = await renderScreen(
    <MiniAppView
      record={record}
      bundleSource={APP_BUNDLES[record.appId]}
      engineAppId={record.appId}
      theme={DEFAULT_THEME}
      onExit={() => { exits++; }}
      onVersions={() => {}}
      onChangeIt={() => {}}
      installedApp={app}
      access={{} as StoreAccess}
      reportOptions={grantedOptions('https://server.test', 'device')}
      onUpdateRequired={() => {}}
      legalLanguage="en"
    />,
  );
  const webView = () => tree.root.findAll((n) => n.type === 'WebView')[0];
  try {
    await body({
      tree,
      exits: () => exits,
      clock,
      webView,
      loadEnd: async () => { await TestRenderer.act(async () => webView()!.props.onLoadEnd()); },
      frame: async (frame) => {
        await TestRenderer.act(async () => webView()!.props.onMessage({ nativeEvent: { data: JSON.stringify(frame) } }));
      },
      shown: () => textOf(tree.root),
    });
  } finally {
    await unmountScreen(tree);
    clock.restore();
  }
}

/** The first paint of a freshly delivered realm: the iframe's own generation counter reads 1 on
 *  its first delivery, whatever generation the host bound the realm under. */
const FIRST_PAINT = { kind: 'paint', trusted: true, payload: { generation: 1, mountToFirstPaintMs: 42, appName: 'Tip Splitter' } };

export async function runMiniAppHostUiTests(h: Harness): Promise<void> {
  await h.test('mini-app: the boot surface covers a WebView that is already mounted, until a trusted first paint', async () => {
    await withMiniApp(TIP, async ({ webView, loadEnd, frame, shown, clock }) => {
      h.ok(webView() != null, 'the WebView is mounted from the start, so the page keeps loading');
      h.ok(shown().includes(COPY.appBootLabel), 'under the boot surface');
      await loadEnd();
      h.eq(injectedScripts.length, 1, 'the bundle is delivered once the page has loaded');
      h.eq(clock.count(STARTUP_DEADLINE_MS), 1, 'and the startup deadline is running');
      await frame({ ...FIRST_PAINT, trusted: false });
      h.ok(shown().includes(COPY.appBootLabel), 'a paint frame that is not authenticated leaves the boot surface up');
      h.eq(clock.count(STARTUP_DEADLINE_MS), 1, 'and does not disarm the deadline');
      await frame(FIRST_PAINT);
      h.ok(!shown().includes(COPY.appBootLabel), 'the authenticated first paint (realm generation 1, host generation 2) ends the boot surface');
      h.eq(clock.count(STARTUP_DEADLINE_MS), 0, 'and completes startup');
    });
  });

  await h.test('mini-app: a second load event for the same WebView does not deliver the bundle again', async () => {
    await withMiniApp(TIP, async ({ loadEnd }) => {
      await loadEnd();
      await loadEnd();
      h.eq(injectedScripts.length, 1, 'one delivery per WebView mount, however many load events it reports');
    });
  });

  await h.test('mini-app: a bundle that fails shows the recovery screen; Retry mounts a fresh WebView and delivers again', async () => {
    await withMiniApp(TIP, async ({ webView, loadEnd, frame, shown, clock, tree }) => {
      await loadEnd();
      await frame(FIRST_PAINT);
      const first = webView();
      await frame({ kind: 'error', trusted: true, payload: { where: 'bundle', message: 'SENTINEL_TypeError: x is undefined' } });
      h.ok(shown().includes(COPY.appErrorTitle), 'the recovery screen replaces the app');
      h.ok(!shown().includes('SENTINEL'), 'without the raw error text');
      h.ok(webView() == null, 'the failed realm’s WebView is gone');
      await press(button(tree, COPY.appErrorRetry));
      h.ok(webView() != null && webView() !== first, 'Retry mounts a new WebView');
      h.ok(!shown().includes(COPY.appErrorTitle), 'the recovery screen is gone');
      await loadEnd();
      h.ok(shown().includes(COPY.appBootLabel), 'the new realm starts from the boot surface, not the old realm’s paint');
      h.eq(injectedScripts.length, 2, 'the new WebView gets its own delivery');
      h.eq(clock.count(STARTUP_DEADLINE_MS), 1, 'with its own startup deadline');
    });
  });

  await h.test('mini-app: the recovery screen’s Back leaves the app', async () => {
    await withMiniApp(TIP, async ({ loadEnd, frame, tree, exits }) => {
      await loadEnd();
      await frame({ kind: 'error', trusted: true, payload: { where: 'mount', message: 'boom' } });
      await press(button(tree, COPY.launchFailedBack));
      h.eq(exits(), 1, 'Back calls the exit once');
    });
  });

  await h.test('mini-app: an error the app survives is logged, not shown', async () => {
    await withMiniApp(TIP, async ({ webView, loadEnd, frame, shown }) => {
      await loadEnd();
      await frame(FIRST_PAINT);
      await frame({ kind: 'error', trusted: true, payload: { where: 'probes', message: 'probe hiccup' } });
      h.ok(webView() != null && !shown().includes(COPY.appErrorTitle), 'the app keeps running');
      h.ok(log.buffer.snapshot().some((r) => r.message === 'non-fatal error frame from the realm' && (r.fields as { detail?: unknown } | undefined)?.detail === 'probe hiccup'), 'and the error is recorded');
    });
  });

  await h.test('mini-app: an app that never paints reaches the recovery screen when the startup deadline passes', async () => {
    await withMiniApp(TIP, async ({ loadEnd, shown, clock }) => {
      await loadEnd();
      await TestRenderer.act(async () => clock.fire(STARTUP_DEADLINE_MS));
      h.ok(shown().includes(COPY.appErrorTitle), 'the recovery screen shows instead of an endless boot surface');
    });
  });

  await h.test('mini-app: leaving through the orb, or unmounting, disarms the startup deadline', async () => {
    await withMiniApp(TIP, async ({ loadEnd, clock, tree, exits }) => {
      await loadEnd();
      await press(button(tree, COPY.orbMenuOpenLabel));
      const home = tree.root.findAll((n) => n.type === 'Pressable' && textOf(n).endsWith(COPY.orbActionHome));
      await press(home[0]);
      h.eq(exits(), 1, 'Home leaves the app');
      h.eq(clock.count(STARTUP_DEADLINE_MS), 0, 'and no deadline outlives it');
    });
    await withMiniApp(TIP, async ({ loadEnd, clock, tree }) => {
      await loadEnd();
      await unmountScreen(tree);
      h.eq(clock.count(STARTUP_DEADLINE_MS), 0, 'unmounting leaves no deadline behind');
    });
  });

  await h.test('mini-app: unmounting a running storage app closes its database without calling exit', async () => {
    await withMiniApp(WATER, async ({ loadEnd, frame, tree, exits, shown }) => {
      await loadEnd();
      await frame(FIRST_PAINT);
      h.ok(!shown().includes(COPY.launchFailedTitle), 'the storage app launched');
      h.eq(closedDatabases.get(`${WATER.appId}.db`) ?? 0, 0, 'its database is open while it runs');
      await unmountScreen(tree);
      h.eq(closedDatabases.get(`${WATER.appId}.db`) ?? 0, 1, 'unmounting closes it');
      h.eq(exits(), 0, 'without the exit callback, which is for the user leaving');
    });
  });

  await h.test('mini-app: an app whose stored data cannot be opened with its schema gets the launch-failed screen, in plain words', async () => {
    // A previous version of the app stored `at` as a date; this version declares it as text. The
    // engine refuses to reinterpret existing data, so the launch is refused before delivery.
    const conflicting: AppRecord = JSON.parse(JSON.stringify(WATER));
    conflicting.schemaArtifact!.collections.Drinks.fields.at.type = 'text';
    await withMiniApp(conflicting, async ({ loadEnd, shown, tree, exits }) => {
      const earlier = createStorageEngine({ appId: WATER.appId, mode: "persistent" });
      earlier.open(WATER.schemaArtifact!);
      earlier.close();
      await loadEnd();
      h.ok(shown().includes(COPY.launchFailedTitle), 'the launch-failed screen shows');
      h.eq(injectedScripts.length, 0, 'and nothing was delivered');
      h.ok(!/type|schema|kind|hint|date|text/i.test(shown().replace(COPY.launchFailedBody, '').replace(COPY.launchFailedTitle, '').replace(COPY.launchFailedBack, '')),
        'no engine vocabulary or raw error detail is shown beside the copy');
      await press(button(tree, COPY.launchFailedBack));
      h.eq(exits(), 1, 'Back leaves the app');
    });
  });
}
