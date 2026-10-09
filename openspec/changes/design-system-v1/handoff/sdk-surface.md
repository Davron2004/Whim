# Contract: sdk-surface (chain-5)

Interface only. The final `vc-sdk` component surface after the restyle; chain-6 animates it.
Additions of chain-4 (Icon, Stepper, DateInput, Picker, toast, Screen title/action) are in
handoff/sdk-components.md and unchanged here. No export was added or removed by this chain.

## Exports (`src/sdk/index.tsx`), unchanged names

Components: `Screen Stack Row Text Heading NumberInput Button Icon TextInput Switch Checkbox Slider
SegmentedControl Stepper DateInput Picker Card Divider Spacer Grid Badge ProgressBar List ListItem
EmptyState Modal Chart`. Values: `defineApp nav toast storage cues delay interval useState useEffect useRef`.

## Props that changed (verbatim)

```ts
interface RowProps { gap?: SpaceToken; align?: 'start' | 'center' | 'end' /* 'center' */;
  justify?: 'start' | 'center' | 'end' | 'between' /* 'start' */; children?: React.ReactNode }
interface ButtonProps { label: string; icon?: string; /** @deprecated ignored */ radius?: RadiusToken;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; disabled?: boolean; onPress?: () => void }
interface CardProps { padding?: SpaceToken; /** @deprecated ignored */ radius?: RadiusToken; onPress?: () => void; children?: React.ReactNode }
/** @deprecated */ interface HeadingProps { size?: 'subtitle' | 'title' | 'display'; color?: TextColorToken; children?: React.ReactNode }
interface ProgressBarProps { value: number; tone?: 'primary' | 'positive' | 'warning' | 'danger';
  variant?: 'bar' | 'ring' /* 'bar' */; label?: string }
type ListProps<T = unknown> =
  | { children?: React.ReactNode; items?: undefined; keyBy?: undefined; renderItem?: undefined }
  | { items: readonly T[]; keyBy: ListKeyName<T> | ((item: T) => string | number);
      renderItem: (item: T, index: number) => React.ReactNode; children?: undefined };
// ListKeyName<T>: the property names of T whose type is string | number (not exported)
function List<T>(props: ListProps<T>): React.ReactElement;
```

- `Heading` = a `div` styled exactly as `Text` at its `size` (default `title`), `margin: 0`.
- `Button`/`Card` `radius`: accepted, ignored (capsule / r-lg). Both deprecations are JSDoc only.
- `docs/sdk-reference.md`: `Heading` reduced to one "Deprecated" row (it must stay mentioned while
  the export tripwire runs, task 23.3); `radius` rows removed; new rows for `ProgressBar
  variant/label`, `List items/keyBy/renderItem`; token tables corrected (radii 10/14/20, sizes).

## Keyed list and the no-motion flag

- Row identity: React key `` `${typeof key}:${key}` `` (a repeat gets `#n`); missing key → `index:i`.
- `keyProblem`: a key repeated (`'number:1'` and `'string:1'` are distinct), or ≥ 2 keys that are
  each `String(key) === String(index)`, or a row whose key is neither a string nor a non-NaN number.
- On a problem: one `console.warn('vc-sdk List: <problem>; this list will not animate. …')` per list
  instance (effect), and motion is off **for the rest of that instance's life** (a ref).
- Flag: the keyed list's outer element carries `data-list-motion="on" | "off"`; a children-style
  list carries no attribute (never animates). Inside surfaces.tsx the same boolean is
  `useKeyedRows(items, keyBy, renderItem).motion`; the rows are wrapped by `listRow(key, node, first)`.

## Internal seams (not public)

`src/sdk/kit.ts`:
```ts
export const STACK_FONT_SCALE = 1.35;
export function stacks(): boolean;                 // activeTheme().fontScale >= 1.35
export function touchTarget(): number;             // LAYOUT.touchTarget[platform]: 44 | 48
export function typeStyle(token: TypeToken, fontWeight?: number): { fontSize; lineHeight; letterSpacing: string; fontWeight: number };
export function tintSoft(): string;                // TINT_SOFT mix of the tint over surface/raised
export function raisedShadow(kind?: 'shadow-raised' | 'shadow-floating'): string;  // + dark top highlight
export function inSheetContext(): React.Context<boolean>;   // true under Modal's content
export function useGroupSurface(): PaintRole;      // 'sheet-group' in a Modal, else 'surface'
```
`src/sdk/controls.tsx` `TextField({ label?, input, tabular? })`: the field box (surface/sheet-group,
1 px `border`, r-md, 12 × 14, body; focused 2 px **tint** border, ink caret), label `footnote` 600
`text-muted` 6 px above; the placeholder is an SDK `span` in `text-muted` (native `placeholder`
dropped, sent as `aria-placeholder`). `NumberInput`, `TextInput`, `DateInput`, `Picker` share it.

`Screen`: a lazily created nested-screen context replaces the old "inset 0" override, so the chrome
inset context keeps the root value everywhere; only the outermost Screen adds it.

## Component anatomy chain-6 animates

| Component | Element / hook for motion |
|---|---|
| Button, Card, ListItem | `usePressed()` opacity 0.8 dip (`transition: opacity 80ms`): placeholder for press feedback |
| Switch | `button role=switch` row; knob `span` moved by `transform: translateX(px)`, `transition 150ms ease` |
| Checkbox | `button role=checkbox` row; 24 box `span`; `Glyph check` 16 on-tint when checked |
| Slider | `div role=slider` touch area (target high, 14 px side padding); thumb `left: calc(p% - 14px)` |
| SegmentedControl | `div role=radiogroup`; each `button role=radio`; the selected one holds an absolute thumb `span` |
| ProgressBar | bar: mark `span` `width: p%`; ring: arc `circle` `strokeDashoffset = C·(1−v)` (absent at 0) |
| Modal | scrim `div` (fixed, z 1000, `scrim`) › `div role=dialog aria-modal` (`sheet`, r-xl top, `maxHeight 92%`) › grabber, head (`h2` title2, `button aria-label=Close`), body (padding bottom `lg + chromeInset`, provides `inSheetContext`). Escape closes (window `keydown`) |

## Behaviour notes

- Controls are 44 (iOS) / 48 (Android) via `touchTarget()`; Switch/Checkbox rows are native buttons.
- Stacking at 1.35: `Button` gets `flex: 1 1 100%` (two in a wrapping `Row` stack); a labelled
  `Stepper` goes column; the ring label moves under the ring. `Row` itself never changes direction.
- `increaseContrast`: `Card`/`List` `border: 1px solid border`; else `none`.
- Badge: status tones draw `STATUS[tone].icon` at 12; `primary` on `tintSoft()`; `neutral` `fill` + `text-muted`.
- Chart: bars are HTML (r-xs tops, value labels above), gridlines at 0/50/100% in `separator`;
  line chart strokes are `vector-effect: non-scaling-stroke` (2.5 px); labels caption `text-muted` tabular.
- `EXAMPLE_TILES['style-gallery'].tint` is `purple` (fixture `tint: 'purple'`, `tileColor: '#662a8d'`).
