## Context

Grounded in `research.md` (researcher digest, 2026-08-23) and its appended §Device measurement.
Three facts from it drive every decision below.

1. The wire already carries everything needed: `generation-request.ts` sends `source`,
   `manifest`, `schema` and the LIVE accumulated `appliedSchema`; the server never renders
   `app.source` into the generate turn, while `requestEditSection` claims it does (research.md §Q1).
2. The rewrite turn is app-blind, and its output becomes the whole build prompt (§Q1).
3. The measured data loss was **not** schema drift. Same appId, same `c1`, additive schema; v1 kept
   state in one kv key, v2 used `storage.records` only (§Device measurement). Schema diffing cannot
   see that class of change at all.

Settled ground not re-litigated: burned ids are the physical keys and additive-only evolution
(#38/#40); a rewrite keeps the storage-engine appId (§Q3 — the fork path passes `shareData: true`);
`vc-sdk` type-only re-exports and Metro-safe, type-only `@whim/contract` imports on the RN side.

## Goals / Non-Goals

**Goals:**
- An edit turn that can see the app it is editing — source, identity, and the storage locations the
  user's data actually lives under.
- Two mechanical guarantees behind the advisory prompt: identity continuity in the schema artifact,
  and surface continuity in the code. Both error-severity, both feeding the existing repair loop.
- Verb-time storage errors stop being invisible to the run stage.
- The model learns what a `date` field is before it writes one.

**Non-Goals:**
- Pre-seeding the synthetic run's engine from the applied schema (research.md open question 3 —
  follow-up).
