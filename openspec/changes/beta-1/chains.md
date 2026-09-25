# Context chains: beta-1

Nine chains. chain-1 (the wire protocol) goes first: it writes the one contract that three later
chains consume. After that: the two server chains, the prompt-flow screens, then the app shell,
runtime and polish chains, then release tooling. Section 10 is attended acceptance and rollout, done
by the orchestrator, not a chain.

No chain touches the gate's CONFIG_SET or `invariants/`, since there's no new dependency (design D3),
so nothing is HUMAN-BOOTSTRAP. The owner runs chains one at a time (low-priority capacity), so the
`after:` edges mainly guard files that more than one chain touches.

## chain-1: wire-protocol

- tasks: 1.1–1.4
- rationale: every shape and decoding rule the new messages depend on: contract schemas, the
  server's request edge and emitter helper, and the device's two-phase decoder. It's one vocabulary
  (level, `compat`, fallback), and it has to be defined once before any producer or consumer.
- reads: specs/generation-contract/spec.md (all ADDED and MODIFIED requirements); design.md D16, D8
  (the `queued` shape), D9 (the `limit` shape), D10 (`restart`); research.md §Constraints (closed union
  today, `generation-client.ts:149-152,540-543`); openspec/specs/generation-contract/spec.md for the
  live text; handoff: none
- writes-contract: handoff/wire-protocol.md (the exported schemas and `PROTOCOL_LEVEL`, the emitter
  helper's signature and the level registry, the device decoder's fallback-outcome type and where
  callers receive it)

## chain-2: server-admission-line

- tasks: 2.1–2.3
- rationale: the slot controller, the route that opens the stream and runs the line, and the config
  keys. All of it is `server/src/admission/*`, `routes/generate.ts`, `config.ts`, `openrouter.ts`'s
  provider object, and the `docs/deploy.md` rows.
- reads: specs/server-admission-control/spec.md §"A generation that finds every slot busy waits in line
  on its stream"; specs/generation-pipeline/spec.md §"Provider quantization floor is
  operator-configurable"; design.md D8, D12; research.md §Constraints (idempotent release, model ids
  from env); openspec/changes/public-generation-server/specs/server-admission-control/spec.md for the
  live admission text; handoff: handoff/wire-protocol.md
- writes-contract: none

## chain-3: server-generation-quality

- tasks: 3.1–3.4
- rationale: the generation machine and its stages: prompts plus the clarify `limit`, the retry with
  `restart`, verdict logging, the no-change rule. Shared files: `machine.ts`, `prompts/index.ts`,
  `routes/clarify.ts`, `stages/run.ts`, `summarise.ts`.
- reads: specs/generation-pipeline/spec.md (the limits, retry, verdict and no-change requirements);
  design.md D9, D10, D11, D13; research.md §Current behavior (#57, #58, #106), §Constraints (closed
  failure codes, the summariser is side-effect free); handoff: handoff/wire-protocol.md
- writes-contract: none
- after: chain-2 (both may touch `openrouter.ts` and the generate route)

## chain-4: app-flow-screens

- tasks: 4.1–4.4
- rationale: the device screens that render the new messages: in-line build progress, restart
  handling, the clarify `limit` screen, and fallback outcomes. They share the prompt-flow state
  machine, BuildStep/ClarifyStep and the run-signal model.
- reads: specs/prompt-flow/spec.md (all ADDED and MODIFIED requirements); design.md D8 (device side),
  D9 (the limit screen), D10 (restart), D16 (layer 3 outcomes); openspec/specs/prompt-flow/spec.md
  §"A stall heartbeat…" and §"Failure is shown honestly…" for the live text;
  openspec/specs/app-update-gate/spec.md for the update screen; handoff: handoff/wire-protocol.md
- writes-contract: none

## chain-5: app-legal-flow

- tasks: 5.1–5.5
- rationale: the age check, the significant-change call and the Settings entry all live in the legal
  flow (`age-check.ts`, `consent-flow.ts`, the `LauncherRoot.tsx` legal handlers, the `WhimAgeSignal`
  native module).
- reads: specs/store-age-signals/spec.md; specs/terms-acceptance/spec.md; design.md D1, D2, D6;
  research.md §Relevant files (age/legal), §Constraints (age reduction, single legal gate);
  openspec/changes/legal-surface-v2/specs/{store-age-signals,terms-acceptance}/spec.md for the live
  text; handoff: none
- writes-contract: none
- after: chain-4 (both may touch `LauncherRoot.tsx`)

## chain-6: app-keyboard-shell

- tasks: 6.1–6.3
- rationale: one wrapper and its adoption on every host input screen. Same RN keyboard vocabulary and
  the same component files.
- reads: specs/app-launcher/spec.md §"Text input never hides the content or action it belongs to";
  design.md D3; research.md §Current behavior (#49/#50); handoff: none
- writes-contract: none
- after: chain-5 (shared `LauncherRoot.tsx`), chain-4 (shared step screens)

## chain-7: realm-runtime-and-sdk

- tasks: 7.1–7.5
- rationale: everything that crosses the host↔realm boundary (loader focus handling, the root error
  boundary and `render` frame, the theme inset, SDK `Screen`), so one chain holds every `loader.js`
  edit and the regenerated artifacts.
- reads: specs/sandbox-rendering/spec.md; specs/app-launcher/spec.md §"The host tells the realm how
  much of the bottom the orb covers" and §"A post-paint render failure shows the failure screen";
  design.md D3 (the loader part), D4, D5; research.md §Constraints (trusted frames, realm reset,
  #11/#13); handoff: none
- writes-contract: none
- after: chain-6

## chain-8: app-diagnostics-and-polish

- tasks: 8.1–8.4
- rationale: small, independent app fixes in the launcher layer (crash capture, orb styles,
  tiles/examples, copy).
- reads: specs/device-diagnostics/spec.md; specs/app-launcher/spec.md §"Orb and tiles render cleanly
  on both platforms" and §"Numbers in English copy use an English locale"; design.md D7, D14;
  research.md §Current behavior (#48/#52, #89, #101, #105); handoff: none
- writes-contract: none
- after: chain-7 (`Orb.tsx`), chain-6 (`copy.ts`)

## chain-9: release-upgrade-check

- tasks: 9.1–9.3
- rationale: release tooling only (Maestro flows, `scripts/release/upgrade-check.sh`,
  `docs/release/mobile.md`). It shares no files with the other chains.
- reads: specs/release-upgrade-check/spec.md; design.md D15; the memories
  `maestro-sees-through-sandbox-iframe` and `android-emu-run-recipe` (via the chain block); handoff: none
- writes-contract: none
