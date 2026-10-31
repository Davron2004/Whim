// Node acceptance suite for the SDK's motion helpers (docs/design/system.md §4; sdk-design-system
// "SDK motion uses the shell's springs and honours Reduce Motion", "SDK controls emit no haptics").
// What runs without a DOM: the one-time `linear()` gate and its fallback, the rAF spring against the
// build-time sample of the same spring, velocity kept across a retarget, the drag-release rules, and
// the controls' silence on the cue channel. What only a browser can show (WAAPI animations and the
// Reduce Motion pairs) is `motion.desktop.mjs`. Auto-discovered by `src/sdk/test/run.mjs`.
import assert from 'node:assert';
import * as React from 'react';
import { act, create, type ReactTestInstance } from 'react-test-renderer';
import { Checkbox, SegmentedControl, Slider, Stepper, Switch, cues } from '../index';
import {
  commits,
  createSpring,
  easedSpring,
  joinHandlers,
  matrixTranslateY,
  project,
  releaseVelocity,
  rubberBand,
  springTiming,
  translateY,
  type FrameScheduler,
} from '../motion';
import { SAMPLED_SPRINGS } from '../../design/generated/springs';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** A frame clock the test steps by hand, 60 frames a second. */
function frames(): FrameScheduler & { step(n?: number): void; pending(): number; now(): number } {
  let time = 0;
  let next = 0;
  const queued = new Map<number, (t: number) => void>();
  return {
    request(callback) {
      next += 1;
      queued.set(next, callback);
      return next;
    },
    cancel(handle) {
      queued.delete(handle);
    },
    step(n = 1) {
      for (let i = 0; i < n; i++) {
        time += 1000 / 60;
        const due = [...queued.values()];
        queued.clear();
        for (const callback of due) callback(time);
      }
    },
    pending: () => queued.size,
    now: () => time,
  };
}

