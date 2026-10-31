// ─────────────────────────────────────────────────────────────────────────────
// vc-sdk — motion (docs/design/system.md §4; design-system-v1 D10)
// ─────────────────────────────────────────────────────────────────────────────
// Internal: `index.tsx` never re-exports this module, and no component takes a motion prop. The
// springs are the token module's, sampled at build time into `linear()` easings
// (`src/design/generated/springs.ts`) and played through the Web Animations API, with the nearest
// cubic-bezier where `linear()` is unsupported. Anything a new value can retarget mid-flight (a
// switch knob, a segment or slider thumb, a dragged sheet) runs a requestAnimationFrame spring that
// keeps its velocity. Every play starts from what is on screen (rule 2). Nothing here adds script,
// style sheets or URLs: WAAPI and inline style writes only, under the unchanged CSP.
//
// Without a DOM (the Node suites, a host that never mounts) every helper is a no-op and the
// components render their end state, which is also what they render between motions.
import * as React from 'react';
import { SAMPLED_SPRINGS, type SampledSpring } from '../design/generated/springs';
import { SPRINGS, TIMINGS, type SpringName } from '../design/tokens';
import { activeTheme } from './tokens';

/** Whether this realm shows the reduced form of every moment (system.md §4.5). */
export function reduceMotion(): boolean {
  return activeTheme().reduceMotion;
}

// ── Easings ─────────────────────────────────────────────────────────────────

export interface Timing {
  duration: number;
  easing: string;
  delay?: number;
}

/** A sampled spring as a WAAPI timing: its `linear()` curve, or its nearest cubic-bezier. */
export function easedSpring(sampled: SampledSpring, linearSupported: boolean): Timing {
  return { duration: sampled.durationMs, easing: linearSupported ? sampled.linear : sampled.cubicBezier };
}

interface CssNamespace {
  supports?: (property: string, value: string) => boolean;
}
const cssSupport = new Map<string, boolean>();

/** Whether the engine accepts `value` for `property`, asked once per realm. */
function cssSupports(property: string, value: string): boolean {
  const key = `${property}:${value}`;
  let supported = cssSupport.get(key);
  if (supported === undefined) {
    const css = (globalThis as { CSS?: CssNamespace }).CSS;
    supported = typeof css?.supports === 'function' && css.supports(property, value) === true;
    cssSupport.set(key, supported);
  }
  return supported;
}

/** Whether the engine draws `linear()` easings (iOS 15.1 predates them). */
export function supportsLinearEasing(): boolean {
  return cssSupports('animation-timing-function', 'linear(0, 1)');
}

/** Whether the engine has the individual CSS `translate` property (Chromium 104; the WebView floor
 *  is 91). Without it the motions drawn through `translate` (a sliding thumb, a list row closing a
 *  gap) are skipped and the element shows its end state, like Reduce Motion: writing the property
 *  there draws nothing, and a part that follows the motion would drift from the part that cannot. */
export function supportsTranslateProperty(): boolean {
  return cssSupports('translate', '1px 0px');
}

/** The named spring as a WAAPI timing. */
export function springTiming(name: SpringName): Timing {
  return easedSpring(SAMPLED_SPRINGS[name], supportsLinearEasing());
}

/** The fade timings (system.md §4.2): content swaps and every reduced-motion replacement. */
export function fadeTiming(direction: 'in' | 'out', duration?: number): Timing {
  return { duration: duration ?? (direction === 'in' ? TIMINGS.fadeIn : TIMINGS.fadeOut), easing: TIMINGS.fadeEasing };
}

/** A colour change (system.md §4.2), as a CSS transition value for `properties`. */
export function colorTransition(...properties: string[]): string {
  return properties.map((p) => `${p} ${TIMINGS.color}ms ${TIMINGS.colorEasing}`).join(', ');
}

// ── The few DOM members motion touches (the SDK's lib has no DOM types) ───────

export type MotionKeyframe = Record<string, string | number>;

export interface MotionAnimation {
  cancel(): void;
  onfinish: (() => void) | null;
}

interface AnimateOptions extends Timing {
  fill?: 'none' | 'forwards' | 'backwards' | 'both';
}

export interface MotionElement {
  animate(keyframes: MotionKeyframe[], options: AnimateOptions): MotionAnimation;
  getBoundingClientRect(): { left: number; top: number; right: number; bottom: number; width: number; height: number };
  readonly offsetLeft: number;
  readonly offsetTop: number;
  readonly style: Record<string, string>;
}

/** `node` when it can animate (a mounted DOM element), else null. */
export function motionElement(node: unknown): MotionElement | null {
  const candidate = node as Partial<MotionElement> | null;
  return candidate && typeof candidate.animate === 'function' && typeof candidate.getBoundingClientRect === 'function'
    ? (candidate as MotionElement)
    : null;
}

