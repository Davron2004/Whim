/** react-native-reanimated (and react-native-worklets' `scheduleOnRN`) for React interaction tests. Nothing runs on a UI thread: assigning an
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
 *  `useAnimatedReaction` reacts synchronously, `measure` reports `measuredRect`. The double's own
 *  contract is `native-reanimated.suite.tsx`. */
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

class SharedValue<T> {
  private current: T;
  /** The held animation running on this value, if any: where it set out from and how long it has run. */
  private running: { animation: Tagged; end: () => void; from: unknown; elapsed: number; velocity: number } | null = null;
  /** The velocity of the held spring the latest assignment cut short, which a spring assigned in its
   *  place sets out with, as Reanimated's retarget does. */
  private carried = 0;
  /** Bumped on every assignment, so a style can tell it missed one. */
  version = 0;
  private readonly listeners = new Set<() => void>();
  constructor(initial: T) { this.current = initial; }
  get value(): T {
    reading?.add(this as SharedValue<unknown>);
    return this.current;
  }
  set value(next: T) {
    this.interrupt();
    if (isAnimation(next)) {
      animations.push(next);
      if (held) {
        const end = () => {
          this.running = null;
          timed.delete(this as SharedValue<unknown>);
          sprung.delete(this as SharedValue<unknown>);
          this.land(next);
        };
        this.running = { animation: next, end, from: this.current, elapsed: 0, velocity: next.kind === 'spring' ? this.carried : 0 };
        this.carried = 0;
        if (next.kind === 'timing') timed.add(this as SharedValue<unknown>);
        if (next.kind === 'spring') sprung.add(this as SharedValue<unknown>);
        held.push(end);
        return;
      }
      this.carried = 0;
      this.land(next);
      return;
    }
    this.carried = 0;
    this.current = next;
    this.changed();
  }
  /** `cancelAnimation`: a held animation running here stops where it is, as a new assignment stops it. */
  cancel(): void {
    this.interrupt();
  }
  /** A held animation still running here is cancelled by the new assignment: it never ends, and its
   *  callback hears it did not finish. */
  private interrupt(): void {
    const was = this.running;
    if (!was) return;
    this.running = null;
    timed.delete(this as SharedValue<unknown>);
    sprung.delete(this as SharedValue<unknown>);
    held = held?.filter((end) => end !== was.end) ?? null;
    this.carried = was.animation.kind === 'spring' ? was.velocity : 0;
    if (isStep(was.animation)) was.animation.callback?.(false);
  }
  /** An animation reaches its end: the value rests there and its end callback runs. */
  private land(animation: Tagged): void {
    this.current = settle(animation) as T;
    if (isStep(animation)) animation.callback?.(true);
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
    if (typeof easing !== 'function') throw new Error('elapse: this double cannot follow a bezier timing curve part way');
    const progress = (easing as (x: number) => number)(run.elapsed / duration);
    this.current = ((run.from as number) + ((step.to as number) - (run.from as number)) * progress) as T;
    this.changed();
  }
  /** A held spring runs `ms` longer, by its physics (its mass, stiffness and damping, Reanimated's
   *  defaults where it gives none) from where it is with its velocity, in 1 ms steps; it lands once it
   *  is at rest. */
  advanceSpring(ms: number): void {
    const run = this.running;
    if (!run || run.animation.kind !== 'spring') return;
    const step = run.animation as Step;
    const config = step.config ?? {};
    const mass = typeof config.mass === 'number' ? config.mass : SPRING_DEFAULTS.mass;
    const stiffness = typeof config.stiffness === 'number' ? config.stiffness : SPRING_DEFAULTS.stiffness;
    const damping = typeof config.damping === 'number' ? config.damping : SPRING_DEFAULTS.damping;
    const to = step.to as number;
    let x = this.current as number;
    let v = run.velocity;
    for (let i = 0; i < ms; i++) {
      v += ((-stiffness * (x - to) - damping * v) / mass) * 0.001;
      x += v * 0.001;
    }
    if (Math.abs(x - to) < SPRING_REST.displacement && Math.abs(v) < SPRING_REST.speed) {
      held = held?.filter((end) => end !== run.end) ?? null;
      run.end();
      return;
    }
    run.velocity = v;
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

/** Reanimated's spring defaults and the rest it settles at. */
const SPRING_DEFAULTS = { mass: 4, stiffness: 900, damping: 120 } as const;
const SPRING_REST = { displacement: 0.001, speed: 0.01 } as const;

/** While animations are held, `ms` pass on the UI thread: every held timing moves along its curve
 *  (its own easing, else Reanimated's default) and ends once its duration is up. Springs, delays and
 *  sequences stay where they are until released. */
export function elapse(ms: number): void {
  for (const value of [...timed]) value.advance(ms);
}

/** While animations are held, `ms` pass for the springs alone: every held spring moves by its
 *  physics, and one assigned while another still moved sets out with that one's velocity. Timings,
 *  delays and sequences stay where they are. */
export function elapseSprings(ms: number): void {
  for (const value of [...sprung]) value.advanceSpring(ms);
}

/** A shared value made outside any component, as Reanimated's `makeMutable`. */
export function makeMutable<T>(initial: T): SharedValue<T> {
  return new SharedValue(initial);
}

export function useSharedValue<T>(initial: T): SharedValue<T> {
  const ref = React.useRef<SharedValue<T> | null>(null);
  ref.current ??= new SharedValue(initial);
  return ref.current;
}
export function useAnimatedStyle<T>(updater: () => T): T {
  const [, repaint] = React.useReducer((n: number) => n + 1, 0);
  reading = new Set();
  const style = updater();
  const read = [...reading].map((value) => [value, value.version] as const);
  reading = null;
  React.useEffect(() => {
    const stops = read.map(([value]) => value.listen(repaint));
    // An assignment made after this render but before this effect subscribed (an earlier effect
    // of the same component) still repaints.
    if (read.some(([value, version]) => value.version !== version)) repaint();
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
/** An animated ref: a ref callback a worklet can scroll through, which tells its observers the
 *  tag of the view it holds (a fresh tag per ref; null once it lets go). */
type Observer = (tag: number | null) => (() => void) | undefined;
interface AnimatedRef<T> {
  (node: T | null): void;
  current: T | null;
  observe: (observer: Observer) => () => void;
}
let nextTag = 1;
export function useAnimatedRef<T>(): AnimatedRef<T> {
  const ref = React.useRef<AnimatedRef<T> | null>(null);
  if (!ref.current) {
    const viewTag = nextTag++;
    const observers = new Map<Observer, (() => void) | undefined>();
    const animatedRef = ((node: T | null) => {
      animatedRef.current = node;
      for (const [observer, cleanup] of [...observers]) {
        cleanup?.();
        observers.set(observer, observer(node ? viewTag : null));
      }
    }) as AnimatedRef<T>;
    animatedRef.current = null;
    animatedRef.observe = (observer) => {
      observers.set(observer, observer(animatedRef.current ? viewTag : null));
      return () => {
        observers.get(observer)?.();
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
    for (const { handler, names } of [...set]) if (names.includes(name)) handler({ ...payload, eventName: `${viewTag}${name}` });
  }
}
/** react-native-worklets' hop back to the React Native thread: there is only one thread here. */
export function scheduleOnRN<A extends unknown[]>(fn: (...args: A) => void, ...args: A): void { fn(...args); }

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
 *  as Reanimated's mapper does. The latest `prepare` and `react` are used, so `deps` is not needed. */
export function useAnimatedReaction<T>(prepare: () => T, react: (current: T, previous: T | null) => void): void {
  const latest = React.useRef({ prepare, react });
  latest.current = { prepare, react };
  React.useEffect(() => {
    let previous: T | null = null;
    let stops: (() => void)[] = [];
    const run = () => {
      const [current, read] = track(latest.current.prepare);
      for (const stop of stops) stop();
      stops = [...read].map((value) => value.listen(run));
      const before = previous;
      previous = current;
      latest.current.react(current, before);
    };
    run();
    return () => { for (const stop of stops) stop(); };
  }, []);
}

/** What `measure` reports for any mounted view; a test sets the rect it needs. */
export const measuredRect = { x: 0, y: 0, width: 100, height: 100, pageX: 0, pageY: 0 };
/** Reanimated's synchronous measurement: the view's rect, or null once its ref holds no view. */
export function measure<T>(ref: AnimatedRef<T>): typeof measuredRect | null {
  return ref.current === null ? null : { ...measuredRect };
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

/** An Animated host component: renders as `name`, and logs its entering and exiting animations. */
function animatedComponent(name: string) {
  const Component = (props: HostProps) => {
    const entering = React.useRef(props.entering);
    const exiting = React.useRef(props.exiting);
    exiting.current = props.exiting;
    React.useEffect(() => {
      if (isLayoutAnimation(entering.current)) layoutAnimations.push({ phase: 'entering', component: name, animation: entering.current });
      return () => {
        if (isLayoutAnimation(exiting.current)) layoutAnimations.push({ phase: 'exiting', component: name, animation: exiting.current });
      };
    }, []);
    return React.createElement(name, props, props.children);
  };
  Component.displayName = name;
  return Component;
}

const Animated = { View: animatedComponent('Animated.View'), Text: animatedComponent('Animated.Text'), ScrollView: animatedComponent('Animated.ScrollView') };
export default Animated;
