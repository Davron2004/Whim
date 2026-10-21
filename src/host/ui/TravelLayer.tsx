/**
 * TravelLayer — where an element travels from one place on the shell's surfaces to another (system.md
 * §4.3, §4.4: the ember from Make it to the Making page's 128 (M9), and from the Making page to the
 * Ready page's tile (M10)). It is drawn above a sheet's card inside the sheet's own `Modal`: a
 * `Modal` is a window of its own on Android and a presented controller on iOS, so nothing drawn at
 * the app's root would show over the sheet. It never takes a touch.
 *
 * A place an element can leave from registers under a name (`useTravelSource`), with the ember light
 * it is drawn in when it has one; a place it lands at asks for it as it mounts (`useTravelTarget`).
 * From then until the travel has landed the layer draws the element, in the light it had where it
 * set out, and both places hide their own, so it is only ever seen once. Every frame measures both
 * places on the UI thread, so the element sets out from where the source is drawn, follows a card
 * dragged or a page scrolled on the way, and retargets when the target moves. It sits between them by
 * the spring's progress, scaled uniformly from the source's width to the target's (it is drawn at the
 * target's size, so it lands at 1). A target that finds no source to leave from lands at once; one
 * that asks under Reduce Motion is handed the element without a travel and shows its own in place.
 *
 * The page a travel left from stays, untouchable, under the page that asked for it (`TravelPage`)
 * and fades out on `fade-out` as the travel goes, so nothing on it vanishes in one frame.
 */
