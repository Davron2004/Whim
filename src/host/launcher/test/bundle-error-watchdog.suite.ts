/**
 * Post-delivery bundle-error / blank-screen recovery (fix-blank-screen, F1+F2).
 *
 * A launch that is refused PRE-delivery already surfaces honest copy (`launchFailed`,
 * `launch-failure-ui.suite.ts`). This suite covers what happens AFTER delivery: a bundle that
 * throws (an `error` frame) or a delivered bundle that never paints (no `paint` frame lands) both
 * leave the realm dark with no recovery path otherwise. `MiniAppView.tsx`/`useMiniAppHost.ts` are
 * not rendered under Node, so — mirroring `launch-failure-ui.suite.ts` — this is a static source
 * assertion: it reads the production files and verifies (1) a second recovery branch keyed on
 * `host.state.lastError`, distinct from `launchFailed`, that renders honest static copy (never the
 * raw error string) with a Retry that remounts the WebView (a realm reset is a RECREATE, never a
 * re-inject, spike2 §5) and a Home action; and (2) a paint watchdog armed at delivery and disarmed
 * on the first `paint` frame, cleared at the same lifecycle edges as the existing `popTimer`.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { Harness } from './harness';
import { COPY } from '../copy';

/** The body of a `switch` `case '<name>':` up to its own `return;` (both files use one `return;`
 *  per case, never a fallthrough), found by plain index arithmetic to sidestep unbounded regex
 *  backtracking on a whole-file haystack. */
function caseBody(src: string, name: string): string {
  const start = src.indexOf(`case '${name}':`);
  if (start === -1) return '';
  const ret = src.indexOf('return;', start);
  return ret === -1 ? '' : src.slice(start, ret);
}

/** How many times a literal substring occurs in a string. */
function countOccurrences(src: string, needle: string): number {
  let count = 0;
  let from = 0;
  for (;;) {
    const at = src.indexOf(needle, from);
    if (at === -1) return count;
    count++;
    from = at + needle.length;
  }
}

