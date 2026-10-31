# Research digest: what do the beta-2 spec-changing fixes touch, and which are still open at `485aecef`?

Written by the side-track planner from direct reading (the planner was the researcher; no source dumps). Terrain only; the approach is in design.md. Excerpts of code are cited by file:line.

## Relevant files
- `server/src/sse.ts` — `buildSseStream`: starts a keepalive interval in `start()`, emits nothing until the pipeline's first event or the first interval tick (`keepaliveMs: 15_000`, `server/src/lifecycle.ts:467`).
- `src/host/launcher/transport-shared.ts:209` — `CONNECT_TIMEOUT_MS = 15_000`, the connect / first-event window both transports arm at request start and disarm at the first chunk.
- `src/host/launcher/xhr-transport.ts:332`, `generation-client.ts:585` — the two timers; `onprogress` disarms on any chunk (keepalive included).
- `src/host/launcher/prompt-flow.ts:608-740` — `RunSignals.lastFrameAt` ("ANY frame ... INCLUDING the transport's own keepalive"), `STALL_MS = 40_000`, `livenessOf`, `withKeepalive`.
- `src/host/launcher/making-progress.ts:104`, `home-live.ts:71` — both read `livenessOf(...) === 'stalled'` (Making page stall line; Home tile stuck light).
- `src/host/launcher/LauncherRoot.tsx` — `onKeepalive` (~2933), `settleServerEnding` (~2535-2566: `update` fallback -> `genericFailure ?? updateScreenFrom(prev, notice)`), `failureFromRecord` (~3170-3197, sets `needsUpdate` via `stillNeedsUpdate`), `seeWhy` (~3452), the failed-change toast (~3468).
- `src/host/launcher/grid-composition.ts:78` — `attemptState`: `rec.failure?.remedy?.kind === 'update' ? 'needs-update' : 'failed'`, no level check.
- `src/host/launcher/build-lifecycle.ts:354` — `stillNeedsUpdate(rec, protocolLevel)`; `failure-kind.ts` — `needs-update` kind and its `UPDATE` actions.
- `src/host/launcher/WhimSheet.tsx:51-200` — `WhimSheetProps`, the row groups; no See why row.
- `src/host/ui/AppTile-states.ts:84`, `HomeScreen.tsx:502` — the "Copy" label is shown when `app.forkedFrom !== undefined`.
- `synthrun/sweep.ts:795-830` (`sweepOneScreen`), `synthrun/test/sweep-reach.ts:98,572-589` (`FIXTURE_UNDER_MODAL`, the flaky test), `src/sdk/surfaces.tsx:1048` (an exiting Modal is `pointer-events:none`).
- `package.json:11` — `"android:release": "react-native run-android --mode offline --active-arch-only"`; `package.json` is in `scripts/gate.sh` `CONFIG_SET`. RN CLI 20.1.0 `run-android` has `--device <string>` (index.js:142-176); with a device it builds then installs to that device only (index.js:210), without one it installs on all (`runOnAllDevices.js:58`).
- Specs read: prompt-flow (stall heartbeat 353-371, connect timeout 449-470, fallbacks 533-539), generation-contract (envelope 327-345), generation-server (SSE endpoint 85-127), app-update-gate (update screen 26-60), service-refusals, synthetic-run (146-182), native-release-config (61-66), app-launcher, and the unarchived design-system-v1 deltas (app-launcher: tiles, orb, Whim sheet; prompt-flow: Making page, Failure by kind).

## Current behavior
- #222 cause (read, not yet reproduced on a device): the connect window (15 s) and the first keepalive (15 s, interval started after the request) race; the stub delays EVERY event, including the first, so with a 20 s step no byte arrives before the window fires and the attempt ends as a `network` failure ("I lost the connection"). After the first byte no timeout applies at all.
- #188: `lastFrameAt` moves on keepalive, so the 40 s stall line can never show on a live connection.
- #191: grid marks `needs-update` from `remedy.kind` alone; the reopened page uses `stillNeedsUpdate`; they disagree after an update.
- Ruling 7: an `update` compat fallback mid-run opens the separate update screen; system.md §3.2 says a Needs-update tile taps to the "Update screen"; the code already routes a reopened needs-update record to the Failure page (`needsUpdate: true`).
- Ruling 4: See why exists only on the failed-change toast.
- #185: unverified cause (late close vs lost click); a late close is a real defect the fixture reproduces.

## Constraints and invariants
- Keepalive is not a `GenerationEvent` (`generation-client.ts` parser, `transport-shared.ts` doc); the keepalive block carries no `id:`.
- The Metro bundle must not gain executable contract imports (`guard:metro`); `server/` and device share only type-only contract code.
- `docs/design/system.md` §4.6, §8 and the DSv1 delta `openspec/changes/design-system-v1/specs/prompt-flow/spec.md:104` say "stuck after 40 s with no frame / No bytes for 40 s": these change with ruling 5.
- `package.json` edit = CONFIG_SET: human-bootstrap.
- Three of the new requirements sit beside requirements that exist only in the unarchived design-system-v1 delta (app-launcher "Tiles show their state", "The Whim sheet is a running app's one menu", "Changing an app keeps it running"): they are ADDED here, not MODIFIED, so archive order does not matter.

## Integration points
- Server first frame: `buildSseStream.start()` before `for await`. Device liveness: `RunSignals` + `recordAttemptFrame/Keepalive` in LauncherRoot. Needs-update: `ComposeOptions` in `composeGrid` (pure module, importable from Node suites) and `settleServerEnding`. See why: `WhimSheetProps` + `runningChange.failed`. Sweep: after the backdrop dismissal at `sweep.ts:~769`.

## Risks and unknowns
- I did not run anything: the #222 cause, the #185 cause and the #193 state are unconfirmed by execution.
- Whether PreToolUse hook input carries an agent identity (matters for #181 option A) was not verified.
- Whether the 426 `update_required` refusal at send time counts as "during a run" for ruling 7: treated as NO (kept on the update screen, per app-update-gate "A refusal opens the screen"); PO to confirm.

## Open questions for the planner
- None blocking; the PO questions are in READY.md.
