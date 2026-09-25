/**
 * Deploy artifacts acceptance (public-generation-server chain-12, tasks 13.5 and 13.6). Scaffolded by
 * chain-1 (task 2.5); chain-15 added the web-site sub-suite call; chain-12 fills the module.
 *
 * Static tripwires over deploy/, the root ignore files and server/src/ hold the invariants of
 * specs/server-deployment: the pinned, non-root, secret-free image; the hardened server service
 * (cap_drop ALL plus exactly SYS_CHROOT); the stream-safe API proxy and the pages host route table;
 * hostnames only in config; the capacity profiles. Each checker is a pure function over file text,
 * and each also runs against a planted weakening, so none can pass vacuously.
 *
 * The operator scripts run for real under bash, in a throwaway git checkout, with PATH stubs for
 * gcloud, node, dig and curl: no GCP call, no network, no real secret.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync, type SpawnSyncOptionsWithStringEncoding, type SpawnSyncReturns } from 'node:child_process';
import { APP_VERSION_HEADER, BUILD_HEADER, CONSENT_HEADER, PLATFORM_HEADER } from '@whim/contract';
import { check, eq, section } from './harness';
import { captureLogs } from './log-capture';
import { runWebSiteTests } from './web-site.suite';
import { runLoadTestTests } from './loadtest.suite';
import { PROTOCOL_HEADERS, TIMED_OUT, machinePipeline, within } from './route-doubles';
import { ScriptedModelClient } from './scripted-model';
import { readSseResponse } from './sse-reader';
import { createApp } from '../src/app';
import { createServerLogger } from '../src/logger';
import { KEEP_PERIOD_VARIABLES, loadServerConfig, ServerConfigError } from '../src/config';
import { createStubPipeline } from '../src/pipeline';
import { InMemoryUsageStore } from '../src/usage-store';
import { InMemoryWaitlistStore } from '../src/waitlist/store';
import { TRAP_FIELD } from '../src/routes/beta-signup';
import { invalidateCreditCache, type CreditTransport } from '../src/admission/credit';
import { cachedPolicy, PolicyUnavailableError, type ContentPolicy, type PolicyCheckResult } from '../src/policy';
import { defaultModelRoster } from '../src/generation/model';
import type { Clock } from '../src/generation/machine';
import * as releaseConfig from '../../src/host/launcher/release-config';
import { MANIFESTS, keepLimit, latestVersion } from '../../contract/src/disclosure-manifest';

const ROOT = process.cwd();

function readRepoFile(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function listFilesUnder(rel: string): string[] {
  return fs.readdirSync(path.join(ROOT, rel), { withFileTypes: true }).flatMap((entry) => {
    const child = `${rel}/${entry.name}`;
    return entry.isDirectory() ? listFilesUnder(child) : [child];
  });
}

function readFiles(rels: readonly string[]): Map<string, string> {
  return new Map(rels.map((rel) => [rel, readRepoFile(rel)]));
}

/** Every deploy artifact: deploy/** plus the root ignore files that shape the image and the upload. */
function deployFiles(): Map<string, string> {
  return readFiles([...listFilesUnder('deploy'), '.dockerignore', '.gcloudignore']);
}

/** Replaces `from` with `to`, and throws when `from` is absent so a planted weakening can't miss. */
function plant(text: string, from: string, to: string): string {
  if (!text.includes(from)) throw new Error(`setup: planted weakening did not apply: ${JSON.stringify(from)}`);
  return text.replace(from, to);
}

function withFile(files: ReadonlyMap<string, string>, rel: string, text: string): Map<string, string> {
  return new Map([...files, [rel, text]]);
}

function checkClean(name: string, problems: readonly string[]): void {
  check(name, problems.length === 0, problems.join(' | '));
}

function checkCaught(name: string, problems: readonly string[], needle: string): void {
  check(name, problems.some((problem) => problem.includes(needle)), `problems: ${JSON.stringify(problems)}`);
}

function lockfileVersion(pkg: string): string {
  const lock = JSON.parse(readRepoFile('package-lock.json')) as { packages: Record<string, { version?: string }> };
  const version = lock.packages[`node_modules/${pkg}`]?.version;
  if (!version) throw new Error(`setup: ${pkg} is not resolved in package-lock.json`);
  return version;
}

function envEntries(text: string): Array<[string, string]> {
  return text
    .split('\n')
    .filter((line) => line.trim() !== '' && !line.startsWith('#'))
    .map((line): [string, string] => {
      const at = line.indexOf('=');
      return at > 0 ? [line.slice(0, at), line.slice(at + 1)] : [line, ''];
    });
}

// ---------------------------------------------------------------------------------------------
// Secrets

const SECRET_NAME = /(?:^|_)(?:API_?KEY|KEY|SECRET|TOKEN|PASSWORD|PASSWD|CREDENTIALS?)$/i;
const KEY_SHAPED_VALUE = /\bsk-(?:or-)?(?:v1-)?[A-Za-z0-9]{16,}/;

/** Names that end like a secret but hold no secret, per file: fluent-bit's `time_key` names the
 *  JSON field that carries the record's timestamp. */
const NON_SECRET_NAMES: ReadonlyMap<string, ReadonlySet<string>> = new Map([['deploy/vm/ops-agent.yaml', new Set(['time_key'])]]);

function isLiteralValue(value: string): boolean {
  const trimmed = value.trim();
  return trimmed !== '' && !trimmed.startsWith('$') && !trimmed.startsWith('"$');
}

/** NAME=value tokens (shell, env files, Dockerfile ENV/ARG, compose list form), the Dockerfile's
 *  legacy `ENV NAME value`, and YAML `NAME: value` mappings. */
function assignmentsOnLine(line: string): Array<[string, string]> {
  const found: Array<[string, string]> = [];
  const tokens = line.trim().split(/\s+/);
  for (const token of tokens) {
    const at = token.indexOf('=');
    if (at > 0 && /^[A-Za-z_]\w*$/.test(token.slice(0, at))) found.push([token.slice(0, at), token.slice(at + 1)]);
  }
  if (tokens[0] === 'ENV' && tokens.length >= 3 && !tokens[1]!.includes('=')) {
    found.push([tokens[1]!, tokens.slice(2).join(' ')]);
  }
  const yaml = /^-?\s*([A-Za-z_]\w*):\s+(\S.*)$/.exec(line.trim());
  if (yaml) found.push([yaml[1]!, yaml[2]!]);
  return found;
}

function secretProblems(files: ReadonlyMap<string, string>): string[] {
  const problems: string[] = [];
  for (const [rel, text] of files) {
    if (KEY_SHAPED_VALUE.test(text)) problems.push(`${rel} holds a key-shaped value`);
    text.split('\n').forEach((line, index) => {
      for (const [name, value] of assignmentsOnLine(line)) {
        if (SECRET_NAME.test(name) && isLiteralValue(value) && !NON_SECRET_NAMES.get(rel)?.has(name)) {
          problems.push(`${rel}:${index + 1} sets secret-named ${name} to a value`);
        }
      }
    });
  }
  return problems;
}

// ---------------------------------------------------------------------------------------------
// Dockerfile

interface DockerInstruction {
  readonly keyword: string;
  readonly args: string;
  readonly line: number;
}

function dockerInstructions(text: string): DockerInstruction[] {
  const instructions: DockerInstruction[] = [];
  let pending = '';
  let startLine = 0;
  text.split('\n').forEach((raw, index) => {
    const line = raw.trim();
    if (pending === '' && (line === '' || line.startsWith('#'))) return;
    if (pending === '') startLine = index + 1;
    if (line.endsWith('\\')) {
      pending += `${line.slice(0, -1)} `;
      return;
    }
    const full = `${pending}${line}`;
    pending = '';
    const space = full.indexOf(' ');
    const keyword = space < 0 ? full : full.slice(0, space);
    instructions.push({ keyword: keyword.toUpperCase(), args: space < 0 ? '' : full.slice(space + 1).trim(), line: startLine });
  });
  return instructions;
}

const PINNED_IMAGE = /^[\w./-]+:[\w.-]+@sha256:[0-9a-f]{64}$/;

function fromProblems(instructions: readonly DockerInstruction[]): string[] {
  const problems: string[] = [];
  const stages = new Set<string>();
  for (const instruction of instructions.filter((i) => i.keyword === 'FROM')) {
    const parts = instruction.args.split(/\s+/).filter((part) => !part.startsWith('--platform'));
    const image = parts[0] ?? '';
    if (!stages.has(image) && !PINNED_IMAGE.test(image)) {
      problems.push(`FROM ${image} (line ${instruction.line}) is not pinned by digest`);
    }
    if (parts[1]?.toUpperCase() === 'AS' && parts[2]) stages.add(parts[2]);
  }
  return problems;
}

function playwrightPinProblems(text: string, version: string): string[] {
  const pins = [...text.matchAll(/playwright@([\w.-]+)/g)].map((match) => match[1]!);
  const problems = pins.filter((pin) => pin !== version).map((pin) => `the image pins playwright@${pin}, the lockfile resolves ${version}`);
  if (pins.length === 0) problems.push('the image installs no pinned playwright@<version>');
  return problems;
}

function finalStageProblems(stage: readonly DockerInstruction[]): string[] {
  const problems: string[] = [];
  const user = stage.filter((i) => i.keyword === 'USER').at(-1)?.args ?? '';
  const uid = user.split(':')[0] ?? '';
  if (!/^\d+$/.test(uid) || Number(uid) === 0) problems.push(`the final user is ${user || 'unset'}, not a fixed non-root uid`);
  for (const instruction of stage) {
    if ((instruction.keyword === 'COPY' || instruction.keyword === 'ADD') && !instruction.args.startsWith('--from=')) {
      problems.push(`the runtime stage copies from the build context (line ${instruction.line})`);
    }
  }
  return problems;
}

function envCopyProblems(instructions: readonly DockerInstruction[]): string[] {
  return instructions
    .filter((i) => (i.keyword === 'COPY' || i.keyword === 'ADD') && /\.env(?:$|[\s.])/.test(i.args))
    .map((i) => `line ${i.line} copies an env file: ${i.keyword} ${i.args}`);
}

function dockerfileProblems(text: string, playwrightVersion: string): string[] {
  const instructions = dockerInstructions(text);
  const lastFrom = instructions.map((i) => i.keyword).lastIndexOf('FROM');
  if (lastFrom < 0) return ['the Dockerfile has no FROM'];
  return [
    ...fromProblems(instructions),
    ...playwrightPinProblems(text, playwrightVersion),
    ...finalStageProblems(instructions.slice(lastFrom)),
    ...envCopyProblems(instructions),
    ...secretProblems(new Map([['deploy/Dockerfile', text]])),
  ];
}

/** The runtime stage turns the build arg into the environment the server reads, defaulting to
 *  `"unknown"` for any build the release pipeline didn't make (developer-observability D13). */
function commitBakeProblems(text: string): string[] {
  const instructions = dockerInstructions(text);
  const runtime = instructions.slice(instructions.map((i) => i.keyword).lastIndexOf('FROM'));
  const has = (keyword: string, args: string): boolean => runtime.some((i) => i.keyword === keyword && i.args === args);
  const problems: string[] = [];
  if (!has('ARG', 'WHIM_COMMIT=unknown')) problems.push('the runtime stage lacks ARG WHIM_COMMIT=unknown');
  if (!has('ENV', 'WHIM_COMMIT=$WHIM_COMMIT')) problems.push('the runtime stage lacks ENV WHIM_COMMIT=$WHIM_COMMIT');
  return problems;
}

/** The commit describes the image's bytes, never what the deploy step believed: nothing outside the
 *  image build may name WHIM_COMMIT, since a compose, env or profile value would override the baked one. */
function runtimeCommitProblems(files: ReadonlyMap<string, string>): string[] {
  return [...files]
    .filter(([rel, text]) => rel !== 'deploy/Dockerfile' && rel !== 'deploy/cloudbuild.yaml' && text.includes('WHIM_COMMIT'))
    .map(([rel]) => `${rel} names WHIM_COMMIT outside the image build`);
}

function imageUidOf(dockerfile: string): string {
  const instructions = dockerInstructions(dockerfile);
  return (instructions.filter((i) => i.keyword === 'USER').at(-1)?.args ?? '').split(':')[0] ?? '';
}

// ---------------------------------------------------------------------------------------------
// compose.yaml (the subset deploy/compose.yaml is written in: block mappings, block or flow lists)

interface YamlEntry {
  readonly key: string;
  readonly inline: string;
  readonly body: string[];
}

function indentOf(line: string): number {
  return line.length - line.trimStart().length;
}

function yamlEntries(lines: readonly string[]): Map<string, YamlEntry> {
  const content = lines.filter((line) => line.trim() !== '' && !line.trimStart().startsWith('#'));
  const entries = new Map<string, YamlEntry>();
  const base = content.length > 0 ? indentOf(content[0]!) : 0;
  let current: YamlEntry | undefined;
  for (const line of content) {
    if (current && indentOf(line) > base) {
      current.body.push(line);
      continue;
    }
    const trimmed = line.trim();
    const colon = trimmed.indexOf(':');
    const key = trimmed.slice(0, Math.max(colon, 0));
    const rest = trimmed.slice(colon + 1);
    if (indentOf(line) !== base || !/^[\w.-]+$/.test(key) || (rest !== '' && !rest.startsWith(' '))) {
      throw new Error(`unexpected line ${JSON.stringify(line)}`);
    }
    if (entries.has(key)) throw new Error(`duplicate key ${key}`);
    current = { key, inline: rest.trim(), body: [] };
    entries.set(key, current);
  }
  return entries;
}

function unquote(value: string): string {
  return /^(["']).*\1$/.test(value) ? value.slice(1, -1) : value;
}

function yamlList(entry: YamlEntry | undefined): string[] {
  if (!entry) return [];
  if (entry.inline.startsWith('[') && entry.inline.endsWith(']')) {
    return entry.inline
      .slice(1, -1)
      .split(',')
      .map((value) => unquote(value.trim()))
      .filter((value) => value !== '');
  }
  return entry.body
    .map((line) => line.trim())
    .filter((line) => line.startsWith('- '))
    .map((line) => unquote(line.slice(2).trim()));
}

function yamlScalar(entries: ReadonlyMap<string, YamlEntry>, key: string): string {
  return unquote(entries.get(key)?.inline ?? '');
}

function yamlChild(entries: ReadonlyMap<string, YamlEntry>, key: string): Map<string, YamlEntry> {
  return yamlEntries(entries.get(key)?.body ?? []);
}

function durationMs(value: string): number | undefined {
  const match = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(value);
  if (!match || value === '') return undefined;
  return (Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0)) * 1000;
}

interface ComposeContext {
  readonly playwrightVersion: string;
  readonly minStopGraceMs: number;
  readonly egressSubnet: string;
  readonly imageUid: string;
  readonly seccompFiles: readonly string[];
}

const SERVER_FORBIDDEN_KEYS = ['privileged', 'ports', 'network_mode', 'pid', 'ipc', 'userns_mode', 'devices', 'cgroup_parent'];
const CADDY_FORBIDDEN_KEYS = ['privileged', 'network_mode', 'pid', 'cap_add', 'security_opt'];

function sameList(actual: readonly string[], expected: readonly string[]): boolean {
  const sorted = (list: readonly string[]): string => JSON.stringify([...list].sort((a, b) => a.localeCompare(b)));
  return sorted(actual) === sorted(expected);
}

function interpolationProblems(text: string): string[] {
  const problems: string[] = [];
  let at = text.indexOf('$');
  while (at !== -1) {
    const rest = text.slice(at);
    if (rest.startsWith('$$')) {
      at = text.indexOf('$', at + 2);
      continue;
    }
    if (!/^\$\{[A-Z][A-Z0-9_]*:\?[^}]*\}/.test(rest)) {
      problems.push(`compose.yaml interpolates ${rest.split('\n')[0]!.slice(0, 32)} without the \${NAME:?} form`);
    }
    at = text.indexOf('$', at + 1);
  }
  return problems;
}

