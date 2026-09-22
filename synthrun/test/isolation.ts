/**
 * Synthetic-run isolation acceptance (public-generation-server tasks 7.3–7.4): the OS sandbox, the
 * no-egress layers, and the builder's file-read boundary. Spec §Chromium runs with its OS sandbox
 * enabled, §A synthetic run has no network egress, §The candidate build reads nothing from disk but
 * the runtime shim.
 *
 * Every blocking assertion here has a control beside it that removes the blocking layer and shows
 * the same probe reaching the canary, so a zero is a measurement rather than a broken canary.
 * The per-layer browsers are built from `browserLaunchOptions()` itself, minus everything but the
 * layer under test, so they test the production values.
 *
 * Called from `acceptance.ts` with that suite's own `test`/`ok` helpers.
 */
import nodeAssert from 'node:assert';
import { recordAssertion, test } from './harness';
import { execFileSync } from 'node:child_process';
import dgram from 'node:dgram';
import fs from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { build as esbuild } from 'esbuild';
import { chromium, type Browser, type BrowserContext, type LaunchOptions, type Page } from 'playwright';
import ts from 'typescript';
import { buildCandidateSource, CANDIDATE_RESOLVE_REFUSED } from '../builder';
import { BLOCKED_EGRESS_CAP, type EgressBlockedTraceEntry } from '../contract';
import { assembleCandidatePage } from '../page';
import { createRunCandidate } from '../report';
import {
  browserLaunchOptions,
  DELIVERY_ORIGIN,
  EGRESS_PROBE_SOURCE,
  newIsolatedContext,
  probeEgressAgainst,
  probeEgressBlocked,
  runPageUrl,
  SynthRunSession,
  withEgressCanary,
} from '../session';
import { findAppFrame } from '../sweep';

function ok(cond: boolean, msg: string): void {
  recordAssertion(() => nodeAssert.ok(cond, msg), msg);
}



const ROOT = process.cwd();

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Polls until `predicate` holds or `budgetMs` passes; the caller asserts. */
async function waitUntil(predicate: () => boolean, budgetMs: number): Promise<void> {
  const deadline = Date.now() + budgetMs;
  while (Date.now() < deadline && !predicate()) await wait(20);
}

// ─────────────────────────────────────────────────────────────────────────────
// Canaries: a loopback HTTP server, a WebSocket server, and a UDP socket. Any TCP connection or
// datagram at all counts, so a leak that never completes a request is still a leak.
// ─────────────────────────────────────────────────────────────────────────────

interface Canaries {
  httpHost: string;
  wsHost: string;
  udpHost: string;
  counts(): { http: number; ws: number; udp: number };
  total(): number;
  reset(): void;
  close(): Promise<void>;
}

async function listen(server: http.Server): Promise<string> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  return `127.0.0.1:${(server.address() as AddressInfo).port}`;
}

