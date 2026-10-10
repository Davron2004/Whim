/**
 * GroupedList — sections of rows (system.md §7.1 Grouped list, §2.8 List row; design-system-v1
 * task 11.4). A group is `surface` on the canvas or `sheet-group` in a sheet, `r-lg`, no border;
 * rows are min 52, padding 12 × 16, with an optional 20 pt `text-2` icon, a `body` title and a
 * `footnote` `text-2` subtitle, and a trailing value, chevron, switch, external link, copy
 * button or the `check` of a chosen row. Separators inset 16 (52 with an icon). A pressed row fills with `fill`; a destructive
 * row's title is `danger-text`. A section header (`footnote` 600 `text-2`) sits 8 pt above the
 * group, its footer (`footnote` `text-2`) 8 pt under. Switches are the platform's own, on-track `ink`.
 *
 * From 135% text (§6, paired things stack) a trailing value goes under the title, so the title keeps
 * the row's width. A chevron with `expanded` turns down while its row is open and says so.
 *
 * Every row is its own accessibility element: a switch row is one switch (its title, its state),
 * a choice row one radio, a copy button is a button of its own beside its row.
 */

import React from 'react';
import { Pressable, StyleSheet, Switch, Text as RNText, View } from 'react-native';
import { LAYOUT, RADII, SPACE } from '../../design/tokens';
import type { IconName } from '../../design/icons/names';
import { haptics } from '../haptics';
import { Icon } from './Icon';
import { useTokens, type ShellTokens } from './tokens';
import { hitSlopFor, makeStyles, MAX_FONT_SCALE, typeStyle } from './tokens-pure';

export type GroupedSurface = 'canvas' | 'sheet';

export type RowTrailing =
  | { kind: 'value'; text: string }
  /** A row that opens something. `expanded` is for one that opens in place: the chevron turns down
   *  while it is open, and a screen reader hears the state. */
  | { kind: 'chevron'; expanded?: boolean }
  | { kind: 'switch'; value: boolean; onValueChange: (on: boolean) => void }
  | { kind: 'external' }
  | { kind: 'copy'; label: string; onCopy: () => void }
  /** One choice of several in its group (a radio): a `check` while chosen. */
  | { kind: 'check'; checked: boolean };

export interface GroupedRowProps {
  title: string;
  subtitle?: string;
  icon?: IconName;
  trailing?: RowTrailing;
  /** The row's action; a switch row toggles instead. */
  onPress?: () => void;
  /** The title in `danger-text`. */
  destructive?: boolean;
  disabled?: boolean;
  accessibilityHint?: string;
}

export interface GroupedSectionProps {
  header?: string;
  footer?: string;
  /** `canvas` (default): `surface` groups; `sheet`: `sheet-group`. */
  on?: GroupedSurface;
  /** `GroupedRow`s. */
  children: React.ReactNode;
}

export const ROW = {
  minHeight: LAYOUT.listRowMinHeight,
  paddingVertical: LAYOUT.listRowPaddingVertical,
  paddingHorizontal: LAYOUT.listRowPaddingHorizontal,
  icon: 20,
  trailingIcon: 20,
  separatorInset: LAYOUT.separatorInset,
  separatorInsetWithIcon: LAYOUT.separatorInsetWithIcon,
  headerGap: SPACE[2],
} as const;

/** The group's fill on `on`. */
export function groupFill(t: ShellTokens, on: GroupedSurface): string {
  return on === 'sheet' ? t.colors['sheet-group'] : t.colors.surface;
}

