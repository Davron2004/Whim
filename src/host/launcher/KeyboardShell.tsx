/**
 * KeyboardShell — the one keyboard-safe frame every launcher screen or sheet with a text field
 * renders (beta-1 D3; app-launcher "Text input never hides the content or action it belongs to").
 * React Native built-ins only; the per-platform decisions live in `keyboard-shell.ts`.
 *
 * A pinned `header`, the scrolling content, and a pinned `footer` for the primary action. The
 * content scroll view keeps the focused field above the keyboard, lets a drag put the keyboard
 * away, and lets a tap a control handles reach the control. On a screen the whole frame is a
 * `KeyboardAvoidingView`, which must stay the screen's root: it measures itself against its
 * parent, and the keyboard's position arrives in window coordinates. Inside a sheet the host
 * (`SheetModal`) does the avoiding. A tap on empty space anywhere in the frame puts the keyboard
 * away; a control or a scroll gesture takes the touch first, so neither is swallowed.
 */

import React, { useId } from 'react';
import {
  InputAccessoryView,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import type { StyleProp, TextInputProps, ViewStyle } from 'react-native';
import { SPACING, TYPE_SCALE } from '../../sdk/theme';
import { COPY } from './copy';
import { keyboardShellLayout, pinsFooter, showsDoneBar, type KeyboardShellHost } from './keyboard-shell';
import { SHELL_PALETTE } from './theme';

export interface KeyboardShellProps {
  /** Pinned above the scrolling content: the screen's header. */
  header?: React.ReactNode;
  /** Pinned below the scrolling content and kept above the keyboard: the primary action and what
   *  sits with it. Leave it out on a screen with no primary action. */
  footer?: React.ReactNode;
  /** `sheet` inside `SheetModal`, whose own `KeyboardAvoidingView` is the sheet's only one. */
  host?: KeyboardShellHost;
  /** The frame's own style (its background). */
  style?: StyleProp<ViewStyle>;
  contentContainerStyle?: StyleProp<ViewStyle>;
  children: React.ReactNode;
}

const dismissKeyboard = () => Keyboard.dismiss();

export default function KeyboardShell({
  header,
  footer,
  host = 'screen',
  style,
  contentContainerStyle,
  children,
}: Readonly<KeyboardShellProps>) {
  const layout = keyboardShellLayout(Platform.OS, host, pinsFooter(footer));
  const inSheet = host === 'sheet';
  const frame = (
    <Pressable
      style={inSheet ? [styles.shrink, style] : styles.fill}
      onPress={dismissKeyboard}
      accessible={false}
      android_disableSound
    >
      {header}
      <ScrollView
        style={inSheet ? styles.shrink : undefined}
        contentContainerStyle={contentContainerStyle}
        automaticallyAdjustKeyboardInsets={layout.automaticallyAdjustKeyboardInsets}
        keyboardDismissMode={layout.keyboardDismissMode}
        keyboardShouldPersistTaps={layout.keyboardShouldPersistTaps}
      >
        {children}
      </ScrollView>
      {footer}
    </Pressable>
  );
  if (inSheet) return frame;
  return (
    <KeyboardAvoidingView style={[styles.fill, style]} behavior={layout.avoidBehavior}>
      {frame}
    </KeyboardAvoidingView>
  );
}

/**
 * A text field for a `KeyboardShell`. Multiline on iOS, it carries the keyboard's Done bar, which
 * puts the keyboard away and submits nothing. The bar renders right after its own field and
 * mounts with it: an `InputAccessoryView` links to its field once, when it mounts, so a bar mounted
 * before its field would link to nothing.
 */
export function KeyboardTextInput(props: Readonly<TextInputProps>) {
  const doneBarId = useId();
  if (!showsDoneBar(Platform.OS, props.multiline)) return <TextInput {...props} />;
  return (
    <>
      <TextInput {...props} inputAccessoryViewID={doneBarId} />
      <InputAccessoryView nativeID={doneBarId} backgroundColor={SHELL_PALETTE.card}>
        <View style={[styles.doneBar, { borderTopColor: SHELL_PALETTE.cardBorder }]}>
          <TouchableOpacity onPress={dismissKeyboard} accessibilityRole="button" hitSlop={10}>
            <Text style={[TYPE_SCALE.controlLabel, { color: SHELL_PALETTE.accent }]}>{COPY.keyboardDone}</Text>
          </TouchableOpacity>
        </View>
      </InputAccessoryView>
    </>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  shrink: { flexShrink: 1 },
  // 44: the iOS keyboard toolbar's height — no SPACING counterpart.
  doneBar: {
    height: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingHorizontal: SPACING.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
