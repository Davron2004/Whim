# Components

Phase B of `design-system-v1`. Every component the launcher draws and every component the SDK gives the
generator: anatomy, variants, states, tokens, motion and accessibility, plus what the SDK gains and loses.
Token names are the ones fixed in `01-direction.md`; springs are the six in §9.2 there; motion moments are
numbered in `05-motion.md`.

Two rules hold for both halves:

- **One look, two renderers.** A launcher button and an SDK button share size, shape, type and motion.
  The launcher draws with React Native, the SDK with DOM inside the sandbox.
- **Colour follows "hue says who"** (`01-direction.md` §2.2). The launcher's prominent fills are ember
  (Whim works) or ink (the system); an app's prominent fill is its tint.

## Part 1: launcher components

### Button

| | |
|---|---|
| Anatomy | Capsule; optional 20pt leading icon; label |
| Variants | `ember` (fill `ember`, label `on-ember`): hands work to Whim. `ink` (fill `ink`, label `on-ink`): the system's main action. `tint` (the app's fill and on-fill): enters an app. `secondary` (fill `fill`, label `text`). `plain` (no fill, label `text`, weight 600). `plain-danger` (no fill, label `danger-text`) |
| Sizes | Large 52 (bottom actions, full width), medium 44, small 34 |
| Type | Large and medium `headline` 17/22 600; small `callout` 15/20 600 |
| States | Pressed: scale 0.97 on touch-down (`instant`), back with `snappy`; filled variants also darken 8%. Disabled: `fill` background and `text-3` label, never an opacity over colour. Busy: label changes to the busy words ("Sending…") and the button takes no taps; no bare spinner. Focus: 2pt ring in `text`, 2pt outside the capsule |
| Rules | One filled button per screen. A bottom action may have one `plain` action under it. Labels wrap to two lines rather than truncate; the button grows (`minHeight`, never `height`) |
| A11y | Role button; the busy and disabled states are announced |

Three prominent fills is not the "two primary colours" defect the capture lists (`INDEX.md` §4.6): today
violet and black are assigned screen by screen with no rule; now the fill says who acts next, and one screen
never shows two of them.

Replaces `PrimaryAction`, the inline buttons in `DoneStep`, `FailureScreen`, `AgeScreen`, `TermsScreen`,
`ConsentScreen`, `UpdateRequiredScreen`, `ReportSheet`, `MiniAppView` and the History action buttons: six
treatments and five heights today.

### Icon button

44 × 44 target. Two looks: `plain` (icon only, `text`) and `filled` (36pt `fill` circle behind the icon).
Icon 24 in headers, 20 elsewhere. Pressed scale 0.92. Always has an accessibility label. Used for back,
close, more, settings and send.

### Back control

Leading edge of every non-root header, 44 × 44. iOS shows `chevron-left`, Android `arrow-left`; same place,
same size. iOS adds the interactive edge swipe and Android predictive back (`05-motion.md` M13). Replaces the
"Back" text link and History's 42pt circle.

### Header

| | |
|---|---|
| Row | 44pt high under the status bar: back control, then nothing in the middle, then up to two icon buttons or one text button at the trailing edge |
| Large title | Root screens (Your apps, Settings) use `largeTitle` 34; flow steps and pushed screens use `title1` 28. Set 4pt under the row at the 20pt gutter, with an optional `callout` `text-2` subtitle 4pt under it |
| Scrolled | When the title scrolls under the row, an inline `headline` title fades in on the row (`fade-in`): centred on iOS, after the back control on Android. Content fades out over 16pt under the row; no hairline |

### Sheet

The one presentation container. Report, App link, the Whim sheet, the making flow, confirmations and the
tile menu's longer questions are all sheets.

