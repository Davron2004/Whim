/**
 * Dev entry point — wires createApp with the REAL generation pipeline by default, or the stub
 * pipeline (`WHIM_PIPELINE=stub`, for LAN UI work with no token spend on full generations —
 * spec "The stub stays reachable for UI work"), then serves via @hono/node-server on
 * 0.0.0.0:WHIM_SERVER_PORT (default 8787). Launches ONE synthetic-run-harness session for the
 * process's lifetime when the real pipeline is used (design D8's "one session per pipeline"),
 * closed on shutdown (task 7.4).
 *
 * The model client/roster (needed by `/v1/rewrite` regardless of `WHIM_PIPELINE` — rewrite has
 * no stub selector of its own, design D5) are built once from the environment and shared between
 * the pipeline and the rewrite route. In stub mode a missing/misconfigured environment degrades
 * gracefully (`/v1/rewrite` responds 502 until configured); outside stub mode it is a fail-fast
 * startup error (task 7.1's typed, actionable `MissingApiKeyError`/`ModelRosterEnvError`).
 */
import path from 'node:path';
import fs from 'node:fs';
import { serve } from '@hono/node-server';
import { createApp } from './app';
import { createStubPipeline, type Pipeline } from './pipeline';
import { NodeSqliteUsageStore } from './usage-store';
import { createGenerationPipeline, buildModelDepsFromEnv, openRouterGenerationStatsTransport, type ModelDeps } from './generation';
import { SynthRunSession } from '../../synthrun/session';

const port = Number(process.env.WHIM_SERVER_PORT ?? '8787');
const useStub = process.env.WHIM_PIPELINE === 'stub';

// Durable usage store under WHIM_DATA_DIR (default: server/.data/). Resolve from cwd — `npm run
// server:dev` pins cwd to the repo root — NOT from import.meta.dirname: dev.mjs bundles this file
// to server/.dev-server.*.tmp.mjs, so a dirname-relative path would land one level too high.
const dataDir = process.env.WHIM_DATA_DIR ?? path.join(process.cwd(), 'server', '.data');
fs.mkdirSync(dataDir, { recursive: true });
const usageStore = new NodeSqliteUsageStore(path.join(dataDir, 'usage.db'));

let modelDeps: ModelDeps | undefined;
try {
  modelDeps = buildModelDepsFromEnv();
} catch (err) {
  if (!useStub) throw err;
  console.warn(
    `whim-server: starting in WHIM_PIPELINE=stub mode without a usable model client (${
      err instanceof Error ? err.message : String(err)
    }). /v1/rewrite will respond 502 until configured.`,
  );
}

let session: SynthRunSession | undefined;
let pipeline: Pipeline;
if (useStub) {
  pipeline = createStubPipeline(200);
} else {
  session = await SynthRunSession.launch();
  pipeline = createGenerationPipeline({ session, modelDeps });
}

const app = createApp({
  pipeline,
  usageStore,
  keepaliveMs: 15_000,
  model: modelDeps?.model,
  roster: modelDeps?.roster,
  reconcile: modelDeps ? { transport: openRouterGenerationStatsTransport(modelDeps.apiKey) } : undefined,
  stub: useStub,
});

const server = serve({ fetch: app.fetch, port, hostname: '0.0.0.0' }, () => {
  console.log(`whim-server listening on http://0.0.0.0:${port} (pipeline: ${useStub ? 'stub' : 'real'})`);
});

let shuttingDown = false;
async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  server.close();
  if (session) await session.close();
  process.exit(0);
}

process.on('SIGINT', () => {
  shutdown().catch((err: unknown) => console.error('whim-server: shutdown failed', err));
});
process.on('SIGTERM', () => {
  shutdown().catch((err: unknown) => console.error('whim-server: shutdown failed', err));
});
