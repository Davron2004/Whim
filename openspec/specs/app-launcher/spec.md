# app-launcher Specification

## Purpose
TBD - created by archiving change launcher-shell. Update Purpose after archive.
## Requirements
### Requirement: Installed apps are persistent host-held records

The host SHALL maintain a persistent record for every installed mini-app — identity, display
name, the host-held manifest and schema artifact (#41 D4: never the bundle's
self-description), a reference to its versioned bundle, and an example flag — and the set of
installed apps MUST survive a full process kill and relaunch.

#### Scenario: Installed apps survive a restart

- **WHEN** the user has installed apps, force-stops the host, and relaunches it
- **THEN** the launcher lists the same apps with the same names, labels, and working launch

#### Scenario: The realm is bound to the record, not the bundle's claims

- **WHEN** a mini-app is launched from a record
- **THEN** the realm's capability gate enforces the record's host-held manifest, and nothing
  the bundle reports about itself alters what is granted

### Requirement: The home grid launches apps full-screen, one realm at a time

The launcher home SHALL present the installed apps as a grid; tapping an app MUST launch it
full-screen in a freshly reset realm (one WebView == one realm == one app), and leaving the
app MUST tear that realm down so no state leaks into the next launch.

#### Scenario: Tap to launch, leave to reset

- **WHEN** the user taps an app tile, uses the app, exits to the launcher, and launches a
  second app
- **THEN** each app runs full-screen in its own fresh realm and the second app observes
  nothing from the first (containment and generation fencing intact)

### Requirement: Bundles delivered from host-held records run under the unchanged containment contract

The host SHALL deliver an installed app's bundle source from its versioned record into the
runtime over the existing loader channel. The iframe-side contract — CSP, sandbox attributes,
module allowlist, channel (b) delivery, realm reset per delivery — MUST be byte-identical to
the baked-bundle path.

#### Scenario: A record-delivered app behaves identically to its baked twin

- **WHEN** the same fixture bundle is delivered once from the baked map and once from a
  host-held record
- **THEN** it renders, syscalls, and persists identically in both runs, and the containment
  verdict from the trusted vantage is unchanged

### Requirement: Deleting an app leaves no residue

The launcher SHALL offer delete on every installed app behind an explicit confirmation.
Deletion MUST remove the launcher record; the app's user data store when no other installed
entry resolves to its storage group; and its version history when no other installed entry
shares the underlying version data — leaving no unreferenced per-app storage behind. Both
shared resources are refcounted the same way (see `linked-apps`); an ungrouped app is the
sole member of its own group, so its data is removed with it exactly as before.

#### Scenario: Delete removes record, data, and history

- **WHEN** the user deletes an installed app (and no fork of it remains) and confirms
- **THEN** the app disappears from the grid, its user-data database is gone, its version
  data is gone, and relaunching the host shows no trace of it

#### Scenario: Deleting the original spares a surviving fork

- **WHEN** an app has a fork and the user deletes the original
- **THEN** the fork still launches, keeps its history, and keeps its user data — its own when
  it was forked fresh, or the group's shared data when it was forked to share

### Requirement: Forking creates an independent launcher entry

The launcher SHALL offer fork on every installed app. The fork MUST appear as a new launcher
entry carrying its provenance, MUST start from the original's current bundle, and MUST evolve
independently (its future snapshots never affect the original, per the mini-app-forking
contract). The fork MUST have its own empty user data store UNLESS the user chose at fork time
to keep using the original's saved data, in which case it joins the original's storage group
(see `linked-apps`). Code independence is unconditional; data independence is the default the
user may decline.

#### Scenario: A fork runs independently of its original

- **WHEN** the user forks an installed app, chooses to start fresh, and opens the fork
- **THEN** the fork runs the same bundle as the original at fork time, but writes to its own
  storage — data entered in the fork never appears in the original, and vice versa

#### Scenario: A fork created to share sees the original's data

- **WHEN** the user forks an installed app and chooses to use the same saved data
- **THEN** the fork still evolves its code independently, but both entries read and write one
  shared store — either one's writes are visible to the other

