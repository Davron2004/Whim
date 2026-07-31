/**
 * Chromium session lifecycle (design D4). One `chromium.launch()` per harness session; each
 * candidate gets a FRESH browser context + page (closed together when its run ends) — a
 * strictly stronger isolation boundary than the T7 iframe-recreation requirement, by
 * construction. Concurrency is bounded by a caller-set semaphore, scoped to the SESSION (not
 * repeated per call — see `contract.ts`'s `Semaphore` comment).
 *
 * `openRun` is the extension point later chains build on: chain 2 (observation/watchdog)
 * attaches its nonce-frame listener and `pageerror`/console capture to `ctx.page` right after
 * this returns and before driving anything; chain 3 (capability wiring) calls
 * `ctx.context.exposeFunction('whimHostDispatch', host.dispatch)` — which MUST happen before
 * `openRun`'s navigation for the exposed function to be available when the page's inline
 * scripts run, so chain 3 will need to extend `openRun` itself to accept a pre-navigate hook
 * (documented in `handoff/harness-core.md`) rather than layering it on from outside; chain 4
 * (the sweep) drives `ctx.page`; chain 5 (task 5.2) composes all of the above plus `dispose()`
 * into the full `RunCandidate` entry point `contract.ts` declares.
 */
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildCandidateSource } from './builder';
import { createSemaphore } from './concurrency';
import type { RunOptions, Semaphore, StageTimings } from './contract';
import { assembleCandidatePage } from './page';

const DEFAULT_CONCURRENCY = 4;

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
    const browser = await chromium.launch();
    const semaphore = opts.semaphore ?? createSemaphore(opts.concurrency ?? DEFAULT_CONCURRENCY);
    return new SynthRunSession(browser, semaphore);
  }

  /**
   * Build one candidate, assemble it into the unmodified production runtime page, open a
   * fresh browser context + page for it under the session's semaphore, and navigate.
   */
  async openRun(source: string, opts: RunOptions = {}): Promise<OpenRunResult> {
    const release = await this.semaphore.acquire();
    const runId = `${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
    const appId = opts.appId ?? runId;
    let context: BrowserContext | undefined;
    try {
      const buildStart = Date.now();
      const { js } = await buildCandidateSource(source, { filenameHint: runId });
      const buildMs = Date.now() - buildStart;

      const bootStart = Date.now();
      const html = await assembleCandidatePage(js, runId);
      const pageDir = await mkdtemp(join(tmpdir(), 'synthrun-page-'));
      const pagePath = join(pageDir, `${runId}.html`);
      await writeFile(pagePath, html, 'utf8');

      context = await this.browser.newContext();
      const page = await context.newPage();
      try {
        await page.goto(`file://${pagePath}`, { waitUntil: 'load', timeout: 20000 });
      } finally {
        await rm(pageDir, { recursive: true, force: true });
      }
      const bootMs = Date.now() - bootStart;

      const ctx: RunContext = { runId, appId, page, context, startedAt: bootStart, timings: { buildMs, bootMs } };
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

  /** Ends the session: closes the browser. Any run whose `dispose()` has not yet been called
   *  should be disposed first — this does not do it implicitly. */
  async close(): Promise<void> {
    await this.browser.close();
  }
}
