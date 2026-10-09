# Fork-question sheet acceptance spec (task 1.2, linked-apps-data-model chain-2)

English-first spec for the question `HomeScreen.tsx` asks between the Fork tap and the actual
fork. Its share-vs-fresh form (linked-apps-data-model design D4) was retired by copy-app-data:
a copy never shares the original's data. Scenarios 1-3 are rendered end to end through
`LauncherRoot` in `fork-ui.suite.tsx` (long-press → Fork → answer → `StoreAccess.fork`'s
arguments); the copy guard is `product-verbs.suite.ts`.

## Fork tap opens the fork question

1. The action-sheet row for `COPY.actionFork` does NOT call `onFork` directly — it stores the
   tapped app as the fork-question target (`setForkTarget`), which shows a second sheet. A copy
   never shares the original's data (copy-app-data), so the sheet has no sharing answer; its
   answer today is `COPY.forkStartFresh` ("Start fresh").

## The answer threads to `StoreAccess.fork`

2. Choosing `COPY.forkStartFresh` calls `onFork(app, { data: 'fresh' })`.
3. `LauncherRoot`'s `onFork` forwards those opts verbatim into `access.fork(app, undefined,
   opts)`; no `fork` option can place the copy in the parent's storage group.

## Rewind-continuation seam never asks

4. The question lives ONLY in `HomeScreen`'s explicit-fork path. The rewind continuation — a
   rebuild of an app that is behind its tip — calls `access.continueSharingData(entry)` directly,
   bypassing `HomeScreen` and never routing through this sheet (`build-lifecycle.suite.ts`,
   behind-tip rebuild).

## Product verbs

5. `COPY.forkStartFresh` carries no "clone"/"link"/"storage"/"database"/
   git vocabulary and passes the product-verbs guard (`product-verbs.suite.ts`), which already
   iterates every `COPY` value.
