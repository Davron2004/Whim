# History screen acceptance spec (task 1.3, version-history-ux)

English-first spec for `HistoryScreen.tsx` + its RN-free decision logic (`history-logic.ts`).
Covers the `openspec/changes/version-history-ux/specs/version-history/spec.md` and
`.../app-launcher/spec.md` requirements, as implemented per design D1/D3/D5/D7 and the F1
listing guard. Node-testable pieces (`history-logic.suite.ts`) drive a real MemoryFs-backed
`VersionStore` through `StoreAccess`, exactly like `store-access.suite.ts`; a few UI-wiring
assertions are static source checks (mirrors `dev-probe-back-button.suite.ts`'s idiom), since
`HistoryScreen.tsx` itself is not rendered under Node.

## Rows read as the user's own prompts

1. Each listed row's displayed text is `parsePromptEnvelope(snapshot.prompt).text` — a v1
   envelope renders its `text`; a raw legacy string (not envelope JSON) renders unchanged, with
   no error. Each row also carries `formatRelativeTimestamp(snapshot.createdAt)`.
2. The oldest row (the install event, no predecessor) has `restoreTargetId(list, lastIdx) ===
   null` — no restore affordance — and the screen wires this row's `TouchableOpacity` `disabled`
   to that same condition (static check).

## Tap restores the state before that prompt, instantly, with undo

3. Row `idx`'s restore target is `restoreTargetId(list, idx) === list[idx + 1].id` (D1) — the
   version active before that row's prompt.
4. Restoring calls `StoreAccess.rollback(app, target)`; the current marker (`activeId(app)`)
   reflects the target immediately afterward.
5. Undo (D3): the screen captures the active id *before* calling `rollback`, and its Undo calls
   `rollback` back to that captured id — round-tripping `activeId(app)` back to what it was
   before the restore.

## Roll-forward + named pins

6. Pinning (`StoreAccess.pin`) attaches a label to a version; re-pinning the same label onto a
   different version moves it (last write wins) — `listPins` shows the label only on the newest
   pinned version afterward.

## Any version can become its own app

7. "Make this version its own app" is `StoreAccess.fork(app, snapshot.id)` — an existing
   fork→install flow call, reused verbatim; creates a new launcher entry from that exact version.

## Data-shape annotations + restore reassurance (D5)

8. A row whose `schema.json` changed since its predecessor carries `addedFieldsBetween(before,
   after)` — the newly added fields as `"<display name> (<type>)"`. A row whose `schema.json`
   did NOT change (StoreAccess.diff omits unchanged files) carries no annotation.
9. Restoring to a target whose schema lacks fields the active version has gained shows a
   reassurance: `fieldsLeavingViewOnRestore(access, app, targetId, activeId)` is non-empty.
   Restoring to a target with an identical or superset schema shows no reassurance (empty).

## F1 guard — fork listing never leaks another lineage

10. `listVersions` on a fresh, undiverged fork lists ONLY that fork's own line (via `history()`)
    — it must never include a snapshot committed later on the ORIGINAL's lineage, even though
    `timeline()` on that same fork entry is known to leak it (verified engine gap, see
    `handoff/store-access-history.md`).
11. `listVersions` on the primary/original entry uses `timeline()` — a version rolled backward
    past stays listed and restorable (roll-forward survives).

## Product verbs

12. Every new user-facing string (all new `COPY` entries, `addedFieldsLine`'s output) passes the
    product-verbs guard (`product-verbs.suite.ts`) — no git/mechanism vocabulary.
