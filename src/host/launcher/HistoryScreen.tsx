// ─────────────────────────────────────────────────────────────────────────────
// HistoryScreen — every version of an app on one timeline (version-history spec; system.md §9
// History, §7.1 Timeline row; design-system-v1 task 20.1).
// ─────────────────────────────────────────────────────────────────────────────
// A pushed screen on the native stack with the anatomy of §2.8: a 44 pt header row with the back
// control and the `Report` text button, then "History" in `title1`, the app's 40 pt tile, its name
// in its tint and how many versions it has. Its own header, not the platform's: History's Back and
// system back are bound apart from a swipe (`handoff/navigation.md` "History's leave"), so the
// visible back control is the shell's. Colours follow the phone through `useTokens()`: History is a
// host screen, never the frame of the app it was opened over. Every text is capped at 200%.
//
// One row per version, newest first, on a rail that stops at v1: the person's words quoted (italic
// `title3`, the hero), Whim's summary, "v4 · 2 days ago" in tabular figures, a neutral kind chip
// with its icon and `Current` on the active version. No filters. All store access goes through
// `StoreAccess`; the row model lives in `history-logic.ts`, Node-testable without this component.
//
// Tapping a row EXPANDS it (never restores); at most one row is open. Restoring and forking are
// explicit actions inside the open row, each behind a confirm sheet whose safe option is the large
// button. The summary and the expanded result are agent prose and render through the one shared
// `WhimProse` renderer; everything else is product copy and is never marked (Whim Syntax rule 7).
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Pressable, Text as RNText, View } from 'react-native';
import type { SummaryKind, SummaryMark } from '@whim/contract';
import { LAYOUT, RADII, SPACE, TINTS, TYPE_SCALE, type ColorRole, type TypeToken } from '../../design/tokens';
import type { IconName } from '../../design/icons/names';
import { InstalledApp } from './app-index';
import { annotationBetween, buildHistoryRows, fieldsLeavingViewOnRestore, listVersions, type HistoryRow } from './history-logic';
import { StoreAccess } from './store-access';
import { addedFieldsLine, COPY, copySheetBody, copySheetTitle, historyVersionCount, restoreSheetBody, restoreSheetTitle, restoredToast } from './copy';
import {
  ConfirmFlight,
  HISTORY_LOADING,
  RESTORE_DIFF_NONE,
  restoreDiffLine,
  runConfirmOp,
  runHistoryLoad,
  type HistoryLoadState,
  type RestoreDiffState,
} from './history-wait';
import ConfirmSheet, { type ConfirmSheetContent } from './ConfirmSheet';
import { tileOf } from './tile-identity';
import { useSystemBack } from './use-system-back';
import WhimProse from '../ui/whim-prose/WhimProse';
import { TilePlate } from '../ui/AppTile';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { BackButton } from '../ui/IconButton';
import { Skeleton, SkeletonBlock } from '../ui/Skeleton';
import { Text, wrappingType } from '../ui/Text';
import { useTokens } from '../ui/tokens';
import { ICON_BUTTON, makeStyles, MAX_FONT_SCALE, type ShellTokens } from '../ui/tokens-pure';
import { log } from '../logging';
import { CHANNELS } from '../logging/channels';

export interface HistoryScreenProps {
  app: InstalledApp;
  access: StoreAccess;
  /** Leaves History, for where it was opened from: the app it was opened over, or Home. */
  onBack: () => void;
  /** Opens the compose step scoped to `app`: the current version's one action. */
  onChangeIt?: (app: InstalledApp) => void;
  /** Opens the report screen for the version the user is currently on (content-reporting
   *  "Reporting from history"): the header's text button; no row gains one. */
  onReport: () => void;
}

interface ConfirmState {
  kind: 'restore' | 'copy';
  row: HistoryRow;
}

const TOAST_TIMEOUT_MS = 2200;

function historyOperationFailed(operation: 'list' | 'restore-diff' | 'annotation'): void {
  log.warn(CHANNELS.app, 'history operation failed', { operation });
}

