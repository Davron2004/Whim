/**
 * The release CLI's command table (design D12 "scripts/release" paragraph). `run.mjs` bundles
 * this file and calls `runCli(process.argv.slice(2))`, propagating the returned exit code.
 * Each entry name → `{ summary, run(args) }` is chain-1's contract for every later chain that
 * adds a command (native-config --json, preflight, verify-aab, privacy-audit,
 * association-files, generate-assets, tag): add one `COMMANDS` entry, never a second table or
 * a second `runCli`. Every command exits 0 on success, 1 on findings (one line each — with the
 * fix, where the underlying check carries one) and 2 on usage errors (handoff/release-cli.md).
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildNumberAt } from './lib/build-number';
import { generateAssets } from './lib/assets';
import { loadNativeReleaseConfig, scanNativeLiterals } from './lib/native-config';
import { checkIosProject } from './lib/ios-project';
import { checkAndroidProject } from './lib/android-project';
import { checkAssets } from './lib/assets';
import { checkStoreListing } from './lib/store-listing';
import { collectPreflightSnapshot, evaluatePreflight, type ReleasePlatform } from './lib/preflight';
import { parseFingerprintFile, getAabManifestFacts, getAabSignerFingerprint, aabFindings, type AabFacts } from './lib/verify-aab';
import { auditApp } from './lib/privacy-audit';
import { buildAssociationFiles, UPLOAD_FINGERPRINT_PATH } from './lib/association-files';
import { ensureReleaseTag, realGitRunner } from './lib/release-tag';
import { checkDisclosureRelease } from './lib/disclosure-check';
import {
  fetchSourceMap,
  makeScratchDir,
  realCommandRunner,
  resolveGcpProject,
  sourceMapKey,
  symbolicateStack,
  uploadSourceMap,
  type SourceMapStore,
} from './lib/source-map';

declare module 'node:fs' {
  export function writeFileSync(path: string, data: string, encoding: 'utf8'): void;
  export function mkdirSync(path: string, options: { recursive: true }): string | undefined;
}

export interface CliCommand {
  readonly summary: string;
  run(args: string[]): number | Promise<number>;
}

function readFlag(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1) return undefined;
  return args[index + 1];
}

function hasFlag(args: string[], flag: string): boolean {
  return args.includes(flag);
}

function reportError(command: string, err: unknown): number {
  process.stderr.write(`${command}: ${err instanceof Error ? err.message : String(err)}\n`);
  return 1;
}

function runBuildNumber(args: string[]): number {
  const at = readFlag(args, '--at');
  const date = at !== undefined ? new Date(at) : new Date();
  if (Number.isNaN(date.getTime())) {
    process.stderr.write(`build-number: "${String(at)}" is not a valid ISO date\n`);
    return 1;
  }
  try {
    process.stdout.write(`${buildNumberAt(date)}\n`);
    return 0;
  } catch (err) {
    process.stderr.write(`build-number: ${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  }
}

async function runGenerateAssets(): Promise<number> {
  try {
    await generateAssets(process.cwd());
    process.stdout.write('generate-assets: wrote every icon and launch asset from release/assets/icon-foreground.svg\n');
    return 0;
  } catch (err) {
    process.stderr.write(`generate-assets: ${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  }
}

function runCheck(): number {
  const repoRoot = process.cwd();
  const config = loadNativeReleaseConfig(repoRoot);
  const lines: string[] = [
    ...scanNativeLiterals(repoRoot, config).map((f) => `native literal — ${f.file}:${f.line}: ${f.key} ${JSON.stringify(f.literal)}`),
    ...checkIosProject(repoRoot, config).map((f) => `iOS project — ${f.file}: ${f.message}`),
    ...checkAndroidProject(repoRoot).map((f) => `Android project — ${f.file}: ${f.message}`),
    ...checkAssets(repoRoot).map((f) => `assets — ${f.path}: ${f.message}`),
    ...checkStoreListing(repoRoot, config).map((f) => `store listing — ${f.file}: ${f.message}`),
    ...checkDisclosureRelease(repoRoot).map((f) => `disclosure — ${f}`),
  ];
  if (lines.length === 0) {
    process.stdout.write('check: every repo check passed\n');
    return 0;
  }
  for (const line of lines) process.stdout.write(`check: ${line}\n`);
  return 1;
}

/** The re-consent rule's release check alone: what `deploy/deploy.sh` runs before anything moves. */
function runDisclosureCheck(): number {
  const findings = checkDisclosureRelease(process.cwd());
  if (findings.length === 0) {
    process.stdout.write('disclosure-check: the disclosure manifest and AI_CONSENT_VERSION agree\n');
    return 0;
  }
  for (const f of findings) process.stdout.write(`disclosure-check: ${f}\n`);
  return 1;
}

function runNativeConfig(args: string[]): number {
  if (!hasFlag(args, '--json')) {
    process.stderr.write('native-config: usage: native-config --json\n');
    return 2;
  }
  try {
    process.stdout.write(`${JSON.stringify(loadNativeReleaseConfig(process.cwd()))}\n`);
    return 0;
  } catch (err) {
    return reportError('native-config', err);
  }
}

