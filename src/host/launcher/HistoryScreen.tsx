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
// Tapping a row EXPANDS it (never changes the version); at most one row is open. M26: it opens and
// closes on `smooth` with the rows below moving, its actions fading in (`RowsMove`). Its actions act at
// once, with Undo instead of a question (decision #75, "undo over are you sure"): "Use this version"
// makes it current and offers Undo in the toast, and the version it left stays listed, so the same
// Undo is a row away once the toast has gone; "Make a copy from here" asks only "Copy the data, or
// start fresh?" (`CopyQuestionSheet`, the one Home asks; skipped, fresh, when the app has saved
// nothing) and offers Open. Before either, the open row says when going there would hide saved data,
// and the question says it again for the data a copy would carry. The summary and the expanded
// result are agent prose and render through the one shared `WhimProse` renderer; everything else is
// product copy and is never marked (Whim Syntax rule 7).
import React, { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Pressable, Text as RNText, View, type FlatListProps } from 'react-native';
import Animated, { Easing, FadeIn, FadeOut, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import type { SummaryKind, SummaryMark } from '@whim/contract';
import { LAYOUT, RADII, SPACE, TINTS, TYPE_SCALE, type ColorRole, type TypeToken } from '../../design/tokens';
import type { IconName } from '../../design/icons/names';
import { InstalledApp } from './app-index';
import { annotationBetween, buildHistoryRows, fieldsLeavingViewOnRestore, listVersions, type HistoryRow } from './history-logic';
import type { ForkOptions, StoreAccess } from './store-access';
import type { SwitchWords } from './version-switches';
import { addedFieldsLine, COPY, historyVersionCount } from './copy';
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
import { copyFailure } from './fork-op';
import { tileOf } from './tile-identity';
import { useSystemBack } from './use-system-back';
import WhimProse from '../ui/whim-prose/WhimProse';
import { REFLOW, TilePlate } from '../ui/AppTile';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { BackButton } from '../ui/IconButton';
import { timing } from '../ui/motion';
import { Skeleton, SkeletonBlock } from '../ui/Skeleton';
import { Text, wrappingType } from '../ui/Text';
import { useToast } from '../ui/Toast';
import { useTokens } from '../ui/tokens';
import { ICON_BUTTON, makeStyles, MAX_FONT_SCALE, springReachMs, timingOf, type ShellTokens } from '../ui/tokens-pure';
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
  /** Whether `app` has saved any data, asked before the copy question: an app with nothing saved is
   *  copied fresh at once, unasked (copy-app-data ruling 3). Resolves `null` when the app is busy
   *  and nothing should happen. The shell asks it in the app's busy slot; omitted, History asks
   *  `access.hasSavedData` itself. */
  hasSavedData?: (app: InstalledApp) => Promise<boolean | null>;
  /** Makes a copy of `app` from `versionId` with its own storage (`StoreAccess.fork`): the new entry,
   *  or `null` when that app is busy with something else and nothing started; rejects when nothing
   *  was made. */
  onFork: (app: InstalledApp, versionId: string, opts: ForkOptions) => Promise<InstalledApp | null>;
  /** Opens an app: the copy the "Copy made" toast names. */
  onOpen: (app: InstalledApp) => void;
  /** Makes `versionId` current, has History `reread` its rows, then offers its Undo back to
   *  `previousId` in the shell's toast, worded from `words`; rejects when the switch failed. The shell
   *  owns that Undo, so it outlives History (`VersionSwitches`). */
  onUseVersion: (app: InstalledApp, versionId: string, words: SwitchWords, previousId: string | null, reread: () => Promise<void>) => Promise<void>;
  /** Changes whenever the shell moved the app's version under History (an Undo): the rows are read again. */
  versionsMoved?: number;
}

/** The row action in flight, which shows its busy words. */
type RowBusy = { id: string; action: 'use-version' | 'make-copy' } | null;

/** What a thrown non-Error is logged as: a primitive as itself, an object by its kind only. */
const thrownText = (e: unknown): string => (e !== null && typeof e === 'object' ?'non-Error object thrown' : String(e));

