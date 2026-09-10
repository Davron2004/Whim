/**
 * Per-mount delivery idempotency (`app-launcher`: one WebView == one realm == one delivery).
 *
 * Android's WebView fires `onPageFinished` (RN's `onLoadEnd`) more than once for a single page
 * load on some devices/WebView versions. A second delivery is never a no-op at the runtime: it
 * binds a new host generation and reinjects, which RECREATES the iframe (spike2 §5) under the
 * running app. The decision is pure (`realm-delivery.ts`) and exercised directly here; the two
 * facts that live in `MiniAppView.tsx` — that the guard is consulted before delivering and that it
 * is keyed by `webKey`, so a Retry remount still delivers — are asserted against its source, the
 * idiom `boot-state.suite.ts` / `launch-failure-ui.suite.ts` already use for RN files the Node
 * suite cannot import.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { Harness } from './harness';
import { loadEndAction } from '../realm-delivery';

function readSource(file: string): string {
  return fs.readFileSync(path.join(process.cwd(), file), 'utf8');
}

export async function runRealmDeliveryTests(h: Harness): Promise<void> {
  const viewSrc = readSource('src/host/launcher/MiniAppView.tsx');

  await h.test('realm-delivery: the first onLoadEnd of a mount delivers', () => {
    h.eq(loadEndAction(null, 0), 'deliver', 'a mount that has not delivered yet must deliver');
    h.eq(loadEndAction(null, 3), 'deliver', 'and that holds whatever the key happens to be');
  });

  await h.test('realm-delivery: a duplicate onLoadEnd for the SAME mount does not deliver again', () => {
    h.eq(loadEndAction(0, 0), 'duplicate', 'the doubled Android onPageFinished must be suppressed');
    h.eq(loadEndAction(7, 7), 'duplicate', 'the key it was recorded under does not matter, only that it matches');
  });

  await h.test('realm-delivery: a NEW key (the Retry remount) delivers again', () => {
    // A realm reset is a RECREATE, never a re-inject (spike2 §5): Retry bumps webKey to force a
    // fresh <WebView>, and that fresh realm has nothing in it until the host delivers. Suppressing
    // this would leave Retry showing a permanently blank app.
    h.eq(loadEndAction(0, 1), 'deliver', 'a bumped key is a new realm and must be delivered into');
    h.eq(loadEndAction(2, 3), 'deliver', 'every later Retry too');
  });

  await h.test('realm-delivery: MiniAppView guards onLoadEnd on the key it last delivered for', () => {
    const start = viewSrc.indexOf('const handleLoadEnd');
    h.ok(start !== -1, 'expected a handleLoadEnd callback');
    const end = viewSrc.indexOf('}, [', start);
    h.ok(end !== -1, 'expected handleLoadEnd to close with a dependency list');
    const body = viewSrc.slice(start, end);
    const guardIdx = body.indexOf('loadEndAction(');
    const deliverIdx = body.indexOf('host.deliverBySource(');
    h.ok(guardIdx !== -1, 'handleLoadEnd must consult the pure loadEndAction guard');
    h.ok(deliverIdx !== -1, 'handleLoadEnd must still deliver');
    h.ok(guardIdx < deliverIdx, 'the guard must run BEFORE the delivery, not after it');
    const beforeDeliver = body.slice(0, deliverIdx);
    h.ok(/\breturn;/.test(beforeDeliver), 'the duplicate path must return before delivering');
    h.ok(/log\.debug\(/.test(beforeDeliver), 'a suppressed duplicate must be recorded, never silently dropped');
    h.ok(
      /deliveredKey\.current = webKey/.test(beforeDeliver),
      'the delivered mount must be recorded as webKey (recording anything else breaks the Retry remount)',
    );
  });

  await h.test('realm-delivery: the guard is re-armed by the WebView key, not by a manual reset', () => {
    // The recorded value IS the key, so a bumped key can never compare equal — there is no
    // separate "reset the ref" step that a future edit could forget on the Retry path.
    h.ok(viewSrc.includes('key={webKey}'), 'the WebView must still be keyed by webKey');
    const start = viewSrc.indexOf('const handleLoadEnd');
    const depsIdx = viewSrc.indexOf('}, [', start);
    const deps = viewSrc.slice(depsIdx, viewSrc.indexOf(']', depsIdx) + 1);
    h.ok(deps.includes('webKey'), 'handleLoadEnd must close over the CURRENT webKey, not the mount-time one');
  });
}