const styles = makeStyles((t) => ({
  section: { marginBottom: LAYOUT.gapBetweenGroups },
  header: { ...typeStyle('footnote', true), color: t.colors['text-2'], paddingHorizontal: ROW.paddingHorizontal, marginBottom: ROW.headerGap },
  footer: { ...typeStyle('footnote'), color: t.colors['text-2'], paddingHorizontal: ROW.paddingHorizontal, marginTop: ROW.headerGap },
  group: {
    borderRadius: RADII.lg.radius,
    borderCurve: 'continuous' as const,
    overflow: 'hidden' as const,
    borderWidth: t.increaseContrast ? 1 : 0,
    borderColor: t.colors.border,
  },
  separator: { height: StyleSheet.hairlineWidth, backgroundColor: t.colors.separator },
  line: { flexDirection: 'row' as const, alignItems: 'center' as const },
  row: {
    flex: 1,
    minHeight: ROW.minHeight,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: SPACE[3],
    paddingVertical: ROW.paddingVertical,
    paddingHorizontal: ROW.paddingHorizontal,
  },
  texts: { flex: 1 },
  title: { ...typeStyle('body') },
  subtitle: { ...typeStyle('footnote'), color: t.colors['text-2'], marginTop: LAYOUT.gapTitleToSubtitle / 2 },
  value: { ...typeStyle('callout'), color: t.colors['text-2'], flexShrink: 1, textAlign: 'right' as const },
  // At large text the value sits under the title, where the whole width is the title's.
  valueStacked: { ...typeStyle('callout'), color: t.colors['text-2'], marginTop: LAYOUT.gapTitleToSubtitle / 2 },
  pressed: { backgroundColor: t.colors.fill },
  copy: { paddingRight: ROW.paddingHorizontal },
}));

/** A row title's colour: `text-3` disabled, `danger-text` destructive, else `text`. */
function titleColor(t: ShellTokens, destructive: boolean, disabled: boolean): string {
  if (disabled) return t.colors['text-3'];
  return destructive ? t.colors['danger-text'] : t.colors.text;
}

/** A section: its header, a group of rows with separators between them, its footer. */
export function GroupedSection({ header, footer, on = 'canvas', children }: Readonly<GroupedSectionProps>) {
  const t = useTokens();
  const s = styles(t);
  const rows = React.Children.toArray(children).filter(React.isValidElement) as React.ReactElement<GroupedRowProps>[];
  return (
    <View style={s.section}>
      {header ? (
        <RNText style={s.header} accessibilityRole="header" maxFontSizeMultiplier={MAX_FONT_SCALE}>
          {header}
        </RNText>
      ) : null}
      <View style={[s.group, { backgroundColor: groupFill(t, on) }]}>
        {rows.map((row, i) => (
          <React.Fragment key={row.key ?? i}>
            {i > 0 ? (
              <View style={[s.separator, { marginLeft: row.props.icon ? ROW.separatorInsetWithIcon : ROW.separatorInset }]} />
            ) : null}
            {row}
          </React.Fragment>
        ))}
      </View>
      {footer ? (
        <RNText style={s.footer} maxFontSizeMultiplier={MAX_FONT_SCALE}>
          {footer}
        </RNText>
      ) : null}
    </View>
  );
}

/** The trailing part of a row that isn't a control of its own. */
function TrailingMark({ t, trailing }: Readonly<{ t: ShellTokens; trailing: RowTrailing }>) {
  const s = styles(t);
  switch (trailing.kind) {
    case 'value':
      return (
        <RNText style={s.value} numberOfLines={1} maxFontSizeMultiplier={MAX_FONT_SCALE}>
          {trailing.text}
        </RNText>
      );
    case 'chevron':
      return <Icon name={trailing.expanded ? 'chevron-down' : 'chevron-right'} size={ROW.trailingIcon} color={t.colors['text-2']} />;
    case 'external':
      return <Icon name="external-link" size={ROW.trailingIcon} color={t.colors['text-2']} />;
    case 'check':
      return trailing.checked ? <Icon name="check" size={ROW.trailingIcon} color={t.colors.text} /> : null;
    default:
      return null;
  }
}

/** The role a row announces: a switch, a choice, a link out, a button, or plain text. */
function rowRole(props: Readonly<GroupedRowProps>): 'switch' | 'radio' | 'link' | 'button' | 'text' {
  if (props.trailing?.kind === 'switch') return 'switch';
  if (props.trailing?.kind === 'check') return 'radio';
  if (!props.onPress) return 'text';
  return props.trailing?.kind === 'external' ? 'link' : 'button';
}

