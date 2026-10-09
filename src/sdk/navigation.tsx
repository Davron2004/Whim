import * as React from 'react';
import type { AppSpec } from './index';
import { chromeInsetContext } from './chrome-inset';
import { ToastHost } from './toast';
import { canAnimate, fadeTiming, play, reduceMotion, retarget, springTiming, stop, type MotionElement, type MotionKeyframe, type Timing } from './motion';
import { activeTheme } from './tokens';

// ── Navigation (sdk-navigation D1–D4) ────────────────────────────────────────
// `nav` is deliberately a stable module-scope object rather than a hook: mini-app event
// handlers can call it directly, while the single SDK-owned NavRoot keeps React state and
// subscribes only for its mounted lifetime. Realm recreation destroys both sides together.
type NavAction =
  | { type: 'navigate'; screenName: string }
  | { type: 'back' };
type NavListener = (action: NavAction) => void;

let navListener: NavListener | undefined;

function emitNavAction(action: NavAction): void {
  navListener?.(action);
}

function subscribeToNav(listener: NavListener): () => void {
  navListener = listener;
  return () => {
    if (navListener === listener) navListener = undefined;
  };
}

export const nav = {
  navigate(screenName: string): void {
    emitNavAction({ type: 'navigate', screenName });
  },
  back(): void {
    emitNavAction({ type: 'back' });
  },
};

// How many screens sit under the current one (0 = the app's initial screen). `NavRoot` provides
// it and `Screen` reads it to decide whether its header shows a back control. Repository-internal
// like the chrome inset, and created on first use for the same reason (the build's React stub).
let depthContext: React.Context<number> | undefined;

export function navDepthContext(): React.Context<number> {
  depthContext ??= React.createContext(0);
  return depthContext;
}

export interface NavRootProps {
  spec: AppSpec;
  /** How much of the bottom edge the host's chrome covers, already sanitized by the loader. */
  chromeInsetBottom?: number;
}

interface NavMessageEvent {
  data: unknown;
  source?: unknown;
}

interface NavigationWindow {
  __whimGeneration?: number;
  parent: {
    postMessage(message: string, targetOrigin: string): void;
  };
  addEventListener(type: 'message', listener: (event: NavMessageEvent) => void): void;
  removeEventListener(type: 'message', listener: (event: NavMessageEvent) => void): void;
}

function navigationWindow(): NavigationWindow {
  return (globalThis as unknown as { window: NavigationWindow }).window;
}


// ── Push and pop (system.md §4.4 M24) ────────────────────────────────────────
// During a push or pop both screens are mounted: the one leaving stays until the motion ends, laid
// over or under the arriving one. Each outermost `Screen` reads its part from this context and moves
// its own element; NavRoot only says which part each screen plays and ends the transition.
/** `enter`: pushed, arriving on top. `cover`: the screen it covers. `exit`: popped, leaving on top.
 *  `reveal`: the screen it uncovers. `idle`: no transition. */
export type LayerRole = 'idle' | 'enter' | 'cover' | 'exit' | 'reveal';

export interface ScreenLayer {
  role: LayerRole;
  /** The window's scroll when the transition began: the leaving screen is held where it was. */
  scrollY: number;
}

export const IDLE_LAYER: ScreenLayer = Object.freeze({ role: 'idle', scrollY: 0 });

let layerContext: React.Context<ScreenLayer> | undefined;

export function screenLayerContext(): React.Context<ScreenLayer> {
  layerContext ??= React.createContext<ScreenLayer>(IDLE_LAYER);
  return layerContext;
}

/** How a screen in `role` is laid out while the transition runs: the leaving screen is lifted out of
 *  the flow where it was and ignores touches; the top one stacks above. */
export function layerStyle(layer: ScreenLayer): Record<string, unknown> {
  switch (layer.role) {
    case 'cover':
    case 'exit':
      return {
        position: 'fixed',
        top: `${-layer.scrollY}px`,
        left: 0,
        right: 0,
        zIndex: layer.role === 'exit' ? 1 : 0,
        pointerEvents: 'none',
      };
    case 'enter':
      return { position: 'relative', zIndex: 1 };
    case 'reveal':
      return { position: 'relative', zIndex: 0 };
    default:
      return {};
  }
}

interface LayerChannel {
  channel: string;
  from: MotionKeyframe;
  to: MotionKeyframe;
  timing: Timing;
}

/** iOS: the pushed screen slides in from the trailing edge over the previous one, which moves 30%
 *  and dims by 0.12. Android: the shared X axis, 30 px and a fade. Both reverse on pop. Reduced: a
 *  160 ms cross-fade in place. */
