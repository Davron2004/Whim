# fix-11: polish from the second Android acceptance pass

Evidence: `openspec/changes/beta-1/acceptance/android-2/` (file names below; look at each before fixing). Be picky.
Where a behaviour can be tested, test it (pure logic in non-RN siblings); for pure styling, say what the
orchestrator should look at on iOS and Android.

1. **Selection highlight contrast** (`02e`): selected text in launcher fields gets a solid indigo background (the
   same colour as the handles), so dark text on it is ~2:1. Keep indigo handles and caret, but make the highlight
   readable: on Android use `cursorColor` + `selectionHandleColor` for the caret and handles and a translucent
   indigo `selectionColor` (~30% alpha) for the highlight, and check `textColorHighlight` in the Android theme
   (fix-5 set accents in `android/app/src/main/res/values/styles.xml`). On iOS `selectionColor` tints the caret,
   handles and highlight, and the highlight is drawn translucent already; confirm by reasoning from RN docs/source.
   Apply everywhere fix-4 set `selectionColor` (the shared field props, if there are any).
2. **"Already building" notice** (`08a-line-build2-refused-device-busy.png`): the notice card touches the top of
   "Build it" with no gap. Give it the standard gap.
3. **Primary buttons** (`20b`, `15b`, plus Continue/Build it vs Terms "Accept"): enabled Continue/Build it keep a
   3px beige border around the indigo fill, while Terms "Accept" has none; "Try again" and the selected report
   reason are near-black while other primaries are indigo. Find the design system's primary/secondary button
   definition (the launcher theme and any design reference the code cites) and make every primary consistent with
   it. If near-black is a deliberate style (a neutral or ink button), keep it only where the design says so, and
   say which.
4. **Version history** (`18a`): Back from history goes to Home instead of back into the app it was opened from,
   so fix the navigation (test it). The italic quote under "You said" renders in the system font; use the app's
   font family (italic face if the theme has one; otherwise the regular face, not synthesized system italic). The
   round chevron back button differs from the text "Back" used elsewhere: use the shared BackHeader unless design
   4a (the history reference cited in `KIND_BADGE_COLORS`) specifies the chevron, and say which. 4a's teal accents
   stay (progress.md R16).
5. **"Is ready" screen tile** (`22a`): the tile's watermark starts at the left edge and the initials overlap it,
   unlike the Home tile. Render it with the same tile component and layout as Home.
6. **Settings helper line** (`03c`): with the server field focused, its helper line is half hidden behind the
   keyboard. Scroll so the field AND its helper line are visible.
7. **Plan row numbers** (`06e`): a number typed into a plan row ("100") renders in monospace. Find the text styling
   that treats digits as code (likely a prose/highlight renderer) and keep plan-row user text in the body font.
8. **Orb menu taps during its open animation**: once, a tap on Versions within ~1 s of opening the menu opened
   Report. Ignore taps on menu items until the open animation settles, or make hit targets match their final
   positions from the first frame. Test it if the animation state is observable.
9. **"Make a new ID" confirm** (`14a`): it's the stock Android `Alert` (square corners, ALL-CAPS buttons, system
   font). Use the app's own confirm sheet/dialog component (find an existing in-app confirm, e.g. in Settings or
   the report sheet; don't invent a new one if one exists) on both platforms.
Scope: launcher components/theme/Android theme resources and their tests. Not `scripts/release/*`,
`docs/release/*` or `checks/test/release/*` (fix-8 runs in parallel).
