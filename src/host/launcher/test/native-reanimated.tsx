/** react-native-reanimated (and react-native-worklets' `scheduleOnRN`, held by `holdHops`; `scheduleOnUI` and the JS
 *  thread's writes to shared values and animated refs, held by `holdWrites`; `createSynchronizable`) for React interaction tests. Nothing runs on a UI thread: assigning an
 *  animation to a shared value records it in `animations` (oldest first) and jumps the value to
 *  where the animation ends, so a test reads what motion a control asked for — the target, the
 *  spring or timing config, delays, sequences and repeats — and the style it settles in.
 *  `useAnimatedStyle` evaluates its updater at render and re-renders when a shared value it read
 *  changes, as the UI thread would repaint. An animation's end callback runs as it is assigned, unless
 *  the test holds animations (`holdAnimations`) to look at a frame while one is still running;
 *  `elapse` then moves held timings along their curves, `elapseSprings` held springs by their physics. `makeMutable` makes a value outside React.
 *  `Animated.View`, `.Text` and `.ScrollView` render as host elements of those names and log the
 *  layout animations (`FadeIn`, `FadeOut`, `LinearTransition`, `FadingTransition` and their builder calls) they enter and
 *  exit with in `layoutAnimations`; `playedUnder` says what one does under Reduce Motion.
 *  Each mount of an Animated view is a native view of its own (`viewTagOf`).
 *  `useAnimatedReaction` reacts synchronously, `measure` reports `measuredRect` (or a view's own, `measuring`) in a worklet
 *  on the UI thread (and counts the warning Reanimated logs for a ref on no view, `measureWarnings`) — a reaction, a native event's handler, a `useAnimatedStyle` run a shared value made — and null on
 *  the JS thread, which includes a style's run a render made (Reanimated computes a style on the JS thread only as it
 *  mounts). Springs move and end as Reanimated 4.8's do (spring.ts is unchanged since 4.6), the callbacks inside delays, sequences and repeats hear how
 *  they ended, and a component's shared values cancel their animations as it unmounts. The double's own contract is
 *  `native-reanimated.suite.tsx`. */
import React from 'react';

type HostProps = { children?: React.ReactNode; [key: string]: unknown };

/** A single spring or timing toward a value, and what it calls once it ends. */
export interface Step {
  kind: 'spring' | 'timing';
  to: unknown;
  config: Record<string, unknown> | undefined;
  callback?: (finished: boolean) => void;
}
export type Animation =
  | Step
  | { kind: 'delay'; delay: number; animation: Animation }
  | { kind: 'sequence'; animations: Animation[] }
  | { kind: 'repeat'; animation: Animation; count: number };

const ANIMATION = Symbol('animation');
type Tagged = Animation & { [ANIMATION]: true };

export const isStep = (a: Animation): a is Step => a.kind === 'spring' || a.kind === 'timing';

/** Every animation assigned to any shared value, oldest first; splice to reset. */
export const animations: Animation[] = [];
/** How many times `cancelAnimation` ran, and the shared values it ran on, oldest first. */
export const cancelled: { count: number; values: unknown[] } = { count: 0, values: [] };

const tag = (a: Animation): Animation => Object.assign(a, { [ANIMATION]: true as const });
const isAnimation = (v: unknown): v is Tagged => typeof v === 'object' && v !== null && ANIMATION in v;

/** Where an animation comes to rest (a repeat rests on its inner animation's end). */
function settle(a: Animation): unknown {
  switch (a.kind) {
    case 'spring':
    case 'timing':
      return a.to;
    case 'delay':
    case 'repeat':
      return settle(a.animation);
    case 'sequence':
      return settle(a.animations[a.animations.length - 1]);
  }
}

/** The shared values an updater reads while `useAnimatedStyle` runs it. */
let reading: Set<SharedValue<unknown>> | null = null;

/** While a test holds them, the ends of the animations assigned since: each is still running, as on
 *  the UI thread, until the test lets them end. */
let held: (() => void)[] | null = null;

/** The shared values a held timing is running on, which `elapse` moves along. */
const timed = new Set<SharedValue<unknown>>();
/** The shared values a held spring is running on, which `elapse` moves when asked to. */
const sprung = new Set<SharedValue<unknown>>();

/** Reanimated's default timing curve, `Easing.inOut(Easing.quad)`. */
const inOutQuad = (x: number) => (x < 0.5 ? 2 * x * x : 1 - 2 * (1 - x) * (1 - x));

/** The curve `Easing.bezier(x1, y1, x2, y2)` draws: the time share `x` is found on the curve's x by
 *  bisection (x rises with t for control points inside 0…1), and its y read there. */
function bezierCurve([x1, y1, x2, y2]: readonly number[]): (x: number) => number {
  const at = (a: number, b: number, t: number) => 3 * (1 - t) * (1 - t) * t * a + 3 * (1 - t) * t * t * b + t * t * t;
  return (x) => {
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      if (at(x1, x2, mid) < x) lo = mid;
      else hi = mid;
    }
    return at(y1, y2, (lo + hi) / 2);
  };
}
const isBezier = (v: unknown): v is { bezier: number[] } => typeof v === 'object' && v !== null && Array.isArray((v as { bezier?: unknown }).bezier);

/** From now on an assigned animation keeps running: its value stays where it was and its end callback
 *  waits. The returned release ends every one of them, oldest first, as they would have. */
export function holdAnimations(): () => void {
  held = [];
  return () => {
    const ends = held ?? [];
    held = null;
    for (const end of ends) end();
  };
}

