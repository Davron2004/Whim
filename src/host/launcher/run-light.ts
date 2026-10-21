/**
 * run-light — a run's flicker pulse (system.md §4.6 Honest light: flicker "only while a token
 * arrived in the last 500 ms; timing from token arrivals, never a timer"). The stream handler calls
 * `lightArrived` for each token or reasoning delta; each arrival kicks the run's pulse to a new
 * height and lets it fall back to 0 over 500 ms on the UI thread, so the pulse is 0 exactly when no
 * arrival came for 500 ms, and nothing moves it in between. Every light of the run (the making
 * ember, its ambient light, the Home tile's ember or ring, the orb) reads the same pulse.
 */

import { Easing, makeMutable, withTiming, type SharedValue } from 'react-native-reanimated';
import { flickerKick, HONEST_LIGHT } from '../ui/tokens-pure';

/** Arrivals closer than a display frame show as one: the later ones kick nothing (none is invented). */
const ARRIVAL_COALESCE_MS = 16;

/** The fall back to 0 after a kick: straight, so the pulse reaches 0 at the window's end and not before. */
const FALL = { duration: HONEST_LIGHT.flickerWindowMs, easing: Easing.linear } as const;

export interface RunLight {
  readonly pulse: SharedValue<number>;
  /** Arrivals that kicked the pulse so far. */
  kicks: number;
  /** When the last kick was. */
  kickedAt: number;
}

export function createRunLight(): RunLight {
  return { pulse: makeMutable(0), kicks: 0, kickedAt: Number.NEGATIVE_INFINITY };
}

/** A token or reasoning delta of the run arrived at `at`. O(1): two writes to the pulse, at most once a frame. */
export function lightArrived(light: RunLight, at: number): void {
  if (at - light.kickedAt < ARRIVAL_COALESCE_MS) return;
  light.kickedAt = at;
  light.kicks += 1;
  light.pulse.value = flickerKick(light.kicks);
  light.pulse.value = withTiming(0, FALL);
}
