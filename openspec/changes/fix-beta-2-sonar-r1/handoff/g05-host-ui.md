# g05-host-ui handoff

S26: accept-proposed
S27: fixed (structural)
S28: accept-proposed
S29: fixed (structural)
S30: fixed (structural)
S31: fixed (structural)
S34: accept-proposed
S47: accept-proposed
S50: fixed (structural)
S51: fixed (structural)
S53: accept-proposed
S95: fixed (structural)
S138: fixed (behavioral)

## Accept proposals
- S26 (SheetAnchor.tsx:66), S28 (TravelLayer.tsx:140), S47 (KeyboardShell.tsx:141): the `[...set]` is a deliberate snapshot of a listener Set that is notified while listeners subscribe/unsubscribe (React external-store subscriptions re-subscribe inside the notification). Iterating the live Set would visit a listener that unsubscribes and resubscribes during the loop again, and listeners added mid-loop, changing notification semantics.
- S53 (OverlayModal.tsx:97): `releaseHolds` calls `release` -> `leave`, which hands the turn to the next waiting grant (arbitrary overlay code) and can add a new entry to `holds` mid-iteration; the snapshot keeps "ends every hold that existed now". Iterating the live Map would release holds created by that callback.
- (Superseded by Revision 1: S29/S30 are fixed, not accepted.) S29/S30 originally: the bare `progress.value;` inside each `useAnimatedStyle` worklet is a deliberate read that registers the travel's progress as an input so the style re-runs on every frame (documented by the comment above it; the Reanimated test double re-runs a style only for shared values it read). Deleting it stops the per-frame run. `void progress.value` is the usual marker but eslint here forbids it (`sonarjs/void-use`, `no-void`); the only other forms are a dummy use of the value or a new `.get()` API the double does not implement. Not a missing call.
- S34 (tokens-pure.ts:205): `staggerDelay(index, reduceMotion)` is the shell's public timing helper with 22 references (callers + suites); splitting it into two functions changes that API for no behavioral gain.

## Red-check
- Test command: `/Users/davrondjabborov/.cache/whim-run/capped-run.sh --mb 4096 -- npm run -s launcher:test -- --only shell-tokens` (new test "a Reduce Motion read the OS rejects is logged with its reason, never as \"[object Object]\", ..." in src/host/launcher/test/shell-tokens.suite.tsx)
- Prod file whose revert turns it red: src/host/ui/tokens.ts (verified once locally: reverted -> 1 check failed, detail `[object Object]`; restored -> 225 pass)
- Everything else is structural (no test).

## Commands run
- `npm run build`: exit 0
- `launcher:test --only shell-tokens`: exit 0 (225 checks); with tokens.ts reverted: 1 failed (expected red)
- `launcher:test --only make-it-motion-ui,ready-motion-ui,sheet-morph-ui,webview-pool,grid-composition,mini-app-host-ui,shell-status-ui,prompt-flow-ui,screen-controls,build-lifecycle,shell-tokens`: exit 0 (1520 checks)
- `npx eslint --max-warnings 0 <7 touched ts/tsx files>`: exit 0
- `npm run -s typecheck`: exit 0

## Deviations
- Added `accessibilityQueryFailure` to the native-host test double (src/host/launcher/test/native-host.tsx, in allowlist) so a test can make the Reduce Motion query reject.
- S138 fix changes the debug-log detail for non-Error rejections: a string is logged as itself, any other value as `rejected with a non-error <typeof>` (was `String(e)`, "[object Object]" for objects).

## Revision 1
- S29/S30 (MED): no longer accepted. `progress.value;` replaced by `progress.get();` in both `useAnimatedStyle` worklets (TravelLayer.tsx:282/:286); the closure capture of `progress` is what subscribes in real Reanimated 4.6. Added `get(): T { return this.value; }` to the double's `SharedValue` (src/host/launcher/test/native-reanimated.tsx) so the double still tracks the read. Now fixed (structural).
- S138 (LOW): tokens.ts `failed` logs `String(e)` for non-object primitives, the message for an Error, and `rejected with a non-error object|function` for objects/functions. Test extended: a numeric rejection is logged as `42`.

## Red-check (revised)
- Commands: `/Users/davrondjabborov/.cache/whim-run/capped-run.sh --mb 4096 -- npm run -s launcher:test -- --only shell-tokens,make-it-motion-ui,ready-motion-ui,sheet-morph-ui,mini-app-host-ui,grid-composition`
- Prod files whose revert turns it red: src/host/ui/tokens.ts (shell-tokens) and src/host/ui/TravelLayer.tsx (removing the two `progress.get();` lines: verified, travel suites red with "got 2, want 1" ember checks).

## Revision 1 commands
- launcher:test (6 suites above): exit 0, 935 checks; with `progress.get()` removed: red (expected)
- eslint --max-warnings 0 TravelLayer.tsx tokens.ts: exit 0
- npm run -s typecheck: exit 0

## Revision 2
- S138 (MED): tokens.ts `failed` no longer calls `String(e)` on an `unknown`. Default `rejected with a non-error ${typeof e}`; Error -> message; string -> itself; number/boolean/bigint -> `String(e)`.
- LOW native-reanimated.tsx: `get()` moved below the `value` setter (pair kept together).
- LOW shell-tokens.suite.tsx: reason cleanup in try/finally; object case pinned to `'rejected with a non-error object'`.
- LOW: top status lines rewritten (S29/S30 now fixed (structural)).
- Red-check: `/Users/davrondjabborov/.cache/whim-run/capped-run.sh --mb 4096 -- npm run -s launcher:test -- --only shell-tokens,make-it-motion-ui,ready-motion-ui,sheet-morph-ui,mini-app-host-ui,grid-composition`; prod files: src/host/ui/tokens.ts, src/host/ui/TravelLayer.tsx (unchanged since Revision 1).
