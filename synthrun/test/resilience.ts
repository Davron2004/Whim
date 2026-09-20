/**
 * Synthetic-run resilience acceptance (public-generation-server task 8.4): abort at every wait and
 * crash replacement. Spec §Abort is honoured at every wait in a run, §A crashed browser is replaced.
 *
 * Races are held open deliberately rather than timed: a run is parked in its pre-navigation hook
 * while another is aborted, and a browser is killed only once its run has navigated. Every await
 * that a regression could leave pending goes through `within`, whose ref'd timer turns a hang into
 * a named failure instead of a stalled suite.
 *
 * Called from `acceptance.ts` with that suite's own `test`/`ok` helpers.
 */
import { chromium, type BrowserContext, type LaunchOptions, type Page } from 'playwright';
import { createSemaphore } from '../concurrency';
import type { RunReport, Semaphore } from '../contract';
import { createRunCandidate } from '../report';
import { browserLaunchOptions, SessionError, SynthRunSession } from '../session';
import { hasSwitch, processArgs, SANDBOX_DISABLING_SWITCHES, type SuiteHooks } from './isolation';

/** The spec's bound on releasing an aborted or crashed run. */
const RELEASE_BOUND_MS = 5000;
/** Far above `RELEASE_BOUND_MS`, so a run that only ends when the mount budget fires fails the bound. */
const MOUNT_BUDGET_MS = 20000;
const HANGING_BUDGETS = { mountBudgetMs: MOUNT_BUDGET_MS, totalBudgetMs: 60000 };

const HARMLESS = `import { defineApp, Screen, Stack, Heading } from 'vc-sdk';
function Home() { return <Screen><Stack><Heading size="title">Harmless</Heading></Stack></Screen>; }
export default defineApp({ name: 'Harmless', initial: 'Home', screens: { Home }, capabilities: [] });
`;

/** Wedges the renderer before the first paint and never returns; the outer page's `load` still fires. */
const MOUNT_HANG = `import { defineApp, Screen, Stack, Heading } from 'vc-sdk';
for (;;) { /* never paints */ }
function Slow() { return <Screen><Stack><Heading size="title">Slow</Heading></Stack></Screen>; }
export default defineApp({ name: 'Slow', initial: 'Slow', screens: { Slow }, capabilities: [] });
`;

type Settled<T> = { ok: true; value: T } | { ok: false; error: Error };

/** Never rejects, so a promise can be held while the test awaits something else. */
function settle<T>(work: Promise<T>): Promise<Settled<T>> {
  return work.then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, error: error as Error }),
  );
}

/** `work`, or a rejection naming `what` once `ms` pass. */
async function within<T>(work: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expiry = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} did not settle within ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([work, expiry]);
  } finally {
    clearTimeout(timer);
  }
}

/** A promise and the function that resolves it. */
function latch(): { opened: Promise<void>; open: () => void } {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { opened, open };
}

/** The session's semaphore, recording every grant and every call to a release function. */
function countingSemaphore(maxConcurrent: number): { semaphore: Semaphore; grants: number; releases: number[] } {
  const inner = createSemaphore(maxConcurrent);
  const record = {
    grants: 0,
    releases: [] as number[],
    semaphore: {
      async acquire(signal?: AbortSignal): Promise<() => void> {
        const release = await inner.acquire(signal);
        record.grants++;
        return () => {
          record.releases.push(Date.now());
          release();
        };
      },
    },
  };
  return record;
}

/** Records every `chromium.launch` call the session makes, optionally failing the next one. */
function spyOnLaunch(): { calls: LaunchOptions[]; failNext(): void; restore(): void } {
  const original = chromium.launch;
  const calls: LaunchOptions[] = [];
  let failing = false;
  chromium.launch = (options?: LaunchOptions) => {
    calls.push(options ?? {});
    if (failing) {
      failing = false;
      return Promise.reject(new Error('simulated launch failure'));
    }
    return original.call(chromium, options);
  };
  return {
    calls,
    failNext: () => {
      failing = true;
    },
    restore: () => {
      chromium.launch = original;
    },
  };
}

function isSessionError(outcome: Settled<unknown>, name: SessionError['name']): boolean {
  return !outcome.ok && outcome.error instanceof SessionError && outcome.error.name === name;
}

