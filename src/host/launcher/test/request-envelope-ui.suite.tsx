/** The request envelope and the two refusals about the phone itself, driven through the rendered
 *  launcher against a scripted server (request-envelope chain-4/chain-5): what every `/v1` request
 *  carries and what `/health` never does, what a build without the native app-info module does
 *  instead of sending, where a `consent_required` or `update_required` refusal takes the user —
 *  from clarify, rewrite, a fresh build, a Retry, a build left running and a report — without
 *  losing what they typed, and what the launch-time `/health` minimum does (and, when it is
 *  missing, malformed or slow, doesn't do). */
import TestRenderer from 'react-test-renderer';
import { APP_VERSION_HEADER, BUILD_HEADER, CONSENT_HEADER, PLATFORM_HEADER, REQUEST_ID_HEADER } from '@whim/contract';
import { Harness } from './harness';
import HomeScreen from '../HomeScreen';
import { DescribePage } from '../DescribePage';
import { PlanPage } from '../PlanPage';
import BuildStep from '../BuildStep';
import FailureScreen from '../FailureScreen';
import { FirstRunSheet } from '../FirstRunSheet';
import HistoryScreen from '../HistoryScreen';
import DoneStep from '../DoneStep';
import MiniAppView from '../MiniAppView';
import Orb from '../Orb';
import UpdateRequiredScreen from '../UpdateRequiredScreen';
import { STORE_LISTINGS } from '../release-config';
import { COPY } from '../copy';
import { StoreAccess } from '../store-access';
import { PendingBuildStore } from '../pending-builds';
import { appInfoFrom, appInfoReader } from '../app-info';
import type { InstalledApp } from '../app-index';
import type { KVBackend } from '../../version-store/fs/kv-fs';
import { button, press, textOf, hostType } from './react-screen';
import { buildIt, composeAndContinue, json, onHome, planLoaded, resultEvent, settle, sseStream, tap, waitFor, wasSent, withLauncher, type SentRequest, type Tree } from './rendered-launcher';
import { startBuild, streamingServer } from './prompt-flow-ui.suite';
import { TEST_APP_INFO, streamResponse } from './client-fixtures';
import { Linking, Platform, injectedScripts } from './native-host';
import { APP_BUNDLES } from '../../../runtime/generated/app-bundles';
import { consentRequiredRefusal, updateRequiredRefusal, type ServiceRefusal } from '../../../../server/src/admission/refusals';
import { log } from '../../logging';
import { toDiagnostic } from '../../logging/diagnostic';

const ENVELOPE = [PLATFORM_HEADER, APP_VERSION_HEADER, BUILD_HEADER, CONSENT_HEADER];
const QUESTION = { id: 'alert', question: 'How should it tell you?', options: ['Sound', 'Buzz'], select: 'one', other: false };
const APP: InstalledApp = { id: 'timer', name: 'Timer', createdAt: 1, lineageId: 'main', record: { appId: 'timer', name: 'Timer', manifest: { capabilities: [] } } };

/** A refusal as the server's own builder makes it and its route answers it
 *  (`c.json(r.body, r.status, r.headers)`, handoff/envelope.md). */
const refused = (refusal: ServiceRefusal): Response =>
  new Response(JSON.stringify(refusal.body), { status: refusal.status, headers: { 'Content-Type': 'application/json', ...refusal.headers } });
const consentRefused = () => refused(consentRequiredRefusal());
const updateRefused = () => refused(updateRequiredRefusal());

// `/health` as the server's `GET /health` route answers it (`server/src/app.ts`, inline in
// `createApp`, so mirrored here); production answers without `minBuild` until the server that
// reports it is deployed.
const healthy = (minBuild?: unknown) => () =>
  json(minBuild === undefined ? { ok: true, service: 'whim-server' } : { ok: true, service: 'whim-server', minBuild });
/** A minimum one above the installed iOS test build; Android has none. */
const ABOVE = { ios: TEST_APP_INFO.build + 1, android: 0 };

const on = (tree: Tree, type: Parameters<Tree['root']['findAllByType']>[0]) => tree.root.findAllByType(type).length === 1;
const home = (tree: Tree) => tree.root.findByType(HomeScreen);
const updateShown = (tree: Tree) => on(tree, UpdateRequiredScreen);

