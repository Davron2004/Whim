## Why

Decisions #33/#34 make the device the system of record: a mini-app's source, bundle, manifest, data, and **version history all live on the phone**. Versioning/rollback is first-class (Decision #23, spec §11) and happens far more often in vibe-coding than in normal coding. This change builds the **on-device snapshot store** that actually implements and *retains* that behavior — snapshot-per-generation, non-destructive rollback, pin, fork, history, and diff — wired to the launcher's product verbs.

It is the build that the `spike-git-versioning` spike de-risks. That spike ships no retained behavior; it hands forward a validated approach plus a recipe (which FS backend works under Hermes, the polyfill set, the operation→UI-verb mapping, confirmation that merge is never needed, and on-device storage/latency numbers). **This change consumes that lesson as input** and is the one whose capability deltas legitimately fold into `openspec/specs/` on archive.

## What Changes

- Implement a per-mini-app on-device version store (lead mechanism: `isomorphic-git` over the FS backend the spike validated), driven entirely programmatically — git is never surfaced to the user.
- Surface the product verbs: snapshot (every generation), undo/rollback, pin known-good, fork, history, diff.
- Enforce the **code/data split** the spike flagged: the version repo holds code artifacts (bundle source, manifest, `LEARNED.md`, prompt) only; rolling back code must never touch the user's runtime data.
- Keep forks as **independent lineages** (no merge), per the spike's confirmation.

## Capabilities

### New Capabilities
- `mini-app-versioning`: Each generation is an immutable snapshot tagged with the prompt that produced it; the user can view history, diff snapshots, roll back non-destructively, and pin a known-good version — all as product verbs, with git never surfaced.
- `mini-app-forking`: A mini-app can be forked into an independent lineage that diverges freely from the original, and forked lineages never require merging.

### Modified Capabilities
None.

## Impact

- **Status: unblocked — `spike-git-versioning` is complete (Decision #36 confirms H2 on-device).** The capability specs are written; `design.md` and `tasks.md` are now authored from the spike's recipe. **Scope is the code-versioning engine:** the version repo holds **code artifacts only** (bundle, manifest, `LEARNED.md`, prompt — and any future declared-`schema` file, tracked like any other file). Persistence of the user's runtime **data/database** and the old-code-meets-new-data **schema-drift** problem are explicitly **out of scope** and deferred to the v0.2 storage layer — there is no data persistence yet, so there is nothing to drift.
- **Mechanism-agnostic by design:** these specs describe behavior (snapshot/rollback/fork + "git never exposed"), not git. If the spike rejects on-device `isomorphic-git` and forces server-side git (H1), *what the user can do is unchanged* — only this change's design flips. That decoupling is why the capabilities survived the spike's mechanism reframing intact.
- **Affected systems:** the RN host (owns the version store), the launcher UI (the product verbs), and the v0.2 storage layer. Not the WebView sandbox — versioning is a host concern.
- **Retains behavior:** unlike the spike, this change ships real, retained code; its deltas are meant to become the system's source of truth.