### Requirement: Explicit fork asks share-vs-fresh at fork time

When the user invokes the Fork action, the launcher SHALL ask one plain question before creating
the new app: use the same saved data, or start fresh. The answer SHALL be threaded to the
creation seam as the sharing decision. Rewind continuations SHALL NOT be asked (they share by
default, per `linked-apps`). All question copy SHALL come from the centralized copy table and
pass the product-verbs guard (no "clone"/"link"/storage vocabulary).

#### Scenario: Fork with shared data

- **WHEN** the user forks app A and chooses to use the same saved data
- **THEN** the new app joins A's storage group and reads A's existing data on first launch

#### Scenario: Fork starting fresh

- **WHEN** the user forks app A and chooses to start fresh
- **THEN** the new app gets its own empty database, exactly as forks behaved before this change

### Requirement: Delete tears down storage only when the group is empty

The launcher's delete flow SHALL remove the app's index entry unconditionally, and SHALL delete
the underlying database file only when no remaining installed entry resolves to the same storage
group — mirroring the existing refcount discipline used for the shared version-store repo.

#### Scenario: Deleting one member of a group

- **WHEN** two apps share a storage group and one is deleted
- **THEN** the survivor's data is intact and its launches keep working

#### Scenario: Deleting an ungrouped app

- **WHEN** an app with its own database (no sharers) is deleted
- **THEN** its database file is deleted with it, as before this change

### Requirement: First run seeds two example apps and a create affordance

On first run the launcher SHALL seed the tip splitter and water counter as installed,
example-labeled records — full citizens: launchable, forkable, deletable, snapshot-backed
from their first install — alongside a prominent "make your first app" affordance. Seeding
MUST be idempotent across restarts and MUST NOT resurrect deleted examples.

#### Scenario: A fresh install is not empty

- **WHEN** the host runs for the first time
- **THEN** the grid shows tip splitter and water counter labeled as examples plus the create
  affordance, and both examples launch and run on-device

#### Scenario: Deleted examples stay deleted

- **WHEN** the user deletes a seeded example and restarts the host
- **THEN** the example does not reappear

### Requirement: The launcher surface speaks product verbs only

Every user-facing string on the launcher surface SHALL use product vocabulary; no git
terminology, mechanism names, or internal identifiers (realm, generation, snapshot ids in
hash form) are ever shown.

#### Scenario: No mechanism vocabulary reaches the screen

- **WHEN** the user performs any launcher action (launch, fork, delete, seed-time browsing)
- **THEN** all visible text passes the product-verbs build guard with no git or mechanism
  terms

### Requirement: The launched mini-app matches the selected card
The launcher SHALL run the mini-app whose card the user tapped. Bundle delivery MUST complete only after the WebView host page is ready, so the selected bundle is delivered over channel (b) rather than the run falling through to the channel-(a) baked default.

#### Scenario: Selecting a non-default app card
- **WHEN** the user taps the Water Counter card on the home screen
- **THEN** the Water Counter mini-app renders
- **AND** the reported `appName` is "Water Counter" (not the baked `initial` default)

#### Scenario: Delivery lands before the realm reports ready
- **WHEN** a card is selected and the mini-app view mounts
- **THEN** the selected bundle source is injected after the host page load completes
- **AND** the iframe receives the selected bundle, so the reported generation reflects a channel-(b) delivery rather than the baked default

### Requirement: Card touch targets are bounded to their visual area
A card's tappable region SHALL coincide with its visible bounds. Taps that fall outside every card — including the gap between cards — MUST NOT launch any app.

#### Scenario: Tapping the gap between two cards
- **WHEN** the user taps a point in the horizontal gap between two cards, outside both cards' visible bounds
- **THEN** no mini-app is launched

### Requirement: The home screen presents an honest layout with few apps
When only a small number of apps exist, the home screen SHALL NOT present a large region of empty dead space below the grid. The area below the grid MUST be either intentionally laid out or carry an empty-state affordance.

