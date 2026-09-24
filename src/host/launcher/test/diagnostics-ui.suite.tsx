/**
 * diagnostics-ui — what the rendered launcher sends off the phone when something fails
 * (developer-observability review F1/F3; spec device-diagnostics "Only an allowlisted projection
 * of an error record leaves the device" and "Uncaught host errors and fatal JS errors are
 * captured").
 *
 * The failure comes from the real producer: the server's own plan parser and validator turn a
 * model's plan into the sentence a `plan_failed` terminal carries, and the real shell shows it and
 * logs it through the real seam into the real upload gate. The recorded POST body is the evidence.
 */

import React from 'react';
import TestRenderer from 'react-test-renderer';
import type { DiagnosticsBatch, GenerateRequest } from '@whim/contract';
import { Harness } from './harness';
import FailureScreen from '../FailureScreen';
import { diagnosticsTarget } from '../diagnostics-target';
import RootErrorBoundary from '../../RootErrorBoundary';
import { createSeam, log } from '../../logging';
import { CHANNELS } from '../../logging/channels';
import { renderCrashRecorder } from '../../logging/crash-capture';
import { keepFatalRecord, sendFatalRecord } from '../../logging/fatal-slot';
import { DIAGNOSTICS_PATH } from '../../logging/diagnostics';
import type { PostDiagnostics } from '../../logging/diagnostics';
import { parsePlan, validatePlan } from '../../../../server/src/generation/plan';
import { MapKVBackend } from '../../version-store/fs/kv-fs';
import { acceptTerms } from '../terms-acceptance';
import { grantConsent } from '../ai-consent';
import { saveServerUrl } from '../server-address';
import { testAppInfo } from './client-fixtures';
import { waitFor, withLauncher, type sseStream, type Tree } from './rendered-launcher';
import { startBuild, streamingServer } from './prompt-flow-ui.suite';

const on = (tree: Tree, type: Parameters<Tree['root']['findAllByType']>[0]) => tree.root.findAllByType(type).length === 1;

/** A plan the model wrote for a prompt about Alice's Lisbon trip, naming one screen twice. */
const PLAN_WITH_REPEATED_SCREEN = [
  '```json',
  JSON.stringify({
    screens: [
      { name: "Alice's Lisbon Tab", purpose: 'Who paid what in Lisbon' },
      { name: "Alice's Lisbon Tab", purpose: 'Settle up' },
    ],
    initial: "Alice's Lisbon Tab",
    state: ['expenses'],
    capabilities: [],
    storageKeys: [],
  }),
  '```',
].join('\n');

/** The reason the server's plan stage gives for `plan`, as its `plan_failed` terminal carries it. */
function planFailureReason(plan: string, request: GenerateRequest): string {
  const parsed = parsePlan(plan);
  if (!parsed.ok) throw new Error(`fixture precondition: the plan parses (${parsed.reason})`);
  const validated = validatePlan(parsed.plan, request);
  if (validated.ok) throw new Error('fixture precondition: the plan fails validation');
  return validated.reason;
}

/** Throws while rendering, as a provider or the shell outside every screen boundary might. */
function ThrowsWhileRendering({ error }: Readonly<{ error: Error }>): React.ReactElement {
  throw error;
}

/** A diagnostics POST that records each body it is given and answers `204`. */
function recordingPost(bodies: string[]): PostDiagnostics {
  return async (url, _headers, body) => {
    if (url.endsWith(DIAGNOSTICS_PATH)) bodies.push(body);
    return { ok: true, status: 204 };
  };
}

