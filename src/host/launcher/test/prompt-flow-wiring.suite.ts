/**
 * Prompt-flow wiring (shell-redesign-v2, task D11): the pure and injectable pieces between the
 * `2a` screens and the outside world — the server-address store, the `POST /v1/clarify` and
 * `POST /v1/rewrite` calls (against an injected `fetchImpl`, no HTTP server), the request builder's
 * clarification threading, the per-step request slots, and the highlighting flag's store. How the
 * rendered shell uses them is in `prompt-flow-ui.suite.tsx` and `attempt-lifecycle-ui.suite.tsx`.
 */

import { Harness } from './harness';
import { MapKVBackend } from '../../version-store';
import { clearServerUrl, effectiveServerUrl, loadServerUrl, saveServerUrl, serverOverride } from '../server-address';
import { RELEASE } from '../release-config';
import { clarifyPrompt, rewritePrompt } from '../generation-client';
import type { ConsentedClientOptions } from '../generation-client';
import { buildGenerateRequest } from '../generation-request';
import { isClarifySkip } from '../prompt-flow';
import { FlowRequests, onlyOnStep } from '../flow-request';
import { loadHighlighting, saveHighlighting } from '../highlighting';
import type { StoreAccess } from '../store-access';
import { grantedOptions } from './client-fixtures';

interface CapturedRequest {
  url: string;
  body: unknown;
}

/** A `fetchImpl` that records the request and answers with a canned status + JSON body. */
function stubFetch(status: number, body: unknown, captured: CapturedRequest[]): typeof fetch {
  return (async (url: string, init: { body: string }) => {
    captured.push({ url: String(url), body: JSON.parse(init.body) });
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    } as unknown as Response;
  }) as unknown as typeof fetch;
}

