/**
 * Post-delivery bundle-error / blank-screen recovery (fix-blank-screen, F1+F2, revision 1).
 *
 * A launch that is refused PRE-delivery already surfaces honest copy (`launchFailed`,
 * `launch-failure-ui.suite.ts`). This suite covers what happens AFTER delivery: a FATAL bundle
 * error (loader.js: no AppSpec export / a render throw / the delivery wrapper itself throwing) or
 * an ATTEMPTED delivery that produces no page frames both leave the realm dark with no recovery
 * path otherwise. `MiniAppView.tsx`/`useMiniAppHost.ts` are not rendered under Node, so —
 * mirroring `launch-failure-ui.suite.ts` — this is a static source assertion. It verifies:
 *  (1) a `lastError` recovery branch distinct from `launchFailed`, rendering honest static copy
 *      (never the raw error string), whose Retry BOTH clears the error state (so the branch falls
 *      through) AND remounts the WebView under a bumped key (a realm reset is a RECREATE, never a
 *      re-inject, spike2 §5) — bumping the key alone can never remount while lastError still
 *      gates the branch, and clearing alone can never remount without a fresh WebView instance;
 *  (2) the `error` frame is narrowed to fatal `where`s only, so a healthy running app's post-paint
 *      diagnostic errors (e.g. `where: 'probes'`) never trigger a full-screen takeover;
 *  (3) source delivery starts the deadline before page control, covering native failures that
 *      suppress all frames; an accepted delivery restarts the established paint allowance;
 *  (4) the startup deadline is cancelled at bind/error/exit/retry/unmount and trusted paint.
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

/** The body of the first top-level `function <name>(...) { ... }` declaration, by brace balance
 *  (avoids a greedy/backtracking regex over the whole file). */
function functionBody(src: string, name: string): string {
  const sig = `function ${name}(`;
  const start = src.indexOf(sig);
  if (start === -1) return '';
  const braceStart = src.indexOf('{', start);
  if (braceStart === -1) return '';
  let depth = 0;
  for (let i = braceStart; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) return src.slice(braceStart, i + 1);
    }
  }
  return '';
}

