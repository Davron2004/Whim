/**
 * HomeScreen — "Your apps" (app-launcher "The home grid orders and lays out apps for every text
 * size", "Tiles show their state", "Tile menus follow the tile's state"; system.md §3.2, §9;
 * design-system-v1 tasks 15.1–15.5). The title and the settings button, the grid of tiles (four
 * columns of 64 pt tiles, three from 135% text, a list of rows from 200%), a search field from 13
 * apps, the live offline notice, and the composer bar at the bottom.
 *
 * What the grid holds and in what order is `grid-composition.ts`; the rows a long-press offers are
 * `tile-menus.ts`; this file draws them and routes what the person chooses. Delete and Discard hide
 * at once and offer Undo (`soft-delete.ts` owns the windows, `LauncherRoot` the stores). "Make a copy"
 * asks `CopyQuestionSheet` only when the copy can copy data. Share link opens the platform share sheet
 * with the app's link. No native alert anywhere. The grid's motion (system.md §4.4): its first
 * appearance after launch rises in, staggered (M17); a deleted tile leaves and its neighbours reflow,
 * and Undo plays it back (M18); a delivered ghost turning into its tile (M4) is the tile's own.
 */
import React, { useEffect, useRef, useState } from 'react';
import { ScrollView, Share, useWindowDimensions, View } from 'react-native';
import { LAYOUT, SPACE } from '../../design/tokens';
import { haptics } from '../haptics';
import { log } from '../logging';
import { CHANNELS } from '../logging/channels';
import { ContextMenu, type MenuAnchor, type MenuRow } from '../ui/ContextMenu';
import { AppTile, type TileEntrance, type TilePresence } from '../ui/AppTile';
import { drawsName, gridLayout, LABEL_MEASURE_BUDGET_MS, labelsMeasured, rowLabelLines, type GridLayout, type LabelCell, type MeasuredLabels } from '../ui/AppTile-geometry';
import { Chip } from '../ui/Chip';
import { Ember, RESTING_ACTIVITY } from '../ui/Ember';
import { Notice } from '../ui/Notice';
import { Text } from '../ui/Text';
import { TextField } from '../ui/TextField';
import { useToast } from '../ui/Toast';
import { useTokens } from '../ui/tokens';
import { makeStyles, staggerDelay } from '../ui/tokens-pure';
import type { InstalledApp } from './app-index';
import type { FlickerPulse } from './home-live';
import { isAppBusy, type AppBusyMap } from './app-busy';
import { appLinkFor } from './app-link';
import { ComposerBar } from './ComposerBar';
import { COPY, deletedToast, discardedManyToast, tileOlderLine } from './copy';
import { CopyQuestionSheet } from './CopyQuestionSheet';
import { CustomizeTileSheet } from './CustomizeTileSheet';
import { cellKey, cellName, composeGrid, searchCells, SEARCH_FROM_APPS, type GridCell } from './grid-composition';
import { HomeHeader } from './HomeHeader';
import { OlderAttemptsSheet } from './OlderAttemptsSheet';
import type { PendingBuildRecord } from './pending-builds';
import type { PendingPurgeStore } from './pending-purge';
import { EDGE_FADE_HEIGHT, ScrollEdgeFade } from './ScrollEdgeFade';
import type { ForkOptions } from './store-access';
import { menuFor, type MenuAction } from './tile-menus';
import { tileOf, type TileIdentity } from './tile-identity';