#### Scenario: Home screen with a handful of apps
- **WHEN** the home screen renders with only a few app cards
- **THEN** the space below the grid is not an undifferentiated empty background with no affordance

### Requirement: The launcher exposes no unshipped-feature copy
User-facing launcher copy SHALL NOT promise features that are not present. Text that sets an expectation the build cannot meet (e.g. "Coming soon.") MUST NOT ship.

#### Scenario: Opening the create-app modal
- **WHEN** the user opens the "make your first app" modal
- **THEN** the modal body contains no "Coming soon." text

### Requirement: Production builds hide developer diagnostics surfaces
The shipping build SHALL NOT display developer diagnostics. Neither the DELIVERY/PAINT/CONTAINMENT diagnostics panel nor the `CONTAINED … probes` containment status bar may be visible while a mini-app is open. The dev log overlay SHALL be held to the same rule: it SHALL NOT be reachable from any surface of a shipping build, and the affordance that opens it SHALL NOT render there.

Because this project's working build recipe is a release build, in which `__DEV__` is `false`, the gate on every developer diagnostics surface SHALL be `__DEV__` **or** an explicit build-time flag that defaults to `false` — the same idiom the on-device acceptance probes already use. A surface gated on `__DEV__` alone is unreachable in the build the project actually runs, which is a defect, not compliance.

#### Scenario: Opening a mini-app in a production build
- **WHEN** a mini-app is opened in the shipping build
- **THEN** no diagnostics panel is shown
- **AND** no containment status-bar overlay is shown

#### Scenario: The log overlay is absent from a shipping build
- **WHEN** the launcher renders with the developer flag off and `__DEV__` false
- **THEN** no affordance opens the dev log overlay and no route reaches it

#### Scenario: The log overlay is reachable in a locally-built release APK
- **WHEN** the app is built with the developer flag on
- **THEN** the dev log overlay is reachable from the same developer affordance that opens the device probe screen, even though `__DEV__` is false

### Requirement: Launcher surfaces respect the system status-bar inset
In Android edge-to-edge mode, launcher and mini-app content SHALL be inset below the system status bar so app content does not draw underneath the clock, signal, and battery icons.

#### Scenario: Viewing the home screen edge-to-edge
- **WHEN** the home screen renders on Android 15+ with edge-to-edge enabled
- **THEN** the top of the app content begins below the system status bar

#### Scenario: Viewing a mini-app edge-to-edge
- **WHEN** a mini-app view renders on Android 15+ with edge-to-edge enabled
- **THEN** the top of the mini-app content begins below the system status bar

### Requirement: A launched mini-app receives the active theme at delivery

When launching a mini-app, the launcher SHALL hand the fixed v2 shell theme to the delivery path so the app renders in the shell's own token values, while delivery without a theme SHALL remain valid and render SDK defaults. There is no user theme preference to resolve: the shell is fixed, identical on every device, and the delivered theme is the same on every launch.

#### Scenario: Shell and mini-app match

- **WHEN** the user opens an installed app
- **THEN** the delivered init payload SHALL carry the fixed v2 theme and the app's token-based UI SHALL render in it

#### Scenario: Theme-less delivery stays byte-identical on the bundle path

- **WHEN** a bundle is delivered with no theme (probes, invariant pages)
- **THEN** the bundle bytes and the delivery channel SHALL be unchanged from the pre-theme contract and the app SHALL render with default tokens

### Requirement: The shell palette is a module constant, never a parameter

The launcher SHALL expose its shell palette as one module constant derived from the fixed v2 theme; no launcher component, hook, context, or helper SHALL accept a theme or palette as a prop, argument, or context value, except the fixed theme forwarded opaquely into mini-app delivery; and no launcher source SHALL name a theme picker or theme preference.

#### Scenario: A source scan finds no `ShellPalette` mention outside theme.ts, no theme context, and no theme picker mention

- **WHEN** launcher source outside `theme.ts` is scanned for the identifier `ShellPalette`, a theme context/hook, or the phrase "theme picker"
- **THEN** none exists and the suite fails naming the file if one appears

