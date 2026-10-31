# Review (Opus high): chain-2, chain-1, ds-v1 27-228 (saved by the orchestrator; reviewer has no Write tool)

## chain-2 (`f42268b0..6a8030b1`): VERDICT findings
- [MEDIUM] `specs/prompt-flow/spec.md` scenario "A keepalive alone does not clear the quiet indication" says the line keeps "its elapsed duration still counting from the last progress event"; `making-progress.ts:105` renders `makingStallLine(STALL_MS / 1000)`, a constant ("No progress for 40 s" after 90 s). Pre-existing, but this change owns the MODIFIED requirement. Done: line counts up (elapsed since `lastProgressAt`, tests at 50 s and 90 s), or scenario + copy reworded to a fixed threshold and the PO told.
- [LOW] `run-signals.suite.ts` new "livenessOf over a real stream" test can't fail on the old code (never wires `onKeepalive`); only `prompt-flow-ui.suite.tsx` discriminates. Done: rename to what it checks, or wire through the shell's fold.
- [LOW] stale comments: `generation-client.suite.ts:22` (onKeepalive), `run-signals.suite.ts:131` (keepalive keeps it from stalled), `build-lifecycle.suite.ts:624,658,705,710,770` ("any-frame clock"/"liveness"). Done: reword to "progress".
- [LOW] `fake-xhr.ts holdTimers()`: sound for its use; limits (returns number not Timeout, ignores extra args, no setInterval, callback-armed timers wait for next advance), used by the fetch suite too. Done: doc line of limits; ideally `test/held-clock.ts`.
- [LOW] copy "No progress for 40 s. Still waiting." fits §8 and is linted (`product-verbs.suite.ts:87`, `whim-prose.suite.ts:98`); `docs/design/mockups/index.html:1286,1562,1757` still old copy.
Passed: no `lastFrameAt`/`onKeepalive`/`withKeepalive`/`recordAttemptKeepalive` left in src/; both transports disarm on first chunk (`armed() === 0`); no-byte → `network` + `CONNECT_TIMEOUT_HINT` at exactly 15 s; class-A edits compile-forced; delta keeps all scenario names; no attribution.

## chain-1 (`f42268b0..d0a56026`): VERDICT findings (minor)
- [LOW] `server/test/server-core.suite.ts testSseOpeningFrame`: only the first read is raced with `within()`; the post-release read and the keepalive-off read are bare awaits (hang instead of named failure). Done: wrap both, TIMED_OUT = failure.
- [LOW] `server/src/sse.ts:29` `@param keepaliveMs` doesn't mention the frame written at open.
Passed: no `id:` on the opening frame; gated by `useKeepalive`; `within()` uses a ref'd timer; `drive.ts:57` skips `:` lines; flowbench doesn't parse SSE; no attribution.

## ds-v1 27-228 (`1a61bced..688826d8`): VERDICT findings
- [MEDIUM] Ruling 27 reading rests on agent-added wording: "(Failure page)" in `docs/design/system.md:559` was added by the #227 fixer (`a4fa2d93`) with no PO ruling; before, the row read "Make it, Make the change, Try again". No ds-v1 spec names PlanPage's Try again either way (`app-launcher/spec.md:502` "handing work to Whim"). PlanPage's Try again (`PlanPage.tsx:608`) re-sends the clarify/rewrite request: work handed to Whim. Done: wire `haptic="handoff"` at `PlanPage.tsx:608` + shell test (one handoff per real press), revert §5:559 to the unqualified text; or the PO ratifies the narrowed wording.
- #228 OK: real LauncherRoot, `/v1/generate` 500 ends via `failure()` (`LauncherRoot.tsx:1902-1928`); `buildIt` calls `onMake` directly so Make it's haptic doesn't pollute; red-check matches; refused-Retry not covered (honest).
