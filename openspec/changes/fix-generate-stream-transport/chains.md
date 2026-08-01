# Context chains: fix-generate-stream-transport

<!--
  Tasks from tasks.md grouped into context chains for the dispatcher.
  chain-1 → chain-2 → chain-3 → chain-4 is a strict serial spine (they share
  generation-client.ts and the new transport module). chain-5 and chain-6 are
  file-disjoint from the spine and from each other, so the dispatcher runs all
  three groups in parallel. chain-7 is attended-only.
-->

## chain-1: launcher-transport-prereqs

- tasks: 1.1, 1.2, 1.5
- rationale: Three small, self-contained edits to `generation-client.ts` (plus a read of `version-store/polyfills.ts`) that every later chain depends on: the `TextEncoder` availability answer, one shared header-construction helper, and the corrected doc comment. Doing them first means the transport chain never has to guess at these. This chain also exports the existing private `httpErrorFrom` so the transport module can reuse the exact non-2xx classification rather than reimplementing it — a second implementation is how the taxonomy drifts.
- reads: `specs/generation-stream-transport/spec.md` §"The device consumes the generation stream incrementally" (for the corrected runtime facts the doc comment must state); `design.md` §D3 (TextEncoder), §D2 (header-helper rationale). handoff: none
- writes-contract: `handoff/transport-seam.md` — verbatim `ResponseBodyReader` and `ClientOptions` declarations, the header-helper signature, the exported `httpErrorFrom` signature, and the resolved answer to whether `TextEncoder` is guaranteed on the launcher path.

## chain-2: launcher-xhr-transport

- tasks: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6
- rationale: The net-new XHR transport module, start to finish — open, incremental read, text→bytes encode, error classification, abort. One new file plus its imports; a single implementer holding the whole XHR lifecycle in context is much likelier to get the readyState/abort edges right than two implementers splitting it.
- reads: `specs/generation-stream-transport/spec.md` §"The device consumes the generation stream incrementally", §"The streaming transport preserves the client error taxonomy", §"Cancellation aborts the request and ends iteration silently", §"The SSE framing and event validation are transport-independent"; `design.md` §D3 (why slice accumulated `responseText`, not per-chunk deltas). handoff: `handoff/transport-seam.md`
- writes-contract: `handoff/xhr-transport.md` — the module's exported function signature, its return type, which `GenerationClientErrorKind` each failure maps to, and how abort surfaces.
- after: chain-1

## chain-3: launcher-transport-seam

- tasks: 1.3, 1.4, 2.7
- rationale: Wires the transport into `generation-client.ts` — the `ClientOptions` hook, the up-front capability determination, and the confirmation that nothing below the seam changed. Separated from chain-2 because it is the one place the *selection policy* lives, and it must be reviewable on its own: design D1 rejects the post-hoc-fallback shape explicitly, and that rejection is easiest to enforce when the wiring is a small isolated diff.
- reads: `specs/generation-stream-transport/spec.md` §"The streaming transport is selected before the request is issued", §"The on-device streaming path is exercisable under test"; `design.md` §D1 (all three rejected alternatives), §D2. handoff: `handoff/transport-seam.md`, `handoff/xhr-transport.md`
- writes-contract: none
- after: chain-2

## chain-4: launcher-transport-tests

- tasks: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7
- rationale: All acceptance coverage in one chain, under `src/host/launcher/test/`. Grouped together because the fake `XMLHttpRequest` (3.1) is shared infrastructure every other test case builds on, and because 3.5's negative control has to be red-checked against the real implementation — which only exists once chains 2 and 3 have landed.
- reads: `specs/generation-stream-transport/spec.md` — all six requirements, whose scenarios are the test cases; `design.md` §D4 (why the negative control is mandatory), §"Risks" (the fake-XHR trap). handoff: `handoff/transport-seam.md`, `handoff/xhr-transport.md`
- writes-contract: none
- after: chain-3
- note: if registering the new suite requires a `package.json` script entry, that edit is **Class 2** and must be human-applied — the implementer must stop and report rather than attempt it. Prefer wiring the suite into the existing `test/run.mjs` discovery, which is not protected.

## chain-5: server-dev-logging

- tasks: 4.1
- rationale: One task, entirely under `server/src/`, sharing no file with any other chain. Kept separate rather than folded into a device chain precisely so it can be dropped without touching the fix if it proves contentious. Undersized against the 3–7 guideline by design — merging it into a launcher chain would mean one implementer holding two unrelated layers.
- reads: `design.md` §D5. handoff: none
- writes-contract: none

## chain-6: docs-decision-58

- tasks: 5.1, 5.2, 5.3
- rationale: `docs/decisions.md`, `docs/capabilities.md`, and `contract/src/index.ts`'s doc comment — documentation only, no file shared with the spine. Runs in parallel because `design.md` already fixes every fact it records; it is transcription, not discovery.
- reads: `design.md` §D1 (the rejected alternatives decision #58 must record), §Context (the two verified runtime facts); `proposal.md` §Why. handoff: none
- writes-contract: none
- note: decision numbering is append-only and the current tail is #57 (`eval-harness`) per `research.md`. If another change has appended in the meantime, take the next free number rather than forcing #58.

## chain-7: on-device-verification

- tasks: 6.1, 6.2, 6.3, 6.4, 6.5
- rationale: Real-device acceptance on the Android emulator. **ATTENDED-ONLY — not dispatchable to an implementer subagent.** It needs an `npm run android:release` build from the main tree (Metro cannot resolve `node_modules` from a worktree), a running emulator, and a running dev generation server. No file edits; the deliverable is a verdict.
- reads: `specs/generation-stream-transport/spec.md` §"The device consumes the generation stream incrementally", §"Cancellation aborts the request and ends iteration silently", §"The SSE framing and event validation are transport-independent"; `design.md` §Risks (items 1 and 2 are exactly what this chain settles), §"Open Questions" item 3. handoff: none
- writes-contract: none
- after: chain-4