#### Scenario: A new component reads the constant and matches every other screen

- **WHEN** a new component needs shell colours
- **THEN** it imports the constant, and the rendered values are identical to every other screen

### Requirement: The create affordance and per-app re-prompt action open the prompt flow

The home screen SHALL carry a composer entry row reading `Describe an app…` as its create affordance, opening the prompt flow's new-app entry point on tap. The app long-press action sheet SHALL include a "Prompt again" action alongside Open/Fork/Delete/History, opening the prompt flow's edit entry point scoped to that app.

#### Scenario: The composer row opens the prompt flow
- **WHEN** the user taps the composer entry row on the home screen
- **THEN** the prompt flow's compose step opens with no app being edited

#### Scenario: Re-prompt opens the prompt flow scoped to an app
- **WHEN** the user long-presses an app tile and chooses "Prompt again"
- **THEN** the compose step opens scoped to that app

### Requirement: Version-store access for the prompt flow's delivery stays behind StoreAccess
The launcher SHALL deliver a generated app (install a new entry, snapshot an existing entry's own lineage, or fork a silent shared continuation) exclusively through `StoreAccess` wrapper methods; no launcher component may hold or call a raw `VersionStore` handle. Each wrapper SHALL apply the existing ensure-lineage discipline.

#### Scenario: Delivery only through StoreAccess
- **WHEN** the prompt flow installs, updates, or forks-and-updates an entry after a successful generation
- **THEN** every store interaction goes through a `StoreAccess` method that ensures the entry's lineage first

### Requirement: The Settings screen persists a server address for the prompt flow
The launcher SHALL let the user enter and persist a server address, used by the prompt flow's rewrite and generation requests. An absent or invalid address SHALL be treated as "not configured" rather than causing a crash, and the prompt flow SHALL show an honest message directing the user to Settings rather than attempting a request.

#### Scenario: Configured address is used
- **WHEN** a server address has been entered in Settings and the user submits a prompt
- **THEN** the rewrite and generation requests target that address

#### Scenario: Unconfigured address is handled honestly
- **WHEN** no server address has been entered and the user opens the prompt screen
- **THEN** the screen tells the user to set an address in Settings instead of attempting a request

### Requirement: History entry point in the app action sheet
The app long-press action sheet SHALL include a History action alongside Open/Fork/Delete, opening the app's full-screen history surface. The history screen SHALL follow the launcher's full-screen sibling pattern: its own hardware-back binding returning to Home, theme colors via the shell palette, and all strings via the centralized copy table (product-verbs guard applies).

#### Scenario: Opening history
- **WHEN** the user long-presses an app tile and chooses History
- **THEN** the app's history screen opens full-screen, and hardware back returns to Home

### Requirement: Version-store access for history flows stays behind StoreAccess
The launcher SHALL reach all history-related store verbs (history/timeline listing, restore, pin, diff, fork-from-version) exclusively through `StoreAccess` wrapper methods; no launcher component may hold or call a raw `VersionStore` handle. Each wrapper SHALL apply the existing ensure-lineage discipline before delegating, so fork entries (whose store id and lineage differ from their launcher id) resolve correctly. Fork SHALL accept an optional version so "make this version its own app" reuses the existing fork→install flow unchanged.

#### Scenario: Wrappers only
- **WHEN** the history screen lists, restores, pins, diffs, or forks
- **THEN** every store interaction goes through a `StoreAccess` method that ensures the entry's lineage first

#### Scenario: Fork entry history
- **WHEN** History is opened on a forked app entry
- **THEN** the listed versions are those of the fork's own lineage line, not the original's

### Requirement: The mini-app container styles its failure state from tokens
The mini-app container's launch-failure state SHALL resolve every colour, radius, spacing, and type value from the shell's design tokens. Hardcoded numeric style literals for font size, radius, padding, and margin SHALL NOT appear in its stylesheet, so a token change reaches this surface like every other.

The container's WebView error path SHALL report through the logging seam rather than a raw console call, carrying the native error payload as structured fields.

#### Scenario: The failure state carries no style literals
- **WHEN** the mini-app container's stylesheet is inspected
- **THEN** its font sizes, radii, paddings, and margins are token references, not numeric literals

#### Scenario: A WebView error is recorded
- **WHEN** the WebView reports a load error
- **THEN** a record is emitted on the mini-app container's channel carrying the native error's fields, and no `console.*` call is made

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

The launcher SHALL take an app's tile colour from the host-held record's manifest when the app declared one, and next from a launcher-injected colour when the app declared none but the launcher recorded one (a new install's ghost-tile id hash, preserved across rebuilds per the "Ghost tile color is a deterministic hash of the launcher id" requirement below), and SHALL fall back to `appColor(name)` only when the record carries neither a declared nor a launcher-injected colour, when the declaration is malformed, or when it collides with a reserved status hue. The colour SHALL be read from the host-held record only — never from anything the running bundle reports about itself — and the launcher SHALL NOT hold a second name→colour mapping of its own.

Every surface that shows an app's colour — the grid tile, the history header, and an `app`-class span in prose — SHALL resolve it through this one path, so a single app is one colour everywhere.

#### Scenario: A declared colour wins

- **WHEN** an installed app's record carries a valid declared tile colour
- **THEN** its tile and every `app`-class mention of it render in that colour

#### Scenario: A launcher-injected colour wins over the name hash

- **WHEN** an installed app's record carries a launcher-injected tile colour (a new install with no declared colour of its own) rather than a declared one
- **THEN** its tile and every `app`-class mention of it render in the injected colour, not `appColor(name)`

#### Scenario: A pre-existing app keeps working

- **WHEN** an app installed before declarations existed is rendered
- **THEN** its colour resolves from `appColor(name)` and nothing in the grid, history, or prose errors or renders colourless

#### Scenario: The bundle cannot recolour itself

- **WHEN** a running mini-app reports a different colour than its host-held record carries
- **THEN** the launcher SHALL use the record's value

### Requirement: Shell prose renders through one shared Whim Syntax renderer

All machine-written prose on the shell surface SHALL be rendered by a single shared renderer, never by per-screen highlighting. The renderer SHALL support exactly six classes, each on one channel: `app` (that app's own hue), `chg` (weight 500, no colour), `yours` (Newsreader italic + `yours`), `measure` (mono face, no colour), `state` (the three status hues, fixed vocabulary only), and `hedge` (`faint`, a reverse highlight).

The renderer SHALL enforce the discipline rules itself rather than relying on the producer: at most **four** system marks per sentence; `yours` exempt from that cap and the only span permitted two channels at once; one channel per span; at most one **hue** coloured per sentence; `state` never applied when a status indicator is already adjacent. Marks in excess of a cap SHALL be dropped to flat text, never truncated mid-span.

The one-hue cap is per DISTINCT colour, not per span: two coloured spans that resolve to the SAME hue (e.g. two mentions of the same app in one sentence) SHALL both render coloured. Only a second, DIFFERENT hue in the same sentence is capped — that span renders flat.

Only prose the product is telling the user SHALL be marked. Labels, buttons, settings, and headings SHALL never be marked. Prose SHALL never be lexed inside a field being typed — a prompt is highlighted only after submission.

#### Scenario: The cap is enforced at render time

- **WHEN** a sentence arrives carrying five or more system marks
- **THEN** the rendered sentence carries at most four, and the dropped spans render as flat text with their words intact

#### Scenario: One hue per sentence

- **WHEN** a sentence would resolve two coloured spans of two DIFFERENT hues
- **THEN** only one renders coloured and the other renders flat

#### Scenario: Repeated mentions of the same app keep their colour

- **WHEN** a sentence would resolve two or more coloured spans that all resolve to the SAME hue (e.g. the same app named twice)
- **THEN** every one of them renders coloured — the cap is on distinct hues, not on span count

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

### Requirement: The home grid renders ghost tiles for pending-build records

The home grid SHALL render one greyed, non-launchable tile for every pending-build record, interleaved with installed-app tiles. A ghost tile MUST NOT be tappable as a launch action — tapping it opens the build or failure screen (per the ghost interaction requirement below), never a running mini-app.

#### Scenario: A building generation shows a ghost tile

- **WHEN** a generation is in flight and the user is on the home screen
- **THEN** the grid shows a greyed tile for that pending-build record alongside the installed apps

#### Scenario: A ghost tile does not launch an app

- **WHEN** the user taps a ghost tile
- **THEN** no mini-app realm is opened

### Requirement: Building and failed/interrupted ghosts are visually distinct

A ghost tile SHALL render a state caption and visual treatment that distinguishes `building` from `failed`/`interrupted`: a `building` ghost carries a neutral in-progress treatment, while `failed` and `interrupted` ghosts carry a shared alert accent distinct from `building`.

#### Scenario: A building ghost looks different from a failed one

- **WHEN** the grid renders one `building` ghost and one `failed` ghost
- **THEN** their visual treatments differ, and each carries a state caption naming its own state

### Requirement: Ghost tile color is a deterministic hash of the launcher id, stable across transmute and undeclared rebuilds

A ghost tile's color SHALL be derived deterministically from its pending-build record's launcher id, using the same tile-color derivation the installed tile will use once delivered. When the delivered app's manifest declares no tile color of its own, the color MUST NOT change as the ghost transmutes into the delivered tile at the same grid position, nor across a later rebuild whose own manifest ALSO declares no tile color. A manifest that DOES declare a tile color — at delivery or on a later rebuild — is the app stating its own identity (`sdk-design-system`), and that declaration wins over the derived hash; a color change at delivery, or at a rebuild whose manifest declares a color, is then intended behavior, not a violation of this requirement.

#### Scenario: Same id, same color, before and after delivery

- **WHEN** a ghost tile with launcher id X is showing, and its generation is delivered as an installed app with id X whose manifest declares no tile color
- **THEN** the tile color at that position is unchanged across the transmute

#### Scenario: A manifest that declares its own color takes it at delivery

- **WHEN** a ghost tile with launcher id X is showing, and its generation is delivered with a manifest that declares its own tile color
- **THEN** the delivered tile renders the declared color rather than the id-derived one

#### Scenario: Rebuilding does not move a delivered app's color

- **WHEN** an app delivered under the id-derived color is re-prompted and rebuilt, and the rebuilt manifest declares no tile color of its own
- **THEN** the tile still renders the color it has rendered since delivery, not a name-derived one

#### Scenario: Color is deterministic for a given id

- **WHEN** the same launcher id is hashed to a tile color twice
- **THEN** both derivations produce the same color

### Requirement: A ghost tile displays a working title

A ghost tile SHALL display the pending-build record's working title (derived from the user's prompt) as its label, since no app name exists until delivery.

#### Scenario: Ghost label before a name exists

- **WHEN** a ghost tile renders for a pending-build record with no delivered app yet
- **THEN** the tile's visible label is the record's working title, not a blank or placeholder name

### Requirement: Tapping a ghost tile opens the build or failure screen by state

Tapping a `building` ghost tile SHALL reopen the build-progress screen, reattaching to the in-flight generation. Tapping a `failed` or `interrupted` ghost tile SHALL open the failure screen, hydrated from the record's persisted failure payload.

#### Scenario: Tap a building ghost

- **WHEN** the user taps a `building` ghost tile
- **THEN** the build-progress screen opens, reflecting the still-running generation

#### Scenario: Tap a failed ghost

- **WHEN** the user taps a `failed` ghost tile
- **THEN** the failure screen opens, showing the reason and diagnostics persisted on that record

#### Scenario: Tap an interrupted ghost

- **WHEN** the user taps an `interrupted` ghost tile
- **THEN** the failure screen opens, showing that the attempt was interrupted

### Requirement: Long-press on a ghost tile offers Cancel or Dismiss, never both

Long-pressing a `building` ghost tile SHALL offer a Cancel action. Long-pressing a `failed` or `interrupted` ghost tile SHALL offer a Dismiss action. A ghost tile's long-press menu MUST NOT offer both actions at once.

#### Scenario: Long-press a building ghost

- **WHEN** the user long-presses a `building` ghost tile
- **THEN** the action sheet offers Cancel and does not offer Dismiss

#### Scenario: Long-press a failed or interrupted ghost

- **WHEN** the user long-presses a `failed` or `interrupted` ghost tile
- **THEN** the action sheet offers Dismiss and does not offer Cancel

### Requirement: No always-visible cancel affordance on the ghost tile face

A ghost tile's resting visual state SHALL NOT show a cancel or dismiss control on its face. Destructive actions are reached only through long-press, never a persistent button on the tile itself.

#### Scenario: A resting ghost tile has no visible cancel control

- **WHEN** a `building` ghost tile is rendered in its resting state, not long-pressed
- **THEN** no cancel or dismiss control is visible on the tile

### Requirement: Grid composition dedupes pending and installed entries by id, pending wins

When composing the grid from pending-build records and installed-app records, an id present in both lists SHALL render exactly once, as the pending (ghost) tile, until the pending record is deleted.

#### Scenario: Transmute does not double-render

- **WHEN** a pending-build record and its just-delivered installed-app record briefly coexist under the same id during a delivery sequence
- **THEN** the grid shows exactly one tile for that id, not two

### Requirement: Rebuilding an existing app marks its installed tile as building, spawning no ghost

When the user re-prompts an existing installed app, the home grid SHALL show that app's existing installed tile in a `building` state for the duration of the generation. No separate ghost tile SHALL appear for the rebuild attempt.

#### Scenario: Re-prompting an installed app greys its own tile

- **WHEN** the user re-prompts an existing app and the generation starts
- **THEN** that app's existing tile shows a `building` state, and the grid gains no additional tile

### Requirement: Opening an app shows an immediate busy affordance
Tapping an app tile SHALL show a pressed/busy affordance on that tile immediately, persisting
until the launcher switches to the mini-app screen or the open attempt fails. A tap MUST NOT be
allowed to read as unregistered while the app's active bundle is being read.

#### Scenario: A slow open still looks alive
- **WHEN** the user taps an app tile and reading its active bundle takes noticeably long
- **THEN** the tile shows a busy affordance from the moment of the tap until the screen switches

#### Scenario: A failed open clears the busy affordance
- **WHEN** opening an app fails
- **THEN** the tile's busy affordance clears and the existing failure alert is shown

### Requirement: Fork and delete show a busy state and cannot be re-triggered mid-operation
The Fork and Delete actions SHALL each show a busy state on their triggering control while their
underlying version-store operation runs, and SHALL be disabled against re-triggering for the same
app until that operation completes (success or failure).

#### Scenario: Fork disables re-triggering
- **WHEN** the user chooses a fork option and the fork operation is still running
- **THEN** the fork action is shown busy and cannot be invoked again for that app until it
  completes

#### Scenario: Delete disables re-triggering
- **WHEN** the user confirms delete and the delete operation is still running
- **THEN** the delete action is shown busy and cannot be invoked again for that app until it
  completes

### Requirement: The mini-app container shows a boot state before first paint
The mini-app container SHALL render a branded, minimal boot state, rather than a blank WebView, between binding a realm and that realm's first paint (or a launch failure). The boot state SHALL be replaced by the running realm as soon as first paint is observed, and by the existing launch-failure state if the launch fails first.

#### Scenario: A slow-loading bundle shows a boot state, not a blank screen
- **WHEN** an app is opened and the realm has bound but has not yet reported first paint
- **THEN** the container shows the boot state rather than an empty WebView

#### Scenario: First paint replaces the boot state
- **WHEN** the realm reports its first paint
- **THEN** the boot state is no longer shown and the rendered mini-app is visible

#### Scenario: A launch failure replaces the boot state, not the other way around
- **WHEN** the realm's launch fails before any paint is observed
- **THEN** the existing launch-failure state is shown, not the boot state