export interface HomeScreenProps {
  apps: InstalledApp[];
  /** Every in-flight, failed or stopped attempt, NEWEST FIRST, straight from `PendingBuildStore.list()`.
   *  A record with `editingAppId` is a change in flight on that app and decorates its tile. */
  pending?: readonly PendingBuildRecord[];
  /** The armed purges: an app or an attempt with one is waiting out its Undo window and is not shown
   *  (an attempt only the run its Discard named: a later run of the same id shows). */
  purges?: Pick<PendingPurgeStore, 'has' | 'hidesAttempt'>;
  /** Which apps have an open or copy running right now (`app-busy.ts`), by app id. Such a tile reads
   *  busy and opens no menu. Omitted = nothing is in flight. */
  appBusy?: AppBusyMap;
  /** The session says the server cannot be reached: the live notice shows. False while unknown. */
  offline?: boolean;
  /** Ids of attempts waiting for a free spot, which show "Waiting…" instead of "Making…". */
  queued?: ReadonlySet<string>;
  /** The stream's activity, 0–1, per attempt id: the ember on a tile being made or changed follows it. */
  activity?: Readonly<Record<string, number>>;
  /** The attempts whose stream stalled (no bytes for 40 s): their tile's light is stuck. */
  stalled?: ReadonlySet<string>;
  /** Each attempt's arrival pulse: its tile's light flickers with it. */
  flicker?: Readonly<Record<string, FlickerPulse>>;
  /** Whether "Make a copy" can copy the data (`StoreAccess.canCopyData`). When false the copy is made
   *  fresh at once and no question is asked. */
  canCopyData?: boolean;
  /** The description typed so far in the describe sheet, shown in the composer bar. */
  draft?: string;
  onOpen: (app: InstalledApp) => void;
  /** Makes the copy. Resolves the new entry; resolves `null` when a copy of this app is already
   *  running; rejects when the copy could not be made (nothing was created). */
  onFork: (app: InstalledApp, opts: ForkOptions) => Promise<InstalledApp | null>;
  /** Delete: hide the app and arm its purge. The toast's Undo calls `onUndoDelete`, which answers
   *  whether the app was restored; the toast ending (however) calls `onSettleDelete`, which
   *  completes the purge. */
  onDelete: (app: InstalledApp) => void;
  onUndoDelete: (app: InstalledApp) => boolean;
  onSettleDelete: (app: InstalledApp) => void;
  /** Discard: hide these attempts and arm their purges; Undo and the toast's end as for Delete. */
  onDiscard: (recs: readonly PendingBuildRecord[]) => void;
  onUndoDiscard: (recs: readonly PendingBuildRecord[]) => boolean;
  onSettleDiscard: (recs: readonly PendingBuildRecord[]) => void;
  /** Opens the app's History. */
  onHistory: (app: InstalledApp) => void;
  /** "Change it": opens the describe sheet scoped to this app. */
  onPromptAgain: (app: InstalledApp) => void;
  /** The composer bar, or an idea chip (its words): opens the describe sheet. */
  onCreate: (idea?: string) => void;
  onSettings: () => void;
  /** __DEV__ entry: long-press the title to reach the containment/bridge probe surface. */
  onOpenDevProbe?: () => void;
  /** A tile being made, failed or stopped: its page. Details, What happened and Update Whim use it too. */
  onOpenPending?: (rec: PendingBuildRecord) => void;
  /** Stop: aborts the run and ends the record. */
  onCancelPending?: (rec: PendingBuildRecord) => void;
  /** Try again on a failed or stopped attempt. */
  onRetryPending?: (rec: PendingBuildRecord) => void;
  /** "Customize tile": store this tile as the app's override. */
  onCustomizeTile: (app: InstalledApp, tile: TileIdentity) => void;
  /** "Use the original tile": drop the override. */
  onResetTile: (app: InstalledApp) => void;
  /** M17: this is the grid's first appearance since the shell started. Once the grid shows, its tiles
   *  rise in, staggered, and `onAppeared` tells the shell, which passes false from then on. Omitted:
   *  the grid is simply there. */
  firstAppearance?: boolean;
  onAppeared?: () => void;
}

const styles = makeStyles((t) => ({
  root: { flex: 1, backgroundColor: t.colors.bg },
  gutter: { paddingHorizontal: LAYOUT.gutter, paddingBottom: SPACE[3] },
  listArea: { flex: 1 },
  grid: { flexDirection: 'row' as const, flexWrap: 'wrap' as const },
  list: { flexDirection: 'column' as const },
  gridEnd: { paddingBottom: SPACE[4] },
  empty: { flexGrow: 1, alignItems: 'center' as const, justifyContent: 'center' as const, paddingHorizontal: LAYOUT.gutter, gap: SPACE[3] },
  chips: { alignItems: 'center' as const, gap: SPACE[2], marginTop: SPACE[2] },
  centred: { textAlign: 'center' as const },
  unmeasured: { opacity: 0 },
}));

/** The lines each grid name took at one text size, and whether every name the grid first held has
 *  reported, after which the grid shows. */
interface LabelLines {
  fontScale: number;
  lines: MeasuredLabels;
  shown: boolean;
}

/** M17, the grid's first appearance: waiting for the grid to show, its tiles (by key) rising in, or
 *  done — every tile risen, or a touch finished it. */
