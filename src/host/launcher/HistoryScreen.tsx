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
// Tapping a row EXPANDS it (never changes the version); at most one row is open. Its actions act at
// once, with Undo instead of a question (decision #75, "undo over are you sure"): "Use this version"
// makes it current and offers Undo in the toast, and the version it left stays listed, so the same
// Undo is a row away once the toast has gone; "Make a copy from here" asks only "Copy the data, or
// start fresh?" (`CopyQuestionSheet`, the one Home asks) and offers Open. Before either, the open row
// says when going there would hide saved data. The summary and the expanded result are agent prose
// and render through the one shared `WhimProse` renderer; everything else is product copy and is
// never marked (Whim Syntax rule 7).
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Pressable, Text as RNText, View } from 'react-native';
import type { SummaryKind, SummaryMark } from '@whim/contract';
import { LAYOUT, RADII, SPACE, TINTS, TYPE_SCALE, type ColorRole, type TypeToken } from '../../design/tokens';
import type { IconName } from '../../design/icons/names';
import { InstalledApp } from './app-index';
import { annotationBetween, buildHistoryRows, fieldsLeavingViewOnRestore, listVersions, type HistoryRow } from './history-logic';
import type { ForkOptions, StoreAccess } from './store-access';
import { addedFieldsLine, COPY, historyVersionCount, versionSwitchToast } from './copy';
import {
  HISTORY_LOADING,
  RESTORE_DIFF_NONE,
  restoreDiffLine,
  RowActionFlight,
  runHistoryLoad,
  runRowAction,
  type HistoryLoadState,
  type RestoreDiffState,
} from './history-wait';
import { CopyQuestionSheet } from './CopyQuestionSheet';
import { tileOf } from './tile-identity';
import { useSystemBack } from './use-system-back';
import WhimProse from '../ui/whim-prose/WhimProse';
import { TilePlate } from '../ui/AppTile';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { BackButton } from '../ui/IconButton';
import { Skeleton, SkeletonBlock } from '../ui/Skeleton';
import { Text, wrappingType } from '../ui/Text';
import { useToast } from '../ui/Toast';
import { useTokens } from '../ui/tokens';
import { ICON_BUTTON, makeStyles, MAX_FONT_SCALE, type ShellTokens } from '../ui/tokens-pure';
import { haptics } from '../haptics';
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
  /** Whether "Make a copy from here" can copy the data (`StoreAccess.canCopyData`). When false the
   *  copy starts fresh at once, with no question. */
  canCopyData?: boolean;
  /** Makes a copy of `app` from `versionId` with its own storage (`StoreAccess.fork`): the new entry,
   *  or `null` when that app is busy with something else and nothing started; rejects when nothing
   *  was made. */
  onFork: (app: InstalledApp, versionId: string, opts: ForkOptions) => Promise<InstalledApp | null>;
  /** Opens an app: the copy the "Copy made" toast names. */
  onOpen: (app: InstalledApp) => void;
}

/** The row action in flight, which shows its busy words. */
type RowBusy = { id: string; action: 'use-version' | 'make-copy' } | null;

