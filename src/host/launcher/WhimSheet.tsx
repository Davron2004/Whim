/**
 * WhimSheet — the running app's one menu, what the orb opens (app-launcher "The Whim sheet is a running
 * app's one menu"; system.md §9 Whim sheet, §7.1 Text field). A `fit` page of the shell's sheet
 * (`MakingSheet`), over the app, which keeps running under it:
 *
 * - the app's 40 pt tile, its name and "Version N · changed <when>" for the version that is running;
 * - "New version ready · Reload" on top while a newer version than the running one is current, and
 *   "See why" while a change of the app has failed and none is being made: the orb's `danger` dot as a
 *   row that stays after the failed-change toast has gone, opening the same Failure page;
 * - the "What should change?" send area, with its 32 pt `ember` arrow inside its trailing edge, or,
 *   while a change of the app is being made, "Changing…" and Stop the change in its place;
 * - History, Report a problem and Back to your apps.
 *
 * Every row is its own accessibility element (#103): nothing here wraps another control. Sending hands
 * the words to the shell, which grows the same sheet into the change's plan page (`LauncherRoot`).
 * Report a problem is pushed inside the sheet (`WhimReportPage`), whose back control and Android back
 * return here. The words typed live in the shell, so the rebuild a text-size change makes of the
 * sheet's content keeps them.
 */
import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import { LAYOUT, SPACE } from '../../design/tokens';
import { TilePlate } from '../ui/AppTile';
import { GroupedRow, GroupedSection } from '../ui/GroupedList';
import { Icon } from '../ui/Icon';
import { useSheetBack } from '../ui/Sheet';
import { Text } from '../ui/Text';
import { areaHeight, FIELD, fieldBorder } from '../ui/TextField';
import { useTokens } from '../ui/tokens';
import { buttonColors, hitSlopFor, makeStyles, MAX_FONT_SCALE, typeStyle } from '../ui/tokens-pure';
import type { Snapshot } from '../version-store';
import type { InstalledApp } from './app-index';
import { COPY, whimSheetVersionLine } from './copy';
import KeyboardShell, { KeyboardTextInput } from './KeyboardShell';
import { ReportPage, type ReportScreenProps } from './ReportScreen';
import { tileOf } from './tile-identity';

/** The version an app is running: its number in the app's History and when it was made. */
export interface RunningVersion {
  readonly number: number;
  readonly changedAt: number;
}

/** The version `id` among `timeline`, the app's whole version chain newest first as `listVersions`
 *  reads it for History (a capped list would number the versions differently, or miss this one), or
 *  `null` when it isn't one of them. */
export function runningVersion(timeline: readonly Snapshot[], id: string | null): RunningVersion | null {
  const index = timeline.findIndex((snapshot) => snapshot.id === id);
  if (index < 0) return null;
  return { number: timeline.length - index, changedAt: timeline[index].createdAt };
}

export interface WhimSheetProps {
  app: InstalledApp;
  /** The running version, `null` while it is read. */
  version: RunningVersion | null;
  /** A newer version than the running one is current: the Reload row shows. */
  newVersion: boolean;
  /** A change of this app is being made: the send area gives way to "Changing…" and Stop the change,
   *  as the app's tile menu on Home offers, so a second change can't be sent over it. */
  changing: boolean;
  onStopChange: () => void;
  /** A change of this app failed while this launch ran: the See why row shows, unless a newer change
   *  is being made (`changing`), the same state that gives the orb its `danger` dot. */
  failedChange: boolean;
  /** See why: the failed change's Failure page, in the sheet over the app, as the toast's See why. */
  onSeeWhy: () => void;
  /** The send area's words, held by the shell. */
  text: string;
  onChangeText: (text: string) => void;
  /** Sends the words: the shell grows the sheet into the change's plan page. */
  onSend: () => void;
  onReload: () => void;
  onHistory: () => void;
  onReport: () => void;
  /** Back to your apps: the app closes and Home shows. */
  onExit: () => void;
}

/** The send button's disc. */
const SEND = 32;

const styles = makeStyles((t) => ({
  // A grouped section keeps `gapBetweenGroups` under itself; the head and the send area match it. The
  // last section's is the space under the content, so nothing pads it again: with the keyboard up it
  // is what separates the last row from the Done bar.
  content: { paddingHorizontal: LAYOUT.gutter },
  head: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: SPACE[3], marginBottom: LAYOUT.gapBetweenGroups },
  names: { flex: 1 },
  area: {
    flexDirection: 'row' as const,
    alignItems: 'flex-end' as const,
    gap: SPACE[2],
    backgroundColor: t.colors.surface,
    borderRadius: FIELD.field.vertical + SEND / 2,
    borderCurve: 'continuous' as const,
    marginBottom: LAYOUT.gapBetweenGroups,
  },
  input: {
    ...typeStyle('body'),
    color: t.colors.text,
    flex: 1,
    padding: 0,
    margin: 0,
    maxHeight: areaHeight(FIELD.area.maxLines, t.fontScale),
  },
  send: { width: SEND, height: SEND, borderRadius: SEND / 2, alignItems: 'center' as const, justifyContent: 'center' as const },
}));

