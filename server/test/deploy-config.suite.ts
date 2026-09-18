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
import { check, eq, section } from './harness';
import { runWebSiteTests } from './web-site.suite';
import { runLoadTestTests } from './loadtest.suite';
import { loadServerConfig } from '../src/config';
import * as releaseConfig from '../../src/host/launcher/release-config';

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
        if (SECRET_NAME.test(name) && isLiteralValue(value)) {
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
const RUNTIME_CMD = ['node', '--enable-source-maps', 'server/main.mjs'];

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
  if (!text.includes('playwright install --with-deps --only-shell chromium')) {
    problems.push('the image does not install Chromium with --only-shell');
  }
  return problems;
}

function cmdOf(stage: readonly DockerInstruction[]): unknown {
  const raw = stage.filter((i) => i.keyword === 'CMD').at(-1)?.args ?? '';
  try {
    return JSON.parse(raw);
  } catch (error) {
    return `unparseable CMD ${raw} (${(error as Error).message})`;
  }
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
  if (JSON.stringify(cmdOf(stage)) !== JSON.stringify(RUNTIME_CMD)) problems.push(`CMD is ${JSON.stringify(cmdOf(stage))}`);
  const exposed = stage.filter((i) => i.keyword === 'EXPOSE').map((i) => i.args).join(' ');
  if (exposed !== '8787') problems.push(`EXPOSE is ${exposed || 'unset'}, expected only 8787`);
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
const PAGES_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'";
const ASSOCIATION_ROUTES = ['/.well-known/apple-app-site-association', '/.well-known/assetlinks.json'];
const PAGE_ROUTES: ReadonlyArray<readonly [string, string]> = [
  ['/privacy', 'privacy.html'],
  ['/support', 'support.html'],
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

function pagesRouteProblems(site: readonly CaddyNode[], siteFiles: readonly string[]): string[] {
  const problems: string[] = [];
  const handles = new Map(site.filter((node) => directiveOf(node) === 'handle').map((node) => [node.tokens.slice(1).join(' '), node]));
  const expected = [...ASSOCIATION_ROUTES, ...PAGE_ROUTES.map(([route]) => route)];
  if (!sameList([...handles.keys()], expected)) {
    problems.push(`the pages routes are [${[...handles.keys()].map((route) => route || '(catch-all)').join(', ')}], not the D21 route table`);
  }
  for (const route of ASSOCIATION_ROUTES) {
    const lines = childLines(handles.get(route));
    if (!lines.includes('header Content-Type application/json')) problems.push(`${route} is not served with Content-Type: application/json`);
    if (!lines.includes('file_server') || lines.some((line) => line.startsWith('rewrite'))) problems.push(`${route} is not served straight from the published file`);
  }
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

function caddyfileProblems(text: string, maxBodyBytes: number, siteFiles: readonly string[]): string[] {
  let sites: CaddyNode[];
  try {
    sites = parseCaddyfile(text);
  } catch (error) {
    return [(error as Error).message];
  }
  const addresses = sites.map(lineOf);
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

function hostnameProblems(serverSources: ReadonlyMap<string, string>, deploy: ReadonlyMap<string, string>): string[] {
  const problems: string[] = [];
  for (const [rel, text] of serverSources) {
    if (text.includes('anycognition.ca') || text.includes('sslip.io')) problems.push(`${rel} names a public hostname`);
  }
  for (const [rel, text] of deploy) {
    if (text.includes('sslip.io')) problems.push(`${rel} names sslip.io`);
    const hostnameIsConfig = rel === 'deploy/defaults.env' || rel.startsWith('deploy/site/');
    if (!hostnameIsConfig && text.includes('anycognition.ca')) problems.push(`${rel} names a hostname outside deploy/defaults.env`);
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

function keySettingProblems(files: ReadonlyMap<string, string>): string[] {
  return [...files].flatMap(([rel, text]) => KEY_SETTING_COMMANDS.filter((command) => text.includes(command)).map((command) => `${rel} runs ${command}`));
}

function requiredLineProblems(rel: string, text: string, required: readonly string[]): string[] {
  const lines = new Set(text.split('\n').map((line) => line.trim()));
  return required.filter((line) => !lines.has(line)).map((line) => `${rel} lacks ${line}`);
}

function cloudbuildProblems(text: string): string[] {
  const problems: string[] = [];
  for (const needle of ['--platform=linux/amd64', '--file=deploy/Dockerfile', '-docker.pkg.dev/$PROJECT_ID/whim/server:$COMMIT_SHA', '_REGION: northamerica-northeast1']) {
    if (!text.includes(needle)) problems.push(`cloudbuild.yaml lacks ${needle}`);
  }
  for (const forbidden of ['secretEnv', 'availableSecrets', '--build-arg']) {
    if (text.includes(forbidden)) problems.push(`cloudbuild.yaml uses ${forbidden}`);
  }
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

function isForbiddenProfileKey(key: string): boolean {
  return PROFILE_FORBIDDEN_NAMES.has(key) || key.startsWith('WHIM_LIMIT_') || key.includes('RETENTION') || SECRET_NAME.test(key);
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
  '  "node server/site.mjs "*)',
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

function withSandbox(body: (sandbox: Sandbox) => void): void {
  const sandbox = makeSandbox();
  try {
    body(sandbox);
  } finally {
    fs.rmSync(sandbox.dir, { recursive: true, force: true });
  }
}

function writeOperatorFile(sandbox: Sandbox): void {
  fs.mkdirSync(path.join(sandbox.home, '.config', 'whim'), { recursive: true });
  fs.writeFileSync(
    path.join(sandbox.home, '.config', 'whim', 'deploy.env'),
    'WHIM_SUPPORT_EMAIL=ops@example.test\nWHIM_ENGINEER_MODEL=vendor/engineer-1\nWHIM_REWRITE_MODEL=vendor/rewrite-1\n',
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
  [`*https://${WEB_HOST}/support`, 0, `200|${HTML}|`, '<html>'],
  [`*https://${WEB_HOST}/a/x`, 0, `200|${HTML}|`, '<html>'],
  [`*https://${WEB_HOST}/nope`, 0, `404|${HTML}|`, '<html>'],
  [`*https://${WEB_HOST}/.well-known/*`, 0, '404|application/json|', ''],
];
const API_UP: readonly StubRule[] = [
  [`*https://${API_HOST}/healthz`, 0, '200|application/json|', '{"ok":true,"service":"whim-server"}'],
  [`*https://${API_HOST}/v1/generate`, 0, '400|application/json|', '{}'],
  [`*https://${API_HOST}/healthz/sse`, 0, ': whim-healthz-probe\\n\\n'],
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
    writeOperatorFile(sandbox);
    const run = runScript(sandbox, 'deploy.sh', [], { STUB_NODE_VERSION: '24.1.0' });
    check('deploy.sh refuses Node 24, naming the Node 22 requirement', run.status === 1 && run.stderr.includes('Node 24.1.0') && run.stderr.includes('Node 22'), run.stderr);
    eq('  ... before any gcloud call', toolLog(sandbox, 'gcloud'), []);
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
    const curls = toolLog(sandbox, 'curl');
    check('  ... then running the pages smoke checks only', curls.some((line) => line.includes(`${WEB_HOST}/privacy`)) && curls.every((line) => !line.includes(API_HOST)), curls.join(' / '));
  });
}

function fullDeployRules(sandbox: Sandbox, imageExists: boolean): void {
  writeRules(sandbox, 'gcloud', [...SECRET_READABLE, ['*artifacts docker images describe*', imageExists ? 0 : 1, ''], ...VM_ANSWERS]);
  writeRules(sandbox, 'dig', DNS_READY);
  writeRules(sandbox, 'curl', [...API_UP, ...PAGES_UP]);
}

function headOf(sandbox: Sandbox): string {
  return runFromPath('git', ['rev-parse', 'HEAD'], { cwd: sandbox.repo, encoding: 'utf8' }).stdout.trim();
}

function deployFullTests(): void {
  section('Deploy scripts: deploy.sh full deploy and rollback');
  withSandbox((sandbox) => {
    writeOperatorFile(sandbox);
    fullDeployRules(sandbox, false);
    fs.writeFileSync(path.join(sandbox.stubs, 'machine-type'), 'e2-standard-8');
    const run = runScript(sandbox, 'deploy.sh', []);
    const calls = toolLog(sandbox, 'gcloud');
    const head = headOf(sandbox);
    eq('a full deploy on an e2-standard-8 VM succeeds', run.status, 0);
    check('  ... reading the key before Cloud Build builds HEAD', indexOfCall(calls, 'secrets versions access') !== -1 && indexOfCall(calls, 'secrets versions access') < indexOfCall(calls, `builds submit`) && calls.some((line) => line.includes(`COMMIT_SHA=${head}`)), calls.join(' / '));
    eq('  ... writing the event profile\'s server limits and the model ids to config.env', stubFile(sandbox, 'upload/config.env').split('\n').filter((line) => line !== ''), [
      'WHIM_MAX_CONCURRENT_GENERATIONS=15',
      'WHIM_SYNTHRUN_CONCURRENCY=6',
      'WHIM_MAX_CONCURRENT_UNARY=32',
      'WHIM_ENGINEER_MODEL=vendor/engineer-1',
      'WHIM_REWRITE_MODEL=vendor/rewrite-1',
    ]);
    eq('  ... and the image, hosts and event container sizes to the compose .env', stubFile(sandbox, 'upload/compose.env').split('\n').filter((line) => line !== ''), [
      `WHIM_IMAGE=northamerica-northeast1-docker.pkg.dev/anycognition-whim/whim/server:${head}`,
      `WHIM_API_HOST=${API_HOST}`,
      `WHIM_WEB_HOST=${WEB_HOST}`,
      'WHIM_PROFILE=event',
      'WHIM_SERVER_MEM_LIMIT=16g',
      'WHIM_SERVER_SHM_SIZE=3gb',
    ]);
    eq('  ... piping the key to /etc/whim/server.env over stdin', stubFile(sandbox, 'server-env-stdin'), `OPENROUTER_API_KEY=${FAKE_KEY}\n`);
    check('  ... never printing it, passing it as an argument or uploading it', ![run.stdout, run.stderr, ...calls, stubFile(sandbox, 'upload/config.env'), stubFile(sandbox, 'upload/compose.env')].some((text) => text.includes(FAKE_KEY)));
    check('  ... restarting through compose and running the full smoke', calls.some((line) => line.includes('up -d --wait')) && toolLog(sandbox, 'curl').some((line) => line.includes(`${API_HOST}/healthz/sse`)));
  });

  withSandbox((sandbox) => {
    writeOperatorFile(sandbox);
    fullDeployRules(sandbox, true);
    const run = runScript(sandbox, 'deploy.sh', ['--tag', TAG]);
    const calls = toolLog(sandbox, 'gcloud');
    const ssh = calls.filter((line) => line.includes('compute ssh'));
    eq('a rollback to a pushed tag succeeds', run.status, 0);
    check('  ... without building', indexOfCall(calls, 'builds submit') === -1, calls.join(' / '));
    check('  ... deploying that tag with the standard profile', stubFile(sandbox, 'upload/compose.env').includes(`server:${TAG}\n`) && stubFile(sandbox, 'upload/compose.env').includes('WHIM_PROFILE=standard') && stubFile(sandbox, 'upload/config.env') === 'WHIM_ENGINEER_MODEL=vendor/engineer-1\nWHIM_REWRITE_MODEL=vendor/rewrite-1\n');
    check(
      '  ... and never building or publishing the site: no local site build, no site publish call over ssh',
      !fs.existsSync(path.join(sandbox.stubs, 'upload', 'site')) && ssh.every((line) => !/mv -T|releases\//.test(line)),
      ssh.join(' / '),
    );
  });

  // Discriminating red-check: a rollback that republished the site (as it did before this fix) must
  // be caught by the assertion above, not pass silently.
  withSandbox((sandbox) => {
    writeOperatorFile(sandbox);
    fullDeployRules(sandbox, true);
    const deployScript = path.join(sandbox.repo, 'deploy', 'deploy.sh');
    const guarded = '  if [ "$rollback" -eq 1 ]; then\n    echo "==> rollback: the site is untouched (deploy/deploy.sh --site-only republishes it separately if needed)"\n  else\n    publish="$(remote_publish_site "$remote" "$release")"\n  fi';
    fs.writeFileSync(deployScript, plant(fs.readFileSync(deployScript, 'utf8'), guarded, '  publish="$(remote_publish_site "$remote" "$release")"'));
    git(sandbox.repo, sandbox.home, ['add', '-A']);
    git(sandbox.repo, sandbox.home, ['commit', '-q', '-m', 'red: plant the unconditional site publish back onto rollback']);
    git(sandbox.repo, sandbox.home, ['push', '-q', 'origin', 'HEAD:refs/heads/main']);
    const run = runScript(sandbox, 'deploy.sh', ['--tag', TAG]);
    const ssh = toolLog(sandbox, 'gcloud').filter((line) => line.includes('compute ssh'));
    check('red: a rollback that republishes the site is caught', run.status === 0 && ssh.some((line) => /mv -T|releases\//.test(line)), ssh.join(' / '));
  });
}

function smokeTests(): void {
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

    const oldLib = path.join(sandbox.dir, 'old-lib.sh');
    const libText = readRepoFile('deploy/lib.sh');
    const sleepCalls = libText.match(/sleep "\$sleep_for"/g) ?? [];
    eq('the old-sleep mutant replaces exactly one real sleep', sleepCalls.length, 1);
    const oldText = libText.replace('sleep "$sleep_for"', 'sleep 5');
    fs.writeFileSync(oldLib, oldText);
    const oldStarted = Date.now();
    const oldResult = runFromPath('bash', ['-x', '-c', `source '${oldLib}'; whim_wait_for_ssh old 2 1`], {
      cwd: sandbox.repo,
      encoding: 'utf8',
      timeout: 8_000,
      env: {
        PATH: `${sandbox.bin}${path.delimiter}${process.env.PATH ?? ''}`,
        STUB_DIR: sandbox.stubs, STUB_REAL_NODE: process.execPath, STUB_READINESS_FAILS: '999',
        WHIM_SCRIPT: 'resize.sh', WHIM_GCP_PROJECT: 'project', WHIM_GCP_ZONE: 'zone', WHIM_VM_NAME: 'vm',
      },
    });
    const oldElapsed = Date.now() - oldStarted;
    const oldCalls = toolLog(sandbox, 'gcloud').slice(boundedCalls.length);
    check('the executed old sleep overshoots the same 2-second deadline', oldResult.status === 1
      && oldElapsed >= 4_500
      && oldResult.stderr.includes('step old readiness failed')
      && oldCalls.some((line) => line.includes('IAP 4003'))
      && oldResult.stderr.split('\n').includes('+ sleep 5'), `${oldResult.stdout}\n${oldResult.stderr}\n${oldCalls.join('\n')}\nelapsed=${oldElapsed}ms`);
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

  withSandbox((sandbox) => {
    writeOperatorFile(sandbox);
    loadtestVmStubs(sandbox);
    const script = path.join(sandbox.repo, 'deploy', 'loadtest', 'run.sh');
    const old = fs.readFileSync(script, 'utf8');
    fs.writeFileSync(script, old.replace("${WHIM_COMPOSE#sudo -H }", '$WHIM_COMPOSE'));
    git(sandbox.repo, sandbox.home, ['add', '-A']);
    git(sandbox.repo, sandbox.home, ['commit', '-q', '-m', 'red nested sudo']);
    const run = runScript(sandbox, 'loadtest/run.sh', ['start']);
    const docker = toolLog(sandbox, 'docker');
    check('the old nested-sudo command fails with a missing replay image and restores production', run.status === 1 && run.stderr.includes('missing WHIM_LOADTEST_IMAGE') && run.stderr.includes('load-test compose start failed') && docker.some((line) => line.startsWith('compose --project-directory /opt/whim --file /opt/whim/compose.yaml up')), run.stderr);
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

  withSandbox((sandbox) => {
    writeDriveStubs(sandbox);
    const script = path.join(sandbox.repo, 'deploy', 'loadtest', 'run.sh');
    const text = fs.readFileSync(script, 'utf8');
    eq('the single-PID cleanup mutant replaces exactly one process-group kill', text.match(/kill -TERM -- "-\$sampler_pid"/g)?.length ?? 0, 1);
    fs.writeFileSync(script, text.replace('kill -TERM -- "-$sampler_pid"', 'kill "$sampler_pid"'));

    let samplerPid = 0;
    try {
      const run = runScript(sandbox, 'loadtest/run.sh', ['drive', '--devices', '2', '--cap', '2']);
      samplerPid = Number(stubFile(sandbox, 'sampler-pid'));
      const stats = stubFile(sandbox, 'driver-stats');
      const firstHeartbeat = Number(stubFile(sandbox, 'sampler-heartbeat'));
      pause(250);
      const laterHeartbeat = Number(stubFile(sandbox, 'sampler-heartbeat'));
      check('red: killing only the wrapper leaves the real sampler running', run.status === 0
        && samplerPid > 0
        && processIsAlive(samplerPid)
        && laterHeartbeat > firstHeartbeat
        && stubFile(sandbox, 'driver-stats-receipt') === stats
        && !fs.existsSync(stats), `${run.stdout}\n${run.stderr}\nsampler=${samplerPid} heartbeat=${firstHeartbeat}->${laterHeartbeat} stats=${stats}`);
    } finally {
      if (samplerPid === 0) samplerPid = Number(stubFile(sandbox, 'sampler-pid'));
      if (samplerPid > 0) stopTestProcess(samplerPid);
    }
  });
}

function provisionTests(): void {
  section('Deploy scripts: provision.sh');
  withSandbox((sandbox) => {
    const run = runScript(sandbox, 'provision.sh', ['--profile', 'huge']);
    check('provision.sh refuses an unknown profile with no gcloud call', run.status === 1 && run.stderr.includes('no profile named huge') && toolLog(sandbox, 'gcloud').length === 0, run.stderr);
  });

  withSandbox((sandbox) => {
    writeRules(sandbox, 'gcloud', [['*compute addresses list*', 0, '']]);
    const run = runScript(sandbox, 'provision.sh', []);
    const calls = toolLog(sandbox, 'gcloud');
    check('provision.sh fails when no reserved address holds WHIM_STATIC_IP, naming it', run.status === 1 && run.stderr.includes(`no reserved address in northamerica-northeast1 holds ${STATIC_IP}`), run.stderr);
    check('  ... having created or enabled nothing', calls.length === 1 && calls.every((line) => !/create|enable|add-iam-policy-binding/.test(line)), calls.join(' / '));
  });
}

// ---------------------------------------------------------------------------------------------

function imageTests(files: ReadonlyMap<string, string>, playwrightVersion: string): void {
  section('Deploy artifacts: image');
  const dockerfile = files.get('deploy/Dockerfile') ?? '';
  checkClean('the Dockerfile pins every base by digest, pins Playwright to the lockfile, runs non-root and copies no env file', dockerfileProblems(dockerfile, playwrightVersion));
  checkCaught('  red: a Playwright pin that differs from the lockfile fails', dockerfileProblems(dockerfile.replaceAll(`playwright@${playwrightVersion}`, 'playwright@1.0.0'), playwrightVersion), 'playwright@1.0.0');
  checkCaught('  red: a root final user fails', dockerfileProblems(plant(dockerfile, 'USER 10001:10001', 'USER root'), playwrightVersion), 'not a fixed non-root uid');
  checkCaught('  red: an unpinned base image fails', dockerfileProblems(plant(dockerfile, 'bookworm-slim@sha256:', 'bookworm-slim-unpinned@x'), playwrightVersion), 'not pinned by digest');
  checkCaught('  red: copying an env file fails', dockerfileProblems(plant(dockerfile, 'WORKDIR /app', 'WORKDIR /app\nCOPY --from=build /src/.env ./'), playwrightVersion), 'copies an env file');
  checkCaught('  red: a secret-named ENV with a value fails', dockerfileProblems(plant(dockerfile, 'USER 10001:10001', 'ENV OPENROUTER_API_KEY=abc\nUSER 10001:10001'), playwrightVersion), 'OPENROUTER_API_KEY');
  checkClean('.dockerignore keeps env files, credentials, VCS data and node_modules out of the build context', requiredLineProblems('.dockerignore', files.get('.dockerignore') ?? '', ['.git', '**/node_modules', '**/.env', '**/.env.*', '**/*.env']));
  checkClean('.gcloudignore honours .gitignore and keeps env files out of the upload', requiredLineProblems('.gcloudignore', files.get('.gcloudignore') ?? '', ['#!include:.gitignore', '.git', '**/node_modules', '**/.env']));
  checkClean('cloudbuild.yaml builds linux/amd64 tagged with the commit SHA, with a pinned builder and no secret', cloudbuildProblems(files.get('deploy/cloudbuild.yaml') ?? ''));
  checkCaught('  red: a build-time secret fails', cloudbuildProblems(`${files.get('deploy/cloudbuild.yaml') ?? ''}availableSecrets: {}\n`), 'availableSecrets');
}

function composeTests(files: ReadonlyMap<string, string>, ctx: ComposeContext): void {
  section('Deploy artifacts: compose');
  const compose = files.get('deploy/compose.yaml') ?? '';
  checkClean('compose.yaml runs the server hardened (cap_drop ALL, cap_add exactly SYS_CHROOT, seccomp, no-new-privileges, non-root, no published port) behind a digest-pinned Caddy', composeProblems(compose, ctx));
  const capAdd = '    cap_add:\n      - SYS_CHROOT\n';
  checkCaught('  red: cap_add [SYS_ADMIN] fails', composeProblems(plant(compose, capAdd, '    cap_add: [SYS_ADMIN]\n'), ctx), 'cap_add is [SYS_ADMIN]');
  checkCaught('  red: an extra capability beside SYS_CHROOT fails', composeProblems(plant(compose, capAdd, `${capAdd}      - NET_ADMIN\n`), ctx), 'expected exactly [SYS_CHROOT]');
  checkCaught('  red: a cap_drop that is not exactly [ALL] fails', composeProblems(plant(compose, '      - ALL\n', '      - NET_RAW\n'), ctx), 'cap_drop is [NET_RAW]');
  checkCaught('  red: a missing seccomp line fails', composeProblems(plant(compose, `      - seccomp=/opt/whim/seccomp/chromium-playwright-${ctx.playwrightVersion}.json\n`, ''), ctx), 'security_opt');
  checkCaught('  red: a missing no-new-privileges fails', composeProblems(plant(compose, '      - no-new-privileges:true\n', ''), ctx), 'security_opt');
  checkCaught('  red: a root user fails', composeProblems(plant(compose, 'user: "10001:10001"', 'user: "0:0"'), ctx), 'whim-server user');
  checkCaught('  red: a published server port fails', composeProblems(plant(compose, '    init: true\n', '    init: true\n    ports:\n      - "8787:8787"\n'), ctx), 'whim-server sets ports');
  checkCaught('  red: a stop_grace_period under the drain window fails', composeProblems(plant(compose, 'stop_grace_period: 11m', 'stop_grace_period: 10m'), ctx), 'stop_grace_period 10m');
  checkCaught('  red: an interpolation without :? fails', composeProblems(plant(compose, '${WHIM_IMAGE:?}', '${WHIM_IMAGE}'), ctx), 'without the ${NAME:?} form');
  checkCaught('  red: an unpinned Caddy image fails', composeProblems(plant(compose, 'caddy:2.11.4@sha256:', 'caddy:2@latest-'), ctx), 'caddy image is not pinned');
}

function caddyTests(files: ReadonlyMap<string, string>, maxBodyBytes: number, siteFiles: readonly string[]): void {
  section('Deploy artifacts: Caddyfile');
  const caddyfile = files.get('deploy/Caddyfile') ?? '';
  checkClean('the API site proxies with flush_interval -1, no encode, no log and no file serving; the pages site serves exactly the D21 route table', caddyfileProblems(caddyfile, maxBodyBytes, siteFiles));
  const red = (name: string, text: string, needle: string): void => checkCaught(`  red: ${name}`, caddyfileProblems(text, maxBodyBytes, siteFiles), needle);
  red('dropping flush_interval -1 fails', plant(caddyfile, '\t\tflush_interval -1\n', ''), 'flush_interval -1');
  red('encode on the API site fails', plant(caddyfile, '\treverse_proxy whim-server:8787 {', '\tencode gzip\n\treverse_proxy whim-server:8787 {'), 'the API site uses encode');
  red('file serving on the API site fails', plant(caddyfile, '\treverse_proxy whim-server:8787 {', '\tfile_server\n\treverse_proxy whim-server:8787 {'), 'the API site uses file_server');
  red('a request body cap under the server\'s fails', plant(caddyfile, 'max_size 2MB', 'max_size 64KB'), 'max_size 64KB');
  red('reverse_proxy on the pages site fails', plant(caddyfile, '\troot * /srv/site/current\n', '\troot * /srv/site/current\n\treverse_proxy whim-server:8787\n'), 'the pages site uses reverse_proxy');
  red('a log on the pages site fails', plant(caddyfile, '\troot * /srv/site/current\n', '\troot * /srv/site/current\n\tlog\n'), 'the pages site uses log');
  red('a missing JSON Content-Type on assetlinks fails', plant(caddyfile, 'handle /.well-known/assetlinks.json {\n\t\theader Content-Type application/json\n', 'handle /.well-known/assetlinks.json {\n'), '/.well-known/assetlinks.json is not served with Content-Type');
  red('a hand-written association response fails', plant(caddyfile, '\troot * /srv/site/current\n', '\troot * /srv/site/current\n\trespond /.well-known/assetlinks.json "[]" 200\n'), 'the pages site uses respond');
  red('a file_server that can redirect fails', plant(caddyfile, '\t\t\tstatus 404\n\t\t\tdisable_canonical_uris\n', '\t\t\tstatus 404\n'), 'lacks disable_canonical_uris');
  red('a missing catch-all 404 fails', plant(caddyfile, '\t\t\tstatus 404\n', ''), 'does not answer 404');
}

/** Only stub binaries run: curl stops bootstrap before disk or service operations. */
function runVmFixture(script: string, args: string[] = []): { status: number | null; calls: string[][] } {
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
if (tool === 'curl') process.exit(71);
if (tool === 'docker' || args.includes('-L') || args.includes('-D')) process.exit(1);
`;
    for (const tool of ['modprobe', 'iptables', 'ip6tables', 'id', 'docker', 'apt-get', 'install', 'curl']) {
      fs.writeFileSync(path.join(dir, tool), stub, { mode: 0o755 });
    }
    const file = path.join(dir, 'script.sh');
    fs.writeFileSync(file, script);
    const run = runFromPath('bash', [file, ...args], { encoding: 'utf8', timeout: 10_000, env: { PATH: `${dir}:/usr/bin:/bin`, COMMAND_LOG: log } });
    if (run.error) throw run.error;
    const calls = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').map((line) => JSON.parse(line) as string[]) : [];
    return { status: run.status, calls };
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
  const mutants = [
    plant(egress, 'ipt6 -A "$CHAIN6" -d "$destination" -j DROP', 'ipt6 -A "$CHAIN6" -d "$destination" -j RETURN'),
    plant(egress, 'ipt6 -A "$CHAIN6" -d "$destination" -j DROP', ':'),
    plant(egress, 'ipt6 -A "$CHAIN6" -j DROP', 'ipt6 -A "$CHAIN6" -j RETURN'),
    plant(egress, 'ipt6 -F "$CHAIN6"', 'ipt6 -F "$CHAIN6"\nipt6 -A "$CHAIN6" -j RETURN'),
  ];
  for (const [index, mutant] of mutants.entries()) {
    const weakened = runVmFixture(mutant);
    eq(`mutant ${index} runs successfully`, weakened.status, 0);
    check(`red: weakened IPv6 rules ${index} are rejected`, firewallProblems(weakened.calls).length > 0);
  }
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

function scanTests(files: ReadonlyMap<string, string>, serverSources: ReadonlyMap<string, string>): void {
  section('Deploy artifacts: secrets, sandbox, hostnames');
  checkClean('no deploy file sets a secret-named variable to a value or holds a key-shaped value', secretProblems(files));
  checkCaught('  red: a filled server.env.example fails', secretProblems(withFile(files, 'deploy/server.env.example', 'OPENROUTER_API_KEY=abc\n')), 'deploy/server.env.example:1 sets secret-named OPENROUTER_API_KEY');
  checkCaught('  red: a key-shaped value in a script fails', secretProblems(withFile(files, 'deploy/deploy.sh', `printf '${FAKE_KEY}'\n`)), 'key-shaped value');
  checkClean('no deploy artifact disables the Chromium sandbox', sandboxFlagProblems(files));
  checkCaught('  red: --no-sandbox in the Dockerfile fails', sandboxFlagProblems(withFile(files, 'deploy/Dockerfile', 'CMD ["chromium", "--no-sandbox"]\n')), 'deploy/Dockerfile disables');
  checkClean('server/src names no public hostname; deploy files name none outside deploy/defaults.env and never sslip.io', hostnameProblems(serverSources, files));
  checkCaught('  red: a hostname in server code fails naming the file', hostnameProblems(withFile(serverSources, 'server/src/app.ts', "const host = 'api.34-118-191-193.sslip.io';"), files), 'server/src/app.ts names a public hostname');
  checkCaught('  red: a hostname in the Caddyfile fails', hostnameProblems(serverSources, withFile(files, 'deploy/Caddyfile', 'api.whim.anycognition.ca {\n}\n')), 'deploy/Caddyfile names a hostname');
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
  eq('deploy/operator.env.example lists the operator value names only', envEntries(files.get('deploy/operator.env.example') ?? ''), [
    ['WHIM_SUPPORT_EMAIL', ''],
    ['WHIM_ENGINEER_MODEL', ''],
    ['WHIM_REWRITE_MODEL', ''],
    ['WHIM_APP_STORE_URL', ''],
    ['WHIM_PLAY_STORE_URL', ''],
  ]);
  eq('deploy/server.env.example lists the key name only', envEntries(files.get('deploy/server.env.example') ?? ''), [['OPENROUTER_API_KEY', '']]);
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
  checkCaught('  red: an event.env setting WHIM_LIMIT_GENERATIONS_PER_DAY fails', profileProblems('event', `${eventText}WHIM_LIMIT_GENERATIONS_PER_DAY=500\n`, readKeys), 'WHIM_LIMIT_GENERATIONS_PER_DAY, which no profile may set');
  checkCaught('  red: a retention variable in a profile fails', profileProblems('event', `${eventText}WHIM_REPORT_RETENTION_DAYS=30\n`, readKeys), 'WHIM_REPORT_RETENTION_DAYS');
  checkCaught('  red: more synthetic runs than vCPUs fails', profileProblems('event', eventText.replace(/^WHIM_SYNTHRUN_CONCURRENCY=.*$/m, 'WHIM_SYNTHRUN_CONCURRENCY=999').replace(/^WHIM_MAX_CONCURRENT_GENERATIONS=.*$/m, 'WHIM_MAX_CONCURRENT_GENERATIONS=1000'), readKeys), 'vCPU count');
  checkCaught('  red: an unknown key fails', profileProblems('event', `${eventText}WHIM_TURBO=1\n`, readKeys), 'WHIM_TURBO, neither');
  check('deploy.sh has no --profile option', !(files.get('deploy/deploy.sh') ?? '').includes('--profile'));
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
  checkCaught('red: a comment-only variable is not an accepted input', problems(`${text}\n WHIM_GHOST_VARIABLE_NOBODY_READS`), 'unaccepted:');
}

export async function runDeployConfigTests(): Promise<void> {
  await runWebSiteTests();

  const files = deployFiles();
  const serverSources = readFiles(listFilesUnder('server/src'));
  const playwrightVersion = lockfileVersion('playwright');
  const defaults = loadServerConfig({});
  const egressSubnet = /^readonly SUBNET=(\S+)$/m.exec(files.get('deploy/vm/whim-egress.sh') ?? '')?.[1] ?? '(none)';
  const composeContext: ComposeContext = {
    playwrightVersion,
    minStopGraceMs: defaults.drainTimeoutMs + 30_000,
    egressSubnet,
    imageUid: imageUidOf(files.get('deploy/Dockerfile') ?? ''),
    seccompFiles: fs.readdirSync(path.join(ROOT, 'deploy', 'seccomp')),
  };
  const maxBodyBytes = Math.max(defaults.maxBodyBytesUnary, defaults.maxBodyBytesGenerate, defaults.maxBodyBytesReport);
  const siteFiles = fs.readdirSync(path.join(ROOT, 'deploy', 'site'));

  imageTests(files, playwrightVersion);
  composeTests(files, composeContext);
  caddyTests(files, maxBodyBytes, siteFiles);
  egressIpv6Tests(files);
  bootstrapDownloadTests(files);
  scanTests(files, serverSources);
  valuesTests(files);
  profileTests(files);
  scriptSyntaxTests(files);
  deployPreflightTests();
  deploySecretTests();
  deploySiteOnlyTests();
  deployFullTests();
  smokeTests();
  resizeTests();
  loadtestStartTests();
  loadtestDriveTests();
  provisionTests();
  await runLoadTestTests();
  runbookTests();
}
