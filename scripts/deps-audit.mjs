/**
 * `npm run deps:audit` (spec `dependency-currency`): asks the registry for the `latest` dist-tag of
 * every dependency and devDependency each workspace declares, and compares it with the version the
 * lockfile resolves.
 *
 *   node scripts/deps-audit.mjs [--root <dir>] [--registry <url>]
 *
 * A dependency that does not resolve to its `latest` and has no entry in `dependency-pins.json` is
 * undeclared lag. Every pin is printed beside its package's current `latest` and its lift
 * condition, so a reviewer sees when a pin may go. Prerelease dist-tags (`next`, `beta`, …) are never
 * read: `latest` is the target.
 *
 * Exit codes: 0 nothing lags without a pin; 1 undeclared lag (each listed with both versions);
 * 2 the audit could not run (an unreadable manifest, lockfile or register, a registry failure, a
 * declared dependency the lockfile does not resolve).
 *
 * Networked on purpose, so neither gate script calls it: unattended runs have no registry egress.
 * The registry defaults to npm's configured one (`npm_config_registry`, set by `npm run`), else
 * registry.npmjs.org; `--registry` points it elsewhere (the checks suite uses a local stub).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compareVersions, declaredDependencies, readPinRegister, readWorkspaces, resolvedVersion } from './lib/dependency-pins.mjs';

const EXIT_CURRENT = 0;
const EXIT_LAG = 1;
const EXIT_ERROR = 2;
const FETCH_CONCURRENCY = 8;
const FETCH_TIMEOUT_MS = 15_000;

function parseArgs(argv) {
  const args = { root: path.join(path.dirname(fileURLToPath(import.meta.url)), '..'), registry: process.env.npm_config_registry || 'https://registry.npmjs.org/' };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--root' && argv[i + 1]) args.root = path.resolve(argv[++i]);
    else if (argv[i] === '--registry' && argv[i + 1]) args.registry = argv[++i];
    else throw new Error(`unknown argument "${argv[i]}" (usage: deps-audit [--root <dir>] [--registry <url>])`);
  }
  return args;
}

/** A `fetchLatest(name)` that reads `<registry>/-/package/<name>/dist-tags` and returns `latest`. */
function registryFetcher(registry) {
  const base = registry.endsWith('/') ? registry : `${registry}/`;
  return async (name) => {
    const url = `${base}-/package/${encodeURIComponent(name)}/dist-tags`;
    const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`${name}: registry answered ${res.status} for ${url}`);
    const tags = await res.json();
    if (typeof tags?.latest !== 'string') throw new Error(`${name}: the registry lists no latest dist-tag`);
    return tags.latest;
  };
}

async function mapLimited(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/**
 * The audit over the repo at `root`, with the registry behind `fetchLatest(name) → Promise<string>`.
 * Writes its report through `write(line)` and resolves to the exit code.
 */
async function runAudit({ root, fetchLatest, write }) {
  const workspaces = readWorkspaces(root);
  const declared = declaredDependencies(workspaces);
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
  const pins = readPinRegister(root);
  const pinned = new Map(pins.map((p) => [p.package, p]));

  const unresolved = declared.filter((d) => resolvedVersion(lock, d.workspace, d.name) === null);
  if (unresolved.length > 0) {
    for (const d of unresolved) write(`error: the lockfile resolves no version of ${d.name} (workspace ${d.workspace}); run npm install`);
    return EXIT_ERROR;
  }

  const names = [...new Set([...declared.map((d) => d.name), ...pinned.keys()])].sort((a, b) => a.localeCompare(b));
  const latest = await mapLimited(names, FETCH_CONCURRENCY, fetchLatest);
  const latestByName = new Map(names.map((name, i) => [name, latest[i]]));
  const latestFor = (name) => latestByName.get(name);

  const lagging = declared.filter((d) => resolvedVersion(lock, d.workspace, d.name) !== latestFor(d.name) && !pinned.has(d.name));
  write(`deps:audit: ${declared.length} declared dependencies across ${workspaces.length} workspaces, ${pins.length} pins`);
  write('');
  write(lagging.length === 0 ? 'Undeclared lag: none' : `Undeclared lag (${lagging.length}): resolved -> latest, no entry in dependency-pins.json`);
  for (const d of lagging) {
    const resolved = resolvedVersion(lock, d.workspace, d.name);
    const direction = compareVersions(resolved, latestFor(d.name)) < 0 ? '' : ' (ahead of latest: not a stable release)';
    write(`  ${d.name}  ${resolved} -> ${latestFor(d.name)}  [${d.workspace}]${direction}`);
  }
  write('');
  write(`Pins (${pins.length}): range, resolved, latest, lift condition`);
  for (const pin of pins) {
    const resolved = declared.filter((d) => d.name === pin.package).map((d) => `${resolvedVersion(lock, d.workspace, d.name)} [${d.workspace}]`);
    write(`  ${pin.package}  range ${pin.range}  resolved ${resolved.join(', ') || 'none'}  latest ${latestFor(pin.package)}`);
    write(`      lift: ${pin.lift}`);
  }
  return lagging.length === 0 ? EXIT_CURRENT : EXIT_LAG;
}

let exitCode;
try {
  const args = parseArgs(process.argv.slice(2));
  exitCode = await runAudit({ root: args.root, fetchLatest: registryFetcher(args.registry), write: (line) => console.log(line) });
} catch (err) {
  console.error(`deps:audit: ${err instanceof Error ? err.message : String(err)}`);
  exitCode = EXIT_ERROR;
}
process.exit(exitCode);
