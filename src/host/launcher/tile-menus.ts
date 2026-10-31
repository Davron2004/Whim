/**
 * tile-menus — the rows a tile's context menu offers in each state (app-launcher "Tile menus follow
 * the tile's state"; system.md §3.2). Pure: the screen binds each action to a handler, and a suite
 * reads the rows a state gets without rendering anything.
 */
import type { IconName } from '../../design/icons/names';
import type { TileState } from '../ui/AppTile-states';
import { COPY } from './copy';
import type { GridCell } from './grid-composition';

export type MenuAction =
  | 'open'
  | 'change'
  | 'history'
  | 'copy'
  | 'customize'
  | 'share'
  | 'delete'
  | 'details'
  | 'stop'
  | 'stop-change'
  | 'what-happened'
  | 'try-again'
  | 'discard'
  | 'discard-change'
  | 'update'
  | 'discard-all';

export interface MenuItem {
  readonly action: MenuAction;
  readonly label: string;
  readonly icon: IconName;
  /** Drawn after a separator in `danger-text`. */
  readonly destructive?: boolean;
}

const ITEMS: Readonly<Record<MenuAction, MenuItem>> = {
  open: { action: 'open', label: COPY.actionOpen, icon: 'external-link' },
  change: { action: 'change', label: COPY.actionChangeIt, icon: 'pencil' },
  history: { action: 'history', label: COPY.actionHistory, icon: 'clock' },
  copy: { action: 'copy', label: COPY.actionMakeCopy, icon: 'copy' },
  customize: { action: 'customize', label: COPY.actionCustomize, icon: 'palette' },
  share: { action: 'share', label: COPY.actionShareLink, icon: 'share' },
  delete: { action: 'delete', label: COPY.actionDelete, icon: 'trash-2', destructive: true },
  details: { action: 'details', label: COPY.actionDetails, icon: 'info' },
  stop: { action: 'stop', label: COPY.actionStop, icon: 'x' },
  'stop-change': { action: 'stop-change', label: COPY.actionStopChange, icon: 'x' },
  'what-happened': { action: 'what-happened', label: COPY.actionWhatHappened, icon: 'info' },
  'try-again': { action: 'try-again', label: COPY.actionTryAgain, icon: 'repeat' },
  discard: { action: 'discard', label: COPY.actionDiscard, icon: 'trash-2', destructive: true },
  'discard-change': { action: 'discard-change', label: COPY.actionDiscardChange, icon: 'trash-2', destructive: true },
  update: { action: 'update', label: COPY.actionUpdateWhim, icon: 'arrow-up' },
  'discard-all': { action: 'discard-all', label: COPY.actionDiscardAll, icon: 'trash-2', destructive: true },
};

const ACTIONS_BY_STATE: Readonly<Record<TileState, readonly MenuAction[]>> = {
  ready: ['open', 'change', 'history', 'copy', 'customize', 'share', 'delete'],
  making: ['details', 'stop'],
  queued: ['details', 'stop'],
  failed: ['what-happened', 'try-again', 'discard'],
  stopped: ['try-again', 'discard'],
  'needs-update': ['update', 'discard'],
  changing: ['details', 'stop-change'],
  'change-failed': ['what-happened', 'try-again', 'discard-change'],
  older: ['discard-all'],
};

/** The menu rows for `cell`, in the order they are drawn (the destructive one last). */
export function menuFor(cell: GridCell): readonly MenuItem[] {
  const state = cell.kind === 'older' ? 'older' : cell.state;
  return ACTIONS_BY_STATE[state].map((action) => ITEMS[action]);
}
