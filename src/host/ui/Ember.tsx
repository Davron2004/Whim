/**
 * Ember and AmbientLight — Whim's mark and its light (system.md §3.3, §4.6). The ember is the flame
 * silhouette filled with the glow gradient over a `glow-ember` halo; it is honest: working
 * intensity follows `activity` through the §4.6 smoothing spring and flickers with the run's token
 * arrivals (`useFlicker`), stuck dims to 35% over 1.5 s and holds still, out is the 1.5 pt `text-2`
 * outline alone. A change of `spark` plays the done flare (1 → 1.18 → 1, `spark`). Under Reduce
 * Motion the ember is a still intensity per state, cross-faded, with no flicker and no flare. Both
 * are hidden from screen readers: the status line carries the words. An ember that travels on as
 * another (`TravelLayer`) carries its light as drawn (`EmberLight`), so it neither brightens nor dims
 * on the way.
 */

import React, { useEffect, useId, useRef } from 'react';
import { StyleSheet } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSequence, withSpring, withTiming, type SharedValue } from 'react-native-reanimated';
import Svg, { Circle, Defs, LinearGradient, Path, RadialGradient, Rect, Stop } from 'react-native-svg';
import { GLOW } from '../../design/tokens';
import { EMBER_PATH, EMBER_VIEWBOX } from '../../design/icons/ember';
import type { FlickerPulse } from '../launcher/home-live';
import { timing } from './motion';
import { useTokens } from './tokens';
import {
  ACTIVITY_SMOOTHING,
  AMBIENT_STOPS,
  ambientOpacity,
  emberLook,
  emberOutlineWidth,
  emberSize,
  flickerOffset,
  HONEST_LIGHT,
  SPARK_PEAK,
  springConfig,
  type EmberSize,
  type EmberState,
  type ShellTokens,
} from './tokens-pure';

const HIDDEN = {
  accessible: false,
  accessibilityElementsHidden: true,
  importantForAccessibility: 'no-hide-descendants' as const,
};

/** The activity of an ember that is not following a stream (the empty Home, the composer bar): the
 *  mockup's still, fully lit mark rather than the 0.55 floor that reads as a dim brown in dark. */
export const RESTING_ACTIVITY = 1;

/** The halo is the ember's own 48 grid plus this margin on every side, so its circle (r 24 about the
 *  body's centre, 5 below the grid's) fades out inside the drawing instead of being cut flat. */
const HALO_MARGIN = 12;
const HALO_GRID = EMBER_VIEWBOX + 2 * HALO_MARGIN;