/** What an animation's end tells the callbacks inside it, as Reanimated's wrappers pass it on: a
 *  spring or timing hears it itself (valueSetter.ts:15, :61); a delay passes it to the animation it
 *  delays (delay.ts:100-104); a sequence calls each part's as that part ends, in order
 *  (sequence.ts:113-115), and, cut short, every part's that had not ended with false
 *  (sequence.ts:93-105); a repeat calls its animation's on every repetition (repeat.ts:64-66) and,
 *  cut short, with false (repeat.ts:93-101). An endless repeat never ends, so landing calls none. */
function tell(animation: Animation, finished: boolean): void {
  switch (animation.kind) {
    case 'spring':
    case 'timing':
      animation.callback?.(finished);
      return;
    case 'delay':
      tell(animation.animation, finished);
      return;
    case 'sequence':
      for (const part of animation.animations) tell(part, finished);
      return;
    case 'repeat':
      if (!finished) tell(animation.animation, false);
      else for (let rep = 0; rep < animation.count; rep++) tell(animation.animation, true);
  }
}

/** A spring as Reanimated 4.6 runs it, set up by its `onStart` (spring.ts:159-245). */
interface SpringState {
  to: number;
  /** Where it set out from, as a displacement from `to` (spring.ts:172-178). */
  startValue: number;
  velocity: number;
  zeta: number;
  omega0: number;
  omega1: number;
  stiffness: number;
  mass: number;
  overshootClamping: boolean;
  energyThreshold: number;
  /** Its energy at the start, from `startValue` and the config's own velocity (spring.ts:232-238). */
  initialEnergy: number;
}

/** What `withSpring` merges a config over (spring.ts:65-73; GentleSpringConfig and
 *  GentleSpringConfigWithDuration, springConfigs.ts:28-37), dropping keys given as undefined
 *  (springUtils.ts:71-88). */
interface SpringConfig {
  mass: number;
  stiffness: number;
  damping: number;
  duration: number;
  dampingRatio: number;
  overshootClamping: boolean;
  energyThreshold: number;
  velocity: number;
  clamp?: unknown;
}
const SPRING_DEFAULTS: SpringConfig = { mass: 4, stiffness: 900, damping: 120, duration: 550, dampingRatio: 1, overshootClamping: false, energyThreshold: 6e-9, velocity: 0 };

function springConfigOf(given: Record<string, unknown> | undefined) {
  const user = Object.fromEntries(Object.entries(given ?? {}).filter(([, v]) => v !== undefined));
  const config = { ...SPRING_DEFAULTS, ...user } as SpringConfig;
  // A duration or a damping ratio puts the spring in duration mode (spring.ts:80), whose stiffness
  // Reanimated solves for by bisection; a clamp rescales its damping (springUtils.ts:162).
  const unmodelled = Boolean(user.duration || user.dampingRatio) || config.clamp !== undefined;
  // An invalid config, or a zero duration, ends on the first frame (spring.ts:86-90, springUtils.ts:40-69).
  const invalid = (['stiffness', 'damping', 'dampingRatio', 'mass', 'energyThreshold'] as const).some((key) => config[key] <= 0) || config.duration <= 0;
  return { config, unmodelled, skip: invalid };
}

/** springUtils.ts:226-236. */
const energyOf = (displacement: number, velocity: number, stiffness: number, mass: number) => 0.5 * stiffness * displacement ** 2 + 0.5 * mass * velocity ** 2;

/** One frame of `dt` seconds from where the spring is (spring.ts:104-133): Reanimated's closed forms,
 *  the under-damped one below ζ 1 and the critically damped one at or above it
 *  (springUtils.ts:307-368). */
function springStep(s: SpringState, current: number, dt: number): { position: number; velocity: number } {
  const x0 = current - s.to;
  const v0 = s.velocity;
  if (s.zeta < 1) {
    const sin1 = Math.sin(s.omega1 * dt);
    const cos1 = Math.cos(s.omega1 * dt);
    const envelope = Math.exp(-s.zeta * s.omega0 * dt);
    const frag = envelope * (sin1 * ((v0 + s.zeta * s.omega0 * x0) / s.omega1) + x0 * cos1);
    return { position: s.to + frag, velocity: -s.zeta * s.omega0 * frag + envelope * (cos1 * (v0 + s.zeta * s.omega0 * x0) - s.omega1 * x0 * sin1) };
  }
  const envelope = Math.exp(-s.omega0 * dt);
  return {
    position: s.to + envelope * (x0 + (v0 + s.omega0 * x0) * dt),
    velocity: envelope * -s.omega0 * (x0 + (v0 + s.omega0 * x0) * dt) + envelope * (v0 + s.omega0 * x0),
  };
}

/** Whether the spring has ended where it now is (springUtils.ts:370-395): out of its start-to-target
 *  span with `overshootClamping`, or once its energy is down to `energyThreshold` of what it set out
 *  with — a share, so a move of 400 points ends when a move of 1 does. */
function springEnded(s: SpringState, current: number): boolean {
  if (s.overshootClamping) {
    const left = s.startValue >= 0 ? s.to : s.to + s.startValue;
    if (current < left || current > left + Math.abs(s.startValue)) return true;
  }
  return s.initialEnergy === 0 || energyOf(s.to - current, s.velocity, s.stiffness, s.mass) / s.initialEnergy <= s.energyThreshold;
}

/** The animation Reanimated still keeps on a value (`_animation`), which the next spring's `onStart`
 *  reads: a running spring's state, or what an ended one left (a spring zeroes its velocity as it
 *  ends, spring.ts:136; any other kind has none, which reads as NaN). A plain assignment or a cancel
 *  clears it (valueSetter.ts:10-17). */
