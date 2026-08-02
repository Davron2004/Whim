## MODIFIED Requirements

### Requirement: A launched mini-app receives the active theme at delivery

When launching a mini-app, the launcher SHALL hand the fixed v2 shell theme to the delivery path so the app renders in the shell's own token values, while delivery without a theme SHALL remain valid and render SDK defaults. There is no user theme preference to resolve: the shell is fixed, identical on every device, and the delivered theme is the same on every launch.

#### Scenario: Shell and mini-app match

- **WHEN** the user opens an installed app
- **THEN** the delivered init payload SHALL carry the fixed v2 theme and the app's token-based UI SHALL render in it

#### Scenario: Theme-less delivery stays byte-identical on the bundle path

- **WHEN** a bundle is delivered with no theme (probes, invariant pages)
- **THEN** the bundle bytes and the delivery channel SHALL be unchanged from the pre-theme contract and the app SHALL render with default tokens

### Requirement: The create affordance and per-app re-prompt action open the prompt flow

The home screen SHALL carry a composer entry row reading `Describe an app…` as its create affordance, opening the prompt flow's new-app entry point on tap. The app long-press action sheet SHALL include a "Prompt again" action alongside Open/Fork/Delete/History, opening the prompt flow's edit entry point scoped to that app.

#### Scenario: The composer row opens the prompt flow
- **WHEN** the user taps the composer entry row on the home screen
- **THEN** the prompt flow's compose step opens with no app being edited

#### Scenario: Re-prompt opens the prompt flow scoped to an app
- **WHEN** the user long-presses an app tile and chooses "Prompt again"
- **THEN** the compose step opens scoped to that app

## ADDED Requirements

### Requirement: App tiles use the ghost-letterform treatment

An app tile SHALL be square with the tile radius (22px), filled solid with the app's own colour, and SHALL carry its monogram twice: once small in the foreground at the bottom-left, and once blown up, bleeding off the top-right edge, at 16% white. The tile SHALL carry a 1px inset white border at 30% opacity. The app's name SHALL render beneath the tile, never inside it.

The grid SHALL show tiles at a uniform size and SHALL NOT vary treatment per app: the app's colour is the only thing that differs between two tiles.

#### Scenario: A tile renders both letterforms

- **WHEN** an installed app's tile renders
- **THEN** its monogram appears once at readable size in the foreground and once oversized and clipped by the tile's top-right edge at 16% white

#### Scenario: Two tiles differ only by colour

- **WHEN** two installed apps' tiles are compared
- **THEN** their geometry, radius, border and monogram placement are identical and only the fill colour differs

### Requirement: A tile's colour is the app's declared colour, with a deterministic fallback

The launcher SHALL take an app's tile colour from the host-held record's manifest when the app declared one, and SHALL fall back to `appColor(name)` when it did not, when the declaration is malformed, or when it collides with a reserved status hue. The colour SHALL be read from the host-held record only — never from anything the running bundle reports about itself — and the launcher SHALL NOT hold a second name→colour mapping of its own.

Every surface that shows an app's colour — the grid tile, the history header, and an `app`-class span in prose — SHALL resolve it through this one path, so a single app is one colour everywhere.

#### Scenario: A declared colour wins

- **WHEN** an installed app's record carries a valid declared tile colour
- **THEN** its tile and every `app`-class mention of it render in that colour

#### Scenario: A pre-existing app keeps working

- **WHEN** an app installed before declarations existed is rendered
- **THEN** its colour resolves from `appColor(name)` and nothing in the grid, history, or prose errors or renders colourless

#### Scenario: The bundle cannot recolour itself

- **WHEN** a running mini-app reports a different colour than its host-held record carries
- **THEN** the launcher SHALL use the record's value

### Requirement: Shell prose renders through one shared Whim Syntax renderer

