/**
 * Mini-app boot state (`app-launcher`: "The mini-app container shows a boot state before first
 * paint"; flow-wait-hygiene chain-4).
 *
 * The branch decision (`miniAppSurface`), the paint frame's trust fence (`paintAccepted`) and the
 * startup deadline are pure and exercised directly. The rendered container — the boot surface over
 * a mounted WebView, a rebind's fresh boot state, which paint frames it accepts — is in
 * `mini-app-host-ui.suite.tsx`.
 */

import { Harness } from './harness';
import {
  createStartupDeadline,
  hasPainted,
  miniAppSurface,
  paintAccepted,
  type StartupDeadlineScheduler,
} from '../boot-state';

type ScheduledTask = {
  callback: () => void;
  dueAt: number;
  cancelled: boolean;
};

class FakeClock implements StartupDeadlineScheduler {
  now = 0;
  readonly tasks: ScheduledTask[] = [];

  set(callback: () => void, delayMs: number): unknown {
    const task = { callback, dueAt: this.now + delayMs, cancelled: false };
    this.tasks.push(task);
    return task;
  }

  clear(handle: unknown): void {
    (handle as ScheduledTask).cancelled = true;
  }

  advanceBy(ms: number): void {
    this.now += ms;
    for (const task of this.tasks) {
      if (!task.cancelled && task.dueAt <= this.now) {
        task.cancelled = true;
        task.callback();
      }
    }
  }
}

