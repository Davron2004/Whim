# Findings: bundle-delivery failure surfacing + stub-pipeline runnability (2026-08-21)

Source: on-device acceptance run of prompt-flow-ux task 7.2 (emulator, release APK, stub server)
plus a read-only root-cause investigation. Evidence chain traced end-to-end; file:line cites
verified against the current tree at investigation time.

## F1 — Bundle-execution failure is invisible to the user (product gap, HIGH)

When a delivered bundle executes but yields no `__WHIM_APP_MODULE__`, the runtime posts an
`error` frame (`src/runtime/web/loader.js:103-106`), the host stores it in `state.lastError`
(`src/host/launcher/useMiniAppHost.ts:240-242`) — and **nothing in the product shell consumes
it**. `src/host/launcher/MiniAppView.tsx:63-74` renders recovery only for the pre-delivery
`launchFailed` state; the `ScreenBoundary` React error boundary (`LauncherRoot.tsx:908`)
structurally cannot fire for a postMessage. The user sees a white rectangle with no message,
no retry.

Fix: in `MiniAppView.tsx`, add a branch on `host.state.lastError` mirroring the existing
`launchFailed` recovery block — honest copy, a Retry that remounts the WebView by bumping a
local key so bind + delivery re-run into a fresh realm (decision: realm reset = recreate the
iframe, never re-inject), and a Home action. Test: drive a bundle that executes but exports
nothing; assert the recovery UI renders and Retry re-delivers.

## F2 — No paint watchdog: a silently lost delivery is also a blank screen (product gap, HIGH)

A delivery frame posted at a freshly created srcdoc iframe's still-`about:blank`
`contentWindow` is dropped (`src/runtime/web/assemble.mjs:130,161,169`), producing a blank
screen with **no error frame at all** — F1's surface alone can never catch it. Nothing asserts
that an accepted `delivery` frame (`loader.js:216`) is followed by a `paint` frame
(`loader.js:122`).

Fix: in `useMiniAppHost.ts`, start a watchdog when a delivery is accepted; if no `paint`
arrives within a few seconds, set `lastError` (feeding F1's surface). Test: suppress the paint
frame and assert the watchdog fires; normal delivery must not trip it.

## F3 — Wire boundary accepts any string as a bundle (contract gap, MEDIUM)

`src/host/launcher/generation-client.ts:116` validates only `typeof value.bundle === 'string'`;
`store-access.ts:158-164` rejects only `null`, so `''` and garbage flow through and become a
white screen days later. Fix: tighten the wire predicate — non-empty and containing the
`__WHIM_APP_MODULE__` binding (a contract assertion, not a re-parse) — so a shape regression
fails honestly at delivery as a `failure` event surface. Test: a wire record with an empty /
binding-less bundle is rejected at delivery, not installed.

## F4 — The stub pipeline delivers an unrunnable bundle (dev-tool defect, MEDIUM)

`server/src/pipeline.ts:16-23` — `STUB_APP_RECORD.bundle` is `'(()=>{ /* stub bundle */ })();'`,
an IIFE that defines nothing, so **every stub-generated app blank-screens by construction**
(this is what produced today's on-device failures; the real pipeline is fenced against it by
`server/src/generation/stages/run.ts:29-36` + `machine.ts:748-752`). A stub whose output cannot
run is not a stub of the pipeline. Fix: make the stub emit a real runnable bundle — bake one of
the already-built compiled fixture bundles (`build/build.mjs:340` emits them) or build
`STUB_APP_RECORD.source` once through the H1b builder (`synthrun/builder.ts:40-49`). Test:
stub-mode `/v1/generate`'s delivered bundle, run through the loader wrap, yields an AppSpec.

## F5 — The `[[fail]]` failure hook is unreachable from the UI flow (test-hook defect, LOW)

The stub's `[[fail]]` hook is checked against the prompt the generate stage receives, but the
flow's rewrite step (which runs the real model when a key is present, even under
`WHIM_PIPELINE=stub`) paraphrases the user's compose text, stripping the literal marker — so
the documented failure path cannot be exercised end-to-end from the device (observed: a
`[[fail]]` prompt built "successfully"). Fix: in stub mode, detect the marker on the RAW
incoming request text (compose/rewrite input) server-side before any model call, so
`[[fail]]` deterministically produces the failure stream regardless of rewrite. Test: a
generate request whose raw prompt contains `[[fail]]` yields the failure terminal event even
when a rewrite precedes it.

## Explicitly NOT filed here

- 125s rewrite with no elapsed-time/slow-call feedback: already covered by the un-dispatched
  `flow-wait-hygiene` change (silent-wait defect class) — do not duplicate.
- Tile label "stub-app" vs in-app title "Tip Splitter": stub-record naming artifact; resolved
  by F4 (a real fixture record carries a coherent name).
