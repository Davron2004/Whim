# vc-sdk reference

<!-- The generator's whole view of vc-sdk, sent with every generation. Mirrors src/sdk/*.tsx
     exactly: never document a prop or value the SDK rejects. Hand-maintained; the server's
     prompts suite checks every export, the deprecated section and the name lists below. -->

## 1. An app

One TypeScript file. It imports only from `'vc-sdk'` (never `react` or the DOM) and default-exports
`defineApp({...})`:

```ts
defineApp({
  name: string;                    // 24 characters or fewer
  initial: string;                 // the key of `screens` shown first
  screens: Record<string, () => JSX.Element>;
  capabilities: string[];          // [], or any of 'storage' (§7) and 'cues' (§8)
  schema?: SchemaArtifact;         // required when capabilities includes 'storage'
  tint: string | [string] | [string, string] | [string, string, string];  // tile tints, best first
  icon: string;                    // tile glyph
});
```

The tint names, the glyph list and the tile rules are in the tile section of these instructions.

```tsx
import { defineApp, Screen, Stack, Text } from 'vc-sdk';

function Home() {
  return (
    <Screen title="Hello">
      <Stack>
        <Text>Ready when you are.</Text>
      </Stack>
    </Screen>
  );
}

export default defineApp({ name: 'Hello', initial: 'Home', screens: { Home }, capabilities: [], tint: 'ocean', icon: 'smile' });
```

Components take tokens (§6), never a colour, pixel size or style, and look right with no optional
props: their spacing, colours, sizes, light and dark, text size and motion are built in. The
app's tint is `primary`.

## 2. Layout

```ts
Screen   { title?: string; action?: { icon: string; label: string; onPress: () => void }; padding?: Space /* 'lg' */ }
Stack    { gap?: Space /* 'md' */ }                 // vertical
Row      { gap?: Space /* 'md' */; align?: 'start' | 'center' | 'end' /* 'center' */; justify?: 'start' | 'center' | 'end' | 'between' /* 'start' */ }
Grid     { columns?: number /* 2 */; gap?: Space /* 'md' */ }
Card     { padding?: Space /* 'lg' */; onPress?: () => void }
Spacer   {}                                         // takes the free space in a Stack or Row
Divider  {}                                         // a full-width hairline
```

- Every screen is one `Screen`. With `title` it gets a header: a back control on every screen
  above the first (it calls `nav.back()`, so write no Back button), the `action` icon button at
  the end (`label` is read aloud), and the title.
- `Row` wraps onto a new line when its content is too wide.
- `Card` is a rounded group; inside a `Modal` it changes colour by itself. With `onPress` the whole
  card is the target.

## 3. Text and icons

```ts
Text  { size?: 'caption' | 'body' | 'subtitle' | 'title' | 'display' /* 'body' */; color?: TextColor /* 'text' */;
        weight?: 'regular' | 'medium' | 'semibold' | 'bold' /* the size's own */; align?: 'start' | 'center' | 'end' }
Icon  { name: string; size?: 'sm' | 'md' | 'lg' /* 'md' */; color?: TextColor /* 'text' */; label?: string }
```

- `TextColor` is `'text' | 'text-muted' | 'primary' | 'positive' | 'danger' | 'warning'`.
- `display` is for one big number and uses tabular figures.
- `Icon` is 16, 20 or 24 px. Give it a `label` unless text beside it says the same thing.
- An icon name (`Icon name`, and `icon` on `Button`, `ListItem`, `EmptyState` and `Screen action`)
  is any glyph from the tile list, or one of these interface icons: `chevron-left`,
  `chevron-right`, `chevron-down`, `arrow-left`, `arrow-up`, `x`, `check`, `plus`, `minus`,
  `ellipsis`, `settings`, `search`, `copy`, `share`, `external-link`, `info`, `circle-alert`,
  `triangle-alert`, `circle-check`. An unknown name draws a plain circle.

## 4. Buttons and inputs

```ts
Button            { label: string; onPress?: () => void; variant?: 'primary' | 'secondary' | 'ghost' | 'danger' /* 'primary' */; icon?: string; disabled?: boolean }
TextInput         { value: string; onChange?: (s: string) => void; label?: string; placeholder?: string }
NumberInput       { value: number; onChange?: (n: number) => void; label?: string; min?: number; max?: number; step?: number }
Stepper           { value: number; onChange: (n: number) => void; label?: string; min?: number /* 0 */; max?: number; step?: number /* 1 */ }
Slider            { value: number; onChange?: (n: number) => void; label?: string; min?: number /* 0 */; max?: number /* 100 */; step?: number /* 1 */ }
Switch            { value: boolean; onChange?: (b: boolean) => void; label?: string }
Checkbox          { label: string; checked: boolean; onChange?: (b: boolean) => void }
SegmentedControl  { options: string[]; value: string; onChange?: (s: string) => void }
Picker            { options: string[]; value: string; onChange: (s: string) => void; label?: string; placeholder?: string /* 'Choose one' */ }
DateInput         { value: number | null; onChange: (ms: number | null) => void; label?: string; mode?: 'date' | 'time' | 'datetime' /* 'date' */ }
```