const g = globalThis as { CSS?: unknown; __whimSyscall?: unknown; window?: unknown };
try {
  // ── The `linear()` gate: asked once, cubic-bezier where unsupported ──────────
  {
    const asked: string[][] = [];
    g.CSS = {
      supports(property: string, value: string): boolean {
        asked.push([property, value]);
        return false;
      },
    };
    const first = springTiming('smooth');
    const second = springTiming('snappy');
    assert.deepStrictEqual(asked, [['animation-timing-function', 'linear(0, 1)']], 'the engine is asked about linear() once per realm');
    assert.deepStrictEqual(first, { duration: SAMPLED_SPRINGS.smooth.durationMs, easing: SAMPLED_SPRINGS.smooth.cubicBezier }, 'without linear() a spring plays its nearest cubic-bezier over its settled duration');
    assert.deepStrictEqual(second.easing, SAMPLED_SPRINGS.snappy.cubicBezier, 'and the answer is kept');
    assert.deepStrictEqual(easedSpring(SAMPLED_SPRINGS.fling, true).easing, SAMPLED_SPRINGS.fling.linear, 'with linear() it plays the sampled curve');
  }

  // ── The rAF spring is the token module's spring ─────────────────────────────
  // The generator samples each spring's step response; the rAF spring integrates the same
  // stiffness and damping, so at the sample's 95% time it stands at 95% of the way.
  for (const name of ['snappy', 'smooth', 'fling'] as const) {
    const clock = frames();
    const spring = createSpring(name, () => undefined, 0, clock);
    spring.to(100);
    clock.step(Math.round(SAMPLED_SPRINGS[name].t95Ms / (1000 / 60)));
    assert.ok(Math.abs(spring.value - 95) < 4, `${name}: at its sampled 95% time the rAF spring is at ${spring.value.toFixed(1)} of 100`);
  }

  // ── A retarget keeps the velocity it had (rule 2) ────────────────────────────
  {
    const clock = frames();
    const moving = createSpring('smooth', () => undefined, 0, clock);
    moving.to(100);
    clock.step(6);
    const { value, velocity } = moving;
    assert.ok(velocity > 0, 'heading for 100 it moves forward');
    moving.to(0);
    assert.deepStrictEqual(moving.velocity, velocity, 'a new target keeps the current velocity');

    // The same place, at rest, sent to the same target: the moving one carries its momentum on.
    const still = createSpring('smooth', () => undefined, value, clock);
    still.to(0);
    clock.step(1);
    assert.ok(moving.value > still.value, `one frame on, the retargeted spring is still carried forward (${moving.value.toFixed(2)} vs ${still.value.toFixed(2)} from rest)`);
    assert.ok(Math.abs(moving.value - value) < Math.abs(velocity) / 60 + 1, 'and it did not jump');
  }

  // ── It comes to rest on its target, says so once, and stops asking for frames ─
  {
    const clock = frames();
    const written: number[] = [];
    let rests = 0;
    const spring = createSpring('snappy', (v) => written.push(v), 0, clock);
    spring.onRest = () => rests++;
    spring.to(40);
    clock.step(120);
    assert.deepStrictEqual([spring.value, spring.velocity, written[written.length - 1]], [40, 0, 40], 'at rest it shows exactly its target');
    assert.deepStrictEqual([rests, clock.pending()], [1, 0], 'onRest fires once and no frame is pending');

    const noFrames = createSpring('snappy', (v) => written.push(v), 0, null);
    noFrames.to(12);
    assert.deepStrictEqual(noFrames.value, 12, 'with no animation frames it is at its target at once');
  }

  // ── Drag release (system.md §4.3 rule 6) ─────────────────────────────────────
  {
    assert.ok(Math.abs(project(100, 1000) - 599) < 1e-9, 'a release at 1000 px/s projects 499 px on (0.998 deceleration)');
    assert.ok(!commits(400, -50, 300), 'past the threshold but moving back: position alone never commits');
    assert.ok(commits(400, 0, 300), 'past the threshold at rest: it commits');
    assert.ok(commits(100, 800, 300), 'short of the threshold, flung past it: it commits');
    assert.ok(!commits(100, 100, 300), 'short of it and slow: it springs back');

    const pulls = [10, 100, 1000].map((o) => rubberBand(o, 600));
    assert.ok(pulls.every((p, i) => p < [10, 100, 1000][i]) && pulls[0] < pulls[1] && pulls[1] < pulls[2], `past a bound it follows less and less (${pulls.map((p) => p.toFixed(1)).join(', ')})`);
    assert.ok(rubberBand(-100, 600) === -rubberBand(100, 600), 'in either direction');

    const v = releaseVelocity([{ t: 0, y: 0 }, { t: 400, y: 10 }, { t: 450, y: 30 }, { t: 500, y: 60 }]);
    assert.deepStrictEqual(v, 500, 'release velocity reads the last 100 ms only (50 px in 100 ms, not the slow start)');
    assert.deepStrictEqual(releaseVelocity([{ t: 0, y: 5 }]), 0, 'one sample has no velocity');
  }

  // ── Reading what is on screen ────────────────────────────────────────────────
  {
    assert.deepStrictEqual(matrixTranslateY('matrix(1, 0, 0, 1, 0, 42.5)'), 42.5);
    assert.deepStrictEqual(matrixTranslateY('matrix3d(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 3, -7, 0, 1)'), -7);
    assert.deepStrictEqual([matrixTranslateY('none'), translateY('none'), translateY('4px'), translateY('0px 12px')], [0, 0, 0, 12]);
    const order: string[] = [];
    const joined = joinHandlers({ onPointerDown: () => order.push('own') }, { onPointerDown: () => order.push('press'), onPointerUp: () => order.push('up') });
    joined.onPointerDown();
    (joined as { onPointerUp?: () => void }).onPointerUp?.();
    assert.deepStrictEqual(order, ['own', 'press', 'up'], 'joined handlers run both, the element’s own first');
  }

  // ── Controls emit no haptics (sdk-design-system "SDK controls emit no haptics") ─
  {
    const calls: string[] = [];
    g.__whimSyscall = {
      call(method: string): Promise<unknown> {
        calls.push(method);
        return Promise.resolve({});
      },
    };
    await cues.haptic('tap');
    assert.deepStrictEqual(calls, ['cues.haptic'], 'the stub sees a cue syscall when one is made');
    calls.length = 0;

    let value = false;
    const onChange = (next: boolean): void => {
      value = next;
    };
    let renderer: ReturnType<typeof create> | undefined;
    act(() => {
      renderer = create(
        <>
          <Switch label="Remind me" value={value} onChange={onChange} />
          <Checkbox label="Stretch" checked={value} onChange={onChange} />
          <Stepper label="Laps" value={1} onChange={() => undefined} />
          <SegmentedControl options={['Easy', 'Fast']} value="Easy" onChange={() => undefined} />
          <Slider value={10} onChange={() => undefined} />
        </>,
      );
    });
    const root = renderer!.root;
    const press = (node: ReactTestInstance): void => {
      act(() => {
        node.props.onPointerDown?.({ clientX: 0, clientY: 0 });
        node.props.onPointerUp?.();
        node.props.onClick?.({ detail: 1 });
      });
    };
    press(root.find((n) => n.props?.role === 'switch'));
    press(root.find((n) => n.props?.role === 'checkbox'));
    press(root.find((n) => n.type === 'button' && n.props?.['aria-label'] === 'Increase'));
    press(root.findAll((n) => n.props?.role === 'radio')[1]);
    assert.deepStrictEqual(value, true, 'the toggles did toggle');
    await Promise.resolve();
    assert.deepStrictEqual(calls, [], 'toggling, stepping and choosing made no cue syscall');
  }
} finally {
  delete g.CSS;
  delete g.__whimSyscall;
}

console.log('SDK motion acceptance: PASS');
