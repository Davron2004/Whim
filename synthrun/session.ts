/**
 * Chromium session lifecycle (design D4). One `chromium.launch()` per harness session; each
 * candidate gets a FRESH browser context + page (closed together when its run ends) — a
 * strictly stronger isolation boundary than the T7 iframe-recreation requirement, by
 * construction. Concurrency is bounded by a caller-set semaphore, scoped to the SESSION (not
 * repeated per call — see `contract.ts`'s `Semaphore` comment).
 *
 * What a candidate can reach (public-generation-server design D4/D5, spec §Chromium runs with its
 * OS sandbox enabled, §A synthetic run has no network egress) is decided here, in two places and
 * nowhere else: `browserLaunchOptions()` is the only launch configuration (OS sandbox on, a dead
 * proxy, a resolver that resolves nothing, no non-proxied WebRTC UDP), and `newIsolatedContext()`
 * is the only way a run's browser context is made (the page is delivered from memory at a
 * reserved `.invalid` origin; every other request and WebSocket is aborted and counted). The
 * interception, the proxy and the resolver each block HTTP-family traffic on their own, and the
 * WebRTC switch alone keeps UDP off the network; `synthrun/test/isolation.ts` proves each one
 * alone, and proves the canary is reachable with that layer removed.
 *
 * `openRun` is the extension point later chains build on. `RunOptions.beforeNavigate` (see
 * `contract.ts`) is the pre-navigation seam: observation (`observe.ts`'s `attachObserversEarly`,
 * `handoff/observation-phases.md`) attaches ALL of its collectors there — CDP `Runtime.enable`,
 * the nonce-authenticated frame relay and the console heartbeat — because the outer page emits
 * `delivery`/`paint`/`probes` within milliseconds of `load`, so anything attached after `openRun`
 * returns races those frames and silently drops the ones it loses (measured, not theoretical);
 * chain 3 (capability wiring) uses the SAME hook
 * for `context.exposeBinding('whimHostDispatch', host.dispatch)` — which MUST happen before
 * navigation for the binding to be available when the page's inline scripts run (`page.
 * ts` already sets `syscallSink:'exposed'` expecting this), and it's `exposeBinding` rather
 * than `exposeFunction` that carries the caller's frame through to the main-frame guard;
 * chain 4 (the sweep) drives `ctx.
 * page`; chain 5 (task 5.2) composes all of the above plus `dispose()` into the full
 * `RunCandidate` entry point `contract.ts` declares.
 */
import { chromium, type Browser, type BrowserContext, type LaunchOptions, type Page } from 'playwright';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { buildCandidateSource } from './builder';
import { createSemaphore } from './concurrency';
import { BLOCKED_EGRESS_CAP, type RunOptions, type Semaphore, type StageTimings } from './contract';
import { assembleCandidatePage } from './page';

const DEFAULT_CONCURRENCY = 4;

/** The reserved origin every run page is delivered from. `.invalid` can never resolve (RFC 2606),
 *  so nothing outside this process can ever answer for it, and `https` keeps the outer page a
 *  secure context, as `file://` was. */
export const DELIVERY_ORIGIN = 'https://synthrun.invalid';

/** The one URL a run's page is served at: `${DELIVERY_ORIGIN}/run/<runId>`. */
export function runPageUrl(runId: string): string {
  return `${DELIVERY_ORIGIN}/run/${runId}`;
}

/**
 * The only Chromium launch configuration (design D4/D5). Every browser the harness, the server and
 * the boot self-test launch comes from here. There is deliberately no parameter, option or
 * environment variable that weakens it: if the OS sandbox cannot start on a host, the launch
 * fails and that failure is the answer.
 *
 *  - `chromiumSandbox: true` — Playwright otherwise adds the sandbox-disabling switch itself;
 *  - `proxy` — all traffic is pinned to a closed loopback port, and `<-loopback>` removes
 *    Chromium's implicit loopback bypass, so a request that escaped interception has no route;
 *  - `--host-resolver-rules=MAP * ~NOTFOUND` — every host name (IP literals included, measured)
 *    resolves to not-found;
 *  - `--force-webrtc-ip-handling-policy=disable_non_proxied_udp` — WebRTC is not covered by CSP,
 *    so UDP it would send outside the proxy is refused at the browser;
 *  - `--dns-prefetch-disable` — no speculative lookups on the candidate's behalf.
 */
