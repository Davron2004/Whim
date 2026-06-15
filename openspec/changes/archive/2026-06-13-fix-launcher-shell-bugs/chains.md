# Context chains: fix-launcher-shell-bugs

## chain-1: host-delivery (B1, CRITICAL)
- tasks: 1.1–1.4
- rationale: all touch the host delivery-timing path (`MiniAppView.tsx` call site + `useMiniAppHost.ts`/`deliver.ts` ordering); isolated to host TypeScript, no `npm run build` needed
- reads: specs/app-launcher/spec.md §"The launched mini-app matches the selected card"; handoff: none
- writes-contract: none
- note: the gate does NOT run `launcher:test`/`launcher:deliver-verify` — this chain MUST run them itself (task 1.4). Touches `MiniAppView.tsx`, which chain-3 also edits (insets); chains are sequential so chain-3 reads chain-1's result.

## chain-2: generated-output (B2, B3, B4, B5)
- tasks: 2.1–2.5
- rationale: every task edits a build input (`fixtures/`, `build/build.mjs`, `src/sdk/`) and shares one `npm run build` + invariants re-check; batched so the regenerate/verify cycle runs once
- reads: specs/sandbox-rendering/spec.md §"Number inputs render without stray native focus artifacts"; proposal §"What Changes" B2/B3/B4; handoff: none
- writes-contract: none
- note: must NOT touch `src/runtime/web/*` or the locked CSP; `npm run invariants` must stay green after rebuild.

## chain-3: launcher-ui (B6, B7, B8, B9)
- tasks: 3.1–3.6
- rationale: pure React-Native UI layer (`HomeScreen.tsx`, `copy.ts`, `App.tsx`, `MiniAppView.tsx` shell); no build step; consumes nothing from earlier chains
- reads: specs/app-launcher/spec.md §"Card touch targets…", §"honest layout…", §"no unshipped-feature copy", §"status-bar inset"; handoff: none
- writes-contract: none
- note: edits `MiniAppView.tsx` for insets (B9) after chain-1's `onLoadEnd` change to the same file — sequential, so no conflict.
