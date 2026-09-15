/**
 * connectivity-ux Node suite (server-connectivity chain-5, task 5.4) — the pure visibility
 * derivation for the home screen's quiet offline indicator and the compose entry point's "server
 * unreachable" notice, exercised across the full matrix: all four `Connectivity` states ×
 * configured/unconfigured (`app-launcher/spec.md` "The home screen shows a quiet connectivity
 * indicator", `prompt-flow/spec.md` "The compose entry point shows a server-unreachable notice
 * without blocking generation").
 *
 * `HomeScreen.tsx`/`ComposeStep.tsx`/`LauncherRoot.tsx` import react-native and are not rendered
 * under Node, so the wiring itself is pinned the same way `fork-question-ui.suite.ts` pins its
 * screen: a static read of the production source.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { Harness } from './harness';
import { showOfflineIndicator, showServerUnreachableNotice } from '../connectivity-ux';
import type { Connectivity } from '../connectivity';

const STATES: readonly Connectivity[] = ['unknown', 'checking', 'online', 'offline'];

export async function runConnectivityUxTests(h: Harness): Promise<void> {
  await h.test('showOfflineIndicator: true only for offline, across every connectivity state', () => {
    for (const state of STATES) {
      h.eq(showOfflineIndicator(state), state === 'offline', `showOfflineIndicator(${state})`);
    }
  });

  await h.test('showServerUnreachableNotice: offline AND configured, across the full matrix', () => {
    for (const state of STATES) {
      for (const configured of [true, false]) {
        h.eq(
          showServerUnreachableNotice(state, configured),
          state === 'offline' && configured,
          `showServerUnreachableNotice(${state}, configured=${configured})`,
        );
      }
    }
  });

  await h.test('unconfigured never shows either offline surface, at any connectivity state', () => {
    for (const state of STATES) {
      h.ok(!showServerUnreachableNotice(state, false), `notice must stay hidden while unconfigured (state=${state})`);
    }
  });

  const launcherRootSrc = fs.readFileSync(path.join(process.cwd(), 'src/host/launcher/LauncherRoot.tsx'), 'utf8');
  const homeScreenSrc = fs.readFileSync(path.join(process.cwd(), 'src/host/launcher/HomeScreen.tsx'), 'utf8');
  const composeStepSrc = fs.readFileSync(path.join(process.cwd(), 'src/host/launcher/ComposeStep.tsx'), 'utf8');

  await h.test('wiring: LauncherRoot threads both surfaces through the pure derivation, not raw connectivity', () => {
    h.ok(
      /<HomeScreen[\s\S]{0,600}offline=\{showOfflineIndicator\(connectivity\)\}/.test(launcherRootSrc),
      'the HomeScreen call site must pass offline={showOfflineIndicator(connectivity)}',
    );
    h.ok(
      /<ComposeStep[\s\S]{0,600}serverUnreachable=\{showServerUnreachableNotice\(connectivity, clientOptions != null\)\}/.test(
        launcherRootSrc,
      ),
      'the ComposeStep call site must pass serverUnreachable={showServerUnreachableNotice(connectivity, clientOptions != null)}',
    );
  });

  await h.test('wiring: the home indicator is gated on the offline prop and never blocks the grid', () => {
    h.ok(homeScreenSrc.includes('COPY.homeOfflineIndicator'), 'HomeScreen must render the offline-indicator copy');
    h.ok(/\{offline &&/.test(homeScreenSrc), 'the indicator must be conditionally rendered on the offline prop');
    h.ok(
      !/offline[\s\S]{0,80}(disabled|editable=\{false\})/.test(homeScreenSrc),
      'the offline prop must never disable or gate any grid affordance',
    );
  });

  await h.test('wiring: no "set an address in Settings" notice exists any more', () => {
    // store-launch-compliance chain-3 (prompt-flow "The compose entry point shows a
    // server-unreachable notice without blocking generation"): compose opens only once AI-data
    // consent is granted, and a server address always exists (an override or the compiled-in
    // default from `release-config`), so the old unconfigured notice — and the `serverConfigured`
    // prop that gated it — no longer has any way to happen.
    h.ok(composeStepSrc.includes('COPY.promptServerUnreachable'), 'ComposeStep must still render the offline-notice copy');
    h.ok(!composeStepSrc.includes('serverConfigured'), 'the retired serverConfigured prop is gone entirely');
    h.ok(!composeStepSrc.includes('promptServerUnconfigured'), 'and so is the "set an address in Settings" notice it gated');
  });

  await h.test('wiring: the notice never gates submission — enabled has no serverUnreachable term', () => {
    // store-launch-compliance chain-4 added a second, unrelated gate (the refusal retry window,
    // `!gated`) to the same `enabled` expression — this assertion's actual claim, that
    // `serverUnreachable` itself never appears in it, still holds and is what it now pins.
    h.ok(
      /enabled=\{trimmed\.length > 0 && !gated\}/.test(composeStepSrc),
      'PrimaryAction enablement must be unaffected by serverUnreachable',
    );
  });
}