- `Button`: `primary` fills with the tint, so use at most one per screen; `secondary` is a neutral
  fill, `ghost` tint text only, `danger` a soft red button for deleting. Two buttons in a `Row`
  stack by themselves at large text sizes.
- `NumberInput` turns an empty or unreadable entry into `0`. `Stepper` changes a value by `step`
  with minus and plus (holding one repeats); `Slider` shows its value beside the label.
- `SegmentedControl` (2 to 4 short options) and `Picker` (longer lists) use each option string as
  its value.
- `DateInput` opens the phone's own picker. Its value is epoch milliseconds or `null`; `date` mode
  gives local midnight of the chosen day.

## 5. Lists, status and overlays

```ts
List        { children }                                                    // static rows
List<T>     { items: T[]; keyBy: IdKey<T> | ((item: T) => string | number); renderItem: (item: T, index: number) => ReactNode }
ListItem    { title: string; subtitle?: string; trailing?: string; icon?: string; onPress?: () => void }
EmptyState  { title: string; hint?: string; icon?: string }
Badge       { label: string; tone?: 'neutral' | 'primary' | 'positive' | 'warning' | 'danger' /* 'neutral' */ }
ProgressBar { value: number /* 0 to 1 */; tone?: 'primary' | 'positive' | 'warning' | 'danger' /* 'primary' */; variant?: 'bar' | 'ring' /* 'bar' */; label?: string }
Modal       { visible: boolean; onClose: () => void; title?: string }
Chart       { kind: 'bar' | 'line'; data: { label: string; value: number }[]; tone?: ChartTone; showValues?: boolean; maxValue?: number }
          | { kind: 'heatmap'; data: { date: string /* 'YYYY-MM-DD' */; value: number }[]; tone?: ChartTone; weeks?: number /* 12 */ }
toast(text: string): void
```

- `List` is a rounded group with hairlines between `ListItem`s. For rows that come and go, use
  `items` + `keyBy` + `renderItem`, keyed by a unique, stable id: `IdKey<T>` is the name of a
  string or number property of `T` (`keyBy="id"`). Added and removed rows then move. Never key by
  the array index.
- `ListItem` with `onPress` gets a chevron and is the whole row's target; `trailing` is short
  muted text at the end.
- `EmptyState` is what a list shows before it has anything.
- `Badge` status tones carry their own icon. `ProgressBar` `ring` is a 120 px ring for one
  headline number (a timer, a count); `label` is a short reading of the value (`'7'`, `'2:30'`,
  `'3 of 5'`), inside the ring or above the bar.
- `Modal` is a bottom sheet; it renders nothing while `visible` is false. Its close button, a tap
  outside, a drag down and Escape all call `onClose`.
- `Chart` only displays (`ChartTone` is the `ProgressBar` tone set). Empty `data` shows
  "No data yet". A heatmap date is a label: turn a stored timestamp into one with
  `new Date(ms).toISOString().slice(0, 10)`.
- `toast` shows a short message at the bottom for 4 s; a second call replaces it. Call it from a
  handler: calls during the first render are ignored.

## 6. Tokens

| Token | Values |
|---|---|
| `Space` | `none` 0, `xs` 4, `sm` 8, `md` 12, `lg` 20, `xl` 32 (px) |
| `TextColor` | `text`, `text-muted`, `primary`, `positive`, `danger`, `warning` |
| text `size` | `caption`, `body`, `subtitle` (semibold), `title` (bold), `display` (bold) |
| `weight` | `regular`, `medium`, `semibold`, `bold` |

## 7. State, timers and storage

```ts
useState, useEffect, useRef                       // React's own
delay(ms: number): Promise<void>                  // resolves after at least ms
interval(callback: () => void, ms: number, opts?: { running?: boolean }): void
```

`interval` is a hook: call it unconditionally in a component; unmounting stops it and
`running: false` pauses it. Never use `setTimeout`, `setInterval` or `requestAnimationFrame`.

`storage` needs `capabilities: ['storage']` and a `schema`; every call returns a Promise:

```ts
storage.kv.get(key: string): Promise<JsonValue | undefined>
storage.kv.set(key: string, value: JsonValue): Promise<void>
storage.kv.remove(key: string): Promise<void>
storage.records.append(collection: string, record: { [field: string]: JsonValue }): Promise<{ id: number }>
storage.records.list(collection: string, query?: {
  where?: { [field: string]: JsonValue | { gt?: JsonValue; gte?: JsonValue; lt?: JsonValue; lte?: JsonValue } };  // all must match
  orderBy?: { field: string; direction: 'asc' | 'desc' };
  limit?: number; offset?: number;
}): Promise<({ id: number } & { [field: string]: JsonValue })[]>
storage.records.update(collection: string, id: number, patch: { [field: string]: JsonValue }): Promise<void>
storage.records.remove(collection: string, id: number): Promise<void>
```

`storage.kv` holds settings and single values; `storage.records` holds rows declared in the
schema. Collections and fields are named by their display names.

### The storage schema artifact

```ts
type SchemaArtifact = {
  schemaVersion: 1;
  collections: {
    [displayName: string]: {
      id: string;              // burned collection id: a letter and digits, e.g. 'c1'
      fields: { [displayName: string]: { id: string /* e.g. 'f1' */; type: FieldType; default?: JsonValue } };
      tombstones: string[];    // ids of retired fields
    };
  };
};
type FieldType = 'text' | 'int' | 'float' | 'bool' | 'date' | 'json';
```

The `id` is where the data lives; the display name is only a label over it. Renaming is free:
change the name, keep the `id`. A new `id` is a new, empty column or table.

| Type | Holds | Written as |
|---|---|---|
| `text` | a string | `'flat white'` |
| `int` | a whole number | `3` |
| `float` | a fractional number | `4.25` |
| `bool` | a flag | `true` |
| `date` | a time as an **epoch-millisecond integer** | `Date.now()` |
| `json` | any other JSON value; never usable in `where` or `orderBy` | `{ tags: ['x'] }` |

A `date` field refuses a date string: store `Date.now()` or `d.getTime()` and format only when
showing it (`new Date(row.at as number).toLocaleDateString()`).

When changing an app's schema:

- Keep every existing `id`; the person's rows live under it. Mint a new id only for a new concept.
- A field added to an existing collection needs a `default`, which fills the existing rows.
- Retire a field by removing it from `fields` and adding its id to `tombstones`; its data stays.
- Never change the `type` of an existing `id`: a different type is a new field with a new id.

## 8. Navigation and cues

```ts
nav.navigate(screen: string): void   // pushes a key of `screens`
nav.back(): void                     // pops; nothing happens on the first screen
```

`nav` is a plain object: call it from any handler. There are no route parameters, so keep what
the next screen needs in module-level state or storage before navigating. The navigation stack
starts again at `initial` whenever the app reloads.

```tsx
import { defineApp, List, ListItem, nav, Screen, Stack, Text } from 'vc-sdk';

const TRAILS = [{ id: 'cedar', name: 'Cedar Loop' }, { id: 'ridge', name: 'Ridge Walk' }];
let chosen = TRAILS[0];

function Trails() {
  return (
    <Screen title="Trails">
      <List items={TRAILS} keyBy="id" renderItem={(trail) => (
        <ListItem title={trail.name} onPress={() => { chosen = trail; nav.navigate('Trail'); }} />
      )} />
    </Screen>
  );
}

function Trail() {
  return (
    <Screen title={chosen.name}>
      <Stack>
        <Text>Shaded path with a creek overlook.</Text>
      </Stack>
    </Screen>
  );
}

export default defineApp({ name: 'Trails', initial: 'Trails', screens: { Trails, Trail }, capabilities: [], tint: 'stone', icon: 'map' });
```

`cues` needs `capabilities: ['cues']`; each call fires and forgets:

```ts
cues.haptic(kind: 'tap' | 'double' | 'heavy'): Promise<void>
cues.sound(name: 'tick' | 'chime' | 'alarm'): Promise<void>
```

A call to a capability the app did not declare is refused.

## 9. Motion and theme

Presses, navigation, `Modal`, `toast`, `ProgressBar` changes, the controls and the rows of a keyed
`List` move by themselves and follow the phone's Reduce Motion setting. There is no animation API:
never animate with timers or state. Light and dark, text size and contrast come from the phone;
an app never reads or sets them.

## Deprecated

Still working in old apps, never written in new ones: `Heading` (write `<Text size="title">`) and
the `radius` prop of `Button` and `Card` (ignored; leave it out).
