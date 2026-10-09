# Host startup failure after native rule-load failure

## Finding and dispatch condition

D17 disables WebView JavaScript when its compiled native rule list is unavailable. The host currently starts its six-second watchdog only after an accepted delivery frame, which disabled JavaScript cannot emit. Source review therefore predicts an indefinite boot overlay instead of the required app-error state. Reproduce this in the primary Release simulator build, with the resource lookup pointed at a missing filename, normal LauncherRoot and the seeded Tip Splitter. Do not dispatch implementation until that reproduction is recorded.

## Existing requirement

The sandbox-isolation delta requires no script or delivery without the rule list, followed by the app-error state. `app-launcher` boot-state requirements allow boot only until paint or launch failure. Keep the current error copy and retry path. Native rules, CSP, bridge authority and WebView recreation remain governed by D17 and the standing runtime decisions.

## Bounded correction

Start a deadline when a fully assembled source delivery is attempted, even if the page never sends a frame. Keep accepted delivery as a valid trusted signal and preserve the existing six-second paint timeout behavior. Trusted paint ends boot; untrusted paint must not cancel the deadline. Do not compare iframe and host generation counters for paint.

Use the RN-free `boot-state.ts` seam for a small timer/state helper with injected scheduling so Node tests can execute timeout and cleanup behavior. Wire it from `useMiniAppHost.ts`. Cancel and invalidate old attempts on bind/reset, retry, exit, unmount and terminal errors, so stale callbacks cannot overwrite a newer launch or a real failure. Existing lifecycle source checks remain as wiring checks, alongside behavioral tests.

## Scope

- `src/host/launcher/boot-state.ts`
- `src/host/launcher/useMiniAppHost.ts`
- `src/host/launcher/test/boot-state.suite.ts`
- `src/host/launcher/test/bundle-error-watchdog.suite.ts`
- `handoff/host-startup-watchdog.md` (at most 120 lines)

No new dependency or protected configuration change is needed. Report uncovered cases instead of widening this scope.

## Required evidence

1. Before/after Release simulator missing-resource test: open Tip Splitter, wait at least six seconds, capture native missing/unavailable logs and the boot/error UI. A probe-mode zero-traffic result is insufficient.
2. Behavioral tests: no delivery frame times out to app-error; delayed normal delivery and trusted paint remain running; bind/retry and stale callbacks cannot poison a later attempt; exit/unmount clean up; immediate fatal errors retain their message; untrusted paint cannot end boot. The no-frame test must fail against the previous accepted-delivery-only arm behavior.
3. Existing source-level trust/reset/cleanup checks remain. Targeted launcher checks, fast gate, independent review, scope integrity, merge regate, and primary simulator confirmation all pass before the correction is complete.

## Research references

`useMiniAppHost.ts:43–86,197–256,331–373` owns the timer and lifecycle. `MiniAppView.tsx:72–98` recreates keyed WebViews and delivers after load; it needs no change. `boot-state.ts` and `test/boot-state.suite.ts` already provide an RN-free execution seam. `test/bundle-error-watchdog.suite.ts:162` currently pins accepted-delivery-only arming and must change to match D17. Researcher digest is in `research.md`, “Host startup deadline”; native reproduction is still pending at plan creation.

Settled authority: `docs/decisions.md` #35 and #37 constraints 2/4/5; `docs/spike2-findings.md` delivery and carry-forward constraints 2–5. Root read these before authorizing any runtime change.
