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
import Animated, { measure, useAnimatedRef, useAnimatedStyle, useSharedValue, withSpring, type SharedValue } from 'react-native-reanimated';
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

/** The travelling element at progress `progress` between what `source` and `target` measure now, both
 *  read against the layer's own place. It is drawn at the target's size, so only its transform and
 *  opacity move (§4.3). Hidden on a frame either place cannot be measured. */
function Flying({ flight, layer, progress }: Readonly<{ flight: Flight; layer: PlaceRef; progress: SharedValue<number> }>) {
  const { source, target } = flight;
  const style = useAnimatedStyle(() => {
    const p = progress.value;
    const origin = measure(layer);
    const from = measure(source);
    const to = measure(target);
    if (origin === null || from === null || to === null || to.width === 0) return { opacity: 0 };
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
  const progress = useSharedValue(0);
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
        own.flight = { id, source, target, node, onLanded };
        setFlight(own.flight);
        progress.value = 0;
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
  }, [progress]);
  return (
    <TravelContext.Provider value={travel}>
      {children}
      <View ref={layer} style={StyleSheet.absoluteFill} pointerEvents="none" collapsable={false}>
        {flight ? <Flying key={flight.id} flight={flight} layer={layer} progress={progress} /> : null}
      </View>
    </TravelContext.Provider>
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
