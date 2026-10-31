## MODIFIED Requirements

### Requirement: Components resolve semantic tokens through the active theme

SDK components SHALL accept only semantic tokens (colour roles, space, radius, text sizes) and resolve them through the active host-supplied theme, falling back to the built-in default theme whenever no theme (or an invalid one) is present.

The built-in default theme SHALL be the light scheme of the shared token module (`src/design/tokens.ts`) with the `slate` tint. There is no theme catalogue: no preset set, no accent set, no shape variants, and no user picker. Because every consumer resolves roles rather than values, a bundle built before this change SHALL re-render under the new values, in the phone's scheme and the app's assigned tint, with no rebuild, no per-app palette pinning, and no code change of its own.

#### Scenario: A themed launch restyles token consumers

- **WHEN** the host supplies a valid theme at delivery and a bundle renders a component with `color="primary"`
- **THEN** the rendered value SHALL be the readable text form of the theme's tint for its scheme, not a hard-coded constant

#### Scenario: No theme means defaults, never breakage

- **WHEN** a bundle runs with no theme supplied (baked delivery, invariant scenario pages, dev probes)
- **THEN** every token SHALL resolve to the default light theme and rendering SHALL be unaffected

#### Scenario: A pre-existing app re-skins with no migration

- **WHEN** a mini-app built against the v2 tokens is launched after this change on a phone in dark mode
- **THEN** it SHALL render in the dark scheme with its assigned tint purely through token resolution, and no per-app palette record or migration step SHALL exist in the delivery path

### Requirement: The host-supplied theme is inert, sanitized data

The theme crossing the host→iframe boundary SHALL be pure data: the resolved colour roles (including `sheet`, `sheet-group` and `thumb`), `scheme` (`'light'` or `'dark'`), `tint` (one of the ten tint names), `fontScale` (a number), `reduceMotion` and `increaseContrast` (booleans) and `platform` (`'ios'` or `'android'`). The SDK SHALL sanitize it field by field before use: colours against the hex pattern, `scheme`, `tint` and `platform` against their closed sets, `fontScale` clamped to 0.85–2.0, booleans by type; every invalid or missing field SHALL take its default (`light`, `slate`, 1, false, false, `android`) and the sanitizer SHALL NOT throw. The SDK SHALL read the theme once at mount; a change of the phone's settings SHALL apply at the app's next open.

#### Scenario: A malformed theme cannot corrupt rendering

- **WHEN** the theme global contains a non-hex colour, `scheme: 'sepia'`, `tint: 'chartreuse'` and `fontScale: 9`
- **THEN** the SDK SHALL use the default colour, `light`, `slate` and 2.0 respectively, and SHALL NOT throw

#### Scenario: Theme delivery adds no capability

- **WHEN** the extended theme rides the existing init frame
- **THEN** no new message kind, CSP directive, resolver entry, or bridge capability SHALL exist in the diff, and the sandbox-isolation invariants SHALL pass unmodified

#### Scenario: The chrome inset stays out of the theme

- **WHEN** the host delivers a theme together with `chromeInsetBottom`
- **THEN** the sanitized theme the bundle can read SHALL NOT contain `chromeInsetBottom`

### Requirement: The component kit renders under the unchanged containment contract

Every SDK component, including the additions of this change (`Icon`, `Stepper`, `DateInput`, `Picker`, `toast`, the `Screen` header), SHALL render via the existing React-to-DOM path with inline token-resolved styles and inline SVG only, SHALL expose no DOM concept, style, class, hex or pixel value in its props, and SHALL give each children-style `List` child wrapper unique React identity even when primitive child values repeat.

#### Scenario: The gallery app runs contained

- **WHEN** the style-gallery fixture (which uses every component) is built and delivered
- **THEN** it SHALL render through the standard loader path with the invariant suites green and no widening of any containment leg

#### Scenario: Native control chrome stays suppressed

- **WHEN** an input-bearing component (TextInput, Slider, Checkbox, DateInput, Picker) renders
- **THEN** stray native artifacts SHALL be suppressed purely via SDK styles, never via sandbox or CSP changes

#### Scenario: Repeated list primitives render without key collisions

- **WHEN** a children-style `List` receives two child strings or numbers with the same value
- **THEN** its wrappers SHALL retain unique React keys and rendering SHALL emit no duplicate-key diagnostic

## REMOVED Requirements

### Requirement: The shell token set is fixed, v2, and not themeable