/** Whether this realm can play motion at all: a DOM with the Web Animations API. Components that
 *  keep an element mounted for its exit (Modal, toast, list rows, screens) ask this first, so a
 *  host without a DOM never keeps anything around for a motion that cannot play. */
export function canAnimate(): boolean {
  const element = (globalThis as { Element?: { prototype?: { animate?: unknown } } }).Element;
  return typeof element?.prototype?.animate === 'function';
}

type ComputedStyle = Record<string, string>;

function computedStyle(el: MotionElement): ComputedStyle {
  const read = (globalThis as { getComputedStyle?: (el: MotionElement) => ComputedStyle }).getComputedStyle;
  return typeof read === 'function' ? read(el) : {};
}

/** The on-screen value of each of `properties`, running animations included (rule 2). */
export function presentation(el: MotionElement, properties: readonly string[]): MotionKeyframe {
  const style = computedStyle(el);
  const frame: MotionKeyframe = {};
  for (const p of properties) frame[p] = style[p] ?? '';
  return frame;
}

/** The y of a computed `translate` value (`'none'`, `'0px 12px'`, `'4px'`). */
export function translateY(value: string | undefined): number {
  if (!value || value === 'none') return 0;
  const parts = value.trim().split(' ').filter((part) => part !== '');
  return parts.length > 1 ? Number.parseFloat(parts[1]) || 0 : 0;
}

/** The y translation of a computed `transform` (`'none'`, `'matrix(…)'`, `'matrix3d(…)'`). */
export function matrixTranslateY(value: string | undefined): number {
  if (!value || value === 'none') return 0;
  const open = value.indexOf('(');
  const numbers = open === -1 ? [] : value.slice(open + 1, value.lastIndexOf(')')).split(',').map((n) => Number.parseFloat(n));
  if (value.startsWith('matrix3d')) return numbers[13] || 0;
  return numbers[5] || 0;
}

// Each element's running animation per channel, so a new motion replaces only its own channel's.
const running = new WeakMap<MotionElement, Map<string, MotionAnimation>>();

/** Stop `channel`'s running animation on `el`, leaving what it last showed to the element's style. */
export function stop(el: MotionElement, channel: string): void {
  const map = running.get(el);
  map?.get(channel)?.cancel();
  map?.delete(channel);
}

/** Whether `channel` is still moving `el` (or holding its last frame). */
export function isRunning(el: MotionElement, channel: string): boolean {
  return running.get(el)?.has(channel) === true;
}

/**
 * Play `keyframes` on `el` as its `channel` (e.g. `'press'`, `'enter'`), replacing that channel's
 * running animation. `onDone` runs when it finishes, never when something replaces it.
 */
export function play(
  el: MotionElement,
  channel: string,
  keyframes: MotionKeyframe[],
  timing: Timing,
  options: { fill?: AnimateOptions['fill']; onDone?: () => void } = {},
): MotionAnimation {
  stop(el, channel);
  const animation = el.animate(keyframes, { ...timing, fill: options.fill ?? 'none' });
  let map = running.get(el);
  if (!map) {
    map = new Map();
    running.set(el, map);
  }
  map.set(channel, animation);
  animation.onfinish = () => {
    if (running.get(el)?.get(channel) === animation && options.fill !== 'forwards') running.get(el)?.delete(channel);
    options.onDone?.();
  };
  return animation;
}

/** Play from what is on screen now to `to`: the interruptible form of `play` (rule 2). */
export function retarget(
  el: MotionElement,
  channel: string,
  to: MotionKeyframe,
  timing: Timing,
  options: { fill?: AnimateOptions['fill']; onDone?: () => void } = {},
): MotionAnimation {
  const from = presentation(el, Object.keys(to));
  return play(el, channel, [from, to], timing, options);
}

// ── The rAF spring (rule 2: retargets keep their velocity) ───────────────────

export interface SpringState {
  value: number;
  velocity: number;
}
export interface SpringConfig {
  stiffness: number;
  damping: number;
}

/** Below these the spring is at rest: within 0.05 of its target and slower than 0.5 units/s. */
const REST_DISTANCE = 0.05;
const REST_SPEED = 0.5;
/** The integration step: fine enough to stay stable for the stiffest spring (`instant`). */
const MAX_STEP_S = 1 / 240;

/** Advance a mass-1 spring towards `target` by `dt` seconds (semi-implicit Euler, sub-stepped). */
export function stepSpring(state: SpringState, target: number, config: SpringConfig, dt: number): SpringState {
  let { value, velocity } = state;
  let left = Math.max(0, dt);
  while (left > 0) {
    const h = Math.min(MAX_STEP_S, left);
    velocity += (-config.stiffness * (value - target) - config.damping * velocity) * h;
    value += velocity * h;
    left -= h;
  }
  return { value, velocity };
}