function serverHardeningProblems(server: ReadonlyMap<string, YamlEntry>, ctx: ComposeContext): string[] {
  const problems: string[] = [];
  const expectScalar = (key: string, expected: string): void => {
    const actual = yamlScalar(server, key);
    if (actual !== expected) problems.push(`whim-server ${key} is ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
  };
  const expectExactList = (key: string, expected: readonly string[]): void => {
    const actual = yamlList(server.get(key));
    if (!sameList(actual, expected)) problems.push(`whim-server ${key} is [${actual.join(', ')}], expected exactly [${expected.join(', ')}]`);
  };
  if (!/^\d+$/.test(ctx.imageUid) || ctx.imageUid === '0') problems.push(`the image uid ${ctx.imageUid} is not a fixed non-root uid`);
  expectScalar('user', `${ctx.imageUid}:${ctx.imageUid}`);
  expectScalar('read_only', 'true');
  expectScalar('init', 'true');
  expectScalar('restart', 'unless-stopped');
  expectExactList('cap_drop', ['ALL']);
  expectExactList('cap_add', ['SYS_CHROOT']);
  const seccompFile = `chromium-playwright-${ctx.playwrightVersion}.json`;
  expectExactList('security_opt', ['no-new-privileges:true', `seccomp=/opt/whim/seccomp/${seccompFile}`]);
  if (!ctx.seccompFiles.includes(seccompFile)) problems.push(`deploy/seccomp/${seccompFile} (the lockfile's Playwright) is not vendored`);
  if (!yamlList(server.get('tmpfs')).some((mount) => /^\/tmp:size=\d+[kmg]?$/.test(mount))) problems.push('whim-server has no size-bounded /tmp tmpfs');
  if (!/^[1-9]\d*$/.test(yamlScalar(server, 'pids_limit'))) problems.push('whim-server has no pids_limit');
  for (const key of SERVER_FORBIDDEN_KEYS) if (server.has(key)) problems.push(`whim-server sets ${key}`);
  return problems;
}

function serverRuntimeProblems(server: ReadonlyMap<string, YamlEntry>, ctx: ComposeContext): string[] {
  const problems: string[] = [];
  const expectScalar = (key: string, expected: string): void => {
    const actual = yamlScalar(server, key);
    if (actual !== expected) problems.push(`whim-server ${key} is ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
  };
  expectScalar('image', '${WHIM_IMAGE:?}');
  expectScalar('shm_size', '${WHIM_SERVER_SHM_SIZE:?}');
  expectScalar('mem_limit', '${WHIM_SERVER_MEM_LIMIT:?}');
  const grace = durationMs(yamlScalar(server, 'stop_grace_period'));
  if (grace === undefined || grace < ctx.minStopGraceMs) {
    problems.push(`whim-server stop_grace_period ${yamlScalar(server, 'stop_grace_period') || 'unset'} is under the drain timeout plus 30 s (${ctx.minStopGraceMs} ms)`);
  }
  const envFiles = yamlList(server.get('env_file'));
  if (JSON.stringify(envFiles) !== JSON.stringify(['/etc/whim/config.env', '/etc/whim/server.env'])) {
    problems.push(`whim-server env_file is [${envFiles.join(', ')}]`);
  }
  if (!yamlList(server.get('volumes')).includes('/mnt/disks/whim-data/server:/data')) problems.push('whim-server does not mount the data disk at /data');
  if (yamlScalar(yamlChild(server, 'environment'), 'WHIM_DATA_DIR') !== '/data') problems.push('whim-server WHIM_DATA_DIR is not /data');
  if (!yamlList(server.get('networks')).includes('whim')) problems.push('whim-server is not on the whim network');
  return problems;
}

function caddyServiceProblems(caddy: ReadonlyMap<string, YamlEntry>): string[] {
  const problems: string[] = [];
  if (!/^caddy:[\w.-]+@sha256:[0-9a-f]{64}$/.test(yamlScalar(caddy, 'image'))) problems.push('caddy image is not pinned by digest');
  const volumes = yamlList(caddy.get('volumes'));
  for (const mount of ['/opt/whim/Caddyfile:/etc/caddy/Caddyfile:ro', '/mnt/disks/whim-data/caddy:/data', '/mnt/disks/whim-data/site:/srv/site:ro']) {
    if (!volumes.includes(mount)) problems.push(`caddy lacks the volume ${mount}`);
  }
  const environment = yamlChild(caddy, 'environment');
  for (const name of ['WHIM_API_HOST', 'WHIM_WEB_HOST']) {
    if (yamlScalar(environment, name) !== `\${${name}:?}`) problems.push(`caddy ${name} is not \${${name}:?}`);
  }
  for (const key of CADDY_FORBIDDEN_KEYS) if (caddy.has(key)) problems.push(`caddy sets ${key}`);
  return problems;
}

function composeProblems(text: string, ctx: ComposeContext): string[] {
  try {
    const top = yamlEntries(text.split('\n'));
    const services = yamlChild(top, 'services');
    const server = yamlChild(services, 'whim-server');
    const names = [...services.keys()].sort((a, b) => a.localeCompare(b)).join(', ');
    const subnet = /subnet:\s*(\S+)/.exec((top.get('networks')?.body ?? []).join('\n'))?.[1];
    return [
      ...interpolationProblems(text),
      ...(names === 'caddy, whim-server' ? [] : [`compose services are ${names}, expected caddy and whim-server`]),
      ...serverHardeningProblems(server, ctx),
      ...serverRuntimeProblems(server, ctx),
      ...caddyServiceProblems(yamlChild(services, 'caddy')),
      ...(subnet === ctx.egressSubnet ? [] : [`the whim network subnet ${subnet} differs from whim-egress.sh's ${ctx.egressSubnet}`]),
      ...(/unconfined/.test(text) ? ['compose.yaml disables a security profile (unconfined)'] : []),
    ];
  } catch (error) {
    return [`compose.yaml does not parse: ${(error as Error).message}`];
  }
}

// ---------------------------------------------------------------------------------------------
// Caddyfile

interface CaddyNode {
  readonly tokens: readonly string[];
  readonly children: CaddyNode[];
  readonly line: number;
}

function caddyTokens(line: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let quoted = false;
  const flush = (): void => {
    if (current !== '') tokens.push(current);
    current = '';
  };
  for (const ch of line) {
    if (ch === '"') {
      quoted = !quoted;
      continue;
    }
    if (!quoted && ch === '#' && current === '') break;
    if (!quoted && (ch === ' ' || ch === '\t')) flush();
    else current += ch;
  }
  flush();
  return tokens;
}

function parseCaddyfile(text: string): CaddyNode[] {
  const root: CaddyNode[] = [];
  const stack: CaddyNode[][] = [root];
  text.split('\n').forEach((raw, index) => {
    const tokens = caddyTokens(raw);
    if (tokens.length === 0) return;
    if (tokens.length === 1 && tokens[0] === '}') {
      if (stack.length === 1) throw new Error(`Caddyfile line ${index + 1}: unmatched }`);
      stack.pop();
      return;
    }
    const opens = tokens.at(-1) === '{';
    const inner = opens ? tokens.slice(0, -1) : tokens;
    if (inner.includes('{') || inner.includes('}')) throw new Error(`Caddyfile line ${index + 1}: a brace must end the line or stand alone`);
    const node: CaddyNode = { tokens: inner, children: [], line: index + 1 };
    stack.at(-1)!.push(node);
    if (opens) stack.push(node.children);
  });
  if (stack.length !== 1) throw new Error('Caddyfile: a block is never closed');
  return root;
}

function walkCaddy(nodes: readonly CaddyNode[]): CaddyNode[] {
  return nodes.flatMap((node) => [node, ...walkCaddy(node.children)]);
}

function directiveOf(node: CaddyNode): string {
  return node.tokens[0] ?? '';
}

function lineOf(node: CaddyNode): string {
  return node.tokens.join(' ');
}

function childLines(node: CaddyNode | undefined): string[] {
  return (node?.children ?? []).map(lineOf);
}

const BYTE_UNITS: Readonly<Record<string, number>> = { B: 1, KB: 1e3, MB: 1e6, GB: 1e9, KIB: 1024, MIB: 1024 ** 2, GIB: 1024 ** 3 };

function byteSize(value: string): number | undefined {
  const match = /^(\d+)([A-Za-z]*)$/.exec(value);
  if (!match) return undefined;
  const unit = BYTE_UNITS[(match[2] === '' ? 'B' : match[2]!).toUpperCase()];
  return unit === undefined ? undefined : Number(match[1]) * unit;
}

const API_FORBIDDEN = ['encode', 'log', 'file_server', 'root', 'try_files', 'templates', 'php_fastcgi'];
const PAGES_FORBIDDEN = ['reverse_proxy', 'templates', 'encode', 'log', 'respond', 'redir', 'php_fastcgi', 'browse'];
const PAGES_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; font-src 'self'";
const ASSOCIATION_ROUTES = ['/.well-known/apple-app-site-association', '/.well-known/assetlinks.json'];
/** Served straight from the published files, never rewritten (the pages' self-hosted fonts). */
const ASSET_ROUTES = ['/assets/*'];
const PAGE_ROUTES: ReadonlyArray<readonly [string, string]> = [
  ['/privacy', 'privacy.html'],
  ['/privacy/v1', 'privacy-v1.html'],
  ['/terms', 'terms.html'],
  ['/fr/privacy', 'fr/privacy.html'],
  ['/fr/terms', 'fr/terms.html'],
  ['/support', 'support.html'],
  ['/beta', 'beta.html'],
  ['/beta/thanks', 'beta-thanks.html'],
  ['/beta/retry', 'beta-retry.html'],
  ['/a/*', 'app-link.html'],
  ['', 'not-found.html'],
];

function apiSiteProblems(site: readonly CaddyNode[], maxBodyBytes: number): string[] {
  const problems: string[] = [];
  for (const node of walkCaddy(site)) {
    if (API_FORBIDDEN.includes(directiveOf(node))) problems.push(`the API site uses ${directiveOf(node)} (line ${node.line})`);
  }
  const proxy = site.find((node) => directiveOf(node) === 'reverse_proxy');
  if (proxy?.tokens[1] !== 'whim-server:8787') problems.push('the API site does not reverse_proxy whim-server:8787');
  if (!childLines(proxy).includes('flush_interval -1')) problems.push('the API reverse_proxy lacks flush_interval -1');
  const maxSize = site.find((node) => directiveOf(node) === 'request_body')?.children.find((node) => directiveOf(node) === 'max_size')?.tokens[1];
  const bytes = maxSize === undefined ? undefined : byteSize(maxSize);
  if (bytes === undefined || bytes < maxBodyBytes) {
    problems.push(`the API request_body max_size ${maxSize ?? 'unset'} is below the server's largest body cap (${maxBodyBytes} bytes)`);
  }
  return problems;
}

/** Each asset route serves the published files under its prefix as they are: no rewrite, no header. */
function assetRouteProblems(handles: ReadonlyMap<string, CaddyNode>, siteFiles: readonly string[]): string[] {
  const problems: string[] = [];
  for (const route of ASSET_ROUTES) {
    const lines = childLines(handles.get(route));
    if (!lines.includes('file_server') || lines.some((line) => line.startsWith('rewrite') || line.startsWith('header'))) problems.push(`${route} is not served straight from the published files`);
    if (!siteFiles.some((file) => file.startsWith(`${route.slice(1, -2)}/`))) problems.push(`${route} serves nothing the site publishes`);
  }
  return problems;
}

function pagesRouteProblems(site: readonly CaddyNode[], siteFiles: readonly string[]): string[] {
  const problems: string[] = [];
  const handles = new Map(site.filter((node) => directiveOf(node) === 'handle').map((node) => [node.tokens.slice(1).join(' '), node]));
  const expected = [...ASSOCIATION_ROUTES, ...PAGE_ROUTES.slice(0, -2).map(([route]) => route), ...ASSET_ROUTES, ...PAGE_ROUTES.slice(-2).map(([route]) => route)];
  if (!sameList([...handles.keys()], expected)) {
    problems.push(`the pages routes are [${[...handles.keys()].map((route) => route || '(catch-all)').join(', ')}], not the D21 route table`);
  }
  for (const route of ASSOCIATION_ROUTES) {
    const lines = childLines(handles.get(route));
    if (!lines.includes('header Content-Type application/json')) problems.push(`${route} is not served with Content-Type: application/json`);
    if (!lines.includes('file_server') || lines.some((line) => line.startsWith('rewrite'))) problems.push(`${route} is not served straight from the published file`);
  }
  problems.push(...assetRouteProblems(handles, siteFiles));
  for (const [route, file] of PAGE_ROUTES) {
    const lines = childLines(handles.get(route));
    if (!lines.includes(`rewrite * /${file}`) || !lines.includes('file_server')) problems.push(`${route || 'the catch-all'} does not rewrite to /${file}`);
    if (!siteFiles.includes(file)) problems.push(`${file} is not a page the site build renders`);
  }
  const notFound = handles.get('')?.children.find((node) => directiveOf(node) === 'file_server');
  if (!childLines(notFound).includes('status 404')) problems.push('the catch-all does not answer 404');
  return problems;
}

function pagesSiteProblems(site: readonly CaddyNode[], siteFiles: readonly string[]): string[] {
  const problems: string[] = [];
  for (const node of walkCaddy(site)) {
    if (PAGES_FORBIDDEN.includes(directiveOf(node))) problems.push(`the pages site uses ${directiveOf(node)} (line ${node.line})`);
    if (directiveOf(node) === 'file_server' && !childLines(node).includes('disable_canonical_uris')) {
      problems.push(`a pages file_server (line ${node.line}) can redirect: it lacks disable_canonical_uris`);
    }
  }
  for (const node of site) {
    if (!['root', 'header', 'handle'].includes(directiveOf(node))) problems.push(`the pages site has a top-level ${directiveOf(node)} (line ${node.line})`);
  }
  if (!site.some((node) => lineOf(node) === 'root * /srv/site/current')) problems.push('the pages site root is not /srv/site/current');
  const headers = childLines(site.find((node) => lineOf(node) === 'header'));
  if (!headers.includes(`Content-Security-Policy ${PAGES_CSP}`)) problems.push('the pages site lacks the D21 Content-Security-Policy');
  if (!headers.includes('X-Content-Type-Options nosniff')) problems.push('the pages site lacks X-Content-Type-Options nosniff');
  return [...problems, ...pagesRouteProblems(site, siteFiles)];
}

/** The address-less first block: Caddy's global options. */
function globalOptionsOf(nodes: readonly CaddyNode[]): CaddyNode | undefined {
  return nodes[0]?.tokens.length === 0 ? nodes[0] : undefined;
}

/** A real Caddy 2.11.4 line (the pinned image's version) for a reverse-proxy stream the upstream cut
 *  short: the live Cloud Logging shape with the header and address values swapped for markers. */
const CADDY_DEVICE_MARKER = 'e7e7e7e7-e7e7-4e7e-8e7e-e7e7e7e7e7e7';
const CADDY_CLIENT_IP = '203.0.113.7';
const CADDY_PROXY_ABORT_LINE = JSON.stringify({
  level: 'warn',
  ts: 1790258739.854872,
  logger: 'http.handlers.reverse_proxy',
  msg: 'aborting with incomplete response',
  upstream: 'whim-server:8787',
  duration: 0.003840542,
  request: {
    remote_ip: CADDY_CLIENT_IP,
    remote_port: '55055',
    client_ip: CADDY_CLIENT_IP,
    proto: 'HTTP/1.1',
    method: 'POST',
    host: 'api.example.test',
    uri: '/v1/generate',
    headers: {
      Accept: ['*/*'],
      'X-Whim-Device': [CADDY_DEVICE_MARKER],
      'X-Forwarded-For': [CADDY_CLIENT_IP],
      'X-Forwarded-Proto': ['https'],
      'X-Forwarded-Host': ['api.example.test'],
      Via: ['1.1 Caddy'],
      'User-Agent': ['okhttp/4.12.0'],
    },
  },
  error: 'reading: unexpected EOF',
});

/** The fields a shipped line still carries that identify the device or the client. */
function clientDataLeaks(payload: Readonly<Record<string, unknown>>): string[] {
  const text = JSON.stringify(payload);
  const request = payload.request as Record<string, unknown> | undefined;
  return [
    ...(text.includes(CADDY_DEVICE_MARKER) ? ['the X-Whim-Device value'] : []),
    ...(text.includes(CADDY_CLIENT_IP) ? ['the client IP'] : []),
    ...['remote_ip', 'client_ip', 'remote_port', 'headers'].filter((name) => request !== undefined && name in request).map((name) => `request.${name}`),
  ];
}

/** Caddy's default logger, which writes `http.log.error` and the reverse proxy's lines, runs the
 *  committed `format filter`: its `delete` paths are applied to the real line, which must keep its
 *  level and message but lose everything naming the device or the client. */
function caddyLogProblems(text: string, line: string): string[] {
  let nodes: CaddyNode[];
  try {
    nodes = parseCaddyfile(text);
  } catch (error) {
    return [(error as Error).message];
  }
  const logs = globalOptionsOf(nodes)?.children.filter((node) => directiveOf(node) === 'log') ?? [];
  const logger = logs.find((node) => node.tokens.length === 1 || node.tokens[1] === 'default');
  if (!logger) return ['the global options configure no log for the default logger'];
  const format = logger.children.find((node) => lineOf(node) === 'format filter');
  if (!format) return ['the default logger has no format filter'];
  const problems: string[] = [];
  if (!childLines(format).includes('wrap json')) problems.push('the default logger\'s filter does not wrap json, which the Ops Agent parses');
  const deletes = (format.children.find((node) => lineOf(node) === 'fields')?.children ?? [])
    .filter((node) => node.tokens[1] === 'delete')
    .map((node) => node.tokens[0]!.split('>'));
  const payload = JSON.parse(line) as Record<string, unknown>;
  for (const keys of deletes) {
    const parent = keys.slice(0, -1).reduce<Record<string, unknown> | undefined>((at, key) => at?.[key] as Record<string, unknown> | undefined, payload);
    if (parent) delete parent[keys.at(-1)!];
  }
  if (payload.level !== 'warn' || payload.msg !== 'aborting with incomplete response') problems.push('the filter drops the line\'s level or message');
  return [...problems, ...clientDataLeaks(payload).map((leak) => `Caddy still writes ${leak}`)];
}

function caddyfileProblems(text: string, maxBodyBytes: number, siteFiles: readonly string[]): string[] {
  let sites: CaddyNode[];
  try {
    sites = parseCaddyfile(text);
  } catch (error) {
    return [(error as Error).message];
  }
  const addresses = sites.filter((node) => node !== globalOptionsOf(sites)).map(lineOf);
  const api = sites.find((node) => lineOf(node) === '{$WHIM_API_HOST}');
  const pages = sites.find((node) => lineOf(node) === '{$WHIM_WEB_HOST}');
  return [
    ...(addresses.join(', ') === '{$WHIM_API_HOST}, {$WHIM_WEB_HOST}' ? [] : [`the Caddyfile's sites are ${addresses.join(', ')}`]),
    ...apiSiteProblems(api?.children ?? [], maxBodyBytes),
    ...pagesSiteProblems(pages?.children ?? [], siteFiles),
  ];
}

// ---------------------------------------------------------------------------------------------
// Repository scans

const SANDBOX_DISABLING = [/--no-sandbox\b/, /--disable-setuid-sandbox\b/, /chromiumSandbox\s*:\s*false/];
const PRODUCTION_DEPLOY_FILES = ['deploy/Dockerfile', 'deploy/cloudbuild.yaml', 'deploy/compose.yaml', 'deploy/deploy.sh', 'deploy/resize.sh'];
const ASSOCIATION_MARKERS = ['delegate_permission', 'sha256_cert_fingerprints', 'applinks', 'webcredentials', 'appIDs'];
const KEY_SETTING_COMMANDS = ['versions add', '--data-file', 'addresses create'];

function sandboxFlagProblems(files: ReadonlyMap<string, string>): string[] {
  return [...files].filter(([, text]) => SANDBOX_DISABLING.some((flag) => flag.test(text))).map(([rel]) => `${rel} disables the Chromium sandbox`);
}

/** The registrable (apex) domain from `deploy/defaults.env`'s own `WHIM_WEB_HOST` (e.g.
 *  `whim.anycognition.ca` → `anycognition.ca`) — the single-source rule this checker enforces
 *  reads its OWN comparison value from that file too, so a domain migration changes one line, not
 *  two (this checker included). */
function apexDomainOf(webHost: string): string {
  const labels = webHost.split('.');
  return labels.slice(-2).join('.');
}

/** The domain lives ONLY in `deploy/defaults.env` (spec: single source) — `server/src` and every
 *  other deploy file must never hardcode it, so a domain migration is one edit, not a hunt. */
function hostnameProblems(serverSources: ReadonlyMap<string, string>, deploy: ReadonlyMap<string, string>, apexDomain: string): string[] {
  const problems: string[] = [];
  for (const [rel, text] of serverSources) {
    if (text.includes(apexDomain)) problems.push(`${rel} names a public hostname`);
  }
  for (const [rel, text] of deploy) {
    const hostnameIsConfig = rel === 'deploy/defaults.env' || rel.startsWith('deploy/site/');
    if (!hostnameIsConfig && text.includes(apexDomain)) problems.push(`${rel} names a hostname outside deploy/defaults.env`);
  }
  return problems;
}

function loadtestProblems(files: ReadonlyMap<string, string>): string[] {
  return PRODUCTION_DEPLOY_FILES.filter((rel) => /loadtest/i.test(files.get(rel) ?? '')).map((rel) => `${rel} references the load test`);
}

function associationWriteProblems(files: ReadonlyMap<string, string>): string[] {
  const problems: string[] = [];
  for (const [rel, text] of files) {
    for (const marker of ASSOCIATION_MARKERS) if (text.includes(marker)) problems.push(`${rel} contains association file content (${marker})`);
    if (!rel.endsWith('.sh')) continue;
    text.split('\n').forEach((line, index) => {
      if (line.includes('.well-known') && /(?:>|\btee\b|^\s*(?:sudo\s+)?(?:cp|install|mv|ln)\s)/.test(line)) {
        problems.push(`${rel}:${index + 1} writes into a .well-known path`);
      }
    });
  }
  return problems;
}

function retentionProblems(files: ReadonlyMap<string, string>): string[] {
  return [...files].filter(([, text]) => text.includes('RETENTION_DAYS')).map(([rel]) => `${rel} sets a retention variable`);
}

/** Deleted records outlive a deletion inside the disk snapshots, so each privacy page states the
 *  snapshot schedule's own retention (`SNAPSHOT_KEEP_DAYS` in provision.sh). */
const BACKUP_SENTENCES: ReadonlyArray<readonly [string, RegExp]> = [
  ['deploy/site/privacy.html', /encrypted disk backups for up to (\d+) days/],
  ['deploy/site/fr/privacy.html', /sauvegardes chiffrées du disque jusqu’à (\d+) jours/],
];

function backupWordingProblems(provisionText: string, pages: ReadonlyMap<string, string>): string[] {
  const keepDays = /\bSNAPSHOT_KEEP_DAYS=(\d+)\b/.exec(provisionText)?.[1];
  if (keepDays === undefined) return ['provision.sh sets no SNAPSHOT_KEEP_DAYS'];
  return BACKUP_SENTENCES.flatMap(([rel, sentence]) => {
    const stated = sentence.exec(pages.get(rel) ?? '')?.[1];
    return stated === keepDays ? [] : [`${rel} says backups keep deleted records ${stated ?? 'for an unstated time'}, but snapshots are kept ${keepDays} days`];
  });
}

function keySettingProblems(files: ReadonlyMap<string, string>): string[] {
  return [...files].flatMap(([rel, text]) => KEY_SETTING_COMMANDS.filter((command) => text.includes(command)).map((command) => `${rel} runs ${command}`));
}

function requiredLineProblems(rel: string, text: string, required: readonly string[]): string[] {
  const lines = new Set(text.split('\n').map((line) => line.trim()));
  return required.filter((line) => !lines.has(line)).map((line) => `${rel} lacks ${line}`);
}

/** The one build argument the image takes: the commit it is built from, from the same substitution
 *  that tags it (developer-observability D13). */
const COMMIT_BUILD_ARG = '--build-arg=WHIM_COMMIT=$COMMIT_SHA';

function cloudbuildProblems(text: string): string[] {
  const problems: string[] = [];
  for (const needle of ['--platform=linux/amd64', '-docker.pkg.dev/$PROJECT_ID/whim/server:$COMMIT_SHA', COMMIT_BUILD_ARG]) {
    if (!text.includes(needle)) problems.push(`cloudbuild.yaml lacks ${needle}`);
  }
  for (const forbidden of ['secretEnv', 'availableSecrets']) {
    if (text.includes(forbidden)) problems.push(`cloudbuild.yaml uses ${forbidden}`);
  }
  const buildArgs = text.split('\n').filter((line) => line.includes('--build-arg'));
  for (const line of buildArgs) {
    if (line.trim().replace(/^- /, '') !== COMMIT_BUILD_ARG) problems.push(`cloudbuild.yaml uses --build-arg other than ${COMMIT_BUILD_ARG}: ${line.trim()}`);
  }
  if (buildArgs.length > 1) problems.push(`cloudbuild.yaml passes ${buildArgs.length} --build-arg lines`);
  const stepImages = text
    .split('\n')
    .map((line) => line.trim().replace(/^- /, ''))
    .filter((line) => line.startsWith('name:'))
    .map((line) => line.slice('name:'.length).trim());
  if (stepImages.length === 0) problems.push('cloudbuild.yaml has no build step');
  for (const image of stepImages) {
    if (!/@sha256:[0-9a-f]{64}$/.test(image)) problems.push(`cloudbuild step image ${image} is not pinned by digest`);
  }
  return problems;
}

// ---------------------------------------------------------------------------------------------
// Capacity profiles (design D25)

const PROFILE_HOST_KEYS = ['WHIM_PROFILE_MACHINE_TYPE', 'WHIM_SERVER_MEM_LIMIT', 'WHIM_SERVER_SHM_SIZE'];
const PROFILE_FORBIDDEN_NAMES = new Set(['NODE_ENV', 'WHIM_PIPELINE', 'WHIM_DEV_LOG_SINK', 'OPENROUTER_API_KEY']);

/** Every environment variable `loadServerConfig` reads, observed rather than listed by hand. */
function keysReadByLoadServerConfig(): Set<string> {
  const read = new Set<string>();
  const recorder = new Proxy({} as NodeJS.ProcessEnv, {
    get(_target, property) {
      if (typeof property === 'string') read.add(property);
      return undefined;
    },
  });
  loadServerConfig(recorder);
  return read;
}

/** A minimum build is an operator value: in a profile it would reach config.env beside the
 *  operator's own line, and a resize would silently move it (app-update-gate). So is a keep-period,
 *  which deploy.sh's preflight checks against the disclosure manifest before any profile is read. */
function isForbiddenProfileKey(key: string): boolean {
  return (
    PROFILE_FORBIDDEN_NAMES.has(key) ||
    key.startsWith('WHIM_LIMIT_') ||
    key.startsWith('WHIM_MIN_BUILD_') ||
    key.includes('RETENTION') ||
    (KEEP_PERIOD_VARIABLES as readonly string[]).includes(key) ||
    SECRET_NAME.test(key)
  );
}

function profileKeyProblems(name: string, keys: readonly string[], readKeys: ReadonlySet<string>): string[] {
  const problems: string[] = [];
  for (const key of keys) {
    if (!PROFILE_HOST_KEYS.includes(key) && !readKeys.has(key)) problems.push(`profile ${name} sets ${key}, neither a profile key nor a server variable`);
    if (isForbiddenProfileKey(key)) problems.push(`profile ${name} sets ${key}, which no profile may set`);
  }
  if (new Set(keys).size !== keys.length) problems.push(`profile ${name} repeats a key`);
  for (const key of PROFILE_HOST_KEYS) if (!keys.includes(key)) problems.push(`profile ${name} lacks ${key}`);
  return problems;
}

function profileProblems(name: string, text: string, readKeys: ReadonlySet<string>): string[] {
  const entries = envEntries(text);
  const problems = profileKeyProblems(name, entries.map(([key]) => key), readKeys);
  let config: ReturnType<typeof loadServerConfig>;
  try {
    config = loadServerConfig(Object.fromEntries(entries.filter(([key]) => !PROFILE_HOST_KEYS.includes(key))));
  } catch (error) {
    return [...problems, `profile ${name}'s server keys don't load: ${(error as Error).message}`];
  }
  const machineType = Object.fromEntries(entries).WHIM_PROFILE_MACHINE_TYPE ?? '';
  // The standard profile runs on the server's own limits.
  if (name === 'standard' && entries.some(([key]) => readKeys.has(key))) problems.push('standard must not override server limits');
  const vcpus = Number(/-(\d+)$/.exec(machineType)?.[1] ?? Number.NaN);
  if (Number.isNaN(vcpus) || config.synthrunConcurrency > vcpus) {
    problems.push(`profile ${name}: WHIM_SYNTHRUN_CONCURRENCY ${config.synthrunConcurrency} exceeds ${machineType}'s vCPU count`);
  }
  if (config.synthrunConcurrency > config.maxConcurrentGenerations) {
    problems.push(`profile ${name}: WHIM_SYNTHRUN_CONCURRENCY ${config.synthrunConcurrency} exceeds the generation cap ${config.maxConcurrentGenerations}`);
  }
  return problems;
}

// ---------------------------------------------------------------------------------------------
// Operator scripts under PATH stubs

interface Sandbox {
  readonly dir: string;
  readonly repo: string;
  readonly home: string;
  readonly bin: string;
  readonly stubs: string;
}

interface ScriptRun {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/** [glob over the stub's arguments, exit code, stdout (printf %b escapes), body for curl -o]. */
type StubRule = readonly [string, number, string?, string?];

const RULE_SEPARATOR = '\x1f';
const STATIC_IP = '203.0.113.7';
const WEB_HOST = 'pages.example.test';
const API_HOST = `api.${WEB_HOST}`;
const FAKE_KEY = 'sk-or-v1-0000000000000000stubvalue0000000000000000';
const TAG = 'a'.repeat(40);

/** One stub body for every tool: logs its arguments, answers from <tool>.rules (first glob wins),
 *  and otherwise keeps a little state (the VM's machine type, the last upload, the site build). */
const STUB_SCRIPT = [
  '#!/usr/bin/env bash',
  'set -u',
  'tool="$(basename "$0")"',
  'all="$*"',
  "newline=$'\\n'",
  'printf \'%s\\n\' "${all//$newline/ }" >>"$STUB_DIR/$tool.log"',
  'case "$tool $*" in',
  '  gcloud*compute\\ ssh*--command\\ :*)',
  '  [ "${STUB_READINESS_HANG:-0}" = 1 ] && sleep 20',
  '  readiness_count_file="$STUB_DIR/readiness-count"',
  '  readiness_count=0; [ -f "$readiness_count_file" ] && readiness_count=$(cat "$readiness_count_file")',
  '  readiness_count=$((readiness_count + 1)); printf "%s" "$readiness_count" >"$readiness_count_file"',
  '  if [ "$readiness_count" -le "${STUB_READINESS_FAILS:-0}" ]; then printf "ERROR: (gcloud.compute.ssh) Could not connect to port 22: IAP 4003\\n" >>"$STUB_DIR/gcloud.log"; printf "ERROR: (gcloud.compute.ssh) Could not connect to port 22: IAP 4003\\n" >&2; exit 1; fi',
  ';;',
  'esac',
  'case "$tool $*" in',
  '  "gcloud "*" compute ssh "*server.env*) cat >"$STUB_DIR/server-env-stdin" ;;',
  'esac',
  // Keeps each file a gcloud call reads (--policy-from-file=... and the like) as from-file/<n>-<name>.
  'if [ "$tool" = gcloud ]; then',
  '  for arg in "$@"; do',
  '    case "$arg" in --*-from-file=*) mkdir -p "$STUB_DIR/from-file"; n=$(ls "$STUB_DIR/from-file" | wc -l); cp "${arg#*=}" "$STUB_DIR/from-file/$((n + 1))-${arg##*/}" ;; esac',
  '  done',
  'fi',
  'out_file=""',
  'previous=""',
  'for arg in "$@"; do',
  '  if [ "$previous" = -o ]; then out_file="$arg"; fi',
  '  previous="$arg"',
  'done',
  'if [ -f "$STUB_DIR/$tool.rules" ]; then',
  "  while IFS=$'\\x1f' read -r pattern code output body; do",
  '    [[ "$*" == $pattern ]] || continue',
  '    printf \'%b\' "$output"',
  '    if [ -n "$out_file" ]; then printf \'%b\' "$body" >"$out_file"; fi',
  '    exit "$code"',
  '  done <"$STUB_DIR/$tool.rules"',
  'fi',
  'case "$tool $*" in',
  '  "gcloud "*" compute scp "*) rm -rf "$STUB_DIR/upload"; cp -R "${@: -2:1}" "$STUB_DIR/upload" ;;',
  '  "gcloud "*" compute instances set-machine-type "*) printf \'%s\' "${@: -1}" >"$STUB_DIR/machine-type" ;;',
  '  "gcloud "*" compute instances describe "*) cat "$STUB_DIR/machine-type"; echo ;;',
  '  "node -p "*) echo "${STUB_NODE_VERSION:-22.11.0}" ;;',
  '  "node -e const { spawnSync }"*) exec "$STUB_REAL_NODE" "$@" ;;',
  '  "node -e let healthText"*) exec "$STUB_REAL_NODE" "$@" ;;',
  '  "node server/config-check.mjs"*) cd "$STUB_REAL_ROOT" && exec "$STUB_REAL_NODE" "$@" ;;',
  '  "node server/site.mjs "*)',
  '    printf \'%s\\n\' "${WHIM_BETA_SIGNUP_URL:-}" >"$STUB_DIR/site-signup-url"',
  '    mkdir -p "${@: -1}"',
  '    for page in privacy support app-link not-found; do echo "<!doctype html><title>$page</title>" >"${@: -1}/$page.html"; done',
  '    echo "association files: absent (release/android-upload-cert.sha256); app link verification stays PENDING" ;;',
  '  "node -e "*) cat >/dev/null; echo "3 frames over 2001 ms" ;;',
  'esac',
  'exit 0',
  '',
].join('\n');

const DEPLOY_STUB_SCRIPT = ['#!/usr/bin/env bash', 'printf \'%s\\n\' "$*" >>"$STUB_DIR/deploy.log"', 'exit "${STUB_DEPLOY_EXIT:-0}"', ''].join('\n');

/** Runs bash or git from PATH. The suite runs inside the repo's own dev and CI toolchain, and the
 *  scripts under test resolve gcloud, node, dig and curl from PATH by design: the stubs rely on it. */
function runFromPath(command: 'bash' | 'git', args: readonly string[], options: SpawnSyncOptionsWithStringEncoding): SpawnSyncReturns<string> {
  return spawnSync(command, args, options);
}

function git(cwd: string, home: string, args: readonly string[]): void {
  const result = runFromPath('git', ['-c', 'user.name=whim-test', '-c', 'user.email=whim-test@example.invalid', '-c', 'commit.gpgsign=false', ...args], {
    cwd,
    encoding: 'utf8',
    env: { PATH: process.env.PATH ?? '', HOME: home, GIT_CONFIG_NOSYSTEM: '1' },
  });
  if (result.status !== 0) throw new Error(`setup: git ${args.join(' ')} failed: ${result.stderr}`);
}

/** A pushed git checkout holding this repo's deploy/, with stubbed tools on PATH. */
function makeSandbox(): Sandbox {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whim-deploy-'));
  const sandbox: Sandbox = { dir, repo: path.join(dir, 'repo'), home: path.join(dir, 'home'), bin: path.join(dir, 'bin'), stubs: path.join(dir, 'stubs') };
  for (const directory of [sandbox.repo, sandbox.home, sandbox.bin, sandbox.stubs]) fs.mkdirSync(directory, { recursive: true });
  fs.cpSync(path.join(ROOT, 'deploy'), path.join(sandbox.repo, 'deploy'), { recursive: true });
  for (const tool of ['gcloud', 'node', 'dig', 'curl']) fs.writeFileSync(path.join(sandbox.bin, tool), STUB_SCRIPT, { mode: 0o755 });
  fs.writeFileSync(path.join(sandbox.stubs, 'machine-type'), 'e2-standard-2');
  git(dir, sandbox.home, ['init', '-q', '--bare', 'remote.git']);
  git(sandbox.repo, sandbox.home, ['init', '-q']);
  git(sandbox.repo, sandbox.home, ['add', '-A']);
  git(sandbox.repo, sandbox.home, ['commit', '-q', '-m', 'deploy']);
  git(sandbox.repo, sandbox.home, ['remote', 'add', 'origin', path.join(dir, 'remote.git')]);
  git(sandbox.repo, sandbox.home, ['push', '-q', 'origin', 'HEAD:refs/heads/main']);
  return sandbox;
}

/** Commits and pushes every change in the sandbox checkout, so deploy.sh's clean-tree check passes. */
function commitAndPush(sandbox: Sandbox, message: string): void {
  git(sandbox.repo, sandbox.home, ['commit', '-q', '-am', message]);
  git(sandbox.repo, sandbox.home, ['push', '-q', 'origin', 'HEAD:refs/heads/main']);
}

function withSandbox(body: (sandbox: Sandbox) => void): void {
  const sandbox = makeSandbox();
  try {
    body(sandbox);
  } finally {
    fs.rmSync(sandbox.dir, { recursive: true, force: true });
  }
}

function writeOperatorFile(sandbox: Sandbox, values: Readonly<Record<string, string>> = {}): void {
  fs.mkdirSync(path.join(sandbox.home, '.config', 'whim'), { recursive: true });
  const optionalValues = Object.entries(values).map(([key, value]) => `${key}=${value}`).join('\n');
  fs.writeFileSync(
    path.join(sandbox.home, '.config', 'whim', 'deploy.env'),
    ['WHIM_SUPPORT_EMAIL=ops@example.test', 'WHIM_ENGINEER_MODEL=vendor/engineer-1', 'WHIM_REWRITE_MODEL=vendor/rewrite-1', optionalValues]
      .filter((line) => line !== '')
      .join('\n') + '\n',
  );
}

function writeRules(sandbox: Sandbox, tool: string, rules: readonly StubRule[]): void {
  const lines = rules.map(([pattern, code, output = '', body = '']) => [pattern, String(code), output, body].join(RULE_SEPARATOR));
  fs.writeFileSync(path.join(sandbox.stubs, `${tool}.rules`), `${lines.join('\n')}\n`);
}

function runScript(sandbox: Sandbox, script: string, args: readonly string[], env: Readonly<Record<string, string>> = {}): ScriptRun {
  const result = runFromPath('bash', [path.join(sandbox.repo, 'deploy', script), ...args], {
    cwd: sandbox.repo,
    encoding: 'utf8',
    input: '',
    timeout: 60_000,
    env: {
      PATH: `${sandbox.bin}${path.delimiter}${process.env.PATH ?? ''}`,
      HOME: sandbox.home,
      TMPDIR: os.tmpdir(),
      STUB_DIR: sandbox.stubs,
      STUB_REAL_NODE: process.execPath,
      // The sandbox checkout holds deploy/ only; the server's config parse runs from this repo.
      STUB_REAL_ROOT: ROOT,
      WHIM_WEB_HOST: WEB_HOST,
      WHIM_API_HOST: API_HOST,
      WHIM_STATIC_IP: STATIC_IP,
      ...env,
    },
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function toolLog(sandbox: Sandbox, tool: string): string[] {
  const file = path.join(sandbox.stubs, `${tool}.log`);
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter((line) => line !== '') : [];
}

function stubFile(sandbox: Sandbox, rel: string): string {
  const file = path.join(sandbox.stubs, rel);
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
}

function indexOfCall(lines: readonly string[], needle: string): number {
  return lines.findIndex((line) => line.includes(needle));
}

const SECRET_READABLE: readonly StubRule[] = [
  ['*secrets describe*', 0, 'projects/anycognition-whim/secrets/whim-openrouter-api-key\\n'],
  ['*secrets versions list*', 0, '7\\n'],
  ['*secrets versions access*', 0, FAKE_KEY],
];
const DNS_READY: readonly StubRule[] = [
  [`+short A ${API_HOST}`, 0, `${STATIC_IP}\\n`],
  [`+short A ${WEB_HOST}`, 0, `${STATIC_IP}\\n`],
];
const HTML = 'text/html; charset=utf-8';
const PAGES_UP: readonly StubRule[] = [
  [`*https://${WEB_HOST}/privacy`, 0, `200|${HTML}|`, '<html>'],
  [`*https://${WEB_HOST}/privacy/v1`, 0, `200|${HTML}|`, '<html>'],
  [`*https://${WEB_HOST}/terms`, 0, `200|${HTML}|`, '<html>'],
  [`*https://${WEB_HOST}/fr/privacy`, 0, `200|${HTML}|`, '<html>'],
  [`*https://${WEB_HOST}/fr/terms`, 0, `200|${HTML}|`, '<html>'],
  [`*https://${WEB_HOST}/support`, 0, `200|${HTML}|`, '<html>'],
  [`*https://${WEB_HOST}/a/x`, 0, `200|${HTML}|`, '<html>'],
  [`*https://${WEB_HOST}/beta`, 0, `200|${HTML}||${PAGES_CSP}`, '<html>'],
  [`*https://${WEB_HOST}/beta/thanks`, 0, `200|${HTML}|`, '<html>'],
  [`*https://${WEB_HOST}/beta/retry`, 0, `200|${HTML}|`, '<html>'],
  [`*https://${WEB_HOST}/nope`, 0, `404|${HTML}|`, '<html>'],
  [`*https://${WEB_HOST}/.well-known/*`, 0, '404|application/json|', ''],
];
/** The commit the fixture server's image reports: any full SHA, since smoke run standalone accepts any. */
const HEALTH_COMMIT = '0123456789abcdef0123456789abcdef01234567';
/** The default-configuration `/healthz` body of an image built at HEALTH_COMMIT; `smokeTests` checks
 *  it against the real server's. */
const DEFAULT_HEALTH = `{"ok":true,"service":"whim-server","commit":"${HEALTH_COMMIT}","minBuild":{"ios":0,"android":0}}`;
const API_UP: readonly StubRule[] = [
  [`*https://${API_HOST}/healthz`, 0, '200|application/json|', DEFAULT_HEALTH],
  [`*https://${API_HOST}/v1/generate`, 0, '400|application/json|', '{}'],
  [`*https://${API_HOST}/healthz/sse`, 0, ': whim-healthz-probe\\n\\n'],
  [`*https://${API_HOST}/beta/signup`, 0, `303|text/plain|https://${WEB_HOST}/beta/thanks`, ''],
];
const VM_ANSWERS: readonly StubRule[] = [
  ['*compute ssh*169.254.169.254*', 0, 'blocked'],
  ['*compute ssh*react-native*', 0, 'absent'],
  ['*compute ssh*test -f*', 0, 'absent\\n'],
];

function deployPreflightTests(): void {
  section('Deploy scripts: deploy.sh preflight');

  withSandbox((sandbox) => {
    writeOperatorFile(sandbox);
    const run = runScript(sandbox, 'deploy.sh', ['--profile', 'event']);
    eq('deploy.sh --profile is refused as an unknown argument (the profile follows the VM)', run.status, 2);
    check('  ... naming --profile, before any gcloud call', run.stderr.includes('unknown argument: --profile') && toolLog(sandbox, 'gcloud').length === 0, run.stderr);
  });

  withSandbox((sandbox) => {
    const run = runScript(sandbox, 'deploy.sh', []);
    eq('deploy.sh without the operator values exits 1', run.status, 1);
    for (const name of ['WHIM_SUPPORT_EMAIL', 'WHIM_ENGINEER_MODEL', 'WHIM_REWRITE_MODEL']) {
      check(`  ... naming ${name}`, run.stderr.includes(`missing required value ${name}`), run.stderr);
    }
    eq('  ... before any gcloud call', toolLog(sandbox, 'gcloud'), []);
  });

  withSandbox((sandbox) => {
    writeOperatorFile(sandbox);
    const run = runScript(sandbox, 'deploy.sh', [], { WHIM_API_HOST: 'api.elsewhere.example.test' });
    check('deploy.sh refuses a WHIM_API_HOST that is not api.<WHIM_WEB_HOST>', run.status === 1 && run.stderr.includes(`WHIM_API_HOST must be api.${WEB_HOST}`), run.stderr);
    eq('  ... before any gcloud call', toolLog(sandbox, 'gcloud'), []);
  });

  withSandbox((sandbox) => {
    writeOperatorFile(sandbox, { WHIM_PLAN_REASONING: 'fast' });
    const run = runScript(sandbox, 'deploy.sh', []);
    check('deploy.sh refuses an invalid reasoning setting and names its variable', run.status === 1 && run.stderr.includes('WHIM_PLAN_REASONING') && run.stderr.includes('default'), run.stderr);
    eq('  ... before any gcloud call', toolLog(sandbox, 'gcloud'), []);
  });

  withSandbox((sandbox) => {
    writeOperatorFile(sandbox, { WHIM_REPAIR_REASONING: 'fast' });
    const run = runScript(sandbox, 'deploy.sh', []);
    check('deploy.sh refuses invalid repair reasoning and names its variable', run.status === 1 && run.stderr.includes('WHIM_REPAIR_REASONING') && run.stderr.includes('default'), run.stderr);
    eq('  ... before any gcloud call', toolLog(sandbox, 'gcloud'), []);
  });

  // deploy.sh must refuse exactly what would stop the server booting, and nothing it would accept:
  // a value that slipped through here takes the API down mid-deploy.
  for (const value of ['0', '382000', '123456789012345', '-1', '0382000', '38200O', '1e5', '1234567890123456']) {
    const bootAccepts = !configRefuses({ WHIM_MIN_BUILD_ANDROID: value }, 'WHIM_MIN_BUILD_ANDROID');
    withSandbox((sandbox) => {
      writeOperatorFile(sandbox, { WHIM_MIN_BUILD_ANDROID: value });
      const run = runScript(sandbox, 'deploy.sh', []);
      const refused = run.stderr.includes('WHIM_MIN_BUILD_ANDROID must be');
      // The first gcloud call is the secret lookup, right after the value checks.
      const pastValueChecks = toolLog(sandbox, 'gcloud').length > 0;
      if (bootAccepts) {
        check(`deploy.sh accepts WHIM_MIN_BUILD_ANDROID=${value}, as server boot does`, !refused && pastValueChecks, run.stderr);
      } else {
        check(`deploy.sh refuses WHIM_MIN_BUILD_ANDROID=${value}, naming it before any gcloud call, as server boot does`, run.status === 1 && refused && !pastValueChecks, run.stderr);
      }
    });
  }

  // The keep-period preflight is the server's own boot parse (server/config-check.mjs), so deploy.sh
  // refuses exactly what boot would (specs/device-records).
  const idleMaximum = keepLimit(MANIFESTS[latestVersion()], 'usage-records')?.days ?? 0;
  for (const value of [String(idleMaximum), String(idleMaximum + 1), '0']) {
    const bootAccepts = !configRefuses({ WHIM_USAGE_IDLE_DAYS: value }, 'WHIM_USAGE_IDLE_DAYS');
    withSandbox((sandbox) => {
      writeOperatorFile(sandbox, { WHIM_USAGE_IDLE_DAYS: value });
      const run = runScript(sandbox, 'deploy.sh', []);
      const refused = run.status === 1 && run.stderr.includes('WHIM_USAGE_IDLE_DAYS') && run.stderr.includes('would refuse these values at boot');
      const pastValueChecks = toolLog(sandbox, 'gcloud').length > 0;
      if (bootAccepts) {
        check(`deploy.sh accepts WHIM_USAGE_IDLE_DAYS=${value}, as server boot does`, !refused && pastValueChecks, run.stderr);
      } else {
        check(`deploy.sh refuses WHIM_USAGE_IDLE_DAYS=${value}, naming it before any gcloud call, as server boot does`, refused && !pastValueChecks, run.stderr);
      }
    });
  }
  withSandbox((sandbox) => {
    writeOperatorFile(sandbox, { WHIM_USAGE_IDLE_DAYS: '400' });
    const run = runScript(sandbox, 'deploy.sh', []);
    check(
      `red: deploy.sh refuses WHIM_USAGE_IDLE_DAYS=400, naming the variable and the ${idleMaximum}-day manifest maximum`,
      run.status === 1 && run.stderr.includes('WHIM_USAGE_IDLE_DAYS') && new RegExp(String.raw`\b${idleMaximum}\b`).test(run.stderr),
      run.stderr,
    );
    eq('  ... before any gcloud call', toolLog(sandbox, 'gcloud'), []);
  });

  // The beta signup limits are operator values (beta-waitlist D3's lever for a shared venue network):
  // a value boot refuses is refused here first, before it could take the API down mid-deploy.
  for (const variable of ['WHIM_BETA_LIMIT_PER_CLIENT_HOUR', 'WHIM_BETA_LIMIT_PER_DAY']) {
    check(`setup: server boot refuses ${variable}=0`, configRefuses({ [variable]: '0' }, variable));
    withSandbox((sandbox) => {
      writeOperatorFile(sandbox, { [variable]: '0' });
      const run = runScript(sandbox, 'deploy.sh', []);
      check(`deploy.sh refuses ${variable}=0, naming it, as server boot does`, run.status === 1 && run.stderr.includes(variable) && run.stderr.includes('would refuse these values at boot'), run.stderr);
      eq('  ... before any gcloud call', toolLog(sandbox, 'gcloud'), []);
    });
  }

  // A profile's server lines reach config.env too, so the same boot parse covers them: every
  // profile, since a resize can move the VM to any of them (legal-surface-v2 review L4).
  for (const variable of KEEP_PERIOD_VARIABLES) {
    const tooLong = '4000';
    check(`setup: server boot refuses ${variable}=${tooLong}`, configRefuses({ [variable]: tooLong }, variable));
    withSandbox((sandbox) => {
      writeOperatorFile(sandbox);
      fs.appendFileSync(path.join(sandbox.repo, 'deploy', 'profiles', 'event.env'), `${variable}=${tooLong}\n`);
      commitAndPush(sandbox, 'profile keep-period');
      const run = runScript(sandbox, 'deploy.sh', []);
      check(
        `deploy.sh refuses ${variable}=${tooLong} set by a machine profile, naming it and the profile`,
        run.status === 1 && run.stderr.includes(variable) && run.stderr.includes('would refuse these values at boot') && run.stderr.includes('profile event'),
        run.stderr,
      );
      eq('  ... before any gcloud call', toolLog(sandbox, 'gcloud'), []);
    });
  }
  withSandbox((sandbox) => {
    writeOperatorFile(sandbox);
    fs.appendFileSync(path.join(sandbox.repo, 'deploy', 'profiles', 'standard.env'), 'WHIM_USAGE_IDLE_DAYS=180\n');
    commitAndPush(sandbox, 'profile keep-period');
    const run = runScript(sandbox, 'deploy.sh', []);
    check(
      'deploy.sh accepts a keep-period within the maximum set by a machine profile, and goes on to gcloud',
      !run.stderr.includes('would refuse these values at boot') && toolLog(sandbox, 'gcloud').length > 0,
      run.stderr,
    );
  });

  withSandbox((sandbox) => {
    writeOperatorFile(sandbox);
    const run = runScript(sandbox, 'deploy.sh', [], { STUB_NODE_VERSION: '24.1.0' });
    check('deploy.sh refuses Node 24, naming the Node 22 requirement', run.status === 1 && run.stderr.includes('Node 24.1.0') && run.stderr.includes('Node 22'), run.stderr);
    eq('  ... before any gcloud call', toolLog(sandbox, 'gcloud'), []);
  });

  withSandbox((sandbox) => {
    writeOperatorFile(sandbox);
    writeRules(sandbox, 'node', [['scripts/release/run.mjs disclosure-check', 1, 'disclosure-check: version 2 was released and has widened\\n']]);
    const run = runScript(sandbox, 'deploy.sh', []);
    check('deploy.sh refuses when the disclosure release check fails', run.status === 1 && run.stderr.includes('disclosure release check failed'), run.stderr);
    eq('  ... before any gcloud call', toolLog(sandbox, 'gcloud'), []);
  });

  withSandbox((sandbox) => {
    writeOperatorFile(sandbox);
    runScript(sandbox, 'deploy.sh', []);
    check('deploy.sh runs the disclosure release check on a deploy that goes ahead', toolLog(sandbox, 'node').includes('scripts/release/run.mjs disclosure-check'));
    check('  ... and gets past it to the secret lookup', toolLog(sandbox, 'gcloud').length > 0);
  });

  withSandbox((sandbox) => {
    writeOperatorFile(sandbox);
    fs.writeFileSync(path.join(sandbox.repo, 'deploy', 'stray.txt'), 'uncommitted');
    const run = runScript(sandbox, 'deploy.sh', []);
    check('deploy.sh refuses a dirty tree', run.status === 1 && run.stderr.includes('uncommitted or untracked'), run.stderr);
    eq('  ... before any gcloud call', toolLog(sandbox, 'gcloud'), []);
  });

  withSandbox((sandbox) => {
    writeOperatorFile(sandbox);
    fs.writeFileSync(path.join(sandbox.repo, 'deploy', 'stray.txt'), 'committed, never pushed');
    git(sandbox.repo, sandbox.home, ['add', '-A']);
    git(sandbox.repo, sandbox.home, ['commit', '-q', '-m', 'local only']);
    const run = runScript(sandbox, 'deploy.sh', []);
    check('deploy.sh refuses an unpushed commit', run.status === 1 && run.stderr.includes('not on any remote branch'), run.stderr);
    eq('  ... before any gcloud call', toolLog(sandbox, 'gcloud'), []);
  });
}

function configRefuses(env: NodeJS.ProcessEnv, variable: string): boolean {
  try {
    loadServerConfig(env);
    return false;
  } catch (error) {
    if (error instanceof ServerConfigError && error.variable === variable) return true;
    throw error;
  }
}

function missingKeyCase(name: string, rules: readonly StubRule[], needle: string): void {
  withSandbox((sandbox) => {
    writeOperatorFile(sandbox);
    writeRules(sandbox, 'gcloud', rules);
    const run = runScript(sandbox, 'deploy.sh', []);
    const calls = toolLog(sandbox, 'gcloud');
    check(`deploy.sh stops when the OpenRouter secret ${name}, naming the secret`, run.status === 1 && run.stderr.includes('whim-openrouter-api-key') && run.stderr.includes(needle), run.stderr);
    check('  ... before Cloud Build, any upload, any VM command or the site build', ['builds submit', 'compute scp', 'compute ssh'].every((call) => indexOfCall(calls, call) === -1) && toolLog(sandbox, 'node').every((line) => !line.includes('site.mjs')), calls.join(' / '));
  });
}

function deploySecretTests(): void {
  section('Deploy scripts: deploy.sh missing-key preflight');
  missingKeyCase('does not exist', [['*secrets describe*', 1, '']], 'does not exist');
  missingKeyCase('has no enabled version', [['*secrets describe*', 0, 'x\\n'], ['*secrets versions list*', 0, '']], 'no enabled version');
  missingKeyCase('is empty', [['*secrets describe*', 0, 'x\\n'], ['*secrets versions list*', 0, '7\\n'], ['*secrets versions access*', 0, '']], 'is empty');

  withSandbox((sandbox) => {
    writeOperatorFile(sandbox);
    writeRules(sandbox, 'gcloud', SECRET_READABLE);
    fs.writeFileSync(path.join(sandbox.stubs, 'machine-type'), 'e2-highcpu-4');
    const run = runScript(sandbox, 'deploy.sh', []);
    const calls = toolLog(sandbox, 'gcloud');
    check('deploy.sh refuses a VM machine type no profile names, naming e2-highcpu-4', run.status === 1 && run.stderr.includes('machine type e2-highcpu-4'), run.stderr);
    check('  ... before Cloud Build or any VM change', ['builds submit', 'compute scp', 'compute ssh'].every((call) => indexOfCall(calls, call) === -1), calls.join(' / '));
    check('  ... and never prints the key or passes it as an argument', ![run.stdout, run.stderr, ...calls].some((text) => text.includes(FAKE_KEY)));
  });
}

function deploySiteOnlyTests(): void {
  section('Deploy scripts: deploy.sh --site-only');
  withSandbox((sandbox) => {
    writeOperatorFile(sandbox);
    writeRules(sandbox, 'gcloud', [['*secrets*', 1, 'a site-only publish must not read the secret\\n'], ...VM_ANSWERS]);
    writeRules(sandbox, 'dig', DNS_READY);
    writeRules(sandbox, 'curl', PAGES_UP);
    const run = runScript(sandbox, 'deploy.sh', ['--site-only']);
    const calls = toolLog(sandbox, 'gcloud');
    const ssh = calls.filter((line) => line.includes('compute ssh'));
    eq('a site-only publish before the key exists succeeds', run.status, 0);
    check('  ... reading no secret, building and resolving no image, reading no machine type', ['secrets', 'builds', 'artifacts', 'instances describe'].every((call) => indexOfCall(calls, call) === -1), calls.join(' / '));
    check('  ... never touching the server container or its env files', ssh.length > 0 && ssh.every((line) => !/whim-server|server\.env|config\.env|--wait/.test(line)), ssh.join(' / '));
    check('  ... and starting or reloading only Caddy', ssh.some((line) => line.includes('up -d --no-deps caddy') && line.includes('caddy reload')), ssh.join(' / '));
    check('  ... publishing the rendered site and the Caddyfile only', fs.existsSync(path.join(sandbox.stubs, 'upload', 'site', 'privacy.html')) && fs.existsSync(path.join(sandbox.stubs, 'upload', 'Caddyfile')) && !fs.existsSync(path.join(sandbox.stubs, 'upload', 'config.env')));
    check('  ... as a release swapped in with mv -T', ssh.some((line) => line.includes('mv -T')));
    eq('  ... building the /beta form to post to the API host\'s signup route', stubFile(sandbox, 'site-signup-url'), `https://${API_HOST}/beta/signup\n`);
    const curls = toolLog(sandbox, 'curl');
    check('  ... then running the pages smoke checks only', curls.some((line) => line.includes(`${WEB_HOST}/privacy`)) && curls.every((line) => !line.includes(API_HOST)), curls.join(' / '));
  });
}

/** What the real server's `/healthz` answers, taken from the producer rather than written beside
 *  smoke.sh: an image built at HEALTH_COMMIT under the default configuration, and with the Android
 *  minimum at 382000. `preGate` is the default body without `minBuild`: what a server from before
 *  the minimum-build gate answers. `unbuilt` is a server outside the release image (no WHIM_COMMIT). */
interface HealthBodies {
  readonly defaults: string;
  readonly androidRaised: string;
  readonly preGate: string;
  readonly unbuilt: string;
}

function withoutMinBuild(body: string): string {
  const health = JSON.parse(body) as Record<string, unknown>;
  delete health.minBuild;
  return JSON.stringify(health);
}

/** The same body from an image built at another commit (or reporting another value). */
function withCommit(body: string, commit: unknown): string {
  return JSON.stringify({ ...(JSON.parse(body) as Record<string, unknown>), commit });
}

function withoutCommit(body: string): string {
  const health = JSON.parse(body) as Record<string, unknown>;
  delete health.commit;
  return JSON.stringify(health);
}

async function realHealthBody(env: NodeJS.ProcessEnv): Promise<string> {
  const app = createApp({ pipeline: createStubPipeline(0), usageStore: new InMemoryUsageStore(), config: loadServerConfig(env) });
  const body = await within(Promise.resolve(app.request('/healthz')).then((res) => res.text()));
  if (body === TIMED_OUT) throw new Error('setup: /healthz did not answer in time');
  return body;
}

function healthRule(body: string): StubRule {
  return [`*https://${API_HOST}/healthz`, 0, '200|application/json|', body];
}

function fullDeployRules(sandbox: Sandbox, imageExists: boolean): void {
  writeRules(sandbox, 'gcloud', [...SECRET_READABLE, ['*artifacts docker images describe*', imageExists ? 0 : 1, ''], ...VM_ANSWERS]);
  writeRules(sandbox, 'dig', DNS_READY);
  writeRules(sandbox, 'curl', [...API_UP, ...PAGES_UP]);
}

function headOf(sandbox: Sandbox): string {
  return runFromPath('git', ['rev-parse', 'HEAD'], { cwd: sandbox.repo, encoding: 'utf8' }).stdout.trim();
}

function deployFullTests(health: HealthBodies): void {
  section('Deploy scripts: deploy.sh full deploy and rollback');
  withSandbox((sandbox) => {
    writeOperatorFile(sandbox, { WHIM_MIN_BUILD_ANDROID: '382000', WHIM_USAGE_IDLE_DAYS: '180', WHIM_BETA_LIMIT_PER_CLIENT_HOUR: '200', WHIM_BETA_LIMIT_PER_DAY: '5000' });
    fullDeployRules(sandbox, true);
    writeRules(sandbox, 'curl', [healthRule(withCommit(health.androidRaised, headOf(sandbox))), ...API_UP, ...PAGES_UP]);
    const run = runScript(sandbox, 'deploy.sh', []);
    const config = stubFile(sandbox, 'upload/config.env');
    eq('a full deploy with a raised Android minimum succeeds, its smoke confirming the value on /healthz', run.status, 0);
    check('  ... carrying WHIM_MIN_BUILD_ANDROID to config.env and leaving the unset iOS minimum out', config.includes('WHIM_MIN_BUILD_ANDROID=382000\n') && !config.includes('WHIM_MIN_BUILD_IOS'), config);
    check('  ... and carrying the operator\'s WHIM_USAGE_IDLE_DAYS, which passed the keep-period preflight', config.includes('WHIM_USAGE_IDLE_DAYS=180\n'), config);
    check('  ... and the operator\'s beta signup limits', config.includes('WHIM_BETA_LIMIT_PER_CLIENT_HOUR=200\n') && config.includes('WHIM_BETA_LIMIT_PER_DAY=5000\n'), config);
    const served = loadServerConfig(Object.fromEntries(envEntries(config)));
    eq('  ... which the server reads as its limits', [served.betaLimitPerClientHour, served.betaLimitPerDay], [200, 5000]);
  });

  withSandbox((sandbox) => {
    writeOperatorFile(sandbox, {
      WHIM_PLAN_REASONING: 'low',
      WHIM_REPAIR_MODEL: 'vendor/repair-1',
      WHIM_REPAIR_REASONING: 'off',
    });
    fullDeployRules(sandbox, false);
    writeRules(sandbox, 'curl', [healthRule(withCommit(health.defaults, headOf(sandbox))), ...API_UP, ...PAGES_UP]);
    fs.writeFileSync(path.join(sandbox.stubs, 'machine-type'), 'e2-standard-8');
    const run = runScript(sandbox, 'deploy.sh', []);
    const calls = toolLog(sandbox, 'gcloud');
    const head = headOf(sandbox);
    eq('a full deploy on an e2-standard-8 VM succeeds', run.status, 0);
    check('  ... reading the key before Cloud Build builds HEAD', indexOfCall(calls, 'secrets versions access') !== -1 && indexOfCall(calls, 'secrets versions access') < indexOfCall(calls, `builds submit`) && calls.some((line) => line.includes(`COMMIT_SHA=${head}`)), calls.join(' / '));
    eq('  ... writing the event profile\'s server limits, the model ids and the pages origin to config.env', stubFile(sandbox, 'upload/config.env').split('\n').filter((line) => line !== ''), [
      'WHIM_MAX_CONCURRENT_GENERATIONS=15',
      'WHIM_SYNTHRUN_CONCURRENCY=6',
      'WHIM_MAX_CONCURRENT_UNARY=32',
      'WHIM_ENGINEER_MODEL=vendor/engineer-1',
      'WHIM_REWRITE_MODEL=vendor/rewrite-1',
      `WHIM_WEB_ORIGIN=https://${WEB_HOST}`,
      'WHIM_REPAIR_MODEL=vendor/repair-1',
      'WHIM_PLAN_REASONING=low',
      'WHIM_REPAIR_REASONING=off',
    ]);
    check('  ... omitting an unset role override from config.env', !stubFile(sandbox, 'upload/config.env').includes('WHIM_SUMMARY_MODEL='));
    check('  ... and unset beta signup limits, so the server keeps its defaults', !stubFile(sandbox, 'upload/config.env').includes('WHIM_BETA_LIMIT_'));
    const eventProfile = Object.fromEntries(envEntries(fs.readFileSync(path.join(ROOT, 'deploy', 'profiles', 'event.env'), 'utf8')));
    eq('  ... and the image, hosts and event container sizes to the compose .env', stubFile(sandbox, 'upload/compose.env').split('\n').filter((line) => line !== ''), [
      `WHIM_IMAGE=northamerica-northeast1-docker.pkg.dev/anycognition-whim/whim/server:${head}`,
      `WHIM_API_HOST=${API_HOST}`,
      `WHIM_WEB_HOST=${WEB_HOST}`,
      'WHIM_PROFILE=event',
      `WHIM_SERVER_MEM_LIMIT=${eventProfile.WHIM_SERVER_MEM_LIMIT}`,
      `WHIM_SERVER_SHM_SIZE=${eventProfile.WHIM_SERVER_SHM_SIZE}`,
    ]);
    eq('  ... piping the key to /etc/whim/server.env over stdin', stubFile(sandbox, 'server-env-stdin'), `OPENROUTER_API_KEY=${FAKE_KEY}\n`);
    check('  ... never printing it, passing it as an argument or uploading it', ![run.stdout, run.stderr, ...calls, stubFile(sandbox, 'upload/config.env'), stubFile(sandbox, 'upload/compose.env')].some((text) => text.includes(FAKE_KEY)));
    check('  ... restarting through compose and running the full smoke', calls.some((line) => line.includes('up -d --wait')) && toolLog(sandbox, 'curl').some((line) => line.includes(`${API_HOST}/healthz/sse`)));
  });

  withSandbox((sandbox) => {
    writeOperatorFile(sandbox);
    fullDeployRules(sandbox, true);
    writeRules(sandbox, 'curl', [healthRule(withCommit(health.defaults, TAG)), ...API_UP, ...PAGES_UP]);
    const run = runScript(sandbox, 'deploy.sh', ['--tag', TAG]);
    const calls = toolLog(sandbox, 'gcloud');
    const ssh = calls.filter((line) => line.includes('compute ssh'));
    eq('a rollback to a pushed tag succeeds, its smoke finding that tag\'s commit on /healthz', run.status, 0);
    check('  ... without building', indexOfCall(calls, 'builds submit') === -1, calls.join(' / '));
    check('  ... deploying that tag with the standard profile', stubFile(sandbox, 'upload/compose.env').includes(`server:${TAG}\n`) && stubFile(sandbox, 'upload/compose.env').includes('WHIM_PROFILE=standard') && stubFile(sandbox, 'upload/config.env') === `WHIM_ENGINEER_MODEL=vendor/engineer-1\nWHIM_REWRITE_MODEL=vendor/rewrite-1\nWHIM_WEB_ORIGIN=https://${WEB_HOST}\n`);
    check(
      '  ... and never building or publishing the site: no local site build, no site publish call over ssh',
      !fs.existsSync(path.join(sandbox.stubs, 'upload', 'site')) && ssh.every((line) => !/mv -T|releases\//.test(line)),
      ssh.join(' / '),
    );
  });

  // Rolling back below the minimum-build gate: the old server answers /healthz without minBuild.
  withSandbox((sandbox) => {
    writeOperatorFile(sandbox);
    fullDeployRules(sandbox, true);
    writeRules(sandbox, 'curl', [healthRule(withCommit(health.preGate, TAG)), ...API_UP, ...PAGES_UP]);
    const run = runScript(sandbox, 'deploy.sh', ['--tag', TAG]);
    eq('a rollback to a server without the minimum-build gate, both minimums 0, succeeds', run.status, 0);
    check(
      '  ... printing done after smoke warns that the server predates the gate',
      run.stdout.includes('deploy.sh: done') && run.stderr.includes('WARN') && run.stderr.includes('predates the minimum-build gate'),
      `${run.stdout}\n${run.stderr}`,
    );
  });

  withSandbox((sandbox) => {
    writeOperatorFile(sandbox, { WHIM_MIN_BUILD_IOS: '381000' });
    fullDeployRules(sandbox, true);
    writeRules(sandbox, 'curl', [healthRule(withCommit(health.preGate, TAG)), ...API_UP, ...PAGES_UP]);
    const run = runScript(sandbox, 'deploy.sh', ['--tag', TAG]);
    check(
      'a rollback below the minimum-build gate while the iOS minimum is raised fails its smoke, naming the dropped gate',
      run.status === 1 && run.stderr.includes('cannot enforce the configured minimums (iOS 381000, Android 0)'),
      run.stderr,
    );
    check('  ... and never prints done', !run.stdout.includes('deploy.sh: done'), run.stdout);
  });

  // specs/server-observability "A deploy that didn't take is caught": the container still serves
  // the previous image, whose /healthz names the previous commit.
  withSandbox((sandbox) => {
    writeOperatorFile(sandbox);
    fullDeployRules(sandbox, true);
    writeRules(sandbox, 'curl', [healthRule(health.defaults), ...API_UP, ...PAGES_UP]);
    const run = runScript(sandbox, 'deploy.sh', []);
    const head = headOf(sandbox);
    check(
      'a deploy whose server still reports the previous commit fails its smoke, naming both SHAs',
      run.status === 1 && run.stderr.includes(`commit is ${HEALTH_COMMIT}, but this deploy rolled out ${head}`),
      run.stderr,
    );
    check('  ... and never prints done', !run.stdout.includes('deploy.sh: done'), run.stdout);
  });

  withSandbox((sandbox) => {
    writeOperatorFile(sandbox);
    fullDeployRules(sandbox, true);
    writeRules(sandbox, 'curl', [healthRule(health.defaults), ...API_UP, ...PAGES_UP]);
    const run = runScript(sandbox, 'deploy.sh', ['--tag', TAG]);
    check('a rollback whose server still reports another commit fails its smoke, naming the tag', run.status === 1 && run.stderr.includes(`but this deploy rolled out ${TAG}`), run.stderr);
  });
}

function smokeTests(health: HealthBodies): void {
  section('Deploy scripts: smoke.sh');
  withSandbox((sandbox) => {
    const run = runScript(sandbox, 'smoke.sh', []);
    check('smoke with no DNS records names both hostnames', run.status === 1 && run.stderr.includes(`${API_HOST}: no A record`) && run.stderr.includes(`${WEB_HOST}: no A record`), run.stderr);
    check('  ... says DNS is not ready and makes no HTTPS request or VM call', run.stderr.includes('DNS is not ready') && toolLog(sandbox, 'curl').length === 0 && toolLog(sandbox, 'gcloud').length === 0, run.stderr);
  });

  withSandbox((sandbox) => {
    writeRules(sandbox, 'dig', [[`+short A ${API_HOST}`, 0, `${STATIC_IP}\\n`], [`+short AAAA ${API_HOST}`, 0, '2001:db8::1\\n'], [`+short A ${WEB_HOST}`, 0, '198.51.100.9\\n']]);
    const run = runScript(sandbox, 'smoke.sh', ['--pages-only']);
    check('smoke names a wrong A record and a stray AAAA record', run.status === 1 && run.stderr.includes(`${WEB_HOST}: A records 198.51.100.9 (expected only ${STATIC_IP})`) && run.stderr.includes(`${API_HOST}: AAAA records 2001:db8::1`), run.stderr);
    eq('  ... before any HTTPS request', toolLog(sandbox, 'curl'), []);
  });

  withSandbox((sandbox) => {
    writeRules(sandbox, 'gcloud', VM_ANSWERS);
    writeRules(sandbox, 'dig', DNS_READY);
    writeRules(sandbox, 'curl', [[`*https://${API_HOST}/healthz`, 0, '200|application/json|', '{"ok":true,"service":"whim-server-loadtest"}'], ...API_UP, ...PAGES_UP]);
    const run = runScript(sandbox, 'smoke.sh', []);
    check('smoke fails on a load-test server identity', run.status === 1 && run.stderr.includes('whim-server-loadtest'), run.stderr);
  });

  eq("the smoke fixtures' /healthz body is the real server's default body", DEFAULT_HEALTH, health.defaults);
  const smokeAgainst = (operatorValues: Readonly<Record<string, string>>, body: string, args: readonly string[] = []): ScriptRun => {
    let run: ScriptRun = { status: null, stdout: '', stderr: '' };
    withSandbox((sandbox) => {
      writeOperatorFile(sandbox, operatorValues);
      writeRules(sandbox, 'gcloud', VM_ANSWERS);
      writeRules(sandbox, 'dig', DNS_READY);
      writeRules(sandbox, 'curl', [healthRule(body), ...API_UP, ...PAGES_UP]);
      run = runScript(sandbox, 'smoke.sh', args);
    });
    return run;
  };
  const defaultRun = smokeAgainst({}, health.defaults);
  eq("smoke passes against the real server's /healthz under the default configuration, run standalone", defaultRun.status, 0);

  // specs/server-observability "The server reports which commit it is running".
  const unbuiltRun = smokeAgainst({}, health.unbuilt);
  check(
    'smoke fails against a server outside the release image, whose /healthz reports commit "unknown"',
    unbuiltRun.status === 1 && unbuiltRun.stderr.includes('commit "unknown" is not a full 40-character SHA'),
    unbuiltRun.stderr,
  );
  const shortRun = smokeAgainst({}, withCommit(health.defaults, HEALTH_COMMIT.slice(0, 12)));
  check('smoke fails when /healthz reports an abbreviated commit', shortRun.status === 1 && shortRun.stderr.includes(`commit "${HEALTH_COMMIT.slice(0, 12)}" is not a full 40-character SHA`), shortRun.stderr);
  const noCommitRun = smokeAgainst({}, withoutCommit(health.defaults));
  check('smoke fails when /healthz reports no commit at all', noCommitRun.status === 1 && noCommitRun.stderr.includes('no commit: this server predates the commit report'), noCommitRun.stderr);
  const matchedRun = smokeAgainst({}, health.defaults, ['--commit', HEALTH_COMMIT]);
  eq('smoke --commit passes when /healthz reports exactly that commit', matchedRun.status, 0);
  const mismatchedRun = smokeAgainst({}, health.defaults, ['--commit', TAG]);
  check(
    'smoke --commit fails when /healthz reports another commit, naming both SHAs',
    mismatchedRun.status === 1 && mismatchedRun.stderr.includes(`commit is ${HEALTH_COMMIT}, but this deploy rolled out ${TAG}`),
    mismatchedRun.stderr,
  );
  for (const [what, args] of [
    ['an abbreviated sha', ['--commit', TAG.slice(0, 7)]],
    ['--pages-only', ['--pages-only', '--commit', TAG]],
  ] as const) {
    withSandbox((sandbox) => {
      const run = runScript(sandbox, 'smoke.sh', args);
      check(`smoke refuses --commit with ${what} as a usage error, before any DNS lookup`, run.status === 2 && toolLog(sandbox, 'dig').length === 0, run.stderr);
    });
  }
  const raisedRun = smokeAgainst({ WHIM_MIN_BUILD_ANDROID: '382000' }, health.androidRaised);
  eq('smoke passes when /healthz reports the Android minimum the operator values set', raisedRun.status, 0);
  const staleRun = smokeAgainst({ WHIM_MIN_BUILD_ANDROID: '382000' }, health.defaults);
  check('smoke fails when /healthz still reports the old minimum, showing the live body', staleRun.status === 1 && staleRun.stderr.includes(health.defaults), staleRun.stderr);

  // A rollback to an image from before the minimum-build gate: its /healthz carries no minBuild.
  const preGateRun = smokeAgainst({}, health.preGate);
  eq('smoke passes against a server from before the minimum-build gate when both minimums are 0', preGateRun.status, 0);
  eq(
    '  ... with one WARN line saying the server predates the gate',
    preGateRun.stderr.split('\n').filter((line) => line.startsWith('WARN')).map((line) => line.includes('predates the minimum-build gate')),
    [true],
  );
  for (const variable of ['WHIM_MIN_BUILD_IOS', 'WHIM_MIN_BUILD_ANDROID']) {
    const droppedRun = smokeAgainst({ [variable]: '382000' }, health.preGate);
    check(
      `smoke fails against a server from before the minimum-build gate while ${variable} is raised, naming the dropped gate`,
      droppedRun.status === 1 && droppedRun.stderr.includes('cannot enforce the configured minimums') && droppedRun.stderr.includes('1 smoke check(s) failed'),
      droppedRun.stderr,
    );
  }
}

/** Runs smoke.sh against DNS_READY, the VM answers and `curlRules`; returns the run and its curl calls. */
function smokeWith(curlRules: readonly StubRule[], args: readonly string[] = []): { readonly run: ScriptRun; readonly curls: string[] } {
  let result: { run: ScriptRun; curls: string[] } = { run: { status: null, stdout: '', stderr: '' }, curls: [] };
  withSandbox((sandbox) => {
    writeOperatorFile(sandbox);
    writeRules(sandbox, 'gcloud', VM_ANSWERS);
    writeRules(sandbox, 'dig', DNS_READY);
    writeRules(sandbox, 'curl', curlRules);
    result = { run: runScript(sandbox, 'smoke.sh', args), curls: toolLog(sandbox, 'curl') };
  });
  return result;
}

/** POSTs `form` to a real app's /beta/signup; the answer and how many rows the store then holds. */
async function realSignupAnswer(form: string): Promise<readonly [number, string | null, number] | 'timed out'> {
  const store = new InMemoryWaitlistStore();
  const app = createApp({ pipeline: createStubPipeline(0), usageStore: new InMemoryUsageStore(), waitlistStore: store, config: loadServerConfig({ WHIM_WEB_ORIGIN: `https://${WEB_HOST}` }) });
  const capture = captureLogs();
  let res: Response | typeof TIMED_OUT;
  try {
    res = await within(Promise.resolve(app.request('/beta/signup', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-forwarded-for': '203.0.113.1' },
      body: form,
    })));
  } finally {
    capture.stop();
  }
  return res === TIMED_OUT ? 'timed out' : [res.status, res.headers.get('location'), store.export().length];
}

async function smokeBetaTests(): Promise<void> {
  section('Deploy scripts: smoke.sh checks the beta waitlist');
  const thanks = `https://${WEB_HOST}/beta/thanks`;
  const full = smokeWith([...API_UP, ...PAGES_UP]);
  eq('smoke passes when /beta, its result pages and the signup trap answer as Caddy and the server do', full.run.status, 0);
  check('  ... requesting /beta, /beta/thanks and /beta/retry on the pages host', ['/beta', '/beta/thanks', '/beta/retry'].every((page) => full.curls.some((line) => line.endsWith(`https://${WEB_HOST}${page}`))), full.curls.join(' / '));
  const signupCall = full.curls.find((line) => line.endsWith(`https://${API_HOST}/beta/signup`)) ?? '';
  const form = /--data (\S+)/.exec(signupCall)?.[1] ?? '';
  check('  ... and posting a form to the API host\'s /beta/signup', form !== '', full.curls.join(' / '));
  // The smoke's own post, replayed against the real route: it must trip the trap, or smoke would
  // write a row into the production waitlist.
  eq('  ... which the real route answers 303 to /beta/thanks, storing nothing', await realSignupAnswer(form), [303, thanks, 0]);
  const person = new URLSearchParams(form);
  person.delete(TRAP_FIELD);
  eq('  ... carrying a valid email and platform (without the trap field, the real route stores it)', await realSignupAnswer(person.toString()), [303, thanks, 1]);

  const noFontCsp = smokeWith([[`*https://${WEB_HOST}/beta`, 0, `200|${HTML}||${PAGES_CSP.replace("; font-src 'self'", '')}`, '<html>'], ...API_UP, ...PAGES_UP]);
  check('smoke fails when /beta\'s CSP lacks font-src \'self\', naming /beta', noFontCsp.run.status === 1 && noFontCsp.run.stderr.includes(`https://${WEB_HOST}/beta answered 200`) && noFontCsp.run.stderr.includes('1 smoke check(s) failed'), noFontCsp.run.stderr);
  const noThanks = smokeWith([[`*https://${WEB_HOST}/beta/thanks`, 0, `404|${HTML}|`, '<html>'], ...API_UP, ...PAGES_UP]);
  check('smoke fails when /beta/thanks is not served', noThanks.run.status === 1 && noThanks.run.stderr.includes(`${WEB_HOST}/beta/thanks answered 404`), noThanks.run.stderr);
  const trapToRetry = smokeWith([[`*https://${API_HOST}/beta/signup`, 0, `303|text/plain|https://${WEB_HOST}/beta/retry`, ''], ...API_UP, ...PAGES_UP]);
  check('smoke fails when the trap post is redirected anywhere but /beta/thanks, naming both', trapToRetry.run.status === 1 && trapToRetry.run.stderr.includes('redirecting to https://' + WEB_HOST + '/beta/retry, expected 303 to ' + thanks), trapToRetry.run.stderr);
  const missingRoute = smokeWith([[`*https://${API_HOST}/beta/signup`, 0, '404|text/plain|', ''], ...API_UP, ...PAGES_UP]);
  check('smoke fails against a server without the signup route', missingRoute.run.status === 1 && missingRoute.run.stderr.includes(`https://${API_HOST}/beta/signup with the trap field filled answered 404`), missingRoute.run.stderr);

  const pagesOnly = smokeWith(PAGES_UP, ['--pages-only']);
  eq('smoke --pages-only passes, checking the beta pages', [pagesOnly.run.status, ['/beta', '/beta/thanks', '/beta/retry'].every((page) => pagesOnly.curls.some((line) => line.endsWith(`https://${WEB_HOST}${page}`)))], [0, true]);
  check('  ... and makes no request to the API host', pagesOnly.curls.every((line) => !line.includes(API_HOST)), pagesOnly.curls.join(' / '));
}

function resizeRules(sandbox: Sandbox, quota: string, extra: readonly StubRule[] = []): void {
  fs.writeFileSync(path.join(sandbox.repo, 'deploy', 'deploy.sh'), DEPLOY_STUB_SCRIPT, { mode: 0o755 });
  writeRules(sandbox, 'gcloud', [
    ...extra,
    ['*compute ssh*cat /opt/whim/.env*', 0, `WHIM_IMAGE=northamerica-northeast1-docker.pkg.dev/anycognition-whim/whim/server:${TAG}\\nWHIM_PROFILE=standard\\n`],
    ['*compute regions describe*', 0, `CPUS,24.0,2.0\\nE2_CPUS,${quota}\\n`],
  ]);
}

function resizeTests(): void {
  section('Deploy scripts: resize.sh');
  withSandbox((sandbox) => {
    const run = runScript(sandbox, 'resize.sh', ['--profile', 'huge']);
    check('resize.sh refuses an unknown profile, naming it, with no gcloud call', run.status === 1 && run.stderr.includes('no profile named huge') && toolLog(sandbox, 'gcloud').length === 0, run.stderr);
  });

  withSandbox((sandbox) => {
    resizeRules(sandbox, '8.0,4.0');
    const run = runScript(sandbox, 'resize.sh', ['--profile', 'event']);
    const calls = toolLog(sandbox, 'gcloud');
    check('resize.sh stops when the region E2 vCPU quota does not fit the event type', run.status === 1 && run.stderr.includes('E2 vCPU quota'), run.stderr);
    check('  ... before draining or stopping anything', !calls.some((line) => line.includes('stop whim-server') || line.includes('instances stop')) && toolLog(sandbox, 'deploy').length === 0, calls.join(' / '));
  });

  withSandbox((sandbox) => {
    resizeRules(sandbox, '24.0,2.0');
    const run = runScript(sandbox, 'resize.sh', ['--profile', 'event']);
    const calls = toolLog(sandbox, 'gcloud');
    const order = ['compute regions describe', 'stop whim-server', 'instances stop', 'set-machine-type', 'instances start'].map((needle) => indexOfCall(calls, needle));
    check('resize.sh --profile event succeeds', run.status === 0, `${run.stdout}\n${run.stderr}\n${calls.join(' / ')}`);
    check('  ... quota, drain, stop, set-machine-type, start, in that order', order.every((at, i) => at !== -1 && (i === 0 || at > order[i - 1]!)), calls.join(' / '));
    eq('  ... leaving the VM on e2-standard-8', stubFile(sandbox, 'machine-type'), 'e2-standard-8');
    eq('  ... then redeploying the running tag', toolLog(sandbox, 'deploy'), [`--tag ${TAG}`]);
  });

  withSandbox((sandbox) => {
    resizeRules(sandbox, '24.0,2.0');
    const run = runScript(sandbox, 'resize.sh', ['--profile', 'event'], { STUB_READINESS_FAILS: '1' });
    const calls = toolLog(sandbox, 'gcloud');
    eq('a transient IAP 4003 readiness failure is retried and then succeeds', run.status, 0);
    check('  ... the transient fixture emits the IAP 4003 diagnostic', calls.some((line) => line.includes('IAP 4003')), calls.join(' / '));
    eq('  ... only the idempotent readiness probe repeats', calls.filter((line) => line.includes('--command :')).length, 2);
    eq('  ... deployment runs exactly once after readiness', toolLog(sandbox, 'deploy'), [`--tag ${TAG}`]);
  });

  withSandbox((sandbox) => {
    resizeRules(sandbox, '24.0,2.0', [['*compute instances set-machine-type*', 1, '']]);
    const run = runScript(sandbox, 'resize.sh', ['--profile', 'event'], { STUB_READINESS_FAILS: '1' });
    const calls = toolLog(sandbox, 'gcloud');
    check('a failed set-machine-type exits non-zero naming the step', run.status === 1 && run.stderr.includes('step set-machine-type failed'), run.stderr);
    check('  ... after starting the VM again on its previous type', indexOfCall(calls, 'instances start') > indexOfCall(calls, 'set-machine-type') && stubFile(sandbox, 'machine-type') === 'e2-standard-2', calls.join(' / '));
    eq('  ... and redeploying the running tag, whose profile follows that type', toolLog(sandbox, 'deploy'), [`--tag ${TAG}`]);
    eq('  ... recovery waits for an additional readiness probe before redeploy', calls.filter((line) => line.includes('--command :')).length, 2);
  });

  withSandbox((sandbox) => {
    const result = runFromPath('bash', ['-c', 'source deploy/lib.sh; whim_wait_for_ssh persistent 1 1'], {
      cwd: sandbox.repo,
      encoding: 'utf8',
      timeout: 10_000,
      env: {
        PATH: `${sandbox.bin}${path.delimiter}${process.env.PATH ?? ''}`,
        STUB_DIR: sandbox.stubs,
        STUB_REAL_NODE: process.execPath,
        STUB_READINESS_FAILS: '999',
        WHIM_SCRIPT: 'resize.sh',
        WHIM_GCP_PROJECT: 'project', WHIM_GCP_ZONE: 'zone', WHIM_VM_NAME: 'vm',
      },
    });
    check('persistent readiness failure is bounded and names the failed step', result.status === 1 && result.stderr.includes('step persistent readiness failed'), `${result.stdout}\n${result.stderr}`);
  });

  withSandbox((sandbox) => {
    const started = Date.now();
    const result = runFromPath('bash', ['-c', 'source deploy/lib.sh; whim_wait_for_ssh hanging 2 1'], {
      cwd: sandbox.repo,
      encoding: 'utf8',
      timeout: 8_000,
      env: {
        PATH: `${sandbox.bin}${path.delimiter}${process.env.PATH ?? ''}`,
        STUB_DIR: sandbox.stubs, STUB_REAL_NODE: process.execPath, STUB_READINESS_HANG: '1',
        WHIM_SCRIPT: 'resize.sh', WHIM_GCP_PROJECT: 'project', WHIM_GCP_ZONE: 'zone', WHIM_VM_NAME: 'vm',
      },
    });
    const elapsed = Date.now() - started;
    check('a hanging IAP child is killed by the per-probe timeout and overall budget', result.status === 1 && elapsed < 4_500 && result.stderr.includes('step hanging readiness failed'), `${result.stdout}\n${result.stderr}\nelapsed=${elapsed}ms`);
  });

  withSandbox((sandbox) => {
    const started = Date.now();
    const result = runFromPath('bash', ['-c', 'source deploy/lib.sh; whim_wait_for_ssh bounded 2 1'], {
      cwd: sandbox.repo,
      encoding: 'utf8',
      timeout: 8_000,
      env: {
        PATH: `${sandbox.bin}${path.delimiter}${process.env.PATH ?? ''}`,
        STUB_DIR: sandbox.stubs, STUB_REAL_NODE: process.execPath, STUB_READINESS_FAILS: '999',
        WHIM_SCRIPT: 'resize.sh', WHIM_GCP_PROJECT: 'project', WHIM_GCP_ZONE: 'zone', WHIM_VM_NAME: 'vm',
      },
    });
    const elapsed = Date.now() - started;
    const boundedCalls = toolLog(sandbox, 'gcloud');
    check('immediate IAP failures exhaust the bounded helper before 4.5 seconds', result.status === 1
      && elapsed < 4_500
      && result.stderr.includes('step bounded readiness failed')
      && boundedCalls.some((line) => line.includes('IAP 4003')), `${result.stdout}\n${result.stderr}\n${boundedCalls.join('\n')}\nelapsed=${elapsed}ms`);
  });
}

function loadtestVmStubs(sandbox: Sandbox): void {
  fs.writeFileSync(path.join(sandbox.bin, 'sudo'), `#!/usr/bin/env bash
depth="\${STUB_SUDO_DEPTH:-0}"
export STUB_SUDO_DEPTH=$((depth + 1))
if [ "$depth" -gt 0 ]; then unset WHIM_LOADTEST_IMAGE; fi
while [ "\${1:-}" = -H ]; do shift; done
if [ "\${1:-}" = env ]; then shift; while [[ "\${1:-}" == *=* ]]; do export "$1"; shift; done; fi
case "\${1:-}" in
  install|rm)
    if [ "\${STUB_FAIL_FILE_OP:-}" = "\${1:-}" ] && { [ "\${1:-}" = rm ] || grep -q '^production-stop$' "$STUB_DIR/events.log" 2>/dev/null; }; then exit "\${STUB_FILE_OP_RC:-7}"; fi
    exit 0;;
esac
exec "$@"
`, { mode: 0o755 });
  fs.writeFileSync(path.join(sandbox.bin, 'docker'), `#!/usr/bin/env bash
printf '%s|%s\n' "$*" "\${WHIM_LOADTEST_IMAGE:-}" >>"$STUB_DIR/docker.log"
case "$*" in
  *'stop whim-server'*)
    if [ -f "$STUB_DIR/events.log" ] && grep -q '^replay-start$' "$STUB_DIR/events.log"; then printf 'replay-stop\n' >>"$STUB_DIR/events.log"; exit "\${STUB_REPLAY_STOP_RC:-0}";
    else printf 'production-stop\n' >>"$STUB_DIR/events.log"; exit 0; fi;;
  *'compose.loadtest.yaml'*'up '* ) [ -n "\${WHIM_LOADTEST_IMAGE:-}" ] || { echo 'missing WHIM_LOADTEST_IMAGE' >&2; exit 1; }; printf 'replay-start\n' >>"$STUB_DIR/events.log"; exit "\${STUB_REPLAY_START_RC:-0}";;
  *'up '* ) printf 'production-restore\n' >>"$STUB_DIR/events.log"; exit "\${STUB_RESTORE_RC:-0}";;
  *'exec '* )
    case "$*" in *169.254.169.254*) echo blocked; exit 0;; *react-native*) echo absent; exit 0;; esac
    exit "\${STUB_HEALTH_RC:-0}";;
esac
exit 0
`, { mode: 0o755 });
  fs.writeFileSync(path.join(sandbox.bin, 'gcloud'), `#!/usr/bin/env bash
printf '%s\n' "$*" >>"$STUB_DIR/gcloud.log"
case "$*" in
  *'artifacts docker images describe'*) exit 0;;
  *'compute scp'*) exit 0;;
  *'compute ssh'*)
    command=""; previous=""
    for arg in "$@"; do [ "$previous" = --command ] && command="$arg"; previous="$arg"; done
    case "$command" in *"grep '^WHIM_IMAGE="*) printf 'WHIM_IMAGE=northamerica-northeast1-docker.pkg.dev/anycognition-whim/whim/server:%s\n' "$(git rev-parse HEAD)"; exit 0;; esac
    bash -n -c "$command" || { printf '%s\n' "$command" >&2; exit 2; }
    bash -c "$command"
    exit "$?"
    ;;
esac
exit 0
`, { mode: 0o755 });
}

function loadtestStartTests(): void {
  section('Deploy scripts: load-test start and recovery');
  withSandbox((sandbox) => {
    writeOperatorFile(sandbox);
    loadtestVmStubs(sandbox);
    const run = runScript(sandbox, 'loadtest/run.sh', ['start']);
    check('the replay image survives one effective sudo transition', run.status === 0 && toolLog(sandbox, 'docker').some((line) => line.includes('server-loadtest:')), `${run.stdout}\n${run.stderr}\n${toolLog(sandbox, 'docker').join(' / ')}`);
  });

  const smokeReady = (sandbox: Sandbox): void => {
    writeRules(sandbox, 'gcloud', VM_ANSWERS);
    writeRules(sandbox, 'dig', DNS_READY);
    writeRules(sandbox, 'curl', [...API_UP, ...PAGES_UP]);
  };
  const smokeEvidence = (sandbox: Sandbox): boolean => toolLog(sandbox, 'curl').length > 0 && toolLog(sandbox, 'gcloud').length > 0;

  withSandbox((sandbox) => {
    writeOperatorFile(sandbox); loadtestVmStubs(sandbox); smokeReady(sandbox);
    const run = runScript(sandbox, 'loadtest/run.sh', ['start'], { STUB_FAIL_FILE_OP: 'rm', STUB_FILE_OP_RC: '7' });
    check('rm failure after production stop restores and runs smoke', run.status === 7 && run.stderr.includes('load-test start failed (exit 7)') && stubFile(sandbox, 'events.log').includes('production-restore') && smokeEvidence(sandbox), `${run.stdout}\n${run.stderr}`);
  });

  withSandbox((sandbox) => {
    writeOperatorFile(sandbox); loadtestVmStubs(sandbox); smokeReady(sandbox);
    const run = runScript(sandbox, 'loadtest/run.sh', ['start'], { STUB_FAIL_FILE_OP: 'install', STUB_FILE_OP_RC: '11' });
    check('install failure after production stop restores and runs smoke', run.status === 11 && run.stderr.includes('load-test start failed (exit 11)') && stubFile(sandbox, 'events.log').includes('production-restore') && smokeEvidence(sandbox), `${run.stdout}\n${run.stderr}`);
  });

  withSandbox((sandbox) => {
    writeOperatorFile(sandbox); loadtestVmStubs(sandbox); smokeReady(sandbox);
    const run = runScript(sandbox, 'loadtest/run.sh', ['start'], { STUB_REPLAY_START_RC: '9' });
    check('replay startup failure restores production and keeps its exit status', run.status === 9 && run.stderr.includes('load-test compose start failed') && stubFile(sandbox, 'events.log').includes('production-restore') && smokeEvidence(sandbox), `${run.stdout}\n${run.stderr}`);
  });

  withSandbox((sandbox) => {
    writeOperatorFile(sandbox); loadtestVmStubs(sandbox); smokeReady(sandbox);
    const script = path.join(sandbox.repo, 'deploy', 'loadtest', 'run.sh');
    fs.writeFileSync(script, fs.readFileSync(script, 'utf8').replace('-lt 60', '-lt 1'));
    git(sandbox.repo, sandbox.home, ['add', '-A']); git(sandbox.repo, sandbox.home, ['commit', '-q', '-m', 'short health poll']);
    const run = runScript(sandbox, 'loadtest/run.sh', ['start'], { STUB_HEALTH_RC: '1' });
    const events = stubFile(sandbox, 'events.log').trim().split('\n');
    check('health identity failure restores production and runs smoke', run.status === 1 && run.stderr.includes('health check failed') && smokeEvidence(sandbox), `${run.stdout}\n${run.stderr}`);
    const replayStart = events.indexOf('replay-start');
    const replayStop = events.indexOf('replay-stop', replayStart + 1);
    check('health failure orders replay start, replay stop, then production restore', replayStart >= 0 && replayStop > replayStart && events.indexOf('production-restore') > replayStop, events.join(' / '));
  });

  withSandbox((sandbox) => {
    writeOperatorFile(sandbox); loadtestVmStubs(sandbox); smokeReady(sandbox);
    const run = runScript(sandbox, 'loadtest/run.sh', ['start'], { STUB_REPLAY_START_RC: '9', STUB_RESTORE_RC: '8' });
    check('restore failure reports both the original and recovery causes', run.status === 9 && run.stderr.includes('load-test compose start failed') && run.stderr.includes('recovery failed while restoring') && smokeEvidence(sandbox), `${run.stdout}\n${run.stderr}`);
    check('restore failure still stops the replay service', stubFile(sandbox, 'events.log').includes('production-stop\nreplay-start\nreplay-stop'), stubFile(sandbox, 'events.log'));
  });

  withSandbox((sandbox) => {
    writeOperatorFile(sandbox); loadtestVmStubs(sandbox); smokeReady(sandbox);
    const run = runScript(sandbox, 'loadtest/run.sh', ['start'], { STUB_REPLAY_START_RC: '9', STUB_REPLAY_STOP_RC: '6' });
    check('replay cleanup stop failure reports recovery error and keeps base restore', run.status === 9 && run.stderr.includes('recovery failed while stopping the replay service') && stubFile(sandbox, 'events.log').includes('production-restore') && smokeEvidence(sandbox), `${run.stdout}\n${run.stderr}`);
  });

  withSandbox((sandbox) => {
    writeOperatorFile(sandbox); loadtestVmStubs(sandbox);
    const run = runScript(sandbox, 'loadtest/run.sh', ['start'], { STUB_REPLAY_START_RC: '9' });
    check('smoke failure is reported without claiming production was restored', run.status === 9 && run.stderr.includes('recovery failed while running production smoke') && !run.stderr.includes('smoke.sh: all checks passed'), `${run.stdout}\n${run.stderr}`);
  });
}

function loadtestDriveTests(): void {
  section('Deploy scripts: load-test drive cleanup');

  const pause = (milliseconds: number): void => {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
  };
  const processIsAlive = (pid: number): boolean => {
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      return (error as NodeJS.ErrnoException).code !== 'ESRCH';
    }
  };
  const waitForProcessExit = (pid: number): boolean => {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      if (!processIsAlive(pid)) return true;
      pause(20);
    }
    return !processIsAlive(pid);
  };
  const stopTestProcess = (pid: number): void => {
    if (!processIsAlive(pid)) return;
    try {
      process.kill(pid, 'SIGTERM');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
    }
    if (waitForProcessExit(pid)) return;
    try {
      process.kill(pid, 'SIGKILL');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
    }
    waitForProcessExit(pid);
  };

  const writeDriveStubs = (sandbox: Sandbox): void => {
    fs.writeFileSync(path.join(sandbox.bin, 'gcloud'), `#!/usr/bin/env bash
printf '%s' "$$" >"$STUB_DIR/sampler-pid"
ps -o pgid= -p "$$" | tr -d ' ' >"$STUB_DIR/sampler-pgid"
heartbeat=0
trap 'printf "%s" "$$" >"$STUB_DIR/sampler-terminated"; exit 0' TERM
while :; do
  heartbeat=$((heartbeat + 1))
  printf '%s' "$heartbeat" >"$STUB_DIR/sampler-heartbeat"
  printf '1.5,2.5\\n'
  sleep 0.1
done
`, { mode: 0o755 });
    fs.writeFileSync(path.join(sandbox.bin, 'node'), `#!/usr/bin/env bash
stats=''
previous=''
for arg in "$@"; do [ "$previous" = --stats ] && stats="$arg"; previous="$arg"; done
printf '%s' "$stats" >"$STUB_DIR/driver-stats"
attempt=0
while [ ! -s "$STUB_DIR/sampler-pid" ] && [ "$attempt" -lt 100 ]; do attempt=$((attempt + 1)); sleep 0.01; done
attempt=0
while [ ! -s "$stats" ] && [ "$attempt" -lt 100 ]; do attempt=$((attempt + 1)); sleep 0.01; done
if [ -s "$stats" ]; then
  printf '%s' "$stats" >"$STUB_DIR/driver-stats-receipt"
  sed -n '1p' "$stats" >"$STUB_DIR/driver-stats-sample"
fi
exit "\${STUB_DRIVER_STATUS:-0}"
`, { mode: 0o755 });
  };

  const driveCase = (name: string, driverStatus: number): void => {
    withSandbox((sandbox) => {
      writeDriveStubs(sandbox);

      let samplerPid = 0;
      try {
        const run = runScript(sandbox, 'loadtest/run.sh', ['drive', '--devices', '2', '--cap', '2'], {
          STUB_DRIVER_STATUS: String(driverStatus),
        });
        samplerPid = Number(stubFile(sandbox, 'sampler-pid'));
        const stats = stubFile(sandbox, 'driver-stats');
        const statsReceipt = stubFile(sandbox, 'driver-stats-receipt');
        const heartbeat = stubFile(sandbox, 'sampler-heartbeat');
        pause(200);
        const samplerStopped = samplerPid > 0
          && stubFile(sandbox, 'sampler-terminated') === String(samplerPid)
          && waitForProcessExit(samplerPid)
          && stubFile(sandbox, 'sampler-heartbeat') === heartbeat;
        check(name, run.status === driverStatus
          && !run.stderr.includes('unbound variable')
          && samplerStopped
          && stats !== ''
          && statsReceipt === stats
          && stubFile(sandbox, 'driver-stats-sample') === '1.5,2.5\n'
          && !fs.existsSync(stats), `${run.stdout}\n${run.stderr}\nstatus=${run.status} sampler=${samplerPid} stopped=${samplerStopped} stats=${stats} receipt=${statsReceipt} exists=${stats !== '' && fs.existsSync(stats)}`);
      } finally {
        if (samplerPid === 0) samplerPid = Number(stubFile(sandbox, 'sampler-pid'));
        if (samplerPid > 0) stopTestProcess(samplerPid);
      }
    });
  };

  driveCase('a successful driver exits 0 after terminating its sampler and removing its CSV', 0);
  driveCase('a failed driver preserves its distinct status after sampler and CSV cleanup', 23);
}

function provisionTests(): void {
  section('Deploy scripts: provision.sh');
  withSandbox((sandbox) => {
    const run = runScript(sandbox, 'provision.sh', ['--profile', 'huge']);
    check('provision.sh refuses an unknown profile with no gcloud call', run.status === 1 && run.stderr.includes('no profile named huge') && toolLog(sandbox, 'gcloud').length === 0, run.stderr);
  });

  withSandbox((sandbox) => {
    writeRules(sandbox, 'gcloud', [['*compute addresses list*', 0, '']]);
    const run = runScript(sandbox, 'provision.sh', [], PROVISION_VALUES);
    const calls = toolLog(sandbox, 'gcloud');
    check('provision.sh fails when no reserved address holds WHIM_STATIC_IP, naming it', run.status === 1 && run.stderr.includes(`no reserved address in northamerica-northeast1 holds ${STATIC_IP}`), run.stderr);
    check('  ... having created or enabled nothing', calls.length === 1 && calls.every((line) => !/create|enable|add-iam-policy-binding/.test(line)), calls.join(' / '));
  });

  withSandbox((sandbox) => {
    const run = runScript(sandbox, 'provision.sh', []);
    check(
      'provision.sh without the alert values names each, before any gcloud call',
      run.status === 1 && ['WHIM_ALERT_EMAIL', 'WHIM_BILLING_ACCOUNT', 'WHIM_MONTHLY_BUDGET'].every((key) => run.stderr.includes(`missing required value ${key}`)) && toolLog(sandbox, 'gcloud').length === 0,
      run.stderr,
    );
  });
  for (const [key, value] of [['WHIM_ALERT_EMAIL', 'owner@example.test", "type": "sms'], ['WHIM_BILLING_ACCOUNT', 'billingAccounts/0123AB'], ['WHIM_MONTHLY_BUDGET', '250.50']] as const) {
    withSandbox((sandbox) => {
      const run = runScript(sandbox, 'provision.sh', [], { ...PROVISION_VALUES, [key]: value });
      check(`provision.sh refuses a malformed ${key}, naming it, before any gcloud call`, run.status === 1 && run.stderr.includes(key) && toolLog(sandbox, 'gcloud').length === 0, run.stderr);
    });
  }
}

// ---------------------------------------------------------------------------------------------
// Alerts, budget, snapshots and the source-map bucket (developer-observability D10, D12)

const PROVISION_VALUES = { WHIM_ALERT_EMAIL: 'owner@example.test', WHIM_BILLING_ACCOUNT: '0123AB-4567CD-89EF01', WHIM_MONTHLY_BUDGET: '250' } as const;
const CHANNEL_NAME = 'projects/anycognition-whim/notificationChannels/7001';
const UPTIME_NAME = 'projects/anycognition-whim/uptimeCheckConfigs/whim-api-healthz-x1';
const BUDGET_NAME = `billingAccounts/${PROVISION_VALUES.WHIM_BILLING_ACCOUNT}/budgets/b-1`;
/** The real billing account bills in CAD, and Cloud Billing refuses a budget in another currency. */
const BILLING_CURRENCY = 'CAD';
const BILLING_ACCOUNT_CURRENCY: StubRule = [`*beta billing accounts describe ${PROVISION_VALUES.WHIM_BILLING_ACCOUNT} *`, 0, `${BILLING_CURRENCY}\\n`];

/** The rules every full provision run needs, whatever exists: the adopted address, the VM, Cloud
 *  Build's account. */
const PROVISION_BASE: readonly StubRule[] = [
  ['*compute addresses list*', 0, 'whim-ip,IN_USE\\n'],
  ['*builds get-default-service-account*', 0, 'projects/p/serviceAccounts/123@cloudbuild.gserviceaccount.com\\n'],
];

/** Cloud Logging's own default, where a new project's `_Default` sink writes. */
const GLOBAL_LOG_DESTINATION = 'logging.googleapis.com/projects/anycognition-whim/locations/global/buckets/_Default';
const REGIONAL_LOG_DESTINATION = 'logging.googleapis.com/projects/anycognition-whim/locations/northamerica-northeast1/buckets/whim-logs';

/** A project where none of the alerting resources exist yet. Creates answer with a resource name. */
const NOTHING_PROVISIONED: readonly StubRule[] = [
  ['*compute resource-policies describe*', 1, ''],
  ['*compute disks describe*resourcePolicies*', 0, '{}\\n'],
  ['*storage buckets describe*', 1, ''],
  ['*logging buckets describe whim-logs *', 1, ''],
  ['*logging sinks describe _Default *', 0, `${GLOBAL_LOG_DESTINATION}\\n`],
  ['*logging buckets describe _Default --location global *', 0, '30\\n'],
  ['*monitoring channels list*', 0, ''],
  ['*monitoring channels create*', 0, `${CHANNEL_NAME}\\n`],
  ['*monitoring uptime list-configs*', 0, ''],
  ['*monitoring uptime create*', 0, `${UPTIME_NAME}\\n`],
  ['*logging metrics describe*', 1, ''],
  ['*monitoring policies list*', 0, ''],
  ['*monitoring policies create*', 0, 'projects/anycognition-whim/alertPolicies/9001\\n'],
  ['*billing budgets list*', 0, ''],
  BILLING_ACCOUNT_CURRENCY,
];

interface ProvisionRun extends ScriptRun {
  readonly calls: string[];
  /** Each file a gcloud call read, parsed, keyed by the file's name, the last one winning. */
  readonly files: Map<string, Record<string, unknown>>;
}

/** `script`, when given, replaces the sandbox's deploy/provision.sh (a planted weakening). */
function provisionAgainst(state: readonly StubRule[], values: Readonly<Record<string, string>> = PROVISION_VALUES, script?: string): ProvisionRun {
  let result: ProvisionRun | undefined;
  withSandbox((sandbox) => {
    writeRules(sandbox, 'gcloud', [...PROVISION_BASE, ...state]);
    if (script !== undefined) fs.writeFileSync(path.join(sandbox.repo, 'deploy', 'provision.sh'), script);
    const run = runScript(sandbox, 'provision.sh', [], values);
    const captured = path.join(sandbox.stubs, 'from-file');
    const names = fs.existsSync(captured) ? fs.readdirSync(captured).sort((a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10)) : [];
    const files = new Map(names.map((name) => [name.replace(/^\d+-/, ''), JSON.parse(fs.readFileSync(path.join(captured, name), 'utf8')) as Record<string, unknown>]));
    result = { ...run, calls: toolLog(sandbox, 'gcloud'), files };
  });
  if (!result) throw new Error('setup: provision sandbox did not run');
  return result;
}

function callMatching(calls: readonly string[], pattern: RegExp): string {
  return calls.find((line) => pattern.test(line)) ?? '';
}

function specOf(resource: Record<string, unknown> | undefined): string {
  return String((resource?.userLabels as Record<string, unknown> | undefined)?.whim_spec ?? '');
}

/** The project as a finished run left it: every list and describe answers with what that run
 *  created, read back from its gcloud calls and the files they took. */
function stateAfter(run: ProvisionRun, budgetAmount = PROVISION_VALUES.WHIM_MONTHLY_BUDGET): StubRule[] {
  const row = (...fields: string[]): string => fields.join('\\t');
  const channel = run.files.get('channel-email.json');
  const uptimeCall = callMatching(run.calls, / monitoring uptime create /);
  const uptimeDisplay = / monitoring uptime create (.+?) --resource-type/.exec(uptimeCall)?.[1] ?? '';
  const uptimeSpec = /whim_spec=([0-9a-f]+)/.exec(uptimeCall)?.[1] ?? '';
  const keepDays = /--max-retention-days (\d+)/.exec(callMatching(run.calls, /resource-policies create snapshot-schedule /))?.[1] ?? '';
  const attached = /--resource-policies (\S+)/.exec(callMatching(run.calls, / add-resource-policies /))?.[1] ?? '';
  const policies = [...run.files].filter(([name]) => name.startsWith('policy-')).map(([, policy], index) => row(String(policy.displayName), `projects/anycognition-whim/alertPolicies/${index}`, specOf(policy)));
  const metrics: StubRule[] = [...run.files]
    .filter(([name]) => name.startsWith('metric-'))
    .map(([name, metric]) => [`*logging metrics describe ${name.replace(/^metric-|\.json$/g, '')} *`, 0, `${String(metric.description)}\\n`]);
  return [
    ['*compute resource-policies describe*', 0, `${keepDays}\\n`],
    ['*compute disks describe*resourcePolicies*', 0, `{"resourcePolicies": ["https://www.googleapis.com/compute/v1/projects/anycognition-whim/regions/northamerica-northeast1/resourcePolicies/${attached}"]}\\n`],
    ['*storage buckets describe*', 0, ''],
    ['*logging buckets describe whim-logs *', 0, `${/ logging buckets create whim-logs .*--retention-days (\d+)/.exec(callMatching(run.calls, / logging buckets create whim-logs /))?.[1] ?? ''}\\n`],
    ['*logging sinks describe _Default *', 0, `${/ logging sinks update _Default (\S+)/.exec(callMatching(run.calls, / logging sinks update _Default /))?.[1] ?? ''}\\n`],
    ['*logging buckets describe _Default --location global *', 0, `${/ logging buckets update _Default --location global --retention-days (\d+)/.exec(callMatching(run.calls, / logging buckets update _Default /))?.[1] ?? ''}\\n`],
    ['*monitoring channels list*', 0, `${row(String(channel?.displayName), CHANNEL_NAME, specOf(channel))}\\n`],
    ['*monitoring uptime list-configs*', 0, `${row(uptimeDisplay, UPTIME_NAME, uptimeSpec, API_HOST)}\\n`],
    ...metrics,
    ['*monitoring policies list*', 0, policies.map((line) => `${line}\\n`).join('')],
    ['*billing budgets list*', 0, `${row('Whim monthly spend', BUDGET_NAME, budgetAmount, CHANNEL_NAME)}\\n`],
    ...NOTHING_PROVISIONED,
  ];
}

const CHANGING_CALL = / (?:create|update|add-resource-policies) /;

/** Every budget create or update must state its amount in the billing account's own currency. */
function budgetCurrencyProblems(run: ProvisionRun, amount: string): string[] {
  const budgetCalls = run.calls.filter((line) => / billing budgets (?:create|update) /.test(line));
  if (budgetCalls.length === 0) return ['no budget was created or updated'];
  return budgetCalls.filter((line) => !line.includes(`--budget-amount ${amount}${BILLING_CURRENCY} `)).map((line) => `a budget amount is not ${amount} in the billing account's currency ${BILLING_CURRENCY}: ${line}`);
}

/** Cloud Logging's severity order. */
const SEVERITY_ORDER = ['DEFAULT', 'DEBUG', 'INFO', 'NOTICE', 'WARNING', 'ERROR', 'CRITICAL', 'ALERT', 'EMERGENCY'];

/** Advances past one `"..."` quoted span starting at the opening quote. */
function skipQuotedSpan(filter: string, start: number): number {
  let i = start + 1;
  while (i < filter.length && filter[i] !== '"') i++;
  return i + 1;
}

/** Advances past one leaf term starting at `start`, e.g. `jsonPayload.msg="provider credit
 *  exhausted"` or `log_id("docker")`. A leaf term is read greedily, treating a quoted span as
 *  opaque (it may hold spaces) and tracking paren depth locally, so only a `)` the term does NOT
 *  itself own — a `log_id(...)` call closes its own paren — is left as a top-level group
 *  boundary for the caller. */
function readFilterWord(filter: string, start: number): number {
  let i = start;
  let depth = 0;
  while (i < filter.length) {
    const c = filter[i]!;
    if (c === '"') {
      i = skipQuotedSpan(filter, i);
    } else if (c === '(') {
      depth++;
      i++;
    } else if (c === ')' && depth > 0) {
      depth--;
      i++;
    } else if (c === ')' || /\s/.test(c)) {
      break;
    } else {
      i++;
    }
  }
  return i;
}

/** Splits a Logs Explorer filter into `(`, `)`, `AND`, `OR` and leaf-term tokens (see
 *  `readFilterWord` for how a leaf term is delimited). */
function tokenizeFilter(filter: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  while (i < filter.length) {
    const c = filter[i]!;
    if (/\s/.test(c)) {
      i++;
    } else if (c === '(' || c === ')') {
      tokens.push(c);
      i++;
    } else {
      const end = readFilterWord(filter, i);
      tokens.push(filter.slice(i, end));
      i = end;
    }
  }
  return tokens;
}

/** Parse state for the recursive-descent filter evaluator below: the token stream, the read
 *  position, and the line being matched, threaded through as one object so each grammar rule is
 *  its own top-level function instead of a closure nested inside `filterMatches`. */
interface FilterEvalState {
  readonly filter: string;
  readonly tokens: readonly string[];
  readonly line: Readonly<Record<string, unknown>>;
  pos: number;
}

function evalFilterLeaf(term: string, line: Readonly<Record<string, unknown>>): boolean {
  if (term === 'log_id("docker")') return true;
  const field = /^jsonPayload\.(\w+)="([^"]*)"$/.exec(term);
  if (field) return line[field[1]!] === field[2];
  const numeric = /^jsonPayload\.(\w+)=(-?\d+)$/.exec(term);
  if (numeric) return line[numeric[1]!] === Number(numeric[2]);
  const severity = /^severity>=([A-Z]+)$/.exec(term);
  if (severity) return SEVERITY_ORDER.indexOf(String(line.severity)) >= SEVERITY_ORDER.indexOf(severity[1]!);
  throw new Error(`setup: filter term ${term} is not understood`);
}

function evalFilterPrimary(state: FilterEvalState): boolean {
  const token = state.tokens[state.pos];
  if (token === '(') {
    state.pos++;
    const result = evalFilterOr(state);
    if (state.tokens[state.pos] !== ')') throw new Error(`setup: unbalanced parens in filter: ${state.filter}`);
    state.pos++;
    return result;
  }
  if (token === undefined || token === 'AND' || token === 'OR' || token === ')') {
    throw new Error(`setup: expected a term at position ${state.pos} in filter: ${state.filter}`);
  }
  state.pos++;
  return evalFilterLeaf(token, state.line);
}

function evalFilterAnd(state: FilterEvalState): boolean {
  let result = evalFilterPrimary(state);
  while (state.tokens[state.pos] === 'AND') {
    state.pos++;
    const right = evalFilterPrimary(state);
    result = result && right;
  }
  return result;
}

function evalFilterOr(state: FilterEvalState): boolean {
  let result = evalFilterAnd(state);
  while (state.tokens[state.pos] === 'OR') {
    state.pos++;
    const right = evalFilterAnd(state);
    result = result || right;
  }
  return result;
}

/** Whether a Logs Explorer filter matches one server line as the Ops Agent ships it
 *  (handoff/log-shipping.md: pino fields under jsonPayload, the docker log, pino's severity).
 *  Understands `AND`/`OR`-joined leaf terms with explicit parenthesised grouping (`AND` binds
 *  tighter than `OR`, matching Cloud Logging query syntax) — the subset the policies in
 *  deploy/monitoring/ use. Only the leaf term forms the alerts use are understood; any other
 *  throws, so a new form gets a case here instead of passing unread. */
function filterMatches(filter: string, line: Readonly<Record<string, unknown>>): boolean {
  const state: FilterEvalState = { filter, tokens: tokenizeFilter(filter), line, pos: 0 };
  const result = evalFilterOr(state);
  if (state.pos !== state.tokens.length) throw new Error(`setup: trailing tokens in filter: ${filter}`);
  return result;
}

/** The structural `402` `isCreditExhaustedError` (`../src/generation/model.ts`) detects. */
class FakeProviderCreditError extends Error {
  readonly status = 402;
}

/** Always fails the content-policy check — the credit-exhausted filter's red case: it shares
 *  status 503 with `budget_exhausted` and must NOT match this alert. */
class AlwaysUnavailablePolicy implements ContentPolicy {
  async check(): Promise<PolicyCheckResult> {
    throw new PolicyUnavailableError('deploy-config test: classifier down');
  }
}

const CREDIT_TEST_DEVICE_ID = 'd4d4d4d4-d4d4-4d4d-8d4d-d4d4d4d4d4d4';

/** Every log line the real server writes for the "credit exhausted" alert's two sources — a
 *  pre-admission `budget_exhausted` refusal (the cached operator credit is already below the
 *  floor) and a mid-generation provider `402` (`scope="run" msg="provider credit exhausted"`,
 *  logged by `generation/machine.ts`'s `endOnThrow`) — plus one `policy_unavailable` refusal, the
 *  filter's red case. */
async function creditAlertSourceLines(): Promise<Record<string, unknown>[]> {
  const headers = { 'content-type': 'application/json', 'x-whim-device': CREDIT_TEST_DEVICE_ID, ...PROTOCOL_HEADERS };
  const post = (app: ReturnType<typeof createApp>, route: string, body: unknown): Promise<Response | typeof TIMED_OUT> =>
    within(Promise.resolve(app.request(route, { method: 'POST', headers, body: JSON.stringify(body) })));

  const capture = captureLogs();
  try {
    invalidateCreditCache();
    const lowCredit: CreditTransport = {
      lookupKey: async () => ({ status: 200, bodyText: JSON.stringify({ data: { limit_remaining: 0.1 } }) }),
    };
    const budgetApp = createApp({
      pipeline: createStubPipeline(0),
      usageStore: new InMemoryUsageStore(),
      config: { ...loadServerConfig({}), minCreditUsd: 0.5 },
      creditTransport: lowCredit,
    });
    const budgetRes = await post(budgetApp, '/v1/clarify', { prompt: 'a tip splitter' });
    if (budgetRes === TIMED_OUT || budgetRes.status !== 503) {
      throw new Error(`setup: the budget_exhausted refusal answered ${budgetRes === TIMED_OUT ? 'nothing' : budgetRes.status}`);
    }

    const policyApp = createApp({
      pipeline: createStubPipeline(0),
      usageStore: new InMemoryUsageStore(),
      config: loadServerConfig({}),
      policy: cachedPolicy(new AlwaysUnavailablePolicy()),
    });
    const policyRes = await post(policyApp, '/v1/clarify', { prompt: 'a tip splitter' });
    if (policyRes === TIMED_OUT || policyRes.status !== 503) {
      throw new Error(`setup: the policy_unavailable refusal answered ${policyRes === TIMED_OUT ? 'nothing' : policyRes.status}`);
    }

    invalidateCreditCache();
    const roster = defaultModelRoster('vendor/rewrite-g', 'vendor/engineer-g');
    const model = new ScriptedModelClient(roster, [{ role: 'plan', deltas: [], error: new FakeProviderCreditError('insufficient credit') }]);
    const clock: Clock = { now: () => Date.now() };
    const genApp = createApp({ pipeline: machinePipeline(model, clock, roster), usageStore: new InMemoryUsageStore(), config: loadServerConfig({}) });
    const genRes = await post(genApp, '/v1/generate', { prompt: 'a tip splitter' });
    if (genRes === TIMED_OUT) throw new Error('setup: /v1/generate did not answer in time');
    const drained = await within(readSseResponse(genRes));
    if (drained === TIMED_OUT) throw new Error('setup: the /v1/generate stream did not settle in time');
  } finally {
    capture.stop();
  }
  return capture.records;
}

/** Every line the real server logs for one report, one error diagnostic and one warning diagnostic. */
async function realAlertSourceLines(): Promise<Record<string, unknown>[]> {
  const app = createApp({ pipeline: createStubPipeline(0), usageStore: new InMemoryUsageStore(), config: loadServerConfig({}) });
  const headers = {
    'content-type': 'application/json',
    'x-whim-device': 'c3c3c3c3-c3c3-4c3c-8c3c-c3c3c3c3c3c3',
    [PLATFORM_HEADER]: 'android',
    [APP_VERSION_HEADER]: '1.2.0',
    [BUILD_HEADER]: '382000',
    [CONSENT_HEADER]: '2',
    ...PROTOCOL_HEADERS,
  };
  const post = async (route: string, body: unknown): Promise<number> => {
    const res = await within(Promise.resolve(app.request(route, { method: 'POST', headers, body: JSON.stringify(body) })));
    if (res === TIMED_OUT) throw new Error(`setup: ${route} did not answer in time`);
    return res.status;
  };
  const capture = captureLogs();
  try {
    const report = await post('/v1/report', { reason: 'offensive', note: 'MARKER-NOTE', appName: 'MARKER-APP', prompt: 'MARKER-PROMPT', source: 'MARKER-SOURCE' });
    const record = (level: string): Record<string, unknown> => ({ at: Date.now(), level, channel: 'whim:launcher', message: `${level} probe` });
    const diagnostics = await post('/v1/diagnostics', { osVersion: '14', records: [record('error'), record('warn')] });
    if (report !== 202 || diagnostics !== 204) throw new Error(`setup: report answered ${report}, diagnostics ${diagnostics}`);
  } finally {
    capture.stop();
  }
  return capture.records;
}

/** Every line the real server logs for one generation whose plan fails validation twice (a model
 *  repeating the screen "Alice's Lisbon Tab"), through the route, the machine and the ledger. */
async function planFailureLines(): Promise<Record<string, unknown>[]> {
  const roster = defaultModelRoster('vendor/rewrite-g', 'vendor/engineer-g');
  const screen = { name: "Alice's Lisbon Tab", purpose: 'split the trip' };
  const plan = JSON.stringify({ screens: [screen, screen], initial: screen.name, state: [], capabilities: [], storageKeys: [] });
  const model = new ScriptedModelClient(roster, [{ role: 'plan', deltas: [plan] }, { role: 'plan', deltas: [plan] }]);
  const app = createApp({ pipeline: machinePipeline(model, { now: () => Date.now() }, roster), usageStore: new InMemoryUsageStore(), config: loadServerConfig({}) });
  const capture = captureLogs();
  try {
    const res = await within(Promise.resolve(app.request('/v1/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-whim-device': 'f5f5f5f5-f5f5-4f5f-8f5f-f5f5f5f5f5f5', ...PROTOCOL_HEADERS },
      body: JSON.stringify({ prompt: 'split the Lisbon trip costs' }),
    })));
    if (res === TIMED_OUT) throw new Error('setup: /v1/generate did not answer in time');
    const drained = await within(readSseResponse(res));
    if (drained === TIMED_OUT) throw new Error('setup: the /v1/generate stream did not settle in time');
  } finally {
    capture.stop();
  }
  return capture.records;
}

/** The runbook's "Terminal failures, by reason" saved query (docs/deploy.md), narrowed to `code`,
 *  as one AND filter. */
function runbookTerminalFailureFilter(code: string): string {
  const row = readRepoFile('docs/deploy.md').split('\n').find((line) => line.trim().startsWith('| Terminal failures, by reason |')) ?? '';
  const [base, narrow] = [...row.matchAll(/`([^`]+)`/g)].map((match) => match[1]!);
  if (!base?.startsWith('log_id("docker") ') || !narrow?.includes('<code>')) throw new Error(`setup: the runbook row is not base + narrowing filter: ${row}`);
  return `log_id("docker") AND ${base.slice('log_id("docker") '.length)} AND ${narrow.replace('<code>', code)}`;
}

function policyFile(name: string): { conditions: Array<{ conditionMatchedLog?: { filter: string; labelExtractors?: Record<string, string> } }>; documentation: { content: string } } {
  return JSON.parse(readRepoFile(`deploy/monitoring/${name}`)) as ReturnType<typeof policyFile>;
}

/** Cloud Logging: an alert policy with any `conditionMatchedLog` condition can have only one
 *  condition — this is the real `deploy/provision.sh` failure this locks against:
 *  `INVALID_ARGUMENT: Alert policies with a log matching condition can only have a single
 *  condition`. */
function logMatchConditionCountProblems(name: string, policy: ReturnType<typeof policyFile>): string[] {
  const hasLogMatchCondition = policy.conditions.some((condition) => condition.conditionMatchedLog);
  if (!hasLogMatchCondition || policy.conditions.length <= 1) return [];
  return [`${name}: ${policy.conditions.length} conditions but has a conditionMatchedLog condition (only one condition is allowed)`];
}

function monitoringPolicyShapeTests(): void {
  section("Deploy artifacts: a log-matching alert policy has exactly one condition (Cloud Logging's own limit)");
  const policyFiles = fs.readdirSync(path.join(ROOT, 'deploy', 'monitoring')).filter((name) => /^policy-.*\.json$/.test(name));
  const problems = policyFiles.flatMap((name) => logMatchConditionCountProblems(name, policyFile(name)));
  checkClean('every deploy/monitoring/policy-*.json with a conditionMatchedLog condition has exactly one condition', problems);

  const credit = policyFile('policy-credit-exhausted.json');
  const restoredTwoConditionCredit: ReturnType<typeof policyFile> = { ...credit, conditions: [credit.conditions[0]!, credit.conditions[0]!] };
  checkCaught(
    'red: restoring policy-credit-exhausted.json to its former two-condition shape (the actual provision.sh failure) is caught',
    logMatchConditionCountProblems('policy-credit-exhausted.json', restoredTwoConditionCredit),
    'only one condition is allowed',
  );
}

async function alertFilterTests(): Promise<void> {
  section('Deploy artifacts: the log-based alerts match the lines the real server writes');
  const lines = await realAlertSourceLines();
  const matching = (filter: string): Array<Record<string, unknown>> => lines.filter((line) => filterMatches(filter, line));

  const report = policyFile('policy-report.json').conditions[0]?.conditionMatchedLog;
  const reportFilter = report?.filter ?? '';
  const reportLines = matching(reportFilter);
  eq('the report alert matches exactly the one "report accepted" line a report writes', reportLines.map((line) => line.msg), ['report accepted']);
  const extractors = Object.entries(report?.labelExtractors ?? {});
  const extracted = Object.fromEntries(extractors.map(([label, rule]) => [label, reportLines[0]?.[/^EXTRACT\(jsonPayload\.(\w+)\)$/.exec(rule)?.[1] ?? '']]));
  eq('  ... and its email carries only that line\'s report id and reason', extracted, { reportId: reportLines[0]?.reportId, reason: 'offensive' });
  const labelsUsed = [...policyFile('policy-report.json').documentation.content.matchAll(/\$\{log\.extracted_label\.(\w+)\}/g)].map((match) => match[1]);
  check('  ... and its text names no label it does not extract', labelsUsed.length > 0 && labelsUsed.every((label) => extractors.some(([name]) => name === label)), JSON.stringify(labelsUsed));
  check('  ... none of which holds the note, app name, prompt or source', !JSON.stringify(extracted).includes('MARKER'), JSON.stringify(extracted));
  eq('  red: the same filter on another scope matches nothing', matching(plant(reportFilter, 'scope="report"', 'scope="reports"')).length, 0);

  const deviceFilter = policyFile('policy-device-error.json').conditions[0]?.conditionMatchedLog?.filter ?? '';
  eq('the device-error alert matches the error diagnostic and not the warning', matching(deviceFilter).map((line) => line.msg), ['error probe']);
  eq('  red: at WARNING it would match both', matching(deviceFilter.replace('severity>=ERROR', 'severity>=WARNING')).map((line) => line.msg), ['error probe', 'warn probe']);

  const failureLines = await planFailureLines();
  const failureMatching = (filter: string): Array<Record<string, unknown>> => failureLines.filter((line) => filterMatches(filter, line));
  const metricFilter = (JSON.parse(readRepoFile('deploy/monitoring/metric-whim-terminal-failures.json')) as { filter: string }).filter;
  eq('the terminal-failure metric counts exactly the one terminal failure line a failed generation writes', failureMatching(metricFilter).map((line) => line.msg), ['terminal failure']);
  eq("  ... and the runbook's query narrowed to plan_failed finds that line", failureMatching(runbookTerminalFailureFilter('plan_failed')).map((line) => line.msg), ['terminal failure']);
  eq('  red: narrowed to another code it finds nothing', failureMatching(runbookTerminalFailureFilter('repair_exhausted')).length, 0);
  check("  ... and no line of that generation names the model's screen", failureLines.length > 0 && failureLines.every((line) => !JSON.stringify(line).includes('Lisbon')));

  const creditLines = await creditAlertSourceLines();
  const creditMatching = (filter: string): Array<Record<string, unknown>> => creditLines.filter((line) => filterMatches(filter, line));
  const creditConditions = policyFile('policy-credit-exhausted.json').conditions;
  eq("the credit-exhausted alert has exactly one condition (a log-matching alert policy allows only one)", creditConditions.length, 1);
  const creditFilter = creditConditions[0]?.conditionMatchedLog?.filter ?? '';
  eq(
    "its single condition matches the budget_exhausted refusal and the mid-generation provider 402, and nothing else",
    creditMatching(creditFilter).map((line) => (line.msg === 'provider credit exhausted' ? line.msg : line.error)).sort((a, b) => String(a).localeCompare(String(b))),
    ['budget_exhausted', 'provider credit exhausted'].sort((a, b) => a.localeCompare(b)),
  );
  const weakerFilter = 'log_id("docker") AND jsonPayload.status=503';
  check(
    '  red: a status=503-only filter is not discriminating — it also catches the policy_unavailable refusal, which shares 503 with budget_exhausted',
    creditMatching(weakerFilter).some((line) => line.error === 'policy_unavailable'),
    JSON.stringify(creditMatching(weakerFilter).map((line) => line.error)),
  );
}

function provisionMonitoringTests(): void {
  section('Deploy scripts: provision.sh alerts, budget, snapshots and source maps (developer-observability D10)');
  const policyFiles = fs.readdirSync(path.join(ROOT, 'deploy', 'monitoring')).filter((name) => /^policy-.*\.json$/.test(name));

  const first = provisionAgainst(NOTHING_PROVISIONED);
  eq('a first provision run succeeds', first.status, 0);
  const created = (pattern: RegExp): number => first.calls.filter((line) => pattern.test(line)).length;
  eq(
    '  ... creating the channel, the uptime check, the log metric, every policy, the budget, the bucket and the snapshot schedule',
    [created(/ beta monitoring channels create /), created(/ monitoring uptime create /), created(/ logging metrics create /), created(/ monitoring policies create /), created(/ billing budgets create /), created(/ storage buckets create gs:\/\/anycognition-whim-sourcemaps /), created(/ resource-policies create snapshot-schedule /), created(/ disks add-resource-policies whim-data /)],
    [1, 1, 1, policyFiles.length, 1, 1, 1, 1],
  );
  const channel = first.files.get('channel-email.json');
  eq('  ... the channel emails WHIM_ALERT_EMAIL', (channel?.labels as Record<string, unknown> | undefined)?.email_address, PROVISION_VALUES.WHIM_ALERT_EMAIL);
  const policies = [...first.files].filter(([name]) => name.startsWith('policy-'));
  check(
    '  ... every policy notifies exactly the channel the run created',
    policies.length === policyFiles.length && policies.every(([, policy]) => JSON.stringify(policy.notificationChannels) === JSON.stringify([CHANNEL_NAME])),
    JSON.stringify(policies.map(([, policy]) => policy.notificationChannels)),
  );
  check('  ... the API-down policy watches the uptime check the run created', JSON.stringify(first.files.get('policy-api-down.json')).includes(`check_id=\\"${UPTIME_NAME.split('/').at(-1)}\\"`));
  const uptimeCall = callMatching(first.calls, / monitoring uptime create /);
  const regions = /--regions (\S+)/.exec(uptimeCall)?.[1]?.split(',') ?? [];
  check(`  ... the uptime check probes https://${API_HOST}/healthz every 5 minutes from at least three regions`, uptimeCall.includes(`host=${API_HOST},`) && uptimeCall.includes('--protocol https') && uptimeCall.includes('--path /healthz') && uptimeCall.includes('--period 5') && regions.length >= 3, uptimeCall);
  const budgetCall = callMatching(first.calls, / billing budgets create /);
  check(
    '  ... the budget covers WHIM_MONTHLY_BUDGET on WHIM_BILLING_ACCOUNT at 50, 90 and 100 %, emailing the channel',
    budgetCall.includes(`--billing-account ${PROVISION_VALUES.WHIM_BILLING_ACCOUNT}`) && ['0.5', '0.9', '1.0'].every((percent) => budgetCall.includes(`--threshold-rule percent=${percent}`)) && budgetCall.includes(`--notifications-rule-monitoring-notification-channels ${CHANNEL_NAME}`),
    budgetCall,
  );
  checkClean("  ... in the billing account's own currency, read from the account", budgetCurrencyProblems(first, PROVISION_VALUES.WHIM_MONTHLY_BUDGET));
  const provisionScript = readRepoFile('deploy/provision.sh');
  const hardcodedUsd = provisionAgainst(NOTHING_PROVISIONED, PROVISION_VALUES, plant(provisionScript, '"${WHIM_MONTHLY_BUDGET}${currency}"', '"${WHIM_MONTHLY_BUDGET}USD"'));
  checkCaught('  red: a budget hardcoded in USD fails against the CAD account', budgetCurrencyProblems(hardcodedUsd, PROVISION_VALUES.WHIM_MONTHLY_BUDGET), "not 250 in the billing account's currency");
  for (const [how, rule] of [['fails', [BILLING_ACCOUNT_CURRENCY[0], 1, '']], ['answers no currency code', [BILLING_ACCOUNT_CURRENCY[0], 0, '\\n']]] as const) {
    const unread = provisionAgainst([rule, ...NOTHING_PROVISIONED]);
    check(
      `  ... when reading the account's currency ${how}, provision stops naming the account, creating no budget`,
      unread.status === 1 && unread.stderr.includes(PROVISION_VALUES.WHIM_BILLING_ACCOUNT) && unread.stderr.includes('currency') && !unread.calls.some((line) => / billing budgets (?:create|update) /.test(line)),
      `${unread.stderr}\n${unread.calls.join(' / ')}`,
    );
  }
  const logBucketCall = callMatching(first.calls, / logging buckets create whim-logs /);
  check(
    '  ... logs are stored in the region: a 30-day whim-logs bucket there, the _Default sink pointed at it, the global bucket cut to 1 day',
    logBucketCall.includes('--location northamerica-northeast1') && logBucketCall.includes('--retention-days 30')
      && callMatching(first.calls, / logging sinks update _Default /).includes(REGIONAL_LOG_DESTINATION)
      && callMatching(first.calls, / logging buckets update _Default /).includes('--location global --retention-days 1'),
    first.calls.filter((line) => / logging (?:buckets|sinks) /.test(line)).join(' / '),
  );
  check('  ... the source-map bucket is private', /storage buckets create \S+ .*--uniform-bucket-level-access --public-access-prevention/.test(callMatching(first.calls, / storage buckets create /)));

  // specs/server-observability "Rerunning provisioning is a no-op".
  const second = provisionAgainst(stateAfter(first));
  eq('a second run against what the first created succeeds', second.status, 0);
  eq('  ... planning no change: no create, update or attach', second.calls.filter((line) => CHANGING_CALL.test(line)), []);
  check('  ... and saying each resource is unchanged', (second.stdout.match(/^unchanged /gm) ?? []).length >= policyFiles.length + 5, second.stdout);

  const newEmail = provisionAgainst(stateAfter(first), { ...PROVISION_VALUES, WHIM_ALERT_EMAIL: 'someone-else@example.test' });
  eq('a rerun with a new alert address updates the one channel in place and nothing else', newEmail.calls.filter((line) => CHANGING_CALL.test(line)).map((line) => / (beta monitoring channels update) /.exec(line)?.[1] ?? line), ['beta monitoring channels update']);
  const newBudget = provisionAgainst(stateAfter(first), { ...PROVISION_VALUES, WHIM_MONTHLY_BUDGET: '400' });
  const budgetChanges = newBudget.calls.filter((line) => CHANGING_CALL.test(line));
  check('a rerun with a new monthly amount updates the one budget to it and nothing else', budgetChanges.length === 1 && budgetChanges[0]!.includes(`billing budgets update ${BUDGET_NAME} `), budgetChanges.join(' / '));
  checkClean("  ... in the billing account's currency", budgetCurrencyProblems(newBudget, '400'));

  const duplicated = stateAfter(first).map((rule): StubRule => (rule[0] === '*monitoring policies list*' ? [rule[0], rule[1], `${rule[2] ?? ''}${(rule[2] ?? '').split('\\n')[0]}\\n`] : rule));
  const pages = readFiles(BACKUP_SENTENCES.map(([rel]) => rel));
  checkClean('both privacy pages say deleted records stay in disk backups for as long as the snapshot schedule keeps them', backupWordingProblems(provisionScript, pages));
  checkCaught('  red: a longer snapshot retention contradicts the pages', backupWordingProblems(plant(provisionScript, 'SNAPSHOT_KEEP_DAYS=14', 'SNAPSHOT_KEEP_DAYS=30'), pages), 'snapshots are kept 30 days');
  checkCaught('  red: a French page without the sentence fails', backupWordingProblems(provisionScript, withFile(pages, 'deploy/site/fr/privacy.html', '')), 'fr/privacy.html says backups keep deleted records for an unstated time');

  const twice = provisionAgainst(duplicated);
  check('a policy display name held by two policies refuses, naming it, rather than guessing which to update', twice.status === 1 && twice.stderr.includes('two resources are named'), twice.stderr);
}

// ---------------------------------------------------------------------------------------------

function imageTests(files: ReadonlyMap<string, string>, playwrightVersion: string): void {
  section('Deploy artifacts: image');
  const dockerfile = files.get('deploy/Dockerfile') ?? '';
  checkClean('the Dockerfile pins every base by digest, pins Playwright to the lockfile, runs non-root and copies no env file', dockerfileProblems(dockerfile, playwrightVersion));
  checkCaught('  red: a root final user fails', dockerfileProblems(plant(dockerfile, 'USER 10001:10001', 'USER root'), playwrightVersion), 'not a fixed non-root uid');
  checkClean('.dockerignore keeps env files, credentials, VCS data and node_modules out of the build context', requiredLineProblems('.dockerignore', files.get('.dockerignore') ?? '', ['.git', '**/node_modules', '**/.env', '**/.env.*', '**/*.env']));
  checkClean('.gcloudignore honours .gitignore and keeps env files out of the upload', requiredLineProblems('.gcloudignore', files.get('.gcloudignore') ?? '', ['#!include:.gitignore', '.git', '**/node_modules', '**/.env']));
  checkClean('cloudbuild.yaml builds linux/amd64 tagged with the commit SHA, with a pinned builder and no secret', cloudbuildProblems(files.get('deploy/cloudbuild.yaml') ?? ''));
  checkCaught('  red: a build-time secret fails', cloudbuildProblems(`${files.get('deploy/cloudbuild.yaml') ?? ''}availableSecrets: {}\n`), 'availableSecrets');
  const cloudbuild = files.get('deploy/cloudbuild.yaml') ?? '';
  checkCaught('  red: a second build arg fails', cloudbuildProblems(plant(cloudbuild, `      - ${COMMIT_BUILD_ARG}\n`, `      - ${COMMIT_BUILD_ARG}\n      - --build-arg=NODE_ENV=development\n`)), '--build-arg other than');
  checkCaught('  red: a commit build arg not taken from $COMMIT_SHA fails', cloudbuildProblems(plant(cloudbuild, COMMIT_BUILD_ARG, '--build-arg=WHIM_COMMIT=$_LAST_GOOD')), '--build-arg other than');
  checkCaught('  red: a build without the commit arg fails', cloudbuildProblems(plant(cloudbuild, `      - ${COMMIT_BUILD_ARG}\n`, '')), `lacks ${COMMIT_BUILD_ARG}`);
  checkClean('the runtime stage bakes the build arg into WHIM_COMMIT, "unknown" by default', commitBakeProblems(dockerfile));
  checkCaught('  red: a runtime stage that drops the ENV fails', commitBakeProblems(plant(dockerfile, 'ENV WHIM_COMMIT=$WHIM_COMMIT\n', '')), 'lacks ENV WHIM_COMMIT');
  checkClean('no deploy file outside the image build names WHIM_COMMIT', runtimeCommitProblems(files));
  checkCaught('  red: a compose environment setting WHIM_COMMIT fails', runtimeCommitProblems(withFile(files, 'deploy/compose.yaml', `${files.get('deploy/compose.yaml') ?? ''}# WHIM_COMMIT=${TAG}\n`)), 'deploy/compose.yaml names WHIM_COMMIT');
}

function composeTests(files: ReadonlyMap<string, string>, ctx: ComposeContext): void {
  section('Deploy artifacts: compose');
  const compose = files.get('deploy/compose.yaml') ?? '';
  checkClean('compose.yaml runs the server hardened (cap_drop ALL, cap_add exactly SYS_CHROOT, seccomp, no-new-privileges, non-root, no published port) behind a digest-pinned Caddy', composeProblems(compose, ctx));
  const capAdd = '    cap_add:\n      - SYS_CHROOT\n';
  checkCaught('  red: cap_add [SYS_ADMIN] fails', composeProblems(plant(compose, capAdd, '    cap_add: [SYS_ADMIN]\n'), ctx), 'cap_add is [SYS_ADMIN]');
}

function caddyTests(files: ReadonlyMap<string, string>, maxBodyBytes: number, siteFiles: readonly string[]): void {
  section('Deploy artifacts: Caddyfile');
  const caddyfile = files.get('deploy/Caddyfile') ?? '';
  checkClean('the API site proxies with flush_interval -1, no encode, no log and no file serving; the pages site serves exactly the D21 route table', caddyfileProblems(caddyfile, maxBodyBytes, siteFiles));
  const red = (name: string, text: string, needle: string): void => checkCaught(`  red: ${name}`, caddyfileProblems(text, maxBodyBytes, siteFiles), needle);
  red('dropping flush_interval -1 fails', plant(caddyfile, '\t\tflush_interval -1\n', ''), 'flush_interval -1');
  red('dropping font-src \'self\' fails', plant(caddyfile, "; font-src 'self'\"", '"'), 'Content-Security-Policy');
  red('allowing a remote font origin fails', plant(caddyfile, "; font-src 'self'\"", "; font-src 'self' https://fonts.gstatic.com\""), 'Content-Security-Policy');
  red('dropping the /beta/thanks route fails', plant(caddyfile, '\thandle /beta/thanks {\n\t\trewrite * /beta-thanks.html\n', '\thandle /beta/thanks-page {\n\t\trewrite * /beta-thanks.html\n'), 'not the D21 route table');
  red('rewriting /assets/* to a page fails', plant(caddyfile, '\thandle /assets/* {\n', '\thandle /assets/* {\n\t\trewrite * /beta.html\n'), '/assets/* is not served straight');

  checkClean("Caddy's default logger deletes the request headers and the client's address from a real reverse-proxy line", caddyLogProblems(caddyfile, CADDY_PROXY_ABORT_LINE));
  const logRed = (name: string, text: string, needle: string): void => checkCaught(`  red: ${name}`, caddyLogProblems(text, CADDY_PROXY_ABORT_LINE), needle);
  logRed('keeping the request headers ships the device id', plant(caddyfile, '\t\t\t\trequest>headers delete\n', ''), 'the X-Whim-Device value');
  logRed('keeping client_ip ships the client IP', plant(caddyfile, '\t\t\t\trequest>client_ip delete\n', ''), 'request.client_ip');
  logRed('a filter on a named logger misses the default one', plant(caddyfile, '\tlog default {', '\tlog proxy {'), 'no log for the default logger');
  logRed('a console-wrapped filter fails', plant(caddyfile, 'wrap json', 'wrap console'), 'does not wrap json');
}

/** Knobs for the stubs: `STUB_DOCKER_OK=1` answers docker with success (Docker already installed),
 *  `STUB_CURL_OK=1` lets a download succeed, `STUB_GPG_FINGERPRINT` is the fingerprint gpg reports. */
type VmStubEnv = Readonly<Partial<Record<'STUB_DOCKER_OK' | 'STUB_CURL_OK' | 'STUB_GPG_FINGERPRINT', string>>>;

/** Only stub binaries run: curl (or a refused key) stops bootstrap before disk or service operations. */
function runVmFixture(script: string, args: string[] = [], stubEnv: VmStubEnv = {}): { status: number | null; calls: string[][]; stderr: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whim-vm-commands-'));
  try {
    const log = path.join(dir, 'calls.jsonl');
    const stub = `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const tool = path.basename(process.argv[1]);
const args = process.argv.slice(2);
fs.appendFileSync(process.env.COMMAND_LOG, JSON.stringify([tool, ...args]) + '\\n');
if (tool === 'id') console.log('0');
if (tool === 'gpg') console.log(['fpr', '', '', '', '', '', '', '', '', process.env.STUB_GPG_FINGERPRINT, ''].join(':'));
if (tool === 'curl' && process.env.STUB_CURL_OK !== '1') process.exit(71);
if (tool === 'docker' && process.env.STUB_DOCKER_OK === '1') process.exit(0);
if (tool === 'docker' || args.includes('-L') || args.includes('-D')) process.exit(1);
`;
    for (const tool of ['modprobe', 'iptables', 'ip6tables', 'id', 'docker', 'apt-get', 'install', 'curl', 'gpg', 'systemctl']) {
      fs.writeFileSync(path.join(dir, tool), stub, { mode: 0o755 });
    }
    const file = path.join(dir, 'script.sh');
    fs.writeFileSync(file, script);
    const run = runFromPath('bash', [file, ...args], { encoding: 'utf8', timeout: 10_000, env: { PATH: `${dir}:/usr/bin:/bin`, COMMAND_LOG: log, ...stubEnv } });
    if (run.error) throw run.error;
    const calls = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').map((line) => JSON.parse(line) as string[]) : [];
    return { status: run.status, calls, stderr: run.stderr };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function firewallProblems(calls: string[][]): string[] {
  const problems: string[] = [];
  // eslint-disable-next-line sonarjs/no-hardcoded-ip -- security-policy destinations
  const dropped = ['169.254.169.254/32', '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '100.64.0.0/10', '169.254.0.0/16'];
  for (const [tool, chain, destinations] of [
    ['iptables', 'WHIM-EGRESS', dropped],
    // eslint-disable-next-line sonarjs/no-hardcoded-ip -- metadata service security-policy address
    ['ip6tables', 'WHIM-EGRESS6', ['fd00:ec2::254/128']],
  ] as const) {
    const commands = calls.filter((call) => call[0] === tool).map((call) => call.slice(2));
    const position = (...args: string[]): number => commands.findIndex((command) => JSON.stringify(command) === JSON.stringify(args));
    const flush = position('-F', chain);
    if (position('-N', chain) < 0 || flush < 0) problems.push(`${tool}: chain must be created and flushed`);
    const rules = commands.filter((command) => command[0] === '-A' && command[1] === chain);
    const subnet = calls.find((call) => call[0] === 'iptables' && call[2] === '-D')?.[5];
    const expectedRules = [
      ['-A', chain, '-m', 'conntrack', '--ctstate', 'ESTABLISHED,RELATED', '-j', 'RETURN'],
      ...(tool === 'iptables' ? [['-A', chain, '-d', subnet, '-j', 'RETURN']] : []),
      ...destinations.map((destination) => ['-A', chain, '-d', destination, '-j', 'DROP']),
      ...[['tcp', '443'], ['udp', '53'], ['tcp', '53']].map(([protocol, port]) => ['-A', chain, '-p', protocol, '--dport', port, '-j', 'RETURN']),
      ['-A', chain, '-j', 'DROP'],
    ];
    if (JSON.stringify(rules) !== JSON.stringify(expectedRules)) problems.push(`${tool}: rules allow unintended traffic or omit a required exception`);
    const flushes = commands.filter((command) => command[0] === '-F' && command[1] === chain);
    if (flushes.length !== 1 || commands.findIndex((command) => command[0] === '-A') <= flush) problems.push(`${tool}: rules must be installed after a single flush`);
    const jumps = commands.filter((command) => command[0] === '-I' && command[1] === 'DOCKER-USER');
    const expected = tool === 'iptables' ? ['-I', 'DOCKER-USER', '1', '-s', subnet, '-j', chain] : ['-I', 'DOCKER-USER', '1', '-i', 'br-+', '-j', chain];
    if (JSON.stringify(jumps) !== JSON.stringify([expected])) problems.push(`${tool}: missing or duplicate bridge jump`);
  }
  return problems;
}

function egressIpv6Tests(files: ReadonlyMap<string, string>): void {
  section('Deploy scripts: executed firewall rules');
  const egress = files.get('deploy/vm/whim-egress.sh') ?? '';
  const run = runVmFixture(egress);
  eq('firewall script succeeds against stubbed host commands', run.status, 0);
  checkClean('both families install ordered destination drops, HTTPS/DNS exceptions and a terminal drop', firewallProblems(run.calls));
}

function bootstrapDownloadTests(files: ReadonlyMap<string, string>): void {
  section('Deploy scripts: Docker signing-key download');
  const run = runVmFixture(files.get('deploy/vm/bootstrap.sh') ?? '', ['--region', 'test-region']);
  eq('bootstrap stops at the stubbed download before privileged writes', run.status, 71);
  const curl = run.calls.find((call) => call[0] === 'curl') ?? [];
  check('Docker signing key starts at HTTPS', curl.includes('https://download.docker.com/linux/debian/gpg'));
  for (const option of ['--proto', '--proto-redir']) {
    const index = curl.indexOf(option);
    check(`Docker signing key constrains ${option} to HTTPS`, index >= 0 && curl[index + 1] === '=https', JSON.stringify(curl));
  }
}

// ---------------------------------------------------------------------------------------------
// Container log age cap (legal-surface-v2 review H2): the policy deletes connection data and logs
// within 90 days, and compose.yaml rotates Docker's json-file logs by size only.

const DAY_MS = 86_400_000;
const LOG_AGE_CAP_UNIT = 'whim-log-age-cap';

/** One line as Docker's json-file driver writes it: `log`, `stream`, then `time` in RFC 3339 UTC
 *  with nanoseconds. */
function dockerLogLine(log: string, stream: 'stdout' | 'stderr', daysAgo: number): string {
  const time = new Date(Date.now() - daysAgo * DAY_MS).toISOString().replace(/Z$/, '417302Z');
  return `${JSON.stringify({ log, stream, time })}\n`;
}

/** A Caddy access-log entry and a pino server entry, the two containers' real line shapes. Pino's
 *  own `time` key sits escaped inside `log`. */
function caddyAccess(uri: string): string {
  return `${JSON.stringify({ level: 'info', ts: 1_758_700_000.25, logger: 'http.log.access', msg: 'handled request', request: { remote_ip: '198.51.100.23', proto: 'HTTP/2.0', method: 'POST', uri } })}\n`;
}

function pinoLine(msg: string): string {
  return `${JSON.stringify({ level: 30, time: 1_758_700_000_000, pid: 1, msg, req: { remoteAddress: '203.0.113.9' } })}\n`;
}

function writeAged(file: string, text: string, daysAgo: number): void {
  fs.writeFileSync(file, text);
  const at = new Date(Date.now() - daysAgo * DAY_MS);
  fs.utimesSync(file, at, at);
}

/** docker as the script sees it. Every call is logged. `inspect --format` fills each
 *  `{{ index .Config.Labels "KEY" }}` from the container's labels in STUB_DOCKER_LABELS, and fails
 *  for an unknown id (a removed container) or any other template. `compose` succeeds. */
const LOG_AGE_CAP_DOCKER_STUB = `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.DOCKER_LOG, JSON.stringify(args) + '\\n');
if (args[0] === 'inspect') {
  const labels = JSON.parse(process.env.STUB_DOCKER_LABELS)[args[args.length - 1]];
  if (labels === undefined) process.exit(1);
  const text = args[args.indexOf('--format') + 1].replace(/\\{\\{ index \\.Config\\.Labels "([^"]+)" \\}\\}/g, (_, key) => labels[key] ?? '');
  if (text.includes('{{')) process.exit(3);
  console.log(text);
}
`;

/** Each fixture container's compose labels, by id: c1 is caddy with old lines in its active log, c2's
 *  lines carry no readable time, c3 is the server with only recent lines. */
const LOG_AGE_CAP_LABELS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  c1: { 'com.docker.compose.project': 'whim', 'com.docker.compose.service': 'caddy' },
  c2: { 'com.docker.compose.project': 'whim', 'com.docker.compose.service': 'unreadable-times' },
  c3: { 'com.docker.compose.project': 'whim', 'com.docker.compose.service': 'whim-server' },
};

/** Why a recreate of each fixture service other than caddy is wrong. */
const WRONGLY_RECREATED: Readonly<Record<string, string>> = {
  'unreadable-times': 'a container whose log could not be parsed was recreated',
  'whim-server': 'a service whose log is under the cap was recreated',
};

interface LogAgeCapInputs {
  readonly script: string;
  /** The Ops Agent's include_paths, as absolute globs under /var/lib/docker/containers. */
  readonly tailed: readonly string[];
  /** deploy/lib.sh's WHIM_VM_APP_DIR: where the VM's compose.yaml and .env live. */
  readonly appDir: string;
  /** Adds c4, with old lines and no labels: not a compose service, so the run must fail over it. */
  readonly unlabeled?: boolean;
}

/** The files matching `globs`, re-rooted from /var/lib/docker/containers to `root`, as bash expands them. */
function tailedFiles(globs: readonly string[], root: string): Set<string> | string {
  const prefix = '/var/lib/docker/containers/';
  const outside = globs.find((glob) => !glob.startsWith(prefix));
  if (outside !== undefined) return `the Ops Agent tails ${outside}, outside the containers directory`;
  const matched = new Set<string>();
  for (const glob of globs) {
    const run = runFromPath('bash', ['-c', 'shopt -s nullglob; for f in $1; do printf "%s\\n" "$f"; done', 'glob', path.join(root, glob.slice(prefix.length))], { encoding: 'utf8' });
    for (const file of run.stdout.split('\n').filter((line) => line !== '')) matched.add(file);
  }
  return matched;
}

/** The stand-in containers directory, as written before the run. */
interface LogAgeCapFixture {
  readonly root: string;
  /** Each container's active log with its text and inode before the run. */
  readonly active: ReadonlyMap<string, { readonly text: string; readonly inode: number }>;
  readonly staleRotated: string;
  readonly mixedRotated: string;
  readonly mixedOld: string;
  readonly mixedRecent: string;
  readonly outside: readonly string[];
}

function writeLogAgeCapFixture(root: string, unlabeled: boolean): LogAgeCapFixture {
  for (const id of ['c1', 'c2', 'c3', ...(unlabeled ? ['c4'] : [])]) fs.mkdirSync(path.join(root, id), { recursive: true });
  const container = path.join(root, 'c1');
  const oldLines = [dockerLogLine(caddyAccess('/v1/generate'), 'stderr', 100), dockerLogLine(caddyAccess('/v1/clarify'), 'stderr', 100)];
  writeAged(path.join(container, 'c1-json.log'), [...oldLines, dockerLogLine(caddyAccess('/v1/clarify'), 'stderr', 0)].join(''), 0);
  writeAged(path.join(root, 'c2', 'c2-json.log'), '{"log":"old\\n","stream":"stdout","time":"sometime"}\n{"log":"cut short', 120);
  writeAged(path.join(root, 'c3', 'c3-json.log'), dockerLogLine(pinoLine('request completed'), 'stdout', 10) + dockerLogLine('listening on 8787\n', 'stdout', 0), 0);
  if (unlabeled) writeAged(path.join(root, 'c4', 'c4-json.log'), dockerLogLine(pinoLine('booted'), 'stdout', 100), 100);
  const activeLogs = fs.readdirSync(root).map((id) => path.join(root, id, `${id}-json.log`));
  const active = new Map(activeLogs.map((log) => [log, { text: fs.readFileSync(log, 'utf8'), inode: fs.statSync(log).ino }]));
  const staleRotated = path.join(container, 'c1-json.log.2');
  writeAged(staleRotated, dockerLogLine(pinoLine('booted'), 'stdout', 125) + dockerLogLine(pinoLine('drained'), 'stdout', 120), 120);
  const mixedRotated = path.join(container, 'c1-json.log.1');
  const mixedOld = dockerLogLine(caddyAccess('/v1/rewrite'), 'stderr', 95);
  const mixedRecent = dockerLogLine(caddyAccess('/v1/report'), 'stderr', 5);
  writeAged(mixedRotated, mixedOld + mixedRecent, 5);
  const outside = [path.join(container, 'config.v2.json'), path.join(root, 'stray-json.log.1')];
  for (const file of outside) writeAged(file, dockerLogLine('not a container log\n', 'stdout', 120), 120);
  return { root, active, staleRotated, mixedRotated, mixedOld, mixedRecent, outside };
}

/** Exactly caddy is recreated, once, with the VM's compose command, and the run says so. */
function logAgeCapRecreateProblems(dockerCalls: readonly string[][], stdout: string, appDir: string): string[] {
  const problems: string[] = [];
  const recreates = dockerCalls.filter((call) => call[0] === 'compose');
  const expected = ['compose', '--project-directory', appDir, '--file', `${appDir}/compose.yaml`, 'up', '-d', '--force-recreate', '--no-deps', 'caddy'];
  const caddy = recreates.filter((call) => call.at(-1) === 'caddy');
  if (!caddy.some((call) => call.includes('--force-recreate'))) problems.push('the over-cap service caddy was not recreated');
  if (caddy.length > 1) problems.push('caddy was recreated more than once');
  for (const call of caddy) if (JSON.stringify(call) !== JSON.stringify(expected)) problems.push(`the recreate is not \`docker ${expected.join(' ')}\`: docker ${call.join(' ')}`);
  for (const call of recreates.filter((other) => other.at(-1) !== 'caddy')) {
    problems.push(`${WRONGLY_RECREATED[call.at(-1) ?? ''] ?? 'an unknown service was recreated'}: ${call.at(-1) ?? ''}`);
  }
  if (!stdout.includes('recreated service caddy')) problems.push(`the run does not report the recreate: ${stdout}`);
  return problems;
}

/** Active logs untouched; rotated ones trimmed or deleted, never a file the Ops Agent tails. */
function logAgeCapFileProblems(fixture: LogAgeCapFixture, tailed: readonly string[]): string[] {
  const { root, mixedRotated } = fixture;
  const problems: string[] = [];
  for (const [log, was] of fixture.active) {
    const now = fs.existsSync(log) ? { text: fs.readFileSync(log, 'utf8'), inode: fs.statSync(log).ino } : undefined;
    if (now?.text !== was.text || now.inode !== was.inode) problems.push(`an active log was deleted or changed in place: ${path.relative(root, log)}`);
  }
  if (fs.existsSync(fixture.staleRotated)) problems.push('a rotated log last written 120 days ago survived');
  const mixedText = fs.existsSync(mixedRotated) ? fs.readFileSync(mixedRotated, 'utf8') : '';
  if (mixedText.includes(fixture.mixedOld)) problems.push('a rotated log still holds a line older than the cap');
  if (mixedText !== fixture.mixedRecent) problems.push('a rotated log lost its recent line');
  for (const other of fixture.outside) if (!fs.existsSync(other)) problems.push(`${path.relative(root, other)}, outside the log glob, was deleted`);
  const tailedNow = tailedFiles(tailed, root);
  if (typeof tailedNow === 'string') problems.push(tailedNow);
  else if (mixedText !== fixture.mixedOld + fixture.mixedRecent && tailedNow.has(mixedRotated)) problems.push(`the Ops Agent tails a file trimmed in place: ${path.relative(root, mixedRotated)}`);
  return problems;
}

/** Runs the script against a stand-in for /var/lib/docker/containers with a stubbed docker on PATH,
 *  and reports every way the result breaks the age cap or touches what it must not. */
function logAgeCapRunProblems({ script, tailed, appDir, unlabeled = false }: LogAgeCapInputs): string[] {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whim-log-age-cap-'));
  try {
    const fixture = writeLogAgeCapFixture(path.join(dir, 'containers'), unlabeled);
    const bin = path.join(dir, 'bin');
    fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin, 'docker'), LOG_AGE_CAP_DOCKER_STUB, { mode: 0o755 });
    const dockerLog = path.join(dir, 'docker.jsonl');
    const file = path.join(dir, 'log-age-cap.sh');
    fs.writeFileSync(file, script);
    const run = runFromPath('bash', [file], {
      encoding: 'utf8',
      timeout: 10_000,
      env: { PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}`, LOG_AGE_CAP_ROOT: fixture.root, DOCKER_LOG: dockerLog, STUB_DOCKER_LABELS: JSON.stringify(LOG_AGE_CAP_LABELS) },
    });
    if (run.error) throw run.error;
    const dockerCalls = fs.existsSync(dockerLog) ? fs.readFileSync(dockerLog, 'utf8').trim().split('\n').map((line) => JSON.parse(line) as string[]) : [];
    const problems = [...logAgeCapRecreateProblems(dockerCalls, run.stdout, appDir), ...logAgeCapFileProblems(fixture, tailed)];
    if (unlabeled && (run.status !== 1 || !run.stderr.includes('c4'))) problems.push(`an over-cap container outside the compose project did not fail the run naming it (exit ${run.status}): ${run.stderr}`);
    if (!unlabeled && run.status !== 0) problems.push(`the script exited ${run.status}: ${run.stderr}`);
    return problems;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** The cap plus the timer's period is the longest a line lives; it must fit the published maximum. */
function logAgeCapLimitProblems(script: string, timer: string, publishedDays: number): string[] {
  const cap = Number(/^readonly MAX_AGE_DAYS=(\d+)$/m.exec(script)?.[1] ?? Number.NaN);
  const daily = /^OnCalendar=daily$/m.test(timer);
  const problems: string[] = [];
  if (!daily) problems.push('the timer does not run daily');
  if (!/^Persistent=true$/m.test(timer)) problems.push('the timer does not catch up runs missed while the VM was down');
  if (!Number.isInteger(cap) || cap < 1) problems.push('the script declares no MAX_AGE_DAYS');
  else if (cap + 1 > publishedDays) problems.push(`MAX_AGE_DAYS ${cap} plus the one-day timer period exceeds the published ${publishedDays} days`);
  return problems;
}

/** Runs bootstrap's install step against stubbed install/systemctl and checks the installed units. */
function logAgeCapInstallProblems(bootstrap: string, service: string): string[] {
  const problems: string[] = [];
  if (!/^install_log_age_cap$/m.test(bootstrap)) problems.push('bootstrap never calls install_log_age_cap');
  const step = /^install_log_age_cap\(\) \{\n[\s\S]*?\n\}$/m.exec(bootstrap)?.[0];
  if (!step) return [...problems, 'bootstrap defines no install_log_age_cap'];
  const vm = path.join(ROOT, 'deploy', 'vm');
  const run = runVmFixture(`set -euo pipefail\nhere='${vm}'\n${step}\ninstall_log_age_cap\n`);
  if (run.status !== 0) problems.push(`the install step exited ${run.status}`);
  const installed = new Map(run.calls.filter((call) => call[0] === 'install').map((call) => [call[call.length - 2], call[call.length - 1]]));
  const execStart = /^ExecStart=(\S+)$/m.exec(service)?.[1];
  if (!execStart || installed.get(path.join(vm, 'log-age-cap.sh')) !== execStart) problems.push('the service does not start the installed script');
  for (const unit of [`${LOG_AGE_CAP_UNIT}.service`, `${LOG_AGE_CAP_UNIT}.timer`]) {
    if (installed.get(path.join(vm, unit)) !== `/etc/systemd/system/${unit}`) problems.push(`${unit} is not installed`);
  }
  const systemctl = run.calls.filter((call) => call[0] === 'systemctl').map((call) => call.slice(1).join(' '));
  const reload = systemctl.indexOf('daemon-reload');
  const enable = systemctl.indexOf(`enable --now ${LOG_AGE_CAP_UNIT}.timer`);
  if (enable < 0) problems.push('the timer is not enabled and started');
  else if (reload < 0 || reload > enable) problems.push('systemd is not reloaded before the timer is enabled');
  return problems;
}

function logAgeCapTests(files: ReadonlyMap<string, string>): void {
  section('Deploy scripts: container log age cap');
  const script = files.get('deploy/vm/log-age-cap.sh') ?? '';
  const timer = files.get(`deploy/vm/${LOG_AGE_CAP_UNIT}.timer`) ?? '';
  const service = files.get(`deploy/vm/${LOG_AGE_CAP_UNIT}.service`) ?? '';
  const bootstrap = files.get('deploy/vm/bootstrap.sh') ?? '';
  const published = keepLimit(MANIFESTS[latestVersion()], 'connection-logs');
  check('the live manifest publishes a maximum for connection logs, counted from collection', published?.after === 'collection' && published.days > 0, JSON.stringify(published));
  const publishedDays = published?.days ?? 0;
  checkClean('the cap plus the daily timer fits the manifest\'s connection-logs maximum', logAgeCapLimitProblems(script, timer, publishedDays));
  checkCaught('  red: a cap of 91 days fails', logAgeCapLimitProblems(plant(script, 'MAX_AGE_DAYS=89', 'MAX_AGE_DAYS=91'), timer, publishedDays), 'exceeds the published');
  checkCaught('  red: a cap of 90 days fails (the timer adds up to a day)', logAgeCapLimitProblems(plant(script, 'MAX_AGE_DAYS=89', 'MAX_AGE_DAYS=90'), timer, publishedDays), 'exceeds the published');
  checkCaught('  red: a weekly timer fails', logAgeCapLimitProblems(script, plant(timer, 'OnCalendar=daily', 'OnCalendar=weekly'), publishedDays), 'does not run daily');

  const tailed = yamlList(yamlChild(yamlChild(yamlChild(yamlEntries((files.get('deploy/vm/ops-agent.yaml') ?? '').split('\n')), 'logging'), 'receivers'), 'docker').get('include_paths'));
  const appDir = /^readonly WHIM_VM_APP_DIR=(\S+)$/m.exec(files.get('deploy/lib.sh') ?? '')?.[1] ?? '';
  const capRun = (text: string, overrides: Partial<LogAgeCapInputs> = {}): string[] => logAgeCapRunProblems({ script: text, tailed, appDir, ...overrides });
  checkClean(
    'an active log with old lines gets exactly its compose service recreated and is never edited; under-cap and unparseable containers stay; rotated logs are trimmed or deleted',
    capRun(script),
  );
  checkClean('an over-cap container that is no compose service fails the run, naming it, and the rest is still capped', capRun(script, { unlabeled: true }));
  const activeLoop = 'for log in "$CONTAINERS_ROOT"/*/*-json.log; do\n  if [[ -f "$log" ]] && [[ ! -L "$log" ]]; then\n    mark_over_cap "$log"';
  checkCaught(
    '  red: trimming the active log in place (the truncate-and-append variant) fails',
    capRun(plant(script, activeLoop, activeLoop.replace('mark_over_cap', 'prune_old_lines'))),
    'an active log was deleted or changed in place: c1/c1-json.log',
  );
  const regardless = capRun(plant(script, '  [[ "$drop" -gt 0 ]] || return 0\n  id=', '  id='));
  checkCaught('  red: recreating every service, whatever its log holds, fails', regardless, 'a service whose log is under the cap was recreated');
  checkCaught('  ... and names the container whose log could not be parsed', regardless, 'a container whose log could not be parsed was recreated');
  checkCaught(
    '  red: deleting stale active logs whole by their mtime fails',
    capRun(plant(script, "-name '*-json.log.[0-9]*'", "-name '*-json.log*'")),
    'an active log was deleted or changed in place: c2/c2-json.log',
  );
  const rotatedLoop = 'for log in "$CONTAINERS_ROOT"/*/*-json.log.[0-9]*; do\n  if [[ -f "$log" ]] && [[ ! -L "$log" ]]; then\n    prune_old_lines "$log"\n  fi\ndone\n';
  checkCaught('  red: judging rotated logs by their mtime alone fails', capRun(plant(script, rotatedLoop, '')), 'a rotated log still holds a line older than the cap');
  checkCaught('  red: an Ops Agent that also tails rotated logs fails the in-place trim', capRun(script, { tailed: [`${DOCKER_JSON_LOGS}*`] }), 'the Ops Agent tails a file trimmed in place');
  checkCaught('  red: a recreate outside the VM\'s compose project directory fails', capRun(script, { appDir: '/srv/whim' }), 'the recreate is not');

  const missing = runFromPath('bash', [path.join(ROOT, 'deploy/vm/log-age-cap.sh')], { encoding: 'utf8', env: { PATH: process.env.PATH, LOG_AGE_CAP_ROOT: path.join(os.tmpdir(), 'whim-no-such-containers-root') } });
  eq('the script succeeds when the containers directory does not exist', missing.status, 0);

  checkClean('bootstrap installs the script, the service and the daily timer, and enables the timer', logAgeCapInstallProblems(bootstrap, service));
  checkCaught('  red: bootstrap without the install step fails', logAgeCapInstallProblems(plant(bootstrap, 'install_egress_firewall\ninstall_log_age_cap\n', 'install_egress_firewall\n'), service), 'never calls install_log_age_cap');
  checkCaught('  red: an install step that never enables the timer fails', logAgeCapInstallProblems(plant(bootstrap, `  systemctl enable --now ${LOG_AGE_CAP_UNIT}.timer\n`, ''), service), 'the timer is not enabled');
}

const OPS_AGENT_KEY_URL = 'https://packages.cloud.google.com/apt/doc/apt-key.gpg';

/** A key whose fingerprint is not Google's signer: bootstrap stops before the apt source, the
 *  package or any service is touched. */
function bootstrapOpsAgentKeyTests(files: ReadonlyMap<string, string>): void {
  section('Deploy scripts: Ops Agent signing key');
  const forged = 'F'.repeat(40);
  const run = runVmFixture(files.get('deploy/vm/bootstrap.sh') ?? '', ['--region', 'test-region'], {
    STUB_DOCKER_OK: '1',
    STUB_CURL_OK: '1',
    STUB_GPG_FINGERPRINT: forged,
  });
  eq('bootstrap refuses an Ops Agent key with another fingerprint', run.status, 1);
  check('  ... naming the fingerprint it got', run.stderr.includes(`Ops Agent apt key has fingerprint '${forged}'`), run.stderr);
  const touched = run.calls.filter((call) => call[0] === 'apt-get' || call[0] === 'systemctl' || call.some((arg) => arg.includes('google-cloud-ops-agent/config.yaml')));
  check('  ... before installing the agent, its config or restarting a service', touched.length === 0, JSON.stringify(touched));
  const curl = run.calls.find((call) => call[0] === 'curl' && call.includes(OPS_AGENT_KEY_URL)) ?? [];
  check('Ops Agent signing key starts at HTTPS', curl.length > 0, JSON.stringify(run.calls));
  for (const option of ['--proto', '--proto-redir']) {
    const index = curl.indexOf(option);
    check(`Ops Agent signing key constrains ${option} to HTTPS`, index >= 0 && curl[index + 1] === '=https', JSON.stringify(curl));
  }
}

// ---------------------------------------------------------------------------------------------
// Log shipping (developer-observability D8): deploy/vm/ops-agent.yaml, read with the compose-subset
// parser above. Its level regex and severity map run over the server's real pino lines, the way
// fluent-bit applies them to the `log` field of a Docker json-file record.

const DOCKER_JSON_LOGS = '/var/lib/docker/containers/*/*-json.log';

/** A one-level YAML flow map (`{a: b, "c": d}`), possibly continued on more-indented lines. */
function yamlFlowMap(entry: YamlEntry | undefined): Map<string, string> {
  const text = [entry?.inline ?? '', ...(entry?.body ?? []).map((line) => line.trim())].join(' ').trim();
  if (!text.startsWith('{') || !text.endsWith('}')) throw new Error(`not a flow map: ${text.slice(0, 40)}`);
  return new Map(
    text
      .slice(1, -1)
      .split(',')
      .map((pair) => pair.trim())
      .filter((pair) => pair !== '')
      .map((pair): [string, string] => {
        const colon = pair.indexOf(':');
        return [unquote(pair.slice(0, colon).trim()), unquote(pair.slice(colon + 1).trim())];
      }),
  );
}

/** What the config does with one Docker `log` field: the severity it assigns, or undefined. */
type SeverityOf = (logField: string) => string | undefined;

function agentSeverity(processors: ReadonlyMap<string, YamlEntry>, order: readonly string[]): SeverityOf {
  const regexName = order.find((name) => {
    const processor = yamlChild(processors, name);
    return yamlScalar(processor, 'type') === 'parse_regex' && yamlScalar(processor, 'field') === 'log';
  });
  if (!regexName) throw new Error('no parse_regex processor on the log field');
  const severityName = order.find((name) => yamlChild(yamlChild(processors, name), 'fields').has('severity'));
  if (!severityName) throw new Error('no processor sets severity');
  const severity = yamlChild(yamlChild(yamlChild(processors, severityName), 'fields'), 'severity');
  const group = /^jsonPayload\.(\w+)$/.exec(yamlScalar(severity, 'move_from'))?.[1];
  if (!group) throw new Error(`severity is not moved from a captured field: ${yamlScalar(severity, 'move_from')}`);
  // fluent-bit's regex engine (Onigmo, Ruby syntax) anchors ^ and $ at line boundaries: the `m` flag.
  const regex = new RegExp(yamlScalar(yamlChild(processors, regexName), 'regex'), 'm');
  const values = yamlFlowMap(severity.get('map_values'));
  return (logField) => {
    const groups = regex.exec(logField)?.groups ?? {};
    // After the regex, the JSON parser merges the line's own fields into the same payload.
    const payload: Record<string, unknown> = { ...groups, ...(JSON.parse(groups.log ?? logField) as Record<string, unknown>) };
    const value = payload[group];
    // map_values compiles to a Lua string comparison: pino's number 30 never matches "30".
    return typeof value === 'string' ? values.get(value) : undefined;
  };
}

function composeLoggingProblems(composeText: string, label: string): string[] {
  const services = yamlChild(yamlEntries(composeText.split('\n')), 'services');
  return [...services.keys()].flatMap((name) => {
    const logging = yamlChild(yamlChild(services, name), 'logging');
    const driver = yamlScalar(logging, 'driver');
    const labels = yamlScalar(yamlChild(logging, 'options'), 'labels');
    return [
      ...(driver === 'json-file' ? [] : [`${name} logs with ${driver || 'the default driver'}, not json-file, so the agent's receiver and docker compose logs miss it`]),
      ...(labels === label ? [] : [`${name} logging options label ${JSON.stringify(labels)}, not ${label}, which the agent copies into labels.compose_service`]),
    ];
  });
}

/** The agent ships every container's json-file log with pino's severity, and nothing from the host. */
function opsAgentProblems(configText: string, composeText: string, pinoLines: readonly string[]): string[] {
  try {
    const logging = yamlChild(yamlEntries(configText.split('\n')), 'logging');
    const metrics = yamlChild(yamlEntries(configText.split('\n')), 'metrics');
    const receiver = yamlChild(yamlChild(logging, 'receivers'), 'docker');
    const pipelines = yamlChild(yamlChild(logging, 'service'), 'pipelines');
    const docker = yamlChild(pipelines, 'docker');
    const order = yamlList(docker.get('processors'));
    const processors = yamlChild(logging, 'processors');
    const problems: string[] = [];
    if (yamlScalar(receiver, 'type') !== 'files' || !sameList(yamlList(receiver.get('include_paths')), [DOCKER_JSON_LOGS])) {
      problems.push(`the docker receiver's include_paths are not exactly Docker's json-file logs (${DOCKER_JSON_LOGS})`);
    }
    if (!sameList(yamlList(docker.get('receivers')), ['docker'])) problems.push('the docker pipeline does not read the docker receiver');
    for (const name of order) if (!processors.has(name)) problems.push(`the docker pipeline names an undefined processor ${name}`);
    for (const [where, defaults] of [['logging', pipelines], ['metrics', yamlChild(yamlChild(metrics, 'service'), 'pipelines')]] as const) {
      const receivers = yamlFlowMap(defaults.get('default_pipeline')).get('receivers');
      if (receivers !== '[]') problems.push(`the ${where} default_pipeline is not off (receivers ${receivers ?? 'unset'}), so the agent ships host data`);
    }
    const severityOf = agentSeverity(processors, order);
    for (const line of pinoLines) {
      const pino = JSON.parse(line) as { level: number; severity?: string };
      const shipped = severityOf(line);
      if (shipped === undefined || shipped !== pino.severity) {
        problems.push(`the agent maps pino level ${pino.level} to ${shipped ?? 'no severity'}, but the line says ${pino.severity ?? 'nothing'}`);
      }
    }
    const fields = yamlChild(yamlChild(processors, order.find((name) => yamlChild(yamlChild(processors, name), 'fields').has('severity')) ?? ''), 'fields');
    const label = /^jsonPayload\.attrs\."([^"]+)"$/.exec(yamlScalar(yamlChild(fields, 'labels.compose_service'), 'copy_from'))?.[1];
    if (!label) problems.push('labels.compose_service is not copied from a Docker log label');
    return [...problems, ...composeLoggingProblems(composeText, label ?? '(none)')];
  } catch (error) {
    return [`ops-agent.yaml does not parse: ${(error as Error).message}`];
  }
}