**Reason**: Replaced by one token module with light and dark schemes, the ember, re-specified status hues and ten app tints (decision #75 reverses #59/#62).
**Migration**: Values come from `src/design/tokens.ts`; see "One token module is the single source of design values" and "Colour roles exist in light and dark with reserved status hues".

### Requirement: Three faces carry the whole type system

**Reason**: The shell and apps move to the system font; the custom faces are retired (decision #75).
**Migration**: See "The system font carries the whole type system".

### Requirement: One deterministic app-colour function is the single name→hue mapping

**Reason**: Apps name a tint from a closed set and the host assigns it; there is no name→hue hash.
**Migration**: See "An app names its tint and glyph, and every name resolves". `appColor` callers move to the tint resolver.

### Requirement: An app declares its one tile colour

**Reason**: A free hex `tileColor` is replaced by named `tint` and `icon`.
**Migration**: `defineApp` keeps accepting `tileColor` (deprecated); an installed hex maps to the nearest tint light value by ΔE2000.

## ADDED Requirements

### Requirement: One token module is the single source of design values

Every design value (colour roles per scheme, ember, status, tints, type scale, spacing, radii, shadows, springs, timings and layout constants) SHALL be defined once in `src/design/tokens.ts`, a pure-data module with no React Native or DOM import, and the shell, the SDK theme and the runtime page SHALL import it. The token tables in `docs/design/system.md`, the token block in `docs/design/mockups/index.html` and the palette proof's input SHALL be generated from it, and a fast-gate check SHALL fail when any of them drifts.

#### Scenario: A hand-edited doc table fails the gate

- **WHEN** someone changes `text-2`'s light value in `system.md` without changing the module
- **THEN** the token parity check SHALL fail, naming the table and both values

#### Scenario: No second source

- **WHEN** `src/host/**` and `src/sdk/**` are scanned for colour hex literals and spring configs outside the token module
- **THEN** none SHALL be found, apart from documented exemptions listed in the check

### Requirement: Colour roles exist in light and dark with reserved status hues

The token module SHALL define every colour role of `system.md` §2.1–2.3 in a light and a dark value, and the three status hues (`positive`, `danger`, `warning`) and the ember SHALL be reserved: no tint and no other role SHALL equal or approach them. Every text role SHALL reach at least 4.5:1 on the surfaces it is specified for and `border` at least 3:1 on `surface`, in both schemes, checked by the gate.

#### Scenario: Contrast floors are enforced

- **WHEN** the contrast check computes every specified text pair in both schemes
- **THEN** every pair SHALL meet its floor, and lowering `text-2` below 4.5:1 on `fill` SHALL fail the check

#### Scenario: Danger never fills a button

- **WHEN** an SDK `Button variant="danger"` renders in either scheme
- **THEN** its background SHALL be `danger-soft` with a `danger-text` label, never the `danger` fill

### Requirement: Ten named app tints with a proven palette

The token module SHALL define exactly ten tints, `slate`, `stone`, `ocean`, `blue`, `indigo`, `violet`, `purple`, `orchid`, `berry` and `rose`, each with a light and a dark value as in `system.md` §2.4. The palette proof SHALL show every tint at least 20 ΔE2000 from every status form and the ember in normal vision and at least 10 under deutan, protan and tritan simulation, and the WCAG floors of §2.4; changing a tint SHALL require rerunning the proof.

#### Scenario: The proof reads the module

- **WHEN** `palette-check.py` runs
- **THEN** it SHALL read the tint values generated from the token module and print every table with all floors met

### Requirement: The system font carries the whole type system

Text in the shell SHALL use the platform system font and text in apps SHALL use `system-ui`, on the type scale of `system.md` §2.7 with its size-specific tracking. No custom font file SHALL ship in the app, and Instrument Sans, IBM Plex Mono, Newsreader and Space Grotesk SHALL NOT appear in shell or SDK source. Counting numbers SHALL use tabular figures. Inside apps nothing SHALL render below 13 px before `fontScale`.

#### Scenario: The retired faces are gone

- **WHEN** `src/`, `android/app/src/main/assets/` and the iOS project are searched for the retired face names and `.ttf` files
- **THEN** none SHALL be found

#### Scenario: SDK caption is the in-app floor

- **WHEN** `Text size="caption"` renders with `fontScale` 1
- **THEN** its font size SHALL be 13 px with an 18 px line height

### Requirement: An app names its tint and glyph, and every name resolves

`defineApp` SHALL accept `tint` (a tint name or up to three ranked names) and `icon` (a string), both static literals extracted like `capabilities`. One shared resolver SHALL map a tint name through the alias map of `system.md` §2.4 and an icon name through the glyph alias map and keyword table of §3.1; an unknown tint SHALL fall back to the tint at (hash of the app id) mod 10 and an unknown glyph to the keyword match or `circle`, each with a build diagnostic. No name SHALL fail a build, cost a repair turn, or render blank.

#### Scenario: A legacy icon name resolves

- **WHEN** an app declares `icon: 'home'`
- **THEN** the tile SHALL show `house` and the build SHALL record an alias diagnostic, not an error

#### Scenario: An unknown tint is deterministic

- **WHEN** two builds of the same app id declare `tint: 'chartreuse'`
- **THEN** both SHALL resolve to the same tint and record a fallback diagnostic

### Requirement: One vendored icon set draws every icon

Every icon in the shell and the SDK SHALL come from one vendored Lucide subset (`lucide-static@0.460.0`, attribution kept) stored as path data: the 147-glyph set offered to the generator, the chrome set the components draw, and `circle` for fallback only. The shell SHALL draw them with `react-native-svg` and the SDK as inline SVG. No icon SHALL be a typed character or emoji.

#### Scenario: Icon renders inside the sandbox

- **WHEN** an app renders `<Icon name="timer" />`
- **THEN** an inline SVG with the vendored path SHALL render, with no network request and no CSP change

### Requirement: SDK components follow the system's defaults

SDK components SHALL take their sizes, radii, colours and states from `system.md` §7.2: capsule buttons 52 high; `Text` `color` limited to `text`, `text-muted`, `primary`, `positive`, `danger`, `warning`, each resolving to its readable text form; `Row` defaulting to `align="center"` and `justify="start"`; `Card` and `List` on `sheet-group` inside a `Modal`; status `Badge` tones carrying their icon; disabled shown as `fill` with `text-3`, never by opacity. Every control SHALL reach a 44 px (iOS) or 48 px (Android) target with real padding. Type tokens SHALL multiply by `fontScale` and paired buttons SHALL stack from 1.35.

#### Scenario: A control meets its target

- **WHEN** a `Checkbox` renders with `platform: 'android'`
- **THEN** its tappable row SHALL be at least 48 px high

#### Scenario: Increase Contrast outlines surfaces

- **WHEN** the theme carries `increaseContrast: true`
- **THEN** `Card` and `List` SHALL draw a 1 px `border` outline and `text-muted` SHALL resolve to `text`

### Requirement: The SDK adds components and deprecates without removing

The SDK SHALL add `Icon`, `Stepper`, `DateInput`, `Picker`, `toast(text)`, `Screen` `title` and `action`, `icon` on `Button`, `ListItem` and `EmptyState`, and `ProgressBar` `variant: 'ring'` and `label`, as specified in `system.md` §7.2. `Heading`, the `radius` prop of `Button` and `Card`, and `defineApp` `tileColor` SHALL keep working and SHALL be absent from `docs/sdk-reference.md`. No export SHALL be removed.

#### Scenario: An installed app using Heading still renders

- **WHEN** a bundle built before this change renders `<Heading size="title">`
- **THEN** it SHALL render as `Text size="title"` with no error

#### Scenario: Screen gives a header with automatic back

- **WHEN** an app with two screens navigates to the second and that screen has `title`
- **THEN** a header SHALL show a back control that calls `nav.back()`, and the root screen's header SHALL show none

### Requirement: Keyed lists animate and unkeyed lists stay still

`List` SHALL accept `items`, `keyBy` (a property name or a function) and `renderItem`. Rows of a keyed list that mount after the first render SHALL enter and rows that unmount SHALL leave with the motion of `system.md` M24; a children-style `List` SHALL NOT animate. Duplicate or index-shaped keys SHALL produce a development diagnostic and switch that list's motion off.

#### Scenario: Removing a keyed row animates that row

- **WHEN** an item is removed from a keyed list of three
- **THEN** only the removed row SHALL play the leave motion, and the other rows SHALL close the gap

#### Scenario: Index keys never animate the wrong row

- **WHEN** `keyBy` returns the array index
- **THEN** a diagnostic SHALL be recorded and the list SHALL update without enter or leave motion

### Requirement: SDK motion uses the shell's springs and honours Reduce Motion

The SDK SHALL play its motion with the springs of the token module, compiled at build time into CSS `linear()` easings and played through the Web Animations API, falling back to the nearest cubic-bezier when `CSS.supports('animation-timing-function', 'linear(0, 1)')` is false; retargetable motion (switch knob, segment and slider thumbs, sheet drag) SHALL run a `requestAnimationFrame` spring that keeps its velocity. With `reduceMotion: true` every component SHALL show the reduced form of `system.md` §4.5. The SDK SHALL expose no public motion API.

#### Scenario: Reduce Motion is honoured as a pair

- **WHEN** a `Modal` opens with `reduceMotion: false` and again with `reduceMotion: true`
- **THEN** the first SHALL produce a running slide animation and the second only a cross-fade

### Requirement: SDK controls emit no haptics

No SDK component SHALL trigger a haptic. An app SHALL get haptics only through `cues.haptic`.

#### Scenario: A switch toggle is silent

- **WHEN** a `Switch` is toggled in an app with the `cues` capability
- **THEN** no `cues.haptic` syscall SHALL be made

### Requirement: The style gallery shows every component and variant

`fixtures/style-gallery.app.tsx` SHALL show every exported SDK component, every variant and every prop value of a closed set, the disabled, empty and error states, and every motion preset, split into screens by topic and written idiomatically (one filled button per screen, `danger` beside a `secondary`, keyed lists). A change that adds, changes or removes an SDK component SHALL update the gallery in the same change, and a fast-gate check SHALL fail when an exported component is missing from it.

#### Scenario: A new component without a gallery entry fails

- **WHEN** a component is exported from `vc-sdk` but not used in the style gallery
- **THEN** the gallery coverage check SHALL fail, naming the component
