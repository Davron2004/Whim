/**
 * keyboard-shell — the decisions behind `KeyboardShell.tsx` (beta-1 D3), free of React Native so
 * the launcher's Node suite can import them.
 *
 * iOS: the scroll view insets itself by the keyboard and scrolls the focused field above it, a drag
 * pulls the keyboard down with the finger, and a pinned footer rides above the keyboard inside a
 * `KeyboardAvoidingView` with `padding`. Android: the window resizes (`adjustResize`,
 * `AndroidManifest.xml`), so the shell adds no avoidance of its own, and a drag dismisses.
 *
 * Inside a sheet the host (`SheetModal`) already avoids the keyboard, so the shell adds none:
 * the sheet's `KeyboardAvoidingView` stays its only one.
 */

/** Where a shell sits: a whole screen (it avoids the keyboard itself) or a sheet whose host does. */
export type KeyboardShellHost = 'screen' | 'sheet';

export interface KeyboardShellLayout {
  /** The shell's own `KeyboardAvoidingView` behaviour; `undefined` means it avoids nothing. */
  readonly avoidBehavior: 'padding' | undefined;
  readonly automaticallyAdjustKeyboardInsets: boolean;
  readonly keyboardDismissMode: 'interactive' | 'on-drag';
  /** A tap a control handles stays with the control; a tap on empty scroll content dismisses. */
  readonly keyboardShouldPersistTaps: 'handled';
}

/** Whether a footer slot holds anything to pin: React renders nothing for these values. */
export function pinsFooter(footer: unknown): boolean {
  return footer !== undefined && footer !== null && typeof footer !== 'boolean' && footer !== '';
}

/**
 * The shell's keyboard wiring on `os`. Only a screen with a pinned footer pads: without one, the
 * scroll view's own inset already keeps its content clear, and padding as well would inset it twice.
 */
export function keyboardShellLayout(os: string, host: KeyboardShellHost, footerPinned: boolean): KeyboardShellLayout {
  const ios = os === 'ios';
  const ownAvoidance = ios && host === 'screen';
  return {
    avoidBehavior: ownAvoidance && footerPinned ? 'padding' : undefined,
    automaticallyAdjustKeyboardInsets: ownAvoidance,
    keyboardDismissMode: ios ? 'interactive' : 'on-drag',
    keyboardShouldPersistTaps: 'handled',
  };
}

/** A multiline field on iOS gets the keyboard's Done bar: Return adds a newline there, and iOS has
 *  no system key that puts the keyboard away. */
export function showsDoneBar(os: string, multiline: boolean | undefined): boolean {
  return os === 'ios' && multiline === true;
}
