/**
 * keyboard-shell — the decisions behind `KeyboardShell.tsx`, `SheetModal.tsx` and the shell's
 * `Sheet` (beta-1 D3, design-system-v1 task 11.3), free of React Native so the launcher's Node
 * suite can import them.
 *
 * One keyboard model on every platform:
 * - The keyboard is tracked by `react-native-keyboard-controller`, frame by frame on the UI thread:
 *   its height above the window's bottom edge, from the window's own insets (Android) or the
 *   keyboard's frame notifications (iOS), including a keyboard that changes height while up (the
 *   emoji or voice panel, another keyboard, a suggestion bar).
 * - A frame (a screen, or a sheet's card) pads its own bottom by the keyboard's overlap with it:
 *   the keyboard's top edge and the frame's bottom edge both measured in the frame's window. No
 *   window resizes for the keyboard: iOS never does, and on Android Whim draws edge to edge on
 *   every version (`edgeToEdgeEnabled`; the keyboard provider keeps it so), which leaves the
 *   keyboard to the app. A frame that ends above the keyboard (split screen with Whim on top, a
 *   frame above a bottom bar) overlaps it less, or not at all, so nothing is ever lifted twice.
 * - No scroll view insets itself by the keyboard: the padding already ends it above the keyboard and
 *   the pinned footer, and an inset as well would count the keyboard twice.
 * - When the visible part of the scroll view or its content changes while a field in it is focused,
 *   the shell scrolls that field (or the block it names, like a plan row with its Save and Cancel)
 *   fully into view, `REVEAL_MARGIN` clear of the keyboard and the footer.
 */

import { SPACE } from '../../design/tokens';
import { SELECTION_HIGHLIGHT, SHELL_PALETTE } from './theme';

/** Who pads for the keyboard: a whole screen, or the sheet (`SheetModal`) a shell sits in, which
 *  pads for the shell inside it. */
export type KeyboardShellHost = 'screen' | 'sheet';

/** Whether a footer slot holds anything to pin: React renders nothing for these values. */
export function pinsFooter(footer: unknown): boolean {
  return footer !== undefined && footer !== null && typeof footer !== 'boolean' && footer !== '';
}

/** How far a keyboard `keyboardHeight` tall covers a frame whose bottom edge is at `frameBottom`, in a
 *  window `windowHeight` tall (both measured from the window's top): the padding that ends the
 *  frame's content above the keyboard. A frame never ends below the window: one measured while the
 *  native stack was still sliding it in reads as reaching the window's bottom, so a keyboard that is
 *  down covers nothing. A worklet: frames run it on the UI thread every keyboard frame. */
export function keyboardOverlap(keyboardHeight: number, frameBottom: number, windowHeight: number): number {
  'worklet';
  return Math.max(0, Math.min(frameBottom, windowHeight) - (windowHeight - keyboardHeight));
}

/** How far a focused field sits above the keyboard (and a pinned footer) once revealed: 16 pt
 *  (system.md §6 "Keyboard"). */
export const REVEAL_MARGIN = SPACE[4];

/** A sheet card's bottom padding: the keyboard covers the home indicator's inset, so the larger of
 *  the two, never both. The card continues behind the keyboard rather than stopping at its top
 *  edge, so nothing shows between them while both move. A worklet. */
export function sheetBottomPadding(overlap: number, safeBottom: number): number {
  'worklet';
  return Math.max(overlap, safeBottom);
}

/** Whether a mini-app's page is padded for the keyboard like a frame. Android: yes, the WebView
 *  draws under the keyboard like everything else, and only a page that ends above it has a
 *  viewport the runtime can keep a focused field inside. iOS: no, WKWebView scrolls a focused
 *  field clear of the keyboard itself, and a shorter page would count the keyboard twice. */
export function padsWebViewForKeyboard(os: string): boolean {
  return os === 'android';
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

/** The most of the window a sheet's pinned footer may take before it scrolls with the content
 *  instead. Pinned, the footer is always in reach; but a footer that grows with the text size (two
 *  buttons, one of them on three lines at 200%) would leave the content a sliver to scroll in and put
 *  some of it out of reach. Three tenths of the window: a first-run footer at default size is about a
 *  sixth of an iPhone 17 and a fifth of a small phone, and the largest text size is what crosses it. */
export const FOOTER_SHARE = 0.3;

/** Whether a sheet's footer, `footerHeight` tall, scrolls with the content in a window `windowHeight`
 *  tall. Measured against the window, not the sheet: the sheet's own height changes with the keyboard,
 *  which would move the footer in and out of the scroll as it rises. */
export function footerJoinsScroll(footerHeight: number, windowHeight: number): boolean {
  return windowHeight > 0 && footerHeight > windowHeight * FOOTER_SHARE;
}

/** How far the content's edge fade under a sheet's header shows at scroll offset `offset`: nothing at
 *  rest, fully once the content has moved the fade's own height (system.md §6: content fades out over
 *  16 pt under floating chrome). Following the offset keeps the fade from popping in over content
 *  that has hardly moved. */
export function topFadeOpacity(offset: number, fadeHeight: number): number {
  if (fadeHeight <= 0) return 0;
  return Math.min(1, Math.max(0, offset / fadeHeight));
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
