## MODIFIED Requirements

### Requirement: Components resolve semantic tokens through the active theme

SDK components SHALL accept only semantic tokens (color roles, space, radius, text sizes), and token resolvers SHALL resolve them through the active host-supplied theme, falling back to the built-in default theme whenever no theme (or an invalid one) is present.

The built-in default theme SHALL be the **single fixed v2 shell theme**. There is no theme catalogue: no preset set, no accent set, and no shape variants exist to resolve against. Because every consumer resolves roles rather than values, a bundle built before this change SHALL re-render under the v2 values with no migration, no per-app palette pinning, and no code change of its own.

#### Scenario: A themed launch restyles token consumers

- **WHEN** the host supplies a valid theme at delivery and a bundle renders a component with `color="primary"`
- **THEN** the rendered value SHALL be the theme's `primary` role value, not a hard-coded constant

#### Scenario: No theme means defaults, never breakage

- **WHEN** a bundle runs with no theme supplied (baked delivery, invariant scenario pages, dev probes)
- **THEN** every token SHALL resolve to the default theme's values and rendering SHALL be unaffected

#### Scenario: A pre-existing app re-skins with no migration

- **WHEN** a mini-app built against the retired preset palette is launched after this change
- **THEN** it SHALL render under the v2 values purely through token resolution, and no per-app palette record, pinning table, or migration step SHALL exist anywhere in the delivery path

## ADDED Requirements

### Requirement: The shell token set is fixed, v2, and not themeable

The design system SHALL define exactly one shell token set, identical on every device and not user-configurable.

Shell colours SHALL be: `paper` `#fbfaf8` (screen background), `surface` `#f1efea` (cards, inputs, sheets), `border` `#e0dcd4` (1px hairlines), `ink` `#17171a` (orb, overlays, dark panels), `text` `#1c1917` (readable body text), `muted` `#6b6560` (secondary copy, hedges), `faint` `#a8a29a` (units, de-emphasised spans), `accent` `#3f3d8f` (primary actions, links), `yours` `#a15c07` (the colour of the user), `yours-on-dark` `#e0a75e`.

Status colours SHALL be exactly three and SHALL be reserved globally — no other role, and no generated mini-app's declared colour, may claim them: `working`/`done` `#0d9488`, `broken` `#b91c1c`, `waiting` `#c9c3b8`; on `ink` backgrounds `#2dd4bf`, `#f87171`, `#c9c3b8` respectively. The one exemption is the history screen's `4a` kind-badge palette (`KIND_BADGE_COLORS`): a closed, categorical label set lifted byte-exact from the design prototype, which deliberately reuses `#0d9488` for its `Added` badge. That set is not a "role" or a "declared tile colour" in the sense this requirement reserves against — it never resolves through `appColor`/theme roles and never becomes selectable as an app's identity colour — so its reuse of the hue is scoped to that one closed set and does not reopen the hue elsewhere.

Radii SHALL be: chip `999px`, field `14px`, card `18px`, tile `22px`, sheet `28px`. Spacing SHALL be: `xs` 8, `sm` 12, `md` 16, `lg` 22, `xl` 34 (px). Motion SHALL be: `breathe` `1.9s ease-in-out infinite` opacity `0.34 → 0.72` as the **only** loading motion (no shimmer sweep, no travelling gradient); sheet rise `260ms cubic-bezier(.2,.8,.2,1)`, entering from the edge the sheet will return to; and **no animation at all** for arriving text — streamed prose SHALL never be faded in or typed in per character.

The framework-default indigo `#4f46e5` SHALL NOT appear in any source token, and no theme preset, accent swatch, or shape variant SHALL be resolvable.

#### Scenario: The retired indigo is gone from source

- **WHEN** the repository's own source (excluding owner-authored invariant fixtures and archived docs) is searched for `#4f46e5`
- **THEN** no occurrence SHALL be found, and the suite SHALL fail if one is reintroduced

#### Scenario: Status hues are reserved

- **WHEN** any non-status role, or a mini-app's declared tile colour, is resolved
- **THEN** it SHALL NOT be any of `#0d9488`, `#b91c1c`, `#c9c3b8`, **except** the history screen's closed `KIND_BADGE_COLORS` set, which is exempt by name (see above) and reuses `#0d9488` for its `Added` badge deliberately

#### Scenario: There is nothing to choose between

- **WHEN** the theme module is inspected for a preset catalogue, an accent list, or a shape enum
- **THEN** none exists, and resolving a theme yields the one fixed v2 theme

### Requirement: Three faces carry the whole type system

The design system SHALL define exactly three faces, each with a single role, and a fixed type scale.

