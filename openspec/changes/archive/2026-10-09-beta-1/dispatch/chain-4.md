# chain-4 dispatch block: app-flow-screens (tasks 4.1–4.5)

Tasks 4.1–4.5 verbatim from tasks.md (the dispatch prompt quotes them).

Read (only these):
- `specs/prompt-flow/spec.md`: the whole file (4 ADDED, 2 MODIFIED requirements).
- `design.md` §D8 (device side only: what the user sees while waiting), §D9 (the limit screen), §D10 (restart),
  §D16 (layer 3 outcomes), §D18 (answer modes).
- `openspec/specs/prompt-flow/spec.md`: the live "A stall heartbeat…" and "Failure is shown honestly…"
  requirements.
- `openspec/specs/app-update-gate/spec.md`: the update screen.
- `handoff/wire-protocol.md` §Device, especially "Where callers receive it" and "Interim device behaviours
  (chain 4 replaces each)".

Decisions made for the implementer:
1. **Replace interim behaviours 1–5** from the contract. Keep 6: a skipped frame moves no liveness clock.
   - `update` → the update screen shows the `notice` as plain text when present, else its current copy.
   - `fail` → the failure screen shows the notice as plain text when present, else the generic copy.
   Plain text means rendered in a `Text`, never parsed, linked or formatted. Cap the display at 200 chars,
   matching the contract.
2. **No fallback installs or updates anything.** Mid-build, the pending record resolves as failed, whether the
   build is foreground or "Leave it running". Unary (clarify/rewrite): the flow ends on the failure/update screen
   with no generation started. Test both, plus a mid-build `update`.
3. **The line (4.1).** While the latest event is `queued`, the build screen shows the waiting state with Cancel
   and "Leave it running". Copy: position 1 → "You're next in line."; position N ≥ 2 → "You're in line, N−1
   ahead." (say "1 build ahead" / "2 builds ahead" if that reads better next to the neighbouring copy in
   `copy.ts`). The first `stage` event switches to normal progress. The stall heartbeat counts `queued` and
   `restart`. A backgrounded ("Leave it running") build that is still in line resolves exactly like any other
   background build.
4. **Restart (4.2).** On `restart`, the current turn's activity signals (characters written and whatever else
   the run-signal model counts from tokens) restart from zero. The build continues with no failure state and no
   extra history entry. Test against a stream fixture that writes, restarts, then delivers.
5. **Limit (4.3).** A screen with the `reason`, "Build <alternative> instead" and "Change my idea".
   - "Build … instead" makes the alternative the prompt and runs clarify again on it (a new clarify call, not the
     old questions).
   - "Change my idea" returns to Compose with the original prompt, editable.
   - Nothing starts a generation on its own.
   - Render `reason`/`alternative` as plain text.
6. **Answer modes (4.5).**
   - `select: 'one'`: radio-like pills, so a second tap moves the pick (this is where "at most one choice" is
     enforced).
   - `select: 'many'`: toggles.
   - `other: true`: an "Other" text field. Trim it; empty means absent; cap at 200 chars (`maxLength`).
   - "Decide for me" on every question, device-provided: it clears picks and typed text, and picking or typing
     afterwards clears it again.
   - Threaded answers: `choices`, `other`, and `decide: true` alone. An untouched question is omitted.
   Keep the headline count and the skip line as specified. Don't handle the keyboard here: chain-6 wraps the
   "Other" field. Name the field's component and file in the report so chain-6's block can list it.
7. **Node suites can't import RN components.** Put pure logic (answer state reducer, queued copy, restart reset)
   in non-RN siblings and test those. Use the existing `.suite.tsx` UI harness only where it already covers the
   screen.
8. Files shared with later chains: `LauncherRoot.tsx` (chain-5, chain-6), the step screens (chain-6). Keep edits
   there to what these tasks need.

Gate: `./scripts/gate.sh` to FAST GATE PASSED. Typecheck every launcher test file you add or edit with a scratch
tsconfig (the gate doesn't, #79), and say how. Red-check the answer reducer against a weaker variant (e.g.
"Decide for me" that doesn't clear picks) and the fallback wiring against one (e.g. `update` routed to the
failure screen), naming the failing tests. End the report with HARNESS FEEDBACK (template in
docs/harness-feedback/README.md).

Added after chain-3 (orchestrator):
9. **Stub markers for the orchestrator's device acceptance (10.4).** The stub pipeline (dev server with no model
   key; production refuses to boot without one) needs markers so a simulator/emulator can reach the new screens
   without a model:
   - a prompt containing `[[limit]]` → the stub clarify returns `limit{reason, alternative}` with no questions;
   - `[[future:skip]]`, `[[future:fail]]`, `[[future:update]]` → the stub generate stream emits an unknown event
     type carrying that `compat` fallback (with a notice for fail/update), then continues or ends the way the
     stub would.
   Add tests that the markers do nothing on the model-backed path. The stub already has markers; find how they
   are parsed and follow the same idiom.
