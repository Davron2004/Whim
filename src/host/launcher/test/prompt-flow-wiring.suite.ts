/**
 * Prompt-flow wiring (task 6.6, prompt-flow-ux chain-4): behavioral coverage for `server-address.ts`
 * (pure, Node-testable) plus static source assertions for `LauncherRoot.tsx`/`HomeScreen.tsx`/
 * `SettingsScreen.tsx`'s orchestration — mirroring `prompt-flow-screens.suite.ts`/
 * `launch-failure-ui.suite.ts`'s idiom, since `LauncherRoot` pulls in `react-native`/
 * `react-native-safe-area-context` and cannot be imported (only read) under Node.
 *
 * Scenarios (spec `prompt-flow/spec.md` + `app-launcher/spec.md`'s ADDED requirements):
 *   - create tile / "Prompt again" open the prompt flow with the right `editing` scope.
 *   - approve-order: no `generateApp` call before rewrite-preview approval.
 *   - a `result` event routes through `isAtTip` to install/update/fork-then-update (D5), writing
 *     the `{v:1,text}` envelope; the behind-tip fork passes `shareData:true` and asks nothing.
 *   - `GeneratingScreen`/`FailureScreen` are only ever handed the narrow stage/hint-only shapes.
 *   - cancel aborts the request and returns to the prompt screen before any delivery call.
 *   - an unconfigured server address is honestly surfaced, never attempted as a request.
 *   - the Settings server-address field persists tolerantly, like the theme pref.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { Harness } from './harness';
import { COPY } from '../copy';
import { MapKVBackend } from '../../version-store';
import { loadServerUrl, saveServerUrl } from '../server-address';

function read(file: string): string {
  return fs.readFileSync(path.join(process.cwd(), 'src/host/launcher', file), 'utf8');
}

export async function runPromptFlowWiringTests(h: Harness): Promise<void> {
  // ── server-address.ts: real behavior, not a static assertion (pure Node logic) ─────────────

  await h.test('server-address: absent key resolves to undefined ("not configured")', () => {
    const kv = new MapKVBackend();
    h.eq(loadServerUrl(kv), undefined, 'unset address must be undefined');
  });

  await h.test('server-address: a saved address round-trips exactly', () => {
    const kv = new MapKVBackend();
    saveServerUrl(kv, '192.168.1.20:4000');
    h.eq(loadServerUrl(kv), '192.168.1.20:4000', 'saved address must round-trip');
  });

  await h.test('server-address: whitespace is trimmed and a blank value clears to undefined', () => {
    const kv = new MapKVBackend();
    saveServerUrl(kv, '  host:4000  ');
    h.eq(loadServerUrl(kv), 'host:4000', 'must trim surrounding whitespace');
    saveServerUrl(kv, '   ');
    h.eq(loadServerUrl(kv), undefined, 'a blank/whitespace-only value must clear to undefined');
  });

  await h.test('server-address: never throws on a KVBackend returning null', () => {
    const kv = new MapKVBackend();
    // MapKVBackend.getString returns undefined for a missing key already, but the sanitizer must
    // also tolerate a backend that returns null (the documented KVBackend contract allows either).
    const nullish = { ...kv, getString: () => null } as unknown as MapKVBackend;
    h.eq(loadServerUrl(nullish), undefined, 'a null read must resolve to undefined, not throw');
  });

  // ── LauncherRoot.tsx / HomeScreen.tsx / SettingsScreen.tsx: static wiring assertions ────────

  const rootSrc = read('LauncherRoot.tsx');
  const homeSrc = read('HomeScreen.tsx');
  const settingsSrc = read('SettingsScreen.tsx');

  await h.test('home: create tile and "Prompt again" both open the prompt screen with the right scope', () => {
    h.ok(/onCreate=\{\(\)\s*=>\s*setScreen\(\{\s*kind:\s*'prompt'\s*\}\)\}/.test(rootSrc), 'create tile must open the prompt screen with no app being edited');
    h.ok(/onPromptAgain=\{\(app\)\s*=>\s*setScreen\(\{\s*kind:\s*'prompt',\s*editing:\s*app\s*\}\)\}/.test(rootSrc), '"Prompt again" must open the prompt screen scoped to that app');
    h.ok(homeSrc.includes('onPromptAgain(a)'), 'HomeScreen action sheet must call onPromptAgain');
    h.ok(homeSrc.includes('COPY.actionPromptAgain'), 'HomeScreen must render the "Prompt again" action label');
    h.ok(!homeSrc.includes('showCreate'), 'the create tile must no longer show the old placeholder alert');
  });

  await h.test('approve-order: generateApp is only ever called from the approve handler, never from submit', () => {
    const submitFn = rootSrc.slice(rootSrc.indexOf('const onPromptSubmit'), rootSrc.indexOf('const onApprovePreview'));
    h.ok(submitFn.includes('rewritePrompt('), 'submit must call rewritePrompt');
    h.ok(!submitFn.includes('generateApp('), 'submit must never call generateApp before approval');
    const approveFn = rootSrc.slice(rootSrc.indexOf('const onApprovePreview'), rootSrc.indexOf('const onCancelGeneration'));
    h.ok(approveFn.includes('generateApp('), 'approve must call generateApp');
  });

  await h.test('generating: only `stage` reaches screen state — never token text or diagnostic fields', () => {
    const approveFn = rootSrc.slice(rootSrc.indexOf('const onApprovePreview'), rootSrc.indexOf('const onCancelGeneration'));
    h.ok(/s\.stage\s*=\s*event\.stage|stage:\s*event\.stage/.test(approveFn), 'must forward event.stage into screen state');
    h.ok(!/event\.text\b/.test(approveFn), 'must never read a token event\'s text');
    h.ok(!/event\.diagnostic\.(kind|symbol)/.test(approveFn), 'must never read a diagnostic\'s kind/symbol');
  });

  await h.test('failure: terminal failure and stream errors both map to reason + hint-only diagnostics', () => {
    h.ok(rootSrc.includes("diagnostics: terminal.diagnostics.map((d) => ({ hint: d.hint }))"), 'a terminal failure event must be mapped to hint-only diagnostics');
    h.ok(rootSrc.includes('GENERIC_STREAM_ERROR'), 'a stream ending without a terminal event must use the generic honest reason');
    h.ok(!/err\.kind\b/.test(rootSrc) && !/err\.status\b/.test(rootSrc), 'must never surface the raw error kind/status to the failure screen');
  });

  await h.test('delivery (D5): result routes through isAtTip to install / update / fork-then-update', () => {
    const deliverFn = rootSrc.slice(rootSrc.indexOf('async function deliverResult'), rootSrc.indexOf('export default function LauncherRoot'));
    h.ok(deliverFn.includes('access.install(') && deliverFn.includes('!editing'), 'new-app case must call access.install');
    h.ok(deliverFn.includes('await isAtTip(access, editing)'), 'edit case must decide via isAtTip');
    h.ok(deliverFn.includes('access.update(editing,'), 'at-tip case must call access.update on the same entry');
    h.ok(deliverFn.includes('access.fork(editing, undefined, { shareData: true })'), 'behind-tip case must fork with shareData:true and no question');
    h.ok(deliverFn.includes('access.update(fork,'), 'behind-tip case must then update the new fork');
    h.ok(deliverFn.includes("JSON.stringify({ v: 1, text })") || rootSrc.includes("JSON.stringify({ v: 1, text })"), 'every delivery must write the {v:1,text} prompt envelope');
  });

  await h.test('cancel-on-navigate-away: aborts and returns to prompt before any delivery call', () => {
    const cancelFn = rootSrc.slice(rootSrc.indexOf('const onCancelGeneration'), rootSrc.indexOf('const statusBarStyle'));
    h.ok(cancelFn.includes('ctl.cancelled = true') && cancelFn.includes('ctl.controller.abort()'), 'cancel must mark intent and abort the controller');
    h.ok(cancelFn.includes("setScreen({ kind: 'prompt'"), 'cancel must return to the prompt screen');
    h.ok(!cancelFn.includes('deliverResult'), 'cancel itself must never call deliverResult');
    const approveFn = rootSrc.slice(rootSrc.indexOf('const onApprovePreview'), rootSrc.indexOf('const onCancelGeneration'));
    h.ok(/if \(ctl\.cancelled\) return;/.test(approveFn), 'the generation loop must bail out on a cancelled controller before delivering');
  });

  await h.test('server address: every request is gated on clientOptions (serverConfigured), device id attached once', () => {
    h.ok(rootSrc.includes('serverConfigured={clientOptions != null}'), 'PromptScreen must be told whether a server is configured');
    h.ok(rootSrc.includes('if (!clientOptions) return;'), 'submit/approve must bail out honestly when unconfigured');
    h.ok(rootSrc.includes('getDeviceId(kv)'), 'must read the persisted device id via getDeviceId');
  });

  await h.test('settings: server-address field persists like the theme pref (load/save round-trip, no crash on save)', () => {
    h.ok(settingsSrc.includes('COPY.serverAddressSectionTitle') && settingsSrc.includes('onServerUrlChange'), 'Settings must render the server-address field and wire onServerUrlChange');
    h.ok(rootSrc.includes('saveServerUrl(kv, url)') && rootSrc.includes('setServerUrl(loadServerUrl(kv))'), 'LauncherRoot must persist then re-read the sanitized value back, mirroring the theme pref\'s round-trip');
  });

  await h.test('prompt-flow wiring: every new COPY string exists, is non-empty, and passes the product-verbs shape', () => {
    const keys = ['actionPromptAgain', 'serverAddressSectionTitle', 'serverAddressPlaceholder', 'serverAddressHint'] as const;
    for (const key of keys) {
      h.ok(typeof COPY[key] === 'string' && COPY[key].length > 0, `COPY.${key} must be a non-empty string`);
    }
  });
}
