# Context chains: harden-synthrun-binding-isolation

<!--
  Tasks from tasks.md grouped into context chains for the dispatcher.
  Rules: 3–7 tasks per chain (≤~800 lines expected diff), grouped by shared
  files/layer, sequential by default. Each chain must be completable from ONLY
  its named spec excerpts + contracts from earlier chains — if a task needs
  "whatever an earlier chain happened to learn," promote that into a contract.
  Declare a writes-contract for every chain whose outputs a later chain consumes.
  A contract (handoff/*.md) is an interface, hard-capped at 120 lines.
-->

No chain here is HUMAN-BOOTSTRAP. The design deliberately leaves `build/assemble.mjs`,
`src/runtime/web/loader.js`, `probes.js`, `invariants/` and `build/*` read-only — the outer page's nonce
check is sound and is being *bypassed* rather than broken, so it needs no change (proposal §Impact). The
fix is entirely host-side in `synthrun/`. `.github/workflows/invariants.yml` is explicitly **out of
scope** (D6) even though it is unprotected: if an implementer finds itself wanting to edit CI, that is
the deferred recommendation, not this change. If any chain finds itself needing a protected file, the
chain is wrong: stop and report rather than self-marking HUMAN-BOOTSTRAP and proceeding.

File partition (no two chains without a declared `after:` share a file):

- chain-1 — `synthrun/observe.ts`, `synthrun/capability.ts`
- chain-2 — `synthrun/test/acceptance.ts`, `synthrun/contract.ts` (one stale doc comment, task 2.5)

The two are strictly serial (`after: chain-1`): chain-2's assertions are the acceptance criterion for
chain-1's guard and cannot be red-checked before it exists. They are file-disjoint, so the serialization
is a dependency, not a file conflict. **There is no parallelism in this change and that is correct** —
it is one small, highly-coupled security fix across two implementation files plus its acceptance suite.
Splitting chain-1 further would put `synthrun/observe.ts` in two chains for no gain.

## chain-1: host-frame-provenance

- tasks: 1.1–1.6
- rationale: one coherent idea applied to both host channels — stop discarding the frame identity the
  browser already supplies, and stop letting a late frame overwrite a verdict. The relay guard, the
  dispatch guard and the verdict rule share a single predicate and a single threat model, so they are
  one chain. Touches only the two implementation files; the acceptance evidence is chain-2's job.
- reads: `specs/synthetic-run/spec.md` §Host observation channels are unreachable from the candidate
  realm (the full delta requirement + all three scenarios); `design.md` D1–D4; `research.md` Q1–Q3 and
  "Current code shape". handoff: none.
- writes-contract: handoff/host-provenance.md
- key constraint: `synthrun:test` is **not** in `scripts/gate.sh` (decision #55), so a green fast gate
  does **not** prove this chain. It must not claim acceptance; it reports the guard's observable shape
  into the contract and lets chain-2 prove it.

## chain-2: capability-reachability-acceptance

- tasks: 2.1–2.5
- after: chain-1
- rationale: `synthrun/test/acceptance.ts` is 1209 lines and is the single largest file in the change;
  it is a chain boundary of its own, exactly as chain-4 was in `harden-containment-observation`. This
  chain un-quarantines the parked assertion that names this change and adds the two sibling cases the
  delta spec's remaining scenarios require.
- reads: `specs/synthetic-run/spec.md` §Host observation channels are unreachable from the candidate
  realm (all three scenarios verbatim — each maps to one test); `design.md` D5; handoff:
  handoff/host-provenance.md (chain-1's guard predicate, refusal accounting shape, and verdict rule).
- writes-contract: none (terminal chain).
- key constraint: every new assertion must be **red-checked** (task 2.4) by temporarily neutering
  chain-1's guard in the worktree and observing the failure, then restoring. This is sanctioned and
  expected — it is the only way to distinguish a real security assertion from one firing at a dead
  channel. The red output is reported, not merely claimed.