All machine-written prose on the shell surface SHALL be rendered by a single shared renderer, never by per-screen highlighting. The renderer SHALL support exactly six classes, each on one channel: `app` (that app's own hue), `chg` (weight 500, no colour), `yours` (Newsreader italic + `yours`), `measure` (mono face, no colour), `state` (the three status hues, fixed vocabulary only), and `hedge` (`faint`, a reverse highlight).

The renderer SHALL enforce the discipline rules itself rather than relying on the producer: at most **four** system marks per sentence; `yours` exempt from that cap and the only span permitted two channels at once; one channel per span; at most one coloured span per sentence; `state` never applied when a status indicator is already adjacent. Marks in excess of a cap SHALL be dropped to flat text, never truncated mid-span.

Only prose the product is telling the user SHALL be marked. Labels, buttons, settings, and headings SHALL never be marked. Prose SHALL never be lexed inside a field being typed — a prompt is highlighted only after submission.

#### Scenario: The cap is enforced at render time

- **WHEN** a sentence arrives carrying five or more system marks
- **THEN** the rendered sentence carries at most four, and the dropped spans render as flat text with their words intact

#### Scenario: One colour per sentence

- **WHEN** a sentence would resolve two coloured spans
- **THEN** only one renders coloured and the other renders flat

#### Scenario: Offering is never marked

- **WHEN** a button label, settings row, or screen heading renders
- **THEN** no Whim Syntax class is applied to it

#### Scenario: The composer is never lexed live

- **WHEN** the user is typing in the composer
- **THEN** the field renders unmarked text, and highlighting appears only after the prompt is submitted

#### Scenario: Every string survives being flattened

- **WHEN** each shell prose string is rendered with all marks removed
- **THEN** it remains unambiguous — no meaning was being carried by a mark alone

### Requirement: Four Whim Syntax classes are lexed deterministically on the device

The device SHALL determine `app`, `measure`, `yours`, and `state` itself, with no model involvement: `app` by matching the installed-app list, `measure` by a number / duration / version pattern, `yours` by matching against the stored verbatim prompt for that change, and `state` by lookup against the fixed three-word status vocabulary. The lexer SHALL be a pure function of (text, installed apps, stored prompt) and SHALL be exercised by a deterministic suite.

`chg` and `hedge` SHALL come only from the producer's marks; the device SHALL NOT infer them.

#### Scenario: The same input lexes the same way

- **WHEN** the lexer runs twice over the same text, app list, and stored prompt
- **THEN** the spans produced are identical

#### Scenario: `yours` is matched, never reconstructed

- **WHEN** the prose paraphrases the user rather than quoting them verbatim
- **THEN** no `yours` span is produced, and no approximate or reconstructed quote is marked as the user's words

#### Scenario: Status words outside the vocabulary are not marked

- **WHEN** prose uses a synonym for a status rather than one of the fixed three words
- **THEN** no `state` span is produced

### Requirement: Highlighting can be switched off

The Settings screen SHALL carry a single persisted switch that renders all shell prose flat. With it off, the renderer SHALL emit no class-bearing spans anywhere on any screen, and every string SHALL remain legible and unambiguous. The preference SHALL survive a restart, and an absent or unreadable stored value SHALL resolve to highlighting on, never to a crash.

#### Scenario: Flat everywhere, in one switch

- **WHEN** the user turns highlighting off and visits the history, plan, and build surfaces
- **THEN** no marked span renders on any of them, and no screen retains its own highlighting

#### Scenario: The preference survives restart

- **WHEN** the launcher restarts with the switch stored off, or with a corrupted stored value
- **THEN** it resolves off, or falls back to on, without crashing

### Requirement: The orb is a tapped menu whose actions are instrumented

Inside a running mini-app the shell SHALL present the orb as a tapped menu: tapping opens a list of actions, tapping the orb again closes it, and tapping the scrim dismisses it with no side effect. The menu SHALL carry only cheap, undoable actions — delete, rename, and restore SHALL NOT be reachable from it, because anything that cannot be undone with one tap belongs on a screen where it can be read.

The launcher SHALL persist a per-action tap count through its existing key-value path, so the action set can later be chosen from use rather than from opinion. No counter, count, or instrumentation value SHALL be shown on the user-facing surface.

No press-and-hold arming, directional flick, or wheel geometry SHALL exist in this change, and the menu SHALL NOT advertise one — no per-row direction hints and no "hold to flick" caption, because copy that promises an unshipped feature is forbidden on this surface.

#### Scenario: Tap opens, tap closes

- **WHEN** the user taps the orb, then taps it again
- **THEN** the menu opens and then closes, and no action fires

#### Scenario: Dismissing costs nothing

- **WHEN** the user taps the scrim behind an open menu
- **THEN** the menu closes and no action fires

#### Scenario: Taps are counted

- **WHEN** the user fires the same menu action twice across two launches
- **THEN** the persisted count for that action is two, and nothing about the count appears on screen

#### Scenario: Nothing destructive is on the menu

- **WHEN** the menu's action set is inspected
- **THEN** it contains no delete, rename, or restore action

## REMOVED Requirements

### Requirement: The launcher persists a user theme preference and restyles the shell with it

**Reason**: The six theme presets, ten accent swatches and shape variants are cut. They were scaffolding: they solve no user problem and they put the personality in the shell, where the apps should be carrying it. The shell is now fixed — paper, ink, three status hues, brown for the user's words, three faces — identical on every device and not configurable, so there is no preference to persist and no picker to render. The Settings screen keeps the server-address field and gains the highlighting off-switch (see "Highlighting can be switched off").

**Migration**: None, deliberately. Because the SDK resolves tokens rather than values (decision #13), every installed mini-app re-skins to the v2 values on next launch with no per-app palette pinning and no frozen-palette copy. A theme preference persisted under the old key is ignored; an absent or unreadable preference was always a legitimate state, so no cleanup pass runs.