async function startCanaries(): Promise<Canaries> {
  const counts = { http: 0, ws: 0, udp: 0 };
  const httpServer = http.createServer((_req, res) => res.end('canary'));
  httpServer.on('connection', () => {
    counts.http++;
  });
  // The WebSocket canary counts the connection a handshake needs, which is already the leak.
  const wsServer = http.createServer((_req, res) => res.end('canary'));
  wsServer.on('connection', () => {
    counts.ws++;
  });
  const udp = dgram.createSocket('udp4');
  udp.on('message', () => {
    counts.udp++;
  });
  await new Promise<void>((resolve) => udp.bind(0, '127.0.0.1', () => resolve()));
  const httpHost = await listen(httpServer);
  const wsHost = await listen(wsServer);
  return {
    httpHost,
    wsHost,
    udpHost: `127.0.0.1:${udp.address().port}`,
    counts: () => ({ ...counts }),
    total: () => counts.http + counts.ws + counts.udp,
    reset() {
      counts.http = 0;
      counts.ws = 0;
      counts.udp = 0;
    },
    async close() {
      for (const server of [httpServer, wsServer]) {
        server.closeAllConnections();
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
      await new Promise<void>((resolve) => udp.close(() => resolve()));
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Browsers, contexts and probes
// ─────────────────────────────────────────────────────────────────────────────

/** Each network layer on its own, taken from the production definition. `bare` has none of them
 *  (the OS sandbox stays on): it is the control every single-layer case is read against. */
function layerLaunchOptions(): Record<'bare' | 'proxyOnly' | 'resolverOnly' | 'udpOnly', LaunchOptions> {
  const production = browserLaunchOptions();
  const args = production.args ?? [];
  const bare: LaunchOptions = { headless: true, chromiumSandbox: true };
  return {
    bare,
    proxyOnly: { ...bare, proxy: production.proxy },
    resolverOnly: { ...bare, args: args.filter((a) => a.startsWith('--host-resolver-rules=')) },
    udpOnly: { ...bare, args: args.filter((a) => a.startsWith('--force-webrtc-ip-handling-policy=')) },
  };
}

/** Harness-side navigation of a fresh page in `context`; `true` iff it committed. */
async function navigates(context: BrowserContext, url: string): Promise<boolean> {
  const page = await context.newPage();
  try {
    return await page.goto(url, { timeout: 5000 }).then(
      () => true,
      () => false,
    );
  } finally {
    await page.close();
  }
}

const BLANK_URL = `${DELIVERY_ORIGIN}/run/isolation-probe`;
const BLANK_HTML = '<!doctype html><title>isolation probe</title>';

/** A page on a secure origin, served from memory by a plain route that intercepts nothing else. */
async function plainSecurePage(context: BrowserContext): Promise<Page> {
  await context.route(BLANK_URL, (route) => route.fulfill({ status: 200, contentType: 'text/html', body: BLANK_HTML }));
  const page = await context.newPage();
  await page.goto(BLANK_URL);
  return page;
}

/** From the page's main world: a WebSocket toward `host`, settled on open/error/close or 3 s. */
function webSocketAttempt(page: Page, host: string): Promise<string> {
  return page.evaluate(
    (target: string) =>
      new Promise<string>((resolve) => {
        const g = globalThis as unknown as { WebSocket: new (url: string) => { onopen: (() => void) | null; onerror: (() => void) | null; onclose: (() => void) | null } };
        const socket = new g.WebSocket(`ws://${target}/`);
        socket.onopen = () => resolve('open');
        socket.onerror = () => resolve('error');
        socket.onclose = () => resolve('close');
        setTimeout(() => resolve('timeout'), 3000);
      }),
    host,
  );
}

/** From the page's main world: a WebRTC peer connection with `host` as its STUN server, held
 *  until ICE gathering completes or 3 s pass. */
function stunAttempt(page: Page, host: string): Promise<void> {
  return page.evaluate(async (target: string) => {
    type Pc = {
      createDataChannel(label: string): unknown;
      createOffer(): Promise<unknown>;
      setLocalDescription(d: unknown): Promise<void>;
      iceGatheringState: string;
      onicegatheringstatechange: (() => void) | null;
      close(): void;
    };
    const g = globalThis as unknown as { RTCPeerConnection: new (cfg: unknown) => Pc };
    const pc = new g.RTCPeerConnection({ iceServers: [{ urls: `stun:${target}` }] });
    pc.createDataChannel('probe');
    await pc.setLocalDescription(await pc.createOffer());
    await new Promise<void>((resolve) => {
      pc.onicegatheringstatechange = () => {
        if (pc.iceGatheringState === 'complete') resolve();
      };
      setTimeout(resolve, 3000);
    });
    pc.close();
  }, host);
}

async function browserPid(browser: Browser): Promise<number> {
  const cdp = await browser.newBrowserCDPSession();
  try {
    const { processInfo } = await cdp.send('SystemInfo.getProcessInfo');
    const main = processInfo.find((p) => p.type === 'browser');
    if (!main) throw new Error('the browser reported no browser process');
    return main.id;
  } finally {
    await cdp.detach();
  }
}

/** The process's real argument vector: `/proc` where it exists (exact), else `ps` (split on
 *  whitespace, which is exact for every switch this suite looks for). */
export function processArgs(pid: number): string[] {
  const procFile = `/proc/${pid}/cmdline`;
  if (fs.existsSync(procFile)) return fs.readFileSync(procFile, 'utf8').split('\0').filter(Boolean);
  return execFileSync('/bin/ps', ['-ww', '-o', 'args=', '-p', String(pid)], { encoding: 'utf8' }).trim().split(/\s+/);
}

export function hasSwitch(args: string[], name: string): boolean {
  return args.some((a) => a === name || a.startsWith(`${name}=`));
}

export const SANDBOX_DISABLING_SWITCHES =['--no-sandbox', '--disable-setuid-sandbox', '--disable-web-security', '--disable-site-isolation-trials'];

// ─────────────────────────────────────────────────────────────────────────────
// "No fallback exists": a syntax-level scan of the harness and server sources
// ─────────────────────────────────────────────────────────────────────────────

const SANDBOX_DISABLING_TEXT = /--no-sandbox|--disable-(?:setuid|gpu|namespace|seccomp-filter)-sandbox|--disable-web-security|--disable-site-isolation-trials|--single-process|--no-zygote|IsolateOrigins|site-per-process/;
const BROWSER_TYPES = new Set(['chromium', 'firefox', 'webkit']);
const LAUNCH_METHODS = new Set(['launch', 'launchPersistentContext', 'launchServer', 'connect', 'connectOverCDP']);

interface LaunchScan {
  violations: string[];
  /** `chromium.launch(browserLaunchOptions())` calls: the one sanctioned launch. */
  sanctionedLaunches: string[];
}

/**
 * Finds every way a source could start a browser with its sandbox weakened: any string naming a
 * sandbox- or isolation-disabling switch, a `chromiumSandbox` that is not the literal `true`, an
 * `ignoreDefaultArgs`, any browser launch or connect other than `chromium.launch(browserLaunchOptions())`,
 * and a `browserLaunchOptions` that takes a parameter or reads the environment. Comments are not
 * code, so prose naming a switch is ignored.
 */
function isTextNode(node: ts.Node): node is ts.StringLiteralLike | ts.TemplateHead | ts.TemplateMiddle | ts.TemplateTail {
  return ts.isStringLiteralLike(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node);
}

/** The finding for a property assignment, if it weakens a launch. */
function propertyFinding(node: ts.PropertyAssignment | ts.ShorthandPropertyAssignment, sf: ts.SourceFile): string | null {
  const name = node.name.getText(sf);
  if (name === 'ignoreDefaultArgs' || name === 'ignoreAllDefaultArgs') return "overrides Playwright's default arguments";
  if (name !== 'chromiumSandbox') return null;
  const literalTrue = ts.isPropertyAssignment(node) && node.initializer.kind === ts.SyntaxKind.TrueKeyword;
  return literalTrue ? null : 'sets chromiumSandbox to something other than the literal true';
}

/** `sanctioned` for exactly `chromium.launch(browserLaunchOptions())`, `other` for any other
 *  browser launch or connect, `none` for a call that starts no browser. */
function launchKind(node: ts.CallExpression): 'none' | 'sanctioned' | 'other' {
  const callee = node.expression;
  if (!ts.isPropertyAccessExpression(callee) || !ts.isIdentifier(callee.expression)) return 'none';
  if (!BROWSER_TYPES.has(callee.expression.text) || !LAUNCH_METHODS.has(callee.name.text)) return 'none';
  const [arg] = node.arguments;
  const viaOptions = node.arguments.length === 1 && ts.isCallExpression(arg) && ts.isIdentifier(arg.expression) && arg.expression.text === 'browserLaunchOptions' && arg.arguments.length === 0;
  return callee.expression.text === 'chromium' && callee.name.text === 'launch' && viaOptions ? 'sanctioned' : 'other';
}

function scanLaunches(fileName: string, text: string): LaunchScan {
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const scan: LaunchScan = { violations: [], sanctionedLaunches: [] };
  const where = (node: ts.Node): string => `${fileName}:${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1}`;
  const report = (node: ts.Node, finding: string): void => {
    scan.violations.push(`${where(node)} ${finding}`);
  };
  const visit = (node: ts.Node, inLaunchOptions: boolean): void => {
    let inside = inLaunchOptions;
    if (isTextNode(node) && SANDBOX_DISABLING_TEXT.test(node.text)) {
      report(node, 'names a sandbox- or isolation-disabling switch');
    } else if (ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node)) {
      const finding = propertyFinding(node, sf);
      if (finding) report(node, finding);
    } else if (ts.isFunctionDeclaration(node) && node.name?.text === 'browserLaunchOptions') {
      inside = true;
      if (node.parameters.length > 0) report(node, 'browserLaunchOptions takes a parameter');
    } else if (inLaunchOptions && ts.isPropertyAccessExpression(node) && node.getText(sf).startsWith('process.env')) {
      report(node, 'browserLaunchOptions reads the environment');
    } else if (ts.isCallExpression(node)) {
      const kind = launchKind(node);
      if (kind === 'sanctioned') scan.sanctionedLaunches.push(where(node));
      else if (kind === 'other') report(node, 'starts a browser outside chromium.launch(browserLaunchOptions())');
    }
    ts.forEachChild(node, (child) => visit(child, inside));
  };
  visit(sf, false);
  return scan;
}

function tsFilesUnder(dir: string, recursive: boolean): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return recursive ? tsFilesUnder(full, true) : [];
    return entry.name.endsWith('.ts') ? [full] : [];
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// The hostile candidate
// ─────────────────────────────────────────────────────────────────────────────

/** Attempts every egress path a candidate realm can name toward the canaries, first at load, then
 *  again on the sweep's press of "Attack", which also navigates its own frame. Every attempt is
 *  swallowed, so nothing here becomes a diagnostic and the report shows only what the harness saw. */
function hostileCandidate(c: Canaries): string {
  return `import { defineApp, Screen, Stack, Heading, Button } from 'vc-sdk';
const g = globalThis as any;
function attempt(fn: () => unknown) {
  try {
    const r = fn() as any;
    if (r && typeof r.catch === 'function') r.catch(() => undefined);
  } catch (e) {
    return e;
  }
  return undefined;
}
function attack() {
  const d = g.document;
  attempt(() => { const img = d.createElement('img'); img.src = 'http://${c.httpHost}/image.png'; d.body.appendChild(img); });
  attempt(() => { const s = d.createElement('style'); s.textContent = "@import url('http://${c.httpHost}/import.css'); body { background-image: url('http://${c.httpHost}/background.png'); }"; d.head.appendChild(s); });
  for (const rel of ['prefetch', 'preconnect', 'dns-prefetch', 'stylesheet']) {
    attempt(() => { const l = d.createElement('link'); l.rel = rel; l.href = 'http://${c.httpHost}/' + rel; d.head.appendChild(l); });
  }
  attempt(() => new g.WebSocket('ws://${c.wsHost}/socket'));
  attempt(() => new g.WebTransport('https://${c.udpHost}/transport').ready);
  for (const name of ['RTCPeerConnection', 'webkitRTCPeerConnection']) {
    attempt(() => {
      const pc = new g[name]({ iceServers: [{ urls: 'stun:${c.udpHost}' }] });
      pc.createDataChannel('leak');
      return pc.createOffer().then((offer: unknown) => pc.setLocalDescription(offer));
    });
  }
  attempt(() => { const m = d.createElement('meta'); m.httpEquiv = 'refresh'; m.content = '0;url=http://${c.httpHost}/meta-refresh'; d.head.appendChild(m); });
}
attack();
function Home() {
  return (
    <Screen>
      <Stack>
        <Heading size="title">Egress</Heading>
        <Button label="Attack" onPress={() => { attack(); setTimeout(() => attempt(() => { g.location.href = 'http://${c.httpHost}/self-navigation'; }), 100); }} />
      </Stack>
    </Screen>
  );
}
export default defineApp({ name: 'Egress', initial: 'Home', screens: { Home }, capabilities: [] });
`;
}

const HARMLESS = `import { defineApp, Screen, Stack, Heading } from 'vc-sdk';
function Home() { return <Screen><Stack><Heading size="title">Harmless</Heading></Stack></Screen>; }
export default defineApp({ name: 'Harmless', initial: 'Home', screens: { Home }, capabilities: [] });
`;

// ─────────────────────────────────────────────────────────────────────────────
// Suites
// ─────────────────────────────────────────────────────────────────────────────

export async function testIsolation(): Promise<void> {
  await testBuilderFileReads();
  await testNoFallback();
  const canaries = await startCanaries();
  try {
    await testSandboxedProcess();
    await testLayers(canaries);
    await testHostileCandidate(canaries);
    await testServiceWorkers();
  } finally {
    await canaries.close();
  }
}

async function testBuilderFileReads(): Promise<void> {
  // A server source file with no imports of its own, so the unguarded control below builds it
  // whole. Its lines are read at run time, so the check follows the file as it changes.
  const target = path.join(ROOT, 'server/src/generation/json-block.ts');
  const targetLines = fs
    .readFileSync(target, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length >= 24);

  await test('builder: a re-exported server file never enters the bundle (spec "A re-exported server file never enters the bundle")', async () => {
    ok(targetLines.length > 0, 'precondition: the target file has distinctive lines to look for');
    const failure = await buildCandidateSource(`export * from ${JSON.stringify(target)};\n`).then(
      () => undefined,
      (err: unknown) => err as { message?: string; errors?: { text: string }[] },
    );
    ok(failure !== undefined, 'the build of a candidate re-exporting a repo file fails');
    const texts = failure?.errors?.map((e) => e.text) ?? [];
    ok(
      texts.some((t) => t.startsWith(CANDIDATE_RESOLVE_REFUSED) && t.includes(target)),
      `the failure is the named resolve refusal, naming the specifier (got ${JSON.stringify(texts)})`,
    );
    const surfaced = `${failure?.message ?? ''}\n${JSON.stringify(failure)}`;
    ok(!targetLines.some((l) => surfaced.includes(l)), 'no line of the re-exported file appears anywhere in what the failed build returns');
  });

  await test('builder: every other import, require or re-export is refused by name; the three externals are not', async () => {
    // Each binding is used: TypeScript semantics erase an unused import before resolution (next case).
    const refused = [
      `import x from ${JSON.stringify(target)};\nexport default x;`,
      `const x = require(${JSON.stringify(target)});\nexport default x;`,
      "export { x } from './sibling';",
      "import x from 'lodash';\nexport default x;",
      "import { createRoot } from 'react-dom/client';\nexport default createRoot;",
      "export default () => import('vc-sdk/internal');",
    ];
    for (const source of refused) {
      const failure = await buildCandidateSource(`${source}\n`).then(
        () => undefined,
        (err: unknown) => err as { errors?: { text: string }[] },
      );
      ok(failure?.errors?.some((e) => e.text.startsWith(CANDIDATE_RESOLVE_REFUSED)) === true, `${JSON.stringify(source)} fails with ${CANDIDATE_RESOLVE_REFUSED}`);
    }
    const honest = await buildCandidateSource("import { Screen } from 'vc-sdk';\nimport React from 'react';\nimport ReactDOM from 'react-dom';\nexport default [Screen, React, ReactDOM];\n");
    ok(/require\("vc-sdk"\)/.test(honest.js) && /require\("react-dom"\)/.test(honest.js), 'vc-sdk, react and react-dom still build, as externals');
  });

  // CONTROL: the identical production build contract without the resolve plugin reads the file
  // into the bundle and its source map. Without this the refusal above could pass against a
  // builder that simply cannot resolve absolute paths.
  await test('builder control: without the resolve allowlist the same re-export does leak the file', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'synthrun-leak-control-'));
    try {
      const entry = path.join(dir, 'candidate.app.tsx');
      await writeFile(entry, `export * from ${JSON.stringify(target)};\n`, 'utf8');
      const out = await esbuild({
        entryPoints: [entry],
        bundle: true,
        format: 'iife',
        globalName: '__WHIM_APP_MODULE__',
        platform: 'browser',
        target: 'es2019',
        tsconfigRaw: '{}',
        jsx: 'transform',
        jsxFactory: 'React.createElement',
        jsxFragment: 'React.Fragment',
        inject: [path.join(ROOT, 'build/react-inject-shim.ts')],
        external: ['vc-sdk', 'react', 'react-dom', 'react-dom/client'],
        sourcemap: 'external',
        sourcesContent: true,
        outdir: tmpdir(),
        minify: false,
        write: false,
        logLevel: 'silent',
      });
      const emitted = out.outputFiles.map((f) => f.text).join('\n');
      ok(targetLines.some((l) => emitted.includes(l)), 'the unguarded build carries the file\'s own lines, so the check above can see a leak');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
}

async function testNoFallback(): Promise<void> {
  await test('sandbox: no code path launches Chromium with the sandbox disabled (spec "No fallback exists")', () => {
    const files = [...tsFilesUnder(path.join(ROOT, 'synthrun'), false), ...tsFilesUnder(path.join(ROOT, 'server/src'), true)];
    const violations: string[] = [];
    const sanctioned: string[] = [];
    for (const file of files) {
      const scan = scanLaunches(path.relative(ROOT, file), fs.readFileSync(file, 'utf8'));
      violations.push(...scan.violations);
      sanctioned.push(...scan.sanctionedLaunches);
    }
    ok(files.some((f) => f.endsWith(path.join('synthrun', 'session.ts'))), 'the scan covers synthrun/session.ts');
    ok(violations.length === 0, `no harness or server source weakens a launch (got ${JSON.stringify(violations)})`);
    ok(sanctioned.length === 1, `exactly one sanctioned browser launch exists, through browserLaunchOptions() (got ${JSON.stringify(sanctioned)})`);
  });

  // CONTROL: each weakening the scan claims to find, planted in a synthetic source, is found.
  await test('sandbox control: the scan finds every planted weakening, and passes the sanctioned launch', () => {
    const planted: Record<string, string> = {
      'a direct launch': 'chromium.launch({ headless: true });',
      'a sandbox-off option': 'export function browserLaunchOptions() { return { chromiumSandbox: false }; }',
      'an environment-controlled sandbox': "export function browserLaunchOptions() { return { chromiumSandbox: process.env.WHIM_SANDBOX !== 'off' }; }",
      'a sandbox-disabling switch': "const args = ['--no-sandbox'];",
      'a site-isolation switch in a template': 'const flag = `--disable-site-isolation-trials`;',
      'dropped default arguments': 'chromium.launch({ ...browserLaunchOptions(), ignoreDefaultArgs: true });',
      'a parameterised definition': 'export function browserLaunchOptions(weaken: boolean) { return { chromiumSandbox: true }; }',
      'a CDP connection': "chromium.connectOverCDP('http://127.0.0.1:9222');",
    };
    for (const [what, source] of Object.entries(planted)) {
      ok(scanLaunches('planted.ts', source).violations.length > 0, `the scan finds ${what}`);
    }
    const clean = scanLaunches('clean.ts', '// never pass --no-sandbox\nchromium.launch(browserLaunchOptions());');
    ok(clean.violations.length === 0 && clean.sanctionedLaunches.length === 1, `the sanctioned launch, with a comment naming a switch, is clean (got ${JSON.stringify(clean)})`);
  });
}

async function testSandboxedProcess(): Promise<void> {
  await test('sandbox: the launched browser process carries no sandbox-disabling flag (spec "The launched browser process carries no sandbox-disabling flag")', async () => {
    const session = await SynthRunSession.launch({ concurrency: 1 });
    try {
      const args = processArgs(await session.browserProcessId());
      for (const name of SANDBOX_DISABLING_SWITCHES) ok(!hasSwitch(args, name), `the session's browser process was not started with ${name}`);
      // Non-vacuity: this is the right process and its real arguments, because the D5 switches the
      // launch options add are there.
      ok(args.includes('--proxy-server=http://127.0.0.1:9') && args.includes('--proxy-bypass-list=<-loopback>'), 'the process carries the dead proxy and the removed loopback bypass');
      ok(hasSwitch(args, '--host-resolver-rules') && hasSwitch(args, '--force-webrtc-ip-handling-policy') && hasSwitch(args, '--dns-prefetch-disable'), 'the process carries the resolver, WebRTC and DNS-prefetch switches');
    } finally {
      await session.close();
    }
    // CONTROL: Playwright's own default launch does add the switch, read the same way.
    const unguarded = await chromium.launch();
    try {
      ok(hasSwitch(processArgs(await browserPid(unguarded)), '--no-sandbox'), 'a default-options browser read the same way does show --no-sandbox, so its absence above is observed');
    } finally {
      await unguarded.close();
    }
  });
}

async function testLayers(canaries: Canaries): Promise<void> {
  const layers = layerLaunchOptions();
  const canaryUrl = `http://${canaries.httpHost}/navigation`;

  await test('egress: interception alone blocks a direct navigation and a WebSocket, and counts both (spec "Interception alone blocks a direct navigation")', async () => {
    const browser = await chromium.launch(layers.bare);
    try {
      const { context, egress } = await newIsolatedContext(browser, { url: BLANK_URL, html: BLANK_HTML });
      const page = await context.newPage();
      await page.goto(BLANK_URL);
      canaries.reset();
      ok(!(await navigates(context, canaryUrl)), 'the navigation through the isolated context fails');
      const socket = await webSocketAttempt(page, canaries.wsHost);
      ok(socket !== 'open', `the WebSocket through the isolated context does not open (got ${socket})`);
      ok(canaries.total() === 0, `no canary saw anything (got ${JSON.stringify(canaries.counts())})`);
      ok(egress.count === 2, `both refusals were counted (got ${egress.count})`);
      await context.close();

      // CONTROL, interception removed: the same browser with a plain context reaches both canaries.
      const plain = await browser.newContext();
      canaries.reset();
      ok(await navigates(plain, canaryUrl), 'without interception the navigation commits');
      await webSocketAttempt(await plainSecurePage(plain), canaries.wsHost);
      await waitUntil(() => canaries.counts().http > 0 && canaries.counts().ws > 0, 2000);
      ok(canaries.counts().http > 0 && canaries.counts().ws > 0, `without interception the HTTP and WebSocket canaries both record a connection (got ${JSON.stringify(canaries.counts())})`);
      await plain.close();
    } finally {
      await browser.close();
    }
  });

  await test('egress: the harness launch options block a navigation with no interception (spec "The proxy pin alone blocks a direct navigation")', async () => {
    const browser = await chromium.launch(browserLaunchOptions());
    try {
      const context = await browser.newContext();
      canaries.reset();
      ok(!(await navigates(context, canaryUrl)), 'the navigation fails');
      ok(canaries.total() === 0, `no canary saw anything (got ${JSON.stringify(canaries.counts())})`);
      await context.close();
    } finally {
      await browser.close();
    }
  });

  // Each browser layer alone, against the bare browser (sandbox on, no network layers) as control.
  const bare = await chromium.launch(layers.bare);
  try {
    await test('egress control: with no network layer at all, navigation, WebSocket and WebRTC UDP all reach their canaries (spec "The canary is reachable without the guards")', async () => {
      const context = await bare.newContext();
      canaries.reset();
      ok(await navigates(context, canaryUrl), 'the bare browser commits the navigation');
      const page = await plainSecurePage(context);
      await webSocketAttempt(page, canaries.wsHost);
      await stunAttempt(page, canaries.udpHost);
      await waitUntil(() => canaries.counts().udp > 0, 2000);
      const counts = canaries.counts();
      ok(counts.http > 0 && counts.ws > 0 && counts.udp > 0, `every canary records the bare browser (got ${JSON.stringify(counts)})`);
      await context.close();
    });

    for (const [layer, expectation] of [
      ['proxyOnly', 'the dead proxy alone'],
      ['resolverOnly', 'the resolver rule alone'],
    ] as const) {
      await test(`egress: ${expectation} blocks a navigation and a WebSocket`, async () => {
        const browser = await chromium.launch(layers[layer]);
        try {
          const context = await browser.newContext();
          canaries.reset();
          ok(!(await navigates(context, canaryUrl)), 'the navigation fails');
          await webSocketAttempt(await plainSecurePage(context), canaries.wsHost);
          ok(canaries.counts().http === 0 && canaries.counts().ws === 0, `neither the HTTP nor the WebSocket canary saw anything (got ${JSON.stringify(canaries.counts())})`);
          await context.close();
        } finally {
          await browser.close();
        }
      });
    }

    await test('egress: the WebRTC UDP restriction alone keeps a STUN request off the network', async () => {
      const browser = await chromium.launch(layers.udpOnly);
      try {
        const context = await browser.newContext();
        canaries.reset();
        await stunAttempt(await plainSecurePage(context), canaries.udpHost);
        await wait(300);
        ok(canaries.counts().udp === 0, `the UDP canary saw no datagram (got ${JSON.stringify(canaries.counts())})`);
        await context.close();
      } finally {
        await browser.close();
      }
    });
  } finally {
    await bare.close();
  }

  await test('egress: the blocked count saturates at BLOCKED_EGRESS_CAP, and a second navigation to the run URL is refused', async () => {
    const browser = await chromium.launch(browserLaunchOptions());
    try {
      const url = runPageUrl('cap-probe');
      const { context, egress } = await newIsolatedContext(browser, { url, html: BLANK_HTML });
      const page = await context.newPage();
      ok(await page.goto(url).then(() => true, () => false), 'the first navigation to the run URL is served');
      ok(egress.count === 0, `serving the page is not a refusal (got ${egress.count})`);
      ok(!(await page.goto(url).then(() => true, () => false)), 'a second navigation to the run URL is refused');
      ok(egress.count === 1, `and counted (got ${egress.count})`);
      for (let i = 0; i < BLOCKED_EGRESS_CAP + 4; i++) {
        await page.goto(`http://${canaries.httpHost}/cap-${i}`).catch(() => undefined);
      }
      ok(egress.count === BLOCKED_EGRESS_CAP, `the count saturates at the cap rather than growing (got ${egress.count})`);
      await context.close();
    } finally {
      await browser.close();
    }
  });
}

async function testHostileCandidate(canaries: Canaries): Promise<void> {
  const source = hostileCandidate(canaries);

  await test('egress: a hostile candidate reaches no canary, and the trace records the blocked attempts (spec "A hostile candidate reaches no canary")', async () => {
    const session = await SynthRunSession.launch({ concurrency: 1 });
    try {
      canaries.reset();
      // The quiet window keeps the realm alive well past each round of attempts, including the
      // press-triggered one, so late UDP and navigation attempts happen inside the run.
      const report = await createRunCandidate(session)(source, { budgets: { mountBudgetMs: 5000, actionQuietMs: 1500, actionHardCapMs: 4000 } });
      await wait(500);
      ok(canaries.total() === 0, `no canary saw a connection or datagram (got ${JSON.stringify(canaries.counts())})`);
      const blocked = report.trace.filter((t): t is EgressBlockedTraceEntry => t.kind === 'egress_blocked');
      ok(blocked.length === 1, `exactly one egress_blocked trace entry (got ${JSON.stringify(report.trace)})`);
      ok((blocked[0]?.count ?? 0) > 0 && (blocked[0]?.count ?? 0) <= BLOCKED_EGRESS_CAP, `its count is positive and bounded (got ${blocked[0]?.count})`);
      ok(!JSON.stringify(report).includes('127.0.0.1:'), 'no attempted destination appears anywhere in the report');
      ok(report.contained === true, `the candidate still ran to a trusted containment verdict (got ${JSON.stringify(report.contained)})`);
    } finally {
      await session.close();
    }
  });

  // CONTROL, all three layers removed: the same page, delivered the same way, from a default-options
  // browser whose route serves the page and intercepts nothing else.
  await test('egress control: the same hostile candidate without the guards does reach a canary', async () => {
    const { js } = await buildCandidateSource(source);
    const url = runPageUrl('hostile-control');
    const html = await assembleCandidatePage(js, 'hostile-control');
    const browser = await chromium.launch();
    try {
      const context = await browser.newContext();
      await context.route(url, (route) => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html }));
      canaries.reset();
      const page = await context.newPage();
      await page.goto(url);
      await waitUntil(() => canaries.total() > 0, 3000);
      ok(canaries.total() > 0, `without the guards the hostile candidate reaches at least one canary (got ${JSON.stringify(canaries.counts())})`);
      await context.close();
    } finally {
      await browser.close();
    }
  });

  await test('egress: probeEgressBlocked passes on a live session', async () => {
    const session = await SynthRunSession.launch({ concurrency: 1 });
    try {
      const result = await probeEgressBlocked(session);
      ok(result.blocked, `the probe passes (got ${JSON.stringify(result)})`);
      ok(result.canaryConnections === 0 && !result.fetched && !result.navigated, 'nothing got through');
      ok(result.blockedCount > 0, 'the attempts reached interception and were counted');
    } finally {
      await session.close();
    }
  });

  // The red direction: only the pass case was ever exercised, so a probe hard-coded to
  // `blocked: true` would have passed too. Run the SAME probe logic against a context built with
  // NO interception at all (the "egress control" pattern used throughout this file) and confirm
  // it reports `blocked: false` with canary connections actually reaching it.
  await test('egress: probeEgressBlocked reports blocked:false against a context with no interception (red direction)', async () => {
    const { js } = await buildCandidateSource(EGRESS_PROBE_SOURCE);
    const url = runPageUrl('egress-probe-control');
    const html = await assembleCandidatePage(js, 'egress-probe-control');
    const browser = await chromium.launch();
    try {
      const context = await browser.newContext();
      await context.route(url, (route) => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html }));
      const page = await context.newPage();
      await page.goto(url, { waitUntil: 'load' });
      const result = await withEgressCanary((canaryTarget, countConnections) =>
        probeEgressAgainst({ page, egressCount: () => 0 }, canaryTarget, countConnections),
      );
      ok(result.blocked === false, `with no interception the probe must report blocked:false (got ${JSON.stringify(result)})`);
      ok(result.canaryConnections > 0, `with no interception the canary actually gets reached (got ${result.canaryConnections})`);
      await context.close();
    } finally {
      await browser.close();
    }
  });
}