function isReleasePlatform(value: string | undefined): value is ReleasePlatform {
  return value === 'ios' || value === 'android';
}

function parseIntegerFlag(args: string[], flag: string): number | undefined {
  const raw = readFlag(args, flag);
  if (raw === undefined) return undefined;
  const value = Number(raw);
  return Number.isInteger(value) ? value : undefined;
}

function runPreflight(args: string[]): number {
  const platform = readFlag(args, '--platform');
  const buildNumber = parseIntegerFlag(args, '--build');
  const storeLatestBuildNumber = parseIntegerFlag(args, '--store-latest');
  if (!isReleasePlatform(platform) || buildNumber === undefined || storeLatestBuildNumber === undefined) {
    process.stderr.write('preflight: usage: preflight --platform ios|android --build <n> --store-latest <n> [--allow-placeholder-domain]\n');
    return 2;
  }
  try {
    const snapshot = collectPreflightSnapshot(process.cwd(), platform, { buildNumber, storeLatestBuildNumber });
    const findings = evaluatePreflight(snapshot, { allowPlaceholderDomain: hasFlag(args, '--allow-placeholder-domain') });
    if (findings.length === 0) {
      process.stdout.write(`preflight: passed for ${platform}, build ${buildNumber}\n`);
      return 0;
    }
    for (const f of findings) process.stdout.write(`preflight: ${f.reason} — fix: ${f.fix}\n`);
    return 1;
  } catch (err) {
    return reportError('preflight', err);
  }
}

async function runVerifyAab(args: string[]): Promise<number> {
  const aabPath = args.find((a) => !a.startsWith('--'));
  const buildNumber = parseIntegerFlag(args, '--build');
  if (aabPath === undefined || buildNumber === undefined) {
    process.stderr.write('verify-aab: usage: verify-aab <path> --build <n>\n');
    return 2;
  }
  try {
    const repoRoot = process.cwd();
    const config = loadNativeReleaseConfig(repoRoot);
    const expectedFingerprint = parseFingerprintFile(fs.readFileSync(path.join(repoRoot, UPLOAD_FINGERPRINT_PATH), 'utf8'));
    const facts: AabFacts = { manifest: getAabManifestFacts(aabPath), signerFingerprint: getAabSignerFingerprint(aabPath) };
    const findings = aabFindings(facts, { packageName: config.WHIM_APP_ID, versionCode: buildNumber, signerFingerprint: expectedFingerprint });
    if (findings.length === 0) {
      process.stdout.write(`verify-aab: ${aabPath} passed\n`);
      return 0;
    }
    for (const f of findings) process.stdout.write(`verify-aab: ${f.reason}\n`);
    return 1;
  } catch (err) {
    return reportError('verify-aab', err);
  }
}

function runPrivacyAudit(args: string[]): number {
  const [appPath] = args;
  if (appPath === undefined) {
    process.stderr.write('privacy-audit: usage: privacy-audit <App.app>\n');
    return 2;
  }
  try {
    const findings = auditApp(appPath);
    if (findings.length === 0) {
      process.stdout.write(`privacy-audit: ${appPath} passed\n`);
      return 0;
    }
    for (const f of findings) process.stdout.write(`privacy-audit: ${f.reason}\n`);
    return 1;
  } catch (err) {
    return reportError('privacy-audit', err);
  }
}

function runAssociationFiles(args: string[]): number {
  const outDir = readFlag(args, '--out');
  try {
    const repoRoot = process.cwd();
    const { aasa, assetLinks } = buildAssociationFiles(repoRoot, loadNativeReleaseConfig(repoRoot));
    const aasaText = `${JSON.stringify(aasa, null, 2)}\n`;
    const assetLinksText = `${JSON.stringify(assetLinks, null, 2)}\n`;
    if (outDir !== undefined) {
      fs.mkdirSync(outDir, { recursive: true });
      fs.writeFileSync(path.join(outDir, 'apple-app-site-association'), aasaText, 'utf8');
      fs.writeFileSync(path.join(outDir, 'assetlinks.json'), assetLinksText, 'utf8');
      process.stdout.write(`association-files: wrote ${outDir}/apple-app-site-association and ${outDir}/assetlinks.json\n`);
    } else {
      process.stdout.write(`# apple-app-site-association\n${aasaText}\n# assetlinks.json\n${assetLinksText}`);
    }
    return 0;
  } catch (err) {
    return reportError('association-files', err);
  }
}

function runTag(args: string[]): number {
  const buildNumber = parseIntegerFlag(args, '--build');
  if (buildNumber === undefined) {
    process.stderr.write('tag: usage: tag --build <n>\n');
    return 2;
  }
  try {
    const repoRoot = process.cwd();
    const config = loadNativeReleaseConfig(repoRoot);
    const tagName = ensureReleaseTag(realGitRunner(repoRoot), config.WHIM_MARKETING_VERSION, buildNumber);
    process.stdout.write(`tag: ${tagName}\n`);
    return 0;
  } catch (err) {
    return reportError('tag', err);
  }
}

