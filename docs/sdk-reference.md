# vc-sdk reference

<!-- Prompt-ready reference for an LLM generating Whim mini-apps. Mirrors src/sdk/{index,
     controls,surfaces,tokens,theme}.ts verbatim — never invents a prop/default. Hand-maintained,
     not build-generated. -->

## 1. The mini-app contract

A mini-app is **one TypeScript file** that imports **only** from `'vc-sdk'` (no `react`, no DOM,
no other module), default-exports the result of `defineApp({...})`, and uses classic JSX
(esbuild, external SDK/react resolved at runtime).

```ts
export interface AppSpec {
  name: string;                              // display name
  initial: string;                           // key into `screens` shown first
  screens: Record<string, ScreenComponent>;  // one or more screen components
  capabilities: string[];                    // declared capability set — [] for pure-compute apps
  schema?: SchemaArtifact;                   // REQUIRED iff capabilities includes 'storage'
}
```

The canonical, human-readable example exercising every component below is
`fixtures/style-gallery.app.tsx` — read it end to end before generating a new app. A minimal
Tier-0 (zero-syscall) skeleton:

```tsx
import { defineApp, Screen, Stack, Heading } from 'vc-sdk';

function Home() {
  return (
    <Screen padding="lg">
      <Stack gap="lg">
        <Heading size="title">Hello</Heading>
      </Stack>
    </Screen>
  );
}

export default defineApp({ name: 'Hello', initial: 'Home', screens: { Home }, capabilities: [] });
```

Every prop below takes a **token**, never a raw color/pixel value.

## 2. Components

### Core

| Component | Prop | Type | Default | Semantics |
|---|---|---|---|---|
| `Screen` | `padding` | `SpaceToken` | `'lg'` | Outer page padding; sets bg/text color from the theme. |
| `Stack` | `gap` | `SpaceToken` | `'md'` | Vertical flex column with `gap`. |
| `Row` | `gap` | `SpaceToken` | `'md'` | Horizontal flex row with `gap`; wraps to a new line when content overflows. |
| `Row` | `align` | `'start' \| 'center' \| 'end'` | baseline (unset) | Cross-axis alignment. |
| `Row` | `justify` | `'start' \| 'center' \| 'end' \| 'between'` | space-between (unset) | Main-axis distribution. |
| `Text` | `size` | `TextSizeToken` | `'body'` | Font size/line-height/weight from the size scale. |
| `Text` | `color` | `ColorToken` | `'text'` | Text color. |
| `Text` | `weight` | `WeightToken` | size's own weight | Overrides the size's default weight. |
| `Text` | `align` | `'start' \| 'center' \| 'end'` | unset | `textAlign`. |
| `Heading` | `size` | `'subtitle' \| 'title' \| 'display'` | `'title'` | Bold heading at the given size. |
| `Heading` | `color` | `ColorToken` | `'text'` | Heading color. |
| `NumberInput` | `label` | `string?` | — | Optional caption label above the field. |
| `NumberInput` | `value` | `number` (required) | — | Current numeric value. |
| `NumberInput` | `min` / `max` / `step` | `number?` | — | Native `<input type="number">` constraints. |
| `NumberInput` | `onChange` | `(n: number) => void` | — | Fires on every keystroke; NaN coerces to `0`. |
| `Button` | `label` | `string` (required) | — | Button text. |
| `Button` | `variant` | `'primary' \| 'secondary' \| 'ghost' \| 'danger'` | `'primary'` | Visual weight/tone. |
| `Button` | `radius` | `RadiusToken` | `'md'` | Corner radius. |
| `Button` | `disabled` | `boolean` | `false` | Suppresses press + dims to 50% opacity. |
| `Button` | `onPress` | `() => void` | — | Tap handler. |

### Controls (`controls.tsx`)

