// ─────────────────────────────────────────────────────────────────────────────
// HomeScreen — the `2a` home (shell-redesign-v2, task D9).
// ─────────────────────────────────────────────────────────────────────────────
// The `Whim` title, the `Your apps` eyebrow, a three-column grid of ghost-letterform tiles
// (chain-F's `AppTile`, per its contract — this screen never re-derives a colour or a monogram),
// and the composer entry row that opens the prompt flow's compose step. Long-press a tile for the
// action sheet (Open / Fork / History / Prompt again / Delete-with-confirmation); a long-press on
// the title opens the __DEV__ probe surface. Every visible string comes from `copy.ts` and passes
// the product-verbs guard.
import React, { useState } from 'react';
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { FONT_FAMILY, RADIUS, SPACING, STATUS_COLORS, TYPE_SCALE } from '../../sdk/theme';
import { InstalledApp } from './app-index';
import { isAppBusy, type AppBusyMap } from './app-busy';
import { ghostTileColorFor } from './prompt-flow';
import type { PendingBuildRecord } from './pending-builds';
import AppTile, { APP_TILE_SIZE } from './app-tile';
import { COPY, deleteBody, forkedFromLabel, ghostStateCaption } from './copy';
import { composeGrid, InstalledTile } from './grid-composition';
import {
  HOME_GRID_COLUMN_GAP,
  HOME_GRID_ROW_GAP,
  HOME_GRID_SIDE_PADDING,
  homeGridCellWidth,
} from './home-grid';
import { shellPalette, ShellPalette } from './theme';
import { useTheme } from './theme-context';

/** The grid's geometry and its cell-width derivation live in `home-grid.ts` — a module free of
 *  `react-native` so the arithmetic that decides whether the row wraps can be tested under Node.
 *  Re-exported here so `LauncherRoot.tsx` keeps importing them from the screen that owns them. */
export { HOME_GRID_COLUMNS, HOME_GRID_COLUMN_GAP, HOME_GRID_ROW_GAP } from './home-grid';

export interface HomeScreenProps {
  apps: InstalledApp[];
  onOpen: (app: InstalledApp) => void;
  /** opts.shareData answers the share-vs-fresh question asked between the Fork tap and the
   *  actual fork (design D4) — never asked for rewind continuations, which call access.fork
   *  directly with shareData: true. */
  onFork: (app: InstalledApp, opts: { shareData: boolean }) => void;
  onDelete: (app: InstalledApp) => void;
  /** Which apps have an open/fork/delete running right now (`app-busy.ts`), by app id. Drives the
   *  tile's own busy look — for ANY of the three operations, since the fork and delete sheets are
   *  closed by the time their version-store call starts — and the Fork/Delete rows'
   *  busy-and-disabled state for the re-open case (`app-launcher`:
   *  "Opening an app shows an immediate busy affordance" / "Fork and delete show a busy state and
   *  cannot be re-triggered mid-operation"). Omitted = nothing is in flight. */
  appBusy?: AppBusyMap;
  /** Opens the app's full-screen history surface (version-history-ux). */
  onHistory: (app: InstalledApp) => void;
  /** Opens the compose step scoped to re-prompting this app (`app-launcher` spec's "create
   *  affordance and per-app re-prompt action" requirement). */
  onPromptAgain: (app: InstalledApp) => void;
  /** The composer entry row: opens the compose step with no app being edited (same requirement). */
  onCreate: () => void;
  onSettings: () => void;
  /** __DEV__ entry: long-press the title to reach the containment/bridge probe surface (D6). */
  onOpenDevProbe?: () => void;

  // ── Pending builds (launcher-ghost-tiles; contract `handoff/ghost-handlers.md`) ─────────────
  // The shell supplies all four together or none of them. The grid composition and the ghost
  // visuals that consume them are their own chain's work; declared here so the shell has exactly
  // one place to hand them over.

  /** Every in-flight / failed / interrupted generation attempt, NEWEST FIRST, straight from
   *  `PendingBuildStore.list()`. Records carrying `editingAppId` are rebuilds and must not become
   *  their own tile — they belong to the installed tile of that id. */
  pending?: readonly PendingBuildRecord[];
  /** Tap: `building` reattaches to its build-progress screen, `failed`/`interrupted` opens the
   *  failure screen hydrated from the record. Never call this for a rebuild record's tile — that
   *  tile is a launchable installed app and its tap belongs to `onOpen`. */
  onOpenPending?: (rec: PendingBuildRecord) => void;
  /** Quick action on a `building` record: aborts the run and deletes the record. */
  onCancelPending?: (rec: PendingBuildRecord) => void;
  /** Quick action on a `failed`/`interrupted` record: deletes the record. */
  onDismissPending?: (rec: PendingBuildRecord) => void;
}

