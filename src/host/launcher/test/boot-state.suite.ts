/**
 * Mini-app boot state (`app-launcher`: "The mini-app container shows a boot state before first
 * paint"; flow-wait-hygiene chain-4).
 *
 * The branch decision is pure (`boot-state.ts`), so the three spec scenarios are exercised
 * directly. `MiniAppView.tsx`/`useMiniAppHost.ts` are RN and cannot be imported under Node, so the
 * two facts that live in them — the container renders the boot surface over a still-mounted
 * WebView, and `bind()` resets the paint signal so a rebind cannot inherit a stale paint — are
 * asserted against their source, the idiom `launch-failure-ui.suite.ts` already uses. The paint
 * frame's own trust fence is pure (`paintAccepted`) and exercised directly.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { Harness } from './harness';
import { hasPainted, miniAppSurface, paintAccepted } from '../boot-state';
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
  });

  // Scenario: because `bind()` resets the paint signal, the boot state is only honest if a paint
  // frame a bundle posts for ITSELF cannot end it — while every authentic paint does end it.
  await h.test('boot-state: only an authenticated paint frame ends the boot state', () => {
    h.eq(paintAccepted({ trusted: true, payload: { generation: 7, mountToFirstPaintMs: 4 } }), true, 'an authentic paint is accepted');
    h.eq(paintAccepted({ trusted: false, payload: { generation: 7 } }), false, 'an unauthenticated paint is refused');
    h.eq(paintAccepted({ payload: { generation: 7 } }), false, 'a frame with no trust stamp at all is refused');
    h.eq(paintAccepted({ trusted: 'yes' }), false, 'and a truthy-but-not-true stamp is refused');
    h.eq(paintAccepted({ trusted: true }), true, 'a payload-less authentic paint still counts (paintMs falls back to null)');
    h.eq(paintAccepted(null), false, 'and a missing frame is refused');
  });

  // The bug this pins: `paint` is NOT generation-fenced, because the two generation counters are
  // different namespaces. The frame below is built from what the BUILT runtime actually emits, so
  // it cannot drift into a shape only the test believes in.
  await h.test('boot-state: a real first paint is accepted even though its generation differs from the host counter', () => {
    const runtime = readSource('src/runtime/generated/runtime-html.ts');

    // (a) The outer page forwards `paint` verbatim — unlike `nav-depth`, which it re-stamps with
    //     the generation the HOST bound (GEN). So a paint's generation never enters host space.
    const paintForward = "toRN({kind:'paint',trusted:true,payload:m.payload})";
    h.ok(runtime.includes(paintForward), 'the built outer page must forward paint as {kind,trusted:true,payload}');
    h.ok(!paintForward.includes('GEN'), 'and must NOT re-stamp it with the host generation');
    h.ok(
      runtime.includes("toRN({kind:'nav-depth',trusted:false,payload:{depth:(typeof m.depth==='number'?m.depth:0),generation:GEN}})"),
      'while nav-depth — the frame that IS fenced — is re-stamped with GEN',
    );

    // (b) The realm's own counter starts at 0 and reaches 1 on the first delivery, so the first
    //     paint of a fresh realm carries generation 1 whatever generation the host bound.
    h.ok(runtime.includes('window.__whimGeneration = 0'), 'the iframe-local generation counter starts at 0');
    h.ok(
      runtime.includes('window.__whimGeneration = (window.__whimGeneration || 0) + 1'),
      'and a bundle delivery increments it, so a fresh realm paints at generation 1',
    );
    h.ok(
      runtime.includes('post(\'paint\', { generation: gen, mountToFirstPaintMs:'),
      'and the realm posts that iframe-local generation on the paint frame',
    );

    // The host, meanwhile, starts genCounter at 1 and PRE-increments per bind, so the very first
    // launch is generation 2 — never 1.
    h.ok(/const genCounter = useRef\(1\)/.test(hostSrc), 'the host generation counter starts at 1');
    h.ok(/\+\+genCounter\.current/.test(hostSrc), 'and bind() pre-increments it, making the first launch generation 2');

    const firstRealPaint = { trusted: true, payload: { generation: 1, mountToFirstPaintMs: 61.5, appName: 'water-counter' } };
    h.eq(paintAccepted(firstRealPaint), true, 'the first real paint of a successful launch is accepted');
    h.eq(
      miniAppSurface({ launchFailed: false, lastError: null, paintMs: firstRealPaint.payload.mountToFirstPaintMs }),
      'running',
      'so the container leaves the boot state instead of waiting out the paint watchdog',
    );
  });

  // The other half: a bundle forging its own paint must NOT dismiss the boot state, and must not
  // buy itself immunity from the watchdog that would otherwise report it as never visible.
  await h.test('boot-state: an unauthenticated paint leaves the boot state up and the watchdog armed', () => {
    for (const forged of [
      { payload: { generation: 1, mountToFirstPaintMs: 3 } },
      { trusted: false, payload: { generation: 2, mountToFirstPaintMs: 3 } },
    ]) {
      h.eq(paintAccepted(forged), false, 'a forged paint frame is refused');
    }
    h.eq(
      miniAppSurface({ launchFailed: false, lastError: null, paintMs: null }),
      'boot',
      'paintMs stays null, so the container is still showing the boot state',
    );
    const handler = hostSrc.slice(hostSrc.indexOf('function handlePaintFrame'), hostSrc.indexOf('/** An `error` frame'));
    h.ok(
      handler.indexOf('if (!paintAccepted(frame)) return;') < handler.indexOf('disarmTimer'),
      'and the host returns on a refused frame BEFORE disarming the paint watchdog',
    );
  });

  await h.test('boot-state: the host runs the paint frame through the fence before touching paintMs', () => {
    const paintCase = hostSrc.slice(hostSrc.indexOf("case 'paint':"), hostSrc.indexOf("case 'probes'"));
    h.ok(
      /handlePaintFrame\(m, paintTimer/.test(paintCase),
      'the paint branch must hand the whole frame to handlePaintFrame',
    );
    h.ok(!/genCounter/.test(paintCase), 'and must not fence it on the host generation counter, which paint never carries');
    const handler = hostSrc.slice(hostSrc.indexOf('function handlePaintFrame'), hostSrc.indexOf('/** An `error` frame'));
    const guardIdx = handler.indexOf('paintAccepted(frame)');
    h.ok(guardIdx > 0, 'and that handler must consult paintAccepted');
    h.ok(guardIdx < handler.indexOf('paintMs:'), 'refusing BEFORE publishing paintMs');
    h.ok(guardIdx < handler.indexOf('disarmTimer'), 'and before disarming the paint watchdog');
    h.ok(!handler.includes('generation:'), 'the paint path must not write HostState.generation — the probes branch owns it');
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