| Component | Prop | Type | Default | Semantics |
|---|---|---|---|---|
| `TextInput` | `label` | `string?` | — | Optional caption label. |
| `TextInput` | `value` | `string` (required) | — | Current text. |
| `TextInput` | `placeholder` | `string?` | — | Native placeholder. |
| `TextInput` | `onChange` | `(s: string) => void` | — | Fires on every keystroke. |
| `Switch` | `label` | `string?` | — | Optional trailing/leading label (row is the click target). |
| `Switch` | `value` | `boolean` (required) | — | On/off state. |
| `Switch` | `onChange` | `(b: boolean) => void` | — | Fires on toggle. |
| `Checkbox` | `label` | `string` (required) | — | Clickable label text. |
| `Checkbox` | `checked` | `boolean` (required) | — | Checked state. |
| `Checkbox` | `onChange` | `(b: boolean) => void` | — | Fires on toggle. |
| `Slider` | `label` | `string?` | — | Optional caption + live numeric readout. |
| `Slider` | `value` | `number` (required) | — | Current value. |
| `Slider` | `min` / `max` / `step` | `number` | `0` / `100` / `1` | Bounds for the custom pointer-driven track. |
| `Slider` | `onChange` | `(n: number) => void` | — | Fires while dragging. |
| `SegmentedControl` | `options` | `string[]` (required) | — | The segment labels (also the values). |
| `SegmentedControl` | `value` | `string` (required) | — | Currently selected option. |
| `SegmentedControl` | `onChange` | `(s: string) => void` | — | Fires on segment tap. |

### Surfaces (`surfaces.tsx`)

| Component | Prop | Type | Default | Semantics |
|---|---|---|---|---|
| `Card` | `padding` | `SpaceToken` | `'lg'` | Inner padding. |
| `Card` | `radius` | `RadiusToken` | `'lg'` | Corner radius. |
| `Card` | `onPress` | `() => void?` | — | When present, makes the whole card clickable. |
| `Divider` | — | — | — | A 1px hairline, full width. No props. |
| `Spacer` | — | — | — | A growing flex spring inside `Stack`/`Row`. No props. |
| `Grid` | `columns` | `number` | `2` | CSS grid column count. |
| `Grid` | `gap` | `SpaceToken` | `'md'` | Grid gap. |
| `Badge` | `label` | `string` (required) | — | Pill text. |
| `Badge` | `tone` | `BadgeTone` | `'neutral'` | `'neutral' \| 'primary' \| 'positive' \| 'warning' \| 'danger'`. |
| `ProgressBar` | `value` | `number` (required) | — | Fraction filled, clamped to `[0, 1]`. |
| `ProgressBar` | `tone` | `'primary' \| 'positive' \| 'warning' \| 'danger'` | `'primary'` | Fill color. |
| `List` | — | children only | — | Card-like container; auto-inserts hairlines between children. |
| `ListItem` | `title` | `string` (required) | — | Primary row text. |
| `ListItem` | `subtitle` | `string?` | — | Muted caption line under the title. |
| `ListItem` | `trailing` | `string?` | — | Muted text at the row's end. |
| `ListItem` | `onPress` | `() => void?` | — | When present, makes the row clickable. |
| `EmptyState` | `title` | `string` (required) | — | The "nothing here" headline. |
| `EmptyState` | `hint` | `string?` | — | Muted caption under the title. |
| `Modal` | `visible` | `boolean` (required) | — | Renders `null` when `false` — no imperative API. |
| `Modal` | `title` | `string?` | — | Optional sheet header. |
| `Modal` | `onClose` | `() => void` (required) | — | Fires on backdrop tap. |

### Charts (`charts.tsx`)

Pure display, no bridge traffic, no interactive marks — usable with `capabilities: []`. One
component (`Chart`), not `BarChart`/`LineChart`/`Heatmap`; the `kind` discriminant picks the
render path. Every color derives from the active theme via `color(tone)` — a theme switch
recolors with no app-side handling, and no new color token is introduced.

| Component | Prop | Type | Default | Semantics |
|---|---|---|---|---|
| `Chart` | `kind` | `'bar' \| 'line' \| 'heatmap'` (required) | — | Which chart renders. |
| `Chart` | `data` | `SeriesPoint[]` (bar/line) or `DayPoint[]` (heatmap) (required) | — | The series to plot. |
| `Chart` | `tone` | `ChartTone` | `'primary'` | `'primary' \| 'positive' \| 'warning' \| 'danger'`; resolves via `color(tone)`. |
| `Chart` | `showValues` | `boolean` (bar/line only) | `false` | Renders `String(point.value)` above each bar/point; bar's axis label always renders regardless. |
| `Chart` | `maxValue` | `number?` (bar/line only) | derived from data | Pins the scale ceiling; bar never lowers below the data max, line only raises `domainMax`. |
| `Chart` | `weeks` | `number?` (heatmap only) | `12` | Clamped to `[1, 53]` by the geometry layer; the grid anchors to the latest date in `data`, never "today". |

