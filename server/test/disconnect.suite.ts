/**
 * Client disconnect acceptance (public-generation-server chain-10). Scaffolded here by chain-1
 * (task 2.5, pre-registered in acceptance.ts); chain-10 fills it in — this module is
 * chain-10's alone to edit.
 *
 * specs/generation-server "Client disconnect aborts the pipeline", proven over a REAL TCP
 * connection (design D12): `serve()` binds the app on 127.0.0.1:0 exactly as `main.ts` serves it,
 * and a raw `net.Socket` posts, reads, and destroys itself. Nothing here drives the SSE `cancel()`
 * or `Request.signal` by hand — whichever of them @hono/node-server fires on a socket close is what
 * has to reach the pipeline, the admission slots and the ledger.
 */
import net from 'node:net';
import { serve, type ServerType } from '@hono/node-server';
import { check, eq, section } from './harness';
import {
  ControlledModelClient,
  RecordingUsageStore,
  STALL,
  TIMED_OUT,
  machinePipeline,
  waitFor,
  within,
} from './route-doubles';
import { createApp } from '../src/app';
import { loadServerConfig, type ServerConfig } from '../src/config';
import { createStubPipeline, type Pipeline } from '../src/pipeline';
import { createSlotController } from '../src/admission/slots';
import { InFlightGenerations } from '../src/routes/generate';
import { ResolveTracker, type GenerationStats, type UsageAndCostTransport } from '../src/usage/resolve';
import type { RunTrace } from '../src/generation/machine';
import { defaultModelRoster, type ModelRoster } from '../src/generation/model';
import type { GenerateRequest, GenerationEvent } from '@whim/contract';

const DEVICE_ID = 'd1d1d1d1-d1d1-41d1-81d1-d1d1d1d1d1d1';
const ROSTER: ModelRoster = defaultModelRoster('vendor/rewrite-tcp', 'vendor/engineer-tcp');
const DISCONNECT_BOUND_MS = 5000;
const FAST_RESOLVE_BOUNDS = { maxAttempts: 1, totalBudgetMs: 2000, retryDelayMs: 0, perAttemptTimeoutMs: 500 };
const STATS: GenerationStats = { usage: { promptTokens: 13, completionTokens: 17, totalTokens: 30 }, totalCostUsd: 0.021 };

function config(): ServerConfig {
  return { ...loadServerConfig({}), now: () => Date.now() };
}

/** Answers `STATS` for every generation id carrying `prefix`. */
function statsFor(prefix: string): UsageAndCostTransport {
  return {
    fetchStats: async (generationId: string) => (generationId.startsWith(prefix) ? STATS : null),
  };
}

interface PipelineObservation {
  signal: AbortSignal | undefined;
  trace: RunTrace | undefined;
  events: GenerationEvent['type'][];
  eventsAfterAbort: number;
}

/** Records what the pipeline itself produced, and whether any of it came after its signal fired. */
function observed(inner: Pipeline, seen: PipelineObservation): Pipeline {
  return {
    async *run(request: GenerateRequest, signal?: AbortSignal, trace?: RunTrace): AsyncIterable<GenerationEvent> {
      seen.signal = signal;
      seen.trace = trace;
      const run = inner.run as (r: GenerateRequest, s?: AbortSignal, t?: RunTrace) => AsyncIterable<GenerationEvent>;
      for await (const event of run(request, signal, trace)) {
        if (signal?.aborted) seen.eventsAfterAbort++;
        seen.events.push(event.type);
        yield event;
      }
    },
  };
}

interface RawClient {
  socket: net.Socket;
  text(): string;
}

