/**
 * keyboard-shell — the decisions behind `KeyboardShell.tsx` and `SheetModal.tsx` (beta-1 D3), free
 * of React Native so the launcher's Node suite can import them.
 *
 * One keyboard model on every platform:
 * - A frame (a screen, or a sheet's card) pads its own bottom by the keyboard's overlap with it,
 *   measured from the top of the window. No window resizes for the keyboard: iOS never does, and on
 *   Android Whim draws edge to edge on every version (`edgeToEdgeEnabled` in
 *   `android/gradle.properties`; 15+ would force it anyway), which leaves the keyboard to the app.
 *   Were a window resized after all, the frame would end above the keyboard, so its overlap and
 *   padding would be 0: nothing is ever lifted twice.
 * - No scroll view insets itself by the keyboard: the padding already ends it above the keyboard and
 *   the pinned footer, and an inset as well would count the keyboard twice.
 * - When the visible part of the scroll view or its content changes while a field in it is focused,
 *   the shell scrolls that field (or the block it names, like a plan row with its Save and Cancel)
 *   fully into view, clear of the footer.
 */

import { SELECTION_HIGHLIGHT, SHELL_PALETTE } from './theme';

/** Who pads for the keyboard: a whole screen, or the sheet (`SheetModal`) a shell sits in, which
 *  pads for the shell inside it. */
export type KeyboardShellHost = 'screen' | 'sheet';

/** The keyboard events a frame places itself by (`moved`, carrying the keyboard's frame) and resets
 *  on (`hidden`). iOS reports every change of the keyboard's frame before it happens: showing,
 *  hiding, and a keyboard that grows or shrinks while up (another keyboard, the Done bar arriving).
 *  Android reports them after the keyboard has moved, a keyboard that grows or shrinks while up
 *  (the emoji or voice panel) as another show: React Native itself on Android 10 and older, and
 *  `MainActivity`'s `KeyboardFrameReporter` on 11 and later, where React Native reports only
 *  showing and hiding. */
export function keyboardEvents(os: string): { readonly moved: KeyboardEventName; readonly hidden: KeyboardEventName } {
  return os === 'ios'
    ? { moved: 'keyboardWillChangeFrame', hidden: 'keyboardWillHide' }
    : { moved: 'keyboardDidShow', hidden: 'keyboardDidHide' };
}
export type KeyboardEventName = 'keyboardWillChangeFrame' | 'keyboardWillHide' | 'keyboardDidShow' | 'keyboardDidHide';

/** Whether a footer slot holds anything to pin: React renders nothing for these values. */
export function pinsFooter(footer: unknown): boolean {
  return footer !== undefined && footer !== null && typeof footer !== 'boolean' && footer !== '';
}

/** How far the keyboard, whose top edge is at `keyboardTop`, covers a frame whose bottom edge is at
 *  `frameBottom` (both measured from the window's top): the padding that ends the frame's content above it. */
export function keyboardOverlap(frameBottom: number, keyboardTop: number): number {
  return Math.max(0, frameBottom - keyboardTop);
}

/** A drag on iOS pulls the keyboard down with the finger; Android has no such gesture, so a drag
 *  dismisses. */
export function keyboardDismissMode(os: string): 'interactive' | 'on-drag' {
  return os === 'ios' ? 'interactive' : 'on-drag';
}

/** Where a scroll view stands: its offset, the height it shows, and its content's height. */
export interface ScrollMetrics {
  readonly offset: number;
  readonly viewport: number;
  readonly content: number;
}

/** Whether content is hidden above (the header shows its divider) or below (the footer does). */
export function scrollEdges({ offset, viewport, content }: ScrollMetrics): { readonly above: boolean; readonly below: boolean } {
  return { above: offset > 0.5, below: offset + viewport < content - 0.5 };
}

/**
 * The offset that shows the block from `top` to `bottom` (content coordinates) whole, `margin` clear
 * of the viewport's edges, or `null` when it already shows. A block taller than the viewport shows
 * its bottom, where the caret and a row's Save and Cancel sit.
 */
export function revealOffset(
  { offset, viewport }: Pick<ScrollMetrics, 'offset' | 'viewport'>,
  top: number,
  bottom: number,
  margin: number,
): number | null {
  const fits = bottom - top <= viewport - 2 * margin;
  if (bottom + margin > offset + viewport) return Math.max(0, bottom + margin - viewport);
  if (fits && top - margin < offset) return Math.max(0, top - margin);
  return null;
}

/** The colours a field draws its caret, selection handles and selected text's highlight in. */
export interface SelectionColors {
  readonly selectionColor: string;
  readonly cursorColor?: string;
  readonly selectionHandleColor?: string;
}

/** Whim's accent for a field's caret and selection handles, and a highlight its text stays readable
 *  on. iOS tints all three from `selectionColor` and draws the highlight translucent itself, so the
 *  accent is the whole answer there. Android paints the highlight in exactly `selectionColor`, over
 *  the selected text, so it gets the translucent highlight, and the caret and handles take the
 *  accent through their own props. */
export function selectionColors(os: string): SelectionColors {
  if (os !== 'android') return { selectionColor: SHELL_PALETTE.accent };
  return { selectionColor: SELECTION_HIGHLIGHT, cursorColor: SHELL_PALETTE.accent, selectionHandleColor: SHELL_PALETTE.accent };
}

/** A multiline field on iOS gets the keyboard's Done bar: Return adds a newline there, and iOS has
 *  no system key that puts the keyboard away. */
export function showsDoneBar(os: string, multiline: boolean | undefined): boolean {
  return os === 'ios' && multiline === true;
}