export async function runBundleErrorWatchdogTests(h: Harness): Promise<void> {
  const hostSrc = fs.readFileSync(path.join(process.cwd(), 'src/host/launcher/useMiniAppHost.ts'), 'utf8');
  const viewSrc = fs.readFileSync(path.join(process.cwd(), 'src/host/launcher/MiniAppView.tsx'), 'utf8');

  await h.test('bundle-error: MiniAppView has a lastError recovery branch distinct from launchFailed', () => {
    // Both branches now come off the pure `miniAppSurface(host.state)` (flow-wait-hygiene
    // chain-4), which still keeps them distinct AND keeps the post-delivery error surface above
    // the boot state -- an app that failed before painting shows this recovery screen, not a
    // permanent opening screen.
    h.ok(viewSrc.includes('miniAppSurface(host.state)'), 'MiniAppView must derive its surface from the host state');
    h.ok(viewSrc.includes("surface === 'app-error'"), 'MiniAppView must branch on the post-delivery error surface');
    h.ok(viewSrc.includes("surface === 'launch-failed'"), 'the pre-delivery launchFailed branch must still exist');
    h.ok(
      viewSrc.indexOf("surface === 'app-error'") !== viewSrc.indexOf("surface === 'launch-failed'"),
      'the two branches must be distinct conditionals',
    );
  });

  await h.test('bundle-error: renders honest static copy, never interpolates the raw lastError string', () => {
    h.ok(viewSrc.includes('COPY.appErrorTitle') && viewSrc.includes('COPY.appErrorBody'), 'must render the static COPY.appError* strings');
    h.ok(!viewSrc.includes('{host.state.lastError}'), 'must never interpolate the raw lastError string into the UI');
  });

  await h.test('bundle-error: appErrorBody makes no promise about what was or was not lost', () => {
    // The host cannot know that -- the error class includes storage failures -- so the copy must
    // stay honest/neutral rather than reassuring the user nothing was lost.
    h.ok(!/nothing.*was lost/i.test(COPY.appErrorBody), 'appErrorBody must not claim nothing was lost');
  });

  await h.test('bundle-error: Retry clears lastError AND bumps the WebView key in the SAME handler', () => {
    // Isolate the handler MiniAppView wires to Retry's onPress, not just anywhere in the file --
    // otherwise a broken build (e.g. only bumping the key, or only clearing the error) that
    // happens to contain both calls SOMEWHERE would still pass.
    const retryIdx = viewSrc.indexOf('COPY.appErrorRetry');
    h.ok(retryIdx !== -1, 'expected a Retry action rendering COPY.appErrorRetry');
    const before = viewSrc.slice(0, retryIdx);
    const onPressIdx = before.lastIndexOf('onPress=');
    h.ok(onPressIdx !== -1, 'expected an onPress handler before the Retry label');
    const constRetryIdx = before.lastIndexOf('const retry', onPressIdx);
    const handlerRegionStart = constRetryIdx !== -1 ? constRetryIdx : onPressIdx;
    const handlerRegion = viewSrc.slice(handlerRegionStart, retryIdx);
    h.ok(handlerRegion.includes('host.clearLastError()'), 'the Retry handler must call host.clearLastError()');
    h.ok(/setWebKey\(\(?k\)? *=> *k *\+ *1\)/.test(handlerRegion), 'the Retry handler must also bump webKey by 1');
  });

  await h.test('bundle-error: useMiniAppHost exposes clearLastError, which nulls lastError without touching the realm', () => {
    const defIdx = hostSrc.indexOf('clearLastError = useCallback');
    h.ok(defIdx !== -1, 'clearLastError must be defined as a useCallback');
    const closeIdx = hostSrc.indexOf('}, []);', defIdx);
    h.ok(closeIdx !== -1, 'clearLastError must have a closing }, []);');
    const def = hostSrc.slice(defIdx, closeIdx + '}, []);'.length);
    h.ok(/lastError: *null/.test(def), 'clearLastError must set lastError to null');
    h.ok(!def.includes('tearDownRealm') && !def.includes('bind('), 'clearLastError must NOT tear down or rebind the realm');
    const returnIdx = hostSrc.lastIndexOf('return {');
    h.ok(returnIdx !== -1 && returnIdx > closeIdx, 'expected the hook API object literal after clearLastError is defined');
    h.ok(hostSrc.slice(returnIdx).includes('clearLastError'), 'useMiniAppHost must return clearLastError in its API');
  });

  await h.test('bundle-error: the WebView is keyed by webKey so Retry forces a fresh mount', () => {
    h.ok(viewSrc.includes('useState(0)'), 'a local numeric key state must exist');
    h.ok(viewSrc.includes('key={webKey}'), 'the WebView must be keyed by webKey');
  });

  await h.test('bundle-error: the recovery screen offers a way back to Home wired to onExit', () => {
    const backIdx = viewSrc.indexOf('COPY.launchFailedBack', viewSrc.indexOf('COPY.appErrorTitle'));
    h.ok(backIdx !== -1, 'the recovery screen must reuse COPY.launchFailedBack for its Home action');
    const before = viewSrc.slice(Math.max(0, backIdx - 120), backIdx);
    h.ok(before.includes('onPress={onExit}'), 'the Home action next to COPY.launchFailedBack must be wired to onExit');
  });

  await h.test("bundle-error: the 'error' case is narrowed to a fatal-where set, not every error frame", () => {
    const errorBody = caseBody(hostSrc, 'error');
    h.ok(errorBody.length > 0, "expected an 'error' case");
    h.ok(errorBody.includes('handleErrorFrame'), "the 'error' case must delegate to handleErrorFrame");

    // The handler itself must actually SHORT-CIRCUIT before setS for a non-fatal where -- not
    // just mention `where` somewhere while still unconditionally calling setS (which would make
    // this assertion pass against the exact bug under review: every error frame escalating).
    const handlerBody = functionBody(hostSrc, 'handleErrorFrame');
    h.ok(handlerBody.length > 0, 'handleErrorFrame must be defined');
    const setSIdx = handlerBody.indexOf('setS(');
    h.ok(setSIdx !== -1, 'handleErrorFrame must call setS(...) for the fatal path');
    const beforeSetS = setSIdx === -1 ? '' : handlerBody.slice(0, setSIdx);
    h.ok(/\breturn;/.test(beforeSetS), 'handleErrorFrame must return BEFORE reaching setS for a non-fatal where (an unconditional setS is the exact bug this locks against)');
    h.ok(handlerBody.includes('isFatalErrorWhere('), 'handleErrorFrame must gate that early return on isFatalErrorWhere(payload.where)');

    // Since handleErrorFrame is proven above to actually delegate its gating to isFatalErrorWhere,
    // that function's own fatal set is the real source of truth for which `where`s escalate.
    const fatalSet = functionBody(hostSrc, 'isFatalErrorWhere');
    h.ok(fatalSet.includes("'bundle'"), "the fatal-where set must include loader.js's 'bundle' where");
    h.ok(fatalSet.includes("'mount'"), "the fatal-where set must include loader.js's 'mount' where");
    h.ok(!fatalSet.includes("'probes'"), "the fatal-where set must NOT include the post-paint 'probes' diagnostic where");
  });

  await h.test("bundle-error: a non-fatal 'error' frame is recorded (never silently swallowed)", () => {
    // DevProbeScreen's own diagnostic line reads state.lastError -- a purely-dropped non-fatal
    // frame would silently stop showing up anywhere it used to, which is a regression even though
    // it correctly stops escalating to the product's full-screen takeover.
    const handlerBody = functionBody(hostSrc, 'handleErrorFrame');
    const returnIdx = handlerBody.search(/\breturn;/);
    h.ok(returnIdx !== -1, 'expected an early return for the non-fatal path');
    const nonFatalPath = handlerBody.slice(0, returnIdx);
    h.ok(/log\.(debug|warn)\(/.test(nonFatalPath), 'the non-fatal path must log the frame, not drop it silently');
  });

  await h.test('bundle-error: attempted source delivery starts the deadline before page control', () => {
    const deliveryBySourceBody = hostSrc.slice(hostSrc.indexOf('const deliverBySource = useCallback'), hostSrc.indexOf('const onMessage'));
    const beginIdx = deliveryBySourceBody.indexOf('startupDeadline.current.begin()');
    const controlIdx = deliveryBySourceBody.indexOf('control(js)');
    h.ok(beginIdx !== -1, 'deliverBySource must begin the startup deadline');
    h.ok(controlIdx !== -1, 'deliverBySource must inject the assembled source');
    h.ok(beginIdx < controlIdx, 'the deadline must start before page control can lose every frame');
    h.ok(beginIdx > deliveryBySourceBody.indexOf('deliverBySourceJs('), 'the deadline starts only after source assembly succeeds');
  });

  await h.test("bundle-error: an accepted 'delivery' frame restarts the paint allowance", () => {
    const deliveryBody = caseBody(hostSrc, 'delivery');
    h.ok(deliveryBody.length > 0, "expected a 'delivery' case");
    h.ok(!/^case 'delivery':\s*$/.test(deliveryBody.trim()), "the 'delivery' case must no longer be a bare return");
    const restartSiteSrc = deliveryBody.includes('handleDeliveryFrame')
      ? functionBody(hostSrc, 'handleDeliveryFrame')
      : deliveryBody;
    h.ok(restartSiteSrc.includes('accepted'), 'the restart path must check payload.accepted');
    h.ok(restartSiteSrc.includes('=== true'), 'the accepted check must require === true, not frame truthiness');
    h.ok(restartSiteSrc.includes('.begin()'), 'accepted delivery must restart the deadline');
  });

  await h.test('bundle-error: the startup deadline is cancelled at every terminal lifecycle edge', () => {
    const bindBody = hostSrc.slice(hostSrc.indexOf('const bind = useCallback'), hostSrc.indexOf('const deliverBySource'));
    h.ok(/startupDeadline\.current\.cancel\(\)/.test(bindBody), 'bind() must invalidate the previous attempt');

    const paintBody = caseBody(hostSrc, 'paint');
    h.ok(paintBody.includes('handlePaintFrame'), "the 'paint' case must delegate to handlePaintFrame");
    const paintFinishSrc = functionBody(hostSrc, 'handlePaintFrame');
    h.ok(paintFinishSrc.length > 0, 'and that helper must exist');
    h.ok(paintFinishSrc.includes('acceptPaint(frame)'), 'the paint path must pass through trust-gated completion');

    const fatalErrorSrc = functionBody(hostSrc, 'handleErrorFrame');
    const fatalCancelIdx = fatalErrorSrc.indexOf('startupDeadline.cancel()');
    const fatalSetIdx = fatalErrorSrc.indexOf('setS(');
    h.ok(fatalCancelIdx !== -1, 'a fatal realm error must cancel the current deadline');
    h.ok(fatalCancelIdx < fatalSetIdx, 'fatal cancellation must precede publishing the real error');

    const exitBody = hostSrc.slice(hostSrc.indexOf('const exit = useCallback'), hostSrc.indexOf('const clearLastError'));
    h.ok(/startupDeadline\.current\.cancel\(\)/.test(exitBody), 'exit() must cancel the deadline');

    // clearLastError() is Retry's own clearing step -- an accepted delivery whose watchdog is
    // still armed when a fatal error lands must not have that STALE timer fire after Retry has
    // already cleared lastError and remounted, re-setting lastError for an invisible reason.
    const clearLastErrorIdx = hostSrc.indexOf('const clearLastError = useCallback');
    h.ok(clearLastErrorIdx !== -1, 'expected a clearLastError useCallback');
    const clearLastErrorCloseIdx = hostSrc.indexOf('}, []);', clearLastErrorIdx);
    const clearLastErrorBody = hostSrc.slice(clearLastErrorIdx, clearLastErrorCloseIdx + '}, []);'.length);
    h.ok(/startupDeadline\.current\.cancel\(\)/.test(clearLastErrorBody), 'clearLastError() must cancel the stale attempt');

    const unmountIdx = hostSrc.indexOf('Unmount teardown');
    const unmountRegion = hostSrc.slice(unmountIdx, unmountIdx + 800);
    h.ok(/startupDeadline\.current\.cancel\(\)/.test(unmountRegion), 'the unmount effect must cancel the deadline');
  });
}
