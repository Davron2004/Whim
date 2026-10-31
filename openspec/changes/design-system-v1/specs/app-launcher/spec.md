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

#### Scenario: Deleting the original spares a surviving fork

- **WHEN** an app has a copy and the user deletes the original
- **THEN** the copy still launches, keeps its history, and keeps its own user data

### Requirement: Forking creates an independent launcher entry

The launcher SHALL offer "Make a copy" on every installed app (tile menu, and History for any version). Before creating the copy the launcher MUST ask "Copy the data, or start fresh?" (owner ruling 2026-10-09; skipped, starting fresh, when the original has never saved any user data). The copy MUST appear as a new launcher entry carrying its provenance, MUST start from the chosen version's bundle, MUST evolve independently, and MUST have its own user data store under its own storage-engine appId (#43b) — either a one-time copy of the original's data (change `copy-app-data`) or empty. A copy never shares data with its original. A toast "Copy made" SHALL offer Open. While a copy is being made the app's tile SHALL read busy and open no menu, so a second copy of that app cannot start until the first settles; a copy that cannot be made SHALL say so in one toast and add no tile. Joining an original's storage group SHALL remain reserved to rewind continuations, which are never asked (see `linked-apps`).

#### Scenario: A fork runs independently of its original

- **WHEN** the user makes a copy of an installed app and opens it
- **THEN** the copy runs the same bundle as the original at that version but writes to its own storage; data entered in either never appears in the other

#### Scenario: A fork created to share sees the original's data

- **WHEN** the user changes an app while it is on an older version, so the change lands as a new launcher entry continuing from that version
- **THEN** no question is asked, the new entry evolves its code independently, and it reads and writes the original's store; "Make a copy" never creates such an entry

#### Scenario: The copy-or-fresh question is asked

- **WHEN** the user taps "Make a copy" on an app that has saved data
- **THEN** a sheet asks "Copy the data, or start fresh?"; either answer creates a copy with its own storage, and no option shares data with the original

#### Scenario: Nothing to copy

- **WHEN** the user taps "Make a copy" on an app that has never saved any data
- **THEN** no question is asked and the copy starts fresh

#### Scenario: A second copy cannot start mid-copy

- **WHEN** a copy of an app is still being made and the user long-presses that app's tile
- **THEN** the tile reads busy, no menu opens, and only one copy is made

### Requirement: The create affordance and per-app re-prompt action open the prompt flow

The home screen SHALL carry a composer bar reading `Make an app…` as its create affordance, opening the prompt flow's new-app entry point on tap. A ready app's tile menu SHALL include a "Change it" action, opening the prompt flow's change entry point scoped to that app.

#### Scenario: The composer row opens the prompt flow

- **WHEN** the user taps `Make an app…` on the home screen
- **THEN** the prompt flow's Describe page opens with no app being changed

#### Scenario: Re-prompt opens the prompt flow scoped to an app

- **WHEN** the user long-presses an app tile and chooses "Change it"
- **THEN** the Describe page opens scoped to that app

### Requirement: The launcher exposes no unshipped-feature copy
User-facing launcher copy SHALL NOT promise features that are not present. Text that sets an expectation the build cannot meet (e.g. "Coming soon.") MUST NOT ship.

#### Scenario: Opening the create-app modal
- **WHEN** the user taps `Make an app…` and the making sheet opens on its Describe page
- **THEN** the page contains no "Coming soon." text

### Requirement: The Settings screen persists a server address for the prompt flow
Every build of the launcher SHALL let the user point Whim at their own server: an optional override of the compiled-in production server (see `release-config`), used by every request the launcher sends, including reports and diagnostics. The choice SHALL be the Server group of the pushed Advanced screen: "Whim's server" and "Your own server" as two selectable rows. The override SHALL be honoured only while "Your own server" is chosen and only after the user has confirmed, once per install, that the chosen server sees everything Whim sends, that its operator decides what it keeps, and that Whim's privacy policy doesn't cover it; the first choice of "Your own server" SHALL ask for that confirmation in a confirm sheet. Until that acknowledgement is recorded, a saved address (including one saved by an earlier build) SHALL stay unread and every request SHALL go to the compiled-in server. The address field SHALL show only while "Your own server" is chosen. While an address is saved, a caption under the field SHALL restate that the user's server is the user's responsibility. A blank address SHALL mean "no override" and SHALL never cause a crash. An `http://` address SHALL be accepted only for a loopback or private-range IP literal (loopback, RFC 1918, link-local, IPv6 unique-local, carrier-grade NAT), `localhost`, a `.local` name or a single-label host that isn't numeric; any other host SHALL require `https://`, and a refused address SHALL be explained inline and not saved. Choosing "Whim's server" SHALL send every request to the compiled-in server and SHALL keep both the saved address and the acknowledgement, so choosing "Your own server" again uses that address with nothing to confirm. The field's placeholder SHALL name the default server's host so the user can see what "no override" means.