/** An HTTP/1.1 POST written straight onto a TCP socket, accumulating whatever comes back. */
function rawPost(port: number, route: string, body: unknown): RawClient {
  const payload = JSON.stringify(body);
  const socket = net.connect({ port, host: '127.0.0.1' });
  let received = '';
  socket.setEncoding('utf8');
  socket.on('data', (chunk: string) => {
    received += chunk;
  });
  socket.on('error', (err) => {
    received += `\n[client socket error: ${err.message}]`;
  });
  socket.write(
    [
      `POST ${route} HTTP/1.1`,
      'Host: 127.0.0.1',
      'Content-Type: application/json',
      `Content-Length: ${Buffer.byteLength(payload)}`,
      `x-whim-device: ${DEVICE_ID}`,
      'Connection: close',
      '',
      payload,
    ].join('\r\n'),
  );
  return { socket, text: () => received };
}

function listen(app: ReturnType<typeof createApp>): Promise<{ server: ServerType; port: number }> {
  return new Promise((resolve) => {
    const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 }, (info) => resolve({ server, port: info.port }));
  });
}

async function close(server: ServerType): Promise<void> {
  if ('closeAllConnections' in server) server.closeAllConnections();
  const closed = await within(new Promise<void>((resolve) => server.close(() => resolve())));
  check('cleanup: the listening server closed', closed !== TIMED_OUT);
}

/** `serve()` installs @hono/node-server's own `Request`/`Response` globals, as it does in
 *  production; they are put back afterwards so no later suite runs on them. */
async function withServer(app: ReturnType<typeof createApp>, body: (port: number) => Promise<void>): Promise<void> {
  const savedRequest = Object.getOwnPropertyDescriptor(globalThis, 'Request');
  const savedResponse = Object.getOwnPropertyDescriptor(globalThis, 'Response');
  const listening = await within(listen(app));
  check('setup: the app is listening on 127.0.0.1', listening !== TIMED_OUT);
  try {
    if (listening !== TIMED_OUT) {
      try {
        await body(listening.port);
      } finally {
        await close(listening.server);
      }
    }
  } finally {
    if (savedRequest) Object.defineProperty(globalThis, 'Request', savedRequest);
    if (savedResponse) Object.defineProperty(globalThis, 'Response', savedResponse);
  }
}

async function testGenerateDisconnect(): Promise<void> {
  section('specs/generation-server "A real TCP disconnect tears down the model call" (generate)');

  const model = new ControlledModelClient([STALL, STALL], 'gen-tcp');
  const seen: PipelineObservation = { signal: undefined, trace: undefined, events: [], eventsAfterAbort: 0 };
  const usageStore = new RecordingUsageStore();
  const slots = createSlotController({ maxConcurrentGenerations: 3, maxConcurrentUnary: 16 });
  const tracker = new ResolveTracker();
  const inFlight = new InFlightGenerations();
  const app = createApp({
    pipeline: observed(machinePipeline(model, { now: () => Date.now() }, ROSTER), seen),
    usageStore,
    config: config(),
    slots,
    inFlight,
    resolver: { transport: statsFor('gen-tcp'), tracker, bounds: FAST_RESOLVE_BOUNDS },
  });

  await withServer(app, async (port) => {
    const client = rawPost(port, '/v1/generate', { prompt: 'a tip splitter' });
    check('the generation stream opened', await waitFor(() => client.text().startsWith('HTTP/1.1 200')));
    check('the first event arrived', await waitFor(() => client.text().includes('event: ')));
    check('the model transport is mid-stream', await waitFor(() => model.calls.length === 1 && client.text().includes('event: thinking')));
    eq('setup: one generation slot is held', slots.counts().generations, 1);

    const destroyedAt = Date.now();
    client.socket.destroy();

    check('within 5 s the model transport observed its abort', await waitFor(() => model.calls[0]?.aborted === true, DISCONNECT_BOUND_MS));
    check('within 5 s the device and global generation slots are free', await waitFor(() => slots.counts().generations === 0, DISCONNECT_BOUND_MS));
    check('the teardown finished inside the bound', Date.now() - destroyedAt < DISCONNECT_BOUND_MS, `${Date.now() - destroyedAt} ms`);
    check('the abort reached the pipeline', seen.signal?.aborted === true);
    eq('the pipeline emitted nothing after the abort', seen.eventsAfterAbort, 0);
    check('no terminal event was produced', !seen.events.includes('result') && !seen.events.includes('failure'), JSON.stringify(seen.events));
    eq('the run trace recorded the abort', seen.trace?.outcome, 'aborted');
    eq('the in-flight registry is empty', inFlight.size, 0);

    await tracker.drain(DISCONNECT_BOUND_MS);
    eq('every resolution finished', tracker.pendingCount, 0);
    const requestId = usageStore.admitted[0];
    eq('the ledger row settled once, as aborted', usageStore.settlesFor(requestId).map((s) => s.outcome), ['aborted']);
    const cost = usageStore.costFor(requestId);
    eq('the aborted run\'s cost was resolved', cost && { state: cost.state, costUsd: cost.costUsd }, { state: 'resolved', costUsd: STATS.totalCostUsd });
    eq('the reconciled tokens were credited once', await usageStore.read(DEVICE_ID), STATS.usage);

    const followUp = rawPost(port, '/v1/generate', { prompt: 'a tip splitter, again' });
    check('the same device\'s next generation is admitted, not refused as device_busy', await waitFor(() => followUp.text().startsWith('HTTP/1.1 200')), followUp.text().slice(0, 80));
    check('the follow-up reached its model call', await waitFor(() => model.calls.length === 2));
    followUp.socket.destroy();
    check('cleanup: the follow-up released its slot', await waitFor(() => slots.counts().generations === 0, DISCONNECT_BOUND_MS));
    await tracker.drain(DISCONNECT_BOUND_MS);
  });
}