type Entrance = { phase: 'hold' } | { phase: 'rising'; keys: ReadonlySet<string> } | { phase: 'done' };

/** M18: an app's tile still leaving after Delete, or coming back after an Undo that came once it had gone. */
type Departure = 'leaving' | 'returning';

interface OpenMenu {
  cell: GridCell;
  anchor: MenuAnchor;
  open: boolean;
}

/** The name a cell's tile draws: the older cell has none of its own. */
const tileName = (cell: GridCell) => (cell.kind === 'older' ? '' : cellName(cell));

/** The attempt a menu action acts on: the cell's own, or the change in flight on an app. */
function attemptOf(cell: GridCell): PendingBuildRecord | undefined {
  if (cell.kind === 'attempt') return cell.rec;
  return cell.kind === 'app' ? cell.rebuild : undefined;
}

/**
 * The name block under each plate is as many lines as the longest name of its row (#218): a row with
 * no wrapped name has no empty line, and one that has gives every name the same block, so the state
 * lines sit level. The lines are measured, so a text size starts again with none; until every name
 * has reported once the grid is laid out but not `shown`, so no row's state lines, nor the rows
 * under it, move in view. A cell that arrives later settles its row as it appears. A name that never
 * reports holds the grid back for `LABEL_MEASURE_BUDGET_MS` at most, then it shows anyway.
 */
function useRowLabels(cells: readonly GridCell[], layout: GridLayout, fontScale: number) {
  const [labels, setLabels] = useState<LabelLines>({ fontScale, lines: {}, shown: false });
  const labelCells: LabelCell[] = cells.map((cell) => ({ key: cellKey(cell), named: drawsName(tileName(cell)) }));
  const measured = labels.fontScale === fontScale ? labels.lines : {};
  const measure = (key: string, lines: number) =>
    setLabels((was) => {
      const current = was.fontScale === fontScale ? was : { fontScale, lines: {}, shown: false };
      if (current.lines[key] === lines) return current;
      const next = { ...current.lines, [key]: lines };
      return { fontScale, lines: next, shown: current.shown || labelsMeasured(labelCells, next) };
    });
  const shown = layout.kind === 'list' || (labels.fontScale === fontScale && labels.shown) || labelsMeasured(labelCells, measured);
  useEffect(() => {
    if (shown) return undefined;
    const budget = setTimeout(
      () => setLabels((was) => ({ ...(was.fontScale === fontScale ? was : { fontScale, lines: {} }), shown: true })),
      LABEL_MEASURE_BUDGET_MS,
    );
    return () => clearTimeout(budget);
  }, [shown, fontScale]);
  if (layout.kind === 'list') return { lineCounts: [], shown, measure };
  return { lineCounts: rowLabelLines(labelCells, layout.columns, measured), shown, measure };
}

/** M17, the grid's first appearance (`HomeScreenProps.firstAppearance`): until the grid `shown` its
 *  tiles hold out of sight; then each tile it holds rises in after its place's stagger delay. A touch
 *  ends it, as does every one of those tiles having risen; a tile that comes later is simply there. */
function useGridEntrance(first: boolean, shown: boolean, keys: readonly string[], reduceMotion: boolean, onAppeared: (() => void) | undefined) {
  const [entrance, setEntrance] = useState<Entrance>(first ? { phase: 'hold' } : { phase: 'done' });
  const risen = useRef(new Set<string>());
  useEffect(() => {
    if (entrance.phase !== 'hold' || !shown) return;
    onAppeared?.();
    setEntrance(keys.length === 0 ? { phase: 'done' } : { phase: 'rising', keys: new Set(keys) });
  }, [entrance.phase, shown, keys, onAppeared]);
  const finish = () => setEntrance((was) => (was.phase === 'done' ? was : { phase: 'done' }));
  return {
    /** What a touch on Home does: finish the appearance, while there is one. */
    onTouchStart: entrance.phase === 'done' ? undefined : finish,
    risen: (key: string) => {
      risen.current.add(key);
      setEntrance((was) => (was.phase === 'rising' && [...was.keys].every((k) => risen.current.has(k)) ? { phase: 'done' } : was));
    },
    of: (key: string, index: number): TileEntrance => {
      if (entrance.phase === 'hold') return 'hold';
      return entrance.phase === 'rising' && entrance.keys.has(key) ? staggerDelay(index, reduceMotion) : 'done';
    },
  };
}

