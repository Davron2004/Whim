// ─────────────────────────────────────────────────────────────────────────────
// HistoryScreen — the `4a` timeline (shell-redesign-v2 chain-E; version-history spec).
// ─────────────────────────────────────────────────────────────────────────────
// A full-screen sibling of SettingsScreen: its own hardware-back binding returning to Home,
// `shellPalette(theme)` colors, `TYPE_SCALE` faces, and every label from `copy.ts`. History is
// only reachable from the home action sheet, so the app itself is never running while this
// screen is open — no live-realm interaction to design for. All store access goes through
// `StoreAccess` (never a raw `VersionStore`); the row model (summary-or-prompt headline, kind
// grouping, at-most-two actions) lives in `history-logic.ts` so it is Node-testable without
// rendering this component.
//
// Tapping a row EXPANDS it (never restores) — restoring and forking are explicit actions inside
// an expanded row, each behind a confirm sheet whose safe option is the large button (D11).
// Headlines and the expanded result sentence are agent prose (the user's own words or Whim's own
// summary) and render through the one shared `WhimProse` renderer; everything else on this
// screen is product copy and is never marked (Whim Syntax rule 7).
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, FlatList, Modal, Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { KIND_BADGE_COLORS, RADIUS, SPACING, STATUS_COLORS, TYPE_SCALE } from '../../sdk/theme';
import type { SummaryKind } from '@whim/contract';
import type { Snapshot } from '../version-store';
import { InstalledApp } from './app-index';
import {
  annotationBetween,
  buildHistoryRows,
  fieldsLeavingViewOnRestore,
  filterRows,
  formatRelativeTimestamp,
  groupCounts,
  listVersions,
  type FilterGroup,
  type HistoryRow,
} from './history-logic';
import { StoreAccess } from './store-access';
import {
  addedFieldsLine,
  COPY,
  copySheetBody,
  copySheetTitle,
  historyFilterAll,
  historySubtitle,
  restoreSheetBody,
  restoreSheetTitle,
  restoredToast,
} from './copy';
import { shellPalette } from './theme';
import { useTheme } from './theme-context';
import { tileColor } from './tiles';
import WhimProse from '../ui/whim-prose/WhimProse';

export interface HistoryScreenProps {
  app: InstalledApp;
  access: StoreAccess;
  /** Returns to the home screen — supplied by `LauncherRoot` (same callback Home refreshes on). */
  onBack: () => void;
  /**
   * Opens the compose step scoped to `app` — the current version's one action, "Change it from
   * here" (E5). Optional and additive: `HistoryScreen`'s exported props signature is otherwise
   * unchanged (chain-E's constraint), so every existing call site keeps compiling unchanged. The
   * compose screen itself is chain-D's file (`LauncherRoot.tsx`'s `Screen` union); until that
   * chain supplies this callback, the button renders and is tappable but does nothing.
   */
  onChangeIt?: (app: InstalledApp) => void;
}

type Filter = 'all' | FilterGroup;

interface ConfirmState {
  kind: 'restore' | 'copy';
  row: HistoryRow;
}

interface ToastState {
  text: string;
}

const TOAST_TIMEOUT_MS = 2200;

/** History-screen kind-badge tints — the `4a` design prototype's byte-exact hues, moved into the
 *  tokens module (`KIND_BADGE_COLORS`, `src/sdk/design-tokens.ts`) so no inline hex lives on this
 *  screen. */
const KIND_BADGE = KIND_BADGE_COLORS;

/** The ring around the current version's timeline dot — design `4a` writes it as
 *  `rgba(13,148,136,.3)` (`Whim Mobile.dc.html:848`), which is exactly the reserved done/working
 *  hue at 30% alpha. Derived from the token rather than re-typed as a second hex literal:
 *  `0x4d` = 77/255 ≈ .302. Every other dot ring is the plain `cardBorder` hairline. */
const CURRENT_DOT_RING = STATUS_COLORS.done + '4d';