#### Scenario: Configured address is used
- **WHEN** the user has confirmed the acknowledgement, chosen "Your own server", entered a server address and submits a prompt
- **THEN** the clarify, rewrite, generation and report requests target that address

#### Scenario: No override uses the default server
- **WHEN** no server address has been entered and the user submits a prompt with consent granted
- **THEN** the requests target the compiled-in production server, and no "set an address in Settings" message is shown

#### Scenario: The acknowledgement comes first
- **WHEN** a user opens Advanced for the first time and taps "Your own server"
- **THEN** a confirm sheet explains that the server sees everything Whim sends and that Whim's privacy policy doesn't cover it; "Keep Whim's server" leaves Whim's server chosen with no field and no override, and confirming chooses "Your own server" and shows the field

#### Scenario: An address from an earlier build waits for the acknowledgement
- **WHEN** a build starts on a phone where an earlier build saved an override and no acknowledgement is recorded
- **THEN** every request targets the compiled-in production server, and Settings shows the saved address only after the user confirms

#### Scenario: Plain http only for a local server
- **WHEN** the user enters `http://192.168.1.20:8787`, then `http://example.com`, then `http://8.8.8.8`
- **THEN** the first is saved and used, and the other two are refused inline with a note that non-local servers need `https://`

#### Scenario: Going back to the default
- **WHEN** an address is saved and the user chooses "Whim's server"
- **THEN** the next request targets the compiled-in production server, and choosing "Your own server" again shows the saved address and uses it with no second acknowledgement

### Requirement: Tapping a ghost tile opens the build or failure screen by state
Tapping a tile being made (a `building` pending record, queued or not) SHALL open the making sheet on that run's own page, its Making page while it runs, reattaching to the in-flight generation with no new request; a `building` record with no run left in this process SHALL open nothing. Tapping a failed, stopped or needs-update attempt's tile (a `failed` or `interrupted` record) SHALL open the making sheet's Failure page, hydrated from its current store view under prompt-flow's persisted/volatile failure rules. The tile-menu rows that show an attempt (`system.md` §3.2) SHALL open the same pages. Pending app-link routing SHALL consume the same current records and open the same handler as tapping the tile; a volatile failed entry SHALL NOT route to stale building or missing behavior. Tile and app-link failure opening SHALL honor persisted `journalUnavailable: true` after a fresh launcher instance or process restart; lifecycle still comes only from the current pending record.

#### Scenario: Tap a building ghost

- **WHEN** the user taps a tile being made
- **THEN** the making sheet opens on its Making page, reflecting the still-running generation

#### Scenario: Tap a failed ghost

- **WHEN** the user taps a failed attempt's tile
- **THEN** the Failure page opens, showing the verified persisted reason and diagnostics or the store-retained generic failure as applicable

#### Scenario: Tap an interrupted ghost

- **WHEN** the user taps the tile of an attempt that was stopped or that Whim was closed under
- **THEN** the Failure page opens, saying the attempt was stopped or that Whim closed during it

#### Scenario: A link opens a retained failed attempt

- **WHEN** an app link targets a current volatile failed entry whose raw state is building or whose raw key was partially removed during Discard
- **THEN** the same generic failure and recovery actions open as for tapping its tile, with no new generation request

#### Scenario: Cold generic failure keeps its durable report guard

- **WHEN** Home or an app link opens a persisted generic failed record marked journalUnavailable after restart while an old raw journal still exists
- **THEN** the Failure page opens without that old report and the tile stays failed; journal availability does not change its lifecycle state

### Requirement: Grid composition dedupes pending and installed entries by id, pending wins
When composing the grid from pending-build records and installed-app records, an id present in both lists SHALL render exactly once, as the attempt's tile, until the pending record is deleted. A pending record that changes an installed app SHALL NOT be a tile of its own: it shows on that app's tile (see "Tiles show their state").

