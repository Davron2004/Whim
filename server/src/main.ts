/**
 * Dev entry point — wires createApp with the stub pipeline + in-memory usage store,
 * then serves via @hono/node-server on 0.0.0.0:WHIM_SERVER_PORT (default 8787).
 */
import path from 'node:path';
import fs from 'node:fs';
import { serve } from '@hono/node-server';
import { createApp } from './app';
import { createStubPipeline } from './pipeline';
import { NodeSqliteUsageStore } from './usage-store';

const port = Number(process.env.WHIM_SERVER_PORT ?? '8787');

// Durable usage store under WHIM_DATA_DIR (default: server/.data/)
const dataDir = process.env.WHIM_DATA_DIR ?? path.join(import.meta.dirname, '..', '.data');
fs.mkdirSync(dataDir, { recursive: true });
const usageStore = new NodeSqliteUsageStore(path.join(dataDir, 'usage.db'));

const app = createApp({
  pipeline: createStubPipeline(200),
  usageStore,
  keepaliveMs: 15_000,
});

serve({ fetch: app.fetch, port, hostname: '0.0.0.0' }, () => {
  console.log(`whim-server listening on http://0.0.0.0:${port}`);
});
