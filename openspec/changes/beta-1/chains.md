# Context chains: beta-1

Seven chains by layer: three app-shell/runtime chains, one polish chain, two server chains, and one
release-tooling chain. Section 8 is attended acceptance and rollout, done by the orchestrator, not a chain.
No chain touches the gate's CONFIG_SET or `invariants/`: no new dependency (design D3), so nothing is
HUMAN-BOOTSTRAP. The owner runs chains one at a time (low-priority capacity), so the `after:` edges
mainly guard the files that are shared across chains. Suggested order: chain-5, chain-6 (server, the part
of the release that can ship first), then chain-1 to chain-4, then chain-7.

No contracts: no chain consumes an interface another chain defines. The shared-file orderings are
declared with `after:`.

## chain-1: app-legal-flow

- tasks: 1.1–1.5
- rationale: the age check, the significant-change call and the Settings entry all live in the legal
  flow (`age-check.ts`, `consent-flow.ts`, `LauncherRoot.tsx` legal handlers, `WhimAgeSignal`
  native module). They share one vocabulary (age signal, terms version, `nextLegalStep`).
- reads: specs/store-age-signals/spec.md (both requirements); specs/terms-acceptance/spec.md;
  design.md D1, D2, D6; research.md §Relevant files (age/legal lines), §Constraints (age reduction,
  single legal gate); openspec/changes/legal-surface-v2/specs/store-age-signals/spec.md and
  terms-acceptance/spec.md for the live requirement text; handoff: none
- writes-contract: none

## chain-2: app-keyboard-shell

- tasks: 2.1–2.3
- rationale: one wrapper and its adoption on every host input screen. Same RN keyboard vocabulary,
  same component files (ComposeStep, PlanStep, SheetModal, ReportSheet, settings inputs).
- reads: specs/app-launcher/spec.md §"Text input never hides the content or action it belongs to";
  design.md D3; research.md §Current behavior (#49/#50); handoff: none
- writes-contract: none
- after: chain-1 (both may touch `LauncherRoot.tsx`)

## chain-3: realm-runtime-and-sdk

- tasks: 3.1–3.5
- rationale: everything that crosses the host↔realm boundary: loader focus handling, the root error
  boundary and `render` frame, the theme payload's inset, and SDK `Screen`. It's all in
  `src/runtime/web/loader.js`, `useMiniAppHost.ts`, the theme sanitizer, `src/sdk/index.tsx`, and
  regenerated build artifacts, so one chain holds every `loader.js` edit.
- reads: specs/sandbox-rendering/spec.md (all three requirements); specs/app-launcher/spec.md
  §"The host tells the realm how much of the bottom the orb covers" and §"A post-paint render failure
  shows the failure screen"; design.md D3 (loader part), D4, D5; research.md §Constraints (trusted
  frames, realm reset, #11/#13); handoff: none
- writes-contract: none
- after: chain-2

## chain-4: app-diagnostics-and-polish

- tasks: 4.1–4.4
- rationale: small, independent app fixes in the same launcher layer (crash capture, orb styles,
  tiles/examples, copy). None of them is big enough to be its own chain.
- reads: specs/device-diagnostics/spec.md; specs/app-launcher/spec.md §"Orb and tiles render cleanly
  on both platforms" and §"Numbers in English copy use an English locale"; design.md D7, D14;
  research.md §Current behavior (#48/#52, #89, #101, #105); handoff: none
- writes-contract: none
- after: chain-3 (`Orb.tsx`), chain-2 (`copy.ts`)

## chain-5: server-admission-and-routing

- tasks: 5.1–5.3
- rationale: admission's slot controller and the config keys it adds, plus the one routing key.
  All of it is `server/src/admission/*`, `config.ts`, `openrouter.ts`, `routes/generate.ts` and
  `docs/deploy.md` rows, so one chain owns `config.ts`.
- reads: specs/server-admission-control/spec.md §"A generation waits briefly for a slot before it is
  refused"; specs/generation-pipeline/spec.md §"Provider quantization floor is operator-configurable";
  design.md D8, D12; research.md §Constraints (closed event union, idempotent release, model ids from
  env); openspec/changes/public-generation-server/specs/server-admission-control/spec.md for the live
  admission text; handoff: none
- writes-contract: none

## chain-6: server-generation-quality

- tasks: 6.1–6.4
- rationale: the generation machine and its stages: prompts, the engineer-turn retry, run-verdict
  logging, the summary rule. They share `machine.ts` and the stage/prompt vocabulary.
- reads: specs/generation-pipeline/spec.md §"Clarify and plan writing stay inside what a mini-app can
  do", §"An engineer turn is retried once…", §"An unverified or failed containment verdict is logged
  without content", §"A no-change summary requires unchanged source"; design.md D9, D10, D11, D13;
  research.md §Current behavior (#57, #58, #106), §Constraints (closed failure codes, summariser is
  side-effect free); handoff: none
- writes-contract: none
- after: chain-5 (both may touch `openrouter.ts` error classification)

## chain-7: release-upgrade-check

- tasks: 7.1–7.3
- rationale: release tooling only (Maestro flows, `scripts/release/upgrade-check.sh`,
  `docs/release/mobile.md`). It shares no files with the other chains.
- reads: specs/release-upgrade-check/spec.md; design.md D15; memories `maestro-sees-through-sandbox-iframe`
  and `android-emu-run-recipe` (via the chain block); handoff: none
- writes-contract: none
