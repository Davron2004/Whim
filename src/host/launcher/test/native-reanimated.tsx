/** react-native-reanimated (and react-native-worklets' `scheduleOnRN`) for React interaction tests. Nothing runs on a UI thread: assigning an
 *  animation to a shared value records it in `animations` (oldest first) and jumps the value to
 *  where the animation ends, so a test reads what motion a control asked for — the target, the
 *  spring or timing config, delays, sequences and repeats — and the style it settles in.
 *  `useAnimatedStyle` evaluates its updater at render and re-renders when a shared value it read
 *  changes, as the UI thread would repaint. An animation's end callback runs as it is assigned. */
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
/** How many times `cancelAnimation` ran. */
export const cancelled = { count: 0 };

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

class SharedValue<T> {
  private current: T;
  /** Bumped on every assignment, so a style can tell it missed one. */
  version = 0;
  private readonly listeners = new Set<() => void>();
  constructor(initial: T) { this.current = initial; }
  get value(): T {
    reading?.add(this as SharedValue<unknown>);
    return this.current;
  }
  set value(next: T) {
    if (isAnimation(next)) {
      animations.push(next);
      this.current = settle(next) as T;
      if (isStep(next)) next.callback?.(true);
    } else {
      this.current = next;
    }
    this.version += 1;
    for (const listener of [...this.listeners]) listener();
  }
  listen(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }
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
export function cancelAnimation(): void { cancelled.count += 1; }
export const Easing = { bezier: (...points: number[]) => ({ bezier: points }) };
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

const AnimatedView = (props: HostProps) => React.createElement('Animated.View', props, props.children);
const Animated = { View: AnimatedView };
export default Animated;
