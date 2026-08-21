# Design: failure-dismiss-honesty

## Context

The failure screen (ghost-opened or live-terminal) exits through `onDismiss` →
`onDismissPending` → the shell's `dropAttempt`, which deletes the pending-build record and its
run journal together (generation-observability, handoff/shell-wiring.md). Its label says
"Back to your apps" (`copy.ts:158`). There is no non-destructive exit.

## Decisions

1. **Two exits, one destructive.** `FailureScreen` gains an `onBack` callback alongside the
   existing `onDismiss`. `onBack` renders as the prominent plain exit with the honest label
   "Back to your apps"; `onDismiss` is relabeled "Discard this attempt" and presented as the
   secondary, visibly destructive choice (muted/destructive styling per theme tokens — exact
   token choice at implementation, matching the screen's existing idiom).
2. **The leave path deletes nothing.** `LauncherRoot` wires `onBack` to plain navigation home
   (same screen transition `onDismissPending` uses, WITHOUT the `dropAttempt` call). The
   `dropPendingBuild(`-one-call-site and `journal.delete` disciplines are untouched — leave adds
   no store calls at all.
3. **Hardware back = leave, not discard.** Android back on the failure screen must take the
   non-destructive path. If it already routes to a plain leave, assert it; if it routes to
   dismiss, rewire it to `onBack`. Never let hardware back destroy a record.
4. **Both entry points get the same pair.** Ghost-opened and live-failure screens render
   identically (both have a persisted `failed`/`interrupted` record behind them by the time the
   screen shows); the same two exits apply to both.
5. **Copy keys:** rename the value of `failureDismiss` to 'Discard this attempt'; add
   `failureBack: 'Back to your apps'`. `doneBackToApps`/`launchFailedBack` are unrelated and
   untouched.

## Risks / Trade-offs

- [Users accustomed to the old exit now leave records behind] → that is the point; the ghost
  tile remains visible and individually discardable.
- [Two buttons crowd the screen] → Retry + Back + Discard is still a three-action screen, within
  the existing layout idiom (FailureScreen already stacks actions vertically).

## Migration Plan

Pure UI/copy change; no data shape or store API changes. No migration.

## Open Questions

None.
