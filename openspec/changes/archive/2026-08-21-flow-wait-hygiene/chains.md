# Context chains: flow-wait-hygiene

<!--
  Tasks from tasks.md grouped into context chains for the dispatcher.
  This change is sequenced (in the proposal) to apply after `launcher-ghost-tiles` lands, since
  both edit LauncherRoot.tsx. Within this change, chains 2 and 3 also share LauncherRoot.tsx, and
  chains 3-5 share copy.ts (new COPY table strings for busy/loading/boot copy) — both risks are
  handled with declared `after:` ordering rather than parallel dispatch, since additive-looking
  edits to the same file by independently-dispatched chains still violate the no-shared-file rule
  for undeclared-independent chains.
-->

## chain-1: transport-cancel-timeout

- tasks: 1.1-1.5
- rationale: all changes live in `generation-client.ts` and `xhr-transport.ts` — the shared
  transport module clarify/rewrite/generate all route through; self-contained, testable via
  `npm run launcher:test` without touching UI screens.
- reads: `specs/prompt-flow/spec.md` (Requirement: Leaving clarify or rewrite cancels the
  in-flight request cleanly; Requirement: A hung connection to the generation stream is
  surfaced honestly); `design.md` §D2 (connect/first-event-only timeout, not stream-duration)
- writes-contract: handoff/transport-cancel.md (the new `AbortSignal`-accepting
  `clarifyPrompt`/`rewritePrompt` signatures and the timeout classification behavior chain-2
  needs to call correctly)

## chain-2: launcher-compose-plan-cancel

- tasks: 2.1-2.4
- rationale: the B1 navigation-hijack bug fix and A2/B2 rewrite cancellation both live in
  `LauncherRoot.tsx`'s `onComposeContinue`/`openPlan`, and both consume chain-1's new signal
  parameter.
- reads: `specs/prompt-flow/spec.md` (Requirement: Leaving clarify or rewrite cancels the
  in-flight request cleanly; Requirement: A response to a request the user has left cannot move
  the screen); `design.md` §D1; handoff: handoff/transport-cancel.md
- writes-contract: none
- after: chain-1 (consumes its contract)

## chain-3: launcher-open-fork-delete-busy

- tasks: 3.1-3.3
- rationale: B3/B4 busy states span `LauncherRoot.tsx`'s `onOpen`/`onFork`/`onDelete` and
  `HomeScreen.tsx`/`app-tile.tsx`'s triggering controls; grouped together because the in-flight
  status these controls render is threaded from the same three `LauncherRoot.tsx` handlers.
- reads: `specs/app-launcher/spec.md` (Requirement: Opening an app shows an immediate busy
  affordance; Requirement: Fork and delete show a busy state and cannot be re-triggered
  mid-operation); `design.md` §D3
- writes-contract: none
- after: chain-2 (shares `LauncherRoot.tsx`; contracts alone don't capture this — it's a
  same-file ordering constraint, not an interface dependency)

## chain-4: mini-app-boot-state

- tasks: 4.1-4.3
- rationale: B7's boot state lives entirely in `useMiniAppHost.ts` (deriving a "has painted"
  signal from the existing `paintMs` field) and `MiniAppView.tsx` (the new render branch); no
  overlap with the compose/plan/open/fork/delete files above.
- reads: `specs/app-launcher/spec.md` (Requirement: The mini-app container shows a boot state
  before first paint); `design.md` §D5
- writes-contract: none
- after: chain-3 (both may add entries to the shared `copy.ts` COPY table; serialized rather than
  risking two chains editing that file in parallel)

## chain-5: history-loading-confirm-guard

- tasks: 5.1-5.4
- rationale: B5 (loading state), B6 (confirm-sheet double-submit disable), and D5 (restore-diff
  pending indicator) are all localized to `HistoryScreen.tsx`'s `load()`/`confirm`/`ConfirmBody`
  machinery — one file, one context.
- reads: `specs/version-history/spec.md` (Requirement: History's first load shows a loading
  state, never fake-empty; Requirement: The confirm sheet's Restore and Copy actions disable
  while in flight; Requirement: The restore-diff reassurance line shows a pending state while it
  loads); `design.md` §D4, §D6
- writes-contract: none
- after: chain-4 (both may add entries to the shared `copy.ts` COPY table; serialized rather than
  risking two chains editing that file in parallel)

## verification (human/closure, not dispatched)

- task 6.1-6.2 run after all chains merge onto the staging branch, per the standard closure gate
  (`scripts/gate.sh` inner-loop, `scripts/gate-full.sh` at merge) — not its own chain.
