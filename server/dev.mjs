/**
 * Dev runner for @whim/server. Mirrors the repo's esbuild-bundle-then-run idiom:
 * bundles src/main.ts → a temp ESM file, then imports it so the server starts.
 * Node built-ins (node:*, hono, @hono/node-server) are kept external.
 *
 * `esbuild`/`playwright`/`typescript` are external for the same reason every other runner that
 * reaches `synthrun/` keeps them external (`synthrun/test/run.mjs`, `server/test/e2e.run.mjs`,
 * `evals/cli.mjs`): `main.ts` launches a `SynthRunSession`, which pulls in `playwright` and
 * (via `synthrun/builder.ts`) `esbuild`. Neither survives bundling — playwright-core `require`s
 * `chromium-bidi` paths esbuild cannot resolve statically, and the dependency graph reaches
 * `fsevents`' native `.node` binary, for which there is no loader. All three are real runtime
 * dependencies resolvable from node_modules, so leaving them external is correct, not a
 * workaround. Keep this list in step with `server/test/e2e.run.mjs` — it bundles the same graph.
 *
 *   npm run server:dev
 */

import { build } from 'esbuild';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const here = path.dirname(fileURLToPath(import.meta.url));
const entry = path.join(here, 'src', 'main.ts');
const outfile = path.join(here, `.dev-server.${process.pid}.tmp.mjs`);

await build({
  entryPoints: [entry],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  external: ['node:*', 'hono', '@hono/node-server', '@hono/*', 'esbuild', 'playwright', 'typescript'],
  logLevel: 'info',
});

// Import the bundle (starts the server). Cleanup on exit.
const cleanup = () => { fs.rmSync(outfile, { force: true }); };
process.on('exit', cleanup);
process.on('SIGINT', () => { cleanup(); process.exit(0); });
process.on('SIGTERM', () => { cleanup(); process.exit(0); });

await import(pathToFileURL(outfile));
