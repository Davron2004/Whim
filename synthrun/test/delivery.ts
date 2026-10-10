/**
 * synthrun-reach: a capability reply reaches the candidate realm. The assertions are on effects
 * that happen only after the candidate received a reply (a call it makes once an earlier one
 * resolved, a control that was disabled until a read resolved). A host-side trace entry for the
 * FIRST call is no evidence: the host records a call it answered whether or not the answer was
 * accepted in the realm.
 */
import nodeAssert from 'node:assert';
import type { BrowserContext, Page } from 'playwright';
import { buildCandidateSource } from '../builder';
import { assembleCandidatePage } from '../page';
import { awaitMount, mergeBudgets } from '../observe';
import { SynthRunSession } from '../session';
import { wireCapabilityBridge, type CapabilityWiring } from '../capability';
import { appRecordForSource } from '../report';
import { sweepApp } from '../sweep';
import { recordAssertion, test } from './harness';
import { flowbenchApp } from './flowbench';
import { openWiredRun, within } from './support';

function ok(cond: boolean, msg: string): void {
  recordAssertion(() => nodeAssert.ok(cond, msg), msg);
}

// Reads at mount and makes its second capability call only once the read resolved in the realm.
const FIXTURE_READ_THEN_WRITE = `import { defineApp, Screen, Stack, Heading, useEffect, storage } from 'vc-sdk';
function Home() {
  useEffect(() => {
    (async () => {
      await storage.kv.get('seed');
      await storage.kv.set('after-read', 'x');
    })().catch(() => {});
  }, []);
  return <Screen><Stack><Heading size="title">chain</Heading></Stack></Screen>;
}
export default defineApp({ name: 'ReadThenWrite', initial: 'Home', screens: { Home }, capabilities: ['storage'], schema: { schemaVersion: 1, collections: {} } });
`;

const STORAGE_APP = appRecordForSource(FIXTURE_READ_THEN_WRITE, 'delivery-storage');

/** How long the negative control watches for a call that must not come. The positive run gets its
 *  second call within tens of milliseconds, so this is two orders of magnitude of margin. */
const ABSENCE_WINDOW_MS = 1500;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Polls until `predicate` holds or `budgetMs` expires, then returns regardless; the caller asserts. */
async function waitUntil(predicate: () => boolean, budgetMs: number): Promise<void> {
  const deadline = Date.now() + budgetMs;
  while (Date.now() < deadline && !predicate()) await wait(15);
}

/** The origin the outer run page reports about itself. `self.origin` serialises the opaque origin of
 *  a sandboxed document as `null`; `location.origin` does not (it keeps the URL's), so it cannot
 *  tell the two deliveries apart. */
async function outerOrigin(page: Page): Promise<string> {
  return page.evaluate(() => (globalThis as unknown as { origin: string }).origin);
}

function syscalls(wiring: CapabilityWiring, method: string): number {
  return wiring.trace.filter((t) => t.kind === 'syscall' && t.method === method).length;
}

/**
 * A route registered after the context's own, so it answers first: it serves the SAME candidate
 * through the SAME page assembly, but with no response policy, so the page keeps its real origin.
 */
async function servePageWithoutPolicy(context: BrowserContext, source: string): Promise<void> {
  let served = false;
  await context.route('**/run/*', async (route) => {
    const request = route.request();
    if (served || !request.isNavigationRequest()) {
      await route.fallback();
      return;
    }
    served = true;
    const runId = new URL(request.url()).pathname.split('/').pop() ?? '';
    const { js } = await buildCandidateSource(source, { filenameHint: runId });
    await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: await assembleCandidatePage(js, runId) });
  });
}

export async function testReplyDelivery(): Promise<void> {
  const session = await SynthRunSession.launch({ concurrency: 2 });
  try {
    await test('reply delivery: a storage read made at mount resolves in the candidate, so its next call is made', async () => {
      const wiring = wireCapabilityBridge(STORAGE_APP);
      const { ctx, dispose } = await session.openRun(FIXTURE_READ_THEN_WRITE, { appId: STORAGE_APP.appId, beforeNavigate: wiring.beforeNavigate });
      try {
        await waitUntil(() => syscalls(wiring, 'storage.kv.set') > 0, 5000);
        ok((await outerOrigin(ctx.page)) === 'null', 'the run page is delivered as an opaque-origin document');
        ok(syscalls(wiring, 'storage.kv.get') === 1, `the mount read reached the host once (got ${syscalls(wiring, 'storage.kv.get')})`);
        ok(syscalls(wiring, 'storage.kv.set') === 1, `the write that only follows the resolved read reached the host (got ${syscalls(wiring, 'storage.kv.set')})`);
        ok(wiring.realm?.engine?.kv.get('after-read') === 'x', 'the write landed in the run\'s engine');
      } finally {
        await dispose();
      }
    });

    await test('reply delivery: a control disabled until two mount reads resolve is swept (water-counter-p1)', async () => {
      const source = flowbenchApp('water-counter-p1');
      const { ctx, obs, wiring, dispose } = await openWiredRun(session, source);
      try {
        const budgets = mergeBudgets({ mountBudgetMs: 5000, actionQuietMs: 300, actionHardCapMs: 1000 });
        await within(awaitMount(obs, budgets), 10000, 'the mount gate');
        // No wait of ours on the page: the sweep itself waits for the quiet window before it first
        // enumerates, so the button is enabled by the time it looks. If the replies never arrive,
        // the button stays disabled and the sweep acts on nothing.
        const result = await within(sweepApp(ctx, obs, source, budgets), 30000, 'the sweep');
        const labels = result.actionsLog.map((el) => el.label);
        ok(labels.some((l) => l.startsWith('Log a glass')), `the sweep pressed the gated button (acted on: ${labels.join(' ; ')})`);
        ok(labels.some((l) => l.startsWith('Undo')), `the press enabled "Undo", which the sweep then pressed (acted on: ${labels.join(' ; ')})`);
        ok(syscalls(wiring, 'storage.kv.set') >= 4, `the two presses wrote the day and the count each (got ${syscalls(wiring, 'storage.kv.set')} writes)`);
      } finally {
        await dispose();
      }
    });

    await test('reply delivery control: served with a real origin, the same candidate never makes its second call', async () => {
      const wiring = wireCapabilityBridge(STORAGE_APP);
      const beforeNavigate = async (page: Page, context: BrowserContext): Promise<void> => {
        await wiring.beforeNavigate(page, context);
        await servePageWithoutPolicy(context, FIXTURE_READ_THEN_WRITE);
      };
      const { ctx, dispose } = await session.openRun(FIXTURE_READ_THEN_WRITE, { appId: STORAGE_APP.appId, beforeNavigate });
      try {
        await waitUntil(() => syscalls(wiring, 'storage.kv.get') > 0, 5000);
        const origin = await outerOrigin(ctx.page);
        ok(origin !== 'null' && origin.startsWith('https://'), `the run page kept a real origin, which is the cause under test (got ${origin})`);
        ok(syscalls(wiring, 'storage.kv.get') === 1, 'the candidate ran and made its read, which the host answered');
        await wait(ABSENCE_WINDOW_MS);
        ok(syscalls(wiring, 'storage.kv.set') === 0, `the host's answer was dropped in the realm, so the dependent write never came (got ${syscalls(wiring, 'storage.kv.set')})`);
      } finally {
        await dispose();
      }
    });
  } finally {
    await session.close();
  }
}
