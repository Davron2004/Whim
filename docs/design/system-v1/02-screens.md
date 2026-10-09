# Screens

Phase B of `design-system-v1`. Each screen: what the capture shows today, what's wrong, the new layout,
its states and its motion. Mockup ids (`#s-…`) open the screen in `docs/design/mockups/index.html` on both
platforms and in both themes. Capture file names refer to
`Whim-evidence/design-audit-2026-10-09/{android,ios}/`. Components are in `03-components.md`, motion moments
(M-numbers) in `05-motion.md`, flows in `06-ux.md`.

What the capture confirmed across all screens:

- **iOS draws everything in SF.** The iOS shell has none of the custom faces: the "Whim" title, the
  "YOUR APPS" eyebrow, the mono timestamps and the Newsreader quote all render in SF Pro, the quote as SF
  italic (`ios/01-home-first-launch-examples`, `ios/100-history-single-version`). The capture index says
  Plex Mono Regular still renders on iOS; a 2× crop of `ios/100` shows "1m ago" and "YOU SAID" in SF, so
  every custom face falls back. Android draws Instrument Sans, Plex Mono and Newsreader. The same screen is
  two different designs today.
- **No dark mode.** Every capture is light, on both platforms.
- **Violet everywhere in apps.** The style gallery (`ios/200`–`203-sdk-gallery`) and the example apps
  (`ios/223-example-water-counter-used`) all use the shell's accent as their own.

## The capture's defects, and where each one is fixed

The capture index (`Whim-evidence/design-audit-2026-10-09/INDEX.md` §4) lists 21 defects. Every one has a
place in this redesign:

| # | Defect | Fixed by |
|---|---|---|
| 1 | Plex Mono eyebrows fall back to sans on iOS | System fonts everywhere and no mono eyebrows (`01-direction.md` §4) |
| 2 | "DIDN'T FI…" pill truncates on the tile art | Tile states as a corner badge plus a second line under the name (`04-mini-app-icons.md`) |
| 3 | Three sheet entrances, no exits | One `Sheet` (`03-components.md`), M11 in both directions |
| 4 | No screen transitions | Native-stack push and pop for shell screens (M13), M2/M3 for apps, M6/M7 in the making sheet |
| 5 | Cold launch: blank paper for about 1 s, a skeleton of 8 tiles for 13 apps, no title or composer | The launch screen holds until Home's first frame; the Home skeleton draws the title, the composer and the exact cells (Home, below); M27 |
| 6 | Two primary-button colours with no rule | Colour now follows who acts: ember for Whim, ink for the system, the tint for an app (`01-direction.md` §2.2) |
| 7 | Translucent orb over content, low-contrast glyph | An opaque 44pt raised disc with the ember, draggable between the two bottom corners, both inside the `chromeInsetBottom` every `Screen` and `Modal` already reserves (`03-components.md` Orb) |
| 8 | Warning badge nearly invisible; Disabled white on lavender | `warning` is amber with dark text and its icon; disabled is `fill` with `text-3` |
| 9 | Failure copy reads like system output; offline users told to rephrase | Failure kinds with their own copy, including a connection row (`06-ux.md` §1) |
| 10 | A dropped stream shows a generic "Something went wrong…" | The connection row: "I lost the connection to the server partway through." |
| 11 | The offline indicator appears only after a relaunch | The offline notice follows connectivity live (`06-ux.md` §5) |
| 12 | iOS keyboard covers the focused server field | Focused fields scroll above the keyboard (`03-components.md` Text field) |
| 13 | Tiles scroll under the composer with no edge | Top and bottom scroll-edge fades (Home, below) |
| 14 | "Use Whim's server" resets the address with one unconfirmed tap | Server choice as two rows; your address stays saved, so switching back loses nothing (`06-ux.md` §7) |
| 15 | System dark mode puts dark native chrome on a light shell | Real dark mode; Whim's own sheets instead of native alerts |
| 16 | Unstyled Material delete dialog | No dialog: delete is a soft delete with a 10 s Undo toast (`#s-delete-confirm`) |
| 17 | Build screen repeats "Reading your plan", technical liveness, a bar that never fills | No bar; one step list; time lines in plain words (Making, below) |
| 18 | Typeface switch between shell and app | One family (`01-direction.md` §4) |
| 19 | Tile names truncate the raw prompt | A short working name for tiles being made (`04-mini-app-icons.md`) |
| 20 | Report sheet nearly full height with a squeezed notice | `large` detent with the notice above Send, inside the scroll (Report, below) |
| 21 | Settings gear is a text glyph, emoji-like on iOS | The `settings` icon from the set |