/** M18, by app id: the tiles still leaving after Delete, and those coming back after an Undo that
 *  came once they had gone. */
function useDepartures() {
  const [departures, setDepartures] = useState<ReadonlyMap<string, Departure>>(() => new Map());
  const set = (id: string, how: Departure | null) =>
    setDepartures((was) => {
      if ((was.get(id) ?? null) === how) return was;
      const next = new Map(was);
      if (how === null) next.delete(id);
      else next.set(id, how);
      return next;
    });
  return {
    /** The apps Delete hides: armed, and not still leaving. */
    hidden: (apps: readonly InstalledApp[], purges: HomeScreenProps['purges']) =>
      new Set(apps.filter((a) => purges?.has('app', a.id) && departures.get(a.id) !== 'leaving').map((a) => a.id)),
    presenceOf: (cell: GridCell): TilePresence => (cell.kind === 'app' ? departures.get(cell.app.id) : undefined) ?? 'shown',
    leave: (id: string) => set(id, 'leaving'),
    /** An Undo that `restored` the app: a tile still leaving turns back where it is; one gone comes back. */
    undone: (id: string, restored: boolean) => {
      if (restored) set(id, 'returning');
    },
    /** A cell's leave or return has come to rest. */
    settled: (cell: GridCell) => {
      if (cell.kind === 'app') set(cell.app.id, null);
    },
  };
}