**Instrument Sans** (400/500/600/700) SHALL carry everything the interface says. **IBM Plex Mono** SHALL carry anything measured — clocks, durations, versions, counters, eyebrow labels — and SHALL NOT be used for prose. **Newsreader** SHALL be used **italic only**, exclusively for the user's own quoted words set inside a sentence the product wrote; it SHALL never be upright, never a heading, and never system copy. Space Grotesk SHALL NOT appear anywhere.

The scale SHALL be: Display — Instrument Sans 700, 34px/1, `-0.03em`; Screen title — Instrument Sans 700, 26px/1.15, `-0.025em`; Metric — IBM Plex Mono 500, 48px/1, `-0.04em`; Body — Instrument Sans 400, 15px/1.7; Body emphatic — Instrument Sans 500, 15px/1.7; Caption — Instrument Sans 400, 12px/1.55; Eyebrow — IBM Plex Mono 500, 10.5px, `+0.14em`, uppercase; Quote (inline) — Newsreader 400 italic, 17px/1.6, colour `yours`.

When the user's own words stand alone as a block rather than inside a sentence the product wrote, they SHALL be set in **Instrument Sans** in `yours`, not in Newsreader.

#### Scenario: Newsreader is italic-only

- **WHEN** any style in the shell or SDK resolves the Newsreader face
- **THEN** it SHALL also be italic, and no upright Newsreader style SHALL exist

#### Scenario: A block of the user's own words is upright brown

- **WHEN** the user's submitted words are shown as a standalone block
- **THEN** they SHALL render in Instrument Sans coloured `yours`, not in Newsreader italic

#### Scenario: The retired face is gone

- **WHEN** source is searched for `Space Grotesk`
- **THEN** no occurrence SHALL be found

### Requirement: One deterministic app-colour function is the single name→hue mapping

The design system SHALL export exactly one pure, deterministic function `appColor(name)` mapping an app's display name to a hue, and every consumer that needs an app's colour — the launcher grid, the fallback for an app with no declared colour, and the prose renderer colouring a mention of that app — SHALL import that same symbol. No second name→colour mapping SHALL exist.

Its palette SHALL be a fixed set of saturated hues that excludes the three reserved status hues, `accent`, and `yours`, so a tile can never impersonate a status meaning or the colour of the user.

#### Scenario: Grid and prose agree

- **WHEN** an app named in running prose also appears on the grid, and neither declares a colour
- **THEN** the hue used for the mention SHALL be identical to the hue used for the tile, resolved from the same function

#### Scenario: Deterministic across runs

- **WHEN** `appColor` is called twice with the same name, in different processes
- **THEN** it SHALL return the same value

#### Scenario: Reserved hues are unreachable

- **WHEN** `appColor` is evaluated over its whole palette
- **THEN** no output SHALL equal a status hue, `accent`, or `yours`

### Requirement: An app declares its one tile colour

`defineApp` SHALL accept an optional literal `tileColor` (`#rrggbb`) — the one thing the shell asks back from a generated app. It SHALL be statically extractable from the literal `defineApp` argument exactly as capabilities are, never obtained by executing or introspecting the bundle, and never restated by the model in prose. Everything else about a generated app's look SHALL remain unconstrained: no slot count, no approved palette, no validation beyond legibility and the reserved hues.

A declared colour that is absent, not a valid hex, or equal to a reserved hue SHALL be treated as no declaration, and the consumer SHALL fall back to `appColor(name)`.

#### Scenario: A declared colour is extracted statically

- **WHEN** a candidate's `defineApp` argument carries `tileColor`
- **THEN** the value SHALL appear in the extracted manifest, taken from that literal and from nowhere else

#### Scenario: An invalid declaration falls back

- **WHEN** a candidate declares a `tileColor` that is malformed or equal to a reserved status hue
- **THEN** the manifest SHALL carry no tile colour and the consumer SHALL resolve `appColor(name)` instead

### Requirement: Loading skeletons derive their geometry from exported component constants

A component whose loading state is drawn SHALL export the size constants that determine its geometry, and its skeleton SHALL import them rather than restating any value. A skeleton SHALL animate with `breathe` and no other motion.

A skeleton SHALL be shown only when the thing is genuinely coming **and** its shape is already known. It SHALL NOT be used for an empty result or for a state that may never fill. Where a count is known, the skeleton SHALL use that exact count and exact geometry; where rows stream in, the placeholder rows SHALL use varying widths, because identical bars read as a progress bar.

#### Scenario: No layout jump on load

- **WHEN** a skeleton is replaced by the real component it stands in for
- **THEN** the occupied geometry SHALL be identical, because both resolved the same exported constants

#### Scenario: Skeletons are not used for emptiness

- **WHEN** a surface has no content and none is being fetched
- **THEN** an empty-state affordance SHALL be shown, never a skeleton
