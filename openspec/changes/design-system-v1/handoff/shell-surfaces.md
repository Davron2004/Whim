# Contract: shell-surfaces (chain-11)

Interface only. Rules: system.md §4.3–4.5, §6, §7.1. Colours via `useTokens()`; haptics via `haptics.ts`.

## OverlayModal — `src/host/ui/OverlayModal.tsx`
```ts
export function useOverlayTurn(wanted: boolean, o: { onGone?: () => void /* once per showing, nothing of it left */;
  onRefused: () => void /* system refused SHOW_ATTEMPTS times: stop wanting */ }): OverlayTurn;
export function OverlayModal(p: { turn: OverlayTurn; onRequestClose: () => void; children }): JSX.Element | null;
// OverlayTurn { open /* up and wanted: play the entrance/exit off this */; up; mounted; exited() /* call when the exit ended */ }
export const DISMISS_REPORT_MS = 500, EXIT_CEILING_MS = 2000, SHOW_REPORT_MS = 1000, SHOW_RETRY_MS = 250, SHOW_ATTEMPTS = 3;
```
- Every Modal-based overlay MUST render through `OverlayModal` + `useOverlayTurn` and never a bare `Modal`:
  overlays take turns on the surface they present from (the root window, or the overlay they sit in), whoever
  shows them, so none is presented while another is up or being dismissed. iOS refuses that presentation
  and leaves a full-window, invisible, touch-taking view behind.
- iOS: the turn passes on the system's `onDismiss`, else after `DISMISS_REPORT_MS`; an unconfirmed
  presentation (no `onShow`) is unmounted after `SHOW_REPORT_MS` of the app being active, retried after
  `SHOW_RETRY_MS`, and refused `SHOW_ATTEMPTS` times it calls `onRefused`. An overlay unmounted while up or
  hiding leaves the turn held `DISMISS_REPORT_MS` by the queue. Android: the turn passes as the exit ends.
- An overlay up but no longer wanted is ended after `EXIT_CEILING_MS` if its exit never reports.

