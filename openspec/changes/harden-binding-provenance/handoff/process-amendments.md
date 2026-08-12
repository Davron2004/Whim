# Contract: chain C — process amendments (HUMAN-BOOTSTRAP)

Three Class-2 files, subagent-denied: `.claude/agents/researcher.md`,
`openspec/schemas/whim-harness/schema.yaml`, `.claude/commands/opsx/apply.md`. Every "before" block
below is verbatim from the file at the cited line. A human applies them.

**The incident these encode.** The parent run's `research.md:85-88` cited
`invariants/sandbox-isolation/bridge/runner.mjs:72` as "the precedent" for *context-level vs
page-level exposure scope*, while `:55-60` of the SAME document had already established that
`exposeFunction` discards the frame source. Right file, wrong comparison axis — and the axis that
mattered was never crossed. It survived three runs (`synthetic-run-harness/research.md:5,46`
baptised it "the load-bearing precedent"; `harden-containment-observation/research.md:45` re-read it
with the vulnerability class already in hand and concluded "No edit to `invariants/` is implied").
A one-off reminder demonstrably does not work, so the fix changes what the artifact is REQUIRED TO
CONTAIN, not what an agent is asked to remember.

## 1. `.claude/agents/researcher.md` — precedent is not authority

Rationale: line 15 scopes "docs, not code, is truth" to *settled decisions* only and says nothing
about code cited as an exemplar — exactly the gap `runner.mjs:72` fell through. New rule goes
adjacent to it.

BEFORE (`researcher.md:15`, one paragraph, unchanged):

```md
Whim-specific orientation: the source of truth for settled decisions is docs/ (docs/decisions.md numbered log, docs/spec.md, docs/spike2-findings.md, DEVLOG.md), not code. If the question touches runtime / sandbox / bundle-execution / storage, name the governing decision rather than re-deriving it from code. Live specs are in openspec/specs/; in-flight proposals in openspec/changes/.
```

AFTER (that paragraph unchanged, then a new paragraph immediately below it):

```md
Whim-specific orientation: the source of truth for settled decisions is docs/ (docs/decisions.md numbered log, docs/spec.md, docs/spike2-findings.md, DEVLOG.md), not code. If the question touches runtime / sandbox / bundle-execution / storage, name the governing decision rather than re-deriving it from code. Live specs are in openspec/specs/; in-flight proposals in openspec/changes/.

Precedent is not authority. During a hardening or security change, an in-repo occurrence of the pattern under investigation is a SUSPECT, not an exemplar — it may be the vulnerability, and the change may exist because it is. Citing one for ANY property (exposure scope, call shape, naming, wiring) requires stating, in the same sentence, whether that occurrence satisfies the property BEING HARDENED, or explicitly marking it NOT-CHECKED. Never write "the precedent", "the established pattern" or "as X already does" without that verdict attached: the property you are comparing on is rarely the property at risk, and an unchecked citation launders a live hole into a design input.
```

## 2. `openspec/schemas/whim-harness/schema.yaml` — the `research` artifact must carry a census

Rationale: the digest's shape is the enforcing surface. As long as "find an exemplar to copy" is a
legal research move, one mis-axed citation is enough; enumeration forces the vulnerable occurrence
into the same table as the safe ones.

BEFORE (`schema.yaml:29-38`, inside the `research` artifact's `instruction:` block):

```yaml
      Rules (the researcher enforces these; reject a digest that breaks them):

      - Terrain, not strategy — the digest reports what exists and what must not
      break, never how to implement.

      - No source dumps: more than 10 consecutive lines of source is a
      violation.

      - If the question is too broad to digest in 120 lines, the researcher says
      so and proposes a split rather than silently truncating.
```

AFTER (same block, one rule appended in the same voice and YAML folded-scalar shape):

```yaml
      Rules (the researcher enforces these; reject a digest that breaks them):

      - Terrain, not strategy — the digest reports what exists and what must not
      break, never how to implement.

      - No source dumps: more than 10 consecutive lines of source is a
      violation.

      - If the question is too broad to digest in 120 lines, the researcher says
      so and proposes a split rather than silently truncating.

      - SECURITY/HARDENING CHANGES REQUIRE A PATTERN CENSUS. Enumerate EVERY
      in-repo occurrence of the pattern under investigation — one row each:
      `file:line | SAFE | UNSAFE | NOT-CHECKED — test applied`. The test applied
      is named in the row, and it is the property BEING HARDENED, not a
      neighbouring one. "Find an exemplar to copy" is BANNED as a research
      primitive: an existing occurrence is a suspect, never an authority, and
      citing one without its census verdict is a rejectable digest. If the
      enumeration does not fit the 120-line cap, split the question rather than
      sampling — a partial census is reported as partial, with what was skipped.
```

## 3. `.claude/commands/opsx/apply.md` — UNSAFE census rows leave the run as filed follow-ups

Rationale: a census only helps if the rows it turns red survive the run that found them. The 2026-07
occurrences were each read, each judged out of scope, and each left with no artifact — which is why
the next run re-derived the same hole from scratch.

BEFORE (`apply.md:57`, step 13, verbatim and complete):

```md
13. Closing summary to progress.md: chains run, redispatches, deviations by class, reviewer verdict. Collect `MEMORY:` proposals from implementer reports, dedupe, and apply the worthwhile ones yourself (each Write prompts the human; unattended → list them for ratification instead). Tell the user the change is ready for a skim of progress.md + the proposal — not the diff — and suggest `/opsx:archive`.
```

AFTER (same line, one clause added; step numbering unchanged):

```md
13. Closing summary to progress.md: chains run, redispatches, deviations by class, reviewer verdict. CENSUS DISCHARGE (blocking, before closure): every row of research.md's pattern census classified UNSAFE or NOT-CHECKED that this change does not fix must be appended to `openspec/critic/open-follow-ups.md` with `file:line`, the vulnerability class, and what "done" looks like. Naming it in the report or in progress.md is explicitly NOT sufficient — a finding with no backlog entry is a finding the next run re-derives from scratch (2026-07 `runner.mjs:72`, missed by three consecutive runs). An empty census is a legitimate outcome only if the digest says so. Collect `MEMORY:` proposals from implementer reports, dedupe, and apply the worthwhile ones yourself (each Write prompts the human; unattended → list them for ratification instead). Tell the user the change is ready for a skim of progress.md + the proposal — not the diff — and suggest `/opsx:archive`.
```

Mirror into the schema (the enforcing surface for artifact content), appended to the same `research`
instruction so the obligation travels with the census that creates it:

```yaml
      - Every UNSAFE / NOT-CHECKED census row not fixed by this change is filed
      to openspec/critic/open-follow-ups.md before closure (apply.md step 13).
```
