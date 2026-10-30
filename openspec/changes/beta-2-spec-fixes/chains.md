# Context chains: beta-2-spec-fixes

Chain order is the file-overlap order: `LauncherRoot.tsx` and `docs/design/system.md` are touched by chains 2, 3 and 4, so they run in sequence (`after:`). Chains 1, 5 and 6 are independent of everything else. Chain 6 is HUMAN-BOOTSTRAP (a `package.json` edit, which is in the gate's CONFIG_SET); every other chain self-gates with no CONFIG_SET file.

## chain-1: server-stream-open-frame

- tasks: 1.1–1.3
- files: `server/src/sse.ts`, `server/test/server-core.suite.ts`, `server/test/e2e.run.mjs` / `server/test/*e2e*` only if an expectation about first bytes must change
- rationale: one server file and its suite; the first byte of a generation.
- reads: specs/generation-server/spec.md §"The generation stream writes a frame as it opens"; handoff: none
- writes-contract: none
- suggested model: sonnet (small, precise); effort medium

## chain-2: device-stream-liveness

- tasks: 2.1–2.5
- files: `src/host/launcher/prompt-flow.ts`, `src/host/launcher/LauncherRoot.tsx`, `src/host/launcher/build-lifecycle.ts`, `src/host/launcher/transport-shared.ts`, `src/host/launcher/generation-client.ts`, `src/host/launcher/making-progress.ts`, `src/host/launcher/home-live.ts`, `src/host/launcher/test/{run-signals,prompt-flow-screens,prompt-flow-wiring,xhr-transport,generation-client,build-lifecycle}.suite.ts*`, `src/host/launcher/test/fake-xhr.ts`, `docs/design/system.md`
- rationale: the progress clock, its keepalive plumbing, the transport tests and the design doc all state one rule.
- reads: specs/prompt-flow/spec.md §"A stall heartbeat visibly reports when the stream goes quiet", §"A slow step on a live connection never ends the attempt as a lost connection"; design.md D1, D2; handoff: none
- writes-contract: none
- suggested model: opus (stream semantics, an owner-visible rule); effort high

## chain-3: needs-update-routing

- tasks: 3.1–3.4
- files: `src/host/launcher/grid-composition.ts`, `src/host/launcher/build-lifecycle.ts` (only to move `stillNeedsUpdate`), `src/host/launcher/HomeScreen.tsx`, `src/host/launcher/LauncherRoot.tsx`, `src/host/launcher/test/grid-composition.suite.ts`, `src/host/launcher/test/prompt-flow-wiring.suite.ts` (or the launcher flow suite that drives the stream), `docs/design/system.md`
- rationale: the tile predicate, the mid-run landing and the doc row are one decision.
- reads: specs/prompt-flow/spec.md §"Messages the app can't use follow their fallback"; specs/generation-contract/spec.md §"Every wire message carries a forward-compatibility envelope…"; specs/app-launcher/spec.md §"A needs-update tile ends when Whim has caught up"; design.md D3; handoff: none
- writes-contract: none
- after: chain-2 (both edit `LauncherRoot.tsx` and `docs/design/system.md`)
- suggested model: opus (settlement routing in a very large file); effort high

## chain-4: whim-sheet-see-why-and-copy-label

- tasks: 4.1–4.5
- files: `src/host/launcher/WhimSheet.tsx`, `src/host/launcher/LauncherRoot.tsx`, `src/host/launcher/test/whim-sheet-ui.suite.tsx`, `src/host/launcher/test/home-grid-ui.suite.tsx`, `src/host/launcher/store-access.ts` and `src/host/launcher/app-index.ts` (only if the continuation path lacks `forkedFrom`), `docs/design/system.md`
- rationale: both are small launcher-UI requirements verified in the home-grid and Whim-sheet suites.
- reads: specs/app-launcher/spec.md §"The Whim sheet offers See why for a failed change", §"A copy and a rewind continuation both read Copy"; design.md D4, D5; handoff: none
- writes-contract: none
- after: chain-3 (`LauncherRoot.tsx`, `docs/design/system.md`)
- suggested model: sonnet (clear spec); effort medium

## chain-5: synthrun-modal-close

- tasks: 5.1–5.3
- files: `synthrun/sweep.ts`, `synthrun/test/sweep-reach.ts`
- rationale: one sweep function and its fixture.
- reads: specs/synthetic-run/spec.md §"The sweep acts only on an element that can receive the action"; design.md D6; handoff: none
- writes-contract: none
- suggested model: opus (a load flake with an unconfirmed second candidate cause); effort high

## chain-6: android-release-bootstrap (HUMAN-BOOTSTRAP)

- tasks: 6.1
- rationale: `package.json` is in the gate's CONFIG_SET, so no implementer may edit it; the one-line change is applied by a human (the orchestrator with the PO's go-ahead) and committed to the staging branch before chain-7.
- edits: `package.json` line 11 only, as in tasks.md 6.1
- not dispatchable

## chain-7: android-release-script

- tasks: 7.1–7.3
- files: new `scripts/android-release.mjs`, `scripts/release/lib/android-dev-script.ts` (new), `scripts/release/cli.ts`, `checks/test/release/android-dev-script.suite.ts` (new), `checks/test/release/index.ts` (registration), `CLAUDE.md`, `README.md`, `demo/README.md`, `docs/release/mobile.md`
- rationale: the wrapper script, its release check and the docs that name it.
- reads: specs/native-release-config/spec.md §"An offline build type serves the Android dev loop"; design.md D7; handoff: none
- writes-contract: none
- after: chain-6
- suggested model: sonnet (clear spec); effort medium