/** One line per pino level, from the server's own logger — the lines the agent will read. */
function realPinoLines(): string[] {
  const lines: string[] = [];
  const logger = createServerLogger({
    level: 'trace',
    destination: {
      write(line: string): void {
        lines.push(line);
      },
    },
  });
  for (const level of ['trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const) logger[level]({ status: 500 }, 'shipping probe');
  return lines;
}

/** A real Caddy 2.11.4 admin line (`caddy reload` inside the container), which names its caller's
 *  address at the top level. */
const CADDY_ADMIN_LINE = JSON.stringify({
  level: 'info',
  ts: 1790258832.973255,
  logger: 'admin.api',
  msg: 'received request',
  method: 'POST',
  host: 'localhost:2019',
  uri: '/load',
  remote_ip: CADDY_CLIENT_IP,
  remote_port: '55190',
  headers: { 'Content-Type': ['application/json'], 'User-Agent': ['Go-http-client/1.1'] },
});

/** A value at a filter path: `jsonPayload.a.b` or `jsonPayload.attrs."dotted.key"`. */
function atFilterPath(payload: Readonly<Record<string, unknown>>, fieldPath: string): unknown {
  const segments = fieldPath.match(/"[^"]*"|[^.]+/g) ?? [];
  if (segments.shift() !== 'jsonPayload') throw new Error(`setup: filter path ${fieldPath} is not under jsonPayload`);
  return segments.map(unquote).reduce<unknown>((at, key) => (at !== null && typeof at === 'object' ? (at as Record<string, unknown>)[key] : undefined), payload);
}

/** The agent's filter language, in the one form the config's omissions use: `path =~ "regex"`
 *  terms joined by OR (a regex on a missing or non-string field never matches). Any other form
 *  throws, so a new one gets a case here instead of passing unread. */
function agentFilterMatches(filter: string, payload: Readonly<Record<string, unknown>>): boolean {
  return filter.split(' OR ').some((term) => {
    const match = /^(\S+) =~ "([^"]*)"$/.exec(term);
    if (!match) throw new Error(`setup: agent filter term ${term} is not understood`);
    const value = atFilterPath(payload, match[1]!);
    return typeof value === 'string' && new RegExp(match[2]!).test(value);
  });
}

