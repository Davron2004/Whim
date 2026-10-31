/**
 * TextField / TextArea — the shell's text inputs (system.md §7.1 Text field / area, §6 Keyboard;
 * design-system-v1 task 11.3). Both sit on `KeyboardTextInput`, so inside a `KeyboardShell` (a
 * screen, or a sheet's body) the focused field is kept 16 pt above the keyboard and the pinned
 * footer, and a multiline field gets iOS's Done bar.
 *
 * - `surface`, a 1 px `border`, `r-md`, padding 12 × 14 (area 14 × 16), text `body` 17 so iOS never
 *   zooms. Label `footnote` 600 `text-2`, 6 pt above; placeholder `text-2`.
 * - Focused: a 2 pt `text` border and an `ink` caret. Error: a 2 pt `danger` border, and the error
 *   in `danger-text` with an icon under the field. The box never changes size between states.
 * - A clear button on a non-empty single-line field. A text area shows 3 lines, grows to 8, then
 *   scrolls.
 */

import React, { useState } from 'react';
import { Pressable, Text as RNText, View } from 'react-native';
import type { TextInputProps } from 'react-native';
import { RADII, SPACE, TYPE_SCALE } from '../../design/tokens';
import { COPY } from '../launcher/copy';
import { KeyboardTextInput } from '../launcher/KeyboardShell';
import { Icon } from './Icon';
import { useTokens, type ShellTokens } from './tokens';
import { hitSlopFor, makeStyles, MAX_FONT_SCALE, typeStyle } from './tokens-pure';

/** What both fields take from `TextInput`; look and behaviour come from the props below. */
type InputProps = Pick<
  TextInputProps,
  | 'autoFocus'
  | 'autoCapitalize'
  | 'autoCorrect'
  | 'autoComplete'
  | 'keyboardType'
  | 'inputMode'
  | 'returnKeyType'
  | 'onSubmitEditing'
  | 'maxLength'
  | 'editable'
  | 'testID'
>;

export interface TextFieldProps extends InputProps {
  value: string;
  onChangeText: (text: string) => void;
  /** `footnote` 600 `text-2` above the field; also its screen-reader name. */
  label?: string;
  placeholder?: string;
  /** Shown in `danger-text` with an icon under the field, which gets a 2 pt `danger` border. */
  error?: string;
  /** A `footnote` `text-2` line under the field, while there is no error. */
  helper?: string;
  /** The screen-reader name when there is no visible label. */
  accessibilityLabel?: string;
  /** The block to keep in view above the keyboard while focused (the field with what belongs to
   *  it); the field itself when left out. */
  revealTarget?: React.RefObject<View | null>;
  onFocus?: TextInputProps['onFocus'];
  onBlur?: TextInputProps['onBlur'];
}

export const FIELD = {
  labelGap: 6,
  field: { vertical: SPACE[3], horizontal: 14 },
  area: { vertical: 14, horizontal: SPACE[4], minLines: 3, maxLines: 8 },
  border: 1,
  activeBorder: 2,
  clearIcon: 20,
  helperIcon: 16,
} as const;

/** `hex` (`#rrggbb`) at `alpha`, as an rgba string. */
function withAlpha(hex: string, alpha: number): string {
  const [r, g, b] = [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16));
  return `rgba(${r},${g},${b},${alpha})`;
}

/** The caret, selection handles and highlight: `ink` caret and handles; Android paints the
 *  highlight under the selected text, so it gets `ink` at 30%; iOS tints all three from one colour
 *  and draws the highlight translucent itself. */
export function fieldSelection(t: ShellTokens): Pick<TextInputProps, 'selectionColor' | 'cursorColor' | 'selectionHandleColor'> {
  if (t.platform === 'ios') return { selectionColor: t.colors.ink };
  return { selectionColor: withAlpha(t.colors.ink, 0.3), cursorColor: t.colors.ink, selectionHandleColor: t.colors.ink };
}

/** The border a field draws: 2 pt `danger` on error, 2 pt `text` while focused, else 1 pt `border`. */
export function fieldBorder(t: ShellTokens, focused: boolean, error: boolean): { width: number; color: string } {
  if (error) return { width: FIELD.activeBorder, color: t.colors.danger };
  if (focused) return { width: FIELD.activeBorder, color: t.colors.text };
  return { width: FIELD.border, color: t.colors.border };
}

/** A text area's outer height for `lines` lines of `body` at the phone's text size: the lines, its
 *  padding and its border. */
export function areaHeight(lines: number, fontScale: number): number {
  const lineHeight = TYPE_SCALE.body.lineHeight * Math.min(fontScale, MAX_FONT_SCALE);
  return lines * lineHeight + 2 * (FIELD.area.vertical + FIELD.border);
}

const styles = makeStyles((t) => ({
  label: { ...typeStyle('footnote', true), color: t.colors['text-2'], marginBottom: FIELD.labelGap },
  box: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    backgroundColor: t.colors.surface,
    borderRadius: RADII.md.radius,
    borderCurve: 'continuous' as const,
  },
  input: { ...typeStyle('body'), color: t.colors.text, flex: 1, padding: 0, margin: 0 },
  clear: { marginLeft: SPACE[2], alignItems: 'center' as const, justifyContent: 'center' as const },
  helperRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: SPACE[1], marginTop: FIELD.labelGap },
  helper: { ...typeStyle('footnote'), color: t.colors['text-2'], flexShrink: 1 },
  error: { ...typeStyle('footnote'), color: t.colors['danger-text'], flexShrink: 1 },
}));

