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
| 4 | No screen transitions | M13 push and pop, M2/M3 for apps, M6/M7 in the making sheet |
| 5 | Cold launch: blank paper for about 1 s, a skeleton of 8 tiles for 13 apps, no title or composer | The launch screen holds until Home's first frame; the Home skeleton draws the title, the composer and the exact cells (Home, below); M27 |
| 6 | Two primary-button colours with no rule | Colour now follows who acts: ember for Whim, ink for the system, the tint for an app (`01-direction.md` §2.2) |
| 7 | Translucent orb over content, low-contrast glyph | An opaque raised disc with the ember, 44pt, reserved space at the end of every `Screen`, and the shrink while scrolling (`03-components.md` Orb, M28) |
| 8 | Warning badge nearly invisible; Disabled white on lavender | `warning` is yellow with dark text; disabled is `fill` with `text-3` |
| 9 | Failure copy reads like system output; offline users told to rephrase | Failure kinds with their own copy, including a connection row (`06-ux.md` §1) |
| 10 | A dropped stream shows a generic "Something went wrong…" | The connection row: "I lost the connection to the server partway through." |
| 11 | The offline indicator appears only after a relaunch | The offline notice follows connectivity live (`06-ux.md` §5) |
| 12 | iOS keyboard covers the focused server field | Focused fields scroll above the keyboard (`03-components.md` Text field) |
| 13 | Tiles scroll under the composer with no edge | Top and bottom scroll-edge fades (Home, below) |
| 14 | "Use Whim's server" resets the address with one unconfirmed tap | Server choice as two rows; your address stays saved, so switching back loses nothing (`06-ux.md` §7) |
| 15 | System dark mode puts dark native chrome on a light shell | Real dark mode; Whim's own sheets instead of native alerts |
| 16 | Unstyled Material delete dialog | Whim's confirm sheet (`#s-delete-confirm`) |
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
| Grid | 4 columns of glyph tiles (64 at 390, 68 at 412), names under them, 22pt under the title |
| Composer | Raised capsule at the bottom, eyeless ember, "Make an app…"; content fades out over 16pt above it |
| Search | A field under the title once there are 13 apps |

**States:** first run with three examples (no "Example" captions); offline notice under the title; empty
(`#s-home-empty`); loading, where the skeleton draws the real title, the composer and one cell per known app
in the real 4-column geometry, so nothing moves when the tiles land (today it draws 8 bare tiles for 13 apps,
`android/00-home-skeleton-cold-launch`). Scrolled, the grid fades out under the header row and above the
composer over 16pt each, instead of sliding under them (`android/26b`, `26c`). **Motion:** grid appears with
`stagger` on first launch only (M17); the composer grows into the making sheet (M6); a tile opens its app
(M2).

### Making, failed, changing (`#s-home-states`)

**Today** (`android/20`, `24`, `25`, `08`): ghost tiles are washed-out monogram tiles; "DIDN'T FI…" truncates
in a red pill on the art; "A Pomodoro timer" keeps its article.

**New:** an app being made is an `ember-soft` squircle with the eyeless ember glowing with the stream and
"Making…" in `ember-text`; failed is a `fill` squircle with the grey ember, a corner badge and "Didn't work";
a change in flight rings the app's own tile with ember and reads "Changing…"; a copy reads "Copy" and takes
the next tint. The full state table is in `04-mini-app-icons.md`. **Motion:** M4 when an app arrives, M20 for
the glow.

### Tile menu (`#s-home-menu`)

**Today** (`android/04`, `09`): a bottom sheet of eight centred violet rows, two of them red (Delete and
Dismiss), fading in.

**New:** long-press lifts the tile and grows a menu card from it: Open, **Change it** (`ember-text`), History,
Make a copy, Share link, then Delete after a gap. Making and failed tiles get their own short menus
(`04-mini-app-icons.md`). **Motion:** M12. **Haptic:** medium impact at the 350 ms threshold.

### Delete (`#s-delete-confirm`)

**Today** (`android/07`): the platform alert with uppercase CANCEL and DELETE.

**New:** the app's own confirm sheet: "Delete Water Counter?", "It and everything saved in it will be removed
from this phone. This can't be undone.", **Keep it** (large `ink`), **Delete** (`plain-danger`). **Haptic:**
warning on Delete. **Motion:** M11, then M18 as the tile leaves the grid.

### No apps (`#s-home-empty`)

**Today:** "No apps yet" as one muted line above an empty grid.

**New:** the wisp listening (104pt), "Make your first app", one line of plain examples, and three idea chips
that open the making sheet with the idea filled in. The only time the wisp sits on the home screen.

## Making an app

All of these are pages of one sheet over the home screen (`06-ux.md` §1).

### First run (`#s-consent`)

