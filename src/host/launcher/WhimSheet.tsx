/**
 * WhimSheet — the running app's one menu, what the orb opens (app-launcher "The Whim sheet is a running
 * app's one menu"; system.md §9 Whim sheet, §7.1 Text field). A `fit` page of the shell's sheet
 * (`MakingSheet`), over the app, which keeps running under it:
 *
 * - the app's 40 pt tile, its name and "Version N · changed <when>" for the version that is running;
 * - "New version ready · Reload" on top while a newer version than the running one is current;
 * - the "What should change?" send area, with its 32 pt `ember` arrow inside its trailing edge;
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
import { areaHeight, FIELD, fieldBorder, fieldSelection } from '../ui/TextField';
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

/** The version `id` among `timeline` (newest first, as History lists it), or `null` when it isn't one
 *  of them. */
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
  content: { paddingHorizontal: LAYOUT.gutter, paddingBottom: LAYOUT.actionAreaBottom, gap: LAYOUT.gapBetweenGroups },
  head: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: SPACE[3] },
  names: { flex: 1 },
  area: {
    flexDirection: 'row' as const,
    alignItems: 'flex-end' as const,
    gap: SPACE[2],
    backgroundColor: t.colors.surface,
    borderRadius: FIELD.field.vertical + SEND / 2,
    borderCurve: 'continuous' as const,
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
        {...fieldSelection(t)}
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

export function WhimSheet({ app, version, newVersion, text, onChangeText, onSend, onReload, onHistory, onReport, onExit }: Readonly<WhimSheetProps>) {
  const t = useTokens();
  const s = styles(t);
  const { tint, icon } = tileOf(app);
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
      {newVersion ? (
        <GroupedSection on="sheet">
          <GroupedRow title={COPY.whimSheetNewVersion} trailing={{ kind: 'value', text: COPY.actionReload }} onPress={onReload} />
        </GroupedSection>
      ) : null}
      <SendArea text={text} onChangeText={onChangeText} onSend={onSend} />
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