export default function HomeScreen({
  apps,
  pending,
  purges,
  appBusy,
  offline,
  queued,
  activity,
  stalled,
  flicker,
  canCopyData = false,
  draft,
  onOpen,
  onFork,
  onDelete,
  onUndoDelete,
  onSettleDelete,
  onDiscard,
  onUndoDiscard,
  onSettleDiscard,
  onHistory,
  onPromptAgain,
  onCreate,
  onSettings,
  onOpenDevProbe,
  onOpenPending,
  onCancelPending,
  onRetryPending,
  onCustomizeTile,
  onResetTile,
  firstAppearance = false,
  onAppeared,
}: Readonly<HomeScreenProps>) {
  const t = useTokens();
  const s = styles(t);
  const toast = useToast();
  const { width, fontScale } = useWindowDimensions();
  const layout = gridLayout(width, fontScale);
  const [query, setQuery] = useState('');
  const [menu, setMenu] = useState<OpenMenu | null>(null);
  const [copying, setCopying] = useState<{ app: InstalledApp; open: boolean } | null>(null);
  const [customizing, setCustomizing] = useState<{ id: string; open: boolean } | null>(null);
  const [olderOpen, setOlderOpen] = useState(false);
  const departures = useDepartures();

  // A deleted app's tile keeps its cell while it leaves; its neighbours reflow once it has gone.
  const all = composeGrid(pending ?? [], apps, {
    now: Date.now(),
    queued,
    deletedApps: departures.hidden(apps, purges),
    discardedAttempts: new Set((pending ?? []).filter((r) => purges?.hidesAttempt(r)).map((r) => r.id)),
  });
  const appCount = all.filter((c) => c.kind === 'app').length;
  const searching = appCount >= SEARCH_FROM_APPS;
  const cells = searching ? searchCells(all, query) : all;
  const olderRecs = all.flatMap((c) => (c.kind === 'older' ? c.recs : []));
  const customized = customizing ? (apps.find((a) => a.id === customizing.id) ?? null) : null;

  const labels = useRowLabels(cells, layout, fontScale);
  const entrance = useGridEntrance(firstAppearance, labels.shown, cells.map(cellKey), t.reduceMotion, onAppeared);

  const closeMenu = () => setMenu((m) => (m ? { ...m, open: false } : m));

  /** An Undo that could not restore everything is said, never silent. */
  const undone = (restored: boolean) => {
    if (!restored) toast.show({ message: COPY.undoTooLateToast });
  };

  const discard = (recs: readonly PendingBuildRecord[]) => {
    onDiscard(recs);
    haptics.play('warning');
    toast.show({
      message: recs.length === 1 ? COPY.discardedToast : discardedManyToast(recs.length),
      action: { label: COPY.toastUndo, onPress: () => undone(onUndoDiscard(recs)) },
      onEnd: () => onSettleDiscard(recs),
    });
  };

  // M18: the tile leaves; Undo turns it back while it still leaves, or plays its return once gone.
  const remove = (app: InstalledApp) => {
    departures.leave(app.id);
    onDelete(app);
    haptics.play('warning');
    const undo = () => {
      const restored = onUndoDelete(app);
      departures.undone(app.id, restored);
      undone(restored);
    };
    toast.show({
      message: deletedToast(app.name),
      undo: true,
      action: { label: COPY.toastUndo, onPress: undo },
      onEnd: () => onSettleDelete(app),
    });
  };

  const makeCopy = async (app: InstalledApp, data: ForkOptions['data']) => {
    try {
      const made = await onFork(app, { data });
      if (!made) return;
      haptics.play('success');
      toast.show({ message: COPY.copyMadeToast, action: { label: COPY.actionOpen, onPress: () => onOpen(made) } });
    } catch (e) {
      log.warn(CHANNELS.app, 'copy did not complete', { appId: app.id, detail: e instanceof Error ? e.message : String(e) });
      haptics.play('failure');
      toast.show({ message: COPY.copyFailedToast });
    }
  };

  const askCopy = (app: InstalledApp) => {
    if (canCopyData) setCopying({ app, open: true });
    else makeCopy(app, 'fresh');
  };

  const answerCopy = (data: ForkOptions['data']) => {
    const app = copying?.app;
    setCopying((c) => (c ? { ...c, open: false } : c));
    if (app) makeCopy(app, data);
  };

  const share = (app: InstalledApp) => {
    Share.share({ message: appLinkFor(app.id) }).catch(() => undefined);
  };

  const perform = (action: MenuAction, cell: GridCell) => {
    const rec = attemptOf(cell);
    const app = cell.kind === 'app' ? cell.app : undefined;
    const actions: Record<MenuAction, () => void> = {
      open: () => app && onOpen(app),
      change: () => app && onPromptAgain(app),
      history: () => app && onHistory(app),
      copy: () => app && askCopy(app),
      customize: () => app && setCustomizing({ id: app.id, open: true }),
      share: () => app && share(app),
      delete: () => app && remove(app),
      details: () => rec && onOpenPending?.(rec),
      stop: () => rec && onCancelPending?.(rec),
      'stop-change': () => rec && onCancelPending?.(rec),
      'what-happened': () => rec && onOpenPending?.(rec),
      'try-again': () => rec && onRetryPending?.(rec),
      discard: () => rec && discard([rec]),
      'discard-change': () => rec && discard([rec]),
      update: () => rec && onOpenPending?.(rec),
      'discard-all': () => cell.kind === 'older' && discard(cell.recs),
    };
    actions[action]();
  };

  const press = (cell: GridCell) => {
    if (cell.kind === 'older') setOlderOpen(true);
    else if (cell.kind === 'app') onOpen(cell.app);
    else onOpenPending?.(cell.rec);
  };

  const menuRows = (cell: GridCell): MenuRow[] =>
    menuFor(cell).map((item) => ({
      key: item.action,
      label: item.label,
      icon: item.icon,
      destructive: item.destructive,
      onPress: () => perform(item.action, cell),
    }));

  const menuTitle = (cell: GridCell) => (cell.kind === 'older' ? tileOlderLine(cell.recs.length) : cellName(cell));

  const tileOfCell = (cell: GridCell) => {
    if (cell.kind === 'app') return tileOf(cell.app);
    return { tint: 'slate' as const, icon: 'circle' as const };
  };

  const renderCell = (cell: GridCell, index: number) => {
    const { tint, icon } = tileOfCell(cell);
    const live = cell.kind === 'attempt' ? cell.rec : attemptOf(cell);
    const busy = cell.kind === 'app' && isAppBusy(appBusy, cell.app.id);
    const key = cellKey(cell);
    return (
      <AppTile
        key={key}
        layout={layout}
        name={tileName(cell)}
        state={cell.kind === 'older' ? 'older' : cell.state}
        tint={tint}
        glyph={icon}
        example={cell.kind === 'app' && cell.app.example === true}
        copy={cell.kind === 'app' && cell.app.forkedFrom !== undefined}
        count={cell.kind === 'older' ? cell.recs.length : undefined}
        activity={live ? activity?.[live.id] : undefined}
        flicker={live ? flicker?.[live.id] : undefined}
        stuck={live ? stalled?.has(live.id) : undefined}
        busy={busy}
        lifted={menu?.open === true && cellKey(menu.cell) === cellKey(cell)}
        labelLines={labels.lineCounts[index]}
        onLabelLines={(lines) => labels.measure(cellKey(cell), lines)}
        onPress={() => press(cell)}
        onLongPress={(anchor) => {
          if (!busy) setMenu({ cell, anchor, open: true });
        }}
        entrance={entrance.of(key, index)}
        onRisen={() => entrance.risen(key)}
        presence={departures.presenceOf(cell)}
        onPresenceSettled={() => departures.settled(cell)}
      />
    );
  };

  const empty = all.length === 0;
  // The first row starts below the top fade: the fade only ever covers what has scrolled under it.
  const gridFrame = { paddingHorizontal: layout.gutter, paddingTop: EDGE_FADE_HEIGHT, rowGap: layout.kind === 'grid' ? layout.rowGap : 0 };
  const ideas = [COPY.homeIdeaTimer, COPY.homeIdeaTracker, COPY.homeIdeaDice];

  return (
    <View style={s.root} onTouchStart={entrance.onTouchStart}>
      {/* Keyed by the text size, as a sheet's frame is: iOS keeps every text measured at the size it
          was first laid out at, so a size changed while Home shows left the composer's words cut in
          half and the title in a box too small for it. Built again, each text fits the new size.
          Home's own state is above this and survives (the search words, an open menu or sheet); the
          grid's scroll position and the search field's focus start again. */}
      <React.Fragment key={fontScale}>
        <HomeHeader onSettings={onSettings} onOpenDevProbe={onOpenDevProbe} />
        {offline ? (
          <View style={s.gutter}>
            <Notice message={COPY.homeOfflineNotice} />
          </View>
        ) : null}
        {searching ? (
          <View style={s.gutter}>
            <TextField value={query} onChangeText={setQuery} accessibilityLabel={COPY.homeSearchLabel} placeholder={COPY.homeSearchLabel} autoCorrect={false} autoCapitalize="none" returnKeyType="search" />
          </View>
        ) : null}
        <View style={s.listArea}>
          <ScrollView contentContainerStyle={empty ? s.empty : undefined} keyboardShouldPersistTaps="handled">
            {empty ? (
              <>
                <Ember size={128} state="working" activity={RESTING_ACTIVITY} />
                <Text type="title1" style={s.centred}>
                  {COPY.homeEmptyTitle}
                </Text>
                <Text type="callout" color="text-2" style={s.centred}>
                  {COPY.homeEmptyLine}
                </Text>
                <View style={s.chips}>
                  {ideas.map((idea) => (
                    <Chip key={idea} kind="suggestion" label={idea} onPress={() => onCreate(idea)} />
                  ))}
                </View>
              </>
            ) : (
              <View style={[layout.kind === 'grid' ? s.grid : s.list, s.gridEnd, gridFrame, labels.shown ? null : s.unmeasured]}>
                {cells.map(renderCell)}
                {cells.length === 0 ? (
                  <Text type="callout" color="text-2">
                    {COPY.homeSearchEmpty}
                  </Text>
                ) : null}
              </View>
            )}
          </ScrollView>
          <ScrollEdgeFade edge="top" />
          <ScrollEdgeFade edge="bottom" />
        </View>
        <ComposerBar draft={draft} onPress={() => onCreate()} />
      </React.Fragment>

      <ContextMenu
        visible={menu?.open === true}
        title={menu ? menuTitle(menu.cell) : ''}
        anchor={menu?.anchor ?? null}
        rows={menu ? menuRows(menu.cell) : []}
        onClose={closeMenu}
      />
      <CopyQuestionSheet
        visible={copying?.open === true}
        appName={copying?.app.name ?? ''}
        onCopyData={() => answerCopy('copy')}
        onStartFresh={() => answerCopy('fresh')}
        onClose={() => setCopying((c) => (c ? { ...c, open: false } : c))}
      />
      <CustomizeTileSheet
        visible={customizing?.open === true}
        app={customized}
        onChoose={(tile) => customized && onCustomizeTile(customized, tile)}
        onReset={() => customized && onResetTile(customized)}
        onClose={() => setCustomizing((c) => (c ? { ...c, open: false } : c))}
      />
      <OlderAttemptsSheet
        attempts={olderRecs}
        visible={olderOpen}
        onOpen={(rec) => {
          setOlderOpen(false);
          onOpenPending?.(rec);
        }}
        onClose={() => setOlderOpen(false)}
      />
    </View>
  );
}