interface FieldFrameProps {
  t: ShellTokens;
  label?: string;
  error?: string;
  helper?: string;
  children: React.ReactNode;
}

/** The label above a field and its error or helper line under it. */
function FieldFrame({ t, label, error, helper, children }: Readonly<FieldFrameProps>) {
  const s = styles(t);
  return (
    <View>
      {label ? (
        <TextLine style={s.label} hidden>
          {label}
        </TextLine>
      ) : null}
      {children}
      {error ? (
        <View style={s.helperRow} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <Icon name="circle-alert" size={FIELD.helperIcon} color={t.colors['danger-text']} />
          <TextLine style={s.error}>{error}</TextLine>
        </View>
      ) : null}
      {!error && helper ? (
        <View style={s.helperRow} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <TextLine style={s.helper}>{helper}</TextLine>
        </View>
      ) : null}
    </View>
  );
}

/** Field chrome text: the field reads its label, error and helper itself, so these are hidden. */
function TextLine({ style, hidden = false, children }: Readonly<{ style: object; hidden?: boolean; children: React.ReactNode }>) {
  return (
    <RNText style={style} maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityElementsHidden={hidden} importantForAccessibility={hidden ? 'no' : 'auto'}>
      {children}
    </RNText>
  );
}

/** The parts of a field's state both kinds share. */
function useFieldState(props: Readonly<TextFieldProps>) {
  const t = useTokens();
  const [focused, setFocused] = useState(false);
  const border = fieldBorder(t, focused, props.error != null && props.error !== '');
  const onFocus: NonNullable<TextInputProps['onFocus']> = (event) => {
    setFocused(true);
    props.onFocus?.(event);
  };
  const onBlur: NonNullable<TextInputProps['onBlur']> = (event) => {
    setFocused(false);
    props.onBlur?.(event);
  };
  return { t, border, onFocus, onBlur };
}

/** The input props both kinds pass through unchanged. */
function passThrough(props: Readonly<TextFieldProps>): InputProps {
  const { autoFocus, autoCapitalize, autoCorrect, autoComplete, keyboardType, inputMode, returnKeyType, onSubmitEditing, maxLength, editable, testID } = props;
  return { autoFocus, autoCapitalize, autoCorrect, autoComplete, keyboardType, inputMode, returnKeyType, onSubmitEditing, maxLength, editable, testID };
}

export function TextField(props: Readonly<TextFieldProps>) {
  const { value, onChangeText, label, placeholder, error, helper, revealTarget } = props;
  const { t, border, onFocus, onBlur } = useFieldState(props);
  const s = styles(t);
  // The border grows inward: the padding gives back what it takes, so the box keeps its size.
  const inset = FIELD.activeBorder - border.width;
  return (
    <FieldFrame t={t} label={label} error={error} helper={helper}>
      <View
        style={[
          s.box,
          {
            borderWidth: border.width,
            borderColor: border.color,
            paddingVertical: FIELD.field.vertical - FIELD.border + inset,
            paddingHorizontal: FIELD.field.horizontal - FIELD.border + inset,
          },
        ]}
      >
        <KeyboardTextInput
          {...passThrough(props)}
          {...fieldSelection(t)}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={t.colors['text-2']}
          style={s.input}
          maxFontSizeMultiplier={MAX_FONT_SCALE}
          accessibilityLabel={label ?? props.accessibilityLabel}
          accessibilityHint={error || helper}
          revealTarget={revealTarget}
          onFocus={onFocus}
          onBlur={onBlur}
        />
        {value !== '' && props.editable !== false ? (
          <Pressable
            onPress={() => onChangeText('')}
            style={s.clear}
            hitSlop={hitSlopFor(FIELD.clearIcon, t)}
            accessibilityRole="button"
            accessibilityLabel={COPY.fieldClear}
          >
            <Icon name="x" size={FIELD.clearIcon} color={t.colors['text-2']} />
          </Pressable>
        ) : null}
      </View>
    </FieldFrame>
  );
}

export function TextArea(props: Readonly<TextFieldProps>) {
  const { value, onChangeText, label, placeholder, error, helper, revealTarget } = props;
  const { t, border, onFocus, onBlur } = useFieldState(props);
  const s = styles(t);
  const inset = FIELD.activeBorder - border.width;
  return (
    <FieldFrame t={t} label={label} error={error} helper={helper}>
      <KeyboardTextInput
        {...passThrough(props)}
        {...fieldSelection(t)}
        multiline
        scrollEnabled
        textAlignVertical="top"
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={t.colors['text-2']}
        maxFontSizeMultiplier={MAX_FONT_SCALE}
        style={[
          s.box,
          s.input,
          {
            flex: undefined,
            minHeight: areaHeight(FIELD.area.minLines, t.fontScale),
            maxHeight: areaHeight(FIELD.area.maxLines, t.fontScale),
            borderWidth: border.width,
            borderColor: border.color,
            paddingVertical: FIELD.area.vertical - FIELD.border + inset,
            paddingHorizontal: FIELD.area.horizontal - FIELD.border + inset,
          },
        ]}
        accessibilityLabel={label ?? props.accessibilityLabel}
        accessibilityHint={error || helper}
        revealTarget={revealTarget}
        onFocus={onFocus}
        onBlur={onBlur}
      />
    </FieldFrame>
  );
}