export default function HomeScreen({
  apps,
  onOpen,
  onFork,
  onDelete,
  appBusy,
  onHistory,
  onPromptAgain,
  onCreate,
  onSettings,
  onOpenDevProbe,
  pending,
  onOpenPending,
  onCancelPending,
  onDismissPending,
}: Readonly<HomeScreenProps>) {
  const [selected, setSelected] = useState<InstalledApp | null>(null);
  const [forkTarget, setForkTarget] = useState<InstalledApp | null>(null);
  const [selectedGhost, setSelectedGhost] = useState<PendingBuildRecord | null>(null);
  const { theme } = useTheme();
  const p = shellPalette(theme);
  const cellWidth = homeGridCellWidth(useWindowDimensions().width, APP_TILE_SIZE);

  // Ghosts newest-first, before installed apps; dedupe-by-id (pending wins) and rebuild
  // flagging both live in `grid-composition.ts` (`handoff/ghost-handlers.md`'s invariants).
  const tiles = composeGrid(pending ?? [], apps);
  const selectedRebuild = selected
    ? tiles.find((t): t is InstalledTile => t.kind === 'app' && t.app.id === selected.id)?.rebuild
    : undefined;

  /** What the long-pressed app is busy with, if anything — the sheet's Fork and Delete rows read
   *  it. One app has at most one operation in flight, so ANY in-flight operation disables both
   *  rows; only the matching one also carries the busy label. */
  const selectedBusy = selected ? appBusy?.[selected.id] : undefined;

  const confirmDelete = (app: InstalledApp) => {
    setSelected(null);
    Alert.alert(COPY.deleteTitle, deleteBody(app.name), [
      { text: COPY.cancel, style: 'cancel' },
      { text: COPY.deleteConfirm, style: 'destructive', onPress: () => onDelete(app) },
    ]);
  };

  return (
    <View style={[styles.root, { backgroundColor: p.bg }]}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={[TYPE_SCALE.display, { color: p.text }]} onLongPress={onOpenDevProbe} suppressHighlighting>
            {COPY.homeTitle}
          </Text>
          <Text style={[TYPE_SCALE.eyebrow, styles.eyebrow, { color: p.textMuted }]}>{COPY.homeSubtitle}</Text>
        </View>
        <TouchableOpacity
          onPress={onSettings}
          accessibilityLabel={COPY.settingsTitle}
          style={[styles.settingsBtn, { backgroundColor: p.card, borderColor: p.cardBorder }]}
        >
          <Text style={[styles.settingsGlyph, { color: p.text }]}>{'⚙'}</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        {tiles.length === 0 && (
          <Text style={[TYPE_SCALE.body, styles.empty, { color: p.textMuted }]}>{COPY.emptyTitle}</Text>
        )}

        <View style={styles.grid}>
          {tiles.map((tile) => {
            if (tile.kind === 'ghost') {
              return (
                <GhostGridTile
                  key={tile.rec.id}
                  rec={tile.rec}
                  cellWidth={cellWidth}
                  onOpenPending={onOpenPending}
                  onLongPress={() => setSelectedGhost(tile.rec)}
                />
              );
            }
            const { app, rebuild } = tile;
            return (
              <View key={app.id} style={{ width: cellWidth }}>
                <TouchableOpacity
                  activeOpacity={0.85}
                  onPress={() => onOpen(app)}
                  onLongPress={() => setSelected(app)}
                >
                  <AppTile name={app.name} manifest={app.record.manifest} width={cellWidth} busy={isAppBusy(appBusy, app.id)} />
                  {app.example && (
                    <View style={[styles.badge, { backgroundColor: p.card, borderColor: p.cardBorder }]}>
                      <Text style={[TYPE_SCALE.eyebrow, { color: p.textMuted }]}>{COPY.exampleBadge}</Text>
                    </View>
                  )}
                  {rebuild && <RebuildBadge rebuild={rebuild} palette={p} onOpenPending={onOpenPending} />}
                </TouchableOpacity>
                {app.forkedFrom && (
                  <Text style={[TYPE_SCALE.caption, { color: p.textMuted }]} numberOfLines={1}>
                    {forkedFromLabel(app.forkedFrom.name)}
                  </Text>
                )}
              </View>
            );
          })}
        </View>
      </ScrollView>

      {/* The create affordance: one row, always reachable, opening the compose step. */}
      <TouchableOpacity
        onPress={onCreate}
        accessibilityRole="button"
        style={[styles.composer, { backgroundColor: p.card, borderColor: p.cardBorder }]}
      >
        <View style={[styles.composerPlus, { backgroundColor: p.accent }]}>
          <Text style={[styles.composerPlusGlyph, { color: p.onAccent }]}>{'＋'}</Text>
        </View>
        <Text style={[TYPE_SCALE.body, { color: p.textMuted }]}>{COPY.homeComposerPlaceholder}</Text>
      </TouchableOpacity>

      {/* Action sheet (long-press): Open / Fork / History / Prompt again / Delete. */}
      <Modal visible={selected != null} transparent animationType="fade" onRequestClose={() => setSelected(null)}>
        <Pressable style={styles.sheetScrim} onPress={() => setSelected(null)}>
          <Pressable style={[styles.sheet, { backgroundColor: p.card }]}>
            <Text style={[TYPE_SCALE.bodyEmphatic, styles.sheetTitle, { color: p.textMuted }]} numberOfLines={1}>{selected?.name}</Text>
            <SheetRow label={COPY.actionOpen} color={p.accent} borderColor={p.cardBorder} onPress={() => { const a = selected!; setSelected(null); onOpen(a); }} />
            <SheetRow label={selectedBusy === 'fork' ? COPY.actionForkBusy : COPY.actionFork} color={p.accent} borderColor={p.cardBorder} disabled={selectedBusy != null} onPress={() => { const a = selected!; setSelected(null); setForkTarget(a); }} />
            <SheetRow label={COPY.actionHistory} color={p.accent} borderColor={p.cardBorder} onPress={() => { const a = selected!; setSelected(null); onHistory(a); }} />
            <SheetRow label={COPY.actionPromptAgain} color={p.accent} borderColor={p.cardBorder} onPress={() => { const a = selected!; setSelected(null); onPromptAgain(a); }} />
            <SheetRow label={selectedBusy === 'delete' ? COPY.actionDeleteBusy : COPY.actionDelete} color={p.danger} borderColor={p.cardBorder} disabled={selectedBusy != null} onPress={() => confirmDelete(selected!)} />
            {selectedRebuild && (
              <GhostActionRow
                rec={selectedRebuild}
                palette={p}
                onCancelPending={onCancelPending}
                onDismissPending={onDismissPending}
                onDone={() => setSelected(null)}
              />
            )}
            <SheetRow label={COPY.cancel} color={p.textMuted} borderColor={p.cardBorder} onPress={() => setSelected(null)} />
          </Pressable>
        </Pressable>
      </Modal>

      {/* Fork question sheet (design D4): asked only for an explicit Fork tap, never for rewind
          continuations, which thread shareData: true straight into access.fork. */}
      <Modal visible={forkTarget != null} transparent animationType="fade" onRequestClose={() => setForkTarget(null)}>
        <Pressable style={styles.sheetScrim} onPress={() => setForkTarget(null)}>
          <Pressable style={[styles.sheet, { backgroundColor: p.card }]}>
            <Text style={[TYPE_SCALE.bodyEmphatic, styles.sheetTitle, { color: p.textMuted }]} numberOfLines={1}>{forkTarget?.name}</Text>
            <SheetRow label={COPY.forkShareData} color={p.accent} borderColor={p.cardBorder} onPress={() => { const a = forkTarget!; setForkTarget(null); onFork(a, { shareData: true }); }} />
            <SheetRow label={COPY.forkStartFresh} color={p.accent} borderColor={p.cardBorder} onPress={() => { const a = forkTarget!; setForkTarget(null); onFork(a, { shareData: false }); }} />
            <SheetRow label={COPY.cancel} color={p.textMuted} borderColor={p.cardBorder} onPress={() => setForkTarget(null)} />
          </Pressable>
        </Pressable>
      </Modal>

      {/* Ghost tile's own long-press sheet (spec "Long-press on a ghost tile offers Cancel or
          Dismiss, never both"): a ghost has no installed-app rows (Open/Fork/History/Prompt
          again/Delete don't apply — nothing is installed yet), just the one state-appropriate
          quick action plus the sheet's own close row. */}
      <Modal visible={selectedGhost != null} transparent animationType="fade" onRequestClose={() => setSelectedGhost(null)}>
        <Pressable style={styles.sheetScrim} onPress={() => setSelectedGhost(null)}>
          <Pressable style={[styles.sheet, { backgroundColor: p.card }]}>
            <Text style={[TYPE_SCALE.bodyEmphatic, styles.sheetTitle, { color: p.textMuted }]} numberOfLines={1}>{selectedGhost?.workingTitle}</Text>
            {selectedGhost && (
              <GhostActionRow
                rec={selectedGhost}
                palette={p}
                onCancelPending={onCancelPending}
                onDismissPending={onDismissPending}
                onDone={() => setSelectedGhost(null)}
              />
            )}
            <SheetRow label={COPY.cancel} color={p.textMuted} borderColor={p.cardBorder} onPress={() => setSelectedGhost(null)} />
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

/** A ghost tile: greyed, non-launchable, tapping opens the build/failure screen by state
 *  (`onOpenPending`), long-press opens its own quick-action sheet — never `onOpen`, since no
 *  mini-app realm exists yet (spec "A ghost tile does not launch an app"). */
function GhostGridTile({
  rec,
  cellWidth,
  onOpenPending,
  onLongPress,
}: Readonly<{
  rec: PendingBuildRecord;
  cellWidth: number;
  onOpenPending?: (rec: PendingBuildRecord) => void;
  onLongPress: () => void;
}>) {
  return (
    <View style={{ width: cellWidth }}>
      <TouchableOpacity activeOpacity={0.85} onPress={() => onOpenPending?.(rec)} onLongPress={onLongPress}>
        <AppTile
          name={rec.workingTitle}
          manifest={{ tileColor: ghostTileColorFor(rec.id) }}
          ghost={rec.state}
          width={cellWidth}
        />
      </TouchableOpacity>
    </View>
  );
}

/** The rebuild accent on an already-installed tile (design D8): the tile itself stays fully
 *  launchable — this is a small overlay badge, never the greyed `ghost` treatment. `building` is
 *  a passive caption (no dedicated tap target: the tile's normal tap stays `onOpen`, and Cancel
 *  lives in the long-press sheet); `failed`/`interrupted` is tappable on its own, opening the
 *  failure screen without stealing the tile's own `onOpen`. */
function RebuildBadge({
  rebuild,
  palette,
  onOpenPending,
}: Readonly<{ rebuild: PendingBuildRecord; palette: ShellPalette; onOpenPending?: (rec: PendingBuildRecord) => void }>) {
  if (rebuild.state === 'building') {
    return (
      <View style={[styles.rebuildBadge, { backgroundColor: palette.card, borderColor: palette.cardBorder }]}>
        <Text style={[TYPE_SCALE.eyebrow, { color: palette.textMuted }]} numberOfLines={1}>
          {COPY.ghostCaptionBuilding}
        </Text>
      </View>
    );
  }
  return (
    <TouchableOpacity
      accessibilityRole="button"
      style={[styles.rebuildBadge, styles.rebuildBadgeAlert]}
      onPress={() => onOpenPending?.(rebuild)}
    >
      <Text style={[TYPE_SCALE.eyebrow, styles.rebuildBadgeAlertText]} numberOfLines={1}>
        {ghostStateCaption(rebuild.state)}
      </Text>
    </TouchableOpacity>
  );
}

/** The long-press quick action a ghost/rebuild record offers: Cancel while `building`, Dismiss
 *  once `failed`/`interrupted` — never both (spec "Long-press on a ghost tile offers Cancel or
 *  Dismiss, never both"). Shared by the pure-ghost sheet and the installed-tile sheet's rebuild
 *  row, so the two never drift. */
function GhostActionRow({
  rec,
  palette,
  onCancelPending,
  onDismissPending,
  onDone,
}: Readonly<{
  rec: PendingBuildRecord;
  palette: ShellPalette;
  onCancelPending?: (rec: PendingBuildRecord) => void;
  onDismissPending?: (rec: PendingBuildRecord) => void;
  onDone: () => void;
}>) {
  if (rec.state === 'building') {
    return (
      <SheetRow
        label={COPY.actionCancelBuild}
        color={palette.danger}
        borderColor={palette.cardBorder}
        onPress={() => { onDone(); onCancelPending?.(rec); }}
      />
    );
  }
  return (
    <SheetRow
      label={COPY.actionDismissBuild}
      color={palette.danger}
      borderColor={palette.cardBorder}
      onPress={() => { onDone(); onDismissPending?.(rec); }}
    />
  );
}

/** `disabled` is the row's wait affordance: an operation is already running for this app, so the
 *  row neither fires nor reads as tappable. Dimming is opacity-only — `shadow*` props are
 *  iOS-only, so a raised/flattened treatment would be invisible on Android. */
function SheetRow({ label, onPress, color, borderColor, disabled }: Readonly<{ label: string; onPress: () => void; color: string; borderColor: string; disabled?: boolean }>) {
  return (
    <TouchableOpacity
      style={[styles.sheetRow, { borderTopColor: borderColor }, disabled ? styles.sheetRowDisabled : null]}
      accessibilityState={{ disabled: disabled === true }}
      disabled={disabled}
      onPress={onPress}
    >
      <Text style={[TYPE_SCALE.bodyEmphatic, { color }]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.lg,
    // design html:384 `padding:20px 22px 14px`. 20 and 14 have no `SPACING` counterpart (the scale
    // is 8/12/16/22/34) and get no one-off token (ruling R9) — they stay literals, cited.
    paddingTop: 20,
    paddingBottom: 14,
  },
  headerText: { flexShrink: 1 },
  eyebrow: { marginTop: SPACING.xs },
  settingsBtn: { width: 38, height: 38, borderRadius: 19, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  /** design html:386 `font:400 16px/1` (ruling R25). Was `TYPE_SCALE.body`, which L1 retargeted
   *  15 -> 13.5 this batch — that widened a 1px gap to 2.5px AND dragged body's 20.925 line-height
   *  into a 38x38 circle the design gives `/1`. A one-off icon glyph is not a typographic role, so
   *  it takes a local face, exactly like `composerPlusGlyph` below (V2). */
  settingsGlyph: { fontFamily: FONT_FAMILY.sansRegular, fontSize: 16, lineHeight: 16, fontWeight: '400' },
  // `paddingHorizontal` is the term `homeGridCellWidth` subtracts — read from the one constant so
  // the two cannot drift (a drift here overflows the row and wraps the grid to two columns).
  scroll: { paddingHorizontal: HOME_GRID_SIDE_PADDING, paddingBottom: SPACING.lg, flexGrow: 1 },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: HOME_GRID_COLUMN_GAP,
    rowGap: HOME_GRID_ROW_GAP,
  },
  badge: {
    position: 'absolute',
    top: SPACING.xs,
    right: SPACING.xs,
    borderWidth: 1,
    borderRadius: RADIUS.chip,
    paddingHorizontal: 6,
  },
  /** The rebuild accent (design D8) — bottom-right, so it never collides with the top-right
   *  "Example" badge above. `building` is the plain card treatment (neutral, informational
   *  only); `failed`/`interrupted` overrides to the alert hue and IS its own tap target
   *  (`RebuildBadge`), opening the failure screen without stealing the tile's `onOpen`. */
  rebuildBadge: {
    position: 'absolute',
    bottom: SPACING.xs,
    right: SPACING.xs,
    borderWidth: 1,
    borderRadius: RADIUS.chip,
    paddingHorizontal: 6,
  },
  rebuildBadgeAlert: { backgroundColor: STATUS_COLORS.broken, borderColor: STATUS_COLORS.broken },
  rebuildBadgeAlertText: { color: '#ffffff' },
  empty: { paddingVertical: SPACING.xl },
  composer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    marginHorizontal: SPACING.lg,
    marginBottom: SPACING.lg,
    // design html:401 `padding:14px 16px`; 14 has no `SPACING` counterpart, so it is a cited
    // literal (ruling R9). The horizontal 16 is `SPACING.md` and already matched.
    paddingVertical: 14,
    paddingHorizontal: SPACING.md,
    borderWidth: 1,
    borderRadius: 20,
  },
  composerPlus: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  /** design html:402 `font:400 17px/1`. A one-off icon glyph is not a typographic role, so it gets
   *  a local face rather than a new `TYPE_SCALE` entry (R2 is scoped to roles) — the same
   *  precedent as `app-tile.tsx`'s monogram faces. */
  composerPlusGlyph: { fontFamily: FONT_FAMILY.sansRegular, fontSize: 17, lineHeight: 17, fontWeight: '400' },
  sheetScrim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: RADIUS.sheet, borderTopRightRadius: RADIUS.sheet, paddingTop: SPACING.xs, paddingBottom: SPACING.xl },
  sheetTitle: { textAlign: 'center', paddingVertical: SPACING.sm },
  sheetRow: { paddingVertical: SPACING.md, alignItems: 'center', borderTopWidth: StyleSheet.hairlineWidth },
  sheetRowDisabled: { opacity: 0.45 },
});