/** An id usable inside an SVG `url(#…)`. */
function useSvgId(prefix: string): string {
  return `${prefix}${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
}

/** How a light layer moves to `target` for the state: the smoothing spring while working, the
 *  1.5 s ease when stuck, the fade-out when out; a cross-fade under Reduce Motion. */
export function lightTo(target: number, state: EmberState, t: Pick<ShellTokens, 'reduceMotion'>) {
  if (t.reduceMotion) return withTiming(target, timing('fadeIn', true));
  if (state === 'working') return withSpring(target, ACTIVITY_SMOOTHING);
  if (state === 'stuck') return withTiming(target, { duration: HONEST_LIGHT.stuckEaseMs });
  return withTiming(target, timing('fadeOut'));
}

interface Flicker {
  /** Whether the light flickers at all: working, with Reduce Motion off. */
  on: boolean;
  /** `ã`: the activity through the smoothing spring. */
  smoothed: SharedValue<number>;
  /** The run's arrival pulse (`run-light.ts`), or a still 0 for a light with no stream. */
  pulse: FlickerPulse;
}

/** §4.6 flicker, the one model every honest light shares (the making ember, the ambient lights, a
 *  tile's ember and ring, the orb): `ã` follows `activity` through the smoothing spring, and the
 *  light moves by `flickerOffset(on, ã, pulse)` as the run's arrivals kick its pulse. Its timing
 *  comes from the arrivals alone; nothing here runs on a clock. Read the three in a worklet. */
export function useFlicker(activity: number, working: boolean, pulse: FlickerPulse | undefined): Flicker {
  const t = useTokens();
  const on = working && !t.reduceMotion;
  const target = on ? Math.min(1, Math.max(0, activity)) : 0;
  const smoothed = useSharedValue(target);
  const idle = useSharedValue(0);
  const aimed = useRef(target);
  useEffect(() => {
    if (aimed.current === target) return;
    aimed.current = target;
    smoothed.value = on ? withSpring(target, ACTIVITY_SMOOTHING) : target;
  }, [on, smoothed, target]);
  return { on, smoothed, pulse: pulse ?? idle };
}

/** An ember's light as it is drawn now: its state, its arrival pulse, and where its body and halo
 *  are (part way along the smoothing spring when its activity just changed). */
export interface EmberLight {
  readonly state: EmberState;
  readonly flicker?: FlickerPulse;
  readonly body: number;
  readonly halo: number;
}

/** Where an ember publishes how to read its light now (`EmberProps.lightRef`). */
export type EmberLightRef = { current: (() => EmberLight) | null };

/** An ember drawn on in `light`: at its body and halo, held there (the activity whose body that is),
 *  in its state, flickering with its pulse. Its light leaves the stream where it was handed over. */
export function emberFrom(light: EmberLight): Pick<EmberProps, 'state' | 'activity' | 'flicker' | 'from'> {
  const activity = Math.min(1, Math.max(0, (light.body - HONEST_LIGHT.base) / HONEST_LIGHT.gain));
  return { state: light.state, activity, flicker: light.flicker, from: light };
}

export interface EmberProps {
  /** 20 (the orb), 24 inline, 48 setting out from Make it, 96 Ready and failure, 128 making and empty home
   *  (64 from 135% text). */
  size: EmberSize;
  state: EmberState;
  /** Stream activity 0–1 (§4.6 `a`); read while working. Default 0. */
  activity?: number;
  /** Change this value to play the done flare once (M10); the first value plays nothing. */
  spark?: number;
  /** The run's arrival pulse: the working ember flickers with it (§4.6). */
  flicker?: FlickerPulse;
  /** Set out at this body and halo (the light of the ember this one goes on from) rather than at the
   *  state's own; from there it moves as any change of light does. */
  from?: Pick<EmberLight, 'body' | 'halo'>;
  /** Given a way to read this ember's light as drawn, for an ember that travels on from it. */
  lightRef?: EmberLightRef;
}

export function Ember({ size, state, activity = 0, spark, flicker, from, lightRef }: Readonly<EmberProps>) {
  const t = useTokens();
  const px = emberSize(size, t);
  // Reduce Motion: a still intensity per state, whatever the stream does.
  const look = emberLook(state, t.reduceMotion ? 1 : activity);
  const body = useSharedValue(from?.body ?? look.body);
  const halo = useSharedValue(from?.halo ?? look.halo);
  const scale = useSharedValue(1);
  useEffect(() => {
    body.value = lightTo(look.body, state, t);
    halo.value = lightTo(look.halo, state, t);
  }, [body, halo, look.body, look.halo, state, t]);
  const lastSpark = useRef(spark);
  useEffect(() => {
    if (lastSpark.current === spark) return;
    lastSpark.current = spark;
    if (!t.reduceMotion) scale.value = withSequence(withSpring(SPARK_PEAK, springConfig('spark')), withSpring(1, springConfig('spark')));
  }, [scale, spark, t.reduceMotion]);
  const { on, smoothed, pulse } = useFlicker(activity, state === 'working', flicker);
  useEffect(() => {
    if (lightRef === undefined) return undefined;
    const read = () => ({ state, flicker, body: body.value, halo: halo.value });
    lightRef.current = read;
    return () => {
      if (lightRef.current === read) lightRef.current = null;
    };
  }, [lightRef, state, flicker, body, halo]);
  const bodyStyle = useAnimatedStyle(() => ({ opacity: body.value + flickerOffset(on, smoothed.value, pulse.value) }));
  const haloStyle = useAnimatedStyle(() => ({ opacity: halo.value }));
  const flare = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const bodyId = useSvgId('ember-body');
  const haloId = useSvgId('ember-halo');
  const box = { width: px, height: px };
  const haloSide = (px * HALO_GRID) / EMBER_VIEWBOX;
  const haloOffset = -(px * HALO_MARGIN) / EMBER_VIEWBOX;
  const haloBox = { position: 'absolute' as const, top: haloOffset, start: haloOffset, width: haloSide, height: haloSide };
  const viewBox = `0 0 ${EMBER_VIEWBOX} ${EMBER_VIEWBOX}`;

  return (
    <Animated.View style={[box, flare]} {...HIDDEN}>
      <Animated.View style={[haloBox, haloStyle]} pointerEvents="none">
        <Svg width={haloSide} height={haloSide} viewBox={`${-HALO_MARGIN} ${-HALO_MARGIN} ${HALO_GRID} ${HALO_GRID}`}>
          <Defs>
            <RadialGradient id={haloId} cx="50%" cy="50%" r="50%">
              <Stop offset="0" stopColor={GLOW.halo} />
              <Stop offset="0.55" stopColor={GLOW.halo} stopOpacity={0.35} />
              <Stop offset="1" stopColor={GLOW.halo} stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Circle cx={24} cy={29} r={24} fill={`url(#${haloId})`} />
        </Svg>
      </Animated.View>
      {look.base ? (
        <Svg width={px} height={px} viewBox={viewBox} style={StyleSheet.absoluteFill}>
          <Path d={EMBER_PATH} fill={t.colors['fill-strong']} />
        </Svg>
      ) : null}
      <Animated.View style={[StyleSheet.absoluteFill, bodyStyle]}>
        <Svg width={px} height={px} viewBox={viewBox}>
          <Defs>
            <RadialGradient id={bodyId} cx="50%" cy="74%" r="72%">
              <Stop offset="0" stopColor={GLOW.core} />
              <Stop offset="0.5" stopColor={GLOW.mid} />
              <Stop offset="1" stopColor={GLOW.edge} />
            </RadialGradient>
          </Defs>
          <Path d={EMBER_PATH} fill={`url(#${bodyId})`} />
        </Svg>
      </Animated.View>
      {state === 'out' ? (
        <Svg width={px} height={px} viewBox={viewBox} style={StyleSheet.absoluteFill}>
          <Path d={EMBER_PATH} fill="none" stroke={t.colors['text-2']} strokeWidth={emberOutlineWidth(px)} strokeLinejoin="round" />
        </Svg>
      ) : null}
    </Animated.View>
  );
}

