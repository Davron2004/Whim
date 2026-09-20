/**
 * server/src/preflight.ts — the boot preflight (design D1/D16; specs/server-deployment "Boot fails
 * fast when the runtime is incomplete"). Before anything opens a store, launches a browser or
 * listens, it checks three things in order and stops at the first failure, naming it:
 *
 * 1. every runtime asset in `RUNTIME_ASSETS` is a readable file under the tree root;
 * 2. every harness package (`esbuild`, `playwright`, `typescript`) resolves from `node_modules`;
 * 3. `WHIM_DATA_DIR` exists (created with mode 0700 under a process umask of 0077, so the stores'
 *    files are owner-only too) and a file can actually be created in it.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { PREFLIGHT_PACKAGES, RUNTIME_ASSETS } from './runtime-assets';

export type PreflightCheck = 'runtime_asset' | 'runtime_package' | 'data_dir';

/** The first thing boot found missing. `item` is the asset path, the package name, or the data
 *  directory, and the message names it. */
export class PreflightError extends Error {
  constructor(
    readonly check: PreflightCheck,
    readonly item: string,
    message: string,
  ) {
    super(message);
    this.name = 'PreflightError';
  }
}

export interface PreflightOptions {
  /** The runtime tree root the assets are read from: the process's working directory. */
  root: string;
  /** `WHIM_DATA_DIR`, resolved to an absolute path. */
  dataDir: string;
}

function isReadableFile(file: string): boolean {
  try {
    fs.accessSync(file, fs.constants.R_OK);
    return fs.statSync(file).isFile();
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'EACCES' || code === 'ENOTDIR' || code === 'EPERM') return false;
    throw err;
  }
}

function checkAssets(root: string): void {
  for (const asset of RUNTIME_ASSETS) {
    if (!isReadableFile(path.join(root, asset))) {
      throw new PreflightError('runtime_asset', asset, `runtime asset missing or unreadable: ${asset}`);
    }
  }
}

function checkPackages(): void {
  const requireFromServer = createRequire(import.meta.url);
  for (const name of PREFLIGHT_PACKAGES) {
    try {
      requireFromServer.resolve(name);
    } catch (err) {
      throw new PreflightError(
        'runtime_package',
        name,
        `runtime package does not resolve: ${name} (${err instanceof Error ? err.message.split('\n')[0] : String(err)})`,
      );
    }
  }
}

function checkDataDir(dataDir: string): void {
  process.umask(0o077);
  const probe = path.join(dataDir, `.whim-preflight-${process.pid}`);
  try {
    fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(probe, '', { flag: 'wx' });
    fs.rmSync(probe);
  } catch (err) {
    throw new PreflightError(
      'data_dir',
      dataDir,
      `WHIM_DATA_DIR is not writable: ${dataDir} (${err instanceof Error ? err.message : String(err)})`,
    );
  }
}

/** Runs the three checks in order; throws `PreflightError` naming the first missing item. */
export function runPreflight(options: PreflightOptions): void {
  checkAssets(options.root);
  checkPackages();
  checkDataDir(options.dataDir);
}