/** A switch row's switch: the platform's own, on-track `ink`; the row speaks for it. */
function RowSwitch({ t, value, onFlip, disabled }: Readonly<{ t: ShellTokens; value: boolean; onFlip: () => void; disabled: boolean }>) {
  return (
    <Switch
      value={value}
      onValueChange={onFlip}
      disabled={disabled}
      trackColor={{ true: t.colors.ink, false: t.colors['fill-strong'] }}
      ios_backgroundColor={t.colors['fill-strong']}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    />
  );
}

/** A copy row's button, its own element beside the row. */
function CopyButton({ t, label, onCopy }: Readonly<{ t: ShellTokens; label: string; onCopy: () => void }>) {
  const s = styles(t);
  return (
    <Pressable onPress={onCopy} hitSlop={hitSlopFor(ROW.trailingIcon, t)} style={s.copy} accessibilityRole="button" accessibilityLabel={label}>
      <Icon name="copy" size={ROW.trailingIcon} color={t.colors['text-2']} />
    </Pressable>
  );
}

/** A switch row's and a choice row's checked state, an expanding row's expanded one, with every
 *  row's disabled one. */
function rowState(trailing: RowTrailing | undefined, disabled: boolean): { checked?: boolean; expanded?: boolean; disabled: boolean } {
  if (trailing?.kind === 'switch') return { checked: trailing.value, disabled };
  if (trailing?.kind === 'check') return { checked: trailing.checked, disabled };
  if (trailing?.kind === 'chevron' && trailing.expanded !== undefined) return { expanded: trailing.expanded, disabled };
  return { disabled };
}

/** What a toggle row does when pressed: flips its switch, with the toggle haptic. */
function flipper(trailing: RowTrailing | undefined): (() => void) | undefined {
  if (trailing?.kind !== 'switch') return undefined;
  return () => {
    const on = !trailing.value;
    haptics.play(on ? 'toggle-on' : 'toggle-off');
    trailing.onValueChange(on);
  };
}

export function GroupedRow(props: Readonly<GroupedRowProps>) {
  const { title, subtitle, icon, trailing, onPress, destructive = false, disabled = false, accessibilityHint } = props;
  const t = useTokens();
  const s = styles(t);
  const flip = flipper(trailing);
  const press = flip ?? onPress;
  const value = trailing?.kind === 'value' ? `, ${trailing.text}` : '';
  // A trailing value takes width the title needs: at large text (system.md §6, paired things stack)
  // it goes under the title instead.
  const stacked = trailing?.kind === 'value' && t.largeText;
  return (
    <View style={s.line}>
      <Pressable
        onPress={press}
        disabled={disabled || !press}
        style={({ pressed }) => [s.row, pressed && press ? s.pressed : null]}
        accessibilityRole={rowRole(props)}
        accessibilityLabel={title + value}
        accessibilityHint={accessibilityHint ?? subtitle}
        accessibilityState={rowState(trailing, disabled)}
      >
        {icon ? <Icon name={icon} size={ROW.icon} color={t.colors['text-2']} /> : null}
        <View style={s.texts}>
          <RNText style={[s.title, { color: titleColor(t, destructive, disabled) }]} maxFontSizeMultiplier={MAX_FONT_SCALE}>
            {title}
          </RNText>
          {stacked ? (
            <RNText style={s.valueStacked} maxFontSizeMultiplier={MAX_FONT_SCALE}>
              {trailing.text}
            </RNText>
          ) : null}
          {subtitle ? (
            <RNText style={s.subtitle} maxFontSizeMultiplier={MAX_FONT_SCALE}>
              {subtitle}
            </RNText>
          ) : null}
        </View>
        {trailing && !stacked ? <TrailingMark t={t} trailing={trailing} /> : null}
        {trailing?.kind === 'switch' && flip ? <RowSwitch t={t} value={trailing.value} onFlip={flip} disabled={disabled} /> : null}
      </Pressable>
      {trailing?.kind === 'copy' ? <CopyButton t={t} label={trailing.label} onCopy={trailing.onCopy} /> : null}
    </View>
  );
}
