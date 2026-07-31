# Context chains: prompt-flow-ux

## chain-1: generation-client

- tasks: 1.1, 2.1–2.3
- rationale: one layer (device identity + SSE fetch client), files `device-id.ts`/`generation-client.ts` + their suite, no UI/store code touched
- reads: specs/prompt-flow/spec.md (Device identity; Generation progress; Failure requirements); design.md D2; research.md (§Constraints — wire types, no-new-dependency UUID note)
- writes-contract: handoff/generation-client.md (`getDeviceId`, `rewritePrompt`, `generateApp`, `GenerationClientError`, `ClientOptions` — exact signatures and error `kind`s)

## chain-2: store-access-prompt-flow

- tasks: 1.2, 3.1–3.3
- rationale: one layer (version-store access seam), files `store-access.ts`/`history-logic.ts` + their suite, disjoint from chain-1's files
- reads: specs/app-launcher/spec.md (ADDED: Version-store access for the prompt flow's delivery stays behind StoreAccess); design.md D6/D7
- writes-contract: handoff/store-access-prompt-flow.md (`update`, `activeSource`, extended `InstallSpec.schemaJson`, `isAtTip` — exact signatures and lineage/tip semantics)

## chain-3: prompt-flow-screens

- tasks: 4.1–4.3, 5.1–5.3
- rationale: the four new presentational screens plus their `copy.ts` additions form one unit — grouping them prevents two parallel chains from both editing `copy.ts` (a real collision risk otherwise, since chain-1/chain-2 don't touch UI at all but a split screens/progress chain pair would both touch `copy.ts` in parallel)
- reads: specs/prompt-flow/spec.md (all requirements); specs/app-launcher/spec.md (ADDED: create affordance and re-prompt action; server address); design.md D1/D3/D4
- writes-contract: handoff/prompt-flow-screens.md (`PromptScreen`/`RewritePreviewScreen`/`GeneratingScreen`/`FailureScreen` prop interfaces, and the full list of new `COPY` keys added)

## chain-4: launcher-root-wiring

- tasks: 6.1–6.6
- rationale: the integration layer — `LauncherRoot.tsx`, `HomeScreen.tsx`, `SettingsScreen.tsx` — consumes all three upstream contracts to wire the `Screen` union, entry points, orchestration, and settings field
- reads: specs/prompt-flow/spec.md (all requirements, esp. Delivery/Envelope/Cancellation); specs/app-launcher/spec.md (all ADDED requirements); design.md D1/D3/D5/D6; handoff: handoff/generation-client.md, handoff/store-access-prompt-flow.md, handoff/prompt-flow-screens.md
- writes-contract: none
- after: chain-1, chain-2, chain-3 (consumes all three handoffs; also avoids a `copy.ts` collision with chain-3, which lands first)

## chain-5: docs-decision

- tasks: 7.1
- rationale: docs-only append to `docs/decisions.md` + `docs/v1-roadmap.md`, written after the as-built surface exists
- reads: design.md (Decisions); handoff: handoff/generation-client.md, handoff/store-access-prompt-flow.md
- writes-contract: none
- after: chain-4

Task 7.2 (on-device acceptance) is attended and human-run — not dispatched to an implementer; it closes the change after chain-5 merges, like version-history-ux's task 5.2 and harness-server-skeleton's task 8.2.