function describe(outcome: Settled<unknown>): string {
  return outcome.ok ? 'resolved' : `${outcome.error.name}: ${outcome.error.message}`;
}

/** Starts a hanging run and resolves once its page has loaded, so the run is inside its mount wait.
 *  The run's own outcome is wrapped, since returning a bare promise would await the whole run. */
async function startHangingRun(runCandidate: ReturnType<typeof createRunCandidate>): Promise<{ outcome: Promise<Settled<RunReport>> }> {
  const loaded = latch();
  const outcome = settle(
    runCandidate(MOUNT_HANG, {
      budgets: HANGING_BUDGETS,
      beforeNavigate: async (page) => {
        page.once('load', () => loaded.open());
      },
    }),
  );
  await within(loaded.opened, 30000, 'the hanging run loading its page');
  return { outcome };
}

export async function testResilience(hooks: SuiteHooks): Promise<void> {
  await testSemaphore(hooks);
  await testAbortWhileQueued(hooks);
  await testAbortDuringMount(hooks);
  await testCrashRecovery(hooks);
  await testFailedRelaunch(hooks);
}

async function testSemaphore({ test, ok }: SuiteHooks): Promise<void> {
  // eslint-disable-next-line sonarjs/assertions-in-tests -- asserts via the house `ok()` helper.
  await test('concurrency: a waiter aborted while queued leaves the queue without ever holding the slot', async () => {
    const semaphore = createSemaphore(1);
    const releaseHolder = await within(semaphore.acquire(), 1000, 'the first acquire');
    const controller = new AbortController();
    const aborted = settle(semaphore.acquire(controller.signal));
    const behind = semaphore.acquire();
    controller.abort();
    const outcome = await within(aborted, 1000, 'the aborted waiter');
    ok(!outcome.ok && outcome.error.name === 'AbortError', `the aborted waiter rejects with an AbortError (got ${describe(outcome)})`);
    releaseHolder();
    // Were the aborted waiter still queued, the slot would go to it and this one would wait forever.
    const releaseBehind = await within(behind, 1000, 'the waiter queued behind the aborted one');
    ok(typeof releaseBehind === 'function', 'the freed slot goes to the next live waiter');

    const fresh = createSemaphore(1);
    const early = new AbortController();
    early.abort();
    const refused = await within(settle(fresh.acquire(early.signal)), 1000, 'an acquire with an aborted signal');
    ok(!refused.ok && refused.error.name === 'AbortError', `an already-aborted signal is refused at once (got ${describe(refused)})`);
    await within(fresh.acquire(), 1000, 'an acquire after the refused one, on a semaphore it must not have taken');
  });

  // eslint-disable-next-line sonarjs/assertions-in-tests -- asserts via the house `ok()` helper.
  await test('concurrency: calling a release twice frees one slot, not two', async () => {
    const semaphore = createSemaphore(1);
    const release = await within(semaphore.acquire(), 1000, 'the first acquire');
    release();
    release();
    const releaseSecond = await within(semaphore.acquire(), 1000, 'the second acquire');
    let thirdGranted = false;
    const third = semaphore.acquire().then((r) => {
      thirdGranted = true;
      return r;
    });
    // A grant resolves synchronously; one macrotask is ample for its continuation to have run.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    ok(!thirdGranted, 'while the second holder has the only slot, the third waits');
    releaseSecond();
    await within(third, 1000, 'the third acquire once the second releases');
  });
}

