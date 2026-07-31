# Research digest: prompt-flow-ux (roadmap #7) — prompt screen, two-stage flow, SSE client, edit/rewind entry points

## Relevant files
- `docs/v1-roadmap.md:234-245` — #7's brief (verbatim below). `:211-232` #6 (built, deps satisfied). `:246-283` #8 (built, the contract #7 consumes). `:333-355` #11 (owns the real pipeline — not this change).
- `docs/decisions.md` #21 (two-stage prompt), #48 D4 (prompt envelope), #52 D1/D2/D5 (storage groups, rewind-continuation obligation).
- `contract/src/index.ts` — wire zod schemas (verbatim below). `server/src/{app,pipeline,routes/*,sse}.ts` — routes, device-id gate, stub pipeline, SSE framing.
- `openspec/specs/linked-apps/spec.md:25-30` — "Rewind continuations share by default", **already says "wired by prompt-flow"**.
- `src/host/launcher/{LauncherRoot,HomeScreen,HistoryScreen,store-access,app-index,theme,copy,history-logic}.ts(x)` — shell + integration seam.
- `src/host/launcher/prompt-envelope.ts`, `src/host/bridge/contract.ts` (`AppRecord`/`AppManifest`).
- No existing device-id/UUID utility, SSE client, or server-URL config anywhere in `src/host` — this is greenfield client-side networking.

## Current behavior
`HomeScreen.tsx`'s dashed "+" create tile calls `onCreate` (comment: destination is #7's prompt screen); `LauncherRoot`'s `onCreate` currently just shows a placeholder `Alert` (`COPY.createTitle/createBody/createDismiss`) — this is the literal, already-stubbed integration point. `Screen` union (`LauncherRoot.tsx:34-39`) has `home|app|dev|settings|history`; no prompt/generation variants exist. `StoreAccess.install(spec: InstallSpec)` snapshots `{'bundle.js': ...}` only + writes the index entry (used by first-run seeding) — no method updates an *existing* entry's bundle. `history-logic.ts` already reads a `schema.json` snapshot artifact for its data-annotation feature, but nothing writes that file today — dormant since #6 shipped (`install` never wrote it).

Server (`@whim/server`, built #8): `POST /v1/rewrite` is a pure canned transform (no model call): `` `[Clarified] ${prompt.trim()} — Please be specific and concise.` ``. `POST /v1/generate` streams SSE over a **POST + fetch-streaming-body** transport (NOT `EventSource` — GET-only, no body). Stub `Pipeline` emits `stage{start,done}` for `plan→generate(+token deltas)→check→run`, then `usage`, then the single terminal event: `result` (fixed `STUB_APP_RECORD`, name `'stub-app'`, hardcoded hello-world source/bundle, empty `schema:{}`) unless `request.prompt.includes('[[fail]]')`, which drives `failure` instead (deterministic test hook). `AbortSignal` is honored end-to-end (client abort → no terminal event). All `/v1/*` need header `x-whim-device` (UUID regex) else `400 DeviceIdError`.

## Constraints and invariants
- **Wire types (contract/src/index.ts, verbatim):** `GenerateRequest{prompt:string, app?:{source,manifest,schema}}` (edit flow re-sends FULL source, never a diff). `RewriteRequest{prompt}`/`RewriteResponse{rewrittenPrompt}`. `GenerationEvent` discriminated union: `stage{stage:'plan'|'generate'|'check'|'run'|'repair',status:'start'|'done',attempt?}` | `token{text}` | `diagnostic{diagnostic:Diagnostic}` | `usage{usage:Usage}` | `result{app:WireAppRecord}` (terminal) | `failure{reason,attempts,diagnostics}` (terminal). Exactly one terminal event, always last, for a stream that *completes*; client-aborted streams end with none — not a violation. `WireAppRecord{name,source,bundle,sourceMap?,manifest,schema}` is install-state-free.
- **Decision #48 D4 (binding):** prompt-flow MUST write the prompt envelope `{v:1,text:string}` (JSON) as the snapshot's prompt string on every delivered generation. Parser already exists (`prompt-envelope.ts`), don't duplicate.
- **Decision #52 D2 / linked-apps spec "Rewind continuations share by default" (binding, already merged spec text):** an app created by continuing from a restored (non-tip) version MUST call `access.fork(originalEntry, undefined, {shareData:true})` **silently — no question asked**. The share/fresh sheet is HomeScreen-explicit-Fork-only; this path must not show it.
- **§10.1 (spec.md, still-valid vision text):** the rewrite-preview shows *intent in the user's own terms*; SDK internals must never surface. Concretely: never render raw `token` event text (that's generated source code) or raw `diagnostic.kind`/`symbol` to the user — `diagnostic.hint` is the one field designed to be human-legible.
- Host RN screens use `shellPalette(theme)` + plain `StyleSheet` (own `BackHandler`, `COPY` table, product-verbs guard) — **not** the SDK component kit, which is mini-app/WebView-only (`sdk-design-system` spec confirmed out of scope for host UI).
- No UUID/crypto-random utility exists on-device and no such npm package is installed; Hermes has no global `crypto.getRandomValues`. Adding a dependency means editing `package.json` (protected, Class 2/HUMAN-BOOTSTRAP) — avoidable by a `Math.random`-based UUID-v4-shaped generator (device identity here is not a security boundary, only anonymous metering).
- No server-address config exists on-device; server is LAN-dev-only (`server:dev` binds `0.0.0.0:$WHIM_SERVER_PORT`, default 8787) with no device-side discovery mechanism built anywhere.

## Integration points
- `LauncherRoot.tsx:34-39` `Screen` union — grows prompt/rewrite-preview/generating/failure variants.
- `HomeScreen.tsx` create tile (`onCreate`) and long-press action sheet (Open/Fork/Delete/History rows) — needs a new "re-prompt on existing app" row for the edit flow.
- `StoreAccess` (`store-access.ts`) — needs an `update()` wrapper (snapshot onto the SAME lineage, mirroring `install`'s store-first/index-second shape) and a way to detect "is this entry at the tip of its line" (best built on `history-logic.ts`'s existing `listVersions()` — reuses the same fork-vs-original F1-safe branching already tested by #6, rather than inventing new ambiguity).
- `SettingsScreen.tsx` — natural home for a manually-entered server-address field (same MMKV-backed pref pattern as theme).
- `src/host/launcher/test/acceptance.ts` (+ `server/test/acceptance.ts`) explicitly enumerate suite files (no glob) — a new suite module must be imported there too.

## Risks and unknowns
- I did not verify whether `@hono/node-server` actually surfaces `Request.signal` on a real TCP client disconnect on-device (server code notes this as an unverified external runtime assumption, acceptance deferred to when #11 lands) — irrelevant to this change's own client-side abort handling, which drives the fetch's own `AbortController`.
- Exact LAN-address UX (manual entry vs. something smarter) is a judgment call made in design.md — no existing convention in the repo settles it.
- Whether to also add an in-app (floating-menu) prompt entry point: `FloatingExit.tsx` today is a single-tap exit-to-home with no menu, so the spec.md §10 "start prompting" floating-menu idea is not built; treating HomeScreen as the only re-prompt entry point keeps this change from reopening #43b's settled back-nav design.

## Open questions for the planner
None blocking — the two live, binding contracts (#48 D4 envelope, #52 D2 silent-fork-on-continuation) resolve what would otherwise be open questions about scope.