/** In-page (serialized by `page.evaluate`): registers `/sw.js` and reports `active`, `registered`
 *  (no activation within 3 s) or `refused:<error name>`. */
async function registerServiceWorkerInPage(): Promise<string> {
  const g = globalThis as unknown as {
    navigator: { serviceWorker: { register(url: string): Promise<unknown>; ready: Promise<{ active: unknown }> } };
    setTimeout(callback: () => void, ms: number): unknown;
  };
  try {
    await g.navigator.serviceWorker.register('/sw.js');
    const timeout = new Promise<null>((resolve) => g.setTimeout(() => resolve(null), 3000));
    const ready = await Promise.race([g.navigator.serviceWorker.ready, timeout]);
    return ready?.active ? 'active' : 'registered';
  } catch (err) {
    return `refused:${(err as Error).name}`;
  }
}

/** In-page: reading the service worker API, as its `typeof` or the name of the error reading it throws. */
function readServiceWorkerApiInPage(): string {
  const g = globalThis as unknown as { navigator: Record<string, unknown> };
  try {
    return typeof g.navigator.serviceWorker;
  } catch (err) {
    return (err as Error).name;
  }
}

async function testServiceWorkers(): Promise<void> {
  const register = (page: Page): Promise<string> => page.evaluate(registerServiceWorkerInPage);

  await test('service workers: the outer page cannot register one, the refusal is counted, and the candidate realm cannot reach the API', async () => {
    const session = await SynthRunSession.launch({ concurrency: 1 });
    try {
      const { ctx, dispose } = await session.openRun(HARMLESS);
      try {
        const before = ctx.egress.count;
        const outcome = await register(ctx.page);
        ok(outcome.startsWith('refused:'), `registration from the run's main frame fails (got ${outcome})`);
        ok(ctx.egress.count > before, `the worker script fetch was refused as egress (count ${before} → ${ctx.egress.count})`);

        const inRealm = await (await findAppFrame(ctx.page)).evaluate(readServiceWorkerApiInPage);
        ok(inRealm === 'SecurityError', `Chromium refuses the service worker API inside the candidate's sandboxed realm (got ${inRealm})`);
        const inOuter = await ctx.page.evaluate(readServiceWorkerApiInPage);
        ok(inOuter === 'object', `the same read in the outer page returns the API, so the refusal above is the realm's (got ${inOuter})`);
      } finally {
        await dispose();
      }
    } finally {
      await session.close();
    }
  });

  // CONTROL: the same launch options with a route that serves the worker script do register one.
  await test('service workers control: when a route serves the script, the same registration succeeds', async () => {
    const browser = await chromium.launch(browserLaunchOptions());
    try {
      const context = await browser.newContext();
      await context.route(`${DELIVERY_ORIGIN}/sw.js`, (route) => route.fulfill({ status: 200, contentType: 'text/javascript', body: "self.addEventListener('fetch', () => {});" }));
      const outcome = await register(await plainSecurePage(context));
      ok(outcome === 'active', `a served worker script registers and activates (got ${outcome})`);
      await context.close();
    } finally {
      await browser.close();
    }
  });
}
