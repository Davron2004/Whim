# Shared-storage acceptance spec (task 1.3, linked-apps-data-model chain-3)

English-first spec for the on-device data path a storage group actually exercises: two installed
entries whose `engineAppId` resolves to the SAME group id, sharing one SQLite file (per
`handoff/storage-groups.md`). Covers
`openspec/changes/linked-apps-data-model/specs/linked-apps/spec.md`'s "Storage groups are
host-mediated and decided at creation" (shared-group read scenario) and "Schema collisions on
shared storage fail closed at launch" requirements, plus `specs/app-launcher/spec.md`'s delete/
refcount requirement (already covered by `installed-apps.spec.md` §27-33 and `store-access.suite.ts`
§27-33 -- not repeated here).

Only one realm is ever live at a time (one WebView == one realm): `useMiniAppHost.bind()` always
closes the previous realm's engine before opening the next (design D7). So "founder and sharer
both read the shared database" is never two simultaneous open handles -- it is always a
close-then-reopen cycle over the same file. These tests exercise the real `engine`/`launchApp`
machinery (no mocks) file-backed via `createNodeSqlExecutor`, so the SQLite handle lifecycle the
model depends on is genuinely pinned, not assumed.

## Sharer reads the founder's records across a close-then-reopen bind cycle

1. Founder launches (`launchApp`) against a file keyed by the shared group id, writes records,
   and its engine is closed (mirrors `bind()` tearing down the previous realm). A second launch
   against the SAME group id/file -- standing in for the sharer, opened with the identical schema --
   reads back the founder's records unchanged, from the same database file.
2. The cycle is not one-shot: closing the sharer and reopening the founder a second time still
   reads everything written so far (both the founder's original records and anything the sharer
   added), proving the handle lifecycle survives more than one hop.

## Conflicting artifact aborts pre-delivery, shared data untouched

3. The founder opens a schema, writes a record, and its engine closes (end of its turn). The
   sharer then launches with an artifact that reuses one of the founder's burned field IDs at a
   different type. `launchApp` returns a structured failure (`ok: false`, a conflict-class
   `error.kind`) BEFORE any bundle would run -- the sharer's realm is never constructed. Reopening
   the group's file afterward with the founder's ORIGINAL schema proves the shared data is
   unchanged: the founder's record still reads back exactly as written, and no column for the
   sharer's conflicting field was ever added.

## Divergent same-named fields coexist

4. The founder and the sharer each declare a field named "notes" under DISTINCT burned IDs in the
   same shared collection. Both launches succeed (the sharer's is a plain additive schema change,
   not a conflict). Each app's `records.list` projects only the field IDs in ITS OWN currently-open
   schema -- so the founder never sees the sharer's "notes" value under its own "notes" key, and the
   sharer never sees the founder's, even though the display name collides and the underlying table
   is the same physical file.

## Launch failure renders honest product copy

5. When `launchApp` refuses a launch (as in scenario 3), the launcher's product surface (not just
   the `__DEV__` probe screen) shows an honest, static failure message -- never the raw structured
   `{kind, hint}` -- and offers a way back to Home. The copy passes the product-verbs guard: no
   "clone"/"link"/"storage"/"database"/"schema"/git vocabulary (static source + copy-table checks,
   since `MiniAppView`/`useMiniAppHost` are not renderable under Node).