function layerChannels(role: Exclude<LayerRole, 'idle'>): LayerChannel[] {
  const arriving = role === 'enter' || role === 'reveal';
  if (reduceMotion()) {
    return [{ channel: 'fade', from: { opacity: arriving ? 0 : 1 }, to: { opacity: arriving ? 1 : 0 }, timing: fadeTiming('in') }];
  }
  const ios = activeTheme().platform === 'ios';
  // Where a screen sits off its place: pushed in from the trailing side, the covered one aside.
  const ahead = ios ? 'translateX(100%)' : 'translateX(30px)';
  const behind = ios ? 'translateX(-30%)' : 'translateX(-30px)';
  const slide: Record<typeof role, [string, string]> = {
    enter: [ahead, 'none'],
    cover: ['none', behind],
    exit: ['none', ahead],
    reveal: [behind, 'none'],
  };
  const smooth = springTiming('smooth');
  return [
    { channel: 'slide', from: { transform: slide[role][0] }, to: { transform: slide[role][1] }, timing: smooth },
    ...(ios ? iosDim(role, smooth) : [sharedAxisFade(arriving)]),
  ];
}

/** iOS: the covered screen dims by 0.12 as it goes under, and brightens as it comes back. */
function iosDim(role: Exclude<LayerRole, 'idle'>, timing: Timing): LayerChannel[] {
  const lit = { filter: 'brightness(1)' };
  const dim = { filter: 'brightness(0.88)' };
  if (role === 'cover') return [{ channel: 'dim', from: lit, to: dim, timing }];
  if (role === 'reveal') return [{ channel: 'dim', from: dim, to: lit, timing }];
  return [];
}

/** Android's shared axis: the leaving screen fades out first, then the arriving one fades in. */
function sharedAxisFade(arriving: boolean): LayerChannel {
  const fadeOut = fadeTiming('out');
  return arriving
    ? { channel: 'fade', from: { opacity: 0 }, to: { opacity: 1 }, timing: { ...fadeTiming('in'), delay: fadeOut.duration } }
    : { channel: 'fade', from: { opacity: 1 }, to: { opacity: 0 }, timing: fadeOut };
}

const LAYER_CHANNELS = ['slide', 'dim', 'fade'];

/** Move a screen's element into `role`. A screen just mounted starts from its role's start; one
 *  already on screen starts from where it is, so a back during a push turns it around mid-flight. */
export function playLayer(el: MotionElement, role: Exclude<LayerRole, 'idle'>, fresh: boolean): void {
  const channels = layerChannels(role);
  const used = new Set(channels.map((c) => c.channel));
  for (const name of LAYER_CHANNELS) if (!used.has(name)) stop(el, name);
  // The leaving screen holds its last frame until it unmounts.
  const fill = role === 'cover' || role === 'exit' ? 'forwards' : 'backwards';
  for (const { channel, from, to, timing } of channels) {
    if (fresh) {
      play(el, channel, [from, to], timing, { fill });
      continue;
    }
    retarget(el, channel, to, { ...timing, delay: 0 }, { fill: fill === 'forwards' ? 'forwards' : 'none' });
  }
}

/** How long a push or pop lasts before the leaving screen unmounts. */
function transitionMs(): number {
  return reduceMotion() ? fadeTiming('in').duration : springTiming('smooth').duration;
}

interface StackEntry {
  name: string;
  /** Unique per push, so a screen pushed again is a new screen. */
  id: number;
}

interface Transition {
  id: number;
  kind: 'push' | 'pop';
  outgoing: StackEntry;
  scrollY: number;
}

interface NavState {
  stack: StackEntry[];
  nextId: number;
  transition: Transition | null;
}

type NavStep =
  | { type: 'push'; screenName: string; animate: boolean; scrollY: number }
  | { type: 'pop'; animate: boolean; scrollY: number }
  | { type: 'settle'; id: number };

function navReducer(state: NavState, step: NavStep): NavState {
  if (step.type === 'settle') {
    return state.transition?.id === step.id ? { ...state, transition: null } : state;
  }
  const top = state.stack[state.stack.length - 1];
  if (step.type === 'pop' && state.stack.length <= 1) return state;
  const stack =
    step.type === 'push' ? [...state.stack, { name: step.screenName, id: state.nextId }] : state.stack.slice(0, -1);
  const transitionId = (state.transition?.id ?? 0) + 1;
  return {
    stack,
    nextId: state.nextId + 1,
    transition: step.animate ? { id: transitionId, kind: step.type, outgoing: top, scrollY: step.scrollY } : null,
  };
}