/** The dot's centre, measured down from the row wrapper's top edge — `styles.marker`'s `top` plus
 *  half its height. The timeline segment starts or stops here on the list's terminal rows. */
const DOT_CENTRE = 21.5;

/** Where a row's timeline segment begins and ends: an interior row's spans the whole wrapper, the
 *  first row's drops from the dot, the last row's rises to it. A list of one renders no segment at
 *  all — the caller checks that, since there is no extent that expresses "absent". */
function timelineExtent(isFirst: boolean, isLast: boolean) {
  if (isFirst) return { top: DOT_CENTRE, bottom: 0 };
  if (isLast) return { top: 0, height: DOT_CENTRE };
  return { top: 0, bottom: 0 };
}

const KIND_LABEL: Record<SummaryKind, string> = {
  Start: COPY.historyKindStart,
  Added: COPY.historyKindAdded,
  Changed: COPY.historyKindChanged,
  Removed: COPY.historyKindRemoved,
  Look: COPY.historyKindLook,
  Fixed: COPY.historyKindFixed,
};

export default function HistoryScreen({ app, access, onBack, onChangeIt }: Readonly<HistoryScreenProps>) {
  const { theme } = useTheme();
  const p = shellPalette(theme);
  const appHue = tileColor(app.name, app.record.manifest);

  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [restoreLeaving, setRestoreLeaving] = useState<string[]>([]);
  const [toast, setToast] = useState<ToastState | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = async () => {
    const [list, active] = await Promise.all([listVersions(access, app), access.activeId(app)]);
    setSnapshots(list);
    setActiveId(active);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [access, app]);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onBack();
      return true;
    });
    return () => sub.remove();
  }, [onBack]);

  useEffect(() => {
    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, []);

  useEffect(() => {
    if (!confirm || confirm.kind !== 'restore' || activeId == null) {
      setRestoreLeaving([]);
      return;
    }
    let cancelled = false;
    fieldsLeavingViewOnRestore(access, app, confirm.row.id, activeId).then(fields => {
      if (!cancelled) setRestoreLeaving(fields);
    });
    return () => {
      cancelled = true;
    };
  }, [confirm, access, app, activeId]);

  const rows = useMemo(() => buildHistoryRows(snapshots, activeId), [snapshots, activeId]);
  const filtered = useMemo(() => filterRows(rows, filter), [rows, filter]);
  const counts = useMemo(() => groupCounts(rows), [rows]);
  const oldest = snapshots[snapshots.length - 1];

  const showToast = (text: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ text });
    toastTimer.current = setTimeout(() => setToast(null), TOAST_TIMEOUT_MS);
  };

  const confirmRestore = async () => {
    if (!confirm) return;
    const { row } = confirm;
    await access.rollback(app, row.id);
    setConfirm(null);
    await load();
    showToast(restoredToast(row.version));
  };

  const confirmCopy = async () => {
    if (!confirm) return;
    const { row } = confirm;
    setConfirm(null);
    await access.fork(app, row.id);
    showToast(COPY.historyCopyToast);
  };

  const pills: Array<{ key: Filter; label: string }> = [
    { key: 'all', label: historyFilterAll(rows.length) },
    { key: 'features', label: COPY.historyFilterWhatItDoes },
    { key: 'look', label: COPY.historyFilterLook },
    { key: 'fixes', label: COPY.historyFilterFixes },
  ];

  const renderRow = ({ item, index }: { item: HistoryRow; index: number }) => (
    <HistoryRowView
      row={item}
      app={app}
      access={access}
      appHue={appHue}
      predecessorId={snapshots[item.index + 1]?.id}
      expanded={item.id === expandedId}
      isFirst={index === 0}
      isLast={index === filtered.length - 1}
      palette={p}
      onToggle={() => setExpandedId(prev => (prev === item.id ? null : item.id))}
      onChangeIt={() => onChangeIt?.(app)}
      onGoBack={() => setConfirm({ kind: 'restore', row: item })}
      onStartCopy={() => setConfirm({ kind: 'copy', row: item })}
    />
  );

  return (
    <View style={[styles.root, { backgroundColor: p.bg }]}>
      <View style={[styles.header, { borderBottomColor: p.cardBorder }]}>
        <TouchableOpacity
          onPress={onBack}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={COPY.backLabel}
          style={[styles.backBtn, { backgroundColor: p.card, borderColor: p.cardBorder }]}
        >
          <View style={[styles.backChevron, { borderColor: p.text }]} />
        </TouchableOpacity>
        <View style={styles.headerText}>
          <Text style={TYPE_SCALE.screenTitle}>
            <Text style={{ color: appHue }}>{app.name}</Text>
            <Text style={{ color: p.text }}>{' ' + COPY.historyTitleSuffix}</Text>
          </Text>
          {oldest && (
            <Text style={[TYPE_SCALE.caption, styles.subtitle, { color: p.textMuted }]}>
              {historySubtitle(rows.length, formatRelativeTimestamp(oldest.createdAt))}
            </Text>
          )}
        </View>
      </View>

      <View style={styles.pillRow}>
        {pills.map(pill => {
          const selected = pill.key === filter;
          const count = pill.key === 'all' ? undefined : counts[pill.key];
          if (pill.key !== 'all' && count === 0) return null;
          return (
            <TouchableOpacity
              key={pill.key}
              onPress={() => setFilter(pill.key)}
              style={[
                styles.pill,
                { borderColor: p.cardBorder, backgroundColor: selected ? p.text : p.bg },
              ]}
            >
              <Text style={[TYPE_SCALE.caption, { color: selected ? p.onAccent : p.textMuted }]}>{pill.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <FlatList data={filtered} keyExtractor={row => row.id} renderItem={renderRow} contentContainerStyle={styles.list} />

      {toast && (
        <View style={[styles.toast, { backgroundColor: p.text }]}>
          <Text style={[TYPE_SCALE.bodyEmphatic, { color: p.onAccent }]}>{toast.text}</Text>
        </View>
      )}

      <Modal visible={confirm != null} transparent animationType="slide" onRequestClose={() => setConfirm(null)}>
        <Pressable style={styles.scrim} onPress={() => setConfirm(null)}>
          <Pressable style={[styles.sheet, { backgroundColor: p.card }]}>
            {confirm && (
              <ConfirmBody
                confirm={confirm}
                appName={app.name}
                leaving={restoreLeaving}
                palette={p}
                onCancel={() => setConfirm(null)}
                onConfirmRestore={confirmRestore}
                onConfirmCopy={confirmCopy}
              />
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

interface HistoryRowViewProps {
  row: HistoryRow;
  app: InstalledApp;
  access: StoreAccess;
  appHue: string;
  predecessorId: string | undefined;
  expanded: boolean;
  /** Timeline-segment terminators: the first row's line starts at the dot, the last row's ends
   *  there, and a lone row draws no line at all. Derived from the `FlatList` index, so a filter
   *  change re-terminates the visible list rather than the unfiltered one. */
  isFirst: boolean;
  isLast: boolean;
  palette: ReturnType<typeof shellPalette>;
  onToggle: () => void;
  onChangeIt: () => void;
  onGoBack: () => void;
  onStartCopy: () => void;
}

function HistoryRowView({
  row,
  app,
  access,
  appHue,
  predecessorId,
  expanded,
  isFirst,
  isLast,
  palette: p,
  onToggle,
  onChangeIt,
  onGoBack,
  onStartCopy,
}: Readonly<HistoryRowViewProps>) {
  const [annotationFields, setAnnotationFields] = useState<string[]>([]);
  const badge = row.kind ? KIND_BADGE[row.kind] : null;
  const proseApps = useMemo(() => [{ name: app.name, color: appHue }], [app.name, appHue]);

  // The `4a` timeline (design :28, :31), painted as a per-row segment rather than one absolute
  // overlay across the list: a bar spanning a scrolling `FlatList` either does not scroll with the
  // content or needs measurement, and it re-breaks every time a filter changes the row count.
  // Segments abut because `rowWrap` carries its 10px gap as padding, which the line spans.
  const dotColor = row.isCurrent ? STATUS_COLORS.done : (badge?.fg ?? p.textMuted);
  const ringColor = row.isCurrent ? CURRENT_DOT_RING : p.cardBorder;

  useEffect(() => {
    if (!expanded || predecessorId == null) {
      setAnnotationFields([]);
      return;
    }
    let cancelled = false;
    annotationBetween(access, app, predecessorId, row.id).then(fields => {
      if (!cancelled) setAnnotationFields(fields);
    });
    return () => {
      cancelled = true;
    };
  }, [expanded, predecessorId, access, app, row.id]);

  return (
    <View style={styles.rowWrap}>
      {!(isFirst && isLast) && (
        <View style={[styles.timeline, timelineExtent(isFirst, isLast), { backgroundColor: p.cardBorder }]} />
      )}
      <View style={[styles.marker, { backgroundColor: p.bg, borderColor: ringColor }]}>
        <View style={[styles.markerDot, { backgroundColor: dotColor }]} />
      </View>
      <TouchableOpacity
        style={[
          styles.card,
          { backgroundColor: expanded ? p.card : p.bg, borderColor: p.cardBorder },
        ]}
        onPress={onToggle}
        activeOpacity={0.8}
      >
        <View style={styles.cardHeader}>
          {badge && row.kind && (
            <View style={[styles.kindBadge, { backgroundColor: badge.bg }]}>
              <Text style={[TYPE_SCALE.kindBadge, { color: badge.fg }]}>{KIND_LABEL[row.kind]}</Text>
            </View>
          )}
          <Text style={[TYPE_SCALE.metaPlain, { color: p.textMuted }]}>{row.when}</Text>
          <Text style={[TYPE_SCALE.metaPlain, styles.versionLabel, { color: p.textMuted }]}>{row.version}</Text>
        </View>
        <Text style={[TYPE_SCALE.metaWide, styles.originLine, { color: p.textMuted }]}>
          {row.origin === 'you-said' ? COPY.historyOriginYouSaid : COPY.historyOriginUnprompted}
        </Text>
        <WhimProse
          text={row.headline}
          apps={proseApps}
          storedPrompt={row.promptText}
          marks={row.marks}
          style={[TYPE_SCALE.bodyEmphatic, styles.headline, { color: p.text }]}
        />
        {row.isInstall && (
          <Text style={[TYPE_SCALE.caption, styles.installLabel, { color: p.textMuted }]}>
            {COPY.historyInstallLabel}
          </Text>
        )}

        {expanded && (
          <View style={[styles.expandedBody, { borderTopColor: p.cardBorder }]}>
            {row.touched.length > 0 && (
              <>
                <Text style={[TYPE_SCALE.metaWide, { color: p.textMuted, marginTop: SPACING.sm }]}>
                  {COPY.historyTouchedEyebrow}
                </Text>
                <View style={styles.chipRow}>
                  {row.touched.map(area => (
                    <View key={area} style={[styles.chip, { backgroundColor: p.bg, borderColor: p.cardBorder }]}>
                      <Text style={[TYPE_SCALE.caption, { color: p.textMuted }]}>{area}</Text>
                    </View>
                  ))}
                </View>
              </>
            )}
            {annotationFields.length > 0 && (
              <WhimProse
                text={addedFieldsLine(annotationFields)}
                marks={[{ cls: 'hedge', start: 0, end: addedFieldsLine(annotationFields).length }]}
                style={[TYPE_SCALE.caption, { marginTop: SPACING.xs }]}
              />
            )}
            <View style={styles.actionRow}>
              {row.actions.includes('change-from-here') && (
                <ActionButton label={COPY.historyChangeFromHere} primary onPress={onChangeIt} palette={p} />
              )}
              {row.actions.includes('go-back') && (
                <ActionButton label={COPY.historyGoBackToThis} primary onPress={onGoBack} palette={p} />
              )}
              {row.actions.includes('start-copy') && (
                <ActionButton label={COPY.historyStartCopyHere} primary={false} onPress={onStartCopy} palette={p} />
              )}
            </View>
          </View>
        )}
      </TouchableOpacity>
      {row.isCurrent && (
        <Text style={[TYPE_SCALE.eyebrow, styles.currentMarker, { color: STATUS_COLORS.done }]}>
          {COPY.historyCurrentMarker}
        </Text>
      )}
    </View>
  );
}

function ActionButton({
  label,
  primary,
  onPress,
  palette: p,
}: Readonly<{ label: string; primary: boolean; onPress: () => void; palette: ReturnType<typeof shellPalette> }>) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[
        styles.actionBtn,
        primary ? { backgroundColor: p.text } : [styles.actionBtnSecondary, { borderColor: p.cardBorder }],
      ]}
    >
      <Text style={[TYPE_SCALE.caption, styles.actionBtnLabel, { color: primary ? p.onAccent : p.textMuted }]}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

/**
 * The confirm sheet (E7/D11): the SAFE option (`Cancel`) is the large, full-width button; the
 * consequential action is demoted to plain text beneath it — never the other way around.
 */
function ConfirmBody({
  confirm,
  appName,
  leaving,
  palette: p,
  onCancel,
  onConfirmRestore,
  onConfirmCopy,
}: Readonly<{
  confirm: ConfirmState;
  appName: string;
  leaving: string[];
  palette: ReturnType<typeof shellPalette>;
  onCancel: () => void;
  onConfirmRestore: () => void;
  onConfirmCopy: () => void;
}>) {
  const isRestore = confirm.kind === 'restore';
  const title = isRestore ? restoreSheetTitle(confirm.row.version) : copySheetTitle(confirm.row.version);
  const body = isRestore ? restoreSheetBody(confirm.row.version) : copySheetBody(appName);
  const confirmLabel = isRestore ? COPY.historyRestoreConfirm : COPY.historyCopyConfirm;

  return (
    <>
      <Text style={[TYPE_SCALE.screenTitle, { color: p.text }]}>{title}</Text>
      <Text style={[TYPE_SCALE.body, { color: p.textMuted, marginTop: SPACING.xs }]}>{body}</Text>
      {isRestore && leaving.length > 0 && (
        <Text style={[TYPE_SCALE.caption, { color: p.textMuted, marginTop: SPACING.xs }]}>{COPY.historyReassurance}</Text>
      )}
      <TouchableOpacity onPress={onCancel} style={[styles.sheetSafeBtn, { backgroundColor: p.text }]}>
        <Text style={[TYPE_SCALE.bodyEmphatic, { color: p.onAccent }]}>{COPY.cancel}</Text>
      </TouchableOpacity>
      <TouchableOpacity onPress={isRestore ? onConfirmRestore : onConfirmCopy} style={styles.sheetConsequentialBtn}>
        <Text style={[TYPE_SCALE.body, { color: p.textMuted }]}>{confirmLabel}</Text>
      </TouchableOpacity>
    </>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  // Design :23 — a 42x42 circular button, no text label. There is no SVG library in this app, so
  // the chevron is a 10x10 box wearing two borders, rotated 45°. RN renders square line-caps where
  // the design asks for round ones; that is an accepted, unavoidable gap, NOT something to
  // compensate for with a different stroke width.
  backBtn: {
    width: 42,
    height: 42,
    borderRadius: RADIUS.chip,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  backChevron: {
    width: 10,
    height: 10,
    borderLeftWidth: 2.4,
    borderBottomWidth: 2.4,
    transform: [{ rotate: '45deg' }],
    marginLeft: 2,
  },
  // Design :24's `min-width:0`: without it a long app name pushes the title past the now
  // fixed-width back button instead of wrapping inside the header.
  headerText: { flex: 1 },
  subtitle: { marginTop: 2 },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm },
  pill: { borderRadius: RADIUS.chip, borderWidth: 1, paddingHorizontal: SPACING.sm, paddingVertical: 6 },
  list: { paddingHorizontal: SPACING.md, paddingBottom: 40 },
  // The row's inter-row gap is PADDING, not margin, so the absolute timeline segment spans it and
  // meets the next row's segment (design :30). That continuity is guaranteed, not hoped for:
  // Yoga's inset path (`ReactCommon/yoga/yoga/algorithm/AbsoluteLayout.cpp`,
  // `positionAbsoluteChild`, and the both-insets sizing beneath it) resolves a child that defines
  // its insets as inset + the containing node's BORDER + margin, never consulting padding and with
  // no errata check at all. Padding only enters for an absolute child that defines NO inset —
  // that is the case `Errata::AbsolutePositionWithoutInsetsExcludesPadding` is named after, and
  // the only case where border-box-vs-padding-box resolution is version-dependent. `rowWrap` has
  // no border, so `{top: 0, bottom: 0}` covers its full measured height, the 10px included.
  // The 26px gutter clearing the dot therefore did NOT have to live on the flow children
  // (`card`, `currentMarker`) as `marginLeft` — `paddingLeft: 26` here would render identically,
  // matching the design's own CSS. It stays as-is because it is correct and churn is not free.
  rowWrap: { paddingBottom: 10 },
  // 12.75 + 1.5/2 = 13.5, the dot's centre line (design :28).
  timeline: { position: 'absolute', left: 12.75, width: 1.5 },
  // 2.5 + 22/2 = 13.5 across, 10.5 + 22/2 = 21.5 down — the same centre. The 19px paper-coloured
  // interior is what makes the line appear to pass behind the dot (design :31's
  // `box-shadow: 0 0 0 4px #fbfaf8`); the 1.5px border is the ring outside it.
  marker: {
    position: 'absolute',
    left: 2.5,
    top: 10.5,
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  markerDot: { width: 11, height: 11, borderRadius: 6 },
  // 14/15 is design :32; no SPACING step matches, so it stays a cited literal (ruling R9).
  card: { borderRadius: RADIUS.card, borderWidth: 1, marginLeft: 26, paddingVertical: 14, paddingHorizontal: 15 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  versionLabel: { marginLeft: 'auto' },
  originLine: { marginTop: 4 },
  headline: { marginTop: 4 },
  installLabel: { marginTop: 4, fontStyle: 'italic' },
  currentMarker: { marginTop: 8, marginLeft: 26 },
  kindBadge: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  expandedBody: { marginTop: SPACING.sm, paddingTop: SPACING.sm, borderTopWidth: StyleSheet.hairlineWidth },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  chip: { borderRadius: 8, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 6 },
  actionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: SPACING.sm },
  actionBtn: { borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10 },
  actionBtnSecondary: { backgroundColor: 'transparent', borderWidth: 1 },
  actionBtnLabel: { fontWeight: '600' },
  // Design :73 — dark ink face, white text, no border. `16` is deliberate and has no RADIUS step
  // between `field` (14) and `card` (18); do not "correct" it to a token.
  toast: { position: 'absolute', left: 24, right: 24, bottom: 34, borderRadius: 16, paddingVertical: 13, paddingHorizontal: 16 },
  scrim: { flex: 1, backgroundColor: 'rgba(24,22,20,0.5)', justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: RADIUS.sheet, borderTopRightRadius: RADIUS.sheet, padding: 24 },
  sheetSafeBtn: { borderRadius: RADIUS.card, height: 56, alignItems: 'center', justifyContent: 'center', marginTop: SPACING.lg },
  sheetConsequentialBtn: { height: 46, alignItems: 'center', justifyContent: 'center' },
});