type Prior = { velocity: number; running: SpringState | null } | null;

/** What an animation that ended leaves on the value. */
const endedPrior = (animation: Animation): Prior => ({ velocity: animation.kind === 'spring' ? 0 : NaN, running: null });

/** What a held animation cut short leaves for the next one: a modelled spring its state as it moves. */
function cutShortPrior(was: Running): Prior {
  const spring = was.spring === 'unmodelled' ? null : was.spring;
  return { velocity: spring ? spring.velocity : NaN, running: spring };
}

/** The velocity a spring sets out with (spring.ts:180-187): carried on from the same spring re-aimed,
 *  added to the config's from any other, or the config's alone; NaN (no velocity) reads as 0. */
function startVelocity(prior: Prior, twice: SpringState | null, configVelocity: number): number {
  if (!prior) return configVelocity || 0;
  return (twice ? twice.velocity : prior.velocity + configVelocity) || 0;
}

/** The damping ratio and frequencies of a physics-mode config (springUtils.ts:146-153). */
function springShape(config: SpringConfig): Pick<SpringState, 'zeta' | 'omega0' | 'omega1'> {
  const zeta = config.damping / (2 * Math.sqrt(config.stiffness * config.mass));
  const omega0 = Math.sqrt(config.stiffness / config.mass);
  return { zeta, omega0, omega1: zeta < 1 ? omega0 * Math.sqrt(1 - zeta ** 2) : 0 };
}

/** A spring's `onStart` (spring.ts:159-245) from `from`, after `prior`. */
function startSpring(step: Step, from: number, prior: Prior): SpringState | 'unmodelled' | 'skip' {
  const { config, unmodelled, skip } = springConfigOf(step.config);
  if (skip) return 'skip';
  if (unmodelled) return 'unmodelled';
  const to = step.to as number;
  // Assigned again toward the same target while it runs, it carries on from where it first set out
  // (spring.ts:146-157, :172-176, :199-202).
  const twice = prior?.running?.to === to ? prior.running : null;
  const startValue = twice ? twice.startValue : from - to;
  let velocity = startVelocity(prior, twice, config.velocity);
  // A velocity that would carry it away from the target is dropped (spring.ts:189-197).
  if ((to > from && velocity < 0) || (to < from && velocity > 0)) velocity = 0;
  const { zeta, omega0, omega1 } = twice ?? springShape(config);
  return {
    to,
    startValue,
    velocity,
    zeta,
    omega0,
    omega1,
    stiffness: config.stiffness,
    mass: config.mass,
    overshootClamping: Boolean(config.overshootClamping),
    energyThreshold: config.energyThreshold,
    initialEnergy: energyOf(startValue, config.velocity, config.stiffness, config.mass),
  };
}

interface Running {
  animation: Tagged;
  end: () => void;
  from: unknown;
  elapsed: number;
  /** A spring's state as it moves; `unmodelled` for a spring this double cannot follow. */
  spring: SpringState | 'unmodelled' | null;
}

class SharedValue<T> {
  private current: T;
  /** The held animation running on this value, if any: where it set out from and how long it has run. */
  private running: Running | null = null;
  private prior: Prior = null;
  /** Bumped on every assignment, so a style can tell it missed one. */
  version = 0;
  private readonly listeners = new Set<() => void>();
  constructor(initial: T) { this.current = initial; }
  get value(): T {
    if (!onUiThread) jsThreadReads.count += 1;
    reading?.add(this as SharedValue<unknown>);
    return this.current;
  }
  set value(next: T) {
    if (writes !== null && !onUiThread) {
      writes.push(() => { this.value = next; });
      return;
    }
    const was = this.running;
    this.interrupt();
    if (isAnimation(next)) {
      this.start(next, was ? cutShortPrior(was) : this.prior);
      return;
    }
    this.prior = null;
    this.current = next;
    this.changed();
  }
  /** The 4.x accessor; reads (and so subscribes) like `.value`. */
  get(): T { return this.value; }
  /** An animation assigned here, after `prior` (valueSetter.ts:18-69). */
  private start(next: Tagged, prior: Prior): void {
    animations.push(next);
    // A spring or timing toward where the value already is ends at once, before it starts, and
    // leaves no animation on the value (valueSetter.ts:36-43).
    if (isStep(next) && next.to === this.current) {
      this.prior = null;
      tell(next, true);
      return;
    }
    const spring = next.kind === 'spring' ? startSpring(next, this.current as number, prior) : null;
    // The first frame runs as it is assigned (valueSetter.ts:69): a spring that starts at rest, or
    // whose config Reanimated rejects, ends there.
    const atRest = typeof spring === 'object' && spring !== null && springEnded(spring, this.current as number);
    if (!held || spring === 'skip' || atRest) {
      this.prior = endedPrior(next);
      this.land(next);
      return;
    }
    const end = () => {
      this.running = null;
      timed.delete(this as SharedValue<unknown>);
      sprung.delete(this as SharedValue<unknown>);
      this.prior = endedPrior(next);
      this.land(next);
    };
    this.running = { animation: next, end, from: this.current, elapsed: 0, spring };
    if (next.kind === 'timing') timed.add(this as SharedValue<unknown>);
    if (next.kind === 'spring') sprung.add(this as SharedValue<unknown>);
    held.push(end);
  }
  /** `cancelAnimation`: a held animation running here stops where it is, as a new assignment stops it,
   *  and leaves no animation on the value (util.ts:58-63 assigns the value itself). */
  cancel(): void {
    this.interrupt();
    this.prior = null;
  }
  /** A held animation still running here is cancelled by the new assignment: it never ends, and the
   *  callbacks in it hear it did not finish (valueSetter.ts:10-17). */
  private interrupt(): void {
    const was = this.running;
    if (!was) return;
    this.running = null;
    timed.delete(this as SharedValue<unknown>);
    sprung.delete(this as SharedValue<unknown>);
    held = held?.filter((end) => end !== was.end) ?? null;
    tell(was.animation, false);
  }
  /** An animation reaches its end: the value rests there and the callbacks in it run. */
  private land(animation: Tagged): void {
    this.current = settle(animation) as T;
    tell(animation, true);
    this.changed();
  }
  /** A held timing runs `ms` longer: the value moves along its curve, and lands once its duration is up. */
  advance(ms: number): void {
    const run = this.running;
    if (!run || run.animation.kind !== 'timing') return;
    const step = run.animation as Step;
    run.elapsed += ms;
    const duration = typeof step.config?.duration === 'number' ? step.config.duration : 300;
    if (run.elapsed >= duration) {
      held = held?.filter((end) => end !== run.end) ?? null;
      run.end();
      return;
    }
    const easing = step.config?.easing ?? inOutQuad;
    const curve = isBezier(easing) ? bezierCurve(easing.bezier) : easing;
    if (typeof curve !== 'function') throw new Error('elapse: this double cannot follow this timing curve part way');
    const progress = (curve as (x: number) => number)(run.elapsed / duration);
    this.current = ((run.from as number) + ((step.to as number) - (run.from as number)) * progress) as T;
    this.changed();
  }
  /** A held spring runs `ms` longer, as Reanimated 4.6 moves it (`springStep`), checked for its end
   *  every millisecond (`springEnded`): it lands on its target the millisecond its energy is spent. */
  advanceSpring(ms: number): void {
    const run = this.running;
    if (!run || run.animation.kind !== 'spring') return;
    const spring = run.spring;
    if (spring === null || spring === 'unmodelled') throw new Error('elapseSprings: this double cannot follow a duration-mode or clamped spring');
    let x = this.current as number;
    for (let i = 0; i < ms; i++) {
      const next = springStep(spring, x, 0.001);
      x = next.position;
      spring.velocity = next.velocity;
      if (springEnded(spring, x)) {
        spring.velocity = 0;
        held = held?.filter((end) => end !== run.end) ?? null;
        run.end();
        return;
      }
    }
    this.current = x as T;
    this.changed();
  }
  private changed(): void {
    this.version += 1;
    for (const listener of [...this.listeners]) listener();
  }
  listen(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }
}

