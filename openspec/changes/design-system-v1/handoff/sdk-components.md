# Contract: sdk-components (chain-4)

Interface only. What chain-4 added to `vc-sdk`; chain-5 restyles on top of it, chain-6 animates it.
Every export below is documented in `docs/sdk-reference.md` (the server's tripwire requires it).

## New public exports (`src/sdk/index.tsx`)

```ts
export { Icon } from './icon';              export type { IconProps, IconSize } from './icon';
export { toast } from './toast';
export { Stepper, DateInput, Picker } from './controls';
export type { StepperProps, DateInputProps, DateInputMode, PickerProps } from './controls';
export interface ScreenAction { icon: string; label: string; onPress: () => void }   // exported type
```

## Props, verbatim

```ts
type IconSize = 'sm' | 'md' | 'lg';                       // 16 / 20 / 24 px
interface IconProps { name: string; size?: IconSize /* 'md' */; color?: TextColorToken /* 'text' */; label?: string }
interface ScreenProps { padding?: SpaceToken; title?: string; action?: ScreenAction; children?: React.ReactNode }
interface ButtonProps    { /* existing */ icon?: string }       // 20 px, before the label, currentColor
interface ListItemProps  { /* existing */ icon?: string }       // 20 px, text-muted, before the title
interface EmptyStateProps{ /* existing */ icon?: string }       // 32 px in a 64 px `fill` disc above the title
interface StepperProps { label?: string; value: number; onChange: (n: number) => void; min?: number /* 0 */; max?: number; step?: number /* 1 */ }
type DateInputMode = 'date' | 'time' | 'datetime';
interface DateInputProps { label?: string; value: number | null; onChange: (ms: number | null) => void; mode?: DateInputMode /* 'date' */ }
interface PickerProps { label?: string; options: string[]; value: string; onChange: (s: string) => void; placeholder?: string /* 'Choose one' */ }
function toast(text: string): void;
```

`AppSpec` (defineApp) gains, both extracted statically by consumers (chain-12 `declaredTile`):

```ts
tint?: string | readonly [string] | readonly [string, string] | readonly [string, string, string];
icon?: string;
/** @deprecated Declare `tint` instead; a `tileColor` maps to the nearest tint. */ tileColor?: string;
```

`tint`/`icon` are `string` on purpose: an unknown or alias name resolves (never a type error, never a
repair turn); only a fourth ranked tint is a type error. `build/build.mjs` extraction still carries
only `tileColor` (unchanged; build/ is protected).

## Internal seams (not public; chains 5/6 build on them)

- `src/sdk/icon.tsx` `Glyph({ name, sizePx, colorValue?, label? })`: the one SVG renderer. Resolves
  via `resolveIcon` (non-string name → `circle`), `stroke="currentColor"`, `strokeWidth` in viewBox
  units so the rendered stroke is 1.5 px below 24 px and 1.75 px from 24 px. No `colorValue` →
  inherits the surrounding text colour. No `label` → `aria-hidden`; label → `role="img"` + `aria-label`.
- `src/sdk/navigation.tsx` `navDepthContext(): React.Context<number>` (lazy, like `chromeInsetContext`).
  `NavRoot` provides `stack.length - 1` around the current screen and renders
  `<ToastHost bottomInset={chromeInsetBottom}/>` as the screen's next sibling.
- `src/sdk/toast.tsx` `ToastHost({ bottomInset })`, `TOAST_MS = 4000`.
- `src/sdk/controls.tsx` `STEPPER_HOLD_MS = 400`, `STEPPER_REPEAT_MS = 125`; `FieldShell` (private) is
  the §7.1 field anatomy (surface, 1 px `border`, r-md, 12 × 14, body; 2 px `text` border on focus)
  shared by `DateInput` and `Picker`.

## Screen header behaviour

- Rendered only when `title` is set: a row (`minHeight` `LAYOUT.headerRowHeight`) with, at the start, a
  back `<button aria-label="Back">` when the nav depth > 0 (calls `nav.back()`; glyph `chevron-left` on
  iOS, `arrow-left` on Android, 24 px, `text`), and at the end the `action` as `<button aria-label={label}>`;
  then an `<h1>` in `textSize('title')` (= `title1`) with `space('lg')` under it.
- Header buttons are `LAYOUT.touchTarget[platform]` square, pulled out by half the target-minus-glyph
  so the glyph lines up with the content edge; each emits `press` with its label.
- Depth resets to 0 inside a Screen, so a nested Screen never shows a back control. The bottom padding
  still adds `chromeInsetBottom` (outermost Screen only), with or without a header.
- No push/pop motion yet (chain-6).

## Toast behaviour

- In-page only: no bridge message, no host frame. A module listener set by `ToastHost`'s mount effect.
- Ignored before that effect runs: the app's first render and its mount effects (the host is after the
  screen), and with no `NavRoot` mounted. Blank text (after trim) is ignored.
- One toast at a time; a new call replaces the text and restarts the 4 s timer; unmount clears it.
- `<div role="status" aria-live="polite" aria-atomic>` present only while shown; fixed, centred,
  `bottom = max(0, inset) + 12px`, z-index 1100 (above Modal's 1000); capsule `raised`,
  `shadow-floating` + `TOP_HIGHLIGHT` inset, max width 360, min height 48, padding 12 × 16, `callout` × fontScale.
- Not done: pause under a screen reader (not detectable in the WebView), rise/sink motion (chain-6).

## Stepper / DateInput / Picker behaviour

- Stepper: pointerdown steps once and, if it moved, repeats after 400 ms every 125 ms until release,
  leave, cancel, the bound, or unmount; `click` steps only when `detail === 0` (keyboard). Values are
  rounded to the step's decimals; a button at its bound is `disabled` (`text-3` glyph).
  `role="spinbutton"` with `aria-valuenow/min/max`; buttons `aria-label` "Decrease"/"Increase".
  Visual capsule `LAYOUT.minHitVisual` (36) high in a `touchTarget`-high box, buttons 44 wide, `width: max-content`.
- DateInput: transparent native `input` (`date` | `time` | `datetime-local`) over the field; shows
  `Intl.DateTimeFormat(undefined, …)` (`dateStyle: 'medium'` / `timeStyle: 'short'`) or a placeholder.
  `date` → local midnight; `time` → the value's day (today when null) at the minute; `datetime` →
  that local minute; `''` → `null`; unreadable → no call. Years < 100 are kept literally.
- Picker: transparent native `select`; a disabled `''` placeholder option while `value ∉ options`;
  options keyed by index so duplicates render without a key warning.
- All three emit `press` (the only UI-event type in use) with the label.

## Gallery (`fixtures/style-gallery.app.tsx`)

Home `Screen title="Style Gallery"` with `action` (info → `nav.navigate('About')`); `About` screen shows
the back control. Shows every Icon size and colour, a labelled icon, Button/ListItem/EmptyState icons,
both Steppers (labelled, unlabelled with `step`), all three DateInput modes (one unset), Picker with
placeholder, a toast button. Declares `tint: 'orchid'`, `icon: 'palette'` beside the kept `tileColor`.
