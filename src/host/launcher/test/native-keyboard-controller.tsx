/** react-native-keyboard-controller for React interaction tests. The keyboard is played in with
 *  `moveKeyboard`, as the native side reports it: the JS `keyboardWill…` event, the worklet
 *  handlers' `onStart` (destination), one `onMove` per frame step, `onEnd`, then `keyboardDid…`.
 *  Heights are measured up from the bottom of an 844-high window (`keyboardWindow`), as the library
 *  reports them. Nothing runs on a UI thread: worklet handlers run inline. */
import React from 'react';

interface MoveEvent { height: number; progress: number; duration: number; target: number }
type Worklet = (event: MoveEvent) => void;
interface Handler { onStart?: Worklet; onMove?: Worklet; onInteractive?: Worklet; onEnd?: Worklet }
type EventName = 'keyboardWillShow' | 'keyboardDidShow' | 'keyboardWillHide' | 'keyboardDidHide';
interface EventData { height: number; duration: number; timestamp: number; target: number; type: string; appearance: string }
type Listener = (event: EventData) => void;

const handlers = new Set<{ current: Handler }>();
const listeners = new Map<EventName, Set<Listener>>();
/** The window the library measures, which `useWindowDimensions` reports. */
export const keyboardWindow = { width: 390, height: 844 };
/** Where the keyboard is and how often it was put away. */
export const keyboardState = { height: 0, visible: false, dismissed: 0 };

const data = (height: number): EventData => ({ height, duration: 250, timestamp: 0, target: -1, type: 'default', appearance: 'light' });

function emit(name: EventName, height: number): void {
  for (const listener of [...(listeners.get(name) ?? [])]) listener(data(height));
}

export const KeyboardEvents = {
  addListener: (name: EventName, listener: Listener) => {
    const set = listeners.get(name) ?? new Set<Listener>();
    listeners.set(name, set);
    set.add(listener);
    return { remove: () => { set.delete(listener); } };
  },
};

export const KeyboardController = {
  isVisible: () => keyboardState.visible,
  state: () => data(keyboardState.height),
  dismiss: async () => { keyboardState.dismissed += 1; },
};

export function useGenericKeyboardHandler(handler: Handler, _deps?: unknown[]): void {
  const ref = React.useRef(handler);
  ref.current = handler;
  React.useLayoutEffect(() => {
    handlers.add(ref);
    return () => { handlers.delete(ref); };
  }, []);
}

export function useWindowDimensions(): { width: number; height: number } {
  return keyboardWindow;
}

export function KeyboardProvider({ children }: { children?: React.ReactNode }) {
  return React.createElement(React.Fragment, null, children);
}

/** Plays the keyboard moving from where it is to `height` (0: hidden) through `steps` intermediate
 *  heights, as the library reports it. A move between two non-zero heights is a keyboard changing
 *  height while up: the library reports it as a show, instantly. */
export function moveKeyboard(height: number, steps: readonly number[] = []): void {
  const showing = height > 0;
  emit(showing ? 'keyboardWillShow' : 'keyboardWillHide', height);
  const progress = showing ? 1 : 0;
  for (const ref of [...handlers]) ref.current.onStart?.({ height, progress, duration: 250, target: -1 });
  for (const step of [...steps, height]) {
    for (const ref of [...handlers]) ref.current.onMove?.({ height: step, progress, duration: 250, target: -1 });
  }
  keyboardState.height = height;
  keyboardState.visible = showing;
  for (const ref of [...handlers]) ref.current.onEnd?.({ height, progress, duration: 250, target: -1 });
  emit(showing ? 'keyboardDidShow' : 'keyboardDidHide', height);
}

/** An interactive drag (iOS) moving the keyboard to `height` without ending. */
export function dragKeyboard(height: number): void {
  for (const ref of [...handlers]) ref.current.onInteractive?.({ height, progress: height > 0 ? 1 : 0, duration: -1, target: -1 });
}

/** Every handler and event listener still subscribed. */
export function keyboardSubscriptions(): ReadonlySet<unknown> {
  return new Set<unknown>([...handlers, ...[...listeners.values()].flatMap((set) => [...set])]);
}

/** Puts the keyboard back down with no events, between tests. */
export function resetKeyboard(): void {
  keyboardState.height = 0;
  keyboardState.visible = false;
}

/** One frame of a keyboard animation still running: the handlers' `onMove` only. */
export function stepKeyboard(height: number): void {
  for (const ref of [...handlers]) ref.current.onMove?.({ height, progress: height > 0 ? 1 : 0, duration: 250, target: -1 });
}

/** One JS keyboard event on its own, as the library sends it. */
export function emitKeyboardEvent(name: EventName, height: number): void {
  emit(name, height);
}