| | |
|---|---|
| Surface | `raised`, top corners `r-xl` 28, `shadow-raised`; dark adds the 1px top highlight |
| Grabber | 36 × 5, `fill-strong`, 6pt from the top edge, always shown |
| Header | Optional `title2` title at the gutter, 12pt under the grabber; a close icon button (`x`) at the trailing edge on both platforms, so there is always a visible way out |
| Detents | `fit` (content height, up to 92% of the screen) and `large` (92%). The making flow uses `large` |
| Scrim | `scrim`, with opacity following the sheet's position |
| Gestures | Drag down from the grabber, header or a scroll view at its top. Release projects with the momentum function and dismisses past half the height or above 800 pt/s down; otherwise it springs back (`fling`). Dragging up past the top detent rubber-bands (constant 0.55). Crossing the dismiss point gives a haptic (`01-direction.md` §10) |
| Keyboard | The sheet lifts with the keyboard using the keyboard's own curve, and its scroll area pads by the keyboard height |
| Close | Scrim tap, the close button, Android back, Escape on a hardware keyboard, or the drag |
| Motion | Present and dismiss `smooth`, along the same path (M11) |
| A11y | Modal: focus moves to the title, the rest of the screen is hidden from screen readers, the close button reads "Close" |

Replaces `SheetModal`, `ConfirmSheet`'s Modal, Home's `ActionSheet`, `RunDetailsSheet` and the orb's menu:
five implementations, three animations, five scrims.

### Confirm sheet

A `fit` sheet for the few things that can't come back. Title `title2` ("Delete Pour Timer?"); body `body`
`text-2` saying exactly what will be lost; then the safe choice as a large `ink` button ("Keep it") and the
consequential choice as `plain-danger` under it ("Delete"). Confirming a destructive action plays the
warning haptic. Used for: delete an app, make a new phone ID, use your own server. Not used for going back to
a version or making a copy any more; those happen at once and offer Undo (`06-ux.md`). Replaces the native
`Alert` that deletes apps today (`HomeScreen.tsx:133-139`).

### Context menu

Long-press on a tile, after 350 ms: the tile lifts (scale 1.06, `shadow-floating`, `snappy`) above a
`scrim`, the medium impact plays, and a menu card grows out of the tile's edge.

