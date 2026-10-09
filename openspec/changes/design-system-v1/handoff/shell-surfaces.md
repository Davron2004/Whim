# Contract: shell-surfaces (chain-11)

Interface only. Rules: system.md §4.3–4.5, §6, §7.1. Colours via `useTokens()`; haptics via `haptics.ts`.

## Sheet — `src/host/ui/Sheet.tsx`

```ts
export interface SheetProps { visible: boolean; onClose: () => void /* must set visible false */;
  title?: string /* title2; screen-reader focus lands here */; detent?: 'fit' | 'large' /* fit */;
  closeLabel?: string /* COPY.sheetClose */; children: React.ReactNode }
// drag physics worklets for any dragged surface (downward-positive pt, velocity pt/s); DRAG_SLOP = 10
export function projectRelease(position: number, velocity: number): number;  // + (v/1000)·0.998/(1−0.998)
export function rubberBand(overshoot: number, dimension: number): number;     // coefficient 0.55
export function releaseCommits(position, velocity, dimension): boolean;  // v >= 0 && projected > dim/2
export function dragPosition(start: number, translation: number, dimension: number): number;
```
- Own full-window `Modal`; mounted through its exit animation. Opens/closes `smooth`; drag release
  → `fling` with velocity. Reduce Motion: 160/120 ms cross-fade, drag still tracks.
- Closes via scrim (sibling, hidden from a11y), close `x`, `onRequestClose` (Android back; hardware
  Escape arrives as back), `onAccessibilityEscape`, drag past commit. Card `accessibilityViewIsModal`.
  iOS hardware Escape is not delivered (no RN key events).
- `commit` haptic: prepared on touch-down, played once per crossing. Drag source: grabber + header.
- Keyboard: card `paddingBottom = max(overlap, safe bottom)`, frame by frame. Fields go in a
  `<KeyboardShell host="sheet">` body (pads nothing; reveals the focused field).

## ConfirmSheet — `src/host/ui/ConfirmSheet.tsx`

```ts
export interface ConfirmSheetProps { visible: boolean; title: string; body: string; keepLabel: string /* ink,
  first */; confirmLabel: string /* danger, 'warning' */; busy?: string; onKeep() /* every way out */; onConfirm() }
```
Only for "Make a new ID" / "Use your own server". Legacy `launcher/ConfirmSheet.tsx` untouched.

## ContextMenu — `src/host/ui/ContextMenu.tsx`

```ts
export interface MenuRow { key: string; label: string; icon: IconName; onPress?: () => void;
  destructive?: boolean /* after a separator, danger-text */; next?: readonly MenuRow[] /* 2nd step */ }
export interface MenuAnchor { x: number; y: number; width: number; height: number } // window; cell incl. name
export interface ContextMenuProps { visible: boolean; title: string /* app's full name */;
  anchor: MenuAnchor | null /* null renders nothing */; rows: readonly MenuRow[]; onClose: () => void }
export const MENU = { width: 248, gap: 8, row: 48, icon: 20, openScale: 0.92, closeScale: 0.96 };
export function placeMenu(anchor, size: {width;height}, window: {width;height}, insets: {top;bottom}):
  { left: number; top: number; below: boolean };   // never overlaps anchor; inside 20 pt gutters
```
- Caller owns the 350 ms long-press, tile lift and `long-press` haptic. Plain row: `onClose()` then
  `onPress()`; a `next` row swaps rows (120 ms) behind a Back row. Card role `menu` named by `title`;
  each row its own `Pressable` role `button`. Own `Modal`; closes via scrim, back, escape. Grows
  0.92→1 (`smooth`) from the edge facing the anchor; exits fade-out + 0.96; Reduce Motion fades.

## Toast — `src/host/ui/Toast.tsx`

```ts
export interface ToastAction { label: string; onPress: () => void; asksWhim?: boolean /* ember-text */ }
export interface ToastSpec { message: string; action?: ToastAction; undo?: boolean /* 10 s */ }
export interface ToastApi { show(toast: ToastSpec): void /* replaces in place */; dismiss(): void }
export function ToastHost(props: { bottomOffset?: number /* chrome above safe area */; children }): JSX.Element;
export function useToast(): ToastApi;  // throws outside a ToastHost; toastDuration(t): 4000|6000|10000
```
- Mount one `ToastHost` high (none mounted yet). Pauses on touch, stops under a screen reader (`dismiss`
  action + escape). iOS announces; Android polite live region. Swipe down: sheet commit rule, `fling`.

