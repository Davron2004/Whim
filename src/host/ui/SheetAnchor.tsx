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
import type { LayoutChangeEvent, View } from 'react-native';
import { useAnimatedRef } from 'react-native-reanimated';

export type PlaceRef = ReturnType<typeof useAnimatedRef<View>>;

/** The name a run's tile is registered under as a sheet's anchor: its making sheet goes back into it. */
export const tileAnchor = (runId: string): string => `tile:${runId}`;

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

/** Registers the caller's view as the place `name` (none while `name` is undefined). Put `ref` and
 *  `onLayout` on the view whose shape the sheet grows from, and `ember` on its ember's view, if any. */
export function useSheetAnchor(name: string | undefined, look: SheetAnchorLook) {
  const anchors = useContext(AnchorsContext);
  const ref = useAnimatedRef<View>();
  const ember = useAnimatedRef<View>();
  const [size, setSize] = useState<SheetAnchorEntry['size']>(NO_SIZE);
  // Every render, so the face drawn in the sheet is what the place shows now.
  useLayoutEffect(() => {
    if (anchors !== null && name !== undefined) anchors.set(name, { ref, ember, look, size });
  });
  useEffect(() => {
    if (anchors === null || name === undefined) return undefined;
    return () => anchors.delete(name, ref);
  }, [anchors, name, ref]);
  const onLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setSize((was) => (was.width === width && was.height === height ? was : { width, height }));
  };
  return { ref, ember, onLayout };
}

const none = () => () => {};
const nothing = () => undefined;

/** The place `name` as it is registered now, or undefined (no such place, or no `SheetAnchors`). */
export function useAnchorEntry(name: string | undefined): SheetAnchorEntry | undefined {
  const anchors = useContext(AnchorsContext);
  return useSyncExternalStore(anchors?.subscribe ?? none, anchors && name !== undefined ? () => anchors.get(name) : nothing);
}