- Migrating rows already orphaned on a device.
- Any UI change; the plan step's copy is untouched.
- Teaching the checker about data hardcoded in source (v2's `HABITS` list). Out of static reach;
  the prompt instruction is the only lever and is deliberately the only thing aimed at it.

## Decisions

**D1 — Prompt AND check, not either.** research.md open question 1 was decided both ways for a
reason: a prompt instruction is advisory and a model will ignore it under load; a check is the
guarantee but produces a worse app if it fires with no instruction to have prevented it. The check
is the contract, the instruction is how a candidate passes it first try.

**D2 — `Current source:` is rendered by the generate builder, not a new turn.** `buildRepairMessages`
already renders exactly this block (prompts/index.ts L262); the generate builder gains the same
section for a request whose pre-flighted `app.source` survived. Alternative rejected: rendering it
inside `requestEditSection` for all turns — the plan turn does not need the whole source and paying
its tokens twice per run is waste.

**D3 — One scanner, two consumers.** The list of storage locations rendered into the prompt and the
baseline the drift check compares against MUST be the same value, or the harness teaches one thing
and enforces another. `checks/storage-surface.ts` exports
`scanStorageSurface(source): StorageSurface` (kv key literals passed to `storage.kv.*`, collection
literals passed to `storage.records.*`, plus the non-literal call sites). `machine.ts` calls it once
per run on the pre-flighted source and threads the result into both the prompt context and the check
stage's options — mirroring exactly how `schemaContextFor` already threads the schema context.
Alternative rejected: a scanner inside `server/src` — two extractors, guaranteed to drift, and the
checker is already the repo's one AST library (`static-checks` §"pure, execution-free library").

**D4 — The surface rule is superset, not equality.** A candidate may add kv keys and collections; it
may never stop reading one. Equality would forbid legitimate growth, which is the entire point of an
edit.

**D5 — Non-literal keys warn, and suppress the error for that facade.** A computed key is
unverifiable in both directions: the harness cannot prove the candidate still reads
`habitCompletionHistory`, and cannot prove it does not. Emitting an error would be a false positive;
silence is what produced this change in the first place. So: `storage_surface_dynamic` (warning) at
the offending call site, and drift errors are suppressed for the facade (`kv` or `records`) whose
candidate usage is dynamic. Warnings are repaired too (`generation-pipeline` §"The check stage gates
before anything executes"), so nothing is dropped — the zero-warning steady state still applies.

**D6 — Identity continuity exempts tombstones and retired ids.** The rule: for every collection id in
the applied schema the candidate must declare that id; for every **active** field id in it, the
candidate must declare that id or list it in that collection's own `tombstones`. Already-retired ids
are exempt. This is a **generation-time** rule only — the engine's rollback tolerance
(`storage-schema-evolution` §"Rollback and roll-forward never lose data") is untouched, because a
restore never goes through the checker.

**D7 — `RewriteRequest.app` carries names, nothing else.** `{ name, collections?: [{ name, fields:
[string] }] }` — display names, which is the vocabulary the rewrite turn is required to answer in
("no SDK names, no engineering internals"). No source (payload size, and the rewrite turn cannot use
it), no burned ids, no rows. **Deviation from the brief:** no `description`, because the manifest has
none — `AppSpec` is `{ name, initial, screens, capabilities, schema? }` — and minting one is a
manifest change with its own blast radius. Zod stays server-side; the device keeps its type-only
import discipline (`generation-request.ts` header comment).

**D8 — `not_open` / `corrupt_storage` are host faults, excluded by rule.** The other six verb-time
kinds describe something the candidate's code did — a string into a `date` field, a query on an
unindexed field, an oversized kv value — and each has a hint the model can act on. These two describe
the harness's own engine: the run wires a fresh `:memory:` engine and applies the schema before mount
(`synthetic-run` §"Real gate, ephemeral storage"), so either one means the harness broke, and
reporting it as a candidate diagnostic would send repair chasing a fault in our code. They stay out
of `diagnostics` and stay **in** `report.trace`, so the exclusion is not a silent drop. Escalating
them into a harness fault (a new report field, a thrown precondition per `gate-preconditions`) is
deliberately left open — see Open Questions.

**D9 — The floor gets stated, not implied.** `generation-pipeline` §"Generation allocates burned
field IDs above the accumulated floor" already requires the prompt to *state* that new ids start
above N; today `schemaContextFor` only dumps the applied-schema JSON and says "do not reuse them",
which reads as "avoid `c1`/`f1`" — the precise opposite of what preserves data. It now calls the
engine's exported `burnedIdFloor` (the spec's single definition, which "the harness's checks and
prompts both use — neither re-derives it") and renders keep-existing-ids/allocate-above-floor.

**D10 — The vocabulary grows in one place, once.** `checks/contract.ts` `DIAGNOSTIC_KINDS` is a
closed, centrally-owned list (`harness-diagnostics` §"Kinds are a closed, centrally-owned
vocabulary"); downstream stages extend it *through* that module. All nine new kinds — three new,
six reused verbatim from `StorageErrorKind` — land in a single chain that owns that file, so no two
chains ever edit it.

## Risks / Trade-offs

- [False `storage_surface_drift` on a legitimate storage redesign] → The user asking for a redesign
  is real. Mitigated by D5 (dynamic suppresses), by superset-not-equality, and by the diagnostic
  being repairable rather than terminal: the model can satisfy it by reading the old location and
  migrating in code. Accepted deliberately — a wrong "you dropped the user's data" is cheaper than a
  silent drop, which is the defect being fixed.
- [Prompt growth: source + surface + floors + few-shots] → The source was always meant to be there
  (the prompt claims it). Surface and floors are two short lines. No new turn, no second model call.
- [The scanner is syntactic] → `storage.kv.set(k, v)` behind an alias or a helper function is
  invisible. `storage_surface_dynamic` covers the computed-argument case; an aliased facade is not
  covered and not pretended to be (Open Questions).
- [Hardcoded seed data (v2's `HABITS`)] → Untouchable statically. Only the identity-continuity
  instruction addresses it, and only advisorily. Stated, not papered over.
- [Six new run-diagnostic kinds turn previously-green runs red] → That is the fix. It can surface
  latent failures in existing corpus apps; those are real bugs the harness was hiding.

## Migration Plan

Additive and backward-compatible end to end. `RewriteRequest.app` is optional, so an old device
against a new server is unchanged and a new device against an old server has its extra field ignored
by a permissive zod object. The new checks fire only when the caller supplies an applied schema
and/or a previous surface — i.e. never on the new-app path, so the few-shot-fixture zero-diagnostic
tripwire is unaffected (`fixtures/water-counter.app.tsx` uses literal keys; `latency-probe` is not a
few-shot). Rollback is per-chain revert; no persisted state changes shape.

## Open Questions

1. Should a `not_open`/`corrupt_storage` denial escalate to a harness fault rather than a
   trace-only entry? It would need a report-shape change and a `gate-preconditions`-style
   precondition. Deferred, not forgotten (D8).
2. Pre-seeding the synthetic run's engine from the applied schema so an edit candidate is exercised
   against non-empty data (research.md open question 3). Out of scope here; it is the only thing
   that would have caught v2 *reading the right place but showing the wrong list*.
3. Aliased storage facades (`const kv = storage.kv`) defeat the scanner. Worth a follow-up SDK-lint
   rule ("call the facade directly") rather than an alias-tracking scanner.