function historyOperationFailed(operation: 'list' | 'hidden-data' | 'annotation' | 'use-version' | 'copy', e?: unknown): void {
  log.warn(CHANNELS.app, 'history operation failed', { operation, ...(e === undefined ? {} : { detail: e instanceof Error ? e.message : thrownText(e) }) });
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

/** M26: an opened row's actions fade in on `fade-in`, in place; closing, the same path out: they and
 *  the card's fill fade out on `fade-out` as the card shrinks. */
const FADE_IN = timingOf('fadeIn');
const ACTIONS_IN = FadeIn.duration(FADE_IN.duration).easing(Easing.bezier(...FADE_IN.bezier));
const FADE_OUT = timingOf('fadeOut');
const ACTIONS_OUT = FadeOut.duration(FADE_OUT.duration).easing(Easing.bezier(...FADE_OUT.bezier));
const FILL_OUT = timing('fadeOut');
/** How long a move on `smooth` takes to come to rest. */
const SMOOTH_SETTLE_MS = springReachMs('smooth', 0.99);

/** M26: how the rows move as one changes size: on `smooth` (`REFLOW`, a layout transition, which
 *  retargets one still running), or, undefined, at once. Only what the person's own action causes
 *  moves (`usePersonsMove`); under Reduce Motion nothing does. */
const RowsMove = React.createContext<typeof REFLOW | undefined>(undefined);

/** The window in which the rows move: opened by the person's own action (a row opened or closed,
 *  "Use this version", its Undo) and closed once what it changed has come to rest. Outside it, what
 *  arrives or measures on its own (an open row's added-fields or hidden-data line, a late text
 *  measure, a re-read) lands at once. Reanimated registers a view's transition only after the commit
 *  that sets it, so a change of size committed together with it would jump, and one committed
 *  together with its removal would still move: `act`'s change waits for the commit that opened the
 *  window, and the window closes only after its change. `hold` keeps it open until an action's
 *  re-read has landed; one that lands after History has gone starts nothing. */
function usePersonsMove() {
  const [open, setOpen] = useState(false);
  const committed = useRef(false);
  const pending = useRef<(() => void)[]>([]);
  const holds = useRef(0);
  const closing = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const gone = useRef(false);
  const settle = () => {
    clearTimeout(closing.current);
    if (holds.current === 0 && !gone.current) closing.current = setTimeout(() => setOpen(false), SMOOTH_SETTLE_MS);
  };
  useEffect(() => {
    committed.current = open;
    if (!open) return;
    const due = pending.current.splice(0);
    for (const change of due) change();
    if (due.length > 0) settle();
  });
  useEffect(() => {
    gone.current = false;
    return () => {
      gone.current = true;
      clearTimeout(closing.current);
    };
  }, []);
  const act = (change?: () => void) => {
    clearTimeout(closing.current);
    if (committed.current) {
      change?.();
      settle();
    } else if (change) {
      pending.current.push(change);
    }
    setOpen(true);
  };
  const hold = async <T,>(work: () => Promise<T>): Promise<T> => {
    act();
    holds.current += 1;
    try {
      return await work();
    } finally {
      holds.current -= 1;
      settle();
    }
  };
  /** Opens the window with the render under way, for a `hold` its effects start. */
  const opens = () => setOpen(true);
  return { open, act, hold, opens };
}

/** What the list hands each cell it draws through `CellRendererComponent`. */
type HistoryCellProps = Pick<React.ComponentProps<NonNullable<FlatListProps<HistoryRow>['CellRendererComponent']>>, 'children' | 'style' | 'onLayout' | 'onFocusCapture'>;

/** A row's cell in the list, a view of its own on the native side: it moves with `RowsMove` when a
 *  row above it opens or closes. The list hears focus land in it (`onFocusCapture`), as it does in
 *  the cells it draws itself. */
function HistoryCell({ children, style, onLayout, onFocusCapture }: Readonly<HistoryCellProps>) {
  // A View takes `onFocusCapture` (ViewPropTypes.js), which React Native's own TypeScript types leave out.
  const focus: object = { onFocusCapture };
  return (
    <Animated.View style={style} onLayout={onLayout} {...focus} layout={useContext(RowsMove)}>
      {children}
    </Animated.View>
  );
}

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
    // A row's words sit in the same place open or closed: the card, drawn only open, reaches up by
    // its top padding whether drawn or not, so it grows around the words, downward from a top that
    // stays put, instead of pushing them in; growing (M26), it shows only what it has reached.
    card: {
      marginTop: ROW_TOP - CARD_PADDING.vertical,
      borderRadius: RADII.lg.radius,
      paddingTop: CARD_PADDING.vertical,
      paddingHorizontal: CARD_PADDING.horizontal,
      overflow: 'hidden' as const,
    },
    cardOpen: { paddingBottom: CARD_PADDING.vertical },
    // The open card's fill, under its content, its own view so a close can fade it.
    fill: { position: 'absolute' as const, top: 0, right: 0, bottom: 0, left: 0, backgroundColor: t.colors.surface },
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

export default function HistoryScreen({ app, access, onBack, onChangeIt, onReport, canCopyData = false, hasSavedData, onFork, onOpen, onUseVersion, versionsMoved = 0 }: Readonly<HistoryScreenProps>) {
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
  const moves = usePersonsMove();
  // An Undo (or a switch) landing moves the version, from the shell: the person's action, so the
  // window opens with the render that brings it, before the re-read below (held) can land.
  const [movedSeen, setMovedSeen] = useState(versionsMoved);
  if (movedSeen !== versionsMoved) {
    setMovedSeen(versionsMoved);
    moves.opens();
  }
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
  // Whether the question was asked from a version that would hide saved data (its row's hidden-data
  // line). Set only as the question opens, so the line stays while the sheet slides away.
  const [askedHides, setAskedHides] = useState(false);
  const savedData = hasSavedData ?? ((a: InstalledApp) => access.hasSavedData(a));

  const load = () =>
    runHistoryLoad(async () => {
      const [list, active] = await Promise.all([listVersions(access, app), access.activeId(app)]);
      return { snapshots: list, activeId: active };
    }, setLoad);
  const reload = () =>
    load().catch((e) => {
      historyOperationFailed('list', e);
    });

  const movedLoaded = useRef(versionsMoved);
  useEffect(() => {
    if (movedLoaded.current === versionsMoved) {
      reload().catch((e) => historyOperationFailed('list', e));
    } else {
      movedLoaded.current = versionsMoved;
      moves.hold(reload).catch((e) => historyOperationFailed('list', e));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [access, app, versionsMoved]);

  useSystemBack(onBack);

  const rows = useMemo(() => buildHistoryRows(snapshots, activeId), [snapshots, activeId]);
  const proseApps = useMemo(() => [{ name: app.name, color: nameColor }], [app.name, nameColor]);

  const busyFor = (row: HistoryRow, action: 'use-version' | 'make-copy') => (on: boolean) => setBusy(on ? { id: row.id, action } : null);

  /** "Use this version": current at once, then the shell's toast with Undo, saying which way the app
   *  went (`onUseVersion`). The Undo is the shell's, so it runs whether or not History is still
   *  showing; when it lands, `versionsMoved` brings these rows up to date. Once the toast has gone,
   *  the version the app left keeps its own row, which does the same. */
  const switchVersion = async (row: HistoryRow) => {
    const words = { to: row.number, from: rows.find((r) => r.isCurrent)?.number ?? null };
    try {
      if (!(await moves.hold(() => runRowAction(flight, busyFor(row, 'use-version'), () => onUseVersion(app, row.id, words, activeId, load))))) return;
    } catch (e) {
      historyOperationFailed('use-version', e);
      haptics.play('failure');
      toast.show({ message: COPY.historyUseVersionFailed });
      await reload();
      return;
    }
    haptics.play('success');
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
      const failure = copyFailure(e, data);
      toast.show({
        message: failure.message,
        ...(failure.startFresh ? { action: { label: COPY.copyQuestionFresh, onPress: () => makeCopy(row, 'fresh') } } : {}),
      });
      return;
    }
    const { made } = result;
    if (made) {
      haptics.play('success');
      toast.show({ message: COPY.copyMadeToast, action: { label: COPY.actionOpen, onPress: () => onOpen(made) } });
    }
  };

  /** Whether copying the app's data from `row`'s version would hide some of it, read when the question
   *  opens (the row's own line may still be computing at the tap). A failed read says nothing. */
  const copyWouldHideData = async (row: HistoryRow): Promise<boolean> => {
    if (row.isCurrent || activeId == null) return false;
    try {
      return (await fieldsLeavingViewOnRestore(access, app, row.id, activeId)).length > 0;
    } catch (e) {
      historyOperationFailed('hidden-data', e);
      return false;
    }
  };

  /** The saved-data read, and the hidden-data read that goes with a question, hold the row actions, so
   *  a tap meanwhile asks nothing twice. */
  const askCopy = async (row: HistoryRow) => {
    if (flight.inFlight) return;
    const probe: { saved: boolean | null; hides: boolean } = { saved: false, hides: false };
    const read = async () => {
      probe.saved = await savedData(app);
      if (probe.saved) probe.hides = await copyWouldHideData(row);
    };
    if (canCopyData && !(await runRowAction(flight, () => undefined, read))) return;
    if (probe.saved === null) return;
    if (probe.saved) {
      asked.current = row;
      setAskedHides(probe.hides);
      setAsking(true);
    } else {
      await makeCopy(row, 'fresh');
    }
  };

  /** The copy question's answer, taken once per question. */
  const answerCopy = (data: ForkOptions['data']) => {
    const row = asked.current;
    asked.current = null;
    setAsking(false);
    if (row) makeCopy(row, data).catch((e) => historyOperationFailed('copy', e));
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

  /** Opens the row `id`, or closes it when it is the open one: the person's own action, so it moves. */
  const toggle = (id: string) => {
    const opens = (prev: string | null) => (prev === id ? null : id);
    moves.act(() => setExpandedId(opens));
  };

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
      onToggle={() => toggle(item.id)}
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
          <RowsMove.Provider value={moves.open && !t.reduceMotion ? REFLOW : undefined}>
            <FlatList
              data={rows}
              keyExtractor={row => row.id}
              renderItem={renderRow}
              CellRendererComponent={HistoryCell}
              ListHeaderComponent={titleBlock}
              contentContainerStyle={s.list}
            />
          </RowsMove.Provider>
        )}
      </React.Fragment>

      <CopyQuestionSheet
        visible={asking}
        appName={app.name}
        hidesData={askedHides}
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

/** M26's way out, the opening's backwards: the card's fill and its actions fade out on `fade-out` while
 *  the card shrinks on `smooth`. The fill shows at once as a row opens; the actions fade out only once
 *  they have faded in (Reanimated's fade-out sets out from whole), so a row closed while its actions
 *  still fade in drops them at once. Nothing fades while nothing moves (`moves` undefined). */
function useClosingFades(expanded: boolean, moves: typeof REFLOW | undefined) {
  const fill = useSharedValue(expanded ? 1 : 0);
  const [actionsShown, setActionsShown] = useState(false);
  useEffect(() => {
    if (expanded) fill.value = 1;
    else fill.value = moves === undefined ? 0 : withTiming(0, FILL_OUT);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only an open or a close fades the fill
  }, [expanded]);
  useEffect(() => {
    if (!expanded) {
      setActionsShown(false);
      return undefined;
    }
    const faded = setTimeout(() => setActionsShown(true), FADE_IN.duration);
    return () => clearTimeout(faded);
  }, [expanded]);
  const fillStyle = useAnimatedStyle(() => ({ opacity: fill.value }));
  return { fillStyle, actionsExit: moves !== undefined && actionsShown ? ACTIONS_OUT : undefined };
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
  const moves = useContext(RowsMove);
  const { fillStyle, actionsExit } = useClosingFades(expanded, moves);
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
      <Animated.View style={[s.card, expanded && s.cardOpen]} layout={moves}>
        <Animated.View style={[s.fill, fillStyle]} pointerEvents="none" />
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
          <Animated.View style={s.expanded} entering={moves === undefined ? undefined : ACTIONS_IN} exiting={actionsExit}>
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
          </Animated.View>
        )}
      </Animated.View>
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
