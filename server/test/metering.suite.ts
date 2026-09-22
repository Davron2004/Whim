/**
 * Metering tests and usage readback endpoint tests.
 * Tests the NodeSqliteUsageStore and the GET /v1/usage route.
 */
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { check, eq, section } from './harness';
import { TIMED_OUT, within } from './route-doubles';
import { createApp } from '../src/app';
import { createStubPipeline } from '../src/pipeline';
import { NodeSqliteUsageStore } from '../src/usage-store';

const DEVICE_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const DEVICE_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

/** Build a test app using a NodeSqliteUsageStore over the given db path. */
function testApp(dbPath: string) {
  const usageStore = new NodeSqliteUsageStore(dbPath);
  const app = createApp({
    pipeline: createStubPipeline(0),
    usageStore,
  });
  return { app, usageStore };
}

/** Post JSON and return the Response. */
async function post(
  app: ReturnType<typeof createApp>,
  routePath: string,
  body: unknown,
  headers?: Record<string, string>,
): Promise<Response> {
  return app.request(routePath, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

/** Drain an SSE response fully (to trigger usage crediting). */
async function drainSse(res: Response): Promise<void> {
  if (!res.body) return;
  const reader = res.body.getReader();
  for (;;) {
    const { done } = await reader.read();
    if (done) break;
  }
}

export async function runMeteringTests(): Promise<void> {
  section('Metering — NodeSqliteUsageStore (SPEC §6.1, §6.2)');

  // §6.1 — restart durability: open over a temp file, credit two runs, close, reopen
  {
    const tmpFile = path.join(os.tmpdir(), `whim-usage-test-${process.pid}.db`);
    try {
      // First store instance: run two credits
      const store1 = new NodeSqliteUsageStore(tmpFile);
      await store1.credit(DEVICE_A, { promptTokens: 10, completionTokens: 20, totalTokens: 30 });
      await store1.credit(DEVICE_A, { promptTokens: 5, completionTokens: 15, totalTokens: 20 });
      store1.close();

      // Second store instance (simulates restart): read back
      const store2 = new NodeSqliteUsageStore(tmpFile);
      const usage = await store2.read(DEVICE_A);
      store2.close();

      eq('restart durability: promptTokens', usage.promptTokens, 15);
      eq('restart durability: completionTokens', usage.completionTokens, 35);
      eq('restart durability: totalTokens', usage.totalTokens, 50);
    } finally {
      fs.rmSync(tmpFile, { force: true });
    }
  }


  // §6 — reads are scoped per device id
  {
    const store = new NodeSqliteUsageStore(':memory:');
    await store.credit(DEVICE_A, { promptTokens: 100, completionTokens: 50, totalTokens: 150 });
    await store.credit(DEVICE_B, { promptTokens: 5, completionTokens: 3, totalTokens: 8 });
    const usageA = await store.read(DEVICE_A);
    const usageB = await store.read(DEVICE_B);
    eq('reads scoped per id: A promptTokens', usageA.promptTokens, 100);
    eq('reads scoped per id: B promptTokens', usageB.promptTokens, 5);
    store.close();
  }

  section('Metering — /v1/usage route + credit-before-terminal (SPEC §6.3–6.5)');

  // §6.3 — readback scoped to caller: run a stub generation, then GET /v1/usage
  {
    const { app, usageStore } = testApp(':memory:');

    // Run a full generation (stub pipeline emits a usage event)
    const genRes = await post(
      app,
      '/v1/generate',
      { prompt: 'hello' },
      { 'x-whim-device': DEVICE_A },
    );
    await drainSse(genRes);

    // Read usage for device A
    const usageRes = await app.request('/v1/usage', {
      headers: { 'x-whim-device': DEVICE_A },
    });
    eq('GET /v1/usage status 200', usageRes.status, 200);
    const usage = (await usageRes.json()) as { promptTokens: number; completionTokens: number; totalTokens: number };

    // The stub pipeline emits a fixed usage (createStubPipeline, src/pipeline.ts) — the exact
    // amount, not merely "some usage was credited", so a double-credit doesn't pass this check.
    eq('readback: the stub pipeline\'s exact usage was credited once', usage, { promptTokens: 42, completionTokens: 128, totalTokens: 170 });

    // Read usage for device B (should be zeros)
    const usageBRes = await app.request('/v1/usage', {
      headers: { 'x-whim-device': DEVICE_B },
    });
    const usageB = (await usageBRes.json()) as { promptTokens: number; completionTokens: number; totalTokens: number };
    eq('readback: device B reads zeros', usageB.totalTokens, 0);

    // The usage for A in the route response must equal what the store says
    const storeUsage = await usageStore.read(DEVICE_A);
    eq('readback: route matches store promptTokens', usage.promptTokens, storeUsage.promptTokens);
    eq('readback: route matches store completionTokens', usage.completionTokens, storeUsage.completionTokens);
    eq('readback: route matches store totalTokens', usage.totalTokens, storeUsage.totalTokens);
  }

  // Money property: usage is credited BEFORE the terminal event reaches the client, not merely by
  // the time the whole stream has closed — read the store the moment the `result` frame's bytes
  // arrive, with the stream still open, never after `drainSse`/readSseResponse has consumed it.
  {
    const { app, usageStore } = testApp(':memory:');
    const res = await post(app, '/v1/generate', { prompt: 'hello' }, { 'x-whim-device': DEVICE_A });
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    const readUntilResult = (async (): Promise<string> => {
      let buffered = '';
      while (!buffered.includes('"type":"result"')) {
        const { value, done } = await reader.read();
        if (done) break;
        buffered += decoder.decode(value, { stream: true });
      }
      return buffered;
    })();
    const buffered = await within(readUntilResult, 5000);
    check('setup: the result frame actually arrived before the stream closed', buffered !== TIMED_OUT && buffered.includes('"type":"result"'));
    const usageAtResult = await usageStore.read(DEVICE_A);
    eq('money: usage is already credited when the result frame is read, stream still open', usageAtResult, { promptTokens: 42, completionTokens: 128, totalTokens: 170 });
    await reader.cancel();
  }

  // §6.4 — unknown id reads zeros, not error
  {
    const { app } = testApp(':memory:');
    const res = await app.request('/v1/usage', {
      headers: { 'x-whim-device': DEVICE_B },
    });
    eq('unknown id → 200', res.status, 200);
    const usage = (await res.json()) as { promptTokens: number; completionTokens: number; totalTokens: number };
    eq('unknown id → zero promptTokens', usage.promptTokens, 0);
    eq('unknown id → zero completionTokens', usage.completionTokens, 0);
    eq('unknown id → zero totalTokens', usage.totalTokens, 0);
  }

}