export interface FrameScheduler {
  request(callback: (time: number) => void): number;
  cancel(handle: number): void;
}

function frameScheduler(): FrameScheduler | null {
  const g = globalThis as {
    requestAnimationFrame?: (callback: (time: number) => void) => number;
    cancelAnimationFrame?: (handle: number) => void;
  };
  const raf = g.requestAnimationFrame;
  const caf = g.cancelAnimationFrame;
  return typeof raf === 'function' && typeof caf === 'function' ? { request: (cb) => raf(cb), cancel: (h) => caf(h) } : null;
}

/** A value driven by a spring on animation frames, written through `write` each frame. */
export interface SpringValue {
  readonly value: number;
  readonly velocity: number;
  readonly target: number;
  /** Head for `target`, keeping the current velocity unless `velocity` is given. */
  to(target: number, velocity?: number): void;
  /** Show `value` at once, at rest. */
  jump(value: number): void;
  /** Move the whole motion by `delta` (the target stays): what a layout change under it needs. */
  shift(delta: number): void;
  /** Called once each time the spring comes to rest. */
  onRest: (() => void) | null;
  stop(): void;
}

export function createSpring(
  name: SpringName,
  write: (value: number) => void,
  initial = 0,
  scheduler: FrameScheduler | null = frameScheduler(),
): SpringValue {
  const config = SPRINGS[name];
  let state: SpringState = { value: initial, velocity: 0 };
  let target = initial;
  let handle: number | undefined;
  let last: number | undefined;

  const halt = (): void => {
    if (handle !== undefined) scheduler?.cancel(handle);
    handle = undefined;
    last = undefined;
  };
  const frame = (time: number): void => {
    handle = undefined;
    const dt = last === undefined ? 1 / 60 : Math.min(0.064, (time - last) / 1000);
    last = time;
    state = stepSpring(state, target, config, dt);
    if (Math.abs(state.value - target) < REST_DISTANCE && Math.abs(state.velocity) < REST_SPEED) {
      state = { value: target, velocity: 0 };
      last = undefined;
      write(target);
      spring.onRest?.();
      return;
    }
    write(state.value);
    handle = scheduler?.request(frame);
  };
  const spring: SpringValue = {
    get value() {
      return state.value;
    },
    get velocity() {
      return state.velocity;
    },
    get target() {
      return target;
    },
    to(next, velocity) {
      target = next;
      if (velocity !== undefined) state = { ...state, velocity };
      if (!scheduler) {
        spring.jump(next);
        return;
      }
      handle ??= scheduler.request(frame);
    },
    jump(value) {
      halt();
      state = { value, velocity: 0 };
      target = value;
      write(value);
    },
    shift(delta) {
      state = { ...state, value: state.value + delta };
      write(state.value);
    },
    onRest: null,
    stop: halt,
  };
  return spring;
}

/**
 * Keep an element's on-screen position continuous when its layout position (`offsetLeft`) moves
 * because `trigger` (the control's value) changed: the element is drawn where it was, through the
 * CSS `translate` property, and springs (`snappy`) to its new place with the velocity it already
 * had, so a new value mid-flight turns it around without a jump. It moves at once when `immediate()`
 * holds (a finger is on it), under Reduce Motion, and when its layout moved for any other reason (a
 * resize). `follow` gets the same offset each frame, for a part that travels with it.
 */
export function useSlideSpring(
  trigger: unknown,
  immediate: () => boolean = () => false,
  follow?: (offset: number) => void,
): (node: unknown) => void {
  const element = React.useRef<MotionElement | null>(null);
  const spring = React.useRef<SpringValue | null>(null);
  const lastLeft = React.useRef<number | null>(null);
  const lastTrigger = React.useRef<unknown>(trigger);
  const followRef = React.useRef(follow);
  followRef.current = follow;

  React.useLayoutEffect(() => {
    const el = element.current;
    if (!el) return;
    const left = el.offsetLeft;
    const previous = lastLeft.current;
    const changed = !Object.is(trigger, lastTrigger.current);
    lastLeft.current = left;
    lastTrigger.current = trigger;
    if (previous === null || previous === left) return;
    spring.current ??= createSpring('snappy', (offset) => {
      const target = element.current;
      if (target) target.style.translate = offset === 0 ? '' : `${offset}px 0px`;
      followRef.current?.(offset);
    });
    const s = spring.current;
    if (!changed || immediate() || reduceMotion() || !supportsTranslateProperty()) {
      s.jump(0);
      return;
    }
    s.shift(previous - left);
    s.to(0);
  });
  React.useEffect(() => () => spring.current?.stop(), []);

  return React.useCallback((node: unknown) => {
    element.current = motionElement(node);
  }, []);
}