/** While animations are held, `ms` pass on the UI thread: every held timing moves along its curve
 *  (its own easing, else Reanimated's default) and ends once its duration is up. Springs, delays and
 *  sequences stay where they are until released. */
export function elapse(ms: number): void {
  for (const value of [...timed]) value.advance(ms);
}

/** While animations are held, `ms` pass for the springs alone: every held spring moves by its
 *  physics, and one assigned while another still moved sets out with that one's velocity where it
 *  points toward the new target. Timings, delays and sequences stay where they are. */
export function elapseSprings(ms: number): void {
  for (const value of [...sprung]) value.advanceSpring(ms);
}

/** How many held springs and timings are still running. */
export function runningAnimations(): number {
  return timed.size + sprung.size;
}

/** A shared value made outside any component, as Reanimated's `makeMutable`. */
export function makeMutable<T>(initial: T): SharedValue<T> {
  return new SharedValue(initial);
}

/** A component's shared value: as it unmounts, the animation running on it is cancelled, so the
 *  callbacks in it hear it did not finish (hook/useSharedValue.ts:36-40). */
export function useSharedValue<T>(initial: T): SharedValue<T> {
  const ref = React.useRef<SharedValue<T> | null>(null);
  ref.current ??= new SharedValue(initial);
  const value = ref.current;
  React.useEffect(() => () => { value.cancel(); }, [value]);
  return value;
}
/** Code runs as a worklet on the UI thread (a style on a UI frame, a reaction, a native event's
 *  handler): only there does `measure` measure. */
let onUiThread = false;
/** While a test holds them, the JS thread's writes to the UI thread since, oldest first. */
let writes: (() => void)[] | null = null;
/** A JS-thread write to the UI thread: at once, unless the test holds writes; on the UI thread, at once. */
function toUi(write: () => void): void {
  if (writes === null || onUiThread) write();
  else writes.push(write);
}
/** From now on what the JS thread writes for the UI thread waits, as on a phone, where a shared value
 *  assigned on the JS thread (mutables.native.ts, `scheduleOnUI`), an animated ref taken on or off a
 *  view (useAnimatedRef.native.ts, `scheduleOnUI`) and `scheduleOnUI` itself only queue the write,
 *  in the order made, and UI frames run on before the UI thread takes them: a test looks at those
 *  frames. The JS thread reads what it last saw. `waiting` counts the writes queued; `release` runs
 *  them on the UI thread, oldest first, and stops holding. */
export function holdWrites(): { waiting: () => number; release: () => void } {
  const queue: (() => void)[] = [];
  writes = queue;
  return {
    waiting: () => queue.length,
    release: () => {
      writes = null;
      for (const write of queue) onUi(write);
    },
  };
}
/** react-native-worklets' `scheduleOnUI`: `fn(...args)` as a worklet on the UI thread, after every
 *  write queued before it (`holdWrites`). */
export function scheduleOnUI<A extends unknown[]>(fn: (...args: A) => void, ...args: A): void {
  toUi(() => onUi(() => fn(...args)));
}
/** react-native-worklets' Synchronizable: one value both threads read and write at once, never
 *  through the queue `holdWrites` holds (SynchronizableFixed.cpp: an atomic). `setBlocking` takes a
 *  value, or a function of the value now, as one step. */
