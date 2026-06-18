# Context chains: harness-server-skeleton

<!-- Retrofit (this change predated chains). Tasks from tasks.md grouped per the template rules:
     3–7 tasks/chain, grouped by shared files/layer, sequential A→B→C→D. See research.md for the
     task→file map and the proposer notes (P1–P6) that drive these boundaries. -->

## chain-A: foundation-workspaces (MAIN-THREAD-AUTHORED — not implementer-dispatchable)
- tasks: 2.1, 2.2, 2.3
- rationale: stands up the npm workspaces (`contract/`, `server/`) and the `guard:metro` script every later chain assumes; one `npm install` cycle. All other tasks require these dirs + package names to exist.
- reads: specs/generation-contract/spec.md §"Shared wire-contract package", §"Metro-safe device consumption"; specs/generation-server/spec.md §"Server workspace and runtime"; handoff: none
- writes-contract: handoff/workspace.md
- note: **NOT IMPLEMENTER-DISPATCHABLE (research.md P1).** Every file this chain writes — root `package.json` `workspaces`+scripts, `contract/package.json`, `contract/tsconfig.json`, `server/package.json`, `server/tsconfig.json` — is hook-protected by `protect-harness.sh` (`*/package.json`, `*/tsconfig*.json`). The hook hard-blocks **subagents** (exit 2, class-B deviation) but routes the **main thread** to a CLI approval prompt, so the main thread (dispatcher / `opsx:apply`) authors these files directly — the user reviews and approves each protected-config edit — then runs `npm install` before B onward. Implementer-allowed slivers (`.gitignore`, `server/guard-metro.mjs`) ride the same step. 2.3 is read-only gate verification.

## chain-B: contract-package (1.1, 3.1, 3.2)
- tasks: 1.1, 3.1, 3.2
- rationale: the `@whim/contract` zod surface + its test skeleton; 1.1 (English spec) is first per §16.5. All three share `contract/src/index.ts` and the new `server/test/{run.mjs,acceptance.ts}` test harness.
- reads: specs/generation-contract/spec.md §all (6 requirements); test-spec at server/test/SPEC.md (task 1.1 output); handoff: handoff/workspace.md
- writes-contract: handoff/contract.md
- note: replicate the esbuild-bundle-then-run idiom from `src/host/bridge/test/run.mjs` verbatim for `server/test/run.mjs`. Verify the `WireAppRecord` vs #5 stored-record seam (research.md P3) before freezing the schema. For `manifest`/`schema` sub-schemas, P4 applies (`z.record(z.unknown())` acceptable). The contract package must carry NO React/RN runtime dep (budget scenario).

## chain-C: server-core (4.1, 4.2, 4.3, 5.1, 5.2, 5.3)
- tasks: 4.1, 4.2, 4.3, 5.1, 5.2, 5.3
- rationale: one Hono app instance + one SSE framing helper shared across the factory, dev entry, and both `/v1/*` routes; grouping keeps the SSE writer an in-chain detail rather than a fragile handoff. Largest chain (6 tasks) but tightly coupled around `server/src/app.ts`.
- reads: specs/generation-server/spec.md §"Device-identity middleware", §"SSE generation endpoint over stub pipeline", §"Rewrite endpoint"; handoff: handoff/workspace.md, handoff/contract.md
- writes-contract: handoff/server-core.md
- note: must emit exactly one terminal event (`result`|`failure`) then close the stream; SSE `id:` strictly increasing; `[[fail]]` magic token routes to the failure path. The `x-whim-device` `400` body shape this chain defines goes into handoff/server-core.md (consumed by D's `/v1/usage`).

## chain-D: metering-openrouter-ci (6.1, 6.2, 7.1, 8.1, 8.3)
- tasks: 6.1, 6.2, 7.1, 8.1, 8.3
- rationale: usage metering (`usage-store.ts` + `/v1/usage` + the credit call in `generate.ts`), the unmounted OpenRouter wrapper, and the CI gate closure + ledger — all depend on Chain B's `Usage` type and Chain C's route/middleware seams, and none feed back into C. 8.1 (CI) is the gate closure so it lands last.
- reads: specs/generation-server/spec.md §"Token metering", §"Usage readback", §"OpenRouter client wrapper", §"Blocking server suite in CI"; handoff: handoff/contract.md, handoff/server-core.md
- writes-contract: none
- note: 8.1 edits `.github/workflows/invariants.yml` — NOT hook-blocked, dispatchable (research.md P2); add `server:test` + `guard:metro` as blocking steps, leave existing `build`/`invariants` untouched. `guard:metro` CI feasibility is a known risk (P6). OpenRouter wrapper is built but mounted by no route and has no live-network test (injectable `fetch` + fake-transport fixtures only). 8.2 (LAN acceptance) is human-run and not part of this dispatchable chain.