async function testAbortWhileQueued({ test, ok }: SuiteHooks): Promise<void> {
  // eslint-disable-next-line sonarjs/assertions-in-tests -- asserts via the house `ok()` helper.
  await test('abort: a run aborted while queued never opens a context, and the running one is unaffected (spec "An abort while queued never takes the slot")', async () => {
    const session = await SynthRunSession.launch({ concurrency: 1 });
    try {
      const runCandidate = createRunCandidate(session);
      const entered = latch();
      const gate = latch();
      const first = settle(
        runCandidate(HARMLESS, {
          beforeNavigate: async () => {
            entered.open();
            await gate.opened;
          },
        }),
      );
      await within(entered.opened, 30000, 'the first run reaching navigation');
      ok(session.openContextCount() === 1, `precondition: the first run holds the slot with its context open (got ${session.openContextCount()})`);

      const controller = new AbortController();
      let secondReachedNavigation = false;
      const second = settle(
        runCandidate(HARMLESS, {
          signal: controller.signal,
          beforeNavigate: async () => {
            secondReachedNavigation = true;
          },
        }),
      );
      controller.abort();
      const outcome = await within(second, RELEASE_BOUND_MS, 'the queued run after its abort');
      ok(!outcome.ok && outcome.error.name === 'AbortError', `the queued run ends with an AbortError while the first still holds the slot (got ${describe(outcome)})`);
      ok(!secondReachedNavigation, 'the queued run never reached navigation');
      ok(session.openContextCount() === 1, `only the first run's context is open (got ${session.openContextCount()})`);

      gate.open();
      const report = await within(first, 30000, 'the first run');
      ok(report.ok && report.value.ok && report.value.contained === true, `the first run completes with a clean report (got ${report.ok ? JSON.stringify(report.value.diagnostics) : describe(report)})`);

      const later = await within(session.openRun(HARMLESS), 30000, 'a run after both');
      ok(session.openContextCount() === 1, 'the slot is free for the next run');
      await later.dispose();
    } finally {
      await session.close();
    }
  });
}

async function testAbortDuringMount({ test, ok }: SuiteHooks): Promise<void> {
  // eslint-disable-next-line sonarjs/assertions-in-tests -- asserts via the house `ok()` helper.
  await test('abort: 250 ms into a hanging mount, the context closes and the slot frees within 5 s, once each (spec "An abort during mount releases promptly")', async () => {
    const counted = countingSemaphore(1);
    const session = await SynthRunSession.launch({ semaphore: counted.semaphore });
    try {
      const controller = new AbortController();
      let abortedAt = 0;
      let page: Page | undefined;
      const contextCloses: number[] = [];
      const run = settle(
        createRunCandidate(session)(MOUNT_HANG, {
          signal: controller.signal,
          budgets: HANGING_BUDGETS,
          beforeNavigate: async (p: Page, context: BrowserContext) => {
            page = p;
            context.on('close', () => contextCloses.push(Date.now()));
            p.once('load', () => {
              setTimeout(() => {
                abortedAt = Date.now();
                controller.abort();
              }, 250);
            });
          },
        }),
      );
      const outcome = await within(run, MOUNT_BUDGET_MS + 15000, 'the aborted run');
      const endedAt = Date.now();

      ok(abortedAt > 0, 'precondition: the abort fired after navigation');
      ok(outcome.ok, `the aborted run ends quietly with a report its caller discards (got ${describe(outcome)})`);
      ok(endedAt - abortedAt < RELEASE_BOUND_MS, `the run ended ${endedAt - abortedAt}ms after the abort, well before the ${MOUNT_BUDGET_MS}ms mount budget`);
      ok(outcome.ok && !outcome.value.diagnostics.some((d) => d.kind === 'mount_timeout'), 'the mount budget never fired');
      ok(contextCloses.length === 1 && contextCloses[0] - abortedAt < RELEASE_BOUND_MS, `the context closed once, within 5 s (closes ${JSON.stringify(contextCloses.map((t) => t - abortedAt))})`);
      ok(page?.isClosed() === true, 'the page is closed');
      ok(session.openContextCount() === 0, `the session has no open context (got ${session.openContextCount()})`);
      ok(counted.grants === 1 && counted.releases.length === 1, `the slot was released exactly once (grants ${counted.grants}, releases ${counted.releases.length})`);
      ok(counted.releases.length > 0 && counted.releases[0] - abortedAt < RELEASE_BOUND_MS, 'the release came within 5 s of the abort');

      const next = await within(session.openRun(HARMLESS), 30000, 'a run after the aborted one');
      await next.dispose();
    } finally {
      await session.close();
    }
  });
}

