/**
 * Mini-app boot state (`app-launcher`: "The mini-app container shows a boot state before first
 * paint"; flow-wait-hygiene chain-4).
 *
 * The branch decision is pure (`boot-state.ts`), so the three spec scenarios are exercised
 * directly. `MiniAppView.tsx`/`useMiniAppHost.ts` are RN and cannot be imported under Node, so the
 * two facts that live in them — the container renders the boot surface over a still-mounted
 * WebView, and `bind()` resets the paint signal so a rebind cannot inherit a stale paint — are
 * asserted against their source, the idiom `launch-failure-ui.suite.ts` already uses.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { Harness } from './harness';
import { hasPainted, miniAppSurface } from '../boot-state';
import { COPY } from '../copy';

function readSource(file: string): string {
  return fs.readFileSync(path.join(process.cwd(), file), 'utf8');
}

export async function runBootStateTests(h: Harness): Promise<void> {
  const hostSrc = readSource('src/host/launcher/useMiniAppHost.ts');
  const viewSrc = readSource('src/host/launcher/MiniAppView.tsx');

  await h.test('boot-state: "has painted" is derived from paintMs, with no separate signal', () => {
    h.eq(hasPainted(null), false, 'no paint frame yet');
    h.eq(hasPainted(0), true, 'a zero-millisecond first paint still counts as painted');
    h.eq(hasPainted(42), true, 'a normal first paint counts as painted');
  });

  // Scenario: a realm is bound and has not painted → the boot state, not a blank WebView.
  await h.test('boot-state: bound but not yet painted shows the boot surface', () => {
    h.eq(
      miniAppSurface({ launchFailed: false, lastError: null, paintMs: null }),
      'boot',
      'an unpainted, healthy realm shows the boot state',
    );
  });

  // Scenario: first paint lands → the boot state is gone and the mini-app is visible.
  await h.test('boot-state: first paint replaces the boot surface with the running realm', () => {
    h.eq(
      miniAppSurface({ launchFailed: false, lastError: null, paintMs: 12 }),
      'running',
      'once painted, nothing overlays the mini-app',
    );
  });

  // Scenario: the launch fails before any paint → the failure state, NOT the boot state.
  await h.test('boot-state: a launch failure before any paint wins over the boot surface', () => {
    h.eq(
      miniAppSurface({ launchFailed: true, lastError: 'launch X: schema — hint', paintMs: null }),
      'launch-failed',
      'an unpainted launch failure must show the failure copy, never a permanent opening screen',
    );
    h.eq(
      miniAppSurface({ launchFailed: false, lastError: 'app never became visible', paintMs: null }),
      'app-error',
      'an unpainted post-delivery failure must show the error copy, never the boot state',
    );
  });

  await h.test('boot-state: the container renders the boot surface OVER a WebView that stays mounted', () => {
    h.ok(viewSrc.includes("miniAppSurface(host.state)"), 'MiniAppView must branch through the pure miniAppSurface');
    const runIdx = viewSrc.indexOf('<WebView');
    const bootIdx = viewSrc.indexOf("surface === 'boot'");
    h.ok(runIdx > 0 && bootIdx > runIdx, 'the boot branch must sit INSIDE the running render, after the WebView');
    h.ok(
      /surface === 'boot' &&[\s\S]{0,600}COPY\.appBootLabel/.test(viewSrc),
      'the boot branch must render the boot copy',
    );
    h.ok(!/if \(surface === 'boot'\) \{[\s\S]{0,200}return/.test(viewSrc), 'the boot state must not early-return past the WebView (the realm must keep loading)');
  });

  await h.test('boot-state: the boot surface is styled from tokens, with no raw colours or sizes', () => {
    const bootStyles = /boot: \{[^}]*\}|bootTitle: \{[^}]*\}|bootMark: \{[^}]*\}|bootLabel: \{[^}]*\}/g;
    const decls = viewSrc.match(bootStyles) ?? [];
    h.ok(decls.length === 4, 'all four boot styles must exist');
    for (const decl of decls) {
      h.ok(!/#[0-9a-fA-F]{3,8}\b/.test(decl), `${decl} must carry no raw colour`);
      h.ok(!/(width|height|borderRadius|margin\w*|padding\w*|fontSize):\s*\d/.test(decl), `${decl} must size from tokens, not literals`);
      h.ok(!/shadow[A-Z]/.test(decl), `${decl} must not use iOS-only shadow* props (Android-first)`);
    }
  });

  await h.test('boot-state: a rebind clears the paint signal, so a new realm never inherits the old one’s paint', () => {
    const bindReset = hostSrc
      .split('\n')
      .find((l) => l.includes('currentApp: displayName') && l.includes('launchFailed: false'));
    h.ok(!!bindReset, 'bind() must have its per-attempt reset line');
    h.ok(!!bindReset && bindReset.includes('paintMs: null'), 'bind() must reset paintMs alongside lastError/launchFailed');
    h.ok(
      /hasPainted: firstPaintObserved\(s\.paintMs\)/.test(hostSrc),
      'the host must expose the derived flag from paintMs rather than storing a second signal',
    );
  });

  await h.test('boot-state: the boot copy speaks outcome, not mechanism', () => {
    for (const str of [COPY.appBootLabel, COPY.appBootA11yLabel]) {
      h.ok(str.trim().length > 0, 'the boot copy is seeded');
      for (const bad of [/\brealm\b/i, /\bwebview\b/i, /\bbundle\b/i, /\bpaint\b/i, /\bloading\b/i]) {
        h.ok(!bad.test(str), `"${str}" must not name mechanism (${bad})`);
      }
    }
  });
}