export interface AmbientLightProps {
  width: number;
  height: number;
  /** The same stream activity the ember shows; 0 when nothing streams (still and dim). Render no
   *  AmbientLight when nothing is being made. */
  activity: number;
  /** Where the surface the light sits on cuts it off (a scroll view's top edge, `at` down the box)
   *  and that surface's colour: the light fades into it, from none at the cut to whole by its centre,
   *  so the cut shows no edge. */
  cut?: { at: number; backdrop: string };
  /** The run's arrival pulse: the light flickers with it, as its ember does (§4.6). */
  flicker?: FlickerPulse;
}

/** The ember's ambient light: a soft radial glow behind the making header and under the composer. */
export function AmbientLight({ width, height, activity, cut, flicker }: Readonly<AmbientLightProps>) {
  const t = useTokens();
  const target = ambientOpacity(t.reduceMotion ? 1 : activity);
  const opacity = useSharedValue(target);
  useEffect(() => {
    opacity.value = t.reduceMotion ? withTiming(target, timing('fadeIn', true)) : withSpring(target, ACTIVITY_SMOOTHING);
  }, [opacity, target, t.reduceMotion]);
  const { on, smoothed, pulse } = useFlicker(activity, true, flicker);
  const style = useAnimatedStyle(() => ({ opacity: opacity.value + flickerOffset(on, smoothed.value, pulse.value) }));
  const id = useSvgId('ambient');
  const fadeId = useSvgId('ambient-fade');
  return (
    <Animated.View style={[{ width, height }, style]} pointerEvents="none" {...HIDDEN}>
      <Svg width={width} height={height}>
        <Defs>
          <RadialGradient id={id} cx="50%" cy="50%" rx="50%" ry="50%">
            <Stop offset="0" stopColor={GLOW.mid} stopOpacity={AMBIENT_STOPS.centre} />
            <Stop offset="0.55" stopColor={GLOW.core} stopOpacity={AMBIENT_STOPS.mid} />
            <Stop offset="1" stopColor={GLOW.core} stopOpacity={0} />
          </RadialGradient>
          {cut ? (
            <LinearGradient id={fadeId} x1={0} y1={cut.at} x2={0} y2={height / 2} gradientUnits="userSpaceOnUse">
              <Stop offset="0" stopColor={cut.backdrop} stopOpacity={1} />
              <Stop offset="1" stopColor={cut.backdrop} stopOpacity={0} />
            </LinearGradient>
          ) : null}
        </Defs>
        <Rect x={0} y={0} width={width} height={height} fill={`url(#${id})`} />
        {cut ? <Rect x={0} y={0} width={width} height={height / 2} fill={`url(#${fadeId})`} /> : null}
      </Svg>
    </Animated.View>
  );
}