/** §7.1 Timeline row: the rail's centre line (x = 27 from the screen's edge), its 2 pt width, the
 *  10 pt dot on it with a 3 pt `bg` ring, and where the row's content starts. */
const RAIL = { centre: 27, width: 2, dot: 10, ring: 3, content: 44 } as const;
/** How far a collapsed row's words sit below its top, and an open card's padding. */
const ROW_TOP = 2;
const CARD_PADDING = { vertical: 14, horizontal: LAYOUT.cardPadding } as const;
/** The space between one row and the next, which the rail spans. */
const ROW_GAP = 22;
/** How many placeholder rows the first load draws. The real count is not known until the read
 *  resolves, so this is a shape hint, not a prediction. */
const HISTORY_SKELETON_ROWS = 3;

/** The dot's centre, down from the row's top: on the middle of the words' first line, at the
 *  phone's text size up to the 200% cap. */
function dotCentre(t: ShellTokens): number {
  return ROW_TOP + (TYPE_SCALE.title3.lineHeight * Math.min(t.fontScale, MAX_FONT_SCALE)) / 2;
}

/** Where a row's rail segment begins and ends: an interior row's spans the whole row, the newest
 *  row's drops from its dot, v1's comes down to its dot and stops. A list of one has no rail — the
 *  caller checks that, since there is no extent that expresses "absent". */
function railExtent(isFirst: boolean, isLast: boolean, centre: number) {
  if (isFirst) return { top: centre, bottom: 0 };
  if (isLast) return { top: 0, height: centre };
  return { top: 0, bottom: 0 };
}

const KIND_CHIP: Record<SummaryKind, { label: string; icon: IconName }> = {
  Start: { label: COPY.historyKindStart, icon: 'flag' },
  Added: { label: COPY.historyKindAdded, icon: 'plus' },
  Changed: { label: COPY.historyKindChanged, icon: 'pencil' },
  Removed: { label: COPY.historyKindRemoved, icon: 'minus' },
  Look: { label: COPY.historyKindLook, icon: 'palette' },
  Fixed: { label: COPY.historyKindFixed, icon: 'wrench' },
};

const styles = makeStyles((t) => {
  const centre = dotCentre(t);
  const ringSide = RAIL.dot + 2 * RAIL.ring;
  return {
    root: { flex: 1, backgroundColor: t.colors.bg },
    header: {
      minHeight: LAYOUT.headerRowHeight,
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      justifyContent: 'space-between' as const,
      // The back glyph and the Report label line up with the gutter.
      paddingLeft: LAYOUT.gutter - (ICON_BUTTON.size - 24) / 2,
      paddingRight: LAYOUT.gutter - SPACE[4],
    },
    titleBlock: { paddingHorizontal: LAYOUT.gutter, paddingBottom: LAYOUT.gapTitleToContent },
    appLine: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: SPACE[3], marginTop: SPACE[3] },
    appNames: { flex: 1 },
    list: { paddingBottom: SPACE[10] },
    row: { paddingLeft: RAIL.content, paddingRight: LAYOUT.gutter, paddingBottom: ROW_GAP },
    rail: { position: 'absolute' as const, left: RAIL.centre - RAIL.width / 2, width: RAIL.width, backgroundColor: t.colors.separator },
    ring: {
      position: 'absolute' as const,
      left: RAIL.centre - ringSide / 2,
      top: centre - ringSide / 2,
      width: ringSide,
      height: ringSide,
      borderRadius: ringSide / 2,
      backgroundColor: t.colors.bg,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
    },
    dot: { width: RAIL.dot, height: RAIL.dot, borderRadius: RAIL.dot / 2, backgroundColor: t.colors.border },
    dotCurrent: { backgroundColor: t.colors.ink },
    flat: { paddingTop: ROW_TOP },
    card: {
      marginTop: ROW_TOP,
      borderRadius: RADII.lg.radius,
      backgroundColor: t.colors.surface,
      paddingVertical: CARD_PADDING.vertical,
      paddingHorizontal: CARD_PADDING.horizontal,
    },
    summary: { marginTop: SPACE[1] },
    meta: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, alignItems: 'center' as const, gap: SPACE[2], marginTop: SPACE[2] },
    chip: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      gap: SPACE[1],
      paddingHorizontal: SPACE[2],
      paddingVertical: 2,
      borderRadius: RADII.full.radius,
      backgroundColor: t.colors.fill,
    },
    current: { paddingHorizontal: SPACE[2], paddingVertical: 2, borderRadius: RADII.full.radius, backgroundColor: t.colors.ink },
    expanded: { marginTop: SPACE[3] },
    touched: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: SPACE[2], marginTop: SPACE[1] },
    actions: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: SPACE[2], marginTop: SPACE[3] },
    reassurance: { marginTop: SPACE[1] },
    reassurancePending: {
      height: TYPE_SCALE.footnote.lineHeight,
      width: '76%' as const,
      borderRadius: RADII.xs.radius,
      marginTop: SPACE[1],
      backgroundColor: t.colors['fill-strong'],
    },
    toast: {
      position: 'absolute' as const,
      left: LAYOUT.gutter,
      right: LAYOUT.gutter,
      bottom: SPACE[8],
      borderRadius: RADII.full.radius,
      paddingVertical: SPACE[3],
      paddingHorizontal: SPACE[4],
      backgroundColor: t.colors.ink,
    },
    skeletonRow: { paddingLeft: RAIL.content, paddingRight: LAYOUT.gutter, paddingBottom: ROW_GAP, paddingTop: ROW_TOP, gap: SPACE[1] },
  };
});

