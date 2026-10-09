## MODIFIED Requirements

### Requirement: Deleting an app leaves no residue

The launcher SHALL offer Delete on every installed app with no confirmation dialog: the tile SHALL leave the grid at once and a toast "<name> deleted" SHALL offer Undo for 10 seconds. Undo SHALL restore the tile, record, data and history unchanged. When the Undo window ends (or, if Whim was closed during it, at the next launch) the deletion SHALL complete and MUST remove the launcher record; the app's user data store when no other installed entry resolves to its storage group; and its version history when no other installed entry shares the underlying version data, leaving no unreferenced per-app storage behind. Both shared resources are refcounted the same way (see `linked-apps`).

#### Scenario: Delete removes record, data, and history

- **WHEN** the user deletes an installed app (and no copy shares its data) and the Undo window passes
- **THEN** the app is gone from the grid, its user-data database is gone, its version data is gone, and relaunching the host shows no trace of it

#### Scenario: Undo brings it back whole

- **WHEN** the user deletes an app and taps Undo within 10 seconds
- **THEN** the tile returns in its place and the app opens with its data and history intact

#### Scenario: Closing Whim during the window still completes the delete

- **WHEN** the user deletes an app and Whim is closed before the toast ends
- **THEN** the next launch completes the purge and the app does not reappear

#### Scenario: Deleting the original spares a surviving copy

- **WHEN** an app has a copy and the user deletes the original
- **THEN** the copy still launches, keeps its history, and keeps its own user data

### Requirement: Forking creates an independent launcher entry

The launcher SHALL offer "Make a copy" on every installed app (tile menu, and History for any version). The copy MUST be created at once with no question, MUST appear as a new launcher entry carrying its provenance, MUST start from the chosen version's bundle, MUST evolve independently, and MUST have its own empty user data store under its own storage-engine appId (#43b, #52's unshared fork). A toast "Copy made" SHALL offer Open. Joining an original's storage group SHALL remain reserved to rewind continuations, which are never asked (see `linked-apps`).

#### Scenario: A copy runs independently of its original

- **WHEN** the user makes a copy of an installed app and opens it
- **THEN** the copy runs the same bundle as the original at that version but writes to its own storage; data entered in either never appears in the other

#### Scenario: No share question is asked

- **WHEN** the user taps "Make a copy"
- **THEN** no sheet asks about saved data, and the copy exists when the toast appears

## REMOVED Requirements

### Requirement: Explicit fork asks share-vs-fresh at fork time

