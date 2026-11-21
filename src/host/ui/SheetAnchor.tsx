/**
 * SheetAnchor — the places on the screen behind a sheet that the sheet grows out of as it opens and
 * shrinks back into as it closes (system.md §4.4 M6: the composer grows into the Describe sheet; M5:
 * the Making sheet shrinks into its ghost tile, and tapping the tile reverses it).
 *
 * Those places are on Home, outside the sheet's `Modal`, which is a window of its own on Android and a
 * presented controller on iOS: nothing in the sheet can draw over Home except inside that window. So
 * the sheet draws the whole moment itself, in its own window, and keeps the window up until the
 * moment has ended: a place registers its view here (`useSheetAnchor`), the sheet measures it on the
 * UI thread on every frame (a `Modal`'s content measures from its own top-left, Home from the app
 * root's; both fill the window on both platforms, so the two agree), draws a copy of what the place
 * shows (`face`) where it is, never moving, and grows its plate from there (`Sheet`).
 */
import React, { createContext, useContext, useEffect, useLayoutEffect, useState, useSyncExternalStore } from 'react';
import type { LayoutChangeEvent, View, ViewInstance } from 'react-native';
import { measure, useAnimatedRef } from 'react-native-reanimated';
import { createSynchronizable, isRNRuntime, scheduleOnUI, type FixedSynchronizable } from 'react-native-worklets';

/** A view the UI thread measures (`measured`): put `attach` on the view as its ref. */
export interface PlaceRef {
  readonly ref: ReturnType<typeof useAnimatedRef<View>>;
  /** Whether the UI thread may measure `ref`'s view (`measured` asks this first): positive while the
   *  ref holds a view that is in the tree React committed. Reanimated 4.8's `measure` logs a warning on
   *  every call for a ref that holds no view, and for a view that has left the committed tree, and a
   *  worklet cannot ask the ref (it holds the ref's Shareable, no function). */
  readonly on: FixedSynchronizable<number>;
  readonly attach: (view: ViewInstance | null) => void;
}

/** The view put on a place (`-view` while it is being put on, `view` once it is on) is on for the UI
 *  thread, unless the place has let it go or taken another since. */
function viewOn(on: FixedSynchronizable<number>, view: number): void {
  'worklet';
  on.setBlocking((now) => (now === -view ? view : now));
}

/**
 * A place for one view. `on` turns off at once, on both threads, as React takes the view off the ref,
 * which it does as it commits the view's removal, before the tree without it is the committed one: the
 * window in which a UI frame can measure a view that has left the tree shrinks from a frame to the
 * gap between `measured`'s read of `on` and its `measure` (React can commit between the two). A write
 * to a shared value would only be queued for the UI thread (mutables.native.ts, `scheduleOnUI`), and
 * frames run between the commit and the write (the exit's ceiling taking a sheet's window down, a
 * travel's page dropped as it lands). It turns on
 * only from the UI thread's queue, after the ref's own write (useAnimatedRef.native.ts, `scheduleOnUI`),
 * so a worklet never finds it on while the ref holds nothing.
 */
export function usePlace(): PlaceRef {
  const ref = useAnimatedRef<View>();
  const [place] = useState<PlaceRef>(() => {
    const on = createSynchronizable(0, { fixedType: true });
    let views = 0;
    return {
      ref,
      on,
      attach: (view) => {
        if (view === null) {
          on.setBlocking(0);
          ref(null);
          return;
        }
        views += 1;
        on.setBlocking(-views);
        ref(view);
        scheduleOnUI(viewOn, on, views);
      },
    };
  });
  return place;
}

/** The name a run's tile is registered under as a sheet's anchor: its making sheet goes back into it. */
export const tileAnchor = (runId: string): string => `tile:${runId}`;

/** The name an installed app's tile is registered under: the app grows out of it as it opens and
 *  shrinks back into it as it closes (system.md §4.4 M2, M3; `MiniAppView`). */
export const appAnchor = (appId: string): string => `app:${appId}`;