/** The payload the agent ships for one container line: the line's JSON after every in-place
 *  omission (`X: {move_from: X, omit_if: …}`) of the pipeline's modify_fields processors, in order.
 *  Omissions are the only part emulated; the severity and labels are `agentSeverity`'s. */
function agentShippedPayload(configText: string, line: string): Record<string, unknown> {
  const logging = yamlChild(yamlEntries(configText.split('\n')), 'logging');
  const processors = yamlChild(logging, 'processors');
  const order = yamlList(yamlChild(yamlChild(yamlChild(logging, 'service'), 'pipelines'), 'docker').get('processors'));
  const payload = JSON.parse(line) as Record<string, unknown>;
  for (const name of order) {
    const processor = yamlChild(processors, name);
    if (yamlScalar(processor, 'type') !== 'modify_fields') continue;
    const omitted = [...yamlChild(processor, 'fields')].filter(([field, entry]) => {
      const options = yamlEntries(entry.body);
      return field.startsWith('jsonPayload.') && yamlScalar(options, 'move_from') === field && options.has('omit_if') && agentFilterMatches(yamlScalar(options, 'omit_if'), payload);
    });
    for (const [field] of omitted) {
      const keys = field.split('.').slice(1);
      if (keys.length !== 1) throw new Error(`setup: omitting the nested field ${field} is not emulated`);
      delete payload[keys[0]!];
    }
  }
  return payload;
}