export async function runBootStateTests(h: Harness): Promise<void> {
  await h.test('boot-state: "has painted" is derived from paintMs, with no separate signal', () => {
    h.eq(hasPainted(null), false, 'no paint frame yet');
    h.eq(hasPainted(0), true, 'a zero-millisecond first paint still counts as painted');
    h.eq(hasPainted(42), true, 'a normal first paint counts as painted');
  });

  // Scenario: a realm is bound and has not painted → the boot state, not a blank WebView.
  await h.test('boot-state: bound but not yet painted shows the boot surface', () => {
    h.eq(
      miniAppSurface({ launchFailed: false, lastError: null, paintMs: null }),
      'boot',
      'an unpainted, healthy realm shows the boot state',
    );
  });

  // Scenario: first paint lands → the boot state is gone and the mini-app is visible.
  await h.test('boot-state: first paint replaces the boot surface with the running realm', () => {
    h.eq(
      miniAppSurface({ launchFailed: false, lastError: null, paintMs: 12 }),
      'running',
      'once painted, nothing overlays the mini-app',
    );
  });

  // Scenario: the launch fails before any paint → the failure state, NOT the boot state.
  await h.test('boot-state: a launch failure before any paint wins over the boot surface', () => {
    h.eq(
      miniAppSurface({ launchFailed: true, lastError: 'launch X: schema — hint', paintMs: null }),
      'launch-failed',
      'an unpainted launch failure must show the failure copy, never a permanent opening screen',
    );
    h.eq(
      miniAppSurface({ launchFailed: false, lastError: 'app never became visible', paintMs: null }),
      'app-error',
      'an unpainted post-delivery failure must show the error copy, never the boot state',
    );
  });

  // Scenario: because `bind()` resets the paint signal, the boot state is only honest if a paint
  // frame a bundle posts for ITSELF cannot end it — while every authentic paint does end it.
  await h.test('boot-state: only an authenticated paint frame ends the boot state', () => {
    h.eq(paintAccepted({ trusted: true, payload: { generation: 7, mountToFirstPaintMs: 4 } }), true, 'an authentic paint is accepted');
    h.eq(paintAccepted({ trusted: false, payload: { generation: 7 } }), false, 'an unauthenticated paint is refused');
    h.eq(paintAccepted({ payload: { generation: 7 } }), false, 'a frame with no trust stamp at all is refused');
    h.eq(paintAccepted({ trusted: 'yes' }), false, 'and a truthy-but-not-true stamp is refused');
    h.eq(paintAccepted({ trusted: true }), false, 'a payload-less authentic frame cannot complete startup');
    h.eq(paintAccepted(null), false, 'and a missing frame is refused');
  });

  await h.test('boot-state: an attempted delivery with no page frames expires after six seconds', () => {
    const clock = new FakeClock();
    let failures = 0;
    const deadline = createStartupDeadline(() => { failures += 1; }, clock);

    deadline.begin();
    clock.advanceBy(5_999);
    h.eq(failures, 0, 'the full startup allowance remains available');
    clock.advanceBy(1);
    h.eq(failures, 1, 'a frame-free startup reaches the app error deadline');
  });

  await h.test('boot-state: accepted delivery restarts the paint allowance and trusted paint completes it', () => {
    const clock = new FakeClock();
    let failures = 0;
    const deadline = createStartupDeadline(() => { failures += 1; }, clock);

    deadline.begin();
    clock.advanceBy(5_000);
    deadline.begin();
    clock.advanceBy(5_000);
    h.eq(failures, 0, 'accepted delivery starts a fresh six-second paint allowance');
    h.eq(deadline.acceptPaint({ trusted: true, payload: { mountToFirstPaintMs: 25 } }), true, 'trusted paint completes startup');
    clock.advanceBy(10_000);
    h.eq(failures, 0, 'completed startup cannot fail later');
  });

  await h.test('boot-state: untrusted paint cannot cancel the attempted-delivery deadline', () => {
    const clock = new FakeClock();
    let failures = 0;
    const deadline = createStartupDeadline(() => { failures += 1; }, clock);

    deadline.begin();
    h.eq(deadline.acceptPaint({ trusted: false, payload: { mountToFirstPaintMs: 2 } }), false, 'forged paint is refused');
    clock.advanceBy(6_000);
    h.eq(failures, 1, 'the original deadline remains armed');
  });

  await h.test('boot-state: malformed trusted paint stays booting until the deadline reports app error', () => {
    const malformed = [
      { trusted: true },
      { trusted: true, payload: null },
      { trusted: true, payload: {} },
      { trusted: true, payload: { mountToFirstPaintMs: null } },
      { trusted: true, payload: { mountToFirstPaintMs: '4' } },
      { trusted: true, payload: { mountToFirstPaintMs: Number.NaN } },
      { trusted: true, payload: { mountToFirstPaintMs: Number.POSITIVE_INFINITY } },
      { trusted: true, payload: { mountToFirstPaintMs: -0.01 } },
    ];

    for (const frame of malformed) {
      const clock = new FakeClock();
      let failures = 0;
      let lastError: string | null = null;
      const deadline = createStartupDeadline(() => {
        failures += 1;
        lastError ??= 'app never became visible';
      }, clock);

      deadline.begin();
      h.eq(deadline.acceptPaint(frame), false, 'malformed trusted paint is rejected');
      h.eq(
        miniAppSurface({ launchFailed: false, lastError, paintMs: null }),
        'boot',
        'malformed paint cannot dismiss Opening before the deadline',
      );
      clock.advanceBy(6_000);
      h.eq(failures, 1, 'malformed paint leaves the deadline armed');
      h.eq(
        miniAppSurface({ launchFailed: false, lastError, paintMs: null }),
        'app-error',
        'the existing app-error surface replaces Opening at the deadline',
      );
      clock.advanceBy(6_000);
      h.eq(failures, 1, 'the expired deadline reports the failure exactly once');
    }
  });

  await h.test('boot-state: finite zero timing completes startup', () => {
    const clock = new FakeClock();
    let failures = 0;
    const deadline = createStartupDeadline(() => { failures += 1; }, clock);

    deadline.begin();
    h.eq(deadline.acceptPaint({ trusted: true, payload: { mountToFirstPaintMs: 0 } }), true, 'zero is a valid measured paint time');
    h.eq(
      miniAppSurface({ launchFailed: false, lastError: null, paintMs: 0 }),
      'running',
      'zero timing still removes the boot surface',
    );
    clock.advanceBy(12_000);
    h.eq(failures, 0, 'valid zero timing cancels the deadline');
  });

  await h.test('boot-state: reset and retry invalidate stale callbacks from older attempts', () => {
    const clock = new FakeClock();
    let failures = 0;
    const deadline = createStartupDeadline(() => { failures += 1; }, clock);

    deadline.begin();
    const firstAttempt = clock.tasks[0];
    deadline.cancel();
    deadline.begin();
    firstAttempt.callback();
    h.eq(failures, 0, 'a cleared callback cannot poison the retry');
    clock.advanceBy(6_000);
    h.eq(failures, 1, 'the current retry still owns a live deadline');
  });

  await h.test('boot-state: exit, unmount, and a fatal error preserve terminal state', () => {
    const clock = new FakeClock();
    let error: string | null = null;
    const deadline = createStartupDeadline(() => { error ??= 'app never became visible'; }, clock);

    deadline.begin();
    const fatalAttempt = clock.tasks[0];
    error = 'bundle: immediate fatal failure';
    deadline.cancel();
    fatalAttempt.callback();
    h.eq(error, 'bundle: immediate fatal failure', 'a stale timeout cannot replace the real fatal error');

    error = null;
    deadline.begin();
    deadline.cancel();
    deadline.cancel();
    clock.advanceBy(10_000);
    h.eq(error, null, 'exit and unmount cancellation are idempotent');
  });

}
