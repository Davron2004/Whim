# History screen acceptance spec (shell-redesign-v2 chain-E, `4a`)

English-first spec for `HistoryScreen.tsx` + its RN-free decision logic (`history-logic.ts`).
Covers `openspec/changes/shell-redesign-v2/specs/version-history/spec.md` (all requirements,
both `REMOVED` blocks) and `app-launcher/spec.md`'s tile-colour-resolution requirement, as
implemented per `design.md` D11. Node-testable pieces (`history-logic.suite.ts`) drive a real
MemoryFs-backed `VersionStore` through `StoreAccess`, exactly like `store-access.suite.ts`; the
screen itself is rendered over the same kind of store in `history-ui.suite.tsx` (loading state,
expand-not-restore, confirm-gated restore and copy, reaching History from Home).

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
4. The install row (the list's last entry) renders install-appropriate copy and offers exactly one
   action, `Start a copy here` — no restore action, since there is no earlier state.

## Tapping a row expands it; restoring is confirmed, never instant

5. A tap toggles that row's expansion (`expandedId`); it never restores anything, and at most one
   row is expanded at a time.
6. Restoring is reachable only via `Go back to this` inside an expanded row, which opens a confirm
   sheet. Only on confirmation does the screen call `StoreAccess.rollback(app, row.id)` — the
   TAPPED row's own version, not a predecessor (the redesign's row IS the version, unlike the
   retired instant-restore surface's "restores the state before this prompt"). Cancelling the
   sheet calls no store method and shows no toast.
7. The confirm sheet's safe option (`Cancel`) is the large, full-width button; the consequential
   action (`Go back to it` / `Make the copy`) is plain text beneath it.

## An expanded row answers what happened, what it touched, and what to do next

8. The expanded body shows the `What it touched` chips (`summary.touched`, area names — never a
   diff), and the data-shape
   annotation (`addedFieldsLine`, when the row's `schema.json` changed since its predecessor)
   rendered with an explicit `hedge` mark spanning it.
9. The current version's row offers exactly one action, `Change it from here`. Any past version's
   row (including the install row, per #4) offers at most two: `Go back to this` and
   `Start a copy here`. No row ever exposes a third action (`history-logic.suite.ts` asserts
   `actions.length <= 2` across a mixed list).

## No filters

10. Every version is listed; there are no filter pills (version-history REMOVED "Filter pills group
    the list by what changed"). The only controls are Back, `Report` and the rows.

## Any version can become its own app

11. `Start a copy here` opens a confirm sheet naming the version being copied; on confirmation the
    screen calls `StoreAccess.fork(app, row.id)` (the exact version viewed) and shows the toast
    `Copy made — it's on your home screen`. Cancelling creates nothing.

## Data-shape annotations + restore reassurance (D5, unchanged)

12. A row whose `schema.json` changed since its predecessor carries `addedFieldsBetween(before,
    after)` — the newly added fields as `"<display name> (<type>)"`. A row whose `schema.json` did
    NOT change (`StoreAccess.diff` omits unchanged files) carries no annotation.
13. Restoring to a target whose schema lacks fields the active version has gained shows the
    `historyReassurance` line in the confirm sheet: `fieldsLeavingViewOnRestore(access, app,
    targetId, activeId)` is non-empty. Restoring to a target with an identical or superset schema
    shows no reassurance (empty).

## F1 guard — roll-forward, unchanged

14. `listVersions` (via `timeline()`) on the primary lineage and on a fork both keep
    later-than-the-restore-target versions listed and restorable after a rollback. A fresh,
    undiverged fork's own listing never leaks a snapshot committed later on the original's line.

## Removed: named pins, instant restore + undo

15. There is no pin action or pin label on any row (`version-history` REMOVED "Named pins") — the
    row's headline (the user's own words) is what labelling a version was standing in for. The
    store's pin verbs and `StoreAccess.pin`/`listPins` are untouched and remain covered by
    `store-access.suite.ts`; nothing here re-tests them.
16. There is no toast Undo and no instant restore-on-tap (`version-history` REMOVED "Tap restores
    the state before that prompt, instantly, with undo") — every restore goes through the confirm
    sheet described in §6-7.

## Product verbs

17. Every new user-facing string (all v2 `COPY` entries this screen reads, `addedFieldsLine`'s
    output) passes the product-verbs guard (`product-verbs.suite.ts`) — no git/mechanism
    vocabulary.
