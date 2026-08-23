# Context chains: rewrite-preserves-user-data

<!--
  Tasks from tasks.md grouped into context chains for the dispatcher.
  Rules: 3–7 tasks per chain (≤~800 lines expected diff), grouped by shared
  files/layer, sequential by default. Each chain must be completable from ONLY
  its named spec excerpts + contracts from earlier chains — if a task needs
  "whatever an earlier chain happened to learn," promote that into a contract.
  Declare a writes-contract for every chain whose outputs a later chain consumes.
  A contract (handoff/*.md) is an interface, hard-capped at 120 lines.
-->

## chain-1: checks-vocabulary-and-scanner

- tasks: 1.1–1.5
- rationale: the closed kind vocabulary and the shared storage scanner are the two things every later chain reads. One chain owns `checks/contract.ts` for the whole change, so the centrally-owned vocabulary is never edited from two worktrees.
- files: `checks/contract.ts`, `checks/storage-surface.ts` (new), `checks/index.ts`, `checks/test/acceptance.ts`, `handoff/storage-surface.md`
- reads: `specs/static-checks/spec.md` §"The kind vocabulary grows additively for the generation loop" (MODIFIED); `specs/harness-diagnostics/spec.md` §"Kinds are a closed, centrally-owned vocabulary" (MODIFIED); `specs/generation-pipeline/spec.md` §"The storage-surface instruction and the drift check read one scanner"; handoff: none
- writes-contract: `handoff/storage-surface.md`

## chain-2: checks-continuity-passes

- tasks: 2.1–2.5
- rationale: both new rules are check passes over the same `CheckContext`, sharing the schema/AST vocabulary and one test file.
- files: `checks/passes/schema-check.ts`, `checks/passes/storage-continuity.ts` (new), `checks/index.ts`, `checks/internal/scope.ts`, `checks/test/acceptance.ts`, `handoff/check-options.md`
- reads: `specs/static-checks/spec.md` §"An edit candidate keeps the applied schema's collections and fields", §"An edit candidate keeps reading where the data already is"; handoff: `handoff/storage-surface.md`
- writes-contract: `handoff/check-options.md`
- after: chain-1 (shares `checks/index.ts` and `checks/test/acceptance.ts`)

## chain-3: server-edit-turn

- tasks: 3.1–3.6
- rationale: every task edits the prompt builders and the machine that feeds them; all of it is proved by one suite.
- files: `server/src/generation/prompts/index.ts`, `server/src/generation/machine.ts`, `server/src/generation/stages/check.ts`, `server/test/prompts.suite.ts`, `handoff/prompt-context.md`
- reads: `specs/generation-pipeline/spec.md` §"The edit turn sees the app it is changing", §"The storage-surface instruction and the drift check read one scanner", §"Generation allocates burned field IDs above the accumulated floor" (MODIFIED); handoff: `handoff/storage-surface.md`, `handoff/check-options.md`
- writes-contract: `handoff/prompt-context.md`
- after: chain-2 (consumes the widened `runStaticChecks` options)

## chain-4: rewrite-app-context

- tasks: 4.1–4.5
- rationale: one wire field followed end to end — contract, server route, rewrite system prompt, device builder, device client.
- files: `contract/src/index.ts`, `server/src/generation/prompts/index.ts`, `server/src/routes/rewrite.ts`, `server/test/contract.suite.ts`, `server/test/prompts.suite.ts`, `server/test/server-core.suite.ts`, `src/host/launcher/generation-request.ts`, `src/host/launcher/generation-client.ts`, `src/host/launcher/LauncherRoot.tsx`, `src/host/launcher/test/generation-request.suite.ts`, `src/host/launcher/test/generation-client.suite.ts`
- reads: `specs/generation-contract/spec.md` §"Generation request and rewrite shapes" (MODIFIED); `specs/prompt-flow/spec.md` §"A rewrite for an edit carries the app it is changing"; handoff: `handoff/prompt-context.md`
- writes-contract: none
- after: chain-3 (shares `server/src/generation/prompts/index.ts` and `server/test/prompts.suite.ts`)

## chain-5: synthrun-verb-time-denials

- tasks: 5.1–5.4
- rationale: the run report's denial filter and its two proving suites; touches no file any other chain touches.
- files: `synthrun/report.ts`, `synthrun/test/acceptance.ts`, `server/test/machine.suite.ts`
- reads: `specs/synthetic-run/spec.md` §"Verb-time storage denials are candidate diagnostics; host faults are not"; `specs/harness-diagnostics/spec.md` §"Kinds are a closed, centrally-owned vocabulary" (MODIFIED); handoff: `handoff/storage-surface.md` (kind strings and the host-fault exclusion)
- writes-contract: none
- after: chain-1 (consumes the kind vocabulary; may run in parallel with chain-2/3/4 — no shared files)

## chain-6: docs-and-engine-regression

- tasks: 6.1–6.5
- rationale: the model-facing reference plus the engine-level invariant the whole change rests on; the doc and the tripwire that gates it must land together.
- files: `docs/sdk-reference.md`, `server/test/prompts.suite.ts`, `src/host/storage-engine/test/acceptance.ts`
- reads: `specs/generation-pipeline/spec.md` §"The SDK reference documents the storage schema artifact"; `specs/storage-schema-evolution/spec.md` §"Abandoning a burned identity orphans data; it never migrates it"; handoff: none
- writes-contract: none
- after: chain-4 (shares `server/test/prompts.suite.ts`)