Empty `data` (`length === 0`) renders a fixed `160px`-tall reserved frame (never a collapse)
with a centered `text-muted` span reading exactly `"No data yet"`, for all three `kind`s.

```ts
type ChartProps =
  | { kind: 'bar' | 'line'; data: SeriesPoint[]; tone?: ChartTone; showValues?: boolean; maxValue?: number }
  | { kind: 'heatmap'; data: DayPoint[]; tone?: ChartTone; weeks?: number };

type SeriesPoint = { label: string; value: number };
type DayPoint = { date: string /* YYYY-MM-DD */; value: number };
type ChartTone = 'primary' | 'positive' | 'warning' | 'danger';
```

## 3. Tokens (the five scales)

| `SpaceToken` | `none` \| `xs` \| `sm` \| `md` \| `lg` \| `xl` |
|---|---|
| resolves to | `0`, `4px`, `8px`, `12px`, `20px`, `32px` |

| `RadiusToken` | `none` \| `sm` \| `md` \| `lg` \| `full` |
|---|---|
| resolves to | the ACTIVE theme's shape scale (`sharp`/`soft`/`round` — see §6); never a fixed px table |

| `ColorToken` | `text` \| `text-muted` \| `primary` \| `on-primary` \| `bg` \| `surface` \| `border` \| `danger` \| `positive` \| `warning` |
|---|---|
| resolves to | the ACTIVE theme's color role (see §6) |

| `TextSizeToken` | `caption` | `body` | `subtitle` | `title` | `display` |
|---|---|---|---|---|---|
| size / line | 13px / 1.35 | 16px / 1.45 | 20px / 1.3 | 28px / 1.2 | 40px / 1.1 |
| default weight | regular | regular | semibold | bold | bold |

| `WeightToken` | `regular` | `medium` | `semibold` | `bold` |
|---|---|---|---|---|
| resolves to | 400 | 500 | 600 | 700 |

## 4. Hooks & effects

| Export | Signature | One-liner |
|---|---|---|
| `useState` | `React.useState` | Standard React state hook, re-exported so apps never import `react` directly. |
| `useEffect` | `React.useEffect` | Standard React effect hook. |
| `useRef` | `React.useRef` | Stable mutable `{current}` box; no re-render on write; live-readable from an async closure. |
| `delay` | `(ms: number) => Promise<void>` | Resolves after at least `ms`; negative/non-finite `ms` never resolves (cancelled only by realm teardown). |
| `interval` | `(callback: () => void, ms: number, opts?: { running?: boolean }) => void` | Repeating timer as a hook — unmount cancels it structurally; `running: false` pauses without unmounting. |

## 5. Capability facades

Both facades ride the same one-way syscall transport and require the matching entry in
`capabilities: [...]`; an undeclared call rejects with a structured `undeclared_capability` error.

**`storage`** (requires `capabilities: ['storage']` + a `schema`):

```ts
storage.kv.get(key: string): Promise<JsonValue | undefined>
storage.kv.set(key: string, value: JsonValue): Promise<void>
storage.kv.remove(key: string): Promise<void>
storage.records.append(collection: string, record: { [field: string]: JsonValue }): Promise<{ id: number }>
storage.records.list(collection: string, query?: ListQuery): Promise<StorageRecord[]>
storage.records.update(collection: string, id: number, patch: { [field: string]: JsonValue }): Promise<void>
storage.records.remove(collection: string, id: number): Promise<void>
```

**`cues`** (requires `capabilities: ['cues']`, fire-and-forget, nothing observable back):

```ts
cues.haptic(kind: HapticKind): Promise<void>
cues.sound(name: SoundName): Promise<void>
```

## 6. Theming

A mini-app never sees the active theme — there is no `useTheme()` and no theme object in the
SDK's public surface. Every token resolver (`color()`, `radius()`, and the size/weight tables
above) reads the host-installed active theme internally and returns the right value for the
device's current preset/accent/shape automatically. **Never hardcode a hex color, a raw pixel
size, or a `font-weight` number** — always express intent through a token prop (`color="primary"`,
`gap="lg"`, `radius="md"`, …). This is what lets the same bundle render correctly across every
theme preset without a code change.