function historyOperationFailed(operation: 'list' | 'hidden-data' | 'annotation' | 'use-version' | 'undo' | 'copy', e?: unknown): void {
  log.warn(CHANNELS.app, 'history operation failed', { operation, ...(e === undefined ? {} : { detail: e instanceof Error ? e.message : String(e) }) });
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
    // A row's words sit in the same place open or closed: a closed row keeps the open card's side
    // padding, and the card reaches up by its top padding, so it grows around the words instead of
    // pushing them in.
    flat: { paddingTop: ROW_TOP, paddingHorizontal: CARD_PADDING.horizontal },
    card: {
      marginTop: ROW_TOP - CARD_PADDING.vertical,
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
    hiddenData: { marginTop: SPACE[3] },
    hiddenDataPending: {
      height: TYPE_SCALE.footnote.lineHeight,
      width: '76%' as const,
      borderRadius: RADII.xs.radius,
      marginTop: SPACE[3],
      backgroundColor: t.colors['fill-strong'],
    },
    skeletonRow: {
      paddingLeft: RAIL.content + CARD_PADDING.horizontal,
      paddingRight: LAYOUT.gutter + CARD_PADDING.horizontal,
      paddingBottom: ROW_GAP,
      paddingTop: ROW_TOP,
      gap: SPACE[1],
    },
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

export default function HistoryScreen({ app, access, onBack, onChangeIt, onReport, canCopyData = false, onFork, onOpen }: Readonly<HistoryScreenProps>) {
  const t = useTokens();
  const s = styles(t);
  const toast = useToast();
  const { tint, icon } = tileOf(app);
  const nameColor = TINTS[tint][t.scheme];

  // One state object rather than three: `loading`, the snapshot list and the active id all land
  // together from `runHistoryLoad`, so they can never be read half-applied (an empty list with
  // `loading` already false is exactly the fake-empty flash this screen had).
  const [{ loading, snapshots, activeId }, setLoad] = useState<HistoryLoadState>(HISTORY_LOADING);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // The row actions' double-submit guard, shared by Use this version, its Undo and Make a copy. A
  // ref, not state: two taps inside one frame both read the same rendered busy value, so only a
  // synchronous claim can refuse the second.
  const flight = useRef(new RowActionFlight()).current;
  const [busy, setBusy] = useState<RowBusy>(null);
  // Whether the copy question is open, and the row it was asked for. The first answer takes the row,
  // so a second tap on an answer (the sheet is still on screen as it slides away, and the first copy
  // may already be made) answers nothing: a ref, for the same reason as `flight`.
  const [asking, setAsking] = useState(false);
  const asked = useRef<HistoryRow | null>(null);
  // An Undo tapped while another row action ran: it runs once that one has settled, never dropped.
  const queuedUndo = useRef<string | null>(null);

  const load = () =>
    runHistoryLoad(async () => {
      const [list, active] = await Promise.all([listVersions(access, app), access.activeId(app)]);
      return { snapshots: list, activeId: active };
    }, setLoad);
  const reload = () =>
    load().catch((e) => {
      historyOperationFailed('list', e);
    });

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [access, app]);

  useSystemBack(onBack);

  const rows = useMemo(() => buildHistoryRows(snapshots, activeId), [snapshots, activeId]);
  const proseApps = useMemo(() => [{ name: app.name, color: nameColor }], [app.name, nameColor]);

  const busyFor = (row: HistoryRow, action: 'use-version' | 'make-copy') => (on: boolean) => setBusy(on ? { id: row.id, action } : null);

  /** Undo: back to the version that was current before "Use this version". It needs no toast: the
   *  rows say where the app is. Once the toast has gone, the same version's own row does this. */
  const undo = async (previousId: string) => {
    try {
      if (!(await runRowAction(flight, () => {}, () => access.rollback(app, previousId)))) {
        // Another row action runs (a copy being made): this Undo goes once it has settled.
        queuedUndo.current = previousId;
        return;
      }
    } catch (e) {
      historyOperationFailed('undo', e);
      toast.show({ message: COPY.undoTooLateToast });
    }
    await reload();
    runQueuedUndo();
  };

  /** A row action has settled: the Undo tapped meanwhile, if any, runs now. */
  const runQueuedUndo = () => {
    const previousId = queuedUndo.current;
    queuedUndo.current = null;
    if (previousId !== null) undo(previousId);
  };

  /** "Use this version": current at once, then the toast with Undo, saying which way the app went. */
  const switchVersion = async (row: HistoryRow) => {
    const previousId = activeId;
    const from = rows.find((r) => r.isCurrent)?.number ?? null;
    try {
      if (!(await runRowAction(flight, busyFor(row, 'use-version'), () => access.rollback(app, row.id)))) return;
    } catch (e) {
      historyOperationFailed('use-version', e);
      haptics.play('failure');
      toast.show({ message: COPY.historyUseVersionFailed });
      await reload();
      runQueuedUndo();
      return;
    }
    await reload();
    haptics.play('success');
    toast.show({
      message: versionSwitchToast(row.number, from),
      ...(previousId == null ? {} : { action: { label: COPY.toastUndo, onPress: () => undo(previousId) } }),
    });
    runQueuedUndo();
  };

  /** Makes the copy from `row`'s version with the chosen data, then "Copy made" with Open. */
  const makeCopy = async (row: HistoryRow, data: ForkOptions['data']) => {
    const result: { made: InstalledApp | null } = { made: null };
    try {
      const ran = await runRowAction(flight, busyFor(row, 'make-copy'), async () => {
        result.made = await onFork(app, row.id, { data });
      });
      if (!ran) return;
    } catch (e) {
      historyOperationFailed('copy', e);
      haptics.play('failure');
      toast.show({ message: COPY.copyFailedToast });
      runQueuedUndo();
      return;
    }
    const { made } = result;
    if (made) {
      haptics.play('success');
      toast.show({ message: COPY.copyMadeToast, action: { label: COPY.actionOpen, onPress: () => onOpen(made) } });
    }
    runQueuedUndo();
  };

  const askCopy = (row: HistoryRow) => {
    if (flight.inFlight) return;
    if (canCopyData) {
      asked.current = row;
      setAsking(true);
    } else {
      makeCopy(row, 'fresh');
    }
  };

  /** The copy question's answer, taken once per question. */
  const answerCopy = (data: ForkOptions['data']) => {
    const row = asked.current;
    asked.current = null;
    setAsking(false);
    if (row) makeCopy(row, data);
  };

  const leaveQuestion = () => {
    asked.current = null;
    setAsking(false);
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
      activeId={activeId}
      expanded={item.id === expandedId}
      busy={busy?.id === item.id ? busy.action : null}
      isFirst={index === 0}
      isLast={index === rows.length - 1}
      onToggle={() => setExpandedId(prev => (prev === item.id ? null : item.id))}
      onChangeIt={() => onChangeIt?.(app)}
      onUseVersion={() => switchVersion(item)}
      onMakeCopy={() => askCopy(item)}
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
      </React.Fragment>

      <CopyQuestionSheet
        visible={asking}
        appName={app.name}
        onCopyData={() => answerCopy('copy')}
        onStartFresh={() => answerCopy('fresh')}
        onClose={leaveQuestion}
      />
    </View>
  );
}

interface HistoryRowViewProps {
  row: HistoryRow;
  app: InstalledApp;
  access: StoreAccess;
  proseApps: { name: string; color: string }[];
  predecessorId: string | undefined;
  /** The current version, which the hidden-data line compares this row's version with. */
  activeId: string | null;
  expanded: boolean;
  /** This row's action in flight, which shows its busy words. */
  busy: 'use-version' | 'make-copy' | null;
  /** Rail terminators: the newest row's segment starts at its dot, v1's ends there, and a lone row
   *  draws no rail at all. */
  isFirst: boolean;
  isLast: boolean;
  onToggle: () => void;
  onChangeIt: () => void;
  onUseVersion: () => void;
  onMakeCopy: () => void;
}

function HistoryRowView({
  row,
  app,
  access,
  proseApps,
  predecessorId,
  activeId,
  expanded,
  busy,
  isFirst,
  isLast,
  onToggle,
  onChangeIt,
  onUseVersion,
  onMakeCopy,
}: Readonly<HistoryRowViewProps>) {
  const t = useTokens();
  const s = styles(t);
  const [annotationFields, setAnnotationFields] = useState<string[]>([]);
  const [hiddenData, setHiddenData] = useState<RestoreDiffState>(RESTORE_DIFF_NONE);
  const chip = row.kind ? KIND_CHIP[row.kind] : null;

  // Whether going to this version would hide saved data, asked when the row opens: said before
  // either action is tapped, since both act at once.
  useEffect(() => {
    if (!expanded || row.isCurrent || activeId == null) {
      setHiddenData(RESTORE_DIFF_NONE);
      return;
    }
    let cancelled = false;
    setHiddenData({ status: 'pending' });
    fieldsLeavingViewOnRestore(access, app, row.id, activeId)
      .then(fields => {
        if (!cancelled) setHiddenData({ status: 'ready', fields });
      })
      .catch((e) => {
        if (!cancelled) {
          setHiddenData(RESTORE_DIFF_NONE);
          historyOperationFailed('hidden-data', e);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [expanded, row.isCurrent, activeId, access, app, row.id]);

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
            {/* Product copy, not agent prose: no mark, and never fainter than `text-2`. */}
            {annotationFields.length > 0 && (
              <Text type="footnote" color="text-2">
                {addedFieldsLine(annotationFields)}
              </Text>
            )}
            <HiddenDataLine diff={hiddenData} />
            <View style={s.actions}>
              {row.actions.includes('change-it') && <Button label={COPY.actionChangeIt} variant="ember" size="medium" onPress={onChangeIt} />}
              {row.actions.includes('use-version') && (
                <Button
                  label={COPY.historyUseVersion}
                  variant="secondary"
                  size="medium"
                  busy={busy === 'use-version' ? COPY.historyUseVersionBusy : undefined}
                  onPress={onUseVersion}
                />
              )}
              {row.actions.includes('make-copy') && (
                <Button
                  label={COPY.historyMakeCopyHere}
                  variant="plain"
                  size="medium"
                  busy={busy === 'make-copy' ? COPY.historyMakeCopyBusy : undefined}
                  onPress={onMakeCopy}
                />
              )}
            </View>
          </View>
        )}
      </View>
    </View>
  );
}

/**
 * An open row's hidden-data line, which resolves IN PLACE: while the diff is being computed a
 * placeholder holds its space, so the actions under it do not move when the sentence arrives (D6 —
 * a placeholder, deliberately not a skeleton: one sentence has no row shape to mimic).
 */
function HiddenDataLine({ diff }: Readonly<{ diff: RestoreDiffState }>) {
  const t = useTokens();
  const s = styles(t);
  const line = restoreDiffLine(diff);
  if (line === 'pending') {
    return <View accessibilityRole="progressbar" accessibilityLabel={COPY.historyReassurancePending} style={s.hiddenDataPending} />;
  }
  if (line === 'reassurance') {
    return (
      <Text type="footnote" color="text-2" style={s.hiddenData}>
        {COPY.historyHiddenData}
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