**Today** (`android/10`, `14`–`16`, `ios/14`): Terms and Consent as two full screens; consent is a long
scroll of mono-headed paragraphs with a violet button.

**New:** one large sheet. "Before Whim makes apps for you", one lead sentence, three summary rows with icons
(what's sent, what stays on your phone, what we never do), Privacy policy and Full details rows, then above
the buttons a checkbox row "I accept the Terms of use", **Agree and continue** (`ink`, enabled once ticked)
and **Not now**. "Français" sits in the header. Two acts kept on purpose (`06-ux.md` §6).

### Describe (`#s-describe`, `#s-describe-change`)

**Today** (`android/50`–`57`, `ios/53`): "Back" text and three step bars; a 13.5pt field; suggestion rows
styled like inputs; "Whim will ask if something is unclear."

**New:** "What should it do?" in `title1`; a text area at 17pt focused with the keyboard up; "Plain words are
enough. I'll ask if anything's unclear."; **Continue** (`ember`) riding the keyboard. With an empty field and
no keyboard, three idea chips sit under the helper. Change mode adds the app's 22pt tile and "Changing Water
Counter" above "What should change?". **Motion:** M6 in, M7 out.

### Plan (`#s-plan-thinking`, `#s-plan`, `#s-plan-edit`)

**Today** (`android/61`–`74`): Clarify (three questions, unselected pills, a footnote saying you may skip)
then Plan (eight bordered cards with mono labels, three of which repeat the clarify answers).

**New:** one page. "Here's the plan", the description quoted in italics, then **A few choices** (each
question as a row of chips with "I'll decide" selected) and **What I'll make** (plan rows in one grouped
list, each with a pencil). **Make it** (`ember`) at the bottom.

| State | What shows |
|---|---|
| Arriving (`#s-plan-thinking`) | The status line with a 28pt thinking wisp and the elapsed time; questions as soon as they land; skeleton rows for the plan |
| Ready (`#s-plan`) | Questions and rows; Make it enabled |
| Editing a row (`#s-plan-edit`) | The row becomes a focused text area with Save and Cancel; the sheet rides the keyboard |
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
| Wisp | 128pt, making pose, glow from the stream (M20) |
| Title | "Making Pour Timer" (`title1`) |
| Time line | `callout` `text-2`, from the flowbench table in `06-ux.md` §1 |
| Steps | The four steps with done, current (ember dot, elapsed time) and waiting states |
| Actions | **Back to your apps** (`secondary`), **Details** (`plain`) |

| State | Wisp | Time line | Actions |
|---|---|---|---|
| Making | making | "Usually about a minute. You can leave; it keeps going." | Back to your apps, Details |
| Slow (over 75 s / 150 s) | making | "Taking longer than most. Still going." / "This one's slow. I'll keep at it; you can leave." | same |
| Stuck (`#s-making-stuck`) | stuck, dim | "No word from the server for 40 s. Still waiting." | same |
| Waiting in line (`#s-making-queued`) | asleep | "Waiting for a free spot. You're next." | Back to your apps, **Stop making** (`plain-danger`) |
| Changing an app | making | same lines, title "Changing Pour Timer" | same |

**Motion:** M9 in, M5 when leaving, M10 or M22 at the end.

### Ready (`#s-ready`)

**Today** (`android/90`): the tile with a 400 ms rise, "Hello App is ready", violet **Open it**, outlined
**Back to your apps**, "Report this app" in small print.

**New:** the app's tile at 112pt with the wisp in its done pose beside it; "Pour Timer is ready"; "It's on your
home screen."; **Open Pour Timer** in the app's tint; **Done** (`plain`). Report moves to the Whim sheet and
History. **Motion:** M10. **Haptic:** success.

### Didn't work (`#s-failure`)

**Today** (`android/130`–`133`): a red title, the server's sentence ("Could not produce a buildable app after
maximum attempts."), a pink panel, a mono timeline that repeats "Try a simpler prompt.", then black, outlined
and red-outlined full-width buttons. The newer-version variant offers "Try again" for a problem only an update
fixes.

**New:** the wisp in its failed pose (96pt); "Couldn't make this" in `text`; one sentence in Whim's voice; a
grouped list with "Your other apps are untouched" (or "Your current version still works") and a collapsed
"What happened"; **Change the description** (`ink`) and **Try again as it is** (`plain`); **Discard** as a
`danger-text` button in the header. Variants by failure kind are in `06-ux.md` §1. **Motion:** M22.
**Haptic:** error.

## Using an app

### Opening (`#s-app-opening`)

**Today** (`android/120`): the app name, a breathing violet bar and "Opening…" on paper, then a cut.

**New:** the tint fills the screen out of the tile with the glyph centred (M2); the app cross-fades in on
first paint; "Opening…" appears under the glyph only after 1.5 s. Status bar content turns light on dark
tints.

### A running app (`#s-app-timer`, `#s-app-water`)

