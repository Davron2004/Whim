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
import { defineApp, Screen, Stack, Text } from 'vc-sdk';

function Home() {
  return (
    <Screen padding="lg">
      <Stack gap="lg">
        <Text size="title">Hello</Text>
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
| `Screen` | `title` | `string?` | — | Adds a header: a back control on every screen above the first (calls `nav.back()`), then the title. |
| `Screen` | `action` | `{ icon: string; label: string; onPress: () => void }?` | — | A trailing icon button in the header (shown only with `title`); `label` is read to screen readers. |
| `Stack` | `gap` | `SpaceToken` | `'md'` | Vertical flex column with `gap`. |
| `Row` | `gap` | `SpaceToken` | `'md'` | Horizontal flex row with `gap`; wraps to a new line when content overflows. |
| `Row` | `align` | `'start' \| 'center' \| 'end'` | `'center'` | Cross-axis alignment. |
| `Row` | `justify` | `'start' \| 'center' \| 'end' \| 'between'` | `'start'` | Main-axis distribution. |
| `Text` | `size` | `TextSizeToken` | `'body'` | Font size/line-height/weight from the size scale. |
| `Text` | `color` | `TextColorToken` | `'text'` | Text color. |
| `Text` | `weight` | `WeightToken` | size's own weight | Overrides the size's default weight. |
| `Text` | `align` | `'start' \| 'center' \| 'end'` | unset | `textAlign`. |
| `Heading` | — | — | — | Deprecated: write `<Text size="title">`. |
| `NumberInput` | `label` | `string?` | — | Optional label above the field. |
| `NumberInput` | `value` | `number` (required) | — | Current numeric value. |
| `NumberInput` | `min` / `max` / `step` | `number?` | — | Native `<input type="number">` constraints. |
| `NumberInput` | `onChange` | `(n: number) => void` | — | Fires on every keystroke; NaN coerces to `0`. |
| `Button` | `label` | `string` (required) | — | Button text. |
| `Button` | `variant` | `'primary' \| 'secondary' \| 'ghost' \| 'danger'` | `'primary'` | `primary` fills with the app's tint: at most one per screen. `secondary` neutral fill, `ghost` tint text only, `danger` a soft red capsule for destructive actions. |
| `Button` | `icon` | `string?` | — | An icon name, drawn before the label. |
| `Button` | `disabled` | `boolean` | `false` | Suppresses press; drawn in a neutral fill with muted text. |
| `Button` | `onPress` | `() => void` | — | Tap handler. |
| `Icon` | `name` | `string` (required) | — | An icon name (`timer`, `coffee`, `heart`, …); an unknown name draws a plain circle. |
| `Icon` | `size` | `'sm' \| 'md' \| 'lg'` | `'md'` | 16 / 20 / 24 px. |
| `Icon` | `color` | `TextColorToken` | `'text'` | Icon color. |
| `Icon` | `label` | `string?` | — | What the icon means, for screen readers; omit when text beside it says it. |

### Controls (`controls.tsx`)

| Component | Prop | Type | Default | Semantics |
|---|---|---|---|---|
| `TextInput` | `label` | `string?` | — | Optional caption label. |
| `TextInput` | `value` | `string` (required) | — | Current text. |
| `TextInput` | `placeholder` | `string?` | — | Native placeholder. |
| `TextInput` | `onChange` | `(s: string) => void` | — | Fires on every keystroke. |
| `Switch` | `label` | `string?` | — | Optional label before the switch (the whole row is the target). |
| `Switch` | `value` | `boolean` (required) | — | On/off state. |
| `Switch` | `onChange` | `(b: boolean) => void` | — | Fires on toggle. |
| `Checkbox` | `label` | `string` (required) | — | Clickable label text. |
| `Checkbox` | `checked` | `boolean` (required) | — | Checked state. |
| `Checkbox` | `onChange` | `(b: boolean) => void` | — | Fires on toggle. |
| `Slider` | `label` | `string?` | — | Optional label + live numeric readout above the track. |
| `Slider` | `value` | `number` (required) | — | Current value. |
| `Slider` | `min` / `max` / `step` | `number` | `0` / `100` / `1` | Bounds for the custom pointer-driven track. |
| `Slider` | `onChange` | `(n: number) => void` | — | Fires while dragging. |
| `SegmentedControl` | `options` | `string[]` (required) | — | The segment labels (also the values). |
| `SegmentedControl` | `value` | `string` (required) | — | Currently selected option. |
| `SegmentedControl` | `onChange` | `(s: string) => void` | — | Fires on segment tap. |
| `Stepper` | `label` | `string?` | — | Label at the row's start. |
| `Stepper` | `value` | `number` (required) | — | Current value. |
| `Stepper` | `onChange` | `(n: number) => void` (required) | — | Fires on each step; holding a button repeats. |
| `Stepper` | `min` / `max` / `step` | `number` | `0` / none / `1` | Bounds and step; a button at its bound is disabled. |
| `DateInput` | `label` | `string?` | — | Optional caption label. |
| `DateInput` | `value` | `number \| null` (required) | — | Epoch milliseconds, or `null` when unset. |
| `DateInput` | `onChange` | `(ms: number \| null) => void` (required) | — | Fires with the picked value; `null` when cleared. |
| `DateInput` | `mode` | `'date' \| 'time' \| 'datetime'` | `'date'` | Opens the phone's own picker; `date` stores local midnight of the day. |
| `Picker` | `label` | `string?` | — | Optional caption label. |
| `Picker` | `options` | `string[]` (required) | — | The choices (also the values), shown in the phone's own list. For 2–4 short options use `SegmentedControl`. |
| `Picker` | `value` | `string` (required) | — | Current choice; a value not in `options` shows the placeholder. |
| `Picker` | `onChange` | `(s: string) => void` (required) | — | Fires with the chosen option. |
| `Picker` | `placeholder` | `string?` | `'Choose one'` | Shown until something is chosen. |

### Surfaces (`surfaces.tsx`)

| Component | Prop | Type | Default | Semantics |
|---|---|---|---|---|
| `Card` | `padding` | `SpaceToken` | `'lg'` | Inner padding. A card is a borderless rounded group (its colour changes inside a `Modal` by itself). |
| `Card` | `onPress` | `() => void?` | — | When present, makes the whole card clickable. |
| `Divider` | — | — | — | A 1px separator hairline, full width. No props. |
| `Spacer` | — | — | — | A growing flex spring inside `Stack`/`Row`. No props. |
| `Grid` | `columns` | `number` | `2` | CSS grid column count. |
| `Grid` | `gap` | `SpaceToken` | `'md'` | Grid gap. |
| `Badge` | `label` | `string` (required) | — | Pill text. |
| `Badge` | `tone` | `BadgeTone` | `'neutral'` | `'neutral' \| 'primary' \| 'positive' \| 'warning' \| 'danger'`; the last three carry their status icon. |
| `ProgressBar` | `value` | `number` (required) | — | Fraction filled, clamped to `[0, 1]`. |
| `ProgressBar` | `tone` | `'primary' \| 'positive' \| 'warning' \| 'danger'` | `'primary'` | Fill color. |
| `ProgressBar` | `variant` | `'bar' \| 'ring'` | `'bar'` | A thin bar, or a 120 px ring for one headline number (a timer, a count). |
| `ProgressBar` | `label` | `string?` | — | A short reading of the value (`'7'`, `'2:30'`, `'3 of 5'`): above the bar, inside the ring. |
| `List` | — | children | — | A rounded group with hairlines between its children (`ListItem`s). Static: never animates. |
| `List` | `items` | `T[]` | — | Keyed form, for rows that come and go: the data to show, with `keyBy` and `renderItem`. |
| `List` | `keyBy` | property name of `T` \| `(item: T) => string \| number` | — | Each row's unique, stable id (e.g. `keyBy="id"`). Never the array index: a list with duplicate or position keys logs a warning and does not animate. |
| `List` | `renderItem` | `(item: T, index: number) => ReactNode` | — | Renders one row, usually a `ListItem`. |
| `ListItem` | `title` | `string` (required) | — | Primary row text. |
| `ListItem` | `subtitle` | `string?` | — | Muted caption line under the title. |
| `ListItem` | `trailing` | `string?` | — | Muted text at the row's end. |
| `ListItem` | `icon` | `string?` | — | An icon name, drawn before the title. |
| `ListItem` | `onPress` | `() => void?` | — | When present, makes the row clickable and shows a trailing chevron. |
| `EmptyState` | `title` | `string` (required) | — | The "nothing here" headline. |
| `EmptyState` | `hint` | `string?` | — | Muted caption under the title. |
| `EmptyState` | `icon` | `string?` | — | An icon name, drawn large above the title. |
| `Modal` | `visible` | `boolean` (required) | — | Renders `null` when `false` — no imperative API. |
| `Modal` | `title` | `string?` | — | Optional sheet title. |
| `Modal` | `onClose` | `() => void` (required) | — | Fires on the sheet's close button, a backdrop tap or Escape; the sheet always has a close button. |

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

`DayPoint.date` is a `YYYY-MM-DD` **label string** belonging to the heatmap component, and is
unrelated to the storage `date` field type (§5), which is an epoch-millisecond integer. A stored
timestamp becomes a heatmap label only by converting it: `new Date(ms).toISOString().slice(0, 10)`.

## 3. Tokens (the five scales)

| `SpaceToken` | `none` \| `xs` \| `sm` \| `md` \| `lg` \| `xl` |
|---|---|
| resolves to | `0`, `4px`, `8px`, `12px`, `20px`, `32px` |

| `RadiusToken` | `none` \| `sm` \| `md` \| `lg` \| `full` |
|---|---|
| resolves to | `0`, `10px`, `14px`, `20px`, a full capsule |

| `ColorToken` | `text` \| `text-muted` \| `primary` \| `on-primary` \| `bg` \| `surface` \| `border` \| `danger` \| `positive` \| `warning` |
| `TextColorToken` | `text` \| `text-muted` \| `primary` \| `positive` \| `danger` \| `warning` (text on a `primary` fill is handled by the component; never pass `on-primary` to `Text`) |
|---|---|
| resolves to | the ACTIVE theme's color role (see §6) |

| `TextSizeToken` | `caption` | `body` | `subtitle` | `title` | `display` |
|---|---|---|---|---|---|
| size / line | 13px / 18px | 17px / 24px | 20px / 25px | 28px / 34px | 40px / 44px |
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
| `toast` | `(text: string) => void` | Shows a short message at the bottom for 4 s; a second call replaces the first. Call it from a handler (calls during the first render are ignored). |

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

### The storage schema artifact

An app declaring `capabilities: ['storage']` must also pass `defineApp` a `schema` — the declaration
of everything `storage.records` will hold (`storage.kv` needs none). Collections and fields
are keyed by **display name**, and each carries a burned **`id`** that is the real identity — the
`id` is the physical table or column, the display name is only a label over it. Renaming is
therefore free: change the key, keep the `id`, and the user's existing rows keep arriving in the
same place. Change the `id` and you have declared a *different, empty* table or column; the old one
stays on disk untouched, but nothing reads it any more.

```ts
type SchemaArtifact = {
  schemaVersion: 1;
  collections: {
    [displayName: string]: {
      id: string;                // burned collection id — one letter + digits, e.g. 'c1'; IS the table
      fields: {
        [displayName: string]: {
          id: string;            // burned field id, e.g. 'f1'; IS the column
          type: FieldType;
          default?: JsonValue;   // REQUIRED for a field added to a collection that already exists
        };
      };
      tombstones: string[];      // retired field ids — their data is kept, the ids never reused
    };
  };
};

type FieldType = 'text' | 'int' | 'float' | 'bool' | 'date' | 'json';
```

The six field types are the whole set. There is no undifferentiated `number` — a count and a price
are different declarations:

| Type | Holds | Written as |
|---|---|---|
| `text` | a string | `'flat white'` |
| `int` | a whole number (JS safe-integer range) | `3` |
| `float` | a fractional number | `4.25` |
| `bool` | a flag | `true` |
| `date` | a point in time, as an **epoch-millisecond integer** | `Date.now()` |
| `json` | any other JSON value; opaque, so never usable in `where`/`orderBy` | `{ tags: ['x'] }` |

**A `date` field is an epoch-millisecond INTEGER, never a formatted date string.** Writing
`'2026-08-23'` or an ISO string into one is refused at write time (`type_mismatch`). Store
`Date.now()` (or `d.getTime()`), and format only at render time:

```ts
await storage.records.append('Drinks', { at: Date.now() }); // 1755950400000 — an integer
const rows = await storage.records.list('Drinks');
const label = new Date(rows[0].at as number).toLocaleDateString();
```

Evolving the schema from one generation to the next:

- **Keep every `id` an existing concept already has** — the user's rows live under it. Mint a new id
  only for a genuinely new concept.
- A field added to a collection that already exists needs a `default`; it backfills existing rows.
- Retiring a field means dropping it from `fields` and adding its id to `tombstones`. The column and
  its data are retained: the engine never deletes, renames, or migrates stored data.
- Changing the `type` of an existing `id` is rejected. A different type means a new field, new id.

## 6. Navigation

`nav` is a stable module-scope object, not a hook — call it directly from any event handler.

```ts
nav.navigate(screenName: string): void  // pushes `screenName` (must be a key of `screens`) onto the stack
nav.back(): void                        // pops the stack; a no-op at depth 0 (the initial screen)
```

The host renders the top of the stack; there is no manual "which screen is active" state to track.
Navigating to an undeclared screen name is a no-op (logged, never thrown). Depth resets to the
`initial` screen on every realm reset (fresh generation, regeneration) — nothing about navigation
state survives across those. See `fixtures/navigation-demo.app.tsx` for the canonical list → detail
example.

```tsx
import { Button, defineApp, nav, Screen, Stack, Text } from 'vc-sdk';

function List() {
  return (
    <Screen padding="lg">
      <Stack gap="lg">
        <Text>Pick one.</Text>
        <Button label="Open detail" onPress={() => nav.navigate('Detail')} />
      </Stack>
    </Screen>
  );
}

function Detail() {
  return (
    <Screen padding="lg">
      <Stack gap="lg">
        <Text>Detail screen.</Text>
        <Button label="Back" variant="secondary" onPress={() => nav.back()} />
      </Stack>
    </Screen>
  );
}

export default defineApp({ name: 'Nav Demo', initial: 'List', screens: { List, Detail }, capabilities: [] });
```

## 7. Theming

A mini-app never sees the active theme — there is no `useTheme()` and no theme object in the
SDK's public surface. Every token resolver (`color()`, `radius()`, and the size/weight tables
above) reads the host-installed active theme internally and returns the right value for the
device's current preset/accent/shape automatically. **Never hardcode a hex color, a raw pixel
size, or a `font-weight` number** — always express intent through a token prop (`color="primary"`,
`gap="lg"`, `radius="md"`, …). This is what lets the same bundle render correctly across every
theme preset without a code change.
