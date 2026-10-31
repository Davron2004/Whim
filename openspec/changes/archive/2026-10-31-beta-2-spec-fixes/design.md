## Context

research.md has the terrain. Seven items are decided by the PO (po-decisions.md rulings 1, 4, 5, 7) or by an issue's own "Done looks like"; what is left is how.

## Goals / Non-Goals

**Goals:** one rule for keepalives (liveness, not progress) applied at the server, the transport and the clock; needs-update decided by one predicate and one landing; each ruling written as a requirement with a testable scenario.

**Non-Goals:** an idle timeout after the first byte (spec says none; a dead socket with no keepalive stays undetected: follow-up); new stall-line or stuck-tile copy (kept as is, PO question in READY.md); changing the wire; resolving #82 or #184.

## Decisions

- **D1 Opening frame at the server, window unchanged on the device.** The race is "first keepalive at 15 s vs connect window 15 s". Writing the keepalive frame as the stream opens makes the first byte immediate, so the window keeps its one meaning (the server did not answer) and a slow step can never look like a hung connect. Rejected: lengthening `CONNECT_TIMEOUT_MS` past the keepalive interval (hides the race, delays a real hung-connect failure to 30+ s); an idle timer after the first byte (the spec forbids it, and a slow model is not a dead one). The opening frame has no `id:`, so event ids and the resume semantics are unchanged.
- **D2 Progress clock = every `GenerationEvent`.** `lastFrameAt` becomes the last progress event; the keepalive no longer touches `RunSignals`. `usage` and `diagnostic` count as progress (a model call finished; a repair began). `livenessOf` keeps its four states; only the clock under `connected`/`stalled` changes. The Home tile follows for free (same function). The callback `ClientOptions.onKeepalive` is removed if nothing else reads it (knip decides), the SSE parser still recognises and skips the block.
- **D3 Needs-update during a run lands on the Failure page.** `settleServerEnding` already settles the record `failed` with an `update` remedy; it then opens that record's Failure page (`failureFromRecord`, which sets `needsUpdate`) instead of `updateScreenFrom`. The update screen stays for flows with no run and for `update_required` refusals at send time (`app-update-gate` unchanged). The tile uses `stillNeedsUpdate` through a new `protocolLevel` in `ComposeOptions`, so `grid-composition.ts` stays pure.
- **D4 See why row is state, not a toast.** The row is driven by the same `runningChange.failed` that drives the orb's danger dot, and calls the existing `seeWhy`, so the sheet row, the toast action and the dot can never disagree.
- **D5 Copy label is already data-driven (`forkedFrom`).** The change is a requirement plus a test that locks both paths; code changes only if the continuation path does not set `forkedFrom` (to be checked first, task 4.4).
- **D6 Sweep waits on the dismissed backdrop, not on a clock.** After a backdrop dismissal the sweep polls until the dismissed backdrop stops receiving at its click point, capped at 5 s, once per dismissal. The bound is counted (dismissals are actions), which keeps the spec's "bound never depends on the clock". The fixture with `onClose` delayed by 2.5 s fails on HEAD every time. The load flake's cause may be a lost click (b): the task keeps an instrumented 20x-under-spinners acceptance and files a follow-up if (b) shows.
- **D7 `android:release` is a small Node script behind the package.json line.** `scripts/android-release.mjs` resolves the serial (`--device` or `ANDROID_SERIAL`), checks `adb devices`, then runs `react-native run-android --mode offline --active-arch-only --device <serial>` with `ANDROID_SERIAL` exported. A release check asserts `package.json` never maps `android:release` (or any script) to a bare `run-android` without the wrapper. The one `package.json` line is HUMAN-BOOTSTRAP and lands first; the script file arrives in chain-7.

## Risks / Trade-offs

- [The opening frame may be buffered by a proxy] -> Cloud Run streams SSE already (keepalives work today); the device E2E against the stub and the smoke after deploy check the first byte.
- [Stall line now fires for a model that reasons silently >40 s with no `thinking` events] -> that is the ruling; copy "No word from the server" is then slightly off: PO question, no change here.
- [426 at send time stays on the update screen while 'update' fallback mid-stream goes to the Failure page] -> deliberate split; stated in the scenarios.
- [ADDED app-launcher requirements duplicate part of design-system-v1's unarchived text] -> either archive order works; fold them in at archive if wanted.