export interface Synchronizable<T> {
  getDirty(): T;
  getBlocking(): T;
  setBlocking(next: T | ((now: T) => T)): void;
  setDirty(next: T): void;
  lock(): void;
  unlock(): void;
}
export type FixedSynchronizable<T> = Synchronizable<T>;
function countedRead<T>(value: T): T {
  if (!onUiThread) jsThreadReads.count += 1;
  return value;
}
export function createSynchronizable<T>(initial: T, _config?: { fixedType?: boolean }): Synchronizable<T> {
  let value = initial;
  return {
    getDirty: () => countedRead(value),
    getBlocking: () => countedRead(value),
    setBlocking: (next) => { value = typeof next === 'function' ? (next as (now: T) => T)(value) : next; },
    setDirty: (next) => { value = next; },
    lock: () => {},
    unlock: () => {},
  };
}
/** Whether code runs on the RN (JS) runtime, as worklets' `isRNRuntime`. */
export const isRNRuntime = (): boolean => !onUiThread;
/** How many shared-value and Synchronizable reads ran on the JS thread: Reanimated 4 answers a dirty
 *  shared value there with a synchronous round trip into the UI runtime; a Synchronizable read on
 *  the JS thread is counted too, for a worklet that must not touch one there. A test reads it before
 *  and after. */
export const jsThreadReads = { count: 0 };
/** Runs `fn` as a worklet on the UI thread, at once; a test measures through it. */
export function onUi<R>(fn: () => R): R {
  const outer = onUiThread;
  onUiThread = true;
  try {
    return fn();
  } finally {
    onUiThread = outer;
  }
}
/** The styles `useAnimatedStyle` made, with the updater that keeps each current on the UI thread. */
const animatedStyles = new WeakMap<object, () => unknown>();

/** A UI frame of the animated styles in a host view's `style` prop, merged: Reanimated runs a style's
 *  worklet on every frame any shared value it captures moves, whatever it read last time (this double
 *  repaints a style only on a change of what it read). */
export function frameStyles(style: unknown): Record<string, unknown> {
  const updaters = stylesIn(style).flatMap((s) => (typeof s === 'object' && s !== null ? animatedStyles.get(s) ?? [] : []));
  return Object.assign({}, ...updaters.map((updater) => onUi(updater)));
}

export function useAnimatedStyle<T>(updater: () => T): T {
  const [, repaint] = React.useReducer((n: number) => n + 1, 0);
  const uiFrame = React.useRef(false);
  reading = new Set();
  const outer = onUiThread;
  onUiThread = uiFrame.current;
  uiFrame.current = false;
  let style: T;
  try {
    style = updater();
  } finally {
    onUiThread = outer;
  }
  if (typeof style === 'object' && style !== null) animatedStyles.set(style, updater);
  const read = [...reading].map((value) => [value, value.version] as const);
  reading = null;
  React.useEffect(() => {
    const frame = () => {
      uiFrame.current = true;
      repaint();
    };
    const stops = read.map(([value]) => value.listen(frame));
    // An assignment made after this render but before this effect subscribed (an earlier effect
    // of the same component) still repaints.
    if (read.some(([value, version]) => value.version !== version)) frame();
    return () => { for (const stop of stops) stop(); };
  });
  return style;
}
export const withSpring = (to: unknown, config?: Record<string, unknown>, callback?: (finished: boolean) => void) => tag({ kind: 'spring', to, config, callback });
export const withTiming = (to: unknown, config?: Record<string, unknown>, callback?: (finished: boolean) => void) => tag({ kind: 'timing', to, config, callback });
export const withDelay = (delay: number, animation: Animation) => tag({ kind: 'delay', delay, animation });
export const withSequence = (...list: Animation[]) => tag({ kind: 'sequence', animations: list });
export const withRepeat = (animation: Animation, count = 2) => tag({ kind: 'repeat', animation, count });
export function cancelAnimation<T>(value?: SharedValue<T>): void {
  cancelled.count += 1;
  if (!value) return;
  cancelled.values.push(value);
  value.cancel();
}
export const Easing = { bezier: (...points: number[]) => ({ bezier: points }), linear: (x: number) => x };
export const ReduceMotion = { System: 'system', Always: 'always', Never: 'never' } as const;
/** An animated ref, as Reanimated 4.8 makes one (hook/useAnimatedRefCommon.ts): a ref callback a
 *  worklet can measure and scroll through, which tells its observers the tag of the view it holds
 *  (each view its own tag). An observer runs again only for a different tag; once React takes the
 *  ref off its view, the observer's cleanup runs a microtask later unless a view took it back, and
 *  the observer is not called with null. Called with no view on the JS thread it answers what it
 *  holds and changes nothing: null until it is put on a view. A worklet is handed the ref's Shareable
 *  instead (hook/useAnimatedRef.native.ts), which is no function: calling it on the UI thread throws. */