export async function runBundleErrorWatchdogTests(h: Harness): Promise<void> {
  const hostSrc = fs.readFileSync(path.join(process.cwd(), 'src/host/launcher/useMiniAppHost.ts'), 'utf8');
  const viewSrc = fs.readFileSync(path.join(process.cwd(), 'src/host/launcher/MiniAppView.tsx'), 'utf8');

  await h.test('bundle-error: MiniAppView has a lastError recovery branch distinct from launchFailed', () => {
    h.ok(viewSrc.includes('host.state.lastError'), 'MiniAppView must branch on host.state.lastError');
    h.ok(viewSrc.includes('host.state.launchFailed'), 'the pre-delivery launchFailed branch must still exist');
    h.ok(
      viewSrc.indexOf('host.state.lastError') !== viewSrc.indexOf('host.state.launchFailed'),
      'the two branches must be distinct conditionals',
    );
  });

  await h.test('bundle-error: renders honest static copy, never interpolates the raw lastError string', () => {
    h.ok(viewSrc.includes('COPY.appErrorTitle') && viewSrc.includes('COPY.appErrorBody'), 'must render the static COPY.appError* strings');
    h.ok(!viewSrc.includes('{host.state.lastError}'), 'must never interpolate the raw lastError string into the UI');
  });

  await h.test('bundle-error: Retry bumps a local key used as key= on the WebView (remount, not re-inject)', () => {
    h.ok(viewSrc.includes('useState(0)'), 'a local numeric key state must exist');
    h.ok(/setWebKey\(\(?k\)? *=> *k *\+ *1\)/.test(viewSrc), 'Retry must bump the key by 1');
    h.ok(viewSrc.includes('key={webKey}'), 'the WebView must be keyed by webKey so Retry forces a fresh mount');
  });

  await h.test('bundle-error: the recovery screen offers a way back to Home wired to onExit', () => {
    // COPY.appErrorRetry's own button uses onPress={() => setWebKey...}; the Home action reuses
    // COPY.launchFailedBack — assert both COPY.appErrorRetry and COPY.launchFailedBack are wired
    // to a Pressable in the new block, and that launchFailedBack's specific action is onExit.
    h.ok(viewSrc.includes('COPY.appErrorRetry'), 'the recovery screen must render a Retry action');
    const backIdx = viewSrc.indexOf('COPY.launchFailedBack', viewSrc.indexOf('COPY.appErrorTitle'));
    h.ok(backIdx !== -1, 'the recovery screen must reuse COPY.launchFailedBack for its Home action');
    const before = viewSrc.slice(Math.max(0, backIdx - 120), backIdx);
    h.ok(before.includes('onPress={onExit}'), 'the Home action next to COPY.launchFailedBack must be wired to onExit');
  });

  await h.test('bundle-error: the copy carries no forbidden mechanism vocabulary', () => {
    const strings = [COPY.appErrorTitle, COPY.appErrorBody, COPY.appErrorRetry];
    const forbidden = [/\bwebview\b/i, /\brealm\b/i, /\bbundle\b/i, /\bgeneration\b/i, /\bmechanism\b/i];
    for (const str of strings) {
      for (const bad of forbidden) {
        h.ok(!bad.test(str), `"${str}" must not contain forbidden term ${bad}`);
      }
    }
  });

  await h.test('bundle-error: the delivery case is no longer a bare return and arms the paint watchdog', () => {
    const body = caseBody(hostSrc, 'delivery');
    h.ok(body.length > 0, "expected a 'delivery' case with a terminating return;");
    h.ok(!/^case 'delivery':\s*$/.test(body.trim()), "the 'delivery' case must no longer be a bare return");
    h.ok(body.includes('paintTimer'), "the 'delivery' case must touch the paintTimer ref");
  });

  await h.test('bundle-error: the delivery case arms a setTimeout that eventually clears via setS(lastError)', () => {
    // The arming logic lives in armPaintWatchdog (extracted to keep onMessage's cognitive
    // complexity down) — the delivery case calls it with paintTimer + setS.
    h.ok(/armPaintWatchdog\(paintTimer, ?setS\)/.test(hostSrc), 'the delivery case must call armPaintWatchdog(paintTimer, setS)');
    const armerIdx = hostSrc.indexOf('function armPaintWatchdog');
    h.ok(armerIdx !== -1, 'armPaintWatchdog must be defined');
    const armerBody = hostSrc.slice(armerIdx, hostSrc.indexOf('\n}', armerIdx));
    h.ok(armerBody.includes('setTimeout'), 'armPaintWatchdog must arm a setTimeout');
    h.ok(armerBody.includes('setS(') && armerBody.includes('lastError'), 'the watchdog must eventually call setS(...) with a lastError update');
  });

  await h.test('bundle-error: the paint case clears the SAME paintTimer ref the delivery arm uses', () => {
    const paintBody = caseBody(hostSrc, 'paint');
    h.ok(
      paintBody.includes('clearTimeout(paintTimer.current)') || paintBody.includes('disarmTimer(paintTimer)'),
      "the 'paint' case must clear the paintTimer ref (directly or via the shared disarmTimer helper)",
    );
  });

  await h.test('bundle-error: paintTimer is also cleared at bind()/exit()/unmount (not just on paint)', () => {
    // bind() + exit() + unmount = 3 inline clear sites, plus paint's own clear (inline or via
    // disarmTimer) makes a 4th — the ref must never outlive a rebind, an exit, or unmount.
    const inlineClears = countOccurrences(hostSrc, 'clearTimeout(paintTimer.current)');
    const paintBody = caseBody(hostSrc, 'paint');
    const paintClearsSeparately = paintBody.includes('disarmTimer(paintTimer)');
    const total = inlineClears + (paintClearsSeparately ? 1 : 0);
    h.ok(total >= 4, `expected paintTimer cleared at bind()/exit()/unmount/paint, found ${total} clear site(s)`);
  });
}
