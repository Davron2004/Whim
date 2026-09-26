/**
 * keyboard-shell — the decisions behind `KeyboardShell.tsx` and `SheetModal.tsx` (beta-1 D3), free
 * of React Native so the launcher's Node suite can import them.
 *
 * One keyboard model on every platform:
 * - A frame (a screen, or a sheet's card) pads its own bottom by the keyboard's overlap with it,
 *   measured from the top of the window, wherever the OS doesn't resize the window for the keyboard: iOS,
 *   and Android 15 and later, which draws an app that targets API 35 or later (Whim does) edge to
 *   edge. Android before 15 resizes the window (`adjustResize`, `AndroidManifest.xml`), so a screen
 *   pads nothing there. A sheet's window is drawn under the system bars on every Android version (so
 *   its dim covers them), and such a window never resizes, so a sheet always pads.
 * - No scroll view insets itself by the keyboard: the padding already ends it above the keyboard and
 *   the pinned footer, and an inset as well would count the keyboard twice.
 * - When the visible part of the scroll view or its content changes while a field in it is focused,
 *   the shell scrolls that field (or the block it names, like a plan row with its Save and Cancel)
 *   fully into view, clear of the footer.
 */

/** Who pads for the keyboard: a whole screen, or the sheet (`SheetModal`) a shell sits in. */
export type KeyboardShellHost = 'screen' | 'sheet';

/** The platform a frame renders on, as React Native's `Platform` reports it: `Version` is the API
 *  level on Android and a version string on iOS. */
export interface KeyboardPlatform {
  readonly OS: string;
  readonly Version: string | number;
}

/** Android 15: from this API level an app targeting it draws edge to edge. */
const ANDROID_EDGE_TO_EDGE_API = 35;

/** The keyboard events a frame places itself by (`moved`, carrying the keyboard's frame) and resets
 *  on (`hidden`). iOS reports every change of the keyboard's frame before it happens: showing,
 *  hiding, and a keyboard that grows or shrinks while up (another keyboard, the Done bar arriving).
 *  Android reports only showing and hiding, after the keyboard has moved. */
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

/** Whether the OS itself resizes the app's window when the keyboard opens: only Android before 15. */
export function windowResizesForKeyboard(platform: KeyboardPlatform): boolean {
  return platform.OS === 'android' && Number(platform.Version) < ANDROID_EDGE_TO_EDGE_API;
}

/** Whether a frame of `host` pads itself by the keyboard. Where the window resizes, padding as well
 *  would lift everything twice. */
export function padsForKeyboard(platform: KeyboardPlatform, host: KeyboardShellHost): boolean {
  return host === 'sheet' || !windowResizesForKeyboard(platform);
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

/** A multiline field on iOS gets the keyboard's Done bar: Return adds a newline there, and iOS has
 *  no system key that puts the keyboard away. */
export function showsDoneBar(os: string, multiline: boolean | undefined): boolean {
  return os === 'ios' && multiline === true;
}