function runUploadSourceMap(args: string[]): number {
  const platform = readFlag(args, '--platform');
  const buildNumber = parseIntegerFlag(args, '--build');
  const mapPath = args.find((a, i) => !a.startsWith('--') && !['--platform', '--build'].includes(args[i - 1] ?? ''));
  if (!isReleasePlatform(platform) || buildNumber === undefined || mapPath === undefined) {
    process.stderr.write('upload-source-map: usage: upload-source-map --platform ios|android --build <n> <map-path>\n');
    return 2;
  }
  try {
    const repoRoot = process.cwd();
    const key = sourceMapKey(platform, loadNativeReleaseConfig(repoRoot).WHIM_MARKETING_VERSION, buildNumber);
    const url = uploadSourceMap(realCommandRunner, resolveGcpProject(repoRoot, process.env, os.homedir()), mapPath, key);
    process.stdout.write(`upload-source-map: uploaded ${url}\n`);
    return 0;
  } catch (err) {
    return reportError('upload-source-map', err);
  }
}

function runSymbolicate(args: string[]): number {
  const mapsDir = readFlag(args, '--maps-dir');
  const [platform, version, build] = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--maps-dir');
  const buildNumber = Number(build);
  if (!isReleasePlatform(platform) || version === undefined || !Number.isInteger(buildNumber) || (hasFlag(args, '--maps-dir') && !mapsDir)) {
    process.stderr.write('symbolicate: usage: symbolicate ios|android <version> <build> [--maps-dir <dir>] < stack\n');
    return 2;
  }
  let scratchDir: string | undefined;
  try {
    const repoRoot = process.cwd();
    const key = sourceMapKey(platform, version, buildNumber);
    const store: SourceMapStore = mapsDir
      ? { kind: 'dir', dir: mapsDir }
      : { kind: 'bucket', project: resolveGcpProject(repoRoot, process.env, os.homedir()) };
    scratchDir = makeScratchDir();
    const mapPath = fetchSourceMap(realCommandRunner, store, key, scratchDir);
    process.stdout.write(symbolicateStack(realCommandRunner, repoRoot, mapPath, fs.readFileSync(0, 'utf8')));
    return 0;
  } catch (err) {
    return reportError('symbolicate', err);
  } finally {
    if (scratchDir !== undefined) fs.rmSync(scratchDir, { recursive: true, force: true });
  }
}

export const COMMANDS: Record<string, CliCommand> = {
  'build-number': {
    summary: 'build-number [--at <iso>] — prints the release build number for an instant (default: now).',
    run: runBuildNumber,
  },
  'generate-assets': {
    summary: 'generate-assets — renders every icon and launch asset from release/assets/ and writes generated.json.',
    run: runGenerateAssets,
  },
  check: {
    summary: 'check — runs every repo release check (native literals, iOS/Android project, assets, store listing, disclosure).',
    run: runCheck,
  },
  'disclosure-check': {
    summary: 'disclosure-check — the re-consent rule: the disclosure manifest, its released snapshots, AI_CONSENT_VERSION and the what’s-new lines agree.',
    run: runDisclosureCheck,
  },
  'native-config': {
    summary: 'native-config --json — prints release/whim-release.xcconfig as JSON.',
    run: runNativeConfig,
  },
  preflight: {
    summary: 'preflight --platform ios|android --build <n> --store-latest <n> [--allow-placeholder-domain] — every reason a build would refuse.',
    run: runPreflight,
  },
  'verify-aab': {
    summary: 'verify-aab <path> --build <n> — verifies a store AAB before upload.',
    run: runVerifyAab,
  },
  'privacy-audit': {
    summary: 'privacy-audit <App.app> — audits required-reason API usage against the bundled privacy manifests.',
    run: runPrivacyAudit,
  },
  'association-files': {
    summary: 'association-files [--out <dir>] — prints (or writes) the AASA and assetlinks files ops must serve.',
    run: runAssociationFiles,
  },
  tag: {
    summary: 'tag --build <n> — tags a successful upload on HEAD, reusing an existing tag there.',
    run: runTag,
  },
  'upload-source-map': {
    summary: 'upload-source-map --platform ios|android --build <n> <map-path> — uploads a release build\'s Hermes source map to the private source-map bucket.',
    run: runUploadSourceMap,
  },
  symbolicate: {
    summary: 'symbolicate ios|android <version> <build> [--maps-dir <dir>] < stack — prints the stack with source frames from that build\'s map (scripts/symbolicate.mjs).',
    run: runSymbolicate,
  },
};

function printCommandTable(): void {
  process.stdout.write('Usage: node scripts/release/run.mjs <command> [args]\n\nCommands:\n');
  for (const { summary } of Object.values(COMMANDS)) {
    process.stdout.write(`  ${summary}\n`);
  }
}

/** Runs the named command, or prints the table and returns 2 for an unknown or missing one. */
export async function runCli(argv: string[]): Promise<number> {
  const [name, ...rest] = argv;
  const command = name !== undefined ? COMMANDS[name] : undefined;
  if (!command) {
    printCommandTable();
    return 2;
  }
  return command.run(rest);
}