/** No Caddy line reaches Cloud Logging with the device id or a client address, even if Caddy's
 *  own filter were gone: the agent's omissions run over the unfiltered real lines. */
function opsAgentClientDataProblems(configText: string): string[] {
  try {
    return [CADDY_PROXY_ABORT_LINE, CADDY_ADMIN_LINE].flatMap((line) => {
      const shipped = agentShippedPayload(configText, line);
      const { msg } = JSON.parse(line) as { msg: string };
      return [
        ...(shipped.msg === msg ? [] : [`the agent drops the "${msg}" line's message`]),
        ...(shipped.request === undefined ? [] : [`the agent ships the "${msg}" line's request object`]),
        ...['remote_ip', 'client_ip'].filter((name) => name in shipped).map((name) => `the agent ships the "${msg}" line's ${name}`),
        ...clientDataLeaks(shipped).map((leak) => `the agent ships ${leak} from the "${msg}" line`),
      ];
    });
  } catch (error) {
    return [`ops-agent.yaml does not parse: ${(error as Error).message}`];
  }
}

function logShippingTests(files: ReadonlyMap<string, string>): void {
  section('Deploy artifacts: log shipping (Ops Agent)');
  const config = files.get('deploy/vm/ops-agent.yaml') ?? '';
  const compose = files.get('deploy/compose.yaml') ?? '';
  const lines = realPinoLines();
  check('deploy/vm/ops-agent.yaml is present', config !== '');
  eq('the probe produced one pino line per level', lines.length, 6);
  checkClean('the agent tails the json-file logs, maps every pino level to the severity the line carries, ships no host data, and both services keep json-file with the service label', opsAgentProblems(config, compose, lines));
  const red = (name: string, configText: string, composeText: string, needle: string): void => checkCaught(`  red: ${name}`, opsAgentProblems(configText, composeText, lines), needle);
  red('mapping pino 50 to WARNING fails', plant(config, '"50": ERROR', '"50": WARNING'), compose, 'maps pino level 50 to WARNING');
  red('mapping from pino\'s numeric level field fails', plant(config, 'move_from: jsonPayload.level_text', 'move_from: jsonPayload.level'), compose, 'maps pino level 50 to no severity');
  red('a severity map without pino 30 fails', plant(config, '"30": INFO, ', ''), compose, 'maps pino level 30 to no severity');
  red('shipping the host syslog fails', plant(config, 'default_pipeline: {receivers: []}', 'default_pipeline: {receivers: [syslog]}'), compose, 'logging default_pipeline is not off');
  red('tailing another path fails', plant(config, DOCKER_JSON_LOGS, '/var/log/syslog'), compose, 'include_paths');
  red('a server on the gcplogs driver fails', config, plant(compose, 'driver: json-file', 'driver: gcplogs'), 'whim-server logs with gcplogs');
  red('a server without the service label fails', config, plant(compose, '        labels: com.docker.compose.service\n', ''), 'whim-server logging options label');

  checkClean("the agent drops a real Caddy line's request object and client address before shipping, keeping the line", opsAgentClientDataProblems(config));
  const dropRed = (name: string, configText: string, needle: string): void => checkCaught(`  red: ${name}`, opsAgentClientDataProblems(configText), needle);
  dropRed('a pipeline without the drop ships the device id', plant(config, ', severity_and_labels, client_data]', ', severity_and_labels]'), 'the X-Whim-Device value');
  const requestDrop = config.slice(config.indexOf('        jsonPayload.request:\n'), config.indexOf('        jsonPayload.remote_ip:\n'));
  dropRed('dropping only the top-level addresses ships the request', plant(config, requestDrop, ''), 'request object');
  dropRed('keeping a top-level remote_ip ships it', plant(config, "          omit_if: 'jsonPayload.remote_ip =~ \".\"'\n", ''), 'line\'s remote_ip');
}

