/** The request envelope and the two refusals about the phone itself, driven through the rendered
 *  launcher against a scripted server (request-envelope chain-4): what every `/v1` request carries
 *  and what `/healthz` never does, what a build without the native app-info module does instead of
 *  sending, and where a `consent_required` or `update_required` refusal takes the user — from
 *  clarify, rewrite, a fresh build, a Retry and a build left running — without losing what they
 *  typed. */
import TestRenderer from 'react-test-renderer';
import { APP_VERSION_HEADER, BUILD_HEADER, CONSENT_HEADER, PLATFORM_HEADER } from '@whim/contract';
import { Harness } from './harness';
import HomeScreen from '../HomeScreen';
import ComposeStep from '../ComposeStep';
import ClarifyStep from '../ClarifyStep';
import PlanStep from '../PlanStep';
import BuildStep from '../BuildStep';
import FailureScreen from '../FailureScreen';
import ConsentScreen from '../ConsentScreen';
import HistoryScreen from '../HistoryScreen';
import { COPY } from '../copy';
import { StoreAccess } from '../store-access';
import { PendingBuildStore } from '../pending-builds';
import { appInfoReader } from '../app-info';
import type { InstalledApp } from '../app-index';
import type { KVBackend } from '../../version-store/fs/kv-fs';
import { button, press, textOf } from './react-screen';
import { buildIt, composeAndContinue, json, planLoaded, sseStream, tap, waitFor, wasSent, withLauncher, type SentRequest, type Tree } from './rendered-launcher';
import { startBuild, streamingServer } from './prompt-flow-ui.suite';
import { TEST_APP_INFO } from './client-fixtures';

const ENVELOPE = [PLATFORM_HEADER, APP_VERSION_HEADER, BUILD_HEADER, CONSENT_HEADER];
const QUESTION = { id: 'alert', question: 'How should it tell you?', options: ['Sound', 'Buzz'] };
const APP: InstalledApp = { id: 'timer', name: 'Timer', createdAt: 1, lineageId: 'main', record: { appId: 'timer', name: 'Timer', manifest: { capabilities: [] } } };
// The server's own refusal bodies (`server/src/admission/refusals.ts`, handoff/envelope.md).
const CONSENT_REFUSAL = { error: 'consent_required', hint: 'Whim needs your permission to send requests to its AI service.' };
const UPDATE_REFUSAL = { error: 'update_required', hint: 'Update Whim to the latest version to keep using its AI features.' };

const on = (tree: Tree, type: Parameters<Tree['root']['findAllByType']>[0]) => tree.root.findAllByType(type).length === 1;
const home = (tree: Tree) => tree.root.findByType(HomeScreen);

/** The version the stored grant names — what a request sent under it must say. */
function grantedVersion(kv: KVBackend): string {
  return String((JSON.parse(kv.getString('whim.ai-consent:v1') ?? 'null') as { version: number }).version);
}

/** The envelope a request carried: platform, version, build, consent. */
function envelopeOf(request: SentRequest): (string | null)[] {
  return ENVELOPE.map((name) => request.headers.get(name));
}

/** Whether a request carried any envelope header at all. */
function carriesEnvelope(headers: Headers): boolean {
  return ENVELOPE.some((name) => headers.has(name));
}

/** A response the test sends by hand. */
function heldResponse() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((r) => { resolve = r; });
  return { promise, resolve };
}

/** Answers clarify with `questions` and rewrite with a one-row plan; every other path with `rest`. */
function flowServer(rest: (r: SentRequest) => Response | Promise<Response>, questions: unknown[] = []) {
  return (r: SentRequest) => {
    if (r.path === '/v1/clarify') return json({ questions });
    if (r.path === '/v1/rewrite') return json({ rewrittenPrompt: String(r.body?.prompt), plan: [{ label: 'Timer', text: 'Counts down five minutes' }] });
    return rest(r);
  };
}

