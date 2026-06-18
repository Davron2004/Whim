# Research digest: harness-server-skeleton

*Retrofit digest (this change predates the harness scaffolding). Researcher-crawled; proposer
notes appended at the end. Cited by chains.md + handoff/*.md.*

## 1. Goal and scope

Change #8 erects the server-side scaffold that all subsequent harness-lane changes (#9/#10/#11)
mount into, while freezing the wire contract that Lane B change #7 (prompt-flow-ux) must build
against. It delivers two brand-new capabilities: `generation-contract` (the shared zod schema
package `@whim/contract`) and `generation-server` (the Hono HTTP service `@whim/server` with a
stub pipeline, identity middleware, token metering, and an unmounted OpenRouter wrapper). No
existing `src/**`, `build/`, `invariants/`, or `android/` files change. Neither `contract/` nor
`server/` exists on disk today — both are created wholesale.

## 2. Task inventory with file/layer tags

| # | Heading | Primary file(s) / layer | Hook-blocked? |
|---|---|---|---|
| 1.1 | English test spec | `server/test/SPEC.md` (prose) | no |
| 2.1 | Workspaces scaffold | root `package.json` (`workspaces`); `contract/package.json`, `contract/tsconfig.json`, `server/package.json`, `server/tsconfig.json`; `.gitignore` | **YES** (all pkg/tsconfig) |
| 2.2 | Metro guard script | root `package.json` (`guard:metro` script); `server/guard-metro.mjs` | **partly** (root pkg) |
| 2.3 | Existing gate verification | read-only verification, no writes | n/a |
| 3.1 | Contract schemas | `contract/src/index.ts` (zod + `z.infer` exports) | no |
| 3.2 | Contract tests | `server/test/run.mjs` (new), `server/test/acceptance.ts` | no |
| 4.1 | Hono app factory + middleware | `server/src/app.ts`, `server/test/acceptance.ts` | no |
| 4.2 | Dev server entry | `server/dev.mjs` | no |
| 4.3 | SSE writer + test reader | `server/src/sse.ts`, `server/test/acceptance.ts` | no |
| 5.1 | Pipeline interface + stub | `server/src/pipeline.ts`, `server/test/acceptance.ts` | no |
| 5.2 | `POST /v1/generate` | `server/src/routes/generate.ts`, `server/test/acceptance.ts` | no |
| 5.3 | `POST /v1/rewrite` | `server/src/routes/rewrite.ts`, `server/test/acceptance.ts` | no |
| 6.1 | UsageStore + SQLite impl | `server/src/usage-store.ts`, `server/test/acceptance.ts` | no |
| 6.2 | Metering wiring + `/v1/usage` | `server/src/routes/usage.ts`, `server/src/routes/generate.ts` | no |
| 7.1 | OpenRouter wrapper | `server/src/openrouter.ts`, `server/test/fixtures/` | no |
| 8.1 | CI gates | `.github/workflows/invariants.yml` (add `server:test` + `guard:metro`) | no (not in hook set) |
| 8.2 | LAN acceptance | manual verification, no committed file | n/a (human) |
| 8.3 | Ledger + DEVLOG | `docs/v1-roadmap.md`, `DEVLOG.md` | no |

## 3. Chain seams (proposer's final boundaries — see chains.md)

Four sequential clusters A→B→C→D. Chain A is the workspace bootstrap and is **human-edited**
(its package.json/tsconfig writes are hook-blocked — see Proposer notes). B/C/D are
implementer-dispatchable.

- **A — Foundation** (2.1, 2.2, 2.3): workspace layout + Metro guard + gate verification.
- **B — Contract** (1.1, 3.1, 3.2): English spec, `@whim/contract` schemas, test skeleton.
- **C — Server core** (4.1, 4.2, 4.3, 5.1, 5.2, 5.3): Hono app, SSE framing, stub pipeline,
  `/v1/generate` + `/v1/rewrite`. Grouped so the SSE writer is never a cross-chain handoff.
- **D — Metering + OpenRouter + CI** (6.1, 6.2, 7.1, 8.1, 8.3): usage store, metering wiring,
  OpenRouter wrapper, CI gate closure, ledger.

## 4. Cross-chain contracts (→ handoff/*.md)

- **A → B,C,D** (`handoff/workspace.md`): package names (`@whim/contract`, `@whim/server`),
  directory/tsconfig roots, root scripts (`server:dev`, `server:test`, `guard:metro`), data dir
  (`WHIM_DATA_DIR` default `server/.data/`, gitignored), test-runner location/idiom.
- **B → C,D** (`handoff/contract.md`): exported zod schema names and `z.infer` types — the
  `GenerationEvent` discriminated union **verbatim**, `Diagnostic`/`Usage`/`WireAppRecord`/
  request shapes, and the invariants (mandatory non-empty `hint`; exactly one terminal event,
  always last; install-state-free record).
- **C → D** (`handoff/server-core.md`): `Pipeline` interface, `UsageStore` injection point, and
  the `x-whim-device` middleware `400` body shape.

## 5. Spec surface

### `generation-contract` (6 requirements)
1. Shared wire-contract package — `@whim/contract`, zod-only, TS-source-only, no React/RN deps.
2. Generation request + rewrite shapes — `GenerateRequest` re-sends full `app` (no diffs);
   `RewriteRequest`/`RewriteResponse`.
3. SSE generation event stream schema — `GenerationEvent` discriminated union; exactly one
   terminal event, always last; unknown `type` rejected.
4. Diagnostics envelope — `Diagnostic { kind, symbol?, line?, hint }`, `hint` mandatory
   non-empty; `kind` open string here (#9 narrows it).
5. Wire app record — `WireAppRecord` install-state-free; no app-id / install timestamps.
6. Metro-safe device consumption — `guard:metro` proves Android bundle still resolves; blocking
   CI gate. (Scenario "Dependency budget enforced": fail if any React-adjacent runtime dep.)

### `generation-server` (7 + CI requirement)
1. Server workspace + runtime — `@whim/server`, deps exactly `hono` + `@hono/node-server` +
   `@whim/contract`; esbuild-bundle-then-run; `0.0.0.0:8787`.
2. Device-identity middleware — `x-whim-device` UUID on all `/v1/*`; missing/malformed → `400`
   structured JSON; `/healthz` exempt.
3. SSE generation endpoint over stub pipeline — `POST /v1/generate`; `Pipeline` interface; canned
   stage events; `[[fail]]` magic token → `failure`; injectable inter-event delay; exactly one
   terminal then close; strictly increasing SSE `id:`.
4. Rewrite endpoint (canned) — `POST /v1/rewrite`; deterministic; validates `RewriteResponse`.
5. Token metering — `UsageStore` + `node:sqlite` under `WHIM_DATA_DIR`; restart-durable; no
   prompt/source/bundle persisted. (Scenario "Nothing but the counter persists".)
6. Usage readback — `GET /v1/usage`; scoped to calling device ID; zeros for unknown IDs.
7. OpenRouter client wrapper — model-id-as-parameter; `AsyncIterable<string>` deltas + captured
   `Usage`; typed errors for 401/429/network; injectable `fetch`; no route mounts it; no
   live-network test.
8. Blocking server suite in CI — `server:test` (incl. `tsc --noEmit` over both packages) joins
   CI alongside existing `build` + `invariants` (those untouched).

## 6. Existing surfaces depended on

- `esbuild` (^0.25.0) — root devDependency; used by `server/test/run.mjs` and `server/dev.mjs`.
- `node:sqlite` — zero-dep Node 22 built-in; proven in `src/host/bridge/test/run.mjs`.
- `src/host/bridge/test/run.mjs` — canonical esbuild-bundle-then-run idiom to replicate
  (`bundle:true`, `platform:'node'`, `format:'esm'`, `target:'node20'`, `pathToFileURL` import,
  `rmSync` cleanup).
- `.github/workflows/invariants.yml` — current steps: `storage:test`, `bridge:test`,
  `launcher:test`, `build`, `invariants`, `bridge:invariants`. Add `server:test` + `guard:metro`.
- Built wholesale here: `contract/`, `server/`, root `workspaces`, the `Pipeline`/`UsageStore`
  interfaces, SSE helper.

## 7. Drift / overlap / independence

- **Roadmap:** #8 entry (v1-roadmap.md ~236–260) is `proposed 2026-06-12`; design matches the
  contract notes. No drift.
- **Independence from #9 (static-check-pipeline):** genuinely independent. `#9`'s `checks/` is a
  plain dir that does not require #8's workspaces; no file is written by both. The only
  coordination seam is the open `Diagnostic.kind` string — #9 narrows it into a closed catalog;
  whichever lands second does the narrowing. Confirms the user's "pretty independent" read.
- **Archived overlap:** none — `effects-and-cues`/`launcher-shell` touched `src/**`/`android/`,
  all excluded here.

---

## Proposer notes (retrofit decisions — read before dispatching)

**P1 — Chain A is human-bootstrap, NOT dispatchable.** `protect-harness.sh` blocks Edit/Write to
`*/package.json` and `*/tsconfig*.json` (every package.json, not just root). Task 2.1 creates
root `workspaces` + `contract/`+`server/` `package.json`/`tsconfig.json`, and 2.2 adds root
scripts — all hook-blocked. So **Chain A must be done by the human in an editor** (a class-B
setup step), then `npm install` re-run, before B/C/D are dispatched. The implementer-allowed
slivers of A (`.gitignore`, `server/guard-metro.mjs`) can ride with the human commit or be picked
up in B. chains.md flags this.

**P2 — Task 8.1 (CI yml) IS dispatchable.** `.github/workflows/` is not in the hook set, so an
implementer may edit `invariants.yml`. It sits at the end of Chain D (gate closure).

**P3 — `WireAppRecord` vs #5 (launcher-shell) stored record (design D3 "first-to-land defines the
seam").** #5 is already implemented. The Chain B implementer must verify #5's as-built stored
record (in `src/host/launcher/`) adds install-state fields (`id`, install timestamp, position)
*on top of* — not overlapping with — `WireAppRecord`'s field set. If they overlap, record the
divergence in the roadmap ledger per protocol. Flagged in `handoff/contract.md`.

**P4 — `manifest`/`schema` sub-schemas in `WireAppRecord` (open).** Design D3 lists them as
objects without zod sub-schemas. Chain B implementer decision: prefer reusing real types if
cheaply extractable from `src/host/storage-engine/contract.ts` / `build/build.mjs`; otherwise
`z.record(z.unknown())` is acceptable for the skeleton (the wire contract only needs the *shape*
to round-trip, not to re-validate app internals). Noted in `handoff/contract.md`.

**P5 — `checks/` is out of scope.** Workspace-ifying `checks/` is #9's job; tasks.md never names
`checks/`. Do not let any Chain A/D handoff imply #8 touches it.

**P6 — `guard:metro` CI feasibility (risk).** A release-mode Metro/RN bundle on `ubuntu-latest`
may need env setup the current workflow lacks. `@react-native-community/cli` is a root
devDependency, so the binary is present, but if the bundle needs Android tooling the guard step
may need a lighter resolution-only check. Surface to the human if 8.1 can't go green cheaply.
