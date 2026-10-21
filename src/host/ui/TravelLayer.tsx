/**
 * TravelLayer — where an element travels from one place on the shell's surfaces to another (system.md
 * §4.3, §4.4: the ember from the Making page to the Ready page's tile). It is drawn above a sheet's
 * card inside the sheet's own `Modal`: a `Modal` is a window of its own on Android and a presented
 * controller on iOS, so nothing drawn at the app's root would show over the sheet. It never takes a
 * touch.
 *
 * A place an element can leave from registers under a name (`useTravelSource`); a place it lands at
 * asks for it as it mounts (`useTravelTarget`). From then until the travel has landed the layer draws
 * the element and both places hide their own, so it is only ever seen once. Every frame measures both
 * places on the UI thread, so the element sets out from where the source is drawn, follows a card
 * dragged or a page scrolled on the way, and retargets when the target moves. It sits between them by
 * the spring's progress, scaled uniformly from the source's width to the target's (it is drawn at the
 * target's size, so it lands at 1). A target that finds no source to leave from, or that asks under
 * Reduce Motion, lands at once: it shows its own element in place.
 */
import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { makeMutable, measure, useAnimatedRef, useAnimatedStyle, useSharedValue, withSpring, type SharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { springConfig } from './tokens-pure';

type PlaceRef = ReturnType<typeof useAnimatedRef<View>>;

// A spring config as a module constant: a worklet never calls `springConfig` (motion.ts).
const MORPH = springConfig('morph');

interface Flight {
  readonly id: number;
  readonly source: PlaceRef;
  readonly target: PlaceRef;
  readonly node: React.ReactNode;
  readonly onLanded: () => void;
  /** How far it has come, 0 → 1 on `morph`: its own, so no travel starts from another's end. */
  readonly progress: SharedValue<number>;
}

interface Travel {
  /** `ref` is a place an element named `name` can leave from, until the returned call. */
  register: (name: string, ref: PlaceRef) => () => void;
  /** Some page holds a place an element can leave from. */
  hasSource: () => boolean;
  /** Sends the element `name` from its source to `target`, drawing `node` on the way; `onLanded` runs
   *  as it arrives. Returns the call that lands it at once, or `null` when nothing leaves from `name`. */
  fly: (name: string, target: PlaceRef, node: React.ReactNode, onLanded: () => void) => (() => void) | null;
  /** An element is on its way. */
  flying: () => boolean;
  /** `listener` hears each landing, until the returned call. */
  onLanding: (listener: () => void) => () => void;
}

const TravelContext = createContext<Travel | null>(null);

/** The element on its way, as the layer draws it. */
interface Drawn {
  readonly flight: Flight | null;
  readonly layer: PlaceRef;
}
const DrawnContext = createContext<Drawn | null>(null);

/** What the layer, the source and the target measure now, or `null` on a frame any of them cannot be
 *  measured: the style's first run on the JS thread, before the views are laid out, or once one has gone. */
function placesOf(layer: PlaceRef, flight: Flight) {
  'worklet';
  const origin = measure(layer);
  const from = measure(flight.source);
  const to = measure(flight.target);
  return origin === null || from === null || to === null || to.width === 0 ? null : { origin, from, to };
}

/** The travelling element at progress `progress` between what `source` and `target` measure now, both
 *  read against the layer's own place. It is drawn at the target's size, so only its transform and
 *  opacity move (§4.3). Hidden on a frame the places cannot be measured, when `TravelLeft` shows the
 *  source's own element instead. */
function Flying({ flight, layer }: Readonly<{ flight: Flight; layer: PlaceRef }>) {
  const { progress } = flight;
  const style = useAnimatedStyle(() => {
    const p = progress.value;
    const places = placesOf(layer, flight);
    if (places === null) return { opacity: 0 };
    const { origin, from, to } = places;
    const between = (a: number, b: number) => a + (b - a) * p;
    const scale = between(from.width / to.width, 1);
    return {
      opacity: 1,
      transform: [
        { translateX: between(from.pageX + from.width / 2, to.pageX + to.width / 2) - origin.pageX - to.width / 2 },
        { translateY: between(from.pageY + from.height / 2, to.pageY + to.height / 2) - origin.pageY - to.height / 2 },
        { scale },
      ],
    };
  });
  return <Animated.View style={[styles.flying, style]}>{flight.node}</Animated.View>;
}

/** Hosts travels between the places inside it, drawing each above them. */
export function TravelLayer({ children }: Readonly<{ children: React.ReactNode }>) {
  const layer = useAnimatedRef<View>();
  const [flight, setFlight] = useState<Flight | null>(null);
  const state = useRef({ flight: null as Flight | null, sources: new Map<string, PlaceRef>(), next: 1, listeners: new Set<() => void>() });
  const travel = useMemo<Travel>(() => {
    const own = state.current;
    const land = (id: number) => {
      const was = own.flight;
      if (was === null || was.id !== id) return;
      own.flight = null;
      setFlight(null);
      was.onLanded();
      for (const listener of [...own.listeners]) listener();
    };
    return {
      register: (name, ref) => {
        own.sources.set(name, ref);
        return () => {
          if (own.sources.get(name) === ref) own.sources.delete(name);
        };
      },
      hasSource: () => own.sources.size > 0,
      fly: (name, target, node, onLanded) => {
        const source = own.sources.get(name);
        if (source === undefined) return null;
        const id = own.next++;
        const progress = makeMutable(0);
        own.flight = { id, source, target, node, onLanded, progress };
        setFlight(own.flight);
        progress.value = withSpring(1, MORPH, (finished) => {
          'worklet';
          if (finished) scheduleOnRN(land, id);
        });
        return () => {
          if (own.flight?.id !== id) return;
          progress.value = 1;
          land(id);
        };
      },
      flying: () => own.flight !== null,
      onLanding: (listener) => {
        own.listeners.add(listener);
        return () => {
          own.listeners.delete(listener);
        };
      },
    };
  }, []);
  const drawn = useMemo<Drawn>(() => ({ flight, layer }), [flight, layer]);
  return (
    <TravelContext.Provider value={travel}>
      <DrawnContext.Provider value={drawn}>
        {children}
        <View ref={layer} style={StyleSheet.absoluteFill} pointerEvents="none" collapsable={false}>
          {flight ? <Flying key={flight.id} flight={flight} layer={layer} /> : null}
        </View>
      </DrawnContext.Provider>
    </TravelContext.Provider>
  );
}

/** A page an element has left from, kept in place (unseen by touch and by a screen reader) while the
 *  element travels. It is hidden on exactly the frames the layer draws the element, so the element is
 *  always seen once: never twice, and never on no frame at all as the travel sets out. */
export function TravelLeft({ children }: Readonly<{ children: React.ReactNode }>) {
  const drawn = useContext(DrawnContext);
  const fallback = useSharedValue(0);
  const flight = drawn?.flight ?? null;
  const layer = drawn?.layer ?? null;
  const progress = flight?.progress ?? fallback;
  const style = useAnimatedStyle(() => {
    // Read so this runs on every frame of the travel, as the element's own style does.
    progress.value;
    return { opacity: flight !== null && layer !== null && placesOf(layer, flight) !== null ? 0 : 1 };
  });
  return (
    <Animated.View style={[StyleSheet.absoluteFill, style]} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {children}
    </Animated.View>
  );
}

/** The travel layer the caller sits in, or `null` outside one. */
export function useTravel(): Travel | null {
  return useContext(TravelContext);
}

/** A place the element `name` can leave from: put the returned ref on the view it is drawn in. */
export function useTravelSource(name: string): PlaceRef {
  const travel = useTravel();
  const ref = useAnimatedRef<View>();
  useEffect(() => travel?.register(name, ref), [travel, name, ref]);
  return ref;
}

/** A place the element `name` lands at as the caller mounts, drawn as `node` on its way (at this
 *  place's size). Put `ref` on the view the caller draws its own element in, and hide that element
 *  while `travelling`. `landed` turns true once it has arrived (at once when nothing leaves from
 *  `name`, or `instant`); `land` brings it there now. */
export function useTravelTarget(name: string, node: React.ReactNode, instant: boolean): { ref: PlaceRef; travelling: boolean; landed: boolean; land: () => void } {
  const travel = useTravel();
  const ref = useAnimatedRef<View>();
  const [landed, setLanded] = useState(() => instant || travel === null || !travel.hasSource());
  const landNow = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (landed || travel === null) return;
    landNow.current = travel.fly(name, ref, node, () => setLanded(true));
    if (landNow.current === null) setLanded(true);
    // Asked for once, as the caller mounts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return { ref, travelling: !landed, landed, land: () => landNow.current?.() };
}

const styles = StyleSheet.create({
  flying: { position: 'absolute', top: 0, left: 0 },
});