export async function runRequestEnvelopeUiTests(h: Harness): Promise<void> {
  await h.test('envelope: every /v1 request of a build carries the installed app and the grant; no /healthz probe carries any of it', async () => {
    const streams: ReturnType<typeof sseStream>[] = [];
    await withLauncher({ server: streamingServer(streams) }, async ({ tree, sent, probes, kv }) => {
      await startBuild(tree, 'A tea timer');
      h.eq(sent.map((r) => r.path), ['/v1/clarify', '/v1/rewrite', '/v1/generate'], 'the build sent its three requests');
      for (const request of sent) {
        h.eq(
          envelopeOf(request),
          [TEST_APP_INFO.platform, TEST_APP_INFO.version, String(TEST_APP_INFO.build), grantedVersion(kv)],
          `${request.path}: the installed platform, version and build, and the granted consent version`,
        );
      }
      h.ok(probes.length > 0, 'the connectivity probe ran');
      h.eq(probes.filter(carriesEnvelope).length, 0, 'and no probe carried an envelope header');
    });
  });

  await h.test('envelope: a report sent without a grant says so with none, and still names the installed app', async () => {
    // The test app has no version-store repo; stub the reads the history screen and the report
    // draft make (class methods are not enumerable, so they are saved by name).
    const { timeline, activeId, activeDescription, activeSource } = StoreAccess.prototype;
    const original = { timeline, activeId, activeDescription, activeSource };
    StoreAccess.prototype.timeline = async () => [];
    StoreAccess.prototype.activeId = async () => null;
    StoreAccess.prototype.activeDescription = async () => 'A tea timer';
    StoreAccess.prototype.activeSource = async () => 'export default {}';
    try {
      await withLauncher({ consent: false, apps: [APP], server: () => json({ reportId: 'r-1' }, 202) }, async ({ tree, sent }) => {
        await TestRenderer.act(async () => home(tree).props.onHistory(APP));
        await TestRenderer.act(async () => tree.root.findByType(HistoryScreen).props.onReport());
        await waitFor(() => textOf(tree.root).includes(COPY.reportReasonBroken), 'the report draft');
        await press(button(tree, COPY.reportReasonBroken));
        await press(button(tree, COPY.reportSend));
        await waitFor(() => wasSent(sent, '/v1/report'), 'the report request');
        const report = sent.find((r) => r.path === '/v1/report') as SentRequest;
        h.eq(envelopeOf(report), [TEST_APP_INFO.platform, TEST_APP_INFO.version, String(TEST_APP_INFO.build), 'none'], 'consent none, next to the installed app');
      });
    } finally {
      Object.assign(StoreAccess.prototype, original);
    }
  });

  await h.test('envelope: on a build missing the app-info module, Continue shows the failure screen and sends nothing', async () => {
    await withLauncher({ appInfo: appInfoReader('ios', () => null), server: () => json({ questions: [] }) }, async ({ tree, paths }) => {
      await composeAndContinue(tree, 'A tea timer');
      await waitFor(() => on(tree, FailureScreen), 'the failure screen');
      h.eq(paths(), [], 'no /v1 request left the phone, with or without an envelope');
      h.ok(!textOf(tree.root).includes('WhimAppInfo'), 'and the screen never shows the mechanism message');
    });
  });

  await h.test('consent_required on clarify: the consent screen says why; either answer returns to compose with the typed prompt', async () => {
    await withLauncher({ server: () => json(CONSENT_REFUSAL, 403) }, async ({ tree, sent }) => {
      await composeAndContinue(tree, 'A tea timer');
      await waitFor(() => on(tree, ConsentScreen), 'the consent screen');
      h.eq(tree.root.findByType(ConsentScreen).props.mode, 'ask', 'in ask mode');
      h.ok(textOf(tree.root).includes(COPY.permissionRequiredLine), 'saying why it is back');
      h.eq(tree.root.findAllByType(FailureScreen).length, 0, 'never the failure screen');
      await press(button(tree, COPY.consentDecline));
      h.ok(on(tree, ComposeStep), 'Not now returns to compose');
      h.eq(tree.root.findByType(ComposeStep).props.text, 'A tea timer', 'with the typed prompt');
      await tap(() => tree.root.findByType(ComposeStep).props.onContinue());
      await waitFor(() => on(tree, ConsentScreen), 'the consent screen, again');
      await press(button(tree, COPY.consentAgree));
      h.ok(on(tree, ComposeStep), 'agreeing returns to compose too');
      h.eq([tree.root.findByType(ComposeStep).props.text, tree.root.findByType(ComposeStep).props.notice], ['A tea timer', undefined], 'with the typed prompt and no stale notice');
      h.eq(sent.filter((r) => r.path === '/v1/clarify').length, 2, 'each Continue sent one clarify, and agreeing sent nothing by itself');
    });
  });

  await h.test('consent_required on a rewrite sent from clarify: declining returns to clarify with the answers', async () => {
    await withLauncher({
      server: (r) => (r.path === '/v1/clarify' ? json({ questions: [QUESTION] }) : json(CONSENT_REFUSAL, 403)),
    }, async ({ tree }) => {
      await composeAndContinue(tree, 'A tea timer');
      await waitFor(() => on(tree, ClarifyStep) && !tree.root.findByType(ClarifyStep).props.loading, 'the question');
      await TestRenderer.act(async () => tree.root.findByType(ClarifyStep).props.onAnswer('alert', 'Buzz'));
      await tap(() => tree.root.findByType(ClarifyStep).props.onContinue());
      await waitFor(() => on(tree, ConsentScreen), 'the consent screen');
      await press(button(tree, COPY.consentDecline));
      h.ok(on(tree, ClarifyStep), 'back on the clarify step that sent it');
      h.eq([tree.root.findByType(ClarifyStep).props.prompt, tree.root.findByType(ClarifyStep).props.answers], ['A tea timer', { alert: 'Buzz' }], 'prompt and answers intact');
    });
  });

  await h.test('consent_required on a fresh build: the attempt is dropped, and agreeing returns to the plan with its edited rows', async () => {
    await withLauncher({ server: flowServer(() => json(CONSENT_REFUSAL, 403)) }, async ({ tree, kv }) => {
      await composeAndContinue(tree, 'A tea timer');
      await waitFor(() => planLoaded(tree), 'the plan');
      await TestRenderer.act(async () => tree.root.findByType(PlanStep).props.onChangeRow(0, 'Counts down four minutes'));
      await buildIt(tree);
      await waitFor(() => on(tree, ConsentScreen), 'the consent screen');
      h.eq(new PendingBuildStore(kv).list(), [], 'the refused attempt leaves no ghost');
      await press(button(tree, COPY.consentAgree));
      h.ok(on(tree, PlanStep), 'agreeing returns to the plan');
      h.eq(tree.root.findByType(PlanStep).props.rows.map((row: { text: string }) => row.text), ['Counts down four minutes'], 'with the row as the user edited it');
    });
  });

  await h.test('consent_required on a Retry: declining keeps the failed ghost; agreeing retries the same record', async () => {
    let generates = 0;
    await withLauncher({
      prepare: (kv) => {
        const pending = new PendingBuildStore(kv);
        pending.create({ id: 'failed', prompt: 'A tea timer', workingTitle: 'Tea timer' });
        pending.setFailed('failed', { reason: 'Server stopped', diagnostics: '' });
      },
      // The first two generations are refused; the third streams.
      server: (r) => {
        generates++;
        return generates <= 2 ? json(CONSENT_REFUSAL, 403) : sseStream(r.signal).response;
      },
    }, async ({ tree, sent, kv }) => {
      const ghost = new PendingBuildStore(kv).get('failed');
      await TestRenderer.act(async () => home(tree).props.onOpenPending(ghost));
      await press(button(tree, COPY.screenErrorRetry));
      await waitFor(() => on(tree, ConsentScreen), 'the consent screen');
      await press(button(tree, COPY.consentDecline));
      h.ok(on(tree, FailureScreen), 'Not now returns to the failed build');
      h.eq(new PendingBuildStore(kv).get('failed')?.state, 'failed', 'whose record is still there to retry');
      await press(button(tree, COPY.screenErrorRetry));
      await waitFor(() => on(tree, ConsentScreen), 'the consent screen, again');
      await press(button(tree, COPY.consentAgree));
      await waitFor(() => on(tree, BuildStep), 'the retried build');
      h.eq(sent.filter((r) => r.path === '/v1/generate').map((r) => r.body?.prompt), ['A tea timer', 'A tea timer', 'A tea timer'], 'agreeing retried the stored prompt');
      h.eq(new PendingBuildStore(kv).list().map((r) => [r.id, r.state]), [['failed', 'building']], 'on the same record');
    });
  });

  await h.test('consent_required on a build left running: the user stays where they are, and the ghost says why', async () => {
    const generation = heldResponse();
    await withLauncher({ server: flowServer(() => generation.promise) }, async ({ tree, kv }) => {
      await composeAndContinue(tree, 'A tea timer');
      await waitFor(() => planLoaded(tree), 'the plan');
      await buildIt(tree);
      await waitFor(() => on(tree, BuildStep), 'the build screen');
      await press(button(tree, COPY.buildLeaveRunning));
      await TestRenderer.act(async () => { generation.resolve(json(CONSENT_REFUSAL, 403)); });
      await waitFor(() => new PendingBuildStore(kv).list()[0]?.state === 'failed', 'the refused run to settle');
      h.ok(on(tree, HomeScreen), 'the user is still on Home');
      h.eq(new PendingBuildStore(kv).list()[0]?.failure?.reason, COPY.permissionRequiredLine, 'and the ghost keeps the phone’s reason');
    });
  });

  // The update screen is not built yet (request-envelope chain-5); until it is, the refusal is still
  // recognised and lands as a notice on the step that sent it, in the phone's own words.
  await h.test('update_required on clarify: recognised, not an unknown failure — compose keeps the prompt and says to update', async () => {
    await withLauncher({ server: () => json(UPDATE_REFUSAL, 426) }, async ({ tree }) => {
      await composeAndContinue(tree, 'A tea timer');
      await waitFor(() => textOf(tree.root).includes(COPY.updateRequiredLine), 'the refusal to land');
      h.ok(on(tree, ComposeStep), 'it lands on compose');
      h.eq(tree.root.findByType(ComposeStep).props.text, 'A tea timer', 'with the typed prompt');
      h.eq(tree.root.findAllByType(FailureScreen).length, 0, 'never the failure screen');
    });
  });
}