export function browserLaunchOptions(): LaunchOptions {
  return {
    headless: true,
    chromiumSandbox: true,
    proxy: { server: 'http://127.0.0.1:9', bypass: '<-loopback>' },
    args: ['--host-resolver-rules=MAP * ~NOTFOUND', '--force-webrtc-ip-handling-policy=disable_non_proxied_udp', '--dns-prefetch-disable'],
  };
}

/** A live, saturating tally of the egress a context refused. Never holds a URL: the attempted
 *  destination is candidate-chosen text, and echoing it would let the candidate author our
 *  diagnostics (the forgery-echo rule, `contract.ts`'s `ForgeryTally`). */
export interface EgressTally {
  /** Requests and WebSockets aborted so far, saturating at `BLOCKED_EGRESS_CAP`. */
  readonly count: number;
  /** `Date.now()` at the first refusal; `null` until one happens. */
  readonly firstAt: number | null;
}

export interface IsolatedContext {
  context: BrowserContext;
  egress: EgressTally;
}

/**
 * The only way a run's browser context is made (design D5 layer 1). The context refuses downloads.
 * A context-level route fulfills exactly one request, the first navigation to `delivery.url`, with
 * `delivery.html` from memory, and aborts every other request the context makes, from any page,
 * frame or worker. Every WebSocket is closed without a server connection. Each refusal is counted
 * in the returned tally.
 *
 * Only the first navigation is served: nothing in the context exists before it, so it can only be
 * the harness's own `page.goto`, and a later frame navigating back to the run URL gets nothing.
 * Without `delivery` the context serves nothing at all.
 *
 * Service workers are blocked by two mechanisms, not by Playwright's `serviceWorkers: 'block'`.
 * Chromium refuses registration in the candidate's opaque-origin sandboxed realm, and the route
 * above aborts the worker script fetch for the outer page, which counts as refused egress.
 * Playwright's option is rejected because it injects a script into every frame, the candidate's
 * realm included, and harness code never runs there.
 */
export async function newIsolatedContext(browser: Browser, delivery?: { url: string; html: string }): Promise<IsolatedContext> {
  const context = await browser.newContext({ acceptDownloads: false });
  const egress: { count: number; firstAt: number | null } = { count: 0, firstAt: null };
  const refuse = (): void => {
    egress.firstAt ??= Date.now();
    egress.count = Math.min(egress.count + 1, BLOCKED_EGRESS_CAP);
  };
  let delivered = false;
  await context.route('**/*', async (route) => {
    const request = route.request();
    if (delivery && !delivered && request.isNavigationRequest() && request.url() === delivery.url) {
      delivered = true;
      await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: delivery.html });
      return;
    }
    refuse();
    // `aborted`, not `blockedbyclient`: a refused frame navigation then commits no error page, so
    // the candidate's realm keeps running and the run keeps observing what else it attempts.
    await route.abort('aborted');
  });
  await context.routeWebSocket(/.*/, async (ws) => {
    refuse();
    await ws.close();
  });
  return { context, egress };
}

export interface SessionOptions {
  /** Bounds concurrent runs within this session (design D4, default 4). Ignored when
   *  `semaphore` is supplied. */
  concurrency?: number;
  /** A caller-owned semaphore (e.g. shared across sessions/pools) — overrides `concurrency`. */
  semaphore?: Semaphore;
}

export interface RunContext {
  runId: string;
  /** The ephemeral storage-engine `appId` scope for this run (design D3) — `opts.appId` when
   *  given, else `runId` (never shared across runs). */
  appId: string;
  page: Page;
  context: BrowserContext;
  /** The run context's egress tally (`newIsolatedContext`), live for the life of the run. The
   *  report reads it once, at assembly. */
  egress: EgressTally;
  /** The candidate's v3 source map text (`BuildCandidateResult.map`, `builder.ts`), verbatim —
   *  chain 2's source-map resolution (design D2/spec §Diagnostics) reads this to map a
   *  `pageerror`/CDP stack line in the DELIVERED (wrapped) script back to the original TS
   *  source line. Never re-derived: this IS the map the executing bundle was built with. */
  sourceMap: string;
  /** `Date.now()` at the start of this run — later stages compute their own stage timings as
   *  deltas from this anchor. */
  startedAt: number;
  /** `buildMs`/`bootMs` as measured by `openRun`; later stages fill in the rest of
   *  `StageTimings` (mount→paint, sweep, per-screen) as they run. */
  timings: Pick<StageTimings, 'buildMs' | 'bootMs'>;
}

