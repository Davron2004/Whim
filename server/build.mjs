/**
 * Production build for @whim/server (design D1; specs/server-deployment "A production build
 * produces a self-contained runtime tree"). Writes `server/dist/app/`:
 *
 *   server/main.mjs (+ .map)         bundled `server/src/main.ts`
 *   server/whim-admin.mjs (+ .map)   bundled `server/src/admin/main.ts`, the operator command
 *   server/whim-waitlist.mjs (+ .map) bundled `server/src/waitlist/cli.ts`, the waitlist operator command
 *   <every RUNTIME_ASSETS path>      copied from the repo at the same relative path
 *
 * The server starts from that tree with the tree root as its working directory:
 * `node --enable-source-maps server/main.mjs`. `@whim/contract` and every repo TypeScript module
 * are bundled in. Exactly the declared runtime packages (`server/package.json` dependencies other
 * than the workspace packages) stay external and resolve from `node_modules` at run time.
 *
 * Every path here is relative to the process's working directory, which must be the repo root — the
 * same convention as every other Node entry in this repo. Run directly, this file moves there first:
 *
 *   node server/build.mjs
 */
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TREE_DIR = path.join('server', 'dist', 'app');

/**
 * `server/package.json`'s dependencies minus the workspace packages the bundle carries: the one
 * list of packages every bundle of server code keeps external. They ship CJS `require()` calls
 * that esbuild's ESM output turns into an unsupported dynamic require, or load files relative to
 * their own package directory, so bundling one breaks at import time.
 *
 * @param {string} [serverDir] the `server/` workspace directory; defaults to the repo-root convention
 * @returns {string[]}
 */
export function declaredRuntimePackages(serverDir = path.resolve('server')) {
  const manifest = JSON.parse(fs.readFileSync(path.join(serverDir, 'package.json'), 'utf8'));
  return Object.keys(manifest.dependencies)
    .filter((name) => !name.startsWith('@whim/'))
    .sort((a, b) => a.localeCompare(b));
}

/** Packages a dev or test bundle loads through `synthrun/` (and `checks/`) at run time, whether or
 *  not the server declares them. */
const TOOL_PACKAGES = ['esbuild', 'playwright', 'typescript'];

/**
 * Externals for a dev or test bundle of server code: Node built-ins, the declared runtime packages
 * and the tool packages.
 *
 * @param {string} [serverDir] as for `declaredRuntimePackages`
 * @returns {string[]}
 */
export function devBundleExternals(serverDir) {
  return [...new Set(['node:*', ...declaredRuntimePackages(serverDir), ...TOOL_PACKAGES])];
}

/**
 * Bundles one server entry point with the production settings: ESM for Node 22, a linked source
 * map, and exactly the declared runtime packages external. Every entry that ships in or on top of
 * the runtime tree goes through here, so all of them bundle identically.
 *
 * @param {{ entry: string; outfile: string; write?: boolean }} options
 * @returns {Promise<string[]>} the esbuild metafile's input paths, relative to the repo root
 */
export async function bundleServerEntry({ entry, outfile, write = true }) {
  const result = await build({
    absWorkingDir: process.cwd(),
    entryPoints: [path.resolve(entry)],
    outfile: path.resolve(outfile),
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    sourcemap: 'linked',
    external: declaredRuntimePackages(),
    metafile: true,
    write,
    logLevel: 'warning',
  });
  return Object.keys(result.metafile.inputs);
}

/** `RUNTIME_ASSETS` read from its one TypeScript source. */
async function runtimeAssets() {
  const compiled = await build({
    entryPoints: [path.resolve('server', 'src', 'runtime-assets.ts')],
    bundle: true,
    platform: 'node',
    format: 'esm',
    write: false,
    external: declaredRuntimePackages(),
    logLevel: 'warning',
  });
  const source = Buffer.from(compiled.outputFiles[0].text).toString('base64');
  const loaded = await import(`data:text/javascript;base64,${source}`);
  return loaded.RUNTIME_ASSETS;
}

/**
 * Writes the runtime tree into `outDir`, replacing whatever is there.
 *
 * @param {{ outDir: string }} options
 * @returns {Promise<void>}
 */
export async function buildRuntimeTree({ outDir }) {
  const target = path.resolve(outDir);
  const fromTarget = path.relative(target, process.cwd());
  if (fromTarget === '' || !fromTarget.startsWith('..')) {
    throw new Error(`refusing to write the runtime tree to ${target}: it contains the repository`);
  }
  fs.rmSync(target, { recursive: true, force: true });
  await bundleServerEntry({ entry: 'server/src/main.ts', outfile: path.join(target, 'server', 'main.mjs') });
  await bundleServerEntry({ entry: 'server/src/admin/main.ts', outfile: path.join(target, 'server', 'whim-admin.mjs') });
  await bundleServerEntry({ entry: 'server/src/waitlist/cli.ts', outfile: path.join(target, 'server', 'whim-waitlist.mjs') });
  for (const asset of await runtimeAssets()) {
    const destination = path.join(target, asset);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(path.resolve(asset), destination);
  }
}

// Run directly: the process's script is this file. A bundle that inlines this module has its own
// `import.meta.url`, so the file name is checked too: started directly, such a bundle builds nothing.
const ownPath = fs.realpathSync(fileURLToPath(import.meta.url));
const invokedPath = process.argv[1] ? fs.realpathSync(process.argv[1]) : '';
if (path.basename(ownPath) === 'build.mjs' && invokedPath === ownPath) {
  process.chdir(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));
  await buildRuntimeTree({ outDir: TREE_DIR });
  console.log(`runtime tree written to ${TREE_DIR}`);
}