**Today** (`android/121`, `ios/121`, `ios/223`): the SDK draws a 28pt heading, violet buttons and progress,
bordered cards, and a grey translucent hamburger orb sitting over "Clear done".

**New:** the app's tint is its primary colour (segments, ring, buttons); cards and lists have no borders;
the SDK's `Screen title` gives a standard header with an optional action; the orb is a 44pt raised disc with
the eyeless ember. Pour Timer shows the ring, a segmented brewer choice and a list of steps; Water Counter
shows the ring with a number, the new `Stepper` and a `List` with icons.

### Whim sheet (`#s-whim-sheet`, `#s-whim-plan`)

**Today** (`android/122`, `ios/122`): four rows with typed glyphs in tinted squares rising from the orb;
"Change it" closes the app.

**New:** a `fit` sheet: the app's 40pt tile, name and "Version 3 · changed 2 days ago"; a send field "What
should change?"; then History, Report a problem and Your apps. Sending grows the sheet into the plan for the
change (`#s-whim-plan`), with its own questions and **Make the change** (`ember`). **Motion:** M21, then M11.

### Changing while you use it (`#s-app-changing`)

**New:** the app keeps running on its current version; the orb's ember glows with the stream; when the
change lands a toast says "Pour Timer changed" with **Reload** in `ember-text`. Nothing reloads on its own.
A failed change shows a danger dot on the orb and a toast with **See why**.

### An app crashed (`#s-app-error`)

**Today:** "This app ran into a problem" with Retry and Back.

**New:** a `circle-alert` in a `fill` circle, "Pour Timer ran into a problem", "It stopped and can't carry on
right now. Your saved data is safe.", **Reload** (`ink`) and **Ask Whim to fix it** (`plain-ember`), which opens
the change field prefilled.

## History and settings

### History (`#s-history`, `#s-history-undo`)

**Today** (`android/100`, `101`, `ios/100`): a two-colour title "Hello App history", a Report pill, an "All 1"
filter pill, a bordered card per version with mono "1m ago", "YOU SAID", "v1", a brown quote, and
"↑ YOU'RE ON THIS ONE" in teal mono.

**New:** back and a "⋯" (Report a problem) in the header; "History" in `title1` with the app's tile, name (in
its tint) and "4 versions" under it; a rail of versions, each with your words in italic quotes, Whim's summary,
"v4 · 2 days ago" in tabular figures, a neutral kind chip, and `Current` on the current one. The tapped version
expands into a card with **Go back to this version** (`secondary`) and **Make a copy** (`plain`); on the
current version, **Change it** (`ember`). Going back shows a toast "Back on version 3" with **Undo**
(`#s-history-undo`). **Motion:** M26, M14.

### Settings (`#s-settings`)

**Today** (`android/30`–`41`): every row its own bordered card, mono section headers, Highlighting with its
own section, "This phone's ID" and "Make a new ID" at the top level, Advanced as a collapsing section.

**New:** "Settings" in `largeTitle`; one row "AI features · On ›"; About with Privacy policy, Terms of use,
Support (external-link icons) and Version; then **Advanced ›**. Highlighting is gone.

### Advanced (`#s-settings-advanced`)

**New:** "Send error details" with its explanation as the group footer; **This phone**: Phone ID with a copy
button, and "Make a new ID" (confirm sheet); **Server**: Whim's server (checked) and Your own server › (confirm
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

The wisp at 112pt on `bg` in both schemes, still. The app icon is the wisp on warm dark (`01-direction.md`
§8.2). The native launch screen stays up until Home has drawn its first frame (skeleton or grid), then
cross-fades (M27), so the second of blank paper in `motion/android-cold-launch-to-home` goes away. Today's
launch mark is a white "W" in a violet disc (`ios/00-launch-screen`).

## Inside apps (SDK)

### Style gallery (`#s-gallery-type`, `#s-gallery-controls`, `#s-gallery-surfaces`, `#s-gallery-modal`)

**Today** (`ios/200`–`210`): one long screen of bordered cards inside bordered cards, violet everywhere, a
grey "Warning" badge you can barely see, a modal that appears with no grabber or close button.

**New:** the gallery splits into screens reached with `nav` (it also demonstrates the new `Screen title` and
back), each in the app's tint (`grape` here):

| Screen | Shows |
|---|---|
| Text and buttons | Every text size; Primary (with an icon), Secondary, Ghost, Danger, Disabled |
| Controls | TextInput, DateInput, Picker, Stepper, Switch, Checkbox, Slider, SegmentedControl |
| Surfaces | Badges in all tones, ProgressBar as a bar and a ring, a bar chart, a List with icons and a chevron, EmptyState |
| Modal and toast | Modal as a sheet with a form inside; `toast()` |

The gallery keeps showing every component and every variant (the rule in `03-components.md`).