## Your apps

### Home (`#s-home`)

**Today** (`android/01`, `ios/01`): "Whim" in 34pt with a mono "YOUR APPS" eyebrow; a 3-column grid of
106pt tiles carrying their two-letter monogram twice; "Example" under three of them; a gear in a bordered
38pt circle; a composer card with a violet plus.

**What's wrong:** the title and eyebrow repeat each other; monograms carry no meaning and collide (two "HA"
in `android/22`); tiles are big enough that nine apps fill the screen; the gear is a typed character.

**New:**

| Part | Spec |
|---|---|
| Header row | Settings icon button (`settings`, 24) at the trailing edge |
| Title | "Your apps", `largeTitle`, at the gutter |
| Grid | 4 columns of 64pt glyph tiles, names under them, 22pt under the title. Names wrap to two lines (`caption` 12, centred, 4pt side padding), so neighbours never touch; the generator keeps names to 24 characters |
| Composer | Raised capsule at the bottom, the ember, "Make an app…" (or "Continue "A timer for my…"" when a draft is waiting); the ambient light under it while something is being made; content fades out over 16pt above it |
| Search | A field under the title once there are 13 apps |
| Text size | From 135%, three columns; from 200%, a list of rows with the 40pt tile and the full name |

**States:** first run with three examples, each keeping its "Example" label (#42); failed and stopped
attempts older than a day collapse into one "2 didn't work" tile; "Pour Timer is ready · Open" as a toast when
an app lands while the making sheet is closed; offline notice under the title; empty
(`#s-home-empty`); loading, where the skeleton draws the real title, the composer and one cell per known app
in the real 4-column geometry, so nothing moves when the tiles land (today it draws 8 bare tiles for 13 apps,
`android/00-home-skeleton-cold-launch`). Scrolled, the grid fades out under the header row and above the
composer over 16pt each, instead of sliding under them (`android/26b`, `26c`). **Motion:** grid appears with
`stagger` on first launch only (M17); the composer grows into the making sheet (M6); a tile opens its app
(M2).

### Making, failed, changing (`#s-home-states`)

**Today** (`android/20`, `24`, `25`, `08`): ghost tiles are washed-out monogram tiles; "DIDN'T FI…" truncates
in a red pill on the art; "A Pomodoro timer" keeps its article.

**New:** an app being made is an `ember-soft` squircle with the ember glowing with the stream and "Making…"
in `ember-text`; failed is a `fill` squircle with the ember out, an 18pt corner badge and "Didn't work"; a
change in flight rings the app's own tile with an ember ring concentric with the squircle and reads
"Changing…"; a copy reads "Copy" and takes the tint farthest from the original among the least used. The full
state table is in `04-mini-app-icons.md`. **Motion:** M4 when an app arrives, M20 for the glow.

### Tile menu (`#s-home-menu`)

**Today** (`android/04`, `09`): a bottom sheet of eight centred violet rows, two of them red (Delete and
Dismiss), fading in.

**New:** long-press lifts the tile and grows a menu card from it, headed by the app's full name and placed so
it never covers the first row's names: Open, Change it, History, Make a copy, Customize tile, Share link, then
Delete after a gap. Icons and labels share one colour (`text`; Delete in `danger-text`). Making and failed
tiles get their own short menus (`04-mini-app-icons.md`). **Motion:** M12. **Haptic:** medium impact at the
350 ms threshold.

### Delete (`#s-delete-confirm`)

**Today** (`android/07`): the platform alert with uppercase CANCEL and DELETE.

**New:** no dialog. Delete in the tile menu removes the tile at once (M18) and shows "Water Counter deleted"
with **Undo** for 10 s; the app and its data are purged after. **Haptic:** warning.

### No apps (`#s-home-empty`)

**Today:** "No apps yet" as one muted line above an empty grid.

**New:** the ember at 128 (64 from 135% text), still, "Make your first app", one line of plain examples, and
three idea chips that open the making sheet with the idea filled in. The only time the mark sits on the home
screen.

## Making an app

All of these are pages of one sheet over the home screen (`06-ux.md` §1).

### First run (`#s-consent`)

**Today** (`android/10`, `14`–`16`, `ios/14`): Terms and Consent as two full screens; consent is a long
scroll of mono-headed paragraphs with a violet button.

**New:** one large sheet. "Before Whim makes apps for you", one lead sentence, three summary rows with icons
(what's sent, what stays on your phone, what we never do), Privacy policy, Full details and Language rows,
then above the buttons a checkbox row "I accept the Terms of use", unticked, with the Terms link outside its
hit area; **Agree to send descriptions** (`ink`, enabled once ticked) and **Not now**. Nothing sits beside the
close X. Two acts kept on purpose (`06-ux.md` §6).

### Describe (`#s-describe`, `#s-describe-change`)

**Today** (`android/50`–`57`, `ios/53`): "Back" text and three step bars; a 13.5pt field; suggestion rows
styled like inputs; "Whim will ask if something is unclear."

**New:** "What should it do?" in `title1`; a text area at 17pt focused with the keyboard up; "Plain words are
enough. I'll ask if anything's unclear."; **Continue** (`ember`) riding the keyboard. With an empty field and
no keyboard, three idea chips sit under the helper. Change mode adds the app's 24pt tile and "Changing Water
Counter" above "What should change?". Closing the sheet keeps the draft (`06-ux.md` §1). **Motion:** M6 in,
M7 out.

### Plan (`#s-plan-thinking`, `#s-plan`, `#s-plan-edit`)

**Today** (`android/61`–`74`): Clarify (three questions, unselected pills, a footnote saying you may skip)
then Plan (eight bordered cards with mono labels, three of which repeat the clarify answers).

**New:** one page. "Here's the plan", the person's words as the hero (`title3` italic, quoted), then **A few
choices** and **What I'll make** (plan rows in one `sheet-group` list, each with a pencil). Each question
shows chips when every option is 20 characters or fewer, otherwise full-width radio or checkbox rows; "Decide
for me" ends each question, selected by default and exclusive in multi-select. An answered question collapses
to one line ("Brewer · V60", tap to reopen), so the plan rows stay in view. **Make it** (`ember`) at the
bottom, with content fading out over 16pt above the action area.

| State | What shows |
|---|---|
| Arriving (`#s-plan-thinking`) | The status line with the 48 ember and the elapsed time; questions as soon as they land; skeleton rows for the plan |
| Ready (`#s-plan`) | Questions and rows; Make it enabled |
| Editing a row (`#s-plan-edit`) | The row becomes a focused text area with Save and Cancel at full targets; the sheet rides the keyboard |
| A server notice | A `Notice` above Make it, with its countdown |

**Motion:** M8 as content arrives, M25 for editing, M9 on Make it. **Haptic:** medium impact on Make it.

### Can't make as asked (`#s-plan-limit`)

**Today** (`android/67`): "Whim can't build this as asked" with the prompt in brown and a reason that says
"Mini-apps".

**New:** "I can't make this as asked", the quote, the reason in plain words, then a card "I could make this
instead" with the alternative. **Make that instead** (`ember`), **Change my idea** (`plain`).

### Making (`#s-making`, `#s-making-stuck`, `#s-making-queued`)

**Today** (`android/80`–`87`): "Making it", a 4pt violet bar, "Connected, waiting for a reply · 0:06",
checklist circles, a "Details" link, "Leave it running" as an outlined button, and half a screen of nothing.

**New:**

| Part | Spec |
|---|---|
| Ember | 128 (64 from 135% text), working, glow from the stream (M20), with the ambient light behind the header |
| Title | "Making Pour Timer" (`title1`), then the person's words as the hero (`title3` italic, quoted) |
| Time line | `callout` `text-2`, one line at 390, from the flowbench table in `06-ux.md` §1 |
| Steps | The four steps with done, current (`ember` dot and ring, elapsed time), waiting (`text-2`) and repair states |
| Action | **Stop** (`plain`) at the bottom. The sheet's close X is the one way out |

| State | Ember | Time line | Steps |
|---|---|---|---|
| Making | working | "Usually 1–2 min. You can leave; it keeps going." | current marker on its step |
| Slow (over 75 s / 150 s) | working | "Taking longer than most. Still going." / "This one's slow. I'll keep at it; you can leave." | same |
| Fixing (stream reports `repair`) | working | same lines | "Fixing a problem · try 2 of 3" row under the current step; the marker moves down to it |
| Stuck (`#s-making-stuck`) | stuck | "No word from the server for 40 s. Still waiting." | same |
| Waiting in line (`#s-making-queued`) | stuck (still, dim: nothing streams yet) | "Waiting for a free spot. You're next." | all waiting |
| Changing an app | working | same lines, title "Changing Pour Timer" | same |

Stop ends the run at once, one tap after "Make it" when the person spots a typo; the attempt becomes a
stopped tile they can change, retry or discard (`04-mini-app-icons.md`). The ghost tile's menu has Details
(reopens this page) and Stop. When the app finishes while the sheet is closed,
Home shows the toast "Pour Timer is ready · Open"; over a running app, the orb gets its dot. **Motion:** M9
in, M5 when leaving, M10 or M22 at the end.

### Ready (`#s-ready`)

**Today** (`android/90`): the tile with a 400 ms rise, "Hello App is ready", violet **Open it**, outlined
**Back to your apps**, "Report this app" in small print.

**New:** the 96 tile hero with the ember flaring once and settling into it; "Pour Timer" (`title1`); the
person's quoted words (`title3` italic); "It's on your home screen."; **Open it** in the app's tint; **Done**
(`plain`). No live preview in v1: it would run the app's code, cues, storage writes and timers before the
person chose to open it. Report moves to the Whim sheet and History. **Motion:** M10. **Haptic:** success.

### Didn't work (`#s-failure`)

**Today** (`android/130`–`133`): a red title, the server's sentence ("Could not produce a buildable app after
maximum attempts."), a pink panel, a mono timeline that repeats "Try a simpler prompt.", then black, outlined
and red-outlined full-width buttons. The newer-version variant offers "Try again" for a problem only an update
fixes.

**New:** the ember out (96); "Couldn't make this" in `text`; one sentence in Whim's voice; a `sheet-group` list
with "Your other apps are untouched" (or "Your current version still works") and a collapsed "What happened";
**Change the description** (`ink`), **Try again as it is** (`plain`), and **Discard** (`danger`, with
`trash`) under them in the body. Nothing sits beside the close X. Variants by failure kind are in
`06-ux.md` §1. **Motion:** M22. **Haptic:** error.

## Using an app

### Opening (`#s-app-opening`)

**Today** (`android/120`): the app name, a breathing violet bar and "Opening…" on paper, then a cut.

**New:** a `bg` container grows out of the tile; the tint stays a tile-sized plate with the glyph at the centre
and fades as the app paints (M2), so dark mode never flashes a full screen of colour. "Opening…" appears under
the plate only after 1.5 s. The status bar follows the scheme.

### A running app (`#s-app-timer`, `#s-app-water`)

**Today** (`android/121`, `ios/121`, `ios/223`): the SDK draws a 28pt heading, violet buttons and progress,
bordered cards, and a grey translucent hamburger orb sitting over "Clear done".

**New:** the app's tint is its primary colour (segments, ring, buttons); cards and lists have no borders;
the SDK's `Screen title` gives a standard header with an optional action; the orb is a 44pt raised disc with
the ember, in the bottom-trailing corner by default and draggable to bottom-leading, inside the
`chromeInsetBottom` that `Screen` and `Modal`'s action row already pad by, so it never sits on a value or on
Save. It hides while the keyboard is up. Pour Timer shows the ring, a segmented brewer choice and a list of
steps; Water Counter shows the ring with a number, the new `Stepper` and a `List` with icons.

### Whim sheet (`#s-whim-sheet`, `#s-whim-plan`)

**Today** (`android/122`, `ios/122`): four rows with typed glyphs in tinted squares rising from the orb;
"Change it" closes the app.

**New:** a `fit` sheet on `sheet`, rows on `sheet-group`: the app's 40pt tile, name and "Version 4 · changed 2
days ago" (the same numbering as History); a send field "What should change?"; then History, Report a problem
and Back to your apps. If a new version is waiting, a "New version ready · Reload" row sits at the top until
the person reloads. Sending grows the sheet into the plan for the change (`#s-whim-plan`), with its own
questions and **Make the change** (`ember`). **Motion:** M21, then M11.

### Changing while you use it (`#s-app-changing`)

**New:** the app keeps running on its current version; the orb's ember glows with the stream; when the
change lands a toast says "Pour Timer changed" with **Reload** in `ember-text`. Nothing reloads on its own. If
the toast is missed, an `ember` dot stays on the orb and the Whim sheet keeps its "New version ready · Reload"
row until the person reloads. A failed change shows a `danger` dot on the orb and a toast with **See why**.

### An app crashed (`#s-app-error`)

**Today:** "This app ran into a problem" with Retry and Back.

**New:** a `circle-alert` in a `fill` circle, "Pour Timer ran into a problem", "It stopped and can't carry on
right now. Your saved data is safe.", **Reload** (`ink`), **Ask Whim to fix it** (`plain-ember`), which opens
the change field prefilled with the request and the error text attached, and a plain **Back to your apps**.
The orb stays, so a crash that recurs on reload is never a dead end.

## History and settings

### History (`#s-history`, `#s-history-undo`)

**Today** (`android/100`, `101`, `ios/100`): a two-colour title "Hello App history", a Report pill, an "All 1"
filter pill, a bordered card per version with mono "1m ago", "YOU SAID", "v1", a brown quote, and
"↑ YOU'RE ON THIS ONE" in teal mono.

**New:** a native-stack screen with back and a "Report" text button in the header; "History" in `title1` with
the app's tile, name (in its tint) and "4 versions" under it; a rail of versions that stops at v1, each with
your words as the hero (`title3` italic, quoted), Whim's summary, "v4 · 2 days ago" in tabular figures, a
neutral kind chip, and `Current` on the current one. The tapped version expands into a card with **Use this
version** (`secondary`) and **Make a copy** (`plain`; copies start fresh, #43b); on the current version,
**Change it** (`ember`). Using an older version shows a toast "Back on version 3" with **Undo**
(`#s-history-undo`). **Motion:** M26, M14.

### Settings (`#s-settings`)

**Today** (`android/30`–`41`): every row its own bordered card, mono section headers, Highlighting with its
own section, "This phone's ID" and "Make a new ID" at the top level, Advanced as a collapsing section.

**New:** "Settings" in `largeTitle`, on the native stack; "AI features" with the subtitle "Review what's sent" ›;
"Language" ›; About with Privacy policy, Terms of use, Support (external-link icons) and Version; then
**Advanced ›**. Highlighting is gone.

### Advanced (`#s-settings-advanced`)

**New:** "Send error details" with its explanation as the group footer; **This phone**: Phone ID, truncated in
the middle (IDs differ at the ends), with a copy button, and "Make a new ID" (confirm sheet); **Server**: Whim's server (checked) and Your own server › (confirm
sheet, then the address field and its check line, as today).

### Report a problem (`#s-report`)

**Today** (`android/110`–`116`): a long sheet with mono headers, violet chips, a bordered "What gets sent"
preview with the app's code in mono, and "One moment" while sending.

**New:** "Report a problem"; "What went wrong?" chips (one style); a note field; "Include what I asked for"
switch; "What gets sent" collapsed with a chevron; the ID line as a footer; **Send report** (`ink`),
**Cancel**. Sending: the button says "Sending…"; sent: a check, "Thanks. We'll look into it.", **Done**.
The sheet uses the `large` detent, so its top stays clear of the status bar, and a send failure shows as a
`Notice` at the end of the scrolling content, above the buttons, instead of squeezed between them
(`android/110`, `117`).

### Update needed (`#s-update`)

**Today** (`android/140`): fine in structure; violet button.

**New:** same structure in the system's voice: "Whim needs an update", one sentence, **Update Whim** (`ink`),
**Not now**.

### Launch (`#s-launch`)

The ember at 128 on `bg` in both schemes, still, on iOS. Android 12+'s splash puts the icon in a circle mask,
so Android shows the icon's ember in that mask instead. The app icon is the ember on warm dark
(`01-direction.md` §8.2). The native launch screen stays up until Home has drawn its first frame (skeleton or
grid), then cross-fades (M27), so the second of blank paper in `motion/android-cold-launch-to-home` goes away.
Today's launch mark is a white "W" in a violet disc (`ios/00-launch-screen`).

## Inside apps (SDK)

### Style gallery (`#s-gallery-type`, `#s-gallery-controls`, `#s-gallery-surfaces`, `#s-gallery-modal`)

**Today** (`ios/200`–`210`): one long screen of bordered cards inside bordered cards, violet everywhere, a
grey "Warning" badge you can barely see, a modal that appears with no grabber or close button.

**New:** the gallery is both the exhaustive test and a few-shot example the generator reads, so every screen
in it follows the rules it shows. It splits into screens by topic, reached with `nav` around `Screen title`
(automatic header back, no hand-made back button), each in the app's tint (`purple` here):

| Screen | Shows |
|---|---|
| Text and buttons | Every text size; one Primary (with an icon) as the screen's main action; Secondary and Ghost in a toolbar row; Disabled in a form waiting for input; Danger as a "Delete all" row with Secondary beside it |
| Controls | TextInput, DateInput, Picker, Stepper, Switch, Checkbox, Slider, SegmentedControl, each in a labelled settings row |
| Surfaces | Badges in all tones with their icons, ProgressBar as a bar and a ring, a bar chart, `<List items keyBy renderItem>` with icons and a chevron and an add/remove pair, EmptyState |
| Modal and toast | Modal as a sheet with a form inside and one Save; `toast()` |

The gallery keeps showing every component and every variant (the rule in `03-components.md`). Two or three
curated exemplar apps join it in the few-shot set, and the navigation example is rewritten around
`Screen title`.
