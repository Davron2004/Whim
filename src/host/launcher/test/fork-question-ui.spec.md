# Fork-question sheet acceptance spec (task 1.2, linked-apps-data-model chain-2)

English-first spec for the share-vs-fresh question `HomeScreen.tsx` asks between the Fork tap
and the actual fork (design D4), covering
`openspec/changes/linked-apps-data-model/specs/app-launcher/spec.md`'s "Explicit fork asks
share-vs-fresh at fork time" requirement. `HomeScreen.tsx`/`LauncherRoot.tsx` are not rendered
under Node, so the wiring is verified with static source checks (mirrors
`dev-probe-back-button.suite.ts`'s idiom); the answer values and the copy guard are the parts
that ARE plain-function-testable and are asserted directly.

## Fork tap opens the share-vs-fresh sheet

1. The action-sheet row for `COPY.actionFork` does NOT call `onFork` directly — it stores the
   tapped app as the fork-question target (`setForkTarget`), which shows a second sheet with
   exactly two answers: `COPY.forkShareData` ("Use the same saved data") and
   `COPY.forkStartFresh` ("Start fresh") (static check on `HomeScreen.tsx`).

## Each answer threads to `StoreAccess.fork`

2. Choosing `COPY.forkShareData` calls `onFork(app, { shareData: true })`; choosing
   `COPY.forkStartFresh` calls `onFork(app, { shareData: false })` (static check on
   `HomeScreen.tsx`).
3. `LauncherRoot`'s `onFork` forwards those opts verbatim into `access.fork(app, undefined,
   opts)` — `shareData: true` joins the new entry to the parent's storage group, `shareData:
   false` leaves it in its own group, exactly per the `storage-groups` contract (static check on
   `LauncherRoot.tsx`).

## Rewind-continuation seam never asks

4. The question lives ONLY in `HomeScreen`'s explicit-fork path. Nothing in this chain calls
   `access.fork(..., { shareData: true })` unconditionally without going through the sheet — the
   future rewind-continuation caller (not yet built) is expected to call `access.fork(entry,
   undefined, { shareData: true })` directly, bypassing `HomeScreen` entirely, never routing
   through this sheet (documented; no code to assert against yet since the seam doesn't exist).

## Product verbs

5. `COPY.forkShareData` and `COPY.forkStartFresh` carry no "clone"/"link"/"storage"/"database"/
   git vocabulary and pass the product-verbs guard (`product-verbs.suite.ts`), which already
   iterates every `COPY` value.