async function testClarifyDisconnect(): Promise<void> {
  section('specs/generation-server "Client disconnect aborts the pipeline" — clarify over real TCP');

  const model = new ControlledModelClient([STALL, '{"questions":[]}'], 'gen-clarify-tcp');
  const usageStore = new RecordingUsageStore();
  const slots = createSlotController({ maxConcurrentGenerations: 3, maxConcurrentUnary: 16 });
  const tracker = new ResolveTracker();
  const app = createApp({
    pipeline: createStubPipeline(0),
    usageStore,
    model,
    roster: ROSTER,
    config: config(),
    slots,
    resolver: { transport: statsFor('gen-clarify-tcp'), tracker, bounds: FAST_RESOLVE_BOUNDS },
  });

  await withServer(app, async (port) => {
    const client = rawPost(port, '/v1/clarify', { prompt: 'a habit tracker' });
    check('the clarify model call started', await waitFor(() => model.calls.length === 1));
    eq('setup: the call holds one unary slot', slots.counts().unary, 1);

    client.socket.destroy();

    check('within 5 s the model transport observed its abort', await waitFor(() => model.calls[0]?.aborted === true, DISCONNECT_BOUND_MS));
    check('within 5 s the unary slot is free', await waitFor(() => slots.counts().unary === 0, DISCONNECT_BOUND_MS));

    await tracker.drain(DISCONNECT_BOUND_MS);
    const requestId = usageStore.admitted[0];
    eq('the ledger row settled once, as error', usageStore.settlesFor(requestId).map((s) => s.outcome), ['error']);
    eq('the aborted call\'s cost was resolved', usageStore.costFor(requestId)?.state, 'resolved');

    const followUp = rawPost(port, '/v1/clarify', { prompt: 'a habit tracker, again' });
    check('the same device\'s next clarify is answered', await waitFor(() => followUp.text().includes('"questions":[]')), followUp.text().slice(0, 80));
    check('the answer is a 200', followUp.text().startsWith('HTTP/1.1 200'));
    check('cleanup: the follow-up released its unary slot', await waitFor(() => slots.counts().unary === 0));
    followUp.socket.destroy();
    await tracker.drain(DISCONNECT_BOUND_MS);
  });
}

export async function runDisconnectTests(): Promise<void> {
  section('Client disconnect');
  await testGenerateDisconnect();
  await testClarifyDisconnect();
}
