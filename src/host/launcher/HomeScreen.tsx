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
 * with the app's link. No native alert anywhere.
 */
import React, { useState } from 'react';
import { ScrollView, Share, useWindowDimensions, View } from 'react-native';
import { LAYOUT, SPACE } from '../../design/tokens';
import { haptics } from '../haptics';
import { log } from '../logging';
import { CHANNELS } from '../logging/channels';
import { ContextMenu, type MenuAnchor, type MenuRow } from '../ui/ContextMenu';
import { AppTile } from '../ui/AppTile';
import { gridLayout } from '../ui/AppTile-geometry';
import { Chip } from '../ui/Chip';
import { Ember } from '../ui/Ember';
import { Notice } from '../ui/Notice';
import { Text } from '../ui/Text';
import { TextField } from '../ui/TextField';
import { useToast } from '../ui/Toast';
import { useTokens } from '../ui/tokens';
import { makeStyles } from '../ui/tokens-pure';
import type { InstalledApp } from './app-index';
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
import { ScrollEdgeFade } from './ScrollEdgeFade';
import type { ForkOptions } from './store-access';
import { menuFor, type MenuAction } from './tile-menus';
import { tileOf, type TileIdentity } from './tile-identity';

export interface HomeScreenProps {
  apps: InstalledApp[];
  /** Every in-flight, failed or stopped attempt, NEWEST FIRST, straight from `PendingBuildStore.list()`.
   *  A record with `editingAppId` is a change in flight on that app and decorates its tile. */
  pending?: readonly PendingBuildRecord[];
  /** The armed purges: an app or an attempt with one is waiting out its Undo window and is not shown. */
  purges?: Pick<PendingPurgeStore, 'has'>;
  /** Which apps have an open or copy running right now (`app-busy.ts`), by app id. Such a tile reads
   *  busy and opens no menu. Omitted = nothing is in flight. */
  appBusy?: AppBusyMap;
  /** The session says the server cannot be reached: the live notice shows. False while unknown. */
  offline?: boolean;
  /** Ids of attempts waiting for a free spot, which show "Waiting…" instead of "Making…". */
  queued?: ReadonlySet<string>;
  /** The stream's activity, 0–1, per attempt id: the ember on a tile being made or changed follows it. */
  activity?: Readonly<Record<string, number>>;
  /** Whether "Make a copy" can copy the data (`StoreAccess.canCopyData`). When false the copy is made
   *  fresh at once and no question is asked. */
  canCopyData?: boolean;
  /** The description typed so far in the describe sheet, shown in the composer bar. */
  draft?: string;
  onOpen: (app: InstalledApp) => void;
  /** Makes the copy. Resolves the new entry; resolves `null` when a copy of this app is already
   *  running; rejects when the copy could not be made (nothing was created). */
  onFork: (app: InstalledApp, opts: ForkOptions) => Promise<InstalledApp | null>;
  /** Delete: hide the app and arm its purge. The toast's Undo calls `onUndoDelete`. */
  onDelete: (app: InstalledApp) => void;
  onUndoDelete: (app: InstalledApp) => void;
  /** Discard: hide these attempts and arm their purges. The toast's Undo calls `onUndoDiscard`. */
  onDiscard: (recs: readonly PendingBuildRecord[]) => void;
  onUndoDiscard: (recs: readonly PendingBuildRecord[]) => void;
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
}));

interface OpenMenu {
  cell: GridCell;
  anchor: MenuAnchor;
  open: boolean;
}

/** The attempt a menu action acts on: the cell's own, or the change in flight on an app. */
function attemptOf(cell: GridCell): PendingBuildRecord | undefined {
  if (cell.kind === 'attempt') return cell.rec;
  return cell.kind === 'app' ? cell.rebuild : undefined;
}

export default function HomeScreen({
  apps,
  pending,
  purges,
  appBusy,
  offline,
  queued,
  activity,
  canCopyData = false,
  draft,
  onOpen,
  onFork,
  onDelete,
  onUndoDelete,
  onDiscard,
  onUndoDiscard,
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

  const all = composeGrid(pending ?? [], apps, {
    now: Date.now(),
    queued,
    deletedApps: new Set(apps.filter((a) => purges?.has('app', a.id)).map((a) => a.id)),
    discardedAttempts: new Set((pending ?? []).filter((r) => purges?.has('attempt', r.id)).map((r) => r.id)),
  });
  const appCount = all.filter((c) => c.kind === 'app').length;
  const searching = appCount >= SEARCH_FROM_APPS;
  const cells = searching ? searchCells(all, query) : all;
  const olderRecs = all.flatMap((c) => (c.kind === 'older' ? c.recs : []));
  const customized = customizing ? (apps.find((a) => a.id === customizing.id) ?? null) : null;

  const closeMenu = () => setMenu((m) => (m ? { ...m, open: false } : m));

  const discard = (recs: readonly PendingBuildRecord[]) => {
    onDiscard(recs);
    haptics.play('warning');
    toast.show({
      message: recs.length === 1 ? COPY.discardedToast : discardedManyToast(recs.length),
      action: { label: COPY.toastUndo, onPress: () => onUndoDiscard(recs) },
    });
  };

  const remove = (app: InstalledApp) => {
    onDelete(app);
    haptics.play('warning');
    toast.show({ message: deletedToast(app.name), undo: true, action: { label: COPY.toastUndo, onPress: () => onUndoDelete(app) } });
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

  const renderCell = (cell: GridCell) => {
    const { tint, icon } = tileOfCell(cell);
    const live = cell.kind === 'attempt' ? cell.rec : attemptOf(cell);
    const busy = cell.kind === 'app' && isAppBusy(appBusy, cell.app.id);
    return (
      <AppTile
        key={cellKey(cell)}
        layout={layout}
        name={cell.kind === 'older' ? '' : cellName(cell)}
        state={cell.kind === 'older' ? 'older' : cell.state}
        tint={tint}
        glyph={icon}
        example={cell.kind === 'app' && cell.app.example === true}
        copy={cell.kind === 'app' && cell.app.forkedFrom !== undefined}
        count={cell.kind === 'older' ? cell.recs.length : undefined}
        activity={live ? activity?.[live.id] : undefined}
        busy={busy}
        lifted={menu?.open === true && cellKey(menu.cell) === cellKey(cell)}
        onPress={() => press(cell)}
        onLongPress={(anchor) => {
          if (!busy) setMenu({ cell, anchor, open: true });
        }}
      />
    );
  };

  const empty = all.length === 0;
  const gridFrame = { paddingHorizontal: layout.gutter, rowGap: layout.kind === 'grid' ? layout.rowGap : 0 };
  const ideas = [COPY.homeIdeaTimer, COPY.homeIdeaTracker, COPY.homeIdeaDice];

  return (
    <View style={s.root}>
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
              <Ember size={128} state="working" />
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
            <View style={[layout.kind === 'grid' ? s.grid : s.list, s.gridEnd, gridFrame]}>
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