## Sheet — `src/host/ui/Sheet.tsx`
```ts
export interface SheetProps { visible: boolean; onClose: () => void /* must set visible false */;
  title?: string /* title2; screen-reader focus lands here */; detent?: 'fit' | 'large' /* fit */;
  closeLabel?: string /* COPY.sheetClose */; children: React.ReactNode }
export function useSheetBack(handler: () => void): void; // Android back goes to the page, not onClose; no-op outside a Sheet
// drag worklets for any dragged surface (downward-positive pt, velocity pt/s); DRAG_SLOP = 10
export function projectRelease(position, velocity): number;  // + (v/1000)·0.998/(1−0.998)
export function rubberBand(overshoot, dimension): number;    // coefficient 0.55
export function releaseCommits(position, velocity, dimension): boolean;  // v >= 0 && projected > dim/2
export function dragPosition(start, translation, dimension): number;
```
- `launcher/SheetModal.tsx` (Report's form) takes turns through `OverlayModal` too. `Sheet`'s frame is keyed by `fontScale`: its content, nested overlays included, is rebuilt on a live size change.
- Mounted through its exit. Opens/closes `smooth`; drag release → `fling` with velocity. Reduce Motion:
  160/120 ms cross-fade, drag still tracks. Closes via scrim (sibling, hidden from a11y), close `x`,
  `onRequestClose` (Android back; hardware Escape arrives as back), `onAccessibilityEscape`, drag past commit.
  Card `accessibilityViewIsModal`. A Modal consumes back, so `BackHandler` never sees it: a page that steps
  back before closing registers with `useSheetBack`; `onRequestClose` calls it in place of `onClose`.
- `commit` haptic: prepared on touch-down, played once per crossing. Drag source: grabber + header. Keyboard:
  card `paddingBottom = max(overlap, safe bottom)`; fields go in a `<KeyboardShell host="sheet">` body.
- ConfirmSheet (`ConfirmSheet.tsx`, only for "Make a new ID" / "Use your own server"): `{ visible; title; body;
  keepLabel /* ink, first */; confirmLabel /* danger, 'warning' */; busy?; onKeep() /* every way out */; onConfirm() }`.

## ContextMenu — `src/host/ui/ContextMenu.tsx`
```ts
export interface MenuRow { key: string; label: string; icon: IconName; onPress?: () => void;
  destructive?: boolean /* after a separator, danger-text */; next?: readonly MenuRow[] /* 2nd step */ }
export interface MenuAnchor { x: number; y: number; width: number; height: number } // from the root's top-left; cell incl. name
export interface ContextMenuProps { visible: boolean; title: string /* app's full name */;
  anchor: MenuAnchor | null /* null renders nothing */; rows: readonly MenuRow[]; onClose: () => void }
export const MENU = { width: 248, gap: 8, row: 48, icon: 20, openScale: 0.92, closeScale: 0.96 };
export function placeMenu(anchor, size: {width;height}, window: {width;height}, insets: {top;bottom}):
  { left: number; top: number; below: boolean };   // never overlaps anchor; inside 20 pt gutters
```
- Caller owns the 350 ms long-press, tile lift and `long-press` haptic, and measures the anchor with `measure`'s
  page offsets (Android's `measureInWindow` starts below the status bar). A `next` row swaps rows (120 ms)
  behind a Back row. Any other row closes the menu and its `onPress` runs once, after the menu has gone from
  the screen (so it may show a sheet, the share sheet or an alert); only the first row chosen in an opening
  counts, and a row chosen as the owner unmounts is dropped. Card role `menu` named by `title`; each row its
  own `Pressable` role `button`. Closes via scrim, back, escape. Grows 0.92→1 (`smooth`) from the edge
  facing the anchor; exits fade-out + 0.96; Reduce Motion fades.

## Toast — `src/host/ui/Toast.tsx`
```ts
export interface ToastAction { label: string; onPress: () => void; asksWhim?: boolean /* ember-text */ }
export interface ToastSpec { message: string; action?: ToastAction; undo?: boolean /* 10 s */;
  onEnd?: () => void /* once, when no longer offered: timeout, swipe, dismiss, action, or replaced */ }
export interface ToastApi { show(toast: ToastSpec): void /* replaces in place */; dismiss(): void }
export function ToastHost(props: { bottomOffset?: number /* chrome above safe area */; children }): JSX.Element;
export function useToast(): ToastApi;  // throws outside a ToastHost; toastDuration(t): 4000|6000|10000
```
- Mount one `ToastHost` high. Pauses on touch, stops under a screen reader (`dismiss` action + escape). The
  action's target reaches the platform floor (`hitSlopFor`). iOS announces; Android polite live region.

## TextField / TextArea — `src/host/ui/TextField.tsx`

`TextFieldProps` = the common `TextInputProps` subset (autoFocus, autoCapitalize/Correct/Complete, keyboardType,
inputMode, returnKeyType, onSubmitEditing, maxLength, editable, testID, onFocus, onBlur) + `{ value; onChangeText;
label? /* also the a11y name */; placeholder?; error? /* 2 pt danger + icon line; read as hint */; helper?;
accessibilityLabel? /* when no label */; revealTarget?: RefObject<View | null> }`. `TextField(p)`, `TextArea(p)`
(clear button when non-empty; area 3→8 lines), on `KeyboardTextInput`. Box size constant across rest/focused/error.

## GroupedList — `src/host/ui/GroupedList.tsx`
```ts
export type RowTrailing = { kind: 'value'; text: string } | { kind: 'chevron'; expanded?: boolean } | { kind: 'external' }
  | { kind: 'switch'; value: boolean; onValueChange: (on: boolean) => void } | { kind: 'copy'; label: string; onCopy: () => void };
// GroupedRowProps { title; subtitle?; icon?: IconName; trailing?: RowTrailing; onPress?; destructive?; disabled?; accessibilityHint? }
// GroupedSectionProps { header?; footer?; on?: 'canvas' | 'sheet'; children }
```
Switch row = one element role `switch` (press flips, toggle haptic); copy = its own button. `expanded` turns the
chevron down and sets `accessibilityState.expanded`. From 135% text a `value` trailing goes under the title.

## AppTile geometry — `src/host/ui/AppTile-geometry.ts` (no RN import)
```ts
export const TILE_SIDE = { inline: 24, menu: 40, grid: 64, hero: 96 };  // type TileSize = keyof
export const TILE = { corner: 0.225, glyph: 0.5, glyphStroke: 2, badge: 18 };
export const GRID = { columns: 4, largeTextColumns: 3, largeTextFrom: 1.35, listFrom: 2, labelGap: 4,
  labelLines: 2, labelSidePadding: 4 /* at every text size */, rowGap: 20, minTouch: { width: 64, height: 84 } };
export function gridLayout(width: number, fontScale: number): GridLayout; // { kind:'grid'; columns;
  // columnWidth=⌊(width−40)/columns⌋ (a degenerate width gets 64); tile; cellHeight; rowGap; gutter } | { kind:'list'; tile: 40; rowHeight; gutter }
```

## Keyboard — `src/host/launcher/KeyboardShell.tsx`, `keyboard-shell.ts`
```ts
export function useKeyboardOverlap(frame: RefObject<View|null>, active: boolean): { overlap: SharedValue<number>;
  onLayout: () => void /* on the measured view */; overlapFor: (keyboardHeight: number) => number };
export function useKeyboardInset(frame, active): number;  // settled, React state (MiniAppView's WebView)
export function keyboardOverlap(keyboardHeight, frameBottom, windowHeight): number;  // worklet
export function sheetBottomPadding(overlap, safeBottom): number;  // worklet; REVEAL_MARGIN = 16
```
Source: react-native-keyboard-controller, plus iOS `Keyboard` `keyboardDidChangeFrame` in `useKeyboardOverlap`: the first keyboard
of a process is reported without its Done bar, so the library's end report may not make a frame shorter than the system's. `KeyboardShell` has `footer`, no header slot. Reveal: once at `keyboardWillShow`, rechecked at `keyboardDidShow`.

## Tests: `shell-surfaces-ui.suite.tsx`, `keyboard-shell-ui.suite.tsx`; `run.mjs` aliases gesture-handler →
`native-gesture-handler.tsx` (`pan(config, ys, vy)`), keyboard-controller → `native-keyboard-controller.tsx`, worklets →
`native-reanimated.tsx` (`scheduleOnRN` inline; end callbacks run on assignment). `native-host.tsx` models the Modal
system (`holdModalDismissals`, `refuseModalPresentations`, `holdUnmountedModalDismissals`), `AppState` and `Keyboard`
(`changeKeyboardFrame`); a render helper calls `freshApp()` (react-screen.ts) before creating a tree.