#### Scenario: Transmute does not double-render

- **WHEN** a pending-build record and its just-delivered installed-app record briefly coexist under the same id during a delivery sequence
- **THEN** the grid shows exactly one tile for that id, not two

### Requirement: Opening an app shows an immediate busy affordance
Tapping a ready app's tile SHALL show a busy affordance on that tile immediately (the tile dims and reads busy to assistive technology), persisting while the app's active bundle is read, until the app starts growing out of its tile or the open attempt fails. From then on "Opening an app grows out of its tile and waits for the realm's paint" governs the plate, the WebView's reveal and the "Opening…" label. A tap MUST NOT be allowed to read as unregistered while the app's active bundle is being read, and while the tile is busy a second tap SHALL start no second open and a long-press SHALL open no menu.

#### Scenario: A slow open still looks alive
- **WHEN** the user taps an app tile and reading its active bundle takes noticeably long
- **THEN** the tile shows a busy affordance from the moment of the tap until the app starts growing out of it

#### Scenario: A failed open clears the busy affordance
- **WHEN** opening an app fails
- **THEN** the tile's busy affordance clears and the existing failure alert is shown

## REMOVED Requirements

### Requirement: Explicit fork asks share-vs-fresh at fork time

**Reason**: A copy never shares data with its original (decision #75 amends #52 D2); "Make a copy" asks "Copy the data, or start fresh?" instead (owner ruling 2026-10-09).
**Migration**: See "Forking creates an independent launcher entry": a copy gets its own data, copied or empty; storage groups remain for rewind continuations. The share-question copy keys are deleted.

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

### Requirement: A ghost tile displays a working title

**Reason**: Ghost tiles are replaced by tiles being made, whose name rule lives with the tile states.
**Migration**: See "Tiles show their state" (the plan's proposed name, else the description's first three words without a leading article).

### Requirement: No always-visible cancel affordance on the ghost tile face

**Reason**: Ghost tiles are replaced by tiles being made; the rule now covers every tile.
**Migration**: See "Tile menus follow the tile's state": no tile shows a cancel or discard control on its face, and Stop and Discard are tile-menu rows.

### Requirement: Rebuilding an existing app marks its installed tile as building, spawning no ghost

**Reason**: A change in flight is now the app tile's `changing` state (ember ring, "Changing…"), defined with the other tile states.
**Migration**: See "Tiles show their state", scenario "A change in flight shows on the app's own tile".

### Requirement: Fork and delete show a busy state and cannot be re-triggered mid-operation

**Reason**: Delete no longer runs while the person waits: it takes the tile off the grid at once with a 10-second Undo and purges when the window ends, so there is nothing to show busy or re-trigger. Make a copy asks "Copy the data, or start fresh?" first.
**Migration**: Delete: see "Deleting an app leaves no residue". Copy: see "Forking creates an independent launcher entry", which carries the busy tile and the refusal of a second copy mid-copy.

### Requirement: First run seeds two example apps and a create affordance

**Reason**: First run now seeds three examples (the style gallery joined tip splitter and water counter), and the create affordance is the composer bar, not a "make your first app" affordance.
**Migration**: See "First run seeds the example apps and a create affordance".

### Requirement: Text input never hides the content or action it belongs to

**Reason**: The compose screen is now the making sheet's Describe page, which opens with the keyboard up (`prompt-flow` "Describe opens with the keyboard"); the old scenario "Compose opens without the keyboard" no longer holds.
**Migration**: See "Text input keeps its field and action above the keyboard".

## ADDED Requirements

### Requirement: Each version keeps its own manifest and schema
Every version `StoreAccess` saves SHALL keep, beside its bundle, the app's host-held manifest and, when declared, its schema artifact. Using an older version, copying from a version, and a change landing on an older version (a rewind continuation) SHALL run the entry with that version's own manifest and schema, keeping the host's fields (app id, name, tile). The schema applied to saved data SHALL stay the accumulated union (additive-only evolution).

#### Scenario: An older version runs with its own capabilities
- **WHEN** version 1 of an app declares storage, version 2 declares none, and the user uses version 1
- **THEN** version 1 runs with storage granted and reads the data saved before version 2

#### Scenario: Going back runs no migration
- **WHEN** the user uses a version whose schema lacks fields a newer one added
- **THEN** no migration runs and nothing is deleted: those fields stay stored, unread, until a version that names them runs again

#### Scenario: A copy runs the manifest of the version it was made from
- **WHEN** the user makes a copy from version 1 while version 2 is current
- **THEN** the copy runs with version 1's manifest and schema, and the original keeps version 2's

#### Scenario: A version saved before manifests were kept (known limitation)
- **WHEN** the user uses a version saved before versions kept their manifest
- **THEN** it runs with the record the entry has now, and nothing errors; its own manifest is not known (accepted pre-release: no tester builds hold such versions)

#### Scenario: A change from an older version never reuses a later version's field ids
- **WHEN** a later version declared a field the saved data does not hold yet (it was never opened), and the user changes the app from an older version
- **THEN** the change request sends that field as a declared field beside the store's own applied schema; the burned-ID floor counts it, a field reusing its id with another type is refused, while the older version's own schema, which never names it, is accepted

#### Scenario: Reusing a never-opened version's field still needs a default
- **WHEN** that change names the later version's field with its declared type and no default
- **THEN** the change is refused before delivery with `missing_default`, as the store would refuse to open it, and is accepted with a default

#### Scenario: A change describes the code it sends
- **WHEN** the user uses version 1, goes back to Home, taps Undo on Home's toast (Home not yet refreshed) and then Change it, or taps "Ask Whim to fix it" on an app whose saved record lags the version it runs
- **THEN** the change request carries the active version's source with that version's own manifest and schema, read together, never the caller's copy of the record

#### Scenario: A change follows the active version
- **WHEN** a running app still shows an older version because a change landed and was not reloaded, and the user asks for another change
- **THEN** the change is made from the active version, the one delivery builds on, so the landed change is kept (a crash of that older version offers Reload instead of "Ask Whim to fix it", since its error is not the active version's)

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

At install the host SHALL resolve the app's ranked tints and SHALL assign the first one not used by any installed app, else the least used, ties broken by the model's order then table order. A copy SHALL take the tint farthest (ΔE2000 of light values) from its original among the least used. A record with no stored or declared tint SHALL display its app id's fallback tint, and a `tileColor` it carries SHALL be ignored. The assigned tint and resolved glyph SHALL be stored host-side and carried forward on every rebuild, and a rebuild SHALL keep them unless the person asks for a new look. Seeded examples SHALL each have a distinct tint, and no generated app SHALL be able to impersonate an example's tile by declaration alone.

#### Scenario: A new app avoids used tints

- **WHEN** installed apps use `stone` and `ocean` and a new app ranks `stone`, `rose`, `slate`
- **THEN** the new app is assigned `rose`

#### Scenario: A rebuild keeps the tile

- **WHEN** an installed app is changed and the new build ranks a different tint
- **THEN** the tile keeps its assigned tint and glyph

#### Scenario: An old hex record shows its fallback tint

- **WHEN** an installed record has `tileColor: '#0369a1'` and no tint
- **THEN** its tile shows its app id's fallback tint, never that colour or a tint chosen from it

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

Opening a ready tile SHALL grow a `bg` container from the tile to the screen while the tint stays a tile-sized plate with its glyph, and the WebView SHALL stay hidden until both the opening signal for that launch has arrived (the generation-stamped `paint` of `sandbox-rendering`, or the 600 ms cap) and the growing container covers the screen, then fade in. "Opening…" SHALL appear under the plate only after 1.5 s. A launch failure SHALL replace the opening state. Closing SHALL shrink the app back into its tile. One WebView SHALL be kept warm in a pool, and opening SHALL NOT regress tap-to-first-paint.

#### Scenario: A stale paint does not release the opening

- **WHEN** a `paint` from a previous launch reaches the host after a new launch has bound
- **THEN** the new launch keeps its WebView hidden until its own `paint` or the 600 ms cap

#### Scenario: Dark mode never flashes colour

- **WHEN** an app opens in dark mode
- **THEN** no frame shows the tint across the full screen

### Requirement: A crashed app keeps the orb and offers a way forward

When a running app fails, the container SHALL show "<name> ran into a problem", "It stopped and can't carry on right now. Your saved data is safe.", Reload, "Ask Whim to fix it" (opening the change field prefilled with "Fix the error that stops this app." and the error text attached) and Back to your apps, and the orb SHALL stay. When the crashed launch is behind its app's current version (a change landed and was not reloaded, or an Undo moved the app after it opened), the body SHALL say a newer version is ready and the screen SHALL offer only Reload and Back to your apps: the error belongs to code that is no longer current, and a change is made from the current version, so the fix is offered once Reload runs that version (decision #82).

#### Scenario: A crash is a change request

- **WHEN** the user taps "Ask Whim to fix it"
- **THEN** the Whim sheet opens with the prefilled request and the error attached, and the app is not closed

#### Scenario: A crash behind the current version leads with Reload

- **WHEN** a change of the app landed while it ran, was not reloaded, and the app then crashes
- **THEN** the crash screen says a newer version is ready and offers Reload and Back to your apps, without "Ask Whim to fix it", and after Reload a crash of the new version offers "Ask Whim to fix it" again

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

Shell motion SHALL use Reanimated with the named springs and timings of the token module and the moments of `system.md` §4.4; RN `Animated`, `LayoutAnimation`, `useNativeDriver` and literal spring configs SHALL NOT appear in `src/host/`, enforced by a static check. Every animation SHALL start from the presentation value and SHALL NOT block input, except a sheet's native `Modal` while its exit is visible (#224). With the OS Reduce Motion setting on, every moment SHALL show its reduced form.

#### Scenario: A sheet's visible exit is the one exception

- **WHEN** the user taps while a closing sheet is still visible (the M5 and M6 morphs across its boundary included): up to about 0.66 s after the tap that closed a plain sheet, about 1.02 s for an anchored close
- **THEN** the sheet's native window takes the tap and nothing under it responds; this lasts until GitHub issue #224 moves sheets off the native presentation

#### Scenario: A tap right after a sheet is gone reaches what is under it

- **WHEN** a sheet closes (tapped close, drag release or Reduce Motion fade) and the user taps the screen under it on the first frame the sheet is seen to be gone
- **THEN** the tap reaches what is under it: the sheet's window was dismissed on the frame the card came within half a point of off-screen (or faded past its last opacity step), not at the spring's later formal end

#### Scenario: A literal spring fails the check

- **WHEN** a component passes `{ stiffness: 300, damping: 20 }` to `withSpring`
- **THEN** the static check fails, naming the file

#### Scenario: Reduce Motion replaces a morph

- **WHEN** Reduce Motion is on and the user opens an app
- **THEN** the app cross-fades in over 160 ms with no container growth

### Requirement: First run seeds the example apps and a create affordance

On first run the launcher SHALL seed the built-in examples (tip splitter, water counter and style gallery) as installed, example-labeled records — full citizens: launchable, copyable, deletable, with history from their first install — and Home SHALL carry the composer bar `Make an app…` as its create affordance. Seeding MUST be idempotent across restarts and MUST NOT resurrect deleted examples.

#### Scenario: A fresh install is not empty

- **WHEN** the host runs for the first time
- **THEN** the grid shows the examples, each with the "Example" state line, plus the composer bar, and each example launches and runs on-device

#### Scenario: Deleted examples stay deleted

- **WHEN** the user deletes a seeded example, lets the Undo window pass and restarts the host
- **THEN** the example does not reappear

### Requirement: Text input keeps its field and action above the keyboard

Every launcher screen and sheet page with a text input SHALL keep the focused field and its primary action visible above the keyboard (at the largest text sizes the action may scroll with the content), SHALL let the rest scroll into view while the keyboard is up, and SHALL let the user put the keyboard away on both platforms without submitting. Describe SHALL open focused, keyboard up (`prompt-flow`).

#### Scenario: Describe on iOS

- **WHEN** a user types a description on the Describe page on iOS
- **THEN** Continue stays visible above the keyboard, and tapping Done, tapping empty space or dragging the content puts the keyboard away

#### Scenario: Describe opens with its field focused

- **WHEN** the making sheet opens on the Describe page for a new app
- **THEN** the field is focused with the keyboard up, and the idea chips show once the keyboard is down while the field is empty

#### Scenario: Every input screen

- **WHEN** the keyboard is up on the Plan page's row editing, the Whim sheet's change field, the report page or any other input screen, on iOS or Android
- **THEN** the focused field and the primary action are visible and the content above scrolls
