# Context chains: server-connectivity

## chain-1: server-healthz-identity

- tasks: 1.1–1.2
- rationale: one-file server-side change plus its own test suite — no client vocabulary, no shared files with any other chain.
- reads: specs/generation-server/spec.md §"The health check identifies the service"; design.md decision 1
- writes-contract: none (the JSON body shape is fully specified in the spec itself: `{ ok: true, service: 'whim-server' }`; no client chain needs anything beyond that literal)

## chain-2: client-probe-helper

- tasks: 2.1–2.2
- rationale: one new, standalone, RN-free module (`server-probe.ts`) — pure request/classify logic, Node-suite testable in isolation, consumed by both the retry-loop chain and the Settings chain.
- reads: specs/server-connectivity/spec.md §"A shared probe classifies a server address as verified, unverified, or unreachable"; design.md decisions 1–2
- writes-contract: handoff/server-probe.md (`probeServer(baseUrl, opts?) → Promise<'verified'|'unverified'|'unreachable'>` signature verbatim, timeout default, classification rules)

## chain-3: connectivity-state-retry-loop

- tasks: 3.1–3.4
- rationale: all four tasks edit the same `LauncherRoot.tsx` shell-state machine (connectivity state, the startup/retry effect, and the `markOnline()` hook into the existing `clarifyPrompt`/`generateApp` call sites) — splitting the state machine across chains would smear one piece of logic across contexts.
- reads: specs/server-connectivity/spec.md §"A configured server is probed at startup...", §"A real generation or rewrite call succeeding...", §"The retry loop runs only while the app is foregrounded", §"Session connectivity state drives an offline UX...", §"No server address configured is distinct from an unreachable configured address"; design.md decisions 4–6; handoff: handoff/server-probe.md
- writes-contract: handoff/connectivity-state.md (the `connectivity` state type, `markOnline()` signature, and how a consumer screen reads the current state off `LauncherRoot`)
- after: chain-2

## chain-4: settings-save-time-verification

- tasks: 4.1–4.4
- rationale: all `SettingsScreen.tsx`-scoped UI work (debounced probe, inline result rendering, its own copy additions) — a self-contained screen change consuming only the shared probe helper.
- reads: specs/server-connectivity/spec.md §"Saving a server address in Settings immediately probes it and shows the result inline"; design.md decision 3; handoff: handoff/server-probe.md
- writes-contract: none
- after: chain-2

## chain-5: offline-ux-surfaces

- tasks: 5.1–5.4
- rationale: the home-screen indicator and the prompt-flow entry notice both read the same `connectivity` state and land their copy in the same `copy.ts` file chain-4 also edits — grouped together and sequenced after chain-4 so the two chains' `copy.ts` edits don't land in parallel worktrees.
- reads: specs/app-launcher/spec.md §"The home screen shows a quiet connectivity indicator"; specs/prompt-flow/spec.md §"The compose entry point shows a server-unreachable notice without blocking generation"; design.md decision 7; handoff: handoff/connectivity-state.md
- writes-contract: none
- after: chain-3, chain-4