function scanTests(files: ReadonlyMap<string, string>, serverSources: ReadonlyMap<string, string>): void {
  section('Deploy artifacts: secrets, sandbox, hostnames');
  checkClean('no deploy file sets a secret-named variable to a value or holds a key-shaped value', secretProblems(files));
  checkCaught('  red: a filled server.env.example fails', secretProblems(withFile(files, 'deploy/server.env.example', 'OPENROUTER_API_KEY=abc\n')), 'deploy/server.env.example:1 sets secret-named OPENROUTER_API_KEY');
  checkCaught('  red: a secret-named value in ops-agent.yaml still fails', secretProblems(withFile(files, 'deploy/vm/ops-agent.yaml', `${files.get('deploy/vm/ops-agent.yaml') ?? ''}api_key: abc\n`)), 'sets secret-named api_key');
  checkCaught('  red: time_key outside ops-agent.yaml still fails', secretProblems(withFile(files, 'deploy/cloudbuild.yaml', 'time_key: abc\n')), 'deploy/cloudbuild.yaml:1 sets secret-named time_key');
  checkClean('no deploy artifact disables the Chromium sandbox', sandboxFlagProblems(files));
  checkCaught('  red: --no-sandbox in the Dockerfile fails', sandboxFlagProblems(withFile(files, 'deploy/Dockerfile', 'CMD ["chromium", "--no-sandbox"]\n')), 'deploy/Dockerfile disables');
  const apexDomain = apexDomainOf(Object.fromEntries(envEntries(files.get('deploy/defaults.env') ?? '')).WHIM_WEB_HOST ?? '');
  checkClean('server/src names no public hostname; deploy files name none outside deploy/defaults.env', hostnameProblems(serverSources, files, apexDomain));
  checkCaught('  red: a hostname in server code fails naming the file', hostnameProblems(withFile(serverSources, 'server/src/app.ts', `const host = 'api.${apexDomain}';`), files, apexDomain), 'server/src/app.ts names a public hostname');
  checkClean('the production Dockerfile, cloudbuild, compose, deploy and resize files never reference the load test', loadtestProblems(files));
  checkCaught('  red: a loadtest reference in compose.yaml fails', loadtestProblems(withFile(files, 'deploy/compose.yaml', `${files.get('deploy/compose.yaml') ?? ''}# loadtest\n`)), 'deploy/compose.yaml references the load test');
  checkClean('no deploy file writes association file content', associationWriteProblems(files));
  checkCaught('  red: a script writing assetlinks.json fails', associationWriteProblems(withFile(files, 'deploy/deploy.sh', 'echo "[]" > "$site/.well-known/assetlinks.json"\n')), 'writes into a .well-known path');
  checkClean('no deploy file sets a retention variable', retentionProblems(files));
  checkClean('no script creates a secret version, passes key data or creates a static address', keySettingProblems(files));
  checkCaught('  red: adding a secret version fails', keySettingProblems(withFile(files, 'deploy/provision.sh', 'gcloud secrets versions add whim-openrouter-api-key\n')), 'versions add');
}