type Observer = (tag: number | null) => (() => void) | undefined;
interface AnimatedRef<T> {
  (node?: T | null): T | null;
  current: T | null;
  /** The view the UI thread holds: `current`, once the write that took the ref on or off a view has
   *  reached the UI thread (`holdWrites`). */
  ui: T | null;
  observe: (observer: Observer) => () => void;
}
let nextTag = 1;
const viewTags = new WeakMap<object, number>();
const tagOf = (node: unknown): number | null => {
  if (node === null || node === undefined) return null;
  if (typeof node !== 'object') return nextTag++;
  const known = viewTags.get(node);
  if (known !== undefined) return known;
  const fresh = nextTag++;
  viewTags.set(node, fresh);
  return fresh;
};
export function useAnimatedRef<T>(): AnimatedRef<T> {
  const ref = React.useRef<AnimatedRef<T> | null>(null);
  if (!ref.current) {
    const observers = new Map<Observer, { tag: number | null; cleanup: (() => void) | undefined }>();
    const cleanUpIfDetached = () => {
      if (animatedRef.current !== null) return;
      for (const [observer, run] of [...observers]) {
        if (run.tag === null) continue;
        run.cleanup?.();
        observers.set(observer, { tag: null, cleanup: undefined });
      }
    };
    const animatedRef = ((...given: [T | null] | []) => {
      if (given.length === 0) {
        if (onUiThread) throw new TypeError('animatedRef is not a function');
        return animatedRef.current;
      }
      const [node] = given;
      animatedRef.current = node;
      toUi(() => { animatedRef.ui = node; });
      if (node === null) {
        if (observers.size > 0) queueMicrotask(cleanUpIfDetached);
        return null;
      }
      const viewTag = tagOf(node);
      for (const [observer, run] of [...observers]) {
        if (run.tag === viewTag) continue;
        run.cleanup?.();
        observers.set(observer, { tag: viewTag, cleanup: observer(viewTag) });
      }
      return node;
    }) as AnimatedRef<T>;
    animatedRef.current = null;
    animatedRef.ui = null;
    animatedRef.observe = (observer) => {
      const viewTag = tagOf(animatedRef.current);
      observers.set(observer, { tag: viewTag, cleanup: observer(viewTag) });
      return () => {
        observers.get(observer)?.cleanup?.();
        observers.delete(observer);
      };
    };
    ref.current = animatedRef;
  }
  return ref.current;
}
/** Reanimated's UI-thread scroll: here, the held view's own `scrollTo`, at once. */
export function scrollTo<T extends { scrollTo?: (to: { x: number; y: number; animated: boolean }) => void }>(ref: AnimatedRef<T>, x: number, y: number, animated: boolean): void {
  ref.current?.scrollTo?.({ x, y, animated });
}
/** Native events handed to worklets by view tag (`useEvent` + `registerForEvents`); `emitNativeEvent`
 *  plays one to every handler registered for its name, as the UI thread receives it. */
type NativeHandler = (event: Record<string, unknown> & { eventName: string }) => void;
const nativeHandlers = new Map<number, Set<{ handler: NativeHandler; names: readonly string[] }>>();
export function useEvent(handler: NativeHandler, names: readonly string[] = []) {
  const ref = React.useRef<{ workletEventHandler: { registerForEvents: (tag: number) => void; unregisterFromEvents: (tag: number) => void } } | null>(null);
  if (!ref.current) {
    const entry = { handler, names };
    ref.current = {
      workletEventHandler: {
        registerForEvents: (viewTag) => {
          const set = nativeHandlers.get(viewTag) ?? new Set();
          nativeHandlers.set(viewTag, set);
          set.add(entry);
        },
        unregisterFromEvents: (viewTag) => { nativeHandlers.get(viewTag)?.delete(entry); },
      },
    };
  }
  return ref.current;
}
export function emitNativeEvent(name: string, payload: Record<string, unknown>): void {
  for (const [viewTag, set] of nativeHandlers) {
    for (const { handler, names } of [...set]) if (names.includes(name)) onUi(() => handler({ ...payload, eventName: `${viewTag}${name}` }));
  }
}
/** While a test holds them, the hops made to the React Native thread since, oldest first. */
let hops: (() => void)[] | null = null;
/** react-native-worklets' hop back to the React Native thread: at once, unless the test holds hops. */
export function scheduleOnRN<A extends unknown[]>(fn: (...args: A) => void, ...args: A): void {
  if (hops === null) fn(...args);
  else hops.push(() => fn(...args));
}
/** From now on a hop to the React Native thread waits, as on a phone, where `scheduleOnRN` only
 *  queues the call and UI frames run on before the JS thread takes it: a test looks at those frames.
 *  `waiting` counts the hops queued; `release` runs them, oldest first, and stops holding. */
export function holdHops(): { waiting: () => number; release: () => void } {
  const queue: (() => void)[] = [];
  hops = queue;
  return {
    waiting: () => queue.length,
    release: () => {
      hops = null;
      for (const hop of queue) hop();
    },
  };
}

/** Reanimated's `interpolate` over piecewise-linear segments, with its extrapolation modes. */
export const Extrapolation = { IDENTITY: 'identity', CLAMP: 'clamp', EXTEND: 'extend' } as const;
type ExtrapolationMode = (typeof Extrapolation)[keyof typeof Extrapolation];
type ExtrapolationArg = ExtrapolationMode | { extrapolateLeft?: ExtrapolationMode; extrapolateRight?: ExtrapolationMode };
export function interpolate(x: number, input: readonly number[], output: readonly number[], extrapolation: ExtrapolationArg = Extrapolation.EXTEND): number {
  const modes = typeof extrapolation === 'string' ? { extrapolateLeft: extrapolation, extrapolateRight: extrapolation } : extrapolation;
  const last = input.length - 1;
  let outside: ExtrapolationMode | null = null;
  if (x < input[0]) outside = modes.extrapolateLeft ?? Extrapolation.EXTEND;
  if (x > input[last]) outside = modes.extrapolateRight ?? Extrapolation.EXTEND;
  if (outside === Extrapolation.IDENTITY) return x;
  if (outside === Extrapolation.CLAMP) return x < input[0] ? output[0] : output[last];
  let i = 0;
  while (i < last - 1 && x > input[i + 1]) i++;
  const [x0, x1, y0, y1] = [input[i], input[i + 1], output[i], output[i + 1]];
  return x1 === x0 ? y0 : y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
}

