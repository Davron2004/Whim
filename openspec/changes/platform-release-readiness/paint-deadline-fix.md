# Reject malformed paint before completing startup

The owner's Sol-high investigation found a separate protocol edge case in the
merged startup deadline. A trusted `paint` without numeric timing cancels the
deadline, while the host stores `paintMs=null`. Since that single field controls
whether the app has painted, the UI stays on `Opening…` indefinitely.

This did not cause the recorded missing-resource/no-frame failure or the
SpringBoard crash. The current loader always sends numeric timing, and the outer
page authenticates the nonce before stamping trust. This correction handles a
malformed message from the trusted runtime; it does not change the trust model.

## Scope

Only `src/host/launcher/boot-state.ts`, its `test/boot-state.suite.ts`, and
`handoff/host-startup-watchdog.md` may change. Require `mountToFirstPaintMs` to be
a finite, nonnegative number before accepting paint or canceling the deadline.
Zero remains valid. Keep `paintMs !== null` as the single painted-state invariant;
do not invent a zero measurement or add another state flag.

## Proof

Start the fake-clock deadline and deliver authenticated paint frames with absent
or null payload, missing timing, string timing, NaN, Infinity and negative timing.
Each must be rejected and must leave the deadline armed. At six seconds the
timeout fires exactly once and the integrated state produces the existing app
error surface. A finite zero and positive timing complete startup without later
timeout. Run these tests before the fix to demonstrate failure, then after the
fix. Preserve all existing trust, lifecycle and stale-callback coverage.

Run launcher checks and the fast gate, update the existing contract within its
120-line cap, then independently review, integrity-check and merge. No native,
loader, bridge, CSP, SDK, protected configuration or simulator operations.
