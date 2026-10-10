/**
 * Ember and AmbientLight — Whim's mark and its light (system.md §3.3, §4.6). The ember is the flame
 * silhouette filled with the glow gradient over a `glow-ember` halo; it is honest: working
 * intensity follows `activity` through the §4.6 smoothing spring, stuck dims to 35% over 1.5 s and
 * holds still, out is the 1.5 pt `text-2` outline alone. A change of `spark` plays the done flare
 * (1 → 1.18 → 1, `spark`). Under Reduce Motion the ember is a still intensity per state,
 * cross-faded, with no flare. Both are hidden from screen readers: the status line carries the
 * words.
 */

import React, { useEffect, useId, useRef } from 'react';
import { StyleSheet } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSequence, withSpring, withTiming } from 'react-native-reanimated';
import Svg, { Circle, Defs, Path, RadialGradient, Rect, Stop } from 'react-native-svg';
import { GLOW } from '../../design/tokens';
import { EMBER_PATH, EMBER_VIEWBOX } from '../../design/icons/ember';
import { timing } from './motion';
import { useTokens } from './tokens';
import {
  ACTIVITY_SMOOTHING,
  AMBIENT_STOPS,
  ambientOpacity,
  emberLook,
  emberOutlineWidth,
  emberSize,
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
function lightTo(target: number, state: EmberState, t: Pick<ShellTokens, 'reduceMotion'>) {
  if (t.reduceMotion) return withTiming(target, timing('fadeIn', true));
  if (state === 'working') return withSpring(target, ACTIVITY_SMOOTHING);
  if (state === 'stuck') return withTiming(target, { duration: HONEST_LIGHT.stuckEaseMs });
  return withTiming(target, timing('fadeOut'));
}

export interface EmberProps {
  /** 20 (the orb), 24 inline, 48 plan wait, 96 Ready and failure, 128 making and empty home
   *  (64 from 135% text). */
  size: EmberSize;
  state: EmberState;
  /** Stream activity 0–1 (§4.6 `a`); read while working. Default 0. */
  activity?: number;
  /** Change this value to play the done flare once (M10); the first value plays nothing. */
  spark?: number;
}

export function Ember({ size, state, activity = 0, spark }: Readonly<EmberProps>) {
  const t = useTokens();
  const px = emberSize(size, t);
  // Reduce Motion: a still intensity per state, whatever the stream does.
  const look = emberLook(state, t.reduceMotion ? 1 : activity);
  const body = useSharedValue(look.body);
  const halo = useSharedValue(look.halo);
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
  const bodyStyle = useAnimatedStyle(() => ({ opacity: body.value }));
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
}

/** The ember's ambient light: a soft radial glow behind the making header and under the composer. */
export function AmbientLight({ width, height, activity }: Readonly<AmbientLightProps>) {
  const t = useTokens();
  const target = ambientOpacity(t.reduceMotion ? 1 : activity);
  const opacity = useSharedValue(target);
  useEffect(() => {
    opacity.value = t.reduceMotion ? withTiming(target, timing('fadeIn', true)) : withSpring(target, ACTIVITY_SMOOTHING);
  }, [opacity, target, t.reduceMotion]);
  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));
  const id = useSvgId('ambient');
  return (
    <Animated.View style={[{ width, height }, style]} pointerEvents="none" {...HIDDEN}>
      <Svg width={width} height={height}>
        <Defs>
          <RadialGradient id={id} cx="50%" cy="50%" rx="50%" ry="50%">
            <Stop offset="0" stopColor={GLOW.mid} stopOpacity={AMBIENT_STOPS.centre} />
            <Stop offset="0.55" stopColor={GLOW.core} stopOpacity={AMBIENT_STOPS.mid} />
            <Stop offset="1" stopColor={GLOW.core} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Rect x={0} y={0} width={width} height={height} fill={`url(#${id})`} />
      </Svg>
    </Animated.View>
  );
}
