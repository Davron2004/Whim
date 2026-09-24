/**
 * Release source maps (developer-observability D12; specs/device-diagnostics "Release builds keep
 * a source map for every shipped bundle"). Every shipped bundle's composed Hermes map is stored at
 * `<bucket>/<platform>/<version>+<build>.map`, where the bucket is `gs://<WHIM_GCP_PROJECT>-sourcemaps`
 * — the one `deploy/provision.sh` creates from the same project value, resolved the way
 * `deploy/lib.sh` resolves it. The store lanes upload through `uploadSourceMap`; the `symbolicate`
 * command reads a map back through `fetchSourceMap` and runs metro-symbolicate's own CLI on it.
 * gcloud and node are reached only through an injected `CommandRunner`.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { DEPLOY_DEFAULTS_PATH, parseSimpleEnv } from './domain-lockstep';
import type { ReleasePlatform } from './preflight';

export interface CommandResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly error?: Error;
}

/** Runs a program with optional stdin and returns its exit status and output; never throws on a non-zero exit. */
export type CommandRunner = (file: string, args: string[], input?: string) => CommandResult;

/** Where `symbolicate` reads maps from: the bucket, or a local directory laid out the same way. */
export type SourceMapStore = { readonly kind: 'bucket'; readonly project: string } | { readonly kind: 'dir'; readonly dir: string };

const VERSION_SHAPE = /^\d+(\.\d+)*$/;

/** `<platform>/<version>+<build>.map`, refusing values that could name a different object or path. */
export function sourceMapKey(platform: ReleasePlatform, version: string, build: number): string {
  if (!VERSION_SHAPE.test(version)) throw new Error(`"${version}" is not a version number like 1.0.0`);
  if (!Number.isSafeInteger(build) || build < 1) throw new Error(`"${build}" is not a build number`);
  return `${platform}/${version}+${build}.map`;
}

/** The private source-map bucket `deploy/provision.sh` creates for a project (its SOURCEMAP_BUCKET). */
export function sourceMapBucket(project: string): string {
  return `gs://${project}-sourcemaps`;
}

/**
 * WHIM_GCP_PROJECT as `deploy/lib.sh`'s `whim_load_values` resolves it: `deploy/defaults.env`,
 * then `~/.config/whim/deploy.env`, then the environment, later sources winning.
 */
export function resolveGcpProject(repoRoot: string, env: Readonly<Record<string, string | undefined>>, home: string): string {
  const key = 'WHIM_GCP_PROJECT';
  let project = parseSimpleEnv(fs.readFileSync(path.join(repoRoot, DEPLOY_DEFAULTS_PATH), 'utf8')).get(key);
  const operatorFile = path.join(home, '.config/whim/deploy.env');
  if (fs.existsSync(operatorFile)) project = parseSimpleEnv(fs.readFileSync(operatorFile, 'utf8')).get(key) ?? project;
  project = env[key] ?? project;
  if (!project) throw new Error(`${key} is empty (set in ${DEPLOY_DEFAULTS_PATH}, ~/.config/whim/deploy.env or the environment)`);
  return project;
}

function failureReason(result: CommandResult): string {
  if (result.error) return result.error.message;
  const stderr = result.stderr.trim();
  return stderr === '' ? `exit status ${String(result.status)}` : stderr;
}

/** Refuses a file the build didn't write, or one that isn't a source map, before anything is uploaded. */
export function checkSourceMapFile(mapPath: string): void {
  if (!fs.existsSync(mapPath)) throw new Error(`${mapPath} does not exist: the build did not emit its source map`);
  let map: unknown;
  try {
    map = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
  } catch {
    throw new Error(`${mapPath} is not a source map (not JSON)`);
  }
  const { version, mappings } = (map ?? {}) as { version?: unknown; mappings?: unknown };
  if (version !== 3 || typeof mappings !== 'string' || mappings === '') {
    throw new Error(`${mapPath} is not a source map (needs version 3 and non-empty mappings)`);
  }
}

/** Uploads one build's map to its key, replacing any earlier upload for the same build. Returns the object URL. */
export function uploadSourceMap(run: CommandRunner, project: string, mapPath: string, key: string): string {
  checkSourceMapFile(mapPath);
  const url = `${sourceMapBucket(project)}/${key}`;
  const result = run('gcloud', ['--project', project, 'storage', 'cp', mapPath, url]);
  if (result.status !== 0) throw new Error(`uploading the source map ${key} to ${url} failed: ${failureReason(result)}`);
  return url;
}

/** The local path of the map stored under `key`, copying it into `scratchDir` when it lives in the bucket. Never falls back to another key. */
export function fetchSourceMap(run: CommandRunner, store: SourceMapStore, key: string, scratchDir: string): string {
  if (store.kind === 'dir') {
    const local = path.join(store.dir, key);
    if (!fs.existsSync(local)) throw new Error(`no source map for ${key} at ${local}`);
    return local;
  }
  const url = `${sourceMapBucket(store.project)}/${key}`;
  const local = path.join(scratchDir, path.basename(key));
  const result = run('gcloud', ['--project', store.project, 'storage', 'cp', url, local]);
  if (result.status !== 0) throw new Error(`no source map for ${key} at ${url}: ${failureReason(result)}`);
  return local;
}

/** Symbolicates a Hermes stack with metro-symbolicate's own CLI; every `file:line:column` frame becomes `source:line:function`. */
export function symbolicateStack(run: CommandRunner, repoRoot: string, mapPath: string, stack: string): string {
  const bin = createRequire(path.join(repoRoot, 'package.json')).resolve('metro-symbolicate');
  const result = run(process.execPath, [bin, mapPath], stack);
  if (result.status !== 0) throw new Error(`metro-symbolicate failed on ${mapPath}: ${failureReason(result)}`);
  return result.stdout;
}

/** The real runner the CLI wires in production; a suite drives it only through a stubbed PATH. */
export const realCommandRunner: CommandRunner = (file, args, input) =>
  spawnSync(file, args, { encoding: 'utf8', input });

/** A fresh scratch directory for a fetched map; the caller removes it. */
export function makeScratchDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'whim-sourcemap-'));
}