/** Runs `prepare` reading shared values; returns its result and the values it read. */
function track<T>(prepare: () => T): [T, Set<SharedValue<unknown>>] {
  const outer = reading;
  reading = new Set();
  try {
    return [prepare(), reading];
  } finally {
    reading = outer;
  }
}

/** `prepare` runs once the component mounts and again, synchronously, each time a shared value it
 *  read is assigned; every run hands `react` its result and the previous one (null the first time),
 *  as Reanimated's mapper does. The latest `prepare` and `react` are used. When `deps` change,
 *  Reanimated starts a new mapper (hook/useAnimatedReaction.ts), which first runs on the next frame,
 *  with the values that frame moves: here it starts listening to what the new `prepare` reads and runs
 *  as one of them is next assigned, `previous` kept (Reanimated keeps it in a shared value). */
export function useAnimatedReaction<T>(prepare: () => T, react: (current: T, previous: T | null) => void, deps: readonly unknown[] = []): void {
  const latest = React.useRef({ prepare, react });
  latest.current = { prepare, react };
  const previous = React.useRef<T | null>(null);
  const started = React.useRef(false);
  React.useEffect(() => {
    let stops: (() => void)[] = [];
    const listen = (read: Set<SharedValue<unknown>>) => {
      for (const stop of stops) stop();
      stops = [...read].map((value) => value.listen(run));
    };
    const run = () => {
      const [current, read] = onUi(() => track(latest.current.prepare));
      listen(read);
      const before = previous.current;
      previous.current = current;
      onUi(() => latest.current.react(current, before));
    };
    if (started.current) listen(onUi(() => track(latest.current.prepare))[1]);
    else run();
    started.current = true;
    return () => { for (const stop of stops) stop(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the caller's deps, as Reanimated takes them
  }, deps);
}

/** What `measure` reports for any mounted view; a test sets the rect it needs. */
export const measuredRect = { x: 0, y: 0, width: 100, height: 100, pageX: 0, pageY: 0 };
/** Where particular views are now: given what a ref holds (the test's `createNodeMock` output), the
 *  rect it measures, or undefined for `measuredRect`. A test sets `rectOf`, and clears it after. */
export const measuring: { rectOf: ((node: unknown) => typeof measuredRect | undefined) | null } = { rectOf: null };
/** How many times a worklet measured a ref that held no view (`unattached`: Reanimated 4.8 logs "The
 *  view with tag null is not a valid argument", measure.native.ts:35-41), and a ref the UI thread
 *  still holds on a view React has already taken out of the tree it committed (`outOfTree`: the view
 *  is no longer in the shadow tree's current revision, UIManager.cpp:380-386 measures against it,
 *  LayoutableShadowNode.cpp:85-88 answers `EmptyLayoutMetrics`, ReanimatedModuleProxy.cpp:1281 null,
 *  and measure.native.ts:44-48 logs "meaningless value of `LayoutMetrics`"). Each warning is logged on
 *  every such call, never deduplicated. A test zeroes them. */
export const measureWarnings = { unattached: 0, outOfTree: 0 };
/** Reanimated's synchronous measurement of the view the UI thread holds: its rect, or null, with a
 *  warning (`measureWarnings`), while it holds none, and while it still holds one React has taken off
 *  the ref (the view left the committed tree, or the ref moved on), before that write reaches it
 *  (`holdWrites`). Only a worklet on the UI thread measures: on the JS thread it answers null,
 *  without a warning (measure.native.ts:31-33). */
export function measure<T>(ref: AnimatedRef<T>): typeof measuredRect | null {
  if (!onUiThread) return null;
  if (ref.ui === null) {
    measureWarnings.unattached += 1;
    return null;
  }
  if (ref.ui !== ref.current) {
    measureWarnings.outOfTree += 1;
    return null;
  }
  return { ...(measuring.rectOf?.(ref.ui) ?? measuredRect) };
}

// ── Layout animations ────────────────────────────────────────────────────────

/** A layout animation as a component built it: the preset, every builder call in order, and the
 *  config those calls add up to (`springify` true, each other call its first argument). */
export interface LayoutAnimation {
  preset: string;
  calls: { name: string; args: unknown[] }[];
  config: Record<string, unknown>;
}
const LAYOUT = Symbol('layout animation');
const BUILDER_CALLS = ['duration', 'delay', 'springify', 'damping', 'stiffness', 'mass', 'dampingRatio', 'overshootClamping', 'easing', 'reduceMotion', 'withCallback', 'withInitialValues', 'randomDelay'] as const;
type LayoutBuilder = LayoutAnimation & { [LAYOUT]: true } & Record<(typeof BUILDER_CALLS)[number], (...args: unknown[]) => LayoutBuilder>;

function layoutBuilder(preset: string, calls: LayoutAnimation['calls']): LayoutBuilder {
  const config: Record<string, unknown> = {};
  for (const { name, args } of calls) config[name] = name === 'springify' ? true : args[0];
  const builder = { preset, calls, config, [LAYOUT]: true as const } as LayoutBuilder;
  for (const name of BUILDER_CALLS) builder[name] = (...args: unknown[]) => layoutBuilder(preset, [...calls, { name, args }]);
  return builder;
}
export const isLayoutAnimation = (v: unknown): v is LayoutAnimation => typeof v === 'object' && v !== null && LAYOUT in v;
export const FadeIn = layoutBuilder('FadeIn', []);
export const FadeOut = layoutBuilder('FadeOut', []);
export const LinearTransition = layoutBuilder('LinearTransition', []);
export const FadingTransition = layoutBuilder('FadingTransition', []);

/** What a layout animation does on the phone: under the OS Reduce Motion setting Reanimated skips
 *  every animation not marked `ReduceMotion.Never` (App.tsx mounts `ReducedMotionConfig` System), so
 *  the view lands at once — null; otherwise the animation itself. */
export function playedUnder(animation: unknown, reduceMotion: boolean): LayoutAnimation | null {
  if (!isLayoutAnimation(animation)) return null;
  const mode = animation.config.reduceMotion ?? ReduceMotion.System;
  if (mode === ReduceMotion.Always) return null;
  return reduceMotion && mode !== ReduceMotion.Never ? null : animation;
}

/** A view's `entering` animation ran as it mounted, or its `exiting` one as it unmounted; oldest first,
 *  splice to reset. A `layout` transition stays readable as the view's prop. */
export interface LayoutEvent {
  phase: 'entering' | 'exiting';
  component: string;
  animation: LayoutAnimation;
}
export const layoutAnimations: LayoutEvent[] = [];

/** Each commit an Animated view was rendered in, oldest first: the `layout` transition registered for
 *  it as that commit was drawn (`held`: what a change of its size or place in that commit moved
 *  with), the one it set, and its style. A view not rendered in a commit holds the `layout` of its
 *  last entry before it. Splice to reset. */
export interface LayoutCommit {
  commit: number;
  viewTag: number;
  held: unknown;
  layout: unknown;
  style: string;
  /** What `layoutProbe.read` read as the commit was drawn: a test reads what else that commit drew. */
  seen: unknown;
}
export const layoutCommits: LayoutCommit[] = [];
/** Read on every view's entry in `layoutCommits` while a test sets it; clear it after. */
export const layoutProbe: { read: (() => unknown) | null } = { read: null };
let commits = 0;
let inCommit = false;
const inThisCommit = new Set<number>();
/** The number of the commit whose layout effects are running: a commit runs them all in one go, each
 *  view's once, so a view already in it starts the next. */
function commitNumber(viewTag: number): number {
  if (!inCommit || inThisCommit.has(viewTag)) {
    inCommit = true;
    inThisCommit.clear();
    commits += 1;
    queueMicrotask(() => { inCommit = false; });
  }
  inThisCommit.add(viewTag);
  return commits;
}

/** Every style in a (nested) style prop, in order. */
const stylesIn = (style: unknown): unknown[] => (Array.isArray(style) ? style.flatMap(stylesIn) : [style]);

/** An Animated host component: renders as `name`, and logs its entering and exiting animations. As on
 *  the phone, what an animated style last set stays on the view when the style is taken off it,
 *  until something sets that property again. Each mount is a new native view with its own
 *  `viewTag` prop (`viewTagOf`): a layout transition retargets only on the view it is running on. */
function animatedComponent(name: string) {
  const Component = (props: HostProps) => {
    const viewTag = React.useRef(0);
    if (viewTag.current === 0) viewTag.current = nextTag++;
    const applied = React.useRef<Record<string, unknown>>({});
    const attached = React.useRef<(() => unknown)[]>([]);
    const styles = stylesIn(props.style).filter((s): s is Record<string, unknown> => typeof s === 'object' && s !== null);
    // Up to this render the UI thread kept every style attached last time current, whether or not
    // React rendered in between; then this render's own animated styles apply.
    for (const updater of attached.current) Object.assign(applied.current, onUi(updater));
    attached.current = styles.flatMap((s) => animatedStyles.get(s) ?? []);
    for (const style of styles) if (animatedStyles.has(style)) Object.assign(applied.current, style);
    const current = Object.assign({}, ...styles) as Record<string, unknown>;
    const left = Object.fromEntries(Object.entries(applied.current).filter(([key]) => !(key in current)));
    const style = Object.keys(left).length === 0 ? props.style : [left, props.style];
    const entering = React.useRef(props.entering);
    const exiting = React.useRef(props.exiting);
    exiting.current = props.exiting;
    React.useEffect(() => {
      if (isLayoutAnimation(entering.current)) layoutAnimations.push({ phase: 'entering', component: name, animation: entering.current });
      return () => {
        if (isLayoutAnimation(exiting.current)) layoutAnimations.push({ phase: 'exiting', component: name, animation: exiting.current });
      };
    }, []);
    // Reanimated 4.8 registers a view's `layout` transition after the commit that mounts it
    // (`componentDidMount`), and on every later commit before it is drawn (`getSnapshotBeforeUpdate`):
    // the mounting commit moves with none, a later change of size with the one that render set.
    const mounted = React.useRef(false);
    React.useLayoutEffect(() => {
      layoutCommits.push({ commit: commitNumber(viewTag.current), viewTag: viewTag.current, held: mounted.current ? props.layout : undefined, layout: props.layout, style: JSON.stringify(props.style), seen: layoutProbe.read?.() });
      mounted.current = true;
    });
    return React.createElement(name, { ...props, style, viewTag: viewTag.current }, props.children);
  };
  Component.displayName = name;
  return Component;
}

/** The native view an Animated host element is drawn by: the same tag across re-renders, a new one
 *  once it is mounted again. */
export const viewTagOf = (node: { props: Record<string, unknown> }): number => node.props.viewTag as number;

const Animated = { View: animatedComponent('Animated.View'), Text: animatedComponent('Animated.Text'), ScrollView: animatedComponent('Animated.ScrollView') };
export default Animated;
