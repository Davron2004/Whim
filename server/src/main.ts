/**
 * Dev entry point — the composition root. Wires createApp with the REAL generation pipeline by
 * default, or the stub pipeline (`WHIM_PIPELINE=stub`, for LAN UI work with no token spend on full
 * generations — spec "The stub stays reachable for UI work"), then serves via @hono/node-server on
 * WHIM_SERVER_HOST:WHIM_SERVER_PORT (default 0.0.0.0:8787). Launches ONE synthetic-run-harness
 * session for the process's lifetime when the real pipeline is used (design D8's "one session per
 * pipeline"), closed on shutdown (task 7.4).
 *
 * Every server-controlled variable comes from the one typed config (`config.ts`), loaded first, so
 * a bad value fails startup by name. The model client/roster (needed by `/v1/rewrite`,
 * `/v1/clarify` and the content-policy classifier regardless of `WHIM_PIPELINE`) are built once
 * from the environment and shared. In stub mode a missing/misconfigured environment degrades
 * gracefully (`/v1/rewrite` responds 502 until configured); outside stub mode it is a fail-fast
 * startup error (task 7.1's typed, actionable `MissingApiKeyError`/`ModelRosterEnvError`).
 *
 * Construction order and what each piece is for: `handoff/composition.md`.
 */
import path from 'node:path';
import fs from 'node:fs';
import { serve } from '@hono/node-server';
import { createApp } from './app';
import { loadServerConfig } from './config';
import { createStubPipeline, type Pipeline } from './pipeline';
import { NodeSqliteUsageStore } from './usage-store';
import { NodeSqliteReportStore } from './reports/store';
import { createGenerationPipeline, buildModelDepsFromEnv, type ModelDeps } from './generation';
import { loadContentPolicyDocument } from './generation/prompts/inputs';
import { createSlotController } from './admission/slots';
import { createOpenRouterCreditTransport } from './admission/credit';
import { cachedPolicy, ModelContentPolicy, StubContentPolicy, type ContentPolicy } from './policy';
import { ResolveTracker, type GenerationStats, type UsageAndCostTransport } from './usage/resolve';
import { InFlightGenerations } from './routes/generate';
import { SynthRunSession } from '../../synthrun/session';
import { log } from './logger';

const GENERATION_STATS_URL = 'https://openrouter.ai/api/v1/generation';

/** One OpenRouter generation-stats record as the resolver needs it, or `null` while the record is
 *  not (yet) complete: tokens (native counts as the fallback) and `total_cost` in USD. */
function parseGenerationStats(data: Record<string, unknown> | undefined): GenerationStats | null {
  if (!data) return null;
  const promptTokens = Number(data.tokens_prompt ?? data.native_tokens_prompt ?? 0);
  const completionTokens = Number(data.tokens_completion ?? data.native_tokens_completion ?? 0);
  const totalCostUsd = data.total_cost;
  if (!Number.isFinite(promptTokens) || !Number.isFinite(completionTokens)) return null;
  if (typeof totalCostUsd !== 'number' || !Number.isFinite(totalCostUsd)) return null;
  return { usage: { promptTokens, completionTokens, totalTokens: promptTokens + completionTokens }, totalCostUsd };
}

/** The real resolver transport: `GET https://openrouter.ai/api/v1/generation?id=…` for tokens and
 *  cost. A non-2xx or incomplete record is "not yet resolved"; a transport failure or unparseable
 *  body rejects, which the resolver treats the same way and retries within its bounds. */
function openRouterUsageAndCostTransport(apiKey: string): UsageAndCostTransport {
  return {
    async fetchStats(generationId: string, signal: AbortSignal): Promise<GenerationStats | null> {
      const res = await fetch(`${GENERATION_STATS_URL}?id=${encodeURIComponent(generationId)}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal,
      });
      if (!res.ok) return null;
      const body = (await res.json()) as { data?: Record<string, unknown> };
      return parseGenerationStats(body.data);
    },
  };
}

const config = loadServerConfig(process.env);
const useStub = config.pipeline === 'stub';

// The dev-only device log sink (obs-v1). OFF unless explicitly enabled — an explicit flag, never
// an inferred "we look like dev" (design D5): a network-fed file writer must not switch itself on.
// Not mounted under `/v1`, so the x-whim-device gate's surface is unchanged (`app.ts`).
const devLogSink = config.devLogSink ? { filePath: path.resolve(config.devLogFile) } : undefined;

// Both durable stores under WHIM_DATA_DIR (default: server/.data/). Resolve from cwd — `npm run
// server:dev` pins cwd to the repo root — NOT from import.meta.dirname: dev.mjs bundles this file
// to server/.dev-server.*.tmp.mjs, so a dirname-relative path would land one level too high.
const dataDir = path.resolve(config.dataDir);
fs.mkdirSync(dataDir, { recursive: true });
const usageStore = new NodeSqliteUsageStore(path.join(dataDir, 'usage.db'));
const reportStore = new NodeSqliteReportStore(path.join(dataDir, 'reports.db'));

let modelDeps: ModelDeps | undefined;
try {
  modelDeps = buildModelDepsFromEnv();
} catch (err) {
  if (!useStub) throw err;
  log.warn(
    {
      detail: err instanceof Error ? err.message : String(err),
      hint: '/v1/rewrite will respond 502 until configured.',
    },
    'starting in WHIM_PIPELINE=stub mode without a usable model client',
  );
}

const slots = createSlotController({
  maxConcurrentGenerations: config.maxConcurrentGenerations,
  maxConcurrentUnary: config.maxConcurrentUnary,
});
const resolveTracker = new ResolveTracker();
const inFlight = new InFlightGenerations();

let session: SynthRunSession | undefined;
let pipeline: Pipeline;
let basePolicy: ContentPolicy;
if (useStub || !modelDeps) {
  // `modelDeps` is absent only under the stub selector: outside it, the failure above was rethrown.
  pipeline = createStubPipeline(200);
  basePolicy = new StubContentPolicy();
} else {
  session = await SynthRunSession.launch({ concurrency: config.synthrunConcurrency });
  pipeline = createGenerationPipeline({ session, modelDeps, maxRunMs: config.generationMaxMs });
  basePolicy = new ModelContentPolicy({
    modelClient: modelDeps.model,
    rewriteModelId: modelDeps.roster.rewrite,
    categories: loadContentPolicyDocument().categories,
    timeoutMs: config.policyTimeoutMs,
  });
}

const app = createApp({
  pipeline,
  usageStore,
  keepaliveMs: 15_000,
  model: modelDeps?.model,
  roster: modelDeps?.roster,
  stub: useStub,
  devLogSink,
  config,
  slots,
  policy: cachedPolicy(basePolicy),
  reportStore,
  resolver: {
    transport: modelDeps ? openRouterUsageAndCostTransport(modelDeps.apiKey) : undefined,
    tracker: resolveTracker,
  },
  creditTransport: modelDeps ? createOpenRouterCreditTransport({ apiKey: modelDeps.apiKey }) : undefined,
  inFlight,
});

const server = serve({ fetch: app.fetch, port: config.serverPort, hostname: config.serverHost }, () => {
  log.info(
    { port: config.serverPort, pipeline: useStub ? 'stub' : 'real', devLogSink: devLogSink !== undefined },
    'whim-server listening',
  );
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
  shutdown().catch((err: unknown) => {
    log.error({ detail: err instanceof Error ? err.message : String(err) }, 'shutdown failed');
  });
});
process.on('SIGTERM', () => {
  shutdown().catch((err: unknown) => {
    log.error({ detail: err instanceof Error ? err.message : String(err) }, 'shutdown failed');
  });
});
