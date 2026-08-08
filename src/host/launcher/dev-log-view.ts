/**
 * dev-log-view — the dev log overlay's gate and its pure view logic (obs-v1, design D5,
 * host-observability "The dev log overlay reads the ring buffer and cannot reach a shipping
 * build").
 *
 * Free of `react-native` on purpose, exactly like `home-grid.ts`: the ordering, the filtering and
 * the gate are the parts that can be wrong, and the launcher's Node acceptance suite cannot
 * bundle React Native. `DevLogOverlay.tsx` is the thin `View`/`Text`/`FlatList` mapping over what
 * is decided here.
 */

import type { DevLogRecord } from '../../../contract/src/dev-log';
import type { Channel } from '../logging/channels';
import type { LogLevel } from '../logging';
import { LEVEL_ORDER } from '../logging';

/**
 * The build-time flag that makes the overlay reachable, in the `RUN_*_PROBE` idiom (App.tsx).
 * DEFAULT `false`: it is flipped by hand in a local working copy and never committed as `true`,
 * which is what keeps the overlay out of a shipping build.
 */
export const SHOW_DEV_LOG_OVERLAY = false;

/**
 * The overlay's gate: `__DEV__` OR the explicit flag — never `__DEV__` alone, because this
 * project's working build recipe is a RELEASE build, where `__DEV__` is `false` and a
 * `__DEV__`-only surface is unreachable in the build the project actually runs (design D5).
 */
export function devLogOverlayEnabled(dev: boolean, flag: boolean = SHOW_DEV_LOG_OVERLAY): boolean {
  return dev || flag;
}

/** The channel filter's "no channel filter" value. */
export const ALL_CHANNELS_FILTER = 'all';

export interface DevLogFilter {
  /** One channel, or `'all'` for no channel filter. */
  channel: Channel | typeof ALL_CHANNELS_FILTER;
  /** The lowest severity listed; records below it are hidden, never dropped. */
  minLevel: LogLevel;
}

/** Unfiltered: every channel, every level. */
export const DEFAULT_DEV_LOG_FILTER: DevLogFilter = { channel: ALL_CHANNELS_FILTER, minLevel: 'debug' };

/**
 * What the overlay lists: the buffer's snapshot (oldest-first) narrowed by the filter and reversed
 * to newest-first. Pure — the snapshot argument is never reordered in place, so clearing a filter
 * restores the full list unchanged.
 */
export function visibleRecords(
  snapshot: readonly DevLogRecord[],
  filter: DevLogFilter = DEFAULT_DEV_LOG_FILTER,
): readonly DevLogRecord[] {
  const floor = LEVEL_ORDER[filter.minLevel];
  const kept = snapshot.filter(
    record =>
      (filter.channel === ALL_CHANNELS_FILTER || record.channel === filter.channel) &&
      LEVEL_ORDER[record.level] >= floor,
  );
  return kept.reverse();
}

/** A record's timestamp as `HH:MM:SS.mmm`, in UTC so two devices' logs line up. */
export function formatRecordTime(at: number): string {
  return new Date(at).toISOString().slice(11, 23);
}

/** A record's structured fields as one readable line; `''` when there are none. */
export function formatFields(fields: Readonly<Record<string, unknown>>): string {
  return Object.entries(fields)
    .map(([name, value]) => `${name}=${typeof value === 'string' ? value : JSON.stringify(value)}`)
    .join(' · ');
}
