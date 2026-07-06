# harness-server-skeleton — tasks

## 1. English test specs first (§16.5)

- [ ] 1.1 Write the English test spec for the deterministic suite before any implementation:
      contract round-trips (every `GenerationEvent` variant, mandatory-`hint` diagnostic,
      install-state-free `WireAppRecord`, closed-union rejection), device-header middleware
      (missing/malformed/exempt-healthz), SSE framing (event/data/increasing-id/keepalive,
      exactly-one-terminal-last), stub happy + `[[fail]]` paths, metering durability across
      restart and zero-read for unknown IDs, dependency-budget checks for both packages,
      OpenRouter wrapper (delta order, usage capture, model-id passthrough, typed 401/429).
      Commit it as `server/test/SPEC.md`; the suite implements it.

## 2. Workspaces + Metro guard (the layout change, proven inert)

- [ ] 2.1 Add `"workspaces": ["contract", "server"]` to root `package.json`; scaffold
      `contract/` and `server/` packages (`@whim/contract`, `@whim/server`) with their own
      Node-flavored `tsconfig.json`s; wire root ESLint over both; gitignore `server/.data/`
      and `.env`.
- [ ] 2.2 Add `npm run guard:metro` (release-mode `react-native bundle` of `index.js` to a
      temp file, non-zero exit on failure); run it once before and once after the workspace
      edit to prove the layout change is inert; review the `package-lock.json` diff for
      React-adjacent hoists.
- [ ] 2.3 Verify the existing gates still pass untouched on the new layout: `npm run build`,
      `npm run invariants`, `npm run lint`.

## 3. Contract package (TDD)

- [ ] 3.1 Implement `@whim/contract` schemas per design D3: `GenerateRequest`,
      `RewriteRequest`/`RewriteResponse`, `GenerationEvent` union (stage/token/diagnostic/
      usage/result/failure), `Diagnostic` (open `kind`, mandatory `hint`), `WireAppRecord`,
      `Usage` — zod values + `z.infer` types, TS-source-only entry, `zod` as sole dep.
- [ ] 3.2 Implement the contract tests from 1.1 (round-trip, rejection, dependency-budget)
      in the acceptance suite skeleton (`server/test/run.mjs` esbuild-bundle-then-run idiom).

## 4. Server core (TDD)

- [ ] 4.1 Hono app factory (`@hono/node-server` only in `main.ts`/`dev.mjs`, app itself
      framework-portable): `GET /healthz`; `x-whim-device` UUID middleware on `/v1/*` with
      structured `400`s; tests via in-process `app.request()`.
- [ ] 4.2 `npm run server:dev` (`server/dev.mjs`, esbuild-bundle-then-run; `0.0.0.0`,
      `WHIM_SERVER_PORT` default 8787).
- [ ] 4.3 SSE writer: `event:`/`data:`/monotonic `id:` framing + injectable keepalive
      interval; test-side SSE reader for the suite.

## 5. Stub pipeline + endpoints (TDD)

- [ ] 5.1 `Pipeline` interface + `stubPipeline` per design D5: canned plan→generate(`token`s)
      →check→run stage pairs, `usage`, `result` with a fixed tiny `WireAppRecord`; `[[fail]]`
      prompt token → `failure` path; injectable inter-event delay (LAN-realistic default,
      0 in tests).
- [ ] 5.2 `POST /v1/generate`: body validation (`400` JSON, never SSE, on invalid), stream
      the pipeline through the SSE writer, exactly-one-terminal-then-close.
- [ ] 5.3 `POST /v1/rewrite`: validated canned deterministic rewrite.

## 6. Metering (TDD)

- [ ] 6.1 `UsageStore` interface + `node:sqlite` implementation (one table under
      `WHIM_DATA_DIR`, `:memory:` for tests); restart-durability test; nothing-but-the-counter
      data-dir inspection test.
- [ ] 6.2 Credit stub-run usage through the store; `GET /v1/usage` readback scoped to the
      calling ID, zeros for unknown IDs.

## 7. OpenRouter wrapper (TDD, unmounted)

- [ ] 7.1 `openrouter.ts` per design D6: model-id-as-parameter, async-iterable text deltas,
      final-chunk usage capture into contract `Usage`, typed auth/rate-limit/network errors,
      injectable `fetch`; recorded-SSE fake-transport fixtures; no route mounts it, no live
      test, `OPENROUTER_API_KEY` env-only.

## 8. CI, acceptance, ledger

- [ ] 8.1 Add `server:test` (including `tsc --noEmit` over `contract/` + `server/`) and
      `guard:metro` as blocking CI gates; existing `build`/`invariants` jobs untouched.
- [ ] 8.2 LAN acceptance: `server:dev` on the dev machine; from a phone-shaped client on the
      LAN (curl/node on another box is fine), hit `/healthz`, run one stub generation
      end-to-end over SSE, read back `/v1/usage`.
- [ ] 8.3 Update `docs/v1-roadmap.md` #8 status to implemented-state per protocol; record any
      as-built deviations from the contract notes; DEVLOG entry for lessons (esp. anything
      the Metro guard caught).