function valuesTests(files: ReadonlyMap<string, string>): void {
  section('Deploy artifacts: deploy-time values');
  const defaults = Object.fromEntries(envEntries(files.get('deploy/defaults.env') ?? ''));
  const accepted = deployValueKeys();
  check('default keys are accepted deployment inputs', Object.keys(defaults).every((key) => accepted.has(key)));
  withSandbox((sandbox) => {
    const result = runFromPath('bash', ['-c', 'source "$1"; whim_load_values; whim_require_host_values; for key in $WHIM_VALUE_KEYS; do printf "%s=%s\\n" "$key" "${!key}"; done', 'values-test', path.join(sandbox.repo, 'deploy/lib.sh')], {
      encoding: 'utf8', env: { PATH: process.env.PATH, HOME: sandbox.home },
    });
    eq('defaults load and meet host requirements', result.status, 0);
    const loaded = Object.fromEntries(envEntries(result.stdout));
    for (const [key, value] of Object.entries(defaults)) eq(`default ${key} propagates through the loader`, loaded[key], value);
  });
  eq('deploy/defaults.env WHIM_API_HOST is "api." + WHIM_WEB_HOST', defaults.WHIM_API_HOST, `api.${defaults.WHIM_WEB_HOST}`);
}

function profileTests(files: ReadonlyMap<string, string>): void {
  section('Deploy artifacts: capacity profiles');
  const readKeys = keysReadByLoadServerConfig();
  check('loadServerConfig is observed reading WHIM_MAX_CONCURRENT_GENERATIONS (the key recorder works)', readKeys.has('WHIM_MAX_CONCURRENT_GENERATIONS') && readKeys.has('WHIM_SYNTHRUN_CONCURRENCY'));
  const profiles = new Map([...files].filter(([rel]) => rel.startsWith('deploy/profiles/') && rel.endsWith('.env')).map(([rel, text]) => [path.basename(rel, '.env'), text]));
  check('deploy/profiles holds standard and event', profiles.has('standard') && profiles.has('event'), [...profiles.keys()].join(', '));
  for (const [name, text] of profiles) {
    checkClean(`profile ${name}: allowed keys only, loads through loadServerConfig, synthrun concurrency within vCPUs and the generation cap`, profileProblems(name, text, readKeys));
  }
  const machineTypes = [...profiles.values()].map((text) => Object.fromEntries(envEntries(text)).WHIM_PROFILE_MACHINE_TYPE);
  eq('profile machine types are unique', new Set(machineTypes).size, machineTypes.length);
  const eventText = profiles.get('event') ?? '';
  checkCaught('  red: a retention variable in a profile fails', profileProblems('event', `${eventText}WHIM_REPORT_RETENTION_DAYS=30\n`, readKeys), 'WHIM_REPORT_RETENTION_DAYS');
  checkCaught('  red: a minimum build in a profile fails', profileProblems('event', `${eventText}WHIM_MIN_BUILD_IOS=382000\n`, readKeys), 'sets WHIM_MIN_BUILD_IOS, which no profile may set');
  checkCaught('  red: a usage idle period in a profile fails', profileProblems('event', `${eventText}WHIM_USAGE_IDLE_DAYS=30\n`, readKeys), 'sets WHIM_USAGE_IDLE_DAYS, which no profile may set');
}

