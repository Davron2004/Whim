# History screen acceptance spec (shell-redesign-v2 chain-E, `4a`)

English-first spec for `HistoryScreen.tsx` + its RN-free decision logic (`history-logic.ts`).
Covers `openspec/changes/shell-redesign-v2/specs/version-history/spec.md` (all requirements,
both `REMOVED` blocks) and `app-launcher/spec.md`'s tile-colour-resolution requirement, as
implemented per `design.md` D11. Node-testable pieces (`history-logic.suite.ts`) drive a real
MemoryFs-backed `VersionStore` through `StoreAccess`, exactly like `store-access.suite.ts`; the
screen itself is rendered over the same kind of store in `history-ui.suite.tsx` (loading state,
expand-only taps, immediate use and copy with Undo and Open, reaching History from Home).

## History reads as the user's own prompts

1. Each row leads with the user's own words, quoted, in italic `title3` (system.md §7.1 Timeline
   row): `historyQuotedPrompt(parsePromptEnvelope(snapshot.prompt).text)` — a v1 envelope renders
   its `text`, a raw legacy string (not envelope JSON) renders unchanged inside the quotes, neither
   ever throws — and the stored summary (`storedSummary`) is never the headline. A version with no
   prompt headlines with its summary's `text`. Under the words: Whim's summary (`callout`
   `text-2`; the first version without one says `Where this app began`), then "v4 · 2 days ago" in
   tabular figures (`historyRowMeta`), a neutral kind chip with its icon (or none, when
   unclassified) — every kind on the same `fill`/`text-2` — and `Current` on the active version.
   The rail runs from the newest row's dot and stops at v1's.
2. Under a header row with Back and the `Report` text button: "History" in `title1`, the app's
   40 pt tile (`tileOf`), its name in its tint's value for the scheme and the version count
   (`historyVersionCount`). Every text follows the phone's scheme and stops at 200% (#186).
3. The current version, derived live from `StoreAccess.activeId` — never persisted on the app
   record — carries the `Current` badge and the `ink` dot; no other row does.
4. The install row (the list's last entry) renders install-appropriate copy and offers the same two
   actions as any other version that is not current.

## Using an older version is immediate and undoable (design-system-v1)

5. A tap toggles that row's expansion (`expandedId`); it never changes the version, and at most one
   row is expanded at a time.
6. `Use this version` in an expanded row calls `StoreAccess.rollback(app, row.id)` at once — the
   TAPPED row's own version — with no sheet, and shows the toast "Back on version N" (older than
   the version that was current) or "Now on version N" (newer) with `Undo`, which returns to the
   version that was current. The version left stays listed with its own `Use this version`, so the
   same Undo is reachable once the toast has gone. An Undo tapped while another row action runs
   goes once that one has settled. A failed switch says so and leaves the current version as it was.
7. Changing a version used this way never drops the newer ones: `deliverResult` lands that change
   on a rewind continuation (a new entry sharing the data), and the original keeps listing, and can
   use, every version (`history-logic.suite.ts`).

## An expanded row answers what happened, what it touched, and what to do next

8. The expanded body shows the `What it touched` chips (`summary.touched`, area names — never a
   diff), and the data-shape
   annotation (`addedFieldsLine`, when the row's `schema.json` changed since its predecessor),
   product copy at no less contrast than `text-2`. Opening a row never moves its words.
9. The current version's row offers exactly one action, `Change it`. Every other version's row
   (the install row and, after going back, a newer one included) offers exactly two:
   `Use this version` and `Make a copy from here`. Each shows its busy words while it runs, and
   two taps never run two (`RowActionFlight`, shared with Undo).

## No filters

10. Every version is listed; there are no filter pills (version-history REMOVED "Filter pills group
    the list by what changed"). The only controls are Back, `Report` and the rows.

## Any version can be copied into its own app

11. `Make a copy from here` asks Home's `CopyQuestionSheet` ("Copy the data, or start fresh?") when
    the launcher can copy data, else makes a fresh copy at once; leaving the question creates
    nothing. The answer goes to `onFork(app, row.id, { data })` — `LauncherRoot`'s busy-gated
    `StoreAccess.fork` of the exact version viewed — and the toast "Copy made" offers `Open`, which
    opens the copy. The copy has its own storage-engine appId (#43b): with "Copy the data" a
    one-time copy of the data, after which writes to either never show in the other; the original
    is unchanged. A failed copy says so. The question takes one answer: a second tap on it, even
    after the first copy is made, makes no second copy.

## Data-shape annotations + restore reassurance (D5, unchanged)

12. A row whose `schema.json` changed since its predecessor carries `addedFieldsBetween(before,
    after)` — the newly added fields as `"<display name> (<type>)"`. A row whose `schema.json` did
    NOT change (`StoreAccess.diff` omits unchanged files) carries no annotation.
13. An opened version whose schema lacks fields the current version has gained shows the
    hidden-data line (`historyHiddenData`, worded for using the version) above its actions, before
    either is tapped:
    `fieldsLeavingViewOnRestore(access, app, targetId, activeId)` is non-empty. A placeholder holds
    its place while it is worked out; a version with an identical or superset schema, and the
    current one, show nothing.

## F1 guard — roll-forward, unchanged

14. `listVersions` (via `timeline()`) on the primary lineage and on a fork both keep
    later-than-the-restore-target versions listed and restorable after a rollback. A fresh,
    undiverged fork's own listing never leaks a snapshot committed later on the original's line.

## Removed: named pins, confirm sheets

15. There is no pin action or pin label on any row (`version-history` REMOVED "Named pins") — the
    row's headline (the user's own words) is what labelling a version was standing in for. The
    store's pin verbs and `StoreAccess.pin`/`listPins` are untouched and remain covered by
    `store-access.suite.ts`; nothing here re-tests them.
16. History has no confirm sheet (design-system-v1 REMOVED "A confirm sheet makes the safe option
    the large button"): a tap on a row still only expands it, and its actions act at once with
    Undo (§6).

## Product verbs

17. Every new user-facing string (all v2 `COPY` entries this screen reads, `addedFieldsLine`'s
    output) passes the product-verbs guard (`product-verbs.suite.ts`) — no git/mechanism
    vocabulary.