function windowScrollY(): number {
  const y = (globalThis as { scrollY?: unknown }).scrollY;
  return typeof y === 'number' && Number.isFinite(y) ? y : 0;
}

/** Repository-internal runtime mount point. Mini-apps use `nav`; the trusted loader mounts this root. */
export function NavRoot({ spec, chromeInsetBottom = 0 }: NavRootProps): React.ReactElement {
  const [state, dispatch] = React.useReducer(navReducer, spec.initial, (initial) => ({
    stack: [{ name: initial, id: 0 }],
    nextId: 1,
    transition: null,
  }));
  const { stack, transition } = state;

  React.useEffect(() => {
    const back = (): void => dispatch({ type: 'pop', animate: canAnimate(), scrollY: windowScrollY() });
    const unsubscribe = subscribeToNav((action) => {
      if (action.type === 'back') {
        back();
        return;
      }

      if (!Object.hasOwn(spec.screens, action.screenName)) {
        const declared = Object.keys(spec.screens).join(', ');
        console.warn(
          `vc-sdk nav: unknown screen "${action.screenName}"; declared screens: ${declared}`,
        );
        return;
      }
      dispatch({ type: 'push', screenName: action.screenName, animate: canAnimate(), scrollY: windowScrollY() });
    });

    const onMessage = (event: NavMessageEvent): void => {
      // Host-channel-only acceptance (mirrors loader.js:212 / syscall.js's ev.source guard): only
      // the outer runtime page (window.parent) is an accepted sender for __whimNavBack.
      if (event.source !== navigationWindow().parent) return;
      if (typeof event.data !== 'string') return;

      let frame: unknown;
      try {
        frame = JSON.parse(event.data);
      // eslint-disable-next-line no-restricted-syntax -- intentional: a malformed nav message is simply not the __whimNavBack frame this handler looks for
      } catch {
        return;
      }

      if (
        typeof frame === 'object' &&
        frame !== null &&
        !Array.isArray(frame) &&
        (frame as { __whimNavBack?: unknown }).__whimNavBack === true
      ) {
        back();
      }
    };
    navigationWindow().addEventListener('message', onMessage);

    return () => {
      unsubscribe();
      navigationWindow().removeEventListener('message', onMessage);
    };
  }, [spec]);

  React.useEffect(() => {
    const runtimeWindow = navigationWindow();
    // Opaque sandboxed srcdoc iframe: the parent's origin is unrepresentable as a
    // targetOrigin and any non-'*' value silently drops the frame; auth is receiver-side (ev.source).
    runtimeWindow.parent.postMessage( // NOSONAR
      JSON.stringify({
        __whimNavDepth: true,
        depth: stack.length - 1,
        generation: runtimeWindow.__whimGeneration,
      }),
      '*',
    );
  }, [stack.length]);

  // A new screen starts at its top; the leaving one is held where it was scrolled (layerStyle).
  const transitionId = transition?.id;
  React.useLayoutEffect(() => {
    if (transitionId === undefined) return undefined;
    (globalThis as { scrollTo?: (x: number, y: number) => void }).scrollTo?.(0, 0);
    const timer = setTimeout(() => dispatch({ type: 'settle', id: transitionId }), transitionMs());
    return () => clearTimeout(timer);
  }, [transitionId]);

  const depth = stack.length - 1;
  const layers: { entry: StackEntry; depth: number; layer: ScreenLayer }[] = [];
  let currentRole: LayerRole = 'idle';
  if (transition) currentRole = transition.kind === 'push' ? 'enter' : 'reveal';
  layers.push({ entry: stack[depth], depth, layer: { role: currentRole, scrollY: transition?.scrollY ?? 0 } });
  if (transition) {
    const outgoingDepth = transition.kind === 'push' ? depth - 1 : depth + 1;
    const role: LayerRole = transition.kind === 'push' ? 'cover' : 'exit';
    layers.push({ entry: transition.outgoing, depth: outgoingDepth, layer: { role, scrollY: transition.scrollY } });
    layers.sort((a, b) => a.depth - b.depth);
  }

  const layerCtx = screenLayerContext();
  const depthCtx = navDepthContext();
  return React.createElement(
    chromeInsetContext().Provider,
    { value: chromeInsetBottom },
    ...layers.map(({ entry, depth: layerDepth, layer }) =>
      React.createElement(
        layerCtx.Provider,
        { key: entry.id, value: layer },
        React.createElement(depthCtx.Provider, { value: layerDepth }, React.createElement(spec.screens[entry.name])),
      ),
    ),
    // After the screen, so the toast subscription runs after the app's first effects.
    React.createElement(ToastHost, { key: 'toast', bottomInset: chromeInsetBottom }),
  );
}