/** "What should change?" with the arrow that sends it inside its trailing edge. */
function SendArea({ text, onChangeText, onSend }: Readonly<Pick<WhimSheetProps, 'text' | 'onChangeText' | 'onSend'>>) {
  const t = useTokens();
  const s = styles(t);
  const [focused, setFocused] = useState(false);
  const border = fieldBorder(t, focused, false);
  const empty = text.trim().length === 0;
  const colors = buttonColors(t, 'ember', empty);
  // The border grows inward: the padding gives back what it takes, so the box keeps its size.
  const pad = (base: number) => base - FIELD.border + FIELD.activeBorder - border.width;
  return (
    <View
      style={[
        s.area,
        {
          borderWidth: border.width,
          borderColor: border.color,
          paddingLeft: pad(FIELD.field.horizontal),
          paddingRight: pad(SPACE[2]),
          paddingVertical: pad(SPACE[2]),
        },
      ]}
    >
      <KeyboardTextInput
        multiline
        scrollEnabled
        textAlignVertical="center"
        value={text}
        onChangeText={onChangeText}
        placeholder={COPY.whimSheetAsk}
        placeholderTextColor={t.colors['text-2']}
        maxFontSizeMultiplier={MAX_FONT_SCALE}
        accessibilityLabel={COPY.whimSheetAsk}
        style={[s.input, { minHeight: SEND, paddingVertical: SPACE[1] }]}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
      />
      <Pressable
        onPress={onSend}
        disabled={empty}
        hitSlop={hitSlopFor(SEND, t)}
        style={[s.send, { backgroundColor: colors.fill }]}
        accessibilityRole="button"
        accessibilityLabel={COPY.whimSheetSend}
        accessibilityState={{ disabled: empty }}
      >
        <Icon name="arrow-up" size={20} color={colors.label} />
      </Pressable>
    </View>
  );
}

export function WhimSheet({
  app,
  version,
  newVersion,
  changing,
  onStopChange,
  failedChange,
  onSeeWhy,
  text,
  onChangeText,
  onSend,
  onReload,
  onHistory,
  onReport,
  onExit,
}: Readonly<WhimSheetProps>) {
  const t = useTokens();
  const s = styles(t);
  const { tint, icon } = tileOf(app);
  const seeWhy = failedChange && !changing;
  return (
    <KeyboardShell host="sheet" contentContainerStyle={s.content}>
      <View style={s.head}>
        <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <TilePlate size="menu" state="ready" tint={tint} glyph={icon} />
        </View>
        <View style={s.names}>
          <Text type="headline" accessibilityRole="header">
            {app.name}
          </Text>
          {/* Its line is kept while the version is read, so nothing under it moves when it lands. */}
          <Text type="footnote" color="text-2">
            {version ? whimSheetVersionLine(version.number, version.changedAt, Date.now()) : ' '}
          </Text>
        </View>
      </View>
      {newVersion || seeWhy ? (
        <GroupedSection on="sheet">
          {newVersion ? (
            <GroupedRow title={COPY.whimSheetNewVersion} trailing={{ kind: 'value', text: COPY.actionReload }} onPress={onReload} />
          ) : null}
          {seeWhy ? (
            <GroupedRow dot="danger" title={COPY.changeFailedToast} trailing={{ kind: 'value', text: COPY.toastSeeWhy }} onPress={onSeeWhy} />
          ) : null}
        </GroupedSection>
      ) : null}
      {changing ? (
        <GroupedSection on="sheet" header={COPY.tileChanging}>
          <GroupedRow title={COPY.actionStopChange} icon="x" onPress={onStopChange} />
        </GroupedSection>
      ) : (
        <SendArea text={text} onChangeText={onChangeText} onSend={onSend} />
      )}
      <GroupedSection on="sheet">
        <GroupedRow title={COPY.actionHistory} icon="clock" trailing={{ kind: 'chevron' }} onPress={onHistory} />
        <GroupedRow title={COPY.reportScreenTitle} icon="flag" trailing={{ kind: 'chevron' }} onPress={onReport} />
        <GroupedRow title={COPY.whimSheetBackToApps} icon="house" onPress={onExit} />
      </GroupedSection>
    </KeyboardShell>
  );
}

/** Report a problem, pushed inside the Whim sheet: its back control, Android back, Cancel and Done
 *  return to the sheet's first page; closing the sheet returns to the running app. */
export function WhimReportPage({ onBack, ...report }: Readonly<Omit<ReportScreenProps, 'onLeave'> & { onBack: () => void }>) {
  useSheetBack(onBack, { control: true });
  return <ReportPage {...report} onLeave={onBack} />;
}