function scriptSyntaxTests(files: ReadonlyMap<string, string>): void {
  section('Deploy scripts: syntax');
  const scripts = [...files.keys()].filter((rel) => rel.endsWith('.sh'));
  check('deploy/ holds the provision, deploy, smoke, resize and VM scripts', ['deploy/provision.sh', 'deploy/deploy.sh', 'deploy/smoke.sh', 'deploy/resize.sh', 'deploy/vm/bootstrap.sh', 'deploy/vm/whim-egress.sh'].every((rel) => scripts.includes(rel)), scripts.join(', '));
  for (const rel of scripts) {
    const result = runFromPath('bash', ['-n', path.join(ROOT, rel)], { encoding: 'utf8' });
    check(`bash -n ${rel}`, result.status === 0, result.stderr);
    check(`${rel} sets -euo pipefail`, (files.get(rel) ?? '').includes('\nset -euo pipefail\n'));
  }
}

/** Every `deploy/*.sh` path the runbook names (specs/server-deployment "The runbook matches the scripts"). */
function runbookScriptPaths(text: string): string[] {
  return [...new Set(text.match(/deploy\/[A-Za-z0-9_./-]+\.sh/g) ?? [])];
}

/** Every `WHIM_*` name the runbook names, however it's formatted (backticked or in a code fence). */
function runbookVariables(text: string): string[] {
  return [...new Set(text.match(/WHIM_[A-Z0-9_]+/g) ?? [])];
}

function deployValueKeys(): Set<string> {
  const result = runFromPath('bash', ['-c', 'source deploy/lib.sh; printf "%s" "$WHIM_VALUE_KEYS"'], { cwd: ROOT, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr);
  return new Set(result.stdout.trim().split(/\s+/));
}

function runbookTests(): void {
  section('Runbook: accepted configuration and executable paths');
  const text = readRepoFile('docs/deploy.md');
  const accepted = new Set([...deployValueKeys(), ...keysReadByLoadServerConfig(), ...Object.keys(releaseConfig)]);
  const problems = (content: string): string[] => [
    ...runbookVariables(content).filter((name) => !accepted.has(name)).map((name) => `unaccepted: ${name}`),
    ...runbookScriptPaths(content).filter((rel) => {
      const result = runFromPath('bash', ['-n', path.join(ROOT, rel)], { encoding: 'utf8' });
      return result.status !== 0;
    }).map((rel) => `invalid script: ${rel}`),
  ];
  checkClean('documented variables belong to accepted contracts and scripts pass bash -n', problems(text));
  checkCaught('red: a nonexistent runbook script fails', problems(`${text}\n deploy/missing-script.sh`), 'invalid script:');
}

export async function runDeployConfigTests(): Promise<void> {
  await runWebSiteTests();

  const files = deployFiles();
  const serverSources = readFiles(listFilesUnder('server/src'));
  const playwrightVersion = lockfileVersion('playwright');
  const defaults = loadServerConfig({});
  const defaultHealth = await realHealthBody({ WHIM_COMMIT: HEALTH_COMMIT });
  const health: HealthBodies = {
    defaults: defaultHealth,
    androidRaised: await realHealthBody({ WHIM_COMMIT: HEALTH_COMMIT, WHIM_MIN_BUILD_ANDROID: '382000' }),
    preGate: withoutMinBuild(defaultHealth),
    unbuilt: await realHealthBody({}),
  };
  const egressSubnet = /^readonly SUBNET=(\S+)$/m.exec(files.get('deploy/vm/whim-egress.sh') ?? '')?.[1] ?? '(none)';
  const composeContext: ComposeContext = {
    playwrightVersion,
    minStopGraceMs: defaults.drainTimeoutMs + 30_000,
    egressSubnet,
    imageUid: imageUidOf(files.get('deploy/Dockerfile') ?? ''),
    seccompFiles: fs.readdirSync(path.join(ROOT, 'deploy', 'seccomp')),
  };
  const maxBodyBytes = Math.max(defaults.maxBodyBytesUnary, defaults.maxBodyBytesGenerate, defaults.maxBodyBytesReport);
  const siteFiles = fs.readdirSync(path.join(ROOT, 'deploy', 'site'), { recursive: true, encoding: 'utf8' });

  imageTests(files, playwrightVersion);
  composeTests(files, composeContext);
  caddyTests(files, maxBodyBytes, siteFiles);
  egressIpv6Tests(files);
  bootstrapDownloadTests(files);
  bootstrapOpsAgentKeyTests(files);
  logShippingTests(files);
  logAgeCapTests(files);
  scanTests(files, serverSources);
  valuesTests(files);
  profileTests(files);
  scriptSyntaxTests(files);
  deployPreflightTests();
  deploySecretTests();
  deploySiteOnlyTests();
  deployFullTests(health);
  smokeTests(health);
  await smokeBetaTests();
  resizeTests();
  loadtestStartTests();
  loadtestDriveTests();
  provisionTests();
  provisionMonitoringTests();
  monitoringPolicyShapeTests();
  await alertFilterTests();
  await runLoadTestTests();
  runbookTests();
}