/** Agent prose on the type scale, capped at 200% like every shell text: the cap is set on a text
 *  around the renderer's own, which a nested text takes from its parent. */
function Prose({
  text,
  marks,
  storedPrompt,
  apps,
  type,
  color,
}: Readonly<{ text: string; marks: SummaryMark[]; storedPrompt: string; apps: { name: string; color: string }[]; type: TypeToken; color: ColorRole }>) {
  const t = useTokens();
  const face = { ...wrappingType(type), color: t.colors[color] };
  return (
    <RNText style={face} maxFontSizeMultiplier={MAX_FONT_SCALE}>
      <WhimProse text={text} apps={apps} storedPrompt={storedPrompt} marks={marks} style={face} />
    </RNText>
  );
}

export default function HistoryScreen({ app, access, onBack, onChangeIt, onReport }: Readonly<HistoryScreenProps>) {
  const t = useTokens();
  const s = styles(t);
  const { tint, icon } = tileOf(app);
  const nameColor = TINTS[tint][t.scheme];

  // One state object rather than three: `loading`, the snapshot list and the active id all land
  // together from `runHistoryLoad`, so they can never be read half-applied (an empty list with
  // `loading` already false is exactly the fake-empty flash this screen had).
  const [{ loading, snapshots, activeId }, setLoad] = useState<HistoryLoadState>(HISTORY_LOADING);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [restoreDiff, setRestoreDiff] = useState<RestoreDiffState>(RESTORE_DIFF_NONE);
  // The confirm sheet's double-submit guard. A ref, not state: two taps inside one frame both read
  // the same rendered `disabled` value, so only a synchronous claim can refuse the second.
  const confirmFlight = useRef(new ConfirmFlight()).current;
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = () =>
    runHistoryLoad(async () => {
      const [list, active] = await Promise.all([listVersions(access, app), access.activeId(app)]);
      return { snapshots: list, activeId: active };
    }, setLoad);

  useEffect(() => {
    load().catch(() => {
      historyOperationFailed('list');
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [access, app]);

  useSystemBack(onBack);

  useEffect(() => {
    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, []);

  useEffect(() => {
    if (confirm?.kind !== 'restore' || activeId == null) {
      setRestoreDiff(RESTORE_DIFF_NONE);
      return;
    }
    setRestoreDiff({ status: 'pending' });
    let cancelled = false;
    fieldsLeavingViewOnRestore(access, app, confirm.row.id, activeId)
      .then(fields => {
        if (!cancelled) setRestoreDiff({ status: 'ready', fields });
      })
      .catch(() => {
        if (!cancelled) {
          setRestoreDiff(RESTORE_DIFF_NONE);
          historyOperationFailed('restore-diff');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [confirm, access, app, activeId]);

  const rows = useMemo(() => buildHistoryRows(snapshots, activeId), [snapshots, activeId]);
  const proseApps = useMemo(() => [{ name: app.name, color: nameColor }], [app.name, nameColor]);

  const showToast = (text: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(text);
    toastTimer.current = setTimeout(() => setToast(null), TOAST_TIMEOUT_MS);
  };

  const confirmRestore = async () => {
    if (!confirm) return;
    const { row } = confirm;
    const ran = await runConfirmOp(confirmFlight, setConfirmBusy, () => access.rollback(app, row.id));
    if (!ran) return;
    setConfirm(null);
    await load().catch(() => {
      historyOperationFailed('list');
    });
    showToast(restoredToast(row.version));
  };

  // The sheet stays open for the duration of the fork: the confirmed control itself shows the busy
  // state until the fork completes, which a dismissed sheet cannot do.
  const confirmCopy = async () => {
    if (!confirm) return;
    const { row } = confirm;
    const ran = await runConfirmOp(confirmFlight, setConfirmBusy, () => access.fork(app, row.id));
    if (!ran) return;
    setConfirm(null);
    showToast(COPY.historyCopyToast);
  };

  const titleBlock = (
    <View style={s.titleBlock}>
      <Text type="title1">{COPY.historyTitle}</Text>
      <View style={s.appLine}>
        <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <TilePlate size="menu" state="ready" tint={tint} glyph={icon} />
        </View>
        <View style={s.appNames}>
          <RNText style={{ ...wrappingType('headline'), color: nameColor }} maxFontSizeMultiplier={MAX_FONT_SCALE}>
            {app.name}
          </RNText>
          {/* Its line is kept while the versions are read, so nothing under it moves when they land. */}
          <Text type="footnote" color="text-2">
            {loading ? ' ' : historyVersionCount(rows.length)}
          </Text>
        </View>
      </View>
    </View>
  );

  const renderRow = ({ item, index }: { item: HistoryRow; index: number }) => (
    <HistoryRowView
      row={item}
      app={app}
      access={access}
      proseApps={proseApps}
      predecessorId={snapshots[item.index + 1]?.id}
      expanded={item.id === expandedId}
      isFirst={index === 0}
      isLast={index === rows.length - 1}
      onToggle={() => setExpandedId(prev => (prev === item.id ? null : item.id))}
      onChangeIt={() => onChangeIt?.(app)}
      onGoBack={() => setConfirm({ kind: 'restore', row: item })}
      onStartCopy={() => setConfirm({ kind: 'copy', row: item })}
    />
  );

  return (
    <View style={s.root}>
      {/* Keyed by the text size, as a sheet's frame is: iOS keeps every text measured at the size it
          was first laid out at, so a size changed while History shows left the title and the rows cut
          to pieces. What History holds (the versions, the open row, an open question) is state above
          this and survives; the list's scroll position starts again. */}
      <React.Fragment key={t.fontScale}>
        <View style={s.header}>
          <BackButton onPress={onBack} />
          <Button label={COPY.historyReportAction} variant="plain" size="small" onPress={onReport} />
        </View>

        {loading ? (
          <View>
            {titleBlock}
            <HistoryLoadingRows />
          </View>
        ) : (
          <FlatList
            data={rows}
            keyExtractor={row => row.id}
            renderItem={renderRow}
            ListHeaderComponent={titleBlock}
            contentContainerStyle={s.list}
          />
        )}

        {toast && (
          <View style={s.toast}>
            <Text type="callout" color="on-ink">
              {toast}
            </Text>
          </View>
        )}
      </React.Fragment>

      {/* The confirm sheet (E7/D11): the SAFE option (`Cancel`) is the large, full-width button; the
          consequential action is demoted to plain text beneath it — never the other way around. */}
      <ConfirmSheet
        confirm={confirm && confirmContent(confirm, app.name)}
        busy={confirmBusy}
        onCancel={() => setConfirm(null)}
        onConfirm={confirm?.kind === 'restore' ? confirmRestore : confirmCopy}
      >
        {confirm?.kind === 'restore' && <RestoreReassurance diff={restoreDiff} />}
      </ConfirmSheet>
    </View>
  );
}

interface HistoryRowViewProps {
  row: HistoryRow;
  app: InstalledApp;
  access: StoreAccess;
  proseApps: { name: string; color: string }[];
  predecessorId: string | undefined;
  expanded: boolean;
  /** Rail terminators: the newest row's segment starts at its dot, v1's ends there, and a lone row
   *  draws no rail at all. */
  isFirst: boolean;
  isLast: boolean;
  onToggle: () => void;
  onChangeIt: () => void;
  onGoBack: () => void;
  onStartCopy: () => void;
}

function HistoryRowView({
  row,
  app,
  access,
  proseApps,
  predecessorId,
  expanded,
  isFirst,
  isLast,
  onToggle,
  onChangeIt,
  onGoBack,
  onStartCopy,
}: Readonly<HistoryRowViewProps>) {
  const t = useTokens();
  const s = styles(t);
  const [annotationFields, setAnnotationFields] = useState<string[]>([]);
  const chip = row.kind ? KIND_CHIP[row.kind] : null;

  useEffect(() => {
    if (!expanded || predecessorId == null) {
      setAnnotationFields([]);
      return;
    }
    let cancelled = false;
    setAnnotationFields([]);
    annotationBetween(access, app, predecessorId, row.id)
      .then(fields => {
        if (!cancelled) setAnnotationFields(fields);
      })
      .catch(() => {
        if (!cancelled) {
          setAnnotationFields([]);
          historyOperationFailed('annotation');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [expanded, predecessorId, access, app, row.id]);

  // The person's words are the hero, in the italic that marks them as theirs; a version made with
  // no words of theirs leads with Whim's summary instead, upright.
  const words =
    row.promptText.length > 0 ? (
      <Text type="title3" italic>
        {row.headline}
      </Text>
    ) : (
      <Prose text={row.headline} marks={row.marks} storedPrompt={row.promptText} apps={proseApps} type="title3" color="text" />
    );
  let summary: React.ReactNode = null;
  if (row.result) {
    summary = <Prose text={row.result.text} marks={row.result.marks} storedPrompt={row.promptText} apps={proseApps} type="callout" color="text-2" />;
  } else if (row.isInstall) {
    summary = (
      <Text type="callout" color="text-2">
        {COPY.historyInstallLabel}
      </Text>
    );
  }

  return (
    <View style={s.row}>
      {!(isFirst && isLast) && <View style={[s.rail, railExtent(isFirst, isLast, dotCentre(t))]} />}
      <View style={s.ring}>
        <View style={[s.dot, row.isCurrent && s.dotCurrent]} />
      </View>
      <View style={expanded ? s.card : s.flat}>
        <Pressable onPress={onToggle} accessibilityRole="button" accessibilityState={{ expanded }}>
          {words}
          {summary && <View style={s.summary}>{summary}</View>}
          <View style={s.meta}>
            <Text type="footnote" color="text-2" tabular>
              {row.meta}
            </Text>
            {chip && (
              <View style={s.chip}>
                <Icon name={chip.icon} size={12} color={t.colors['text-2']} />
                <Text type="caption" color="text-2">
                  {chip.label}
                </Text>
              </View>
            )}
            {row.isCurrent && (
              <View style={s.current}>
                <Text type="caption" color="on-ink">
                  {COPY.historyCurrent}
                </Text>
              </View>
            )}
          </View>
        </Pressable>

        {expanded && (
          <View style={s.expanded}>
            {row.touched.length > 0 && (
              <>
                <Text type="footnote" color="text-2" header>
                  {COPY.historyTouchedEyebrow}
                </Text>
                <View style={s.touched}>
                  {row.touched.map(area => (
                    <View key={area} style={s.chip}>
                      <Text type="caption" color="text-2">
                        {area}
                      </Text>
                    </View>
                  ))}
                </View>
              </>
            )}
            {annotationFields.length > 0 && (
              <Prose
                text={addedFieldsLine(annotationFields)}
                marks={[{ cls: 'hedge', start: 0, end: addedFieldsLine(annotationFields).length }]}
                storedPrompt={row.promptText}
                apps={proseApps}
                type="footnote"
                color="text-2"
              />
            )}
            <View style={s.actions}>
              {row.actions.includes('change-from-here') && <Button label={COPY.historyChangeFromHere} variant="ember" size="medium" onPress={onChangeIt} />}
              {row.actions.includes('go-back') && <Button label={COPY.historyGoBackToThis} variant="secondary" size="medium" onPress={onGoBack} />}
              {row.actions.includes('start-copy') && <Button label={COPY.historyStartCopyHere} variant="plain" size="medium" onPress={onStartCopy} />}
            </View>
          </View>
        )}
      </View>
    </View>
  );
}

/** What the restore or copy confirm says about `confirm`'s row. */
function confirmContent(confirm: ConfirmState, appName: string): ConfirmSheetContent {
  const version = confirm.row.version;
  return confirm.kind === 'restore'
    ? { title: restoreSheetTitle(version), body: restoreSheetBody(version), confirmLabel: COPY.historyRestoreConfirm, busyLabel: COPY.historyRestoreConfirmBusy }
    : { title: copySheetTitle(version), body: copySheetBody(appName), confirmLabel: COPY.historyCopyConfirm, busyLabel: COPY.historyCopyConfirmBusy };
}

/**
 * The restore confirm's reassurance line, which resolves IN PLACE: while the diff is being computed
 * a placeholder holds its space, so the sheet does not reflow when the sentence arrives (D6 — a
 * placeholder, deliberately not a skeleton: one sentence has no row shape to mimic).
 */
function RestoreReassurance({ diff }: Readonly<{ diff: RestoreDiffState }>) {
  const t = useTokens();
  const s = styles(t);
  const line = restoreDiffLine(diff);
  if (line === 'pending') {
    return <View accessibilityRole="progressbar" accessibilityLabel={COPY.historyReassurancePending} style={s.reassurancePending} />;
  }
  if (line === 'reassurance') {
    return (
      <Text type="footnote" color="text-2" style={s.reassurance}>
        {COPY.historyReassurance}
      </Text>
    );
  }
  return null;
}

/**
 * The first-load timeline (D4 — a true content load whose row shape is already known): the real
 * row's geometry, its dot on the rail and blocks the height of the words, the summary and the meta
 * line. The row COUNT is unknown before the read, so it is a small fixed number that reads as "a
 * list is coming" rather than a promise of how long it is.
 */
function HistoryLoadingRows() {
  const t = useTokens();
  const s = styles(t);
  const scale = Math.min(t.fontScale, MAX_FONT_SCALE);
  return (
    <Skeleton label={COPY.historyLoadingLabel}>
      {Array.from({ length: HISTORY_SKELETON_ROWS }, (_, i) => (
        <View key={`skeleton-${i}`} style={s.skeletonRow}>
          <View style={s.ring}>
            <View style={s.dot} />
          </View>
          <SkeletonBlock width="72%" height={TYPE_SCALE.title3.lineHeight * scale} radius={RADII.xs.radius} />
          <SkeletonBlock width="56%" height={TYPE_SCALE.callout.lineHeight * scale} radius={RADII.xs.radius} />
          <SkeletonBlock width="32%" height={TYPE_SCALE.footnote.lineHeight * scale} radius={RADII.xs.radius} />
        </View>
      ))}
    </Skeleton>
  );
}