export async function runDiagnosticsUiTests(h: Harness): Promise<void> {
  await h.test('diagnostics: a plan_failed terminal naming the user’s screens reaches the upload as a code, never as its sentence', async () => {
    const streams: ReturnType<typeof sseStream>[] = [];
    const bodies: string[] = [];
    const post = recordingPost(bodies);
    await withLauncher({ server: streamingServer(streams) }, async ({ tree, kv, sent }) => {
      log.diagnostics.configure({ target: diagnosticsTarget(kv, testAppInfo, true), post, osVersion: '15' });
      try {
        await startBuild(tree, "A shared tab for Alice's Lisbon trip");
        const request = sent.find((r) => r.path === '/v1/generate')?.body as GenerateRequest | undefined;
        h.ok(request !== undefined, 'the build sent its generation request');
        const reason = planFailureReason(PLAN_WITH_REPEATED_SCREEN, request ?? { prompt: '' });
        h.ok(reason.includes("Alice's Lisbon Tab"), `fixture precondition: the validator's sentence names the screen (${reason})`);
        streams[0].push({ type: 'failure', reason, attempts: 0, diagnostics: [] });
        streams[0].end();
        await waitFor(() => on(tree, FailureScreen), 'the failure screen');
        h.eq(tree.root.findByType(FailureScreen).props.reason, reason, 'the screen still shows the server’s sentence');
        await TestRenderer.act(async () => { await log.diagnostics.flush(); });
      } finally {
        log.diagnostics.stop();
        log.diagnostics.configure({ target: () => null });
      }
    });
    const records = bodies.flatMap((body) => (JSON.parse(body) as DiagnosticsBatch).records);
    const shown = records.filter((r) => r.message === 'failure screen shown');
    h.eq(shown.map((r) => [r.reason, r.errorClass]), [['terminal_failure', 'GenerationFailureEvent']], 'the upload carries the failure as its closed code');
    for (const word of ['Alice', 'Lisbon']) {
      h.ok(bodies.length > 0 && !bodies.some((body) => body.includes(word)), `"${word}" appears nowhere in the upload`);
    }
  });

  await h.test('root boundary: a render error outside every screen is recorded, kept, and still reaches React’s uncaught path; the next launch sends it', async () => {
    const kv = new MapKVBackend();
    acceptTerms(kv, '2026-09-24T00:00:00.000Z');
    grantConsent(kv, '2026-09-24T00:00:00.000Z');
    saveServerUrl(kv, 'http://127.0.0.1:8787');
    const target = diagnosticsTarget(kv, testAppInfo, true);
    const seam = createSeam({ console: false, diagnostics: { target, osVersion: '15', post: recordingPost([]) } });
    const onError = renderCrashRecorder({ seam, keepFatal: (record) => keepFatalRecord(kv, seam.diagnostics, record) });
    const error = new TypeError("cannot read 'Alice' of undefined");

    let uncaught: unknown;
    try {
      await TestRenderer.act(async () => {
        TestRenderer.create(
          <RootErrorBoundary onError={onError}>
            <ThrowsWhileRendering error={error} />
          </RootErrorBoundary>,
        );
      });
    } catch (thrown) {
      uncaught = thrown;
    }
    seam.diagnostics.stop();
    const reachedRoot = uncaught === error || (uncaught instanceof AggregateError && uncaught.errors.includes(error));
    h.ok(reachedRoot, `the same error was rethrown to the root as uncaught (got ${String(uncaught)})`);
    const records = seam.buffer.snapshot().filter((r) => r.channel === CHANNELS.app && r.level === 'error');
    h.eq(records.map((r) => [r.fields.where, r.fields.errorClass]), [['render', 'TypeError']], 'one error record names the render site and class');

    const bodies: string[] = [];
    const nextLaunch = createSeam({ console: false, diagnostics: { target, osVersion: '15', post: recordingPost(bodies) } });
    await sendFatalRecord(kv, nextLaunch.diagnostics);
    const sentRecords = bodies.flatMap((body) => (JSON.parse(body) as DiagnosticsBatch).records);
    h.eq(sentRecords.map((r) => [r.message, r.where, r.errorClass]), [['uncaught render error', 'render', 'TypeError']], 'the next launch uploads the kept record');
    h.ok(!bodies.some((body) => body.includes('Alice')), 'without the message');
  });

  await h.test('root boundary: a healthy tree renders through it unchanged', async () => {
    let errors = 0;
    let tree: TestRenderer.ReactTestRenderer | undefined;
    await TestRenderer.act(async () => {
      tree = TestRenderer.create(
        <RootErrorBoundary onError={() => { errors++; }}>
          {React.createElement('ok')}
        </RootErrorBoundary>,
      );
    });
    h.eq([(tree?.toJSON() as { type: string } | null)?.type, errors], ['ok', 0], 'the child renders and nothing is recorded');
  });
}