/** Home, once first-run seeding has installed the examples; returns the Tip Splitter example. */
async function exampleApp(tree: Tree): Promise<InstalledApp> {
  await waitFor(() => on(tree, HomeScreen) && home(tree).props.apps.some((a: InstalledApp) => a.name === 'Tip Splitter'), 'the example apps');
  return home(tree).props.apps.find((a: InstalledApp) => a.name === 'Tip Splitter');
}

/** Open an installed app and let its page load: true when its own bundle was delivered into it. */
async function opensAndRuns(tree: Tree, app: InstalledApp, bundle: string): Promise<boolean> {
  injectedScripts.length = 0;
  await TestRenderer.act(async () => home(tree).props.onOpen(app));
  await waitFor(() => on(tree, MiniAppView), `${app.name} to open`);
  await TestRenderer.act(async () => tree.root.find((node) => hostType(node) === 'WebView').props.onLoadEnd());
  return injectedScripts.length === 1 && injectedScripts[0].includes(JSON.stringify(bundle));
}

/** Pick a reason in the open report sheet and send it. */
async function sendReportFromSheet(tree: Tree): Promise<void> {
  await waitFor(() => textOf(tree.root).includes(COPY.reportReasonBroken), 'the report draft');
  await press(button(tree, COPY.reportReasonBroken));
  await press(button(tree, COPY.reportSend));
}

/** Replace the store opener: `refuses(url)` makes that link fail to open. `tried` lists every link
 *  tried, in order; `restore` puts the real opener back. */