| | |
|---|---|
| Card | `raised`, `r-lg` 20, `shadow-raised`, width 248, placed under the tile (above it when there's no room), 8pt away |
| Rows | 48pt; 20pt icon in `text-2` then label `body` in `text`; a separator then the destructive row in `danger-text` |
| Steps | A row can turn the card into a second step in place, with a back row at the top (Make a copy asks "Keep using the same data?" this way) |
| Motion | Grows from the tile edge, scale 0.92 → 1 with opacity (`smooth`); closes with `fade-out` and scale 0.96 (M12) |
| A11y | Each row a button; the menu is announced as a menu with the app's name |

Rows per tile state are in `04-mini-app-icons.md`. Replaces the eight-row centred action sheet in the capture
(`android/09-home-tile-menu-with-dismiss-light.png`).

### Toast

A capsule (`raised`, `shadow-floating`, max width 360, min height 48, padding 12 × 16) at the bottom, 12pt
above whatever floats there (composer, orb, safe area). Text `callout`; an optional action as a `headline`
600 text button in `text` (or `ember-text` when the action asks Whim for something). Stays 4 s, or 6 s with an
action, and pauses while touched. Swipe down to dismiss. Rises and sinks with `smooth`. Announced politely to
screen readers. Used for Undo after going back to a version, "Copy made · Open", "Pour Timer changed ·
Reload", "Link copied".

### Chip

| | |
|---|---|
| Shape | Capsule 36 high (44 target), 14pt side padding, `callout` 15/20 500 |
| Unselected | `fill` background, `text` label |
| Selected | `ink` background, `on-ink` label, a 16pt `check` icon before the label, for single and multiple choice alike, so selection never depends on colour alone |
| "I'll decide" | Unselected: `fill` with an `ember-text` label and a 12pt eyeless ember before it. Selected: `ember-soft` background, `ember-text` label, `check`. It is selected by default on every question |
| Suggestion | `fill`, `text` label, no selected state; tapping fills the field |
| Motion | Press scale 0.96; the fill changes over 150 ms; selection plays the selection haptic |

Replaces four pill styles (compose suggestions, clarify answers, History filters, report reasons).

### Text field and text area

| | |
|---|---|
| Field | `surface` background, 1px `border` (3.37:1 on light surface), `r-md` 14, padding 12 × 14, text `body` 17 so the person types at reading size |
| Area | Same, padding 14 × 16, minimum three lines, grows to eight, then scrolls |
| Label | `footnote` 600 `text-2`, 6pt above |
| Placeholder | `text-3` |
| Focus | Border becomes 2pt `text` (ink: the field is yours) |
| Error | 2pt `danger`, helper line in `danger-text`, an icon before it |
| Extras | Single-line fields get a clear button when not empty; the send-style area (the Whim sheet) gets a 32pt `ember` send button inside its trailing edge |
| Keyboard | A focused field always scrolls to sit 16pt above the keyboard, in screens and sheets alike (`ios/35` shows the server field under the keyboard today) |

### Grouped list

The settings-style list used by Settings, Advanced, the Whim sheet and the tile menu's longer steps.

| | |
|---|---|
| Group | `surface`, `r-lg` 20, no border; separators `separator` inset 16 from the leading edge (52 when rows have icons) |
| Row | Min height 52, padding 12 × 16. Optional leading 20pt icon in `text-2`. Title `body`, optional subtitle `footnote` `text-2` |
| Trailing | One of: value (`callout` `text-2`), `chevron-right` in `text-3`, a switch, `external-link` in `text-3`, a copy button |
| Pressed | Row background `fill`, instant in, 150 ms out |
| Destructive row | Title in `danger-text`, no icon colour change |
| Section header | `footnote` 600 `text-2`, sentence case, 8pt above the group, at the gutter |
| Section footer | `footnote` `text-2`, 8pt under the group |

Switches in the shell are the platform's own (`UISwitch`, Material switch) with the on-track in `ink`.

### App tile

Anatomy, geometry and the nine states are in `04-mini-app-icons.md`. Component props: `app`, `state`,
`size` (`grid` 64/68, `menu` 40, `inline` 24, `hero` 96 for the ready moment), `activity` (0–1, drives the
ember while making or changing). Exports its geometry so the home skeleton draws the same cells.

### Composer bar

The home screen's way in. A capsule 52 high, `raised` with `shadow-floating`, full width inside the gutters,
12pt above the bottom safe area. Leading: the eyeless ember at 20pt. Then "Make an app…" in `body` `text-2`.
The whole bar is one button; it morphs into the Describe sheet (M6). Not a real text field, so the keyboard
never opens on the home screen by accident.

### Wisp

Props: `size`, `pose` (`listening`, `thinking`, `making`, `stuck`, `failed`, `done`, `asleep`), `activity`
(0–1). Draws the silhouette, the gradient, the glow and, at 48pt and up, the eyes (`01-direction.md` §8.2).
Eyes are hidden from screen readers; the component takes an accessibility label from its parent's status
line instead. With Reduce Motion it shows three still states (working, quiet, stuck).

### Orb

A 44pt `raised` disc with `shadow-floating`, the eyeless ember at 20pt in the middle, 52pt target, 16pt
from the trailing edge and the bottom safe area. The realm is told it covers 44 + 16 + the inset. States: at
rest (still), making a change for this app (the ember follows the stream), change failed (an 8pt danger dot
at the top-right), change ready (one flare, then the toast). Tap opens the Whim sheet (M21). Accessibility
label "Whim menu", plus the state. While the app's content scrolls down, the orb shrinks to
its 24pt ember with no disc and fades to 0.6, and it returns when scrolling stops or reverses (M28). The
realm reports only the scroll direction, as one more one-way frame next to the nav-depth frame; a hostile app
can make the orb shrink, never vanish, and it stays tappable at every size. It is opaque at every size, so
nothing shows through it (today's translucent disc lets the app's text bleed through, `android/217`).

### Status line

What `WorkingLine` becomes: an 8pt ember dot (or a 24pt wisp where there's room) driven by the stream, then
the phrase in `callout` `text-2`, then the elapsed time in tabular figures. With `stuck`, the dot turns
`text-3` and stops.

### Step list

The making view's four steps. 20pt icon then `body` label, 12pt between rows. Done: `circle-check` in
`text`, label `text-2`. Current: an 8pt ember dot inside a 20pt ring, label `text` 600, elapsed time trailing.
Waiting: an empty 20pt ring in `text-3`, label `text-3`. Steps never animate in; the current marker moves with
`snappy`.

### Plan row and question row

| | |
|---|---|
| Plan row | A grouped-list row with a `footnote` 600 `text-2` label ("What it is", "Main screen") over `body` 17/24 text, and a 16pt `pencil` in `text-3` at the trailing edge. Tap edits in place: the text becomes a text area, Save (`ink`, small) and Cancel (`plain`, small) appear under it |
| Question row | The question as `headline`, an optional `footnote` hint ("Pick any that fit"), then chips that wrap, ending with the "I'll decide" chip and, when the question allows it, an "Other" field |
| Edited row | The person's words show as typed, and a small "Edited" label replaces the pencil |

### Notice

An inline callout for server notices: `r-md`, `fill` background (neutral) or `danger-soft` (danger), a 20pt
`info` or `circle-alert` icon, `callout` text, and an optional retry countdown in tabular figures. Replaces
`ServiceNotice`'s bordered card.

### Timeline row (History)

| | |
|---|---|
| Rail | A 2pt `separator` line at x = 27 with a 10pt dot per version; the current version's dot is `ink` with a 3pt `bg` ring |
| Content | Your words as `body` italic in quotes (`text`); Whim's summary as `callout` `text-2` through the prose renderer; then a meta line in `footnote` `text-2` with tabular figures ("v7 · 2 days ago") and a kind chip |
| Kind chip | `caption` 500 in `text-2` on `fill`, with a 12pt icon: `plus` Added, `pencil` Changed, `minus` Removed, `palette` Look, `wrench` Fixed, `flag` Start. No colours (`01-direction.md` §2.2) |
| Current | A `Current` badge (`ink`, `on-ink`) on the row instead of "↑ YOU'RE ON THIS ONE" |
| Expanded | Tap expands in place (`smooth`). Past versions: "Go back to this version" (`secondary`, medium) and "Make a copy from here" (`plain`). Current version: "Change it" (`ember`, medium) |

### Skeleton

Blocks in `fill-strong` with the geometry of the thing they stand in for (exported constants, as today), the
`breathe` loop after 300 ms, static with Reduce Motion. The home skeleton draws the real 4-column cells with
label bars, fixing today's 88pt jump (`flow-skeletons.tsx:62-75`).

## Part 2: SDK components

Everything below renders inside the sandbox from tokens the host sends as inert theme data
(`01-direction.md` §3.5): the scheme and the app's tint. No component takes a style, a class, a hex or a
pixel value. Defaults are chosen so the most common use needs no optional props.

### What the SDK gains and loses

| Change | What | Why |
|---|---|---|
| Add | `Icon` | Apps look unfinished without icons; the 147 names are the tile set, already familiar to models |
| Add | `Stepper` | Counts (glasses, reps, players) are the most common input in the corpus and today need a NumberInput plus two Buttons |
| Add | `DateInput` | Trackers need dates and times; today they hack `TextInput`. The value is epoch milliseconds, the storage `date` type, so nothing converts |
| Add | `Picker` | Choosing one of many (more than four options) without a wall of buttons; renders the platform's native picker |
| Add | `toast(text)` | A module-level function like `nav`, for "Saved" and "Logged" feedback after an action |
| Add | `Screen` `title` and `action` | A standard header: title, automatic back control when the app's stack is deeper than one, and one optional action. Gives iOS a visible back inside apps |
| Add | `Button` `icon`, `ListItem` `icon`, `EmptyState` `icon` | One optional icon where people expect one |
| Add | `ProgressBar` `variant: 'ring'` and `label` | Timers and goals want a ring with a number in it |
| Add | `defineApp` `tint` and `icon` | The tile (`04-mini-app-icons.md`); `tint` also becomes the app's `primary` |
| Change | `Row` defaults to `align="center"`, `justify="start"` | Today's `baseline` + `space-between` flings two children to opposite edges unless the model remembers `justify` |
| Change | Sizes, colours, radii and motion of every component | One system with the shell |
| Deprecate | `Heading` | `Text` with `size="title"` is the same thing. Kept as an alias so installed apps still render; gone from the reference |
| Deprecate | `Button` `radius`, `Card` `radius` | Buttons are capsules and cards `r-lg`; the prop is accepted and ignored |
| Deprecate | `defineApp` `tileColor` | Replaced by `tint`; old values map to the nearest tint |
| Reject | `Reveal`, `useMotion`, `Morph`, `useReducedMotion` | The motion that matters is built into components. A public motion API invites the generator to animate everything, every name costs prompt tokens, and Reduce Motion is safer enforced inside components. Revisit when a real app needs more |
| Reject | `TabBar` | Fights the orb for the bottom edge; `SegmentedControl` switches views |
| Reject | `Image`, confetti, `Canvas` | No image source exists without a new capability; confetti is decoration; `Canvas` is #13's escape hatch for a later decision |

Net surface: 27 components, the `nav`, `storage`, `cues` and new `toast` objects, the three hooks, `delay`
and `interval`. No export is removed, so every installed bundle keeps working.

**The style gallery mirrors all of it.** `fixtures/style-gallery.app.tsx` shows every component, every
variant, every state worth seeing (disabled, empty, error) and every new prop. A change that adds, changes or
removes an SDK component is not done until the gallery shows it, and the OpenSpec change carries that as a
task in every chain that touches the SDK.

### Screen

| | |
|---|---|
| Props | `title?: string`, `action?: { icon: IconName; label: string; onPress: () => void }`, `padding?: SpaceToken = 'lg'` |
| Renders | `bg` background, 17px system font. With `title`: a header row (back control when the app's stack is deeper than one, then `action` as an icon button at the trailing edge) and the title as `title1` 28 under it |
| Back | The back control calls `nav.back()`. On iOS an edge swipe from the leading 20px tracks the finger and pops; at the root it asks the host to close the app with the closing morph (M3) |
| Insets | Bottom padding adds the orb's footprint as today, so the last element can scroll clear of it |
| Motion | `nav.navigate` pushes the new screen from the trailing edge (`smooth`, previous screen −30% with a 0.12 dim); `nav.back` reverses it. Reduce Motion: cross-fade |

### Stack, Row, Grid, Spacer, Divider

Layout only. `Stack` gap default `md` (12). `Row` gap `md`, now `align="center"`, `justify="start"`, still
wrapping. `Grid` unchanged. `Divider` is a `separator` hairline. `Spacer` unchanged.

### Text

| Prop | Values |
|---|---|
| `size` | `caption` 13/18, `body` 17/24 (default), `subtitle` 20/25 600, `title` 28/34 700, `display` 40/44 700 |
| `color` | Any colour role; `primary` uses the tint's text form, so it stays readable |
| `weight` | `regular`, `medium`, `semibold`, `bold` |
| `align` | `start`, `center`, `end` |

`display` uses tabular figures by default, since it is almost always a number. Tracking per size from
`01-direction.md` §4.2.

### Button

| | |
|---|---|
| Props | `label`, `onPress`, `variant: 'primary' \| 'secondary' \| 'ghost' \| 'danger' = 'primary'`, `icon?: IconName`, `disabled?` |
| Look | Capsule 50 high, label 17 600. `primary`: tint fill and on-tint label. `secondary`: `fill` and `text`. `ghost`: no fill, tint text. `danger`: `danger` fill and its on-colour |
| States | Press scale 0.97 on pointer-down, back with `snappy`. Disabled: `fill` and `text-3` |
| A11y | Native `<button>`; `disabled` attribute |

### TextInput and NumberInput

Field anatomy from Part 1, inside the app: 17px text, `footnote` label, 1px `border`, focus ring in the app's
tint. `NumberInput` sets `inputmode="decimal"` and tabular figures. Both keep `user-select: text` inside an
otherwise unselectable screen.

### Stepper (new)

| | |
|---|---|
| Props | `label?`, `value`, `onChange`, `min = 0`, `max?`, `step = 1` |
| Look | A row: label in `body` on the left; on the right a capsule group with `minus`, the value in tabular `subtitle`, and `plus`. Buttons 44 × 36, `fill` background |
| Behaviour | A tap changes by `step`; holding repeats after 400 ms at 8 steps per second; buttons disable at the bounds. Each step plays the selection haptic through the host |
| Motion | The number rolls 6px up (increase) or down (decrease) with a cross-fade, `snappy` |
| A11y | Role `spinbutton` with min, max and value; the buttons are labelled "Decrease" and "Increase" |

### DateInput (new)

`label?`, `value: number | null` (epoch ms), `onChange`, `mode: 'date' | 'time' | 'datetime' = 'date'`. A field
showing the value formatted for the phone's locale, with a `calendar` or `clock` icon; tapping opens the
platform's own picker through the native input. Writes straight into a storage `date` field.

### Picker (new)

`label?`, `options: string[]`, `value`, `onChange`, `placeholder?`. A field with a `chevron-down`; opens the
platform's own list. For two to four options the reference points to `SegmentedControl` instead.

### Switch

Track 48 × 28, `fill-strong` off and the tint on; a 24pt white knob with a small shadow. The whole row is the
target, with the label as `body` `text` on the left (today the label is muted caption). Knob and track move
with `snappy`; the change plays the selection haptic. Role `switch`.

### Checkbox

24pt box, `r-sm` corners, 2px `border`; checked fills with the tint and draws a white `check` (stroke drawn on
over 160 ms). Label `body` `text`, whole row the target. Role `checkbox`.

### Slider

Track 6pt, `fill-strong`, filled part in the tint; thumb 28pt white with `shadow-raised`; optional label and
value (tabular) above. The thumb follows the pointer 1:1 with pointer capture; a tap on the track springs the
thumb there (`snappy`). With 20 steps or fewer, each step plays the selection haptic.

### SegmentedControl

A capsule track (`fill`, 36 high) with a `surface` thumb (`shadow-raised`) under the selected option; labels
`callout` 600 in `text`. The thumb slides with `snappy` and can be retargeted mid-flight. Selection haptic.
Role `radiogroup`.

### Card

`surface`, `r-lg`, padding `lg` 20, no border. With `onPress`: press scale 0.98 and pointer cursor. Nesting a
`List` inside a `Card` no longer draws two outlines, because neither has one.

### List and ListItem

`List` is an inset group: `surface`, `r-lg`, `separator` hairlines inset 16. `ListItem`: `title`,
`subtitle?`, `trailing?`, `icon?`, `onPress?`; min height 52; pressed background `fill`; a `chevron-right`
appears when `onPress` is set. Rows that mount after the first render rise 8px and fade in (`smooth`); rows
that leave fade out (`fade-out`) before their space closes (`smooth`). Keys come from the app's own `key`
props; without keys, rows appear without motion rather than animating the wrong one.

### Badge

Capsule, `caption` 12/16 600, padding 3 × 9, soft fill with the tone's text colour: `neutral` (`fill` /
`text-2`), `primary` (tint soft / tint text), `positive`, `warning`, `danger` (their soft and text pairs).
`warning` is now yellow, not grey.

### ProgressBar

`value` 0–1, `tone`, and new `variant: 'bar' | 'ring' = 'bar'` and `label?`. Bar: 6pt, `fill-strong` track,
no border. Ring: 120pt, 10pt stroke with round caps, `label` centred in tabular `title`. Value changes move
with `smooth`.

### EmptyState

`icon?`, `title`, `hint?`. The icon at 32pt in a 64pt `fill` circle, title `subtitle`, hint `callout`
`text-2`, centred, 32pt of padding.

### Modal

A sheet with the Part 1 anatomy: grabber, `title2` title, a close button that always calls `onClose`, drag to
dismiss, scrim. Present and dismiss `smooth`; Reduce Motion cross-fades. Today's modal pops in, has no close
button and closes only from the backdrop.

### Chart

Unchanged in kind (bar, line, heatmap). Colours come from the tint; gridlines `separator`; labels `footnote`
`text-2` in tabular figures; bars get `r-xs` top corners. Charts don't animate: they are data people read.

### Icon (new)

`name: IconName`, `size: 'sm' | 'md' | 'lg' = 'md'` (16, 20, 24), `color?: ColorToken = 'text'`, `label?`
(without a label the icon is decorative to screen readers). Inline SVG from the vendored set.

### toast (new)

`toast(text: string): void`. Shows a capsule at the bottom, above the orb's footprint, for 3 s; a second call
replaces the first. Announced to screen readers. Calls during the first render are ignored.

### Built-in feel

What a generated app gets without asking:

- Press feedback on every pressable; the right haptics on toggles, segments, steps and slider detents.
- Screen push and pop, Modal, List row and toast motion, all interruptible.
- Light and dark from the phone, and the app's tint on every `primary`.
- Reduce Motion handled inside each component.

Haptics from controls go through the host as UI feedback without the `cues` capability, rate-limited to one
per 50 ms. They are only selection-strength. A bundle can forge the UI event that triggers one, so the worst
a hostile app can do is tick the phone a few times a second, which it could annoy you with in many other
ways already. Heavier haptics and all sounds stay behind `cues`.
