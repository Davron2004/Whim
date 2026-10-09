# fix-5 dispatch block: visual polish from device acceptance

Evidence in `openspec/changes/beta-1/acceptance/android/` (file names below). Be picky; the owner wants pixel
perfection. Each item gets a test where behaviour can be tested (pure logic in non-RN siblings); pure style
fixes are verified by the orchestrator on devices, so say per item what to look at.

1. **Failure screen** (`04f`, `07b`): a tall empty tinted card holding one line; the fallback notice is printed
   twice; and for a "needs a newer version" style failure it still suggests rephrasing ("Describing it
   differently usually gets past this", "Try rephrasing"). Fix all three:
   - size the card to its content;
   - show the notice once;
   - keep the rephrase advice off failures that rephrasing can't fix (fallback `fail` notices, and server
     refusals like capacity).
   Keep FailureScreen's recovery actions as they are.
2. **Reopening an `update` placeholder tile** shows the generic failure screen with "Try again" instead of the
   update screen (`08c`). A pending record resolved by an `update` fallback must reopen to the update screen
   with its notice. Find where the record keeps the notice (chain-4 stored it as the record's reason, or
   `COPY.updateRequiredLine`) and route it.
3. **Android default accent** (cursor, selection handles, `03d`, `03h`): set the Android theme's accent/control
   colours (`android/app/src/main/res/values/styles.xml` or equivalent) to Whim's indigo token value, so
   TextInputs and system controls stop using teal. Find the token in `src/sdk/theme`/launcher theme; don't
   invent a value.
4. **Mini-app error screen** (`04j`): two filled buttons of different widths. Match the app's standard: one
   full-width primary plus one outlined/secondary, same width.
5. **Consent screen** (`01-consent`): the scrolling text is cut hard against the pinned button. Add the same
   bottom fade or divider the other pinned-footer screens use (look for one; if none exists, a hairline divider
   in the theme's border colour).
6. **Tiles** (`01b`):
   - The EXAMPLE badge sits on the watermark. Move the badge so they don't overlap: top-left, since the
     initials sit bottom-left and the watermark top-right.
   - Tip Splitter (`#2563EB`) and Water Counter (`#0284C7`) are both blue. Give Tip Splitter a clearly
     different declared colour from the tile palette (a green or amber that the palette/`appColor` set uses).
     The producer-side distinctness test (`tile-colour.suite.ts`) must still pass. Consider adding a
     minimum-hue-distance check to it.
7. **Water Counter example** shows a developer-style "loaded from storage" status line (`08d`). Replace it with
   user-facing copy, or remove it. Check `scripts/release/upgrade-check/*.yaml` and
   `checks/test/release/upgrade-check.suite.ts` for selectors that read that text, and update them.
8. **SDK bar chart labels overlap** in Style Gallery (`08a`, "GroceriesRentTranspo…"): the SDK's bar chart
   must not overlap category labels. Truncate with an ellipsis per bar width, or wrap to two lines. This is SDK
   code (`src/sdk/*`, charts), so it affects generated apps: keep the public API unchanged, `npm run build`,
   and run `sdk:test` plus `npm run invariants` and `npm run bridge:invariants`.
Files: `FailureScreen.tsx`, the pending-record/update routing, android theme resources, the mini-app error
screen component, `ConsentScreen.tsx`, `app-tile.tsx`, `fixtures/*.app.tsx`, the upgrade-check flows/suite,
SDK chart files, `copy.ts` for failure copy, and tests. NOT `KeyboardShell`, the step screens, `SettingsScreen`,
`SheetModal` or `ReportSheet` (a parallel chain owns those).