import React, { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { makeMutable, measure, useAnimatedRef, useAnimatedStyle, useSharedValue, withSpring, withTiming, type SharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import type { EmberLight, EmberLightRef } from './Ember';
import { timing } from './motion';
import { useTokens } from './tokens';
import { springConfig } from './tokens-pure';

type PlaceRef = ReturnType<typeof useAnimatedRef<View>>;

// A spring config as a module constant: a worklet never calls `springConfig` (motion.ts).
const MORPH = springConfig('morph');

interface Source {
  readonly ref: PlaceRef;
  /** Reads the light the element is drawn in at the source, when it is an ember. */
  readonly light: EmberLightRef | undefined;
}

interface Flight {
  readonly id: number;
  readonly source: PlaceRef;
  readonly target: PlaceRef;
  readonly node: React.ReactNode;
  readonly onLanded: () => void;
  /** How far it has come, 0 → 1 on `morph`: its own, so no travel starts from another's end. */
  readonly progress: SharedValue<number>;
}

/** What a target is handed: whether a source was there, and the light the element left it in. */
export interface Handed {
  /** The light the element was drawn in at its source, or `null` when the source draws no ember. */
  readonly light: EmberLight | null;
  /** Lands it now; nothing once it has. */
  readonly land: () => void;
}

interface Travel {
  /** `ref` is a place an element named `name` can leave from, until the returned call. */
  register: (name: string, ref: PlaceRef, light: EmberLightRef | undefined) => () => void;
  /** Some page holds a place an element can leave from: `name`'s, or any one. */
  hasSource: (name?: string) => boolean;
  /** Hands the element `name` from its source to `target`, drawing `draw(light)` on the way (at once
   *  when `instant`); `onLanded` runs as it arrives. `null` when nothing leaves from `name`. */
  fly: (name: string, target: PlaceRef, draw: (light: EmberLight | null) => React.ReactNode, instant: boolean, onLanded: () => void) => Handed | null;
  /** An element is on its way. */
  flying: () => boolean;
  /** Whether an element was handed over since the last call: a target asked a source for it. */
  takeHandOff: () => boolean;
  /** `listener` hears each landing, until the returned call. */
  onLanding: (listener: () => void) => () => void;
}

const TravelContext = createContext<Travel | null>(null);

/** The element on its way, as the layer draws it, and the sources it has left for good. */
interface Drawn {
  readonly flight: Flight | null;
  readonly layer: PlaceRef;
  readonly left: ReadonlySet<PlaceRef>;
}
const DrawnContext = createContext<Drawn | null>(null);

/** What the layer, the source and the target measure now, or `null` on a frame any of them cannot be
 *  measured: the style's first run on the JS thread, before the views are laid out, or once one has gone. */
function placesOf(layer: PlaceRef, source: PlaceRef, target: PlaceRef) {
  'worklet';
  const origin = measure(layer);
  const from = measure(source);
  const to = measure(target);
  return origin === null || from === null || to === null || to.width === 0 ? null : { origin, from, to };
}

/** The travelling element at progress `progress` between what `source` and `target` measure now, both
 *  read against the layer's own place. It is drawn at the target's size, so only its transform and
 *  opacity move (§4.3). Hidden on a frame the places cannot be measured, when the source shows its
 *  own element instead (`useTravelSource`). */
function Flying({ flight, layer }: Readonly<{ flight: Flight; layer: PlaceRef }>) {
  // Only the refs and the progress go to the UI thread, never the element drawn.
  const { progress, source, target } = flight;
  const style = useAnimatedStyle(() => {
    const p = progress.value;
    const places = placesOf(layer, source, target);
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

/** A set's update that takes `ref` out of it, leaving the same set when it was not in it. */
const without = (ref: PlaceRef) => (set: ReadonlySet<PlaceRef>): ReadonlySet<PlaceRef> => {
  if (!set.has(ref)) return set;
  const next = new Set(set);
  next.delete(ref);
  return next;
};

/** Hosts travels between the places inside it, drawing each above them. */
export function TravelLayer({ children }: Readonly<{ children: React.ReactNode }>) {
  const layer = useAnimatedRef<View>();
  const [flight, setFlight] = useState<Flight | null>(null);
  const [left, setLeft] = useState<ReadonlySet<PlaceRef>>(new Set());
  const state = useRef({ flight: null as Flight | null, sources: new Map<string, Source>(), next: 1, handedOff: false, listeners: new Set<() => void>() });
  const travel = useMemo<Travel>(() => {
    const own = state.current;
    const heard = () => {
      for (const listener of [...own.listeners]) listener();
    };
    const leaves = (source: PlaceRef) => setLeft((was) => new Set(was).add(source));
    const land = (id: number) => {
      const was = own.flight;
      if (was === null || was.id !== id) return;
      own.flight = null;
      leaves(was.source);
      setFlight(null);
      was.onLanded();
      heard();
    };
    return {
      register: (name, ref, light) => {
        const source = { ref, light };
        own.sources.set(name, source);
        return () => {
          if (own.sources.get(name) === source) own.sources.delete(name);
          setLeft(without(ref));
        };
      },
      hasSource: (name) => (name === undefined ? own.sources.size > 0 : own.sources.has(name)),
      fly: (name, target, draw, instant, onLanded) => {
        const source = own.sources.get(name);
        if (source === undefined) return null;
        own.handedOff = true;
        const light = source.light?.current?.() ?? null;
        if (instant) {
          leaves(source.ref);
          onLanded();
          heard();
          return { light, land: () => {} };
        }
        const id = own.next++;
        const progress = makeMutable(0);
        own.flight = { id, source: source.ref, target, node: draw(light), onLanded, progress };
        setFlight(own.flight);
        progress.value = withSpring(1, MORPH, (finished) => {
          'worklet';
          if (finished) scheduleOnRN(land, id);
        });
        return {
          light,
          land: () => {
            if (own.flight?.id !== id) return;
            progress.value = 1;
            land(id);
          },
        };
      },
      flying: () => own.flight !== null,
      takeHandOff: () => {
        const was = own.handedOff;
        own.handedOff = false;
        return was;
      },
      onLanding: (listener) => {
        own.listeners.add(listener);
        return () => {
          own.listeners.delete(listener);
        };
      },
    };
  }, []);
  const drawn = useMemo<Drawn>(() => ({ flight, layer, left }), [flight, layer, left]);
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

export interface TravelPageProps {
  /** A page that replaced this one asked for an element from it: it stays under that page, unseen by
   *  touch and by a screen reader, and fades out on `fade-out` (the cross-fade under Reduce Motion). */
  leaving: boolean;
  /** Its fade-out has ended. */
  onFaded: () => void;
  /** How it lays out while it is the page shown. */
  style: StyleProp<ViewStyle>;
  children: React.ReactNode;
}

/** One page of a surface with a travel layer: the same view while it is shown and as it leaves, so
 *  nothing on it is mounted again (an ember's light, a scroll position) as it fades. */
export function TravelPage({ leaving, onFaded, style, children }: Readonly<TravelPageProps>) {
  const t = useTokens();
  const opacity = useSharedValue(1);
  const faded = useRef(onFaded);
  faded.current = onFaded;
  // Before the frame it is first drawn leaving on, so it fades from the frame the element sets out.
  useLayoutEffect(() => {
    if (!leaving) return;
    const done = () => faded.current();
    opacity.value = withTiming(0, timing('fadeOut', t.reduceMotion), (finished) => {
      'worklet';
      if (finished) scheduleOnRN(done);
    });
    // Fades once, as it starts to leave, in the setting it left under.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leaving]);
  const fade = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return leaving ? (
    <Animated.View style={[StyleSheet.absoluteFill, fade]} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {children}
    </Animated.View>
  ) : (
    <Animated.View style={[style, fade]}>{children}</Animated.View>
  );
}

/** The travel layer the caller sits in, or `null` outside one. */
export function useTravel(): Travel | null {
  return useContext(TravelContext);
}

/** A place the element `name` can leave from, drawn in the ember light `light` reads when it is an
 *  ember. Put `ref` on the view the element is drawn in and `hidden` on the element: it hides it on
 *  exactly the frames the layer draws it and, once it has landed (or been handed over at once), for
 *  good, so it is always seen once — never twice, and never on no frame at all as the travel sets out.
 *  A place that shows no element of its own until it sends one (Make it) puts `departing` on the
 *  element instead: it shows it only on the frames a travel from here has set out and the layer
 *  cannot draw it yet. */
export function useTravelSource(name: string, light?: EmberLightRef) {
  const travel = useTravel();
  const drawn = useContext(DrawnContext);
  const ref = useAnimatedRef<View>();
  useEffect(() => travel?.register(name, ref, light), [travel, name, ref, light]);
  const fallback = useSharedValue(0);
  const flight = drawn?.flight ?? null;
  const mine = flight !== null && flight.source === ref;
  const gone = drawn?.left.has(ref) ?? false;
  const layer = drawn?.layer ?? ref;
  const target = flight?.target ?? ref;
  const progress = flight?.progress ?? fallback;
  const hidden = useAnimatedStyle(() => {
    // Read so this runs on every frame of the travel, as the element's own style does.
    progress.value;
    return { opacity: gone || (mine && placesOf(layer, ref, target) !== null) ? 0 : 1 };
  });
  const departing = useAnimatedStyle(() => {
    progress.value;
    return { opacity: !gone && mine && placesOf(layer, ref, target) === null ? 1 : 0 };
  });
  return { ref, hidden, departing };
}

export interface TravelTarget {
  ref: PlaceRef;
  /** On its way: hide the caller's own element. */
  travelling: boolean;
  /** It has arrived: at once when nothing left from `name`, or under `instant`. */
  landed: boolean;
  /** The caller was reached from a source of `name` (travelled or, under `instant`, handed over). */
  arrived: boolean;
  /** The light it was drawn in at its source; `null` when none was handed or the source draws no ember. */
  light: EmberLight | null;
  /** Brings it there now. */
  land: () => void;
}

/** A place the element `name` lands at as the caller mounts, drawn as `draw(light)` on its way (at
 *  this place's size), in the light it had at its source. Put `ref` on the view the caller draws its
 *  own element in, and hide that element while `travelling`. */
export function useTravelTarget(name: string, draw: (light: EmberLight | null) => React.ReactNode, instant: boolean): TravelTarget {
  const travel = useTravel();
  const ref = useAnimatedRef<View>();
  const [arrived] = useState(() => travel !== null && travel.hasSource(name));
  const [landed, setLanded] = useState(!arrived || instant);
  const [light, setLight] = useState<EmberLight | null>(null);
  const handed = useRef<Handed | null>(null);
  // Before the frame the caller is first drawn on, so the element sets out on that same frame.
  useLayoutEffect(() => {
    if (!arrived || travel === null) return;
    handed.current = travel.fly(name, ref, draw, instant, () => setLanded(true));
    if (handed.current === null) setLanded(true);
    else setLight(handed.current.light);
    // Asked for once, as the caller mounts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return { ref, travelling: !landed, landed, arrived, light, land: () => handed.current?.land() };
}

const styles = StyleSheet.create({
  flying: { position: 'absolute', top: 0, left: 0 },
});