const OPTS = (fetchImpl: typeof fetch): ConsentedClientOptions =>
  ({
    ...grantedOptions('http://server.test', '11111111-1111-4111-8111-111111111111'),
    fetchImpl,
  }) as ConsentedClientOptions;

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

  await h.test('server-address: a trailing slash is stripped on save round-trip', () => {
    const kv = new MapKVBackend();
    saveServerUrl(kv, '10.0.2.2:8787/');
    h.eq(loadServerUrl(kv), '10.0.2.2:8787', 'a single trailing slash must not survive the round-trip');
  });

  await h.test('server-address: multiple trailing slashes are all stripped', () => {
    const kv = new MapKVBackend();
    saveServerUrl(kv, 'host:8787///');
    h.eq(loadServerUrl(kv), 'host:8787', 'repeated trailing slashes collapse away entirely');
  });

  await h.test('server-address: a previously-persisted trailing slash heals on load', () => {
    const kv = new MapKVBackend();
    kv.set('whim.server-url:v1', '10.0.2.2:8787/');
    h.eq(loadServerUrl(kv), '10.0.2.2:8787', 'an old install’s stored value is sanitized on read, not just on save');
  });

  await h.test('server-address: never throws on a KVBackend returning null', () => {
    const kv = new MapKVBackend();
    // MapKVBackend.getString returns undefined for a missing key already, but the sanitizer must
    // also tolerate a backend that returns null (the documented KVBackend contract allows either).
    const nullish = { ...kv, getString: () => null } as unknown as MapKVBackend;
    h.eq(loadServerUrl(nullish), undefined, 'a null read must resolve to undefined, not throw');
  });

  // ── effectiveServerUrl / clearServerUrl (release-config "The compiled-in server is used
  // unless the user sets an override") ───────────────────────────────────────────────────────

  await h.test('effectiveServerUrl: in an internal build, a fresh store resolves to the compiled-in production server', () => {
    const kv = new MapKVBackend();
    h.eq(effectiveServerUrl(kv, true), RELEASE.serverUrl, 'no saved override -> RELEASE.serverUrl');
  });

  await h.test('effectiveServerUrl: in an internal build, a saved override wins over the compiled-in server', () => {
    const kv = new MapKVBackend();
    saveServerUrl(kv, '10.0.2.2:8787');
    h.eq(effectiveServerUrl(kv, true), '10.0.2.2:8787', 'a saved override takes priority');
  });

  await h.test('effectiveServerUrl: a whitespace-only saved value falls back to the default', () => {
    const kv = new MapKVBackend();
    saveServerUrl(kv, '   ');
    h.eq(effectiveServerUrl(kv, true), RELEASE.serverUrl, 'blank/whitespace counts as no override');
  });

  await h.test('clearServerUrl: removes a saved override, restoring the compiled-in default', () => {
    const kv = new MapKVBackend();
    saveServerUrl(kv, '10.0.2.2:8787');
    h.eq(effectiveServerUrl(kv, true), '10.0.2.2:8787', 'override is active before clearing');
    clearServerUrl(kv);
    h.eq(loadServerUrl(kv), undefined, 'the saved key is gone');
    h.eq(effectiveServerUrl(kv, true), RELEASE.serverUrl, 'the next request goes to the compiled-in server');
  });

  await h.test('effectiveServerUrl: a store build ignores an override an earlier internal build saved, and keeps it unread', () => {
    const kv = new MapKVBackend();
    saveServerUrl(kv, '10.0.2.2:8787');
    h.eq(serverOverride(kv, { internalBuild: false }), undefined, 'a store build honours no override');
    h.eq(effectiveServerUrl(kv, false), RELEASE.serverUrl, 'every request targets the compiled-in production server');
    h.eq(loadServerUrl(kv), '10.0.2.2:8787', 'the saved value is left in place, not deleted');
    h.eq(effectiveServerUrl(kv, true), '10.0.2.2:8787', 'so the same phone back on an internal build still has it');
  });

  // ── the clarify exchange, over an injected fetch ────────────────────────────────────────────

  await h.test('clarify: a request/response exchange, never a stream', async () => {
    const captured: CapturedRequest[] = [];
    const response = await clarifyPrompt(
      OPTS(stubFetch(200, { questions: [{ id: 'alert', question: 'How?', options: ['Sound', 'Buzz'] }] }, captured)),
      'a brew timer',
    );
    h.eq(captured[0].url, 'http://server.test/v1/clarify', 'the exchange is its own unary route');
    h.eq(captured[0].body, { prompt: 'a brew timer' }, 'it carries the prompt and nothing else');
    h.eq(response.questions.length, 1, 'the questions come back for the device to render');
  });

  await h.test('clarify: zero questions is a success, not a degraded mode', async () => {
    const response = await clarifyPrompt(OPTS(stubFetch(200, { questions: [] }, [])), 'a dice roller');
    h.eq(response.questions, [], 'an empty list parses as a normal answer');
  });

  await h.test('clarify: a 502 surfaces as the skip-to-plan signal', async () => {
    let caught: unknown = null;
    try {
      await clarifyPrompt(OPTS(stubFetch(502, { error: 'clarify_not_configured', hint: 'no key' }, [])), 'x');
    } catch (e) {
      caught = e;
    }
    h.ok(caught !== null, 'a 502 rejects rather than inventing questions');
    h.ok(isClarifySkip(caught), 'and the flow reads it as "skip to the plan step"');
  });

  await h.test('clarify: an unparseable answer is an error, never a silent empty list', async () => {
    let caught: unknown = null;
    try {
      await clarifyPrompt(OPTS(stubFetch(200, { questions: [{ id: 1 }] }, [])), 'x');
    } catch (e) {
      caught = e;
    }
    h.ok(caught !== null, 'a malformed question list is rejected');
    h.ok(!isClarifySkip(caught), 'and is not mistaken for the skip signal');
  });

  // ── answers reaching the requests that follow ───────────────────────────────────────────────

  await h.test('rewrite: the clarify answers ride with the rewrite request', async () => {
    const captured: CapturedRequest[] = [];
    await rewritePrompt(OPTS(stubFetch(200, { rewrittenPrompt: 'a brew timer' }, captured)), 'a timer', [
      { id: 'alert', question: 'How?', answer: 'Both' },
    ]);
    h.eq(
      captured[0].body,
      { prompt: 'a timer', clarifications: [{ id: 'alert', question: 'How?', answer: 'Both' }] },
      'the answers travel by value with the prompt',
    );
  });

  await h.test('rewrite: answering nothing sends no clarifications field at all', async () => {
    const captured: CapturedRequest[] = [];
    await rewritePrompt(OPTS(stubFetch(200, { rewrittenPrompt: 'a brew timer' }, captured)), 'a timer');
    h.eq(captured[0].body, { prompt: 'a timer' }, 'absent and empty mean the same thing, and absent is sent');
  });

  await h.test('generate: the request carries the clarifications for a new app', async () => {
    const noAccess = {} as unknown as StoreAccess;
    const withAnswers = await buildGenerateRequest(noAccess, () => ({}) as never, undefined, 'a brew timer', [
      { id: 'alert', question: 'How?', answer: 'Both' },
    ]);
    h.eq(
      withAnswers,
      { prompt: 'a brew timer', clarifications: [{ id: 'alert', question: 'How?', answer: 'Both' }] },
      'the answers reach generation',
    );
    const without = await buildGenerateRequest(noAccess, () => ({}) as never, undefined, 'a brew timer');
    h.eq(without, { prompt: 'a brew timer' }, 'and no empty field is sent when there are none');
  });

  // ── flow-request.ts: leaving a step cancels its request, and a late response is discarded ──
  // (`prompt-flow` "Leaving clarify or rewrite cancels the in-flight request cleanly" and "A
  // response to a request the user has left cannot move the screen".) Behavioural: both halves of
  // the pattern are pure, so they run here for real; the rendered shell’s use is in prompt-flow-ui.

  await h.test('cancel: leaving compose aborts the clarify request it started', () => {
    const requests = new FlowRequests();
    const clarify = requests.start('compose');
    h.eq(clarify.controller.signal.aborted, false, 'the request starts live');
    requests.abort('compose');
    h.eq(clarify.controller.signal.aborted, true, 'leaving compose aborts the underlying request');
    h.eq(clarify.cancelled, true, 'and records the intent, since an abort and a failure look alike to the caller');
  });

  await h.test('cancel: leaving plan aborts rewrite and nothing else', () => {
    const requests = new FlowRequests();
    const clarify = requests.start('compose');
    const rewrite = requests.start('plan');
    requests.abort('plan');
    h.eq(rewrite.controller.signal.aborted, true, 'leaving plan aborts the rewrite request');
    h.eq(clarify.controller.signal.aborted, false, 'per-step controllers: the clarify request is untouched');
    h.eq(clarify.cancelled, false, 'and is not marked cancelled');
  });

  await h.test('cancel: a settled request releases only its own slot', () => {
    const requests = new FlowRequests();
    const first = requests.start('compose');
    const second = requests.start('compose');
    h.eq(first.controller.signal.aborted, true, 'a superseding request cancels the one it replaces');
    requests.release('compose', first);
    requests.abort('compose');
    h.eq(second.controller.signal.aborted, true, 'the stale request’s release did not strand the newer one');
  });

  await h.test('cancel: a late clarify response cannot move the screen off Home', () => {
    // The user backed out of compose to Home while clarify was in flight; the response lands
    // afterwards. It must be discarded, and Home must stay put.
    const toClarify = onlyOnStep<{ kind: string }, 'compose'>('compose', () => ({ kind: 'clarify' }));
    const home = { kind: 'home' };
    h.ok(toClarify(home) === home, 'the late response leaves the current screen untouched, by reference');
    h.eq(toClarify({ kind: 'compose' }).kind, 'clarify', 'while a compose step that never left still advances');
  });

  await h.test('cancel: a late rewrite response cannot move a screen the user already left', () => {
    const applied = onlyOnStep<{ kind: string }, 'plan'>('plan', () => ({ kind: 'plan-with-rows' }));
    const settings = { kind: 'settings' };
    h.ok(applied(settings) === settings, 'a rewrite that resolves after the plan step is gone is discarded');
    h.eq(applied({ kind: 'plan' }).kind, 'plan-with-rows', 'and still applies while the plan step is current');
  });

  // ── highlighting.ts: real behavior against a fake KVBackend (pattern: server-address above) ──

  await h.test('highlighting: default is ON when the key was never set', () => {
    const kv = new MapKVBackend();
    h.eq(loadHighlighting(kv), true, 'an absent key must resolve to ON');
  });

  await h.test('highlighting: save-off then load round-trips to off, and back on again', () => {
    const kv = new MapKVBackend();
    saveHighlighting(kv, false);
    h.eq(loadHighlighting(kv), false, 'saved OFF must read back OFF');
    saveHighlighting(kv, true);
    h.eq(loadHighlighting(kv), true, 'saved ON must read back ON');
  });

  await h.test('highlighting: a corrupt stored value defaults to ON, never throws', () => {
    const kv = new MapKVBackend();
    kv.set('highlighting', 'not-a-flag');
    let threw = false;
    let result: boolean | undefined;
    try {
      result = loadHighlighting(kv);
      // eslint-disable-next-line no-restricted-syntax -- intentional: the assertion IS "did it throw"; the thrown value is deliberately discarded and h.ok below reports the outcome
    } catch {
      threw = true;
    }
    h.ok(!threw, 'loadHighlighting must never throw on a corrupt stored value');
    h.eq(result, true, 'only the literal "0" reads as OFF — anything else, corrupt included, defaults ON');
  });

  await h.test('highlighting: never throws on a KVBackend returning null', () => {
    const kv = new MapKVBackend();
    const nullish = { ...kv, getString: () => null } as unknown as MapKVBackend;
    let threw = false;
    try {
      loadHighlighting(nullish);
      // eslint-disable-next-line no-restricted-syntax -- intentional: the assertion IS "did it throw"; the thrown value is deliberately discarded and h.ok below reports the outcome
    } catch {
      threw = true;
    }
    h.ok(!threw, 'loadHighlighting must never throw on a null read');
  });

}