function stubStoreOpener(refuses: (url: string) => boolean): { tried: string[]; restore: () => void } {
  const original = Linking.openURL;
  const tried: string[] = [];
  Linking.openURL = async (url: string) => {
    tried.push(url);
    if (refuses(url)) throw new Error(`No app can open ${url}`);
    Linking.opened.push(url);
  };
  return { tried, restore: () => { Linking.openURL = original; } };
}

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
  await h.test('envelope: every /v1 request of a build carries the installed app and the grant; no /health probe carries any of it', async () => {
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

  await h.test('request id: a clarify the server fails logs its request id on every error record about it', async () => {
    const server = () =>
      new Response(JSON.stringify({}), { status: 500, headers: { 'Content-Type': 'application/json', [REQUEST_ID_HEADER]: 'req-clarify-9' } });
    await withLauncher({ server }, async ({ tree }) => {
      log.buffer.clear();
      await composeAndContinue(tree, 'A tea timer');
      await waitFor(() => on(tree, PlanPage) && tree.root.findByType(PlanPage).props.screen.problem !== undefined, 'the notice with Try again');
      const errors = log.buffer.snapshot().filter((r) => r.level === 'error');
      h.eq(
        errors.map((r) => [r.message, toDiagnostic(r).requestId]),
        [
          ['transport failed', 'req-clarify-9'],
          ['generation step failed', 'req-clarify-9'],
        ],
        'the transport breadcrumb and the step failure each carry it, and it survives the projection',
      );
    });
  });

  await h.test('request id: a build whose stream ends in a failure logs the stream’s request id with it', async () => {
    const streams: ReturnType<typeof sseStream>[] = [];
    const server = (r: SentRequest) => {
      if (r.path !== '/v1/generate') return streamingServer(streams)(r);
      const stream = sseStream(r.signal);
      streams.push(stream);
      return streamResponse(stream.response.body, { headers: { 'Content-Type': 'text/event-stream', [REQUEST_ID_HEADER]: 'req-gen-1' } });
    };
    await withLauncher({ server }, async ({ tree }) => {
      await startBuild(tree, 'A tea timer');
      log.buffer.clear();
      streams[0].push({ type: 'failure', reason: 'The app did not build.', attempts: 2, diagnostics: [{ kind: 'type', symbol: 'x', message: 'm', hint: 'Try fewer screens.' }] });
      streams[0].end();
      await waitFor(() => on(tree, FailureScreen), 'the failure screen');
      const shown = log.buffer.snapshot().filter((r) => r.message === 'failure screen shown');
      h.eq(shown.map((r) => [r.fields.errorClass, r.fields.requestId]), [['GenerationFailureEvent', 'req-gen-1']], 'the failure record names the stream’s request');
    });
  });

  await h.test('envelope: on a build missing the app-info module, Continue shows a notice on the plan page and sends nothing', async () => {
    await withLauncher({ appInfo: appInfoReader('ios', () => null), server: () => json({ questions: [] }) }, async ({ tree, paths }) => {
      await composeAndContinue(tree, 'A tea timer');
      await waitFor(() => on(tree, PlanPage) && tree.root.findByType(PlanPage).props.screen.problem !== undefined, 'the notice');
      h.eq(paths(), [], 'no /v1 request left the phone, with or without an envelope');
      h.ok(!textOf(tree.root).includes('WhimAppInfo'), 'and the page never shows the mechanism message');
    });
  });

  await h.test('consent_required on clarify: the first-run sheet says why; either answer returns to describe with the typed prompt', async () => {
    await withLauncher({ server: () => consentRefused() }, async ({ tree, sent }) => {
      await composeAndContinue(tree, 'A tea timer');
      await waitFor(() => on(tree, FirstRunSheet), 'the consent screen');
      h.eq(tree.root.findByType(FirstRunSheet).props.refused, true, 'opened by the refusal, not by a first ask');
      h.ok(textOf(tree.root).includes(COPY.permissionRequiredLine), 'saying why it is back');
      h.eq(tree.root.findAllByType(FailureScreen).length, 0, 'never the failure screen');
      await press(button(tree, COPY.consentDecline));
      h.ok(on(tree, DescribePage), 'Not now returns to describe');
      h.eq(tree.root.findByType(DescribePage).props.text, 'A tea timer', 'with the typed prompt');
      await tap(() => tree.root.findByType(DescribePage).props.onContinue());
      await waitFor(() => on(tree, FirstRunSheet), 'the consent screen, again');
      await press(button(tree, COPY.consentAgree));
      h.ok(on(tree, DescribePage), 'agreeing returns to describe too');
      h.eq([tree.root.findByType(DescribePage).props.text, tree.root.findByType(DescribePage).props.notice], ['A tea timer', undefined], 'with the typed prompt and no stale notice');
      h.eq(sent.filter((r) => r.path === '/v1/clarify').length, 2, 'each Continue sent one clarify, and agreeing sent nothing by itself');
    });
  });

  await h.test('consent_required on a rewrite: declining returns to describe with the typed prompt', async () => {
    await withLauncher({
      server: (r) => (r.path === '/v1/clarify' ? json({ questions: [QUESTION] }) : consentRefused()),
    }, async ({ tree }) => {
      await composeAndContinue(tree, 'A tea timer');
      await waitFor(() => on(tree, FirstRunSheet), 'the first-run sheet');
      await press(button(tree, COPY.consentDecline));
      h.ok(on(tree, DescribePage), 'back on the page whose Continue sent it');
      h.eq(tree.root.findByType(DescribePage).props.text, 'A tea timer', 'with the typed prompt');
    });
  });

  await h.test('consent_required on a fresh build: the attempt is dropped, and agreeing returns to the plan with its edited rows', async () => {
    await withLauncher({ server: flowServer(() => consentRefused()) }, async ({ tree, kv }) => {
      await composeAndContinue(tree, 'A tea timer');
      await waitFor(() => planLoaded(tree), 'the plan');
      await TestRenderer.act(async () => tree.root.findByType(PlanPage).props.onChangeRow(0, 'Counts down four minutes'));
      await buildIt(tree);
      await waitFor(() => on(tree, FirstRunSheet), 'the consent screen');
      h.eq(new PendingBuildStore(kv).list(), [], 'the refused attempt leaves no ghost');
      await press(button(tree, COPY.consentAgree));
      h.ok(on(tree, PlanPage), 'agreeing returns to the plan');
      h.eq(tree.root.findByType(PlanPage).props.screen.rows.map((row: { text: string }) => row.text), ['Counts down four minutes'], 'with the row as the user edited it');
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
        return generates <= 2 ? consentRefused() : sseStream(r.signal).response;
      },
    }, async ({ tree, sent, kv }) => {
      const ghost = new PendingBuildStore(kv).get('failed');
      await TestRenderer.act(async () => home(tree).props.onOpenPending(ghost));
      await press(button(tree, COPY.screenErrorRetry));
      await waitFor(() => on(tree, FirstRunSheet), 'the consent screen');
      await press(button(tree, COPY.consentDecline));
      h.ok(on(tree, FailureScreen), 'Not now returns to the failed build');
      h.eq(new PendingBuildStore(kv).get('failed')?.state, 'failed', 'whose record is still there to retry');
      await press(button(tree, COPY.screenErrorRetry));
      await waitFor(() => on(tree, FirstRunSheet), 'the consent screen, again');
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
      await TestRenderer.act(async () => { generation.resolve(consentRefused()); });
      await waitFor(() => new PendingBuildStore(kv).list()[0]?.state === 'failed', 'the refused run to settle');
      h.ok(onHome(tree), 'the user is still on Home');
      h.eq(new PendingBuildStore(kv).list()[0]?.failure?.reason, COPY.permissionRequiredLine, 'and the ghost keeps the phone’s reason');
    });
  });

  await h.test('update_required on clarify: the update screen opens; Not now goes Home, the next compose for that app has the prompt back, and Continue shows the screen again', async () => {
    await withLauncher({ apps: [APP], server: () => updateRefused() }, async ({ tree, sent }) => {
      await composeAndContinue(tree, 'A tea timer');
      await waitFor(() => updateShown(tree), 'the update screen');
      h.ok(textOf(tree.root).includes(COPY.updateTitle), 'saying Whim needs an update');
      h.eq(tree.root.findAllByType(FailureScreen).length, 0, 'never the failure screen');
      await press(button(tree, COPY.updateNotNow));
      h.ok(onHome(tree), 'Not now goes Home');
      await TestRenderer.act(async () => home(tree).props.onPromptAgain(APP));
      h.eq(tree.root.findByType(DescribePage).props.text, '', 'changing another app does not pick up the new app’s prompt');
      await press(button(tree, COPY.sheetClose));
      await TestRenderer.act(async () => home(tree).props.onCreate());
      h.eq(tree.root.findByType(DescribePage).props.text, 'A tea timer', 'the next new-app describe has the typed prompt back');
      await tap(() => tree.root.findByType(DescribePage).props.onContinue());
      await waitFor(() => updateShown(tree), 'the update screen, again');
      h.eq(sent.filter((r) => r.path === '/v1/clarify').length, 2, 'the second one came from the server refusing the next clarify');
    });
  });

  await h.test('update_required on a rewrite: the update screen opens, and the typed prompt comes back', async () => {
    await withLauncher({
      server: (r) => (r.path === '/v1/clarify' ? json({ questions: [QUESTION] }) : updateRefused()),
    }, async ({ tree }) => {
      await composeAndContinue(tree, 'A tea timer');
      await waitFor(() => updateShown(tree), 'the update screen');
      await press(button(tree, COPY.updateNotNow));
      await TestRenderer.act(async () => home(tree).props.onCreate());
      h.eq(tree.root.findByType(DescribePage).props.text, 'A tea timer', 'with the typed prompt');
    });
  });

  await h.test('update_required on a fresh build: the attempt is dropped, the update screen opens, and the typed prompt comes back', async () => {
    await withLauncher({ server: flowServer(() => updateRefused()) }, async ({ tree, kv }) => {
      await composeAndContinue(tree, 'A tea timer');
      await waitFor(() => planLoaded(tree), 'the plan');
      await buildIt(tree);
      await waitFor(() => updateShown(tree), 'the update screen');
      h.eq(new PendingBuildStore(kv).list(), [], 'the refused attempt leaves no ghost');
      await press(button(tree, COPY.updateNotNow));
      await TestRenderer.act(async () => home(tree).props.onCreate());
      h.eq(tree.root.findByType(DescribePage).props.text, 'A tea timer', 'with the typed prompt');
    });
  });

  await h.test('update_required on a Retry: the update screen opens, and the failed ghost keeps its prompt on Home', async () => {
    await withLauncher({
      prepare: (kv) => {
        const pending = new PendingBuildStore(kv);
        pending.create({ id: 'failed', prompt: 'A tea timer', workingTitle: 'Tea timer' });
        pending.setFailed('failed', { reason: 'Server stopped', diagnostics: '' });
      },
      server: () => updateRefused(),
    }, async ({ tree, kv }) => {
      await TestRenderer.act(async () => home(tree).props.onOpenPending(new PendingBuildStore(kv).get('failed')));
      await press(button(tree, COPY.screenErrorRetry));
      await waitFor(() => updateShown(tree), 'the update screen');
      await press(button(tree, COPY.updateNotNow));
      h.ok(onHome(tree), 'Not now goes Home');
      h.eq(new PendingBuildStore(kv).list().map((r) => [r.id, r.state, r.prompt]), [['failed', 'failed', 'A tea timer']], 'where the ghost still holds the prompt to retry');
    });
  });

  await h.test('update_required on a build left running: from Home the update screen opens, and the ghost keeps the prompt and says why', async () => {
    const generation = heldResponse();
    await withLauncher({ server: flowServer(() => generation.promise) }, async ({ tree, kv }) => {
      await composeAndContinue(tree, 'A tea timer');
      await waitFor(() => planLoaded(tree), 'the plan');
      await buildIt(tree);
      await waitFor(() => on(tree, BuildStep), 'the build screen');
      await press(button(tree, COPY.buildLeaveRunning));
      await TestRenderer.act(async () => { generation.resolve(updateRefused()); });
      await waitFor(() => updateShown(tree), 'the update screen');
      const ghost = new PendingBuildStore(kv).list()[0];
      h.eq([ghost?.state, ghost?.prompt, ghost?.failure?.reason], ['failed', 'A tea timer', COPY.updateRequiredLine], 'the ghost keeps the prompt and the phone’s reason');
    });
  });

  await h.test('update_required on a build left running while an installed app runs: the app keeps running', async () => {
    const generation = heldResponse();
    await withLauncher({ examples: true, server: flowServer(() => generation.promise) }, async ({ tree, kv }) => {
      const example = await exampleApp(tree);
      await composeAndContinue(tree, 'A tea timer');
      await waitFor(() => planLoaded(tree), 'the plan');
      await buildIt(tree);
      await waitFor(() => on(tree, BuildStep), 'the build screen');
      await press(button(tree, COPY.buildLeaveRunning));
      h.ok(await opensAndRuns(tree, example, APP_BUNDLES['tip-splitter']), 'the example opens and runs');
      await TestRenderer.act(async () => { generation.resolve(updateRefused()); });
      await waitFor(() => new PendingBuildStore(kv).list()[0]?.state === 'failed', 'the refused run to settle');
      h.ok(on(tree, MiniAppView) && !updateShown(tree), 'the running app stays on screen');
    });
  });

  type Streams = ReturnType<typeof sseStream>[];
  const reportEntries: { name: string; examples: boolean; open: (tree: Tree, streams: Streams) => Promise<void> }[] = [
    {
      name: 'the done step',
      examples: false,
      open: async (tree, streams) => {
        await startBuild(tree, 'A tea timer');
        streams[0].push(resultEvent('Tea Timer'));
        streams[0].end();
        await waitFor(() => on(tree, DoneStep), 'the done step');
        await TestRenderer.act(async () => tree.root.findByType(DoneStep).props.onReport());
      },
    },
    {
      name: 'history',
      examples: true,
      open: async (tree) => {
        const example = await exampleApp(tree);
        await TestRenderer.act(async () => home(tree).props.onHistory(example));
        await TestRenderer.act(async () => tree.root.findByType(HistoryScreen).props.onReport());
      },
    },
    {
      name: 'a running app’s orb',
      examples: true,
      open: async (tree) => {
        const example = await exampleApp(tree);
        await TestRenderer.act(async () => home(tree).props.onOpen(example));
        await waitFor(() => on(tree, MiniAppView), 'the example to open');
        await TestRenderer.act(async () => tree.root.findByType(Orb).props.onReport());
      },
    },
  ];
  for (const entry of reportEntries) {
    await h.test(`update_required on a report from ${entry.name}: the update screen replaces it, and Not now goes Home`, async () => {
      const streams: Streams = [];
      const deliver = streamingServer(streams);
      await withLauncher({
        examples: entry.examples,
        server: (r) => (r.path === '/v1/report' ? updateRefused() : deliver(r)),
      }, async ({ tree, sent }) => {
        await entry.open(tree, streams);
        await sendReportFromSheet(tree);
        await waitFor(() => updateShown(tree), 'the update screen');
        h.ok(wasSent(sent, '/v1/report'), 'after the server refused the report');
        h.ok(!textOf(tree.root).includes(COPY.reportSheetTitle), 'the sheet is gone');
        await press(button(tree, COPY.updateNotNow));
        h.ok(onHome(tree), 'Not now goes Home');
      });
    });
  }

  await h.test('launch check: below this platform’s minimum, the update screen replaces Home without waiting for a request; Not now leaves installed apps running; the next AI action shows it again', async () => {
    await withLauncher({ examples: true, health: healthy(ABOVE), server: () => updateRefused() }, async ({ tree, sent }) => {
      await waitFor(() => updateShown(tree), 'the update screen');
      h.eq([tree.root.findAllByType(HomeScreen).length, sent.length], [0, 0], 'in place of Home, before any /v1 request');
      await press(button(tree, COPY.updateNotNow));
      h.ok(onHome(tree), 'Not now goes Home');
      const example = await exampleApp(tree);
      h.ok(await opensAndRuns(tree, example, APP_BUNDLES['tip-splitter']), 'an example app opens and runs');
      await TestRenderer.act(async () => tree.root.findByType(MiniAppView).props.onExit());
      await composeAndContinue(tree, 'A tea timer');
      await waitFor(() => updateShown(tree), 'the update screen, on the next AI action');
      h.eq(sent.map((r) => r.path), ['/v1/clarify'], 'shown again by the server refusing that action');
    });
  });

  await h.test('launch check: a minimum that lands while a prompt is being typed replaces compose with the update screen, holding the typed prompt', async () => {
    const health = heldResponse();
    await withLauncher({ health: () => health.promise, server: () => updateRefused() }, async ({ tree, sent, probes }) => {
      await waitFor(() => probes.length > 0, 'the launch probe');
      await TestRenderer.act(async () => home(tree).props.onCreate());
      await TestRenderer.act(async () => tree.root.findByType(DescribePage).props.onChangeText('A tea timer'));
      h.ok(on(tree, DescribePage) && !updateShown(tree), 'while /health has not answered, the user types in compose');
      await TestRenderer.act(async () => { health.resolve(healthy(ABOVE)()); });
      await waitFor(() => updateShown(tree), 'the update screen, once the minimum arrives');
      h.eq([tree.root.findAllByType(DescribePage).length, sent.length], [0, 0], 'in place of compose, with nothing sent');
      await press(button(tree, COPY.updateNotNow));
      h.ok(onHome(tree), 'Not now goes Home');
      await TestRenderer.act(async () => home(tree).props.onCreate());
      h.eq(tree.root.findByType(DescribePage).props.text, 'A tea timer', 'and the next compose has the typed prompt back');
    });
  });

  await h.test('launch check: a request sent before the check lands is refused update_required and shows the same screen, holding the typed prompt', async () => {
    const health = heldResponse();
    await withLauncher({ health: () => health.promise, server: () => updateRefused() }, async ({ tree, sent, probes }) => {
      await waitFor(() => probes.length > 0, 'the launch probe');
      await composeAndContinue(tree, 'A tea timer');
      await waitFor(() => updateShown(tree), 'the update screen');
      h.eq(sent.map((r) => r.path), ['/v1/clarify'], 'shown by the server refusing the clarify, while /health is still unanswered');
      await press(button(tree, COPY.updateNotNow));
      h.ok(onHome(tree), 'Not now goes Home');
      await TestRenderer.act(async () => home(tree).props.onCreate());
      h.eq(tree.root.findByType(DescribePage).props.text, 'A tea timer', 'and the next compose has the typed prompt back');
    });
  });

  const noMinimum: { name: string; health: () => Response | Promise<Response> }[] = [
    { name: 'no minBuild (production today)', health: healthy() },
    { name: 'the default configuration, both 0', health: healthy({ ios: 0, android: 0 }) },
    { name: 'a minimum equal to this build', health: healthy({ ios: TEST_APP_INFO.build, android: 0 }) },
    { name: 'only the other platform above', health: healthy({ ios: 0, android: TEST_APP_INFO.build + 1 }) },
    { name: 'a minimum sent as a string', health: healthy({ ios: String(ABOVE.ios), android: 0 }) },
    { name: 'a platform missing', health: healthy({ ios: ABOVE.ios }) },
    { name: 'a fractional minimum', health: healthy({ ios: ABOVE.ios + 0.5, android: 0 }) },
    { name: 'minBuild not an object', health: healthy(ABOVE.ios) },
    { name: 'another service’s minimum', health: () => json({ ok: true, service: 'whim-server-loadtest', minBuild: ABOVE }) },
    { name: 'an unhealthy /health', health: () => json({ ok: true, service: 'whim-server', minBuild: ABOVE }, 503) },
    { name: 'an unreachable /health', health: () => { throw new TypeError('fetch failed'); } },
  ];
  for (const entry of noMinimum) {
    await h.test(`launch check: ${entry.name} — no update screen, and the prompt works as before`, async () => {
      await withLauncher({ health: entry.health, server: flowServer(() => json({})) }, async ({ tree, probes }) => {
        await waitFor(() => probes.length > 0, 'the launch probe');
        await settle();
        h.ok(onHome(tree), 'Home, not the update screen');
        await composeAndContinue(tree, 'A tea timer');
        await waitFor(() => planLoaded(tree), 'the plan');
        h.ok(!updateShown(tree), 'the prompt went through clarify and rewrite, and no update screen opened');
      });
    });
  }

  await h.test('launch check: a server from before /health (404 there, minimums on /healthz) still opens the update screen', async () => {
    await withLauncher({ examples: true, olderServer: true, health: healthy(ABOVE), server: () => updateRefused() }, async ({ tree, probeUrls }) => {
      await waitFor(() => updateShown(tree), 'the update screen');
      h.eq(probeUrls.map((url) => new URL(url).pathname), ['/health', '/healthz'], 'the minimum was read from the fallback');
    });
  });

  await h.test('launch check: a /health that never answers holds nothing up — the prompt works as before', async () => {
    await withLauncher({ health: () => new Promise<Response>(() => {}), server: flowServer(() => json({})) }, async ({ tree, probes }) => {
      await waitFor(() => probes.length > 0, 'the launch probe');
      await composeAndContinue(tree, 'A tea timer');
      await waitFor(() => planLoaded(tree), 'the plan');
      h.ok(!updateShown(tree), 'no update screen');
    });
  });

  await h.test('Update Whim on Android: when the market:// link can’t open, the https Play listing opens instead, and the screen stays', async () => {
    const os = Platform.OS;
    Platform.OS = 'android';
    const opener = stubStoreOpener((url) => url.startsWith('market:'));
    const androidBuild = () => appInfoFrom('android', { version: '1.4.0', build: '380642' });
    try {
      await withLauncher({ appInfo: androidBuild, health: healthy({ ios: 0, android: 380643 }), server: () => updateRefused() }, async ({ tree }) => {
        await waitFor(() => updateShown(tree), 'the update screen');
        await press(button(tree, COPY.updateAction));
        await waitFor(() => opener.tried.length === 2, 'the fallback');
        h.eq(opener.tried, [STORE_LISTINGS.android.store, STORE_LISTINGS.android.web], 'the Play Store app first, then the web listing');
        h.ok(opener.tried[0].startsWith('market://') && opener.tried[1].startsWith('https://play.google.com/'), 'a market:// link, then the https Play listing');
        h.ok(updateShown(tree), 'the screen stays up');
      });
    } finally {
      opener.restore();
      Platform.OS = os;
    }
  });

  await h.test('Update Whim on iOS: when neither link opens, the screen stays up and nothing crashes', async () => {
    const opener = stubStoreOpener(() => true);
    try {
      await withLauncher({ health: healthy(ABOVE), server: () => updateRefused() }, async ({ tree }) => {
        await waitFor(() => updateShown(tree), 'the update screen');
        await press(button(tree, COPY.updateAction));
        await waitFor(() => opener.tried.length === 2, 'both links tried');
        await settle();
        h.eq(opener.tried, [STORE_LISTINGS.ios.store, STORE_LISTINGS.ios.web], 'the App Store app first, then the https listing');
        h.ok(updateShown(tree), 'the screen stays up');
      });
    } finally {
      opener.restore();
    }
  });
}