**Reason**: "Make a copy" is immediate and always starts fresh (decision #75 amends #52 D2).
**Migration**: Copies get their own data; storage groups remain for rewind continuations. The share-question copy keys are deleted.

### Requirement: A launched mini-app receives the active theme at delivery

**Reason**: The theme now depends on the phone's scheme, text size and accessibility settings and the app's tint.
**Migration**: See "A launched app receives the theme for the phone's settings at that moment".

### Requirement: The shell palette is a module constant, never a parameter

**Reason**: The shell gains dark mode (decision #75 amends #62).
**Migration**: See "The shell follows the phone's appearance through one scheme hook".

### Requirement: History entry point in the app action sheet

**Reason**: The action sheet becomes the tile's context menu, and the orb menu becomes the Whim sheet; History is pushed on the native stack.
**Migration**: See "Tile menus follow the tile's state" and "The Whim sheet is a running app's one menu".

### Requirement: App tiles use the ghost-letterform treatment

**Reason**: Tiles become a tinted squircle with one glyph.
**Migration**: See "A tile is a tinted squircle with one glyph".

### Requirement: A tile's colour is the app's declared colour, with a deterministic fallback

**Reason**: Apps rank named tints and the host assigns one.
**Migration**: See "The host assigns each app's tint".

### Requirement: Shell prose renders through one shared Whim Syntax renderer

**Reason**: The six classes keep their roles but change channels (no mono, serif or brown).
**Migration**: See "Shell prose renders through one Whim Syntax renderer with simplified channels".

### Requirement: Four Whim Syntax classes are lexed deterministically on the device

**Reason**: The `state` vocabulary narrows to ready and failed; the rest moves into the new renderer requirement.
**Migration**: See "Shell prose renders through one Whim Syntax renderer with simplified channels".

### Requirement: Highlighting can be switched off

**Reason**: The simplified marks pass contrast and read flat; the switch is removed (decision #75).
**Migration**: The stored preference is ignored and deleted; prose always renders with marks.

### Requirement: The orb is a tapped menu whose actions are instrumented

**Reason**: The orb opens the Whim sheet; per-action tap counts are retired.
**Migration**: See "The orb is an opaque, draggable disc that opens the Whim sheet". The stored counters are deleted.

### Requirement: The home grid renders ghost tiles for pending-build records

**Reason**: Pending builds render as ember tiles with their own states.
**Migration**: See "Tiles show their state".

### Requirement: Building and failed/interrupted ghosts are visually distinct

**Reason**: Superseded by the state table of `system.md` §3.2.
**Migration**: See "Tiles show their state".

### Requirement: Ghost tile color is a deterministic hash of the launcher id, stable across transmute and undeclared rebuilds

**Reason**: A tile being made has no tint (it is an ember tile); the tint is assigned at delivery.
**Migration**: See "The host assigns each app's tint".

### Requirement: Long-press on a ghost tile offers Cancel or Dismiss, never both

**Reason**: Menus now follow each state (Stop, Discard, Try again, Details).
**Migration**: See "Tile menus follow the tile's state".

### Requirement: The mini-app container shows a boot state before first paint

**Reason**: Opening becomes a container transform out of the tile that waits for the realm's paint.
**Migration**: See "Opening an app grows out of its tile and waits for the realm's paint".

### Requirement: The home screen shows a quiet connectivity indicator

**Reason**: Replaced by a worded notice that follows connectivity live.
**Migration**: See "The home screen shows a live offline notice".

### Requirement: Settings groups its controls into titled sections, with the server address under Advanced

**Reason**: Settings is reorganised: common settings first, diagnostics on a pushed Advanced screen.
**Migration**: See "Settings puts common settings first and diagnostics under Advanced".

### Requirement: Orb and tiles render cleanly on both platforms

**Reason**: The orb and tiles are redrawn; their rendering rules move into the new requirements.
**Migration**: See "The orb is an opaque, draggable disc that opens the Whim sheet" and "A tile is a tinted squircle with one glyph".

## ADDED Requirements

### Requirement: The shell follows the phone's appearance through one scheme hook

The shell SHALL render in light or dark following the phone's appearance setting, with no in-app picker. Launcher components SHALL read colours only through one hook that returns the token module's light or dark roles for the current scheme; no component SHALL accept a palette or theme as a prop or define its own colour literal, and styles SHALL be built per scheme so a change of appearance re-renders the shell without a restart. The status bar and system bars SHALL follow the scheme.

#### Scenario: Switching the phone to dark

- **WHEN** the phone's appearance changes to dark while Whim is open on Home
- **THEN** Home re-renders with the dark roles and light status-bar content, with no restart

#### Scenario: No palette parameter

- **WHEN** `src/host/**` is scanned
- **THEN** no component takes a palette or theme prop and no colour hex literal appears outside the token module

### Requirement: A launched app receives the theme for the phone's settings at that moment

When launching an app the launcher SHALL deliver a theme built from the token module for the phone's current scheme, the app's assigned tint, the system text scale (as `fontScale`), Reduce Motion, Increase Contrast and the platform. Delivery without a theme SHALL remain valid and render SDK defaults.

#### Scenario: Shell and app match

- **WHEN** the phone is in dark mode with 135% text and the user opens an app whose tint is `ocean`
- **THEN** the app renders with the dark roles, `ocean`'s dark value as `primary`, and `fontScale` 1.35

#### Scenario: Settings changed while an app runs apply next time

- **WHEN** the phone switches to light while an app is open
- **THEN** the running app keeps its theme, and it opens in light the next time

### Requirement: A tile is a tinted squircle with one glyph

An installed app's tile SHALL be a superellipse (corner 22.5% of the side, one SVG path on both platforms) filled with its tint's light value in both schemes, carrying its glyph in white at half the tile size, with the anatomy of `system.md` §3.2: sizes 24, 40, 64 and 96 only; in dark mode a 1.5 px inner rim; with Increase Contrast a 1 px `border` outline; the name under it in two lines at most. No monogram SHALL be drawn. The glyph SHALL be hidden from screen readers and the tile's label SHALL be its name plus its state.

#### Scenario: A tile renders its glyph

- **WHEN** an app with tint `stone` and icon `coffee` is on the grid
- **THEN** its tile is a `#52443F` squircle with a white `coffee` glyph and no letters

### Requirement: The host assigns each app's tint

At install the host SHALL resolve the app's ranked tints and SHALL assign the first one not used by any installed app, else the least used, ties broken by the model's order then table order. A copy SHALL take the tint farthest (ΔE2000 of light values) from its original among the least used. A record carrying a hex `tileColor` and no tint SHALL display the tint nearest by ΔE2000. The assigned tint and resolved glyph SHALL be stored host-side and carried forward on every rebuild, and a rebuild SHALL keep them unless the person asks for a new look. Seeded examples SHALL each have a distinct tint, and no generated app SHALL be able to impersonate an example's tile by declaration alone.

#### Scenario: A new app avoids used tints

- **WHEN** installed apps use `stone` and `ocean` and a new app ranks `stone`, `rose`, `slate`
- **THEN** the new app is assigned `rose`

#### Scenario: A rebuild keeps the tile

- **WHEN** an installed app is changed and the new build ranks a different tint
- **THEN** the tile keeps its assigned tint and glyph

#### Scenario: An old hex record maps to a tint

- **WHEN** an installed record has `tileColor: '#0369a1'` and no tint
- **THEN** its tile shows the tint whose light value is nearest by ΔE2000

### Requirement: Customize tile changes an app's tint and glyph

The tile menu SHALL offer "Customize tile", opening a sheet with the ten tints and a searchable grid of the glyph set. A choice SHALL be stored host-side as an override that wins over the assigned tint and glyph and survives changes to the app.

#### Scenario: An override survives a change

- **WHEN** the user picks `violet` and `music` for an app and later changes the app
- **THEN** the tile still shows `violet` and `music`

### Requirement: Tiles show their state

The grid SHALL render one tile per installed app and per applicable pending-build record, with the states of `system.md` §3.2: being made (`ember-soft` with the ember following the stream, "Making…"), queued ("Waiting…"), failed (ember out, badge, "Didn't work"), stopped ("Stopped"), needs update ("Needs update"), changing (the app's tile with an ember ring, "Changing…"), change failed (badge, "Change didn't work"), copy ("Copy") and example ("Example"). A tile being made SHALL NOT launch an app. Its name SHALL be the plan's proposed name, else the description's first three words without a leading article. Failed and stopped attempts older than a day SHALL collapse into one tile at the end of the grid.

#### Scenario: A change in flight shows on the app's own tile

- **WHEN** the user changes an installed app and returns to Home
- **THEN** the app's own tile shows the ember ring and "Changing…", and no separate tile appears

#### Scenario: Old attempts collapse

- **WHEN** two failed attempts are more than a day old
- **THEN** one tile reading "2 didn't work" sits at the end of the grid and opens a list of them

### Requirement: Tile menus follow the tile's state

Long-pressing a tile for 350 ms SHALL open a context menu headed by the app's full name, with the rows of `system.md` §3.2 for its state (a ready app: Open, Change it, History, Make a copy, Customize tile, Share link, then Delete). No tile SHALL show a cancel or discard control on its face. Each row SHALL be its own accessibility element, and the menu SHALL be announced as a menu. Share link SHALL open the platform share sheet.

#### Scenario: VoiceOver reaches every row

- **WHEN** a VoiceOver user opens a tile's menu
- **THEN** each row is focusable and activatable on its own

#### Scenario: A tile being made offers Stop

- **WHEN** the user long-presses a tile being made
- **THEN** the menu offers Details and Stop, and nothing else

### Requirement: The home grid orders and lays out apps for every text size

Home SHALL show "Your apps" as its title, a settings icon button, and the grid in four columns of 64 pt tiles; three columns from 135% text; a list of rows with 40 pt tiles from 200%. Tiles being made SHALL come first, then failed and stopped attempts from the last day, then apps, each group newest first; an app SHALL keep its place when it changes. A search field SHALL appear under the title from 13 apps. The loading skeleton SHALL draw the title, the composer and one cell per known app in the real geometry. With no apps, Home SHALL show the still ember, "Make your first app" and three idea chips.

#### Scenario: A finished app lands where people look

- **WHEN** an app finishes while two others are still being made
- **THEN** the finished app's tile appears first among the apps, after the tiles being made

### Requirement: The home screen shows a live offline notice

When the session's connectivity state is offline, Home SHALL show the neutral notice "Offline. Your apps still work; making new ones needs a connection." under the title, and SHALL remove it as soon as connectivity returns, without a relaunch. It SHALL NOT show while the state is unknown, including before AI-data consent.

#### Scenario: Going offline and back

- **WHEN** the phone loses its connection and regains it while Home is open
- **THEN** the notice appears and then disappears with no relaunch

### Requirement: Settings puts common settings first and diagnostics under Advanced

Settings SHALL show, in order: "AI features" with the subtitle "Review what's sent", "Language", About (Privacy policy, Terms of use, Support, Version) and "Advanced". Advanced SHALL be a pushed screen with "Send error details" (its explanation as the group footer), This phone (the phone ID and "Make a new ID", per `privacy-settings`), and Server: "Whim's server" and "Your own server" as two selectable rows. Choosing Whim's server SHALL keep the saved own-server address. Typing an address SHALL send at most one health probe per typing pause. There SHALL be no Highlighting and no Reduce Motion switch.

#### Scenario: Switching back keeps the address

- **WHEN** the user switches from their own server to Whim's server and back
- **THEN** the address they entered is still there and nothing was confirmed or erased

#### Scenario: One probe per pause

- **WHEN** the user types an address and pauses
- **THEN** exactly one health probe is sent for that pause

### Requirement: The orb is an opaque, draggable disc that opens the Whim sheet

Over a running app the shell SHALL show the orb of `system.md` §7.1: an opaque 44 pt `raised` disc with the ember and a 52 pt target, resting bottom-trailing or bottom-leading inside the `chromeInsetBottom` the host reports, draggable between the two corners by momentum projection and remembered per app. It SHALL hide while the keyboard is up, on the host's own keyboard signal, and SHALL never move or hide on the app's request. It SHALL show an `ember` dot when a new version is ready or an app finished, and a `danger` dot when a change failed. Its accessibility label SHALL be "Whim menu" plus its state, with the action "Move to the other corner". No dim layer or extra shape SHALL be drawn around it.

#### Scenario: Both corners sit inside the inset

- **WHEN** the orb rests in either corner
- **THEN** it lies entirely within the bottom inset that SDK `Screen` and `Modal`'s action row pad by

#### Scenario: The keyboard hides the orb

- **WHEN** an input inside the app raises the keyboard
- **THEN** the orb fades out, and fades back when the keyboard falls

### Requirement: The Whim sheet is a running app's one menu

Tapping the orb SHALL open the Whim sheet over the running app: the app's 40 pt tile, name and "Version N · changed <when>", a "New version ready · Reload" row while one waits, a "What should change?" send field, then History, Report a problem and Back to your apps, each row its own accessibility element. Sending SHALL grow the sheet into the plan page for the change without closing the app. Report a problem SHALL push inside the sheet on its own small stack, so closing the sheet returns to the running app.

#### Scenario: Leaving through the sheet

- **WHEN** the user taps Back to your apps
- **THEN** the app closes into its tile on Home

#### Scenario: VoiceOver reads every row

- **WHEN** VoiceOver focuses the open Whim sheet
- **THEN** each row is reachable and announced on its own

### Requirement: Changing an app keeps it running and offers Reload

While a change to an open app is being made the app SHALL stay open on its current version and the orb's ember SHALL follow the stream. When the change lands a toast "<name> changed" SHALL offer Reload, which recreates the realm on the new version; nothing SHALL reload by itself. If the toast is missed, the orb's `ember` dot and the Whim sheet's "New version ready · Reload" row SHALL stay until the person reloads or reopens the app. A failed change SHALL show a `danger` dot and a toast "The change didn't work" with See why.

#### Scenario: Typing is never lost to a change

- **WHEN** a change lands while the person is typing in the app
- **THEN** the app keeps running unchanged until they tap Reload

### Requirement: Opening an app grows out of its tile and waits for the realm's paint

Opening a ready tile SHALL grow a `bg` container from the tile to the screen while the tint stays a tile-sized plate with its glyph, and the WebView SHALL stay hidden until the opening signal for that launch arrives (the generation-stamped `paint` of `sandbox-rendering`) or 600 ms pass, then fade in. "Opening…" SHALL appear under the plate only after 1.5 s. A launch failure SHALL replace the opening state. Closing SHALL shrink the app back into its tile. One WebView SHALL be kept warm in a pool, and opening SHALL NOT regress tap-to-first-paint.

#### Scenario: A stale paint does not release the opening

- **WHEN** a `paint` from a previous launch reaches the host after a new launch has bound
- **THEN** the new launch keeps its WebView hidden until its own `paint` or the 600 ms cap

#### Scenario: Dark mode never flashes colour

- **WHEN** an app opens in dark mode
- **THEN** no frame shows the tint across the full screen

### Requirement: A crashed app keeps the orb and offers a way forward

When a running app fails, the container SHALL show "<name> ran into a problem", "It stopped and can't carry on right now. Your saved data is safe.", Reload, "Ask Whim to fix it" (opening the change field prefilled with "Fix the error that stops this app." and the error text attached) and Back to your apps, and the orb SHALL stay.

#### Scenario: A crash is a change request

- **WHEN** the user taps "Ask Whim to fix it"
- **THEN** the Whim sheet opens with the prefilled request and the error attached, and the app is not closed

### Requirement: The shell plays haptics from a fixed map

The shell SHALL play haptics only for the moments of `system.md` §5 (selection moves, switch toggles, long-press menus, a drag crossing its commit point, handing work to Whim, ready, failed, delete and discard, restore and copy), through the `WhimHaptics` module on the frame of the visual change, and SHALL play none on plain taps, navigation, scrolling, typing, opening an app or a tapped sheet. RN `Vibration` SHALL NOT be imported anywhere in `src/`.

#### Scenario: Make it confirms with a haptic

- **WHEN** the user taps Make it
- **THEN** one medium impact (iOS) or `CONFIRM` (Android) plays

#### Scenario: Opening an app is silent

- **WHEN** the user taps a ready tile
- **THEN** no haptic plays

### Requirement: Shell prose renders through one Whim Syntax renderer with simplified channels

All machine-written prose on the shell SHALL render through one shared renderer with six classes on one channel each: `app` (the app's tint text colour), `chg` (weight 600), `yours` (italic in quotes, `text`), `measure` (tabular figures), `state` (only "ready" in `positive-text` and "failed" in `danger-text`) and `hedge` (`text-2`). The device SHALL lex `app`, `measure`, `yours` and `state` deterministically; `chg` and `hedge` SHALL come only from the producer's marks. The renderer SHALL enforce at most four system marks per sentence (`yours` exempt), one colour per sentence, no marks on labels, buttons, headings or a field being typed, and every string SHALL read unambiguously rendered flat.

#### Scenario: The cap is enforced at render time

- **WHEN** a producer marks five spans in one sentence
- **THEN** the renderer shows at most four marks

#### Scenario: No retired faces

- **WHEN** a `measure` or `yours` span renders
- **THEN** it uses the system font, never a mono or serif face

### Requirement: Shell copy has one name per concept and controls speak as the person

Shell copy SHALL use the glossary of `system.md` §8 (app, make, change, History, version, "Use this version", Stop, "Decide for me", "Make a copy", Your apps, Discard, Delete) and SHALL NOT use the retired words (mini-app, build, generate, fork, snapshot, restore, revert, "Prompt again"). Control labels SHALL speak as the person and SHALL NOT carry Whim's first person; Whim's "I" SHALL appear only in the maker's prose. Numbers SHALL be formatted with the app's language, never the machine locale. A fast-gate copy lint SHALL fail on a retired word or a first-person control label.

#### Scenario: A first-person button fails the lint

- **WHEN** a control label "I'll decide" is added to the copy table
- **THEN** the copy lint fails, naming the key

### Requirement: Shell motion runs on Reanimated with the named springs

Shell motion SHALL use Reanimated with the named springs and timings of the token module and the moments of `system.md` §4.4; RN `Animated`, `LayoutAnimation`, `useNativeDriver` and literal spring configs SHALL NOT appear in `src/host/`, enforced by a static check. Every animation SHALL start from the presentation value and SHALL NOT block input. With the OS Reduce Motion setting on, every moment SHALL show its reduced form.

#### Scenario: A literal spring fails the check

- **WHEN** a component passes `{ stiffness: 300, damping: 20 }` to `withSpring`
- **THEN** the static check fails, naming the file

#### Scenario: Reduce Motion replaces a morph

- **WHEN** Reduce Motion is on and the user opens an app
- **THEN** the app cross-fades in over 160 ms with no container growth