export interface OpenRunResult {
  ctx: RunContext;
  /** Closes the page + context and releases the concurrency slot. The caller MUST call this
   *  exactly once, when the run's report is complete (design D4). */
  dispose(): Promise<void>;
}

export class SynthRunSession {
  private constructor(
    private readonly browser: Browser,
    private readonly semaphore: Semaphore,
  ) {}

  static async launch(opts: SessionOptions = {}): Promise<SynthRunSession> {
    const browser = await chromium.launch(browserLaunchOptions());
    const semaphore = opts.semaphore ?? createSemaphore(opts.concurrency ?? DEFAULT_CONCURRENCY);
    return new SynthRunSession(browser, semaphore);
  }

  /**
   * Build one candidate, assemble it into the unmodified production runtime page, open a
   * fresh isolated browser context + page for it under the session's semaphore, and navigate to
   * the page delivered from memory.
   */
  async openRun(source: string, opts: RunOptions = {}): Promise<OpenRunResult> {
    const release = await this.semaphore.acquire();
    const runId = `${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
    const appId = opts.appId ?? runId;
    let context: BrowserContext | undefined;
    try {
      const buildStart = Date.now();
      const { js, map } = await buildCandidateSource(source, { filenameHint: runId });
      const buildMs = Date.now() - buildStart;

      const bootStart = Date.now();
      const url = runPageUrl(runId);
      const html = await assembleCandidatePage(js, runId);
      const isolated = await newIsolatedContext(this.browser, { url, html });
      context = isolated.context;
      const page = await context.newPage();
      if (opts.beforeNavigate) await opts.beforeNavigate(page, context);
      // `waitUntil:'load'` is settled, not inherited: measured against a candidate that hangs
      // synchronously and unboundedly, this `goto` still resolves in ~30ms rather than timing
      // out, because the outer page's `load` fires once the sandboxed iframe's own srcdoc has
      // loaded — the candidate bundle is only DELIVERED afterwards, over postMessage. So a
      // never-painting candidate still reaches the mount watchdog, and a weaker mode ('commit'/
      // 'domcontentloaded') would buy nothing while making `bootMs` mean less.
      await page.goto(url, { waitUntil: 'load', timeout: 20000 });
      const bootMs = Date.now() - bootStart;

      const ctx: RunContext = { runId, appId, page, context, egress: isolated.egress, sourceMap: map, startedAt: bootStart, timings: { buildMs, bootMs } };
      const openContext = context;
      return {
        ctx,
        dispose: async () => {
          await openContext.close();
          release();
        },
      };
    } catch (err) {
      if (context) await context.close();
      release();
      throw err;
    }
  }

  /** The operating-system process id of this session's browser, as the browser itself reports
   *  it — for inspecting what the process was really launched with. */
  async browserProcessId(): Promise<number> {
    const cdp = await this.browser.newBrowserCDPSession();
    try {
      const { processInfo } = await cdp.send('SystemInfo.getProcessInfo');
      const browserProcess = processInfo.find((p) => p.type === 'browser');
      if (!browserProcess) throw new Error('synthrun session: the browser reported no browser process');
      return browserProcess.id;
    } finally {
      await cdp.detach();
    }
  }

  /** Ends the session: closes the browser. Any run whose `dispose()` has not yet been called
   *  should be disposed first — this does not do it implicitly. */
  async close(): Promise<void> {
    await this.browser.close();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Boot self-test probe (design D5, D16)
// ─────────────────────────────────────────────────────────────────────────────

export interface EgressProbeResult {
  /** The pass condition: `canaryConnections === 0 && !fetched && !navigated && blockedCount > 0`. */
  blocked: boolean;
  /** TCP connections the probe's loopback canary accepted, WebSocket attempts included. Any is a
   *  leak. */
  canaryConnections: number;
  /** The page's `fetch` toward the canary resolved. The canary answers every request, so this is
   *  `true` exactly when the request got through. */
  fetched: boolean;
  /** The harness-side main-frame navigation to the canary committed. */
  navigated: boolean;
  /** The run's egress tally after the attempts. Zero means the attempts never reached
   *  interception at all, so the probe proved nothing. */
  blockedCount: number;
}

const EGRESS_PROBE_SOURCE = `import { defineApp, Screen, Stack, Heading } from 'vc-sdk';
function Probe() { return <Screen><Stack><Heading size="title">egress probe</Heading></Stack></Screen>; }
export default defineApp({ name: 'EgressProbe', initial: 'Probe', screens: { Probe }, capabilities: [] });
`;

/** Bounds each in-page probe attempt, so a blocked attempt that never settles still ends. */
const PROBE_ATTEMPT_MS = 2000;

/**
 * The probe's in-page half, run in the outer page's main frame by `page.evaluate` (serialized, so
 * it closes over nothing). Attempts a `no-cors` fetch and a WebSocket toward `host`, each bounded
 * by `budgetMs`, and resolves `true` iff the fetch got a response.
 */
async function attemptEgressInPage([host, budgetMs]: [string, number]): Promise<boolean> {
  const g = globalThis as unknown as {
    fetch(url: string, init: { mode: string }): Promise<unknown>;
    WebSocket: new (url: string) => { onclose: (() => void) | null; onerror: (() => void) | null };
    setTimeout(callback: () => void, ms: number): unknown;
  };
  const expire = (): Promise<void> => new Promise<void>((resolve) => g.setTimeout(resolve, budgetMs));
  const reached = await Promise.race([
    g.fetch(`http://${host}/probe`, { mode: 'no-cors' }).then(
      () => true,
      () => false,
    ),
    expire().then(() => false),
  ]);
  const socketSettled = new Promise<void>((resolve) => {
    const ws = new g.WebSocket(`ws://${host}/probe`);
    ws.onclose = () => resolve();
    ws.onerror = () => resolve();
  });
  await Promise.race([socketSettled, expire()]);
  return reached;
}