## TextField / TextArea — `src/host/ui/TextField.tsx`

```ts
export interface TextFieldProps extends Pick<TextInputProps, 'autoFocus'|'autoCapitalize'|'autoCorrect'|
  'autoComplete'|'keyboardType'|'inputMode'|'returnKeyType'|'onSubmitEditing'|'maxLength'|'editable'|'testID'> {
  value: string; onChangeText: (text: string) => void; label?: string /* also the a11y name */;
  placeholder?: string; error?: string /* 2 pt danger + icon line; read as hint */; helper?: string;
  accessibilityLabel?: string /* when no label */; revealTarget?: React.RefObject<View | null>;
  onFocus?: TextInputProps['onFocus']; onBlur?: TextInputProps['onBlur'] }
export function TextField(p); export function TextArea(p);  // clear button when non-empty; area 3→8 lines
```
Built on `KeyboardTextInput` (kept 16 pt above keyboard + footer in any `KeyboardShell`). Box size
constant across rest/focused/error.

## GroupedList — `src/host/ui/GroupedList.tsx`

```ts
export type RowTrailing = { kind: 'value'; text: string } | { kind: 'chevron' } | { kind: 'external' }
  | { kind: 'switch'; value: boolean; onValueChange: (on: boolean) => void }
  | { kind: 'copy'; label: string; onCopy: () => void };
export interface GroupedRowProps { title: string; subtitle?: string; icon?: IconName; trailing?: RowTrailing;
  onPress?: () => void; destructive?: boolean; disabled?: boolean; accessibilityHint?: string }
export interface GroupedSectionProps { header?: string; footer?: string; on?: 'canvas' | 'sheet'; children }
export function GroupedSection(p); export function GroupedRow(p);  // children: GroupedRow elements
```
Switch row = one element role `switch` (press flips, toggle haptic); copy = its own button.

## AppTile geometry — `src/host/ui/AppTile-geometry.ts` (no RN import)

```ts
export const TILE_SIDE = { inline: 24, menu: 40, grid: 64, hero: 96 };  // type TileSize = keyof
export const TILE = { corner: 0.225, glyph: 0.5, glyphStroke: 2, badge: 18 };
export const GRID = { columns: 4, largeTextColumns: 3, largeTextFrom: 1.35, listFrom: 2, labelGap: 4,
  labelLines: 2, labelSidePadding: 4, rowGap: 20, minTouch: { width: 64, height: 84 } };
export function gridLayout(width: number, fontScale: number): GridLayout; // { kind:'grid'; columns;
  // columnWidth=(width−40)/columns; tile; cellHeight; rowGap; gutter } | { kind:'list'; tile: 40; rowHeight; gutter }
```

## Keyboard — `src/host/launcher/KeyboardShell.tsx`, `keyboard-shell.ts`

```ts
export function useKeyboardOverlap(frame: RefObject<View|null>, active: boolean): { overlap: SharedValue<number>;
  onLayout: () => void /* on the measured view */; overlapFor: (keyboardHeight: number) => number };
export function useKeyboardInset(frame, active): number;  // settled, React state (MiniAppView's WebView)
export function keyboardOverlap(keyboardHeight, frameBottom, windowHeight): number;  // worklet
export function sheetBottomPadding(overlap, safeBottom): number;  // worklet; REVEAL_MARGIN = 16
```
- Source: react-native-keyboard-controller (`useGenericKeyboardHandler`, `KeyboardEvents`, its
  `useWindowDimensions`); window-relative heights. RN `Keyboard` events are read nowhere in
  `src/host`; `KeyboardFrameReporter.kt` deleted (emoji-panel re-pad device-verified without it).
- Reveal: once at `keyboardWillShow` for the destination viewport (screens), none per frame, a
  recheck at `keyboardDidShow`. `autoFocus`: Android focuses on mount + next frame; iOS next frame.

## Tests: `shell-surfaces-ui.suite.tsx`, `keyboard-shell-ui.suite.tsx`; `run.mjs` aliases gesture-handler →
`native-gesture-handler.tsx` (`pan(config, ys, vy)`), keyboard-controller → `native-keyboard-controller.tsx`
(`moveKeyboard`, `stepKeyboard`, `dragKeyboard`, `emitKeyboardEvent`, `resetKeyboard`), worklets →
`native-reanimated.tsx` (`scheduleOnRN` inline; end callbacks run on assignment).