// ── Momentum (system.md §4.3 rule 6) ─────────────────────────────────────────

const DECELERATION = 0.998;

/** Where a release at `velocity` px/s would come to rest, from where it is now. */
export function project(position: number, velocity: number): number {
  return position + ((velocity / 1000) * DECELERATION) / (1 - DECELERATION);
}

/** A gesture commits when its projected end passes `threshold` and its release velocity does not
 *  point back. Position alone never commits. */
export function commits(position: number, velocity: number, threshold: number): boolean {
  return velocity >= 0 && project(position, velocity) > threshold;
}

/** Past a bound, the element follows less the further it goes (constant 0.55). */
export function rubberBand(overshoot: number, dimension: number): number {
  const c = 0.55;
  return (overshoot * dimension * c) / (dimension + c * Math.abs(overshoot));
}

/** Release velocity in px/s from the last 100 ms of samples. */
export function releaseVelocity(samples: readonly { t: number; y: number }[]): number {
  if (samples.length < 2) return 0;
  const last = samples[samples.length - 1];
  const first = samples.find((s) => last.t - s.t <= 100) ?? samples[0];
  const dt = last.t - first.t;
  return dt > 0 ? ((last.y - first.y) / dt) * 1000 : 0;
}

// ── Press (system.md §4.3 rule 5, M1) ────────────────────────────────────────

/** Scale on touch-down per kind: 0.97 buttons and rows, 0.98 cards (§7.2), 0.92 icon buttons. */
export const PRESS_SCALE = { button: 0.97, row: 0.97, card: 0.98, icon: 0.92 } as const;
export type PressKind = keyof typeof PRESS_SCALE;
/** How far off the control a held press may wander before it lets go (rule 5). */
const PRESS_SLOP = 10;
/** The reduced press: opacity 0.7 over 100 ms. */
const REDUCED_PRESS = { opacity: 0.7, duration: 100 };

interface PointerLike {
  clientX: number;
  clientY: number;
}

export interface PressMotion {
  /** The element that shrinks (or dims); often the control itself. */
  ref: (node: unknown) => void;
  onPointerDown: (e: PointerLike) => void;
  onPointerMove: (e: PointerLike) => void;
  onPointerUp: () => void;
  onPointerLeave: () => void;
  onPointerCancel: () => void;
}

/**
 * Press feedback: on touch-down the element scales to its kind's press scale with `instant`, and on
 * release returns with `snappy`, each from where it is on screen. Moving more than 10 px off it lets
 * go; coming back presses again. Under Reduce Motion it dims to 0.7 instead.
 */
export function usePressMotion(kind: PressKind, enabled = true): PressMotion {
  const element = React.useRef<MotionElement | null>(null);
  const down = React.useRef(false);
  const pressed = React.useRef(false);

  const set = (next: boolean): void => {
    const el = element.current;
    if (!el || pressed.current === next) return;
    pressed.current = next;
    if (reduceMotion()) {
      const opacity = next ? REDUCED_PRESS.opacity : 1;
      retarget(el, 'press', { opacity }, fadeTiming(next ? 'in' : 'out', REDUCED_PRESS.duration), { fill: next ? 'forwards' : 'none' });
      return;
    }
    const transform = next ? `scale(${PRESS_SCALE[kind]})` : 'none';
    retarget(el, 'press', { transform }, springTiming(next ? 'instant' : 'snappy'), { fill: next ? 'forwards' : 'none' });
  };
  const inside = (e: PointerLike): boolean => {
    const el = element.current;
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return e.clientX >= r.left - PRESS_SLOP && e.clientX <= r.right + PRESS_SLOP && e.clientY >= r.top - PRESS_SLOP && e.clientY <= r.bottom + PRESS_SLOP;
  };
  const release = (): void => {
    down.current = false;
    set(false);
  };

  return {
    ref: React.useCallback((node: unknown) => {
      element.current = motionElement(node);
    }, []),
    onPointerDown: () => {
      if (!enabled) return;
      down.current = true;
      set(true);
    },
    onPointerMove: (e) => {
      if (down.current) set(inside(e));
    },
    onPointerUp: release,
    onPointerLeave: release,
    onPointerCancel: release,
  };
}

/** Pointer handlers of `a` and `b` called in turn, for an element that needs both. */
export function joinHandlers<T extends object>(a: T, b: object): T {
  const out: Record<string, unknown> = { ...(a as Record<string, unknown>) };
  for (const [name, handler] of Object.entries(b) as [string, unknown][]) {
    const first = out[name];
    out[name] =
      typeof first === 'function' && typeof handler === 'function'
        ? (...args: unknown[]) => {
            (first as (...a: unknown[]) => void)(...args);
            (handler as (...a: unknown[]) => void)(...args);
          }
        : handler;
  }
  return out as T;
}