/**
 * Proves, on a live session, that a run cannot reach the network. Starts an HTTP canary on a
 * random loopback port, opens a real run (build, in-memory delivery, isolated context) and, from
 * the outer page's main frame, the most privileged realm in the run (no CSP, no neutralization),
 * attempts a `fetch` and a WebSocket toward the canary, then navigates the main frame to it from
 * the harness side. Passes only when the canary accepted no connection, neither the fetch nor the
 * navigation got through, and the interception counted the attempts.
 */
export async function probeEgressBlocked(session: SynthRunSession): Promise<EgressProbeResult> {
  let canaryConnections = 0;
  const canary = createServer((_req, res) => {
    res.end('canary');
  });
  canary.on('connection', () => {
    canaryConnections++;
  });
  await new Promise<void>((resolve, reject) => {
    canary.once('error', reject);
    canary.listen(0, '127.0.0.1', () => resolve());
  });
  const target = `127.0.0.1:${(canary.address() as AddressInfo).port}`;
  try {
    const { ctx, dispose } = await session.openRun(EGRESS_PROBE_SOURCE);
    try {
      const fetched = await ctx.page.evaluate(attemptEgressInPage, [target, PROBE_ATTEMPT_MS] as [string, number]);
      const navigated = await ctx.page.goto(`http://${target}/probe`, { timeout: PROBE_ATTEMPT_MS * 2 }).then(
        () => true,
        () => false,
      );
      const blockedCount = ctx.egress.count;
      return { blocked: canaryConnections === 0 && !fetched && !navigated && blockedCount > 0, canaryConnections, fetched, navigated, blockedCount };
    } finally {
      await dispose();
    }
  } finally {
    canary.closeAllConnections();
    await new Promise<void>((resolve) => canary.close(() => resolve()));
  }
}
