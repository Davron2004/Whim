# fix-5b: two design decisions from fix-5's class-B stops (progress.md R16)

1. **EXAMPLE badge (6a).** Remove the top-right pill. Show "Example" as a muted caption under the example
   tile's name, in the same slot and style the home grid uses for ghost/placeholder captions (find it in
   `HomeScreen`/`app-tile.tsx`/`home-grid`). It must never overlap the tile art at any tile width. Test that an
   example tile renders the caption and no pill, and that a generated app's tile has neither.
2. **Version history "You said" (O).** Follow design 4a, the owner-approved reference that
   `KIND_BADGE_COLORS` already cites: each version row quotes the user's own words (that version's prompt)
   under "You said", and Whim's summary goes in the expanded row. Today the headline is the summary and the
   "You said" origin line shows it (`acceptance/ios/48`). Find the 4a reference in the repo (grep `4a`,
   `KIND_BADGE_COLORS`) and match it. Keep 4a's teal/black accents: they are the design, not a defect. Add a
   version-history spec delta to `openspec/changes/beta-1/specs/version-history/spec.md` as MODIFIED: copy the
   live requirement from `openspec/specs/version-history/spec.md` whole, and change only the headline/origin
   wording. Check `openspec validate beta-1 --strict` passes (the SHALL/MUST must lead the requirement's first
   line). fix-5's committed reproduction test (`history-ui.suite.tsx`) becomes the red-check.
Scope: tile/grid components, the history screen and its view logic, the spec delta, and tests. Not the step
screens, KeyboardShell, SettingsScreen, SheetModal or ReportSheet (fix-4 owns them).