async function testCrashRecovery({ test, ok }: SuiteHooks): Promise<void> {
  // eslint-disable-next-line sonarjs/assertions-in-tests -- asserts via the house `ok()` helper.
  await test('crash: killing the browser mid-run ends that run with browser_disconnected, and the next run completes on a fresh sandboxed browser (spec "Runs recover after the browser dies")', async () => {
    const counted = countingSemaphore(1);
    const session = await SynthRunSession.launch({ semaphore: counted.semaphore });
    const launches = spyOnLaunch();
    try {
      const runCandidate = createRunCandidate(session);
      const pidBefore = await session.browserProcessId();
      const inProgress = await startHangingRun(runCandidate);

      process.kill(pidBefore, 'SIGKILL');
      const killedAt = Date.now();
      const outcome = await within(inProgress.outcome, MOUNT_BUDGET_MS + 15000, 'the run on the killed browser');
      ok(isSessionError(outcome, 'browser_disconnected'), `the in-progress run ends with browser_disconnected (got ${describe(outcome)})`);
      ok(Date.now() - killedAt < RELEASE_BOUND_MS, `and ends promptly, not when the mount budget fires (${Date.now() - killedAt}ms)`);
      ok(counted.releases.length === counted.grants, `its slot was released exactly once (grants ${counted.grants}, releases ${counted.releases.length})`);
      ok(launches.calls.length === 0, 'the session does not relaunch until a run needs the browser');

      const next = await within(settle(runCandidate(HARMLESS)), 60000, 'the run after the crash');
      ok(next.ok && next.value.ok && next.value.contained === true, `the next run completes with a normal report (got ${next.ok ? JSON.stringify(next.value.diagnostics) : describe(next)})`);
      ok(launches.calls.length === 1, `exactly one replacement was launched (got ${launches.calls.length})`);
      ok(JSON.stringify(launches.calls[0]) === JSON.stringify(browserLaunchOptions()), 'the replacement was launched with browserLaunchOptions()');

      const pidAfter = await session.browserProcessId();
      ok(pidAfter !== pidBefore, 'the next run ran on a different browser process');
      const args = processArgs(pidAfter);
      for (const name of SANDBOX_DISABLING_SWITCHES) ok(!hasSwitch(args, name), `the replacement browser was not started with ${name}`);
      ok(args.includes('--proxy-server=http://127.0.0.1:9') && hasSwitch(args, '--host-resolver-rules'), 'the replacement carries the dead proxy and the resolver rule');
    } finally {
      launches.restore();
      await session.close();
    }
  });
}

async function testFailedRelaunch({ test, ok }: SuiteHooks): Promise<void> {
  // eslint-disable-next-line sonarjs/assertions-in-tests -- asserts via the house `ok()` helper.
  await test('crash: a failed relaunch fails only the run that needed it, and later runs share one retried launch', async () => {
    const session = await SynthRunSession.launch({ concurrency: 2 });
    const launches = spyOnLaunch();
    try {
      const runCandidate = createRunCandidate(session);
      const inProgress = await startHangingRun(runCandidate);
      process.kill(await session.browserProcessId(), 'SIGKILL');
      const crashed = await within(inProgress.outcome, MOUNT_BUDGET_MS + 15000, 'the run on the killed browser');
      ok(isSessionError(crashed, 'browser_disconnected'), `precondition: the session saw the crash (got ${describe(crashed)})`);

      launches.failNext();
      const failed = await within(settle(runCandidate(HARMLESS)), 30000, 'the run whose relaunch fails');
      ok(isSessionError(failed, 'browser_launch_failed'), `the run that needed the browser ends with browser_launch_failed (got ${describe(failed)})`);
      ok(!failed.ok && failed.error.message.includes('simulated launch failure'), 'the error carries the launch failure');
      ok(session.openContextCount() === 0, 'nothing is left open');

      const [a, b] = await within(Promise.all([settle(runCandidate(HARMLESS)), settle(runCandidate(HARMLESS))]), 60000, 'two runs after the failed relaunch');
      ok(a.ok && a.value.contained === true && b.ok && b.value.contained === true, `both later runs complete normally (got ${describe(a)}, ${describe(b)})`);
      ok(launches.calls.length === 2, `the session retried once, and the two concurrent runs shared that launch (launches ${launches.calls.length})`);
    } finally {
      launches.restore();
      await session.close();
    }
  });
}