/** How a place looks, for the sheet that grows out of it or shrinks into it. */
export interface SheetAnchorLook {
  /** The corner radius of its shape (a capsule's is capped to half its height). */
  readonly radius: number;
  /** What it shows, without an ember of its own when it has an ember place (the sheet's ember lands
   *  there). Drawn at the place's size. */
  readonly face: React.ReactNode;
  /** What tapping the place does: a tap on it while the sheet shrinks into it reverses the close. */
  readonly onPress?: () => void;
}

/** A registered place: its view, the view its ember is drawn in (if any), how it looks and its size. */
export interface SheetAnchorEntry {
  readonly ref: PlaceRef;
  readonly ember: PlaceRef;
  readonly look: SheetAnchorLook;
  readonly size: { readonly width: number; readonly height: number };
}

class Anchors {
  private readonly entries = new Map<string, SheetAnchorEntry>();
  private readonly listeners = new Set<() => void>();
  get = (name: string): SheetAnchorEntry | undefined => this.entries.get(name);
  set(name: string, entry: SheetAnchorEntry): void {
    this.entries.set(name, entry);
    this.heard();
  }
  delete(name: string, ref: PlaceRef): void {
    if (this.entries.get(name)?.ref !== ref) return;
    this.entries.delete(name);
    this.heard();
  }
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private heard(): void {
    for (const listener of [...this.listeners]) listener();
  }
}

const AnchorsContext = createContext<Anchors | null>(null);

/** Holds the places a sheet inside it can grow out of or shrink into. */
export function SheetAnchors({ children }: Readonly<{ children: React.ReactNode }>) {
  const [anchors] = useState(() => new Anchors());
  return <AnchorsContext.Provider value={anchors}>{children}</AnchorsContext.Provider>;
}

const NO_SIZE = { width: 0, height: 0 } as const;

/** Registers the caller's view as the place `names` (one name, or several: an app's tile is its
 *  app's place and its change's; none while undefined). Put `ref` and `onLayout` on the view whose
 *  shape the sheet grows from, and `ember` on its ember's view, if any. */
export function useSheetAnchor(names: string | readonly string[] | undefined, look: SheetAnchorLook) {
  const anchors = useContext(AnchorsContext);
  const ref = usePlace();
  const ember = usePlace();
  const [size, setSize] = useState<SheetAnchorEntry['size']>(NO_SIZE);
  // One key for the effect below, whatever array the caller builds each render.
  const listed = names === undefined ? [] : ([] as string[]).concat(names);
  const key = listed.length === 0 ? undefined : listed.join('\n');
  // Every render, so the face drawn in the sheet is what the place shows now.
  useLayoutEffect(() => {
    if (anchors === null || key === undefined) return;
    for (const name of key.split('\n')) anchors.set(name, { ref, ember, look, size });
  });
  useEffect(() => {
    if (anchors === null || key === undefined) return undefined;
    return () => {
      for (const name of key.split('\n')) anchors.delete(name, ref);
    };
  }, [anchors, key, ref]);
  const onLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setSize((was) => (was.width === width && was.height === height ? was : { width, height }));
  };
  return { ref: ref.attach, ember: ember.attach, onLayout };
}

const none = () => () => {};
const nothing = () => undefined;

/** The place `name` as it is registered now, or undefined (no such place, or no `SheetAnchors`). */
export function useAnchorEntry(name: string | undefined): SheetAnchorEntry | undefined {
  const anchors = useContext(AnchorsContext);
  return useSyncExternalStore(anchors?.subscribe ?? none, anchors && name !== undefined ? () => anchors.get(name) : nothing);
}

/** What `place` measures, or `null`, also while it is on no view (the composer has no ember place,
 *  and a tile whose state has no ember draws none), without asking Reanimated then. */
export function measured(place: PlaceRef) {
  'worklet';
  if (isRNRuntime()) return null;
  return place.on.getDirty() > 0 ? measure(place.ref) : null;
}

/** Where `place` is drawn, from the frame's top-left, or `null` on a frame either cannot be measured. */
export function placeIn(frame: PlaceRef, place: PlaceRef) {
  'worklet';
  const origin = measured(frame);
  const at = measured(place);
  if (origin === null || at === null || at.width === 0) return null;
  return { x: at.pageX - origin.pageX, y: at.pageY - origin.pageY, width: at.width, height: at.height, frameWidth: origin.width, frameHeight: origin.height };
}
