/**
 * AppTile states — what a tile looks like and says in each state (system.md §3.2 Tiles; app-launcher
 * "Tiles show their state"; design-system-v1 task 15.1). No React Native import: Node suites read
 * the table, and the grid and the menus key off the same state names.
 */

import type { ColorRole } from '../../design/tokens';
import { COPY, tileOlderLine } from '../launcher/copy';

/** Every state a grid cell can be in. `older` is the one cell that stands for several attempts. */
export type TileState =
  | 'ready'
  | 'making'
  | 'queued'
  | 'failed'
  | 'stopped'
  | 'needs-update'
  | 'changing'
  | 'change-failed'
  | 'older';

/** What a tile's plate is made of in a state. */
export interface TileLook {
  /** `tint`: the app's tint with its glyph; `ember-soft` and `fill` carry the ember instead. */
  plate: 'tint' | 'ember-soft' | 'fill';
  /** The ember on a non-tint plate: following the stream, waiting (still and dim), or out. */
  ember?: 'working' | 'waiting' | 'out';
  /** The alert badge at the top-trailing corner. */
  badge: boolean;
  /** The glowing ember ring around the app's own tile. */
  ring: boolean;
}

const LOOKS: Readonly<Record<TileState, TileLook>> = {
  ready: { plate: 'tint', badge: false, ring: false },
  making: { plate: 'ember-soft', ember: 'working', badge: false, ring: false },
  queued: { plate: 'ember-soft', ember: 'waiting', badge: false, ring: false },
  failed: { plate: 'fill', ember: 'out', badge: true, ring: false },
  stopped: { plate: 'fill', ember: 'out', badge: false, ring: false },
  'needs-update': { plate: 'fill', ember: 'out', badge: false, ring: false },
  changing: { plate: 'tint', badge: false, ring: true },
  'change-failed': { plate: 'tint', badge: true, ring: false },
  older: { plate: 'fill', ember: 'out', badge: false, ring: false },
};

export function tileLook(state: TileState): TileLook {
  return LOOKS[state];
}

/** The line under a tile's name, which exists only for state. */
export interface StateLine {
  text: string;
  color: ColorRole;
}

/** A ready tile says "Example" on a seeded app and "Copy" on one made from another; `count` is the
 *  number of attempts an `older` cell stands for. */
export interface StateLineOptions {
  example?: boolean;
  copy?: boolean;
  count?: number;
}

export function stateLine(state: TileState, options: StateLineOptions = {}): StateLine | null {
  switch (state) {
    case 'making':
      return { text: COPY.tileMaking, color: 'ember-text' };
    case 'queued':
      return { text: COPY.tileQueued, color: 'text-2' };
    case 'failed':
      return { text: COPY.tileFailed, color: 'danger-text' };
    case 'stopped':
      return { text: COPY.tileStopped, color: 'text-2' };
    case 'needs-update':
      return { text: COPY.tileNeedsUpdate, color: 'warning-text' };
    case 'changing':
      return { text: COPY.tileChanging, color: 'ember-text' };
    case 'change-failed':
      return { text: COPY.tileChangeFailed, color: 'danger-text' };
    case 'older':
      return { text: tileOlderLine(options.count ?? 0), color: 'text-2' };
    case 'ready':
      if (options.example) return { text: COPY.exampleBadge, color: 'text-2' };
      return options.copy ? { text: COPY.tileCopy, color: 'text-2' } : null;
  }
}

/** The tile's accessibility label: its name, then its state in lower case ("Pour Timer, making"). A
 *  tile with no name of its own (the one gathering older attempts) is read as its line. */
export function tileAccessibilityLabel(name: string, line: StateLine | null): string {
  if (!line) return name;
  if (name === '') return line.text;
  const state = line.text.replace(/…$/, '');
  return `${name}, ${state.charAt(0).toLowerCase()}${state.slice(1)}`;
}

/** What a double-tap does, as the hint says it. */
export function tileAccessibilityHint(state: TileState): string {
  switch (state) {
    case 'making':
    case 'queued':
      return COPY.tileHintProgress;
    case 'failed':
    case 'stopped':
      return COPY.tileHintFailure;
    case 'needs-update':
      return COPY.tileHintUpdate;
    case 'older':
      return COPY.tileHintOlder;
    case 'ready':
    case 'changing':
    case 'change-failed':
      return COPY.tileHintOpens;
  }
}
