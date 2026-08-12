# Context chains: harden-binding-provenance

<!--
  Tasks from tasks.md grouped into context chains for the dispatcher.
  Three chains: one Class-1 dispatchable (checks/), two HUMAN-BOOTSTRAP
  (invariants/, .claude/+schema — both Class-2 per protect-harness.sh).
-->

## chain-1: checks-binding-provenance-detector (Class-1, DISPATCHABLE)

- tasks: 1.1–1.5, 4.1
- rationale: all six tasks build, wire, and evidence one new structural-AST
  module (`checks/audit/binding-provenance.ts` — deliberately not under
  `checks/passes/`, since everything there is a registered `Pass` and this
  is not one) reachable through the
  existing `checks:test` seam; the dogfooding writeup (4.1) shares the same
  non-vacuity narrative and touches the one other file this chain owns.
- reads: design.md D1 ("a NEW sibling module... not a `Pass` registered in
  `checks/index.ts`'s `PASSES` array"); design.md "Scan surface must be
  structural, not a hardcoded 3-file list"; design.md "Implementation
  gotchas..." (`external:['typescript']`, `SyntaxKind.ImportKeyword` not
  `ts.isImportCall`); design.md D2 (guard shapes to recognize: page-level
  `source.frame !== page.mainFrame()`, context-level
  `source.frame !== source.page.mainFrame()`); design.md Risks/Trade-offs
  (first bullet — a detector that reds the gate cannot pass its own
  self-gate, so the guard lands first and the pre-fix proof is pinned to
  commit 754e2f7); design.md Migration Plan steps 1–2 (reversed ordering:
  guard first, detector second, evidence pinned to 754e2f7); research.md
  "Pattern census: every Playwright
  host binding in the repo" (quoted in D1) for the glob roots (`scripts/`,
  `invariants/`, `build/`, `src/`, `server/`, `contract/`, `synthrun/`,
  `checks/`, excluding `node_modules` and `openspec/changes/archive/**`);
  handoff: none.
- writes-contract: none — chain-1's outputs (the detector module and
  `evidence-red-check.md`) are not read as a formal interface by chain-2 or
  chain-3. Chain-2's patch text is delivered independently via
  `handoff/invariants-binding-guard.md`, and chain-3 has no dependency on
  chain-1 at all. The only inter-chain relationship is a build-ORDER
  constraint, captured as `after:` on chain-2 below, not a contract read.
- files touched: new `checks/audit/binding-provenance.ts`; a new `test()`
  in `checks/test/acceptance.ts` (or a sibling module it imports);
  `openspec/critic/open-follow-ups.md` (task 4.1 — unprotected, no
  `openspec/*` pattern in `.claude/hooks/protect-harness.sh`); new
  `openspec/changes/harden-binding-provenance/evidence-red-check.md` (task
  1.4, a change-folder artifact, not shared with chain-2/chain-3). Everything
  else read-only.
- after: chain-2. ORCHESTRATOR DECISION — this reverses the ordering that an
  earlier draft of design.md implied, and the reversal is deliberate. The
  draft had chain-1 land first so that its detector's failure against the
  still-unpatched `runner.mjs:72` would serve as free non-vacuity evidence.
  That is unworkable: the whim-harness chain-dispatch loop self-gates every
  chain before merge, so a chain whose own detector is designed to red
  `npm run -s checks:test` (hence `scripts/gate.sh:63`) can never pass its
  own gate, and "hold the merge manually" is a standing exception the loop
  has no way to represent.
  The fix keeps the evidence and drops the red gate: the pre-fix red-check is
  captured against the PINNED PRE-FIX COMMIT `754e2f7` in a scratch worktree,
  not against the live working tree. Strictly better as evidence — it is
  reproducible by anyone at any time rather than being a transient property
  of one worktree that disappears the moment the guard lands.
  So: a human applies chain-2 first; chain-1 is then dispatched against an
  already-patched tree, finds zero live violations, and self-gates green.
  Chain-1's non-vacuity rests on two legs, both independent of tree state —
  (a) the inline fixtures of task 1.3 (unguarded `exposeFunction`; guard
  present but placed after a `JSON.parse`; plus a correctly-guarded control
  that must NOT be flagged), and (b) the recorded run against `754e2f7`.

## chain-2: invariants-binding-guard (HUMAN-BOOTSTRAP)

- tasks: 2.1–2.3
- rationale: all three tasks apply, and verify, one exact patch to the
  Class-2-protected bridge invariants runner — subagents are hard-blocked
  from `invariants/` by `.claude/hooks/protect-harness.sh:103-135` (the
  `invariants/*` pattern at `:116`).
- reads: design.md D2 (inline guards, no shared helper — "a trust
  inversion"); design.md D3 (refusal must be observable — a counter
  mirroring `hostProvenanceRefusals` in `synthrun/observe.ts`; the guard must
  be the FIRST statement, before `JSON.parse` and `dispatcher.handle`);
  design.md D4 (why a name-scrub is not the fix, and the
  `exposeBinding`-before-`addInitScript` ordering trap if one is ever added);
  design.md D6 (per-scenario behaviour-preservation trace: scenarios
  1,2,6,7,8 use the normal outer-page relay; scenario 5 evaluates via a bare
  `page.evaluate`, targeting the main frame by default; scenarios 3 and 4
  never touch `whimHostDispatch`); research.md "The legitimate call path is
  already main-frame" (quoted in D6); handoff:
  `handoff/invariants-binding-guard.md` (exact patch text and the
  adversarial scenario, delivered separately).
- writes-contract: none.
- after: none — this chain goes FIRST. See the orchestrator decision recorded
  on chain-1: the ordering is deliberately the reverse of what an earlier
  design.md draft implied, because a chain whose detector is designed to red
  the gate cannot pass its own self-gate. A human applies this patch, then
  chain-1 is dispatched against the already-patched tree.
  Nothing is lost by going first: the pre-fix red-check is captured against
  the pinned pre-fix commit `754e2f7`, not against the live tree.
  This chain's own evidence is independent of chain-1 entirely — its patch
  text comes from `handoff/invariants-binding-guard.md`, and its required
  red-check (neuter the guard to `if (false)`, confirm the hostile write
  LANDS pre-fix, per decision #28) is run locally by the applying human.
- files touched: `invariants/sandbox-isolation/bridge/runner.mjs`.

## chain-3: harness-research-primitive-amendments (HUMAN-BOOTSTRAP)

- tasks: 3.1–3.4
- rationale: all four tasks amend the same Class-2 process-control files
  (`.claude/agents/researcher.md`, the `whim-harness` schema's `research`
  artifact instruction, `.claude/commands/opsx/apply.md`) plus the
  Codex-mirror regeneration that 3.1 requires, closing the process gap
  design.md D5 names.
- reads: design.md D5 ("Find an exemplar to copy... only the second forces a
  verdict per row"; "a wrong comparison axis... the two facts were never
  crossed"; "a census structurally cannot emit 'cited the vulnerable line as
  the good example'"; the `openspec/critic/open-follow-ups.md`
  mandated-writer point); research.md "How the research primitive failed
  across three runs" (quoted in D5); handoff: `handoff/process-amendments.md`
  (exact patch text for all three files).
- writes-contract: none.
- after: none — independent of chain-1 and chain-2. No shared files
  (chain-1 touches `checks/**` + `openspec/critic/open-follow-ups.md`;
  chain-2 touches `invariants/**`; chain-3 touches `.claude/**` +
  `openspec/schemas/whim-harness/schema.yaml` + the regenerated
  `.codex/agents/*.toml` mirror), and no ordering dependency either
  direction — stated explicitly because the dispatcher parallelizes
  dependency-free chains, and two undeclared-independent chains must never
  touch the same files.
- files touched: `.claude/agents/researcher.md`;
  `openspec/schemas/whim-harness/schema.yaml`;
  `.claude/commands/opsx/apply.md`; regenerated `.codex/agents/*.toml` (via
  `node scripts/sync-codex.mjs --write`, task 3.4); `docs/capabilities.md`
  (task 3.5 — unprotected, Class-1, bundled into this chain for locality).

## Closure (not a chain)

Tasks 4.2–4.3 are HUMAN-BOOTSTRAP post-landing verification
(`scripts/gate-full.sh`, desktop Chromium invariants, optional on-device
`RUN_BRIDGE_PROBE`) run once chains 1–3 have all landed; they touch no files
of their own and are covered by the standard whim-harness chain-dispatch
closure step (`gate-full.sh` + reviewer pass), not a fourth authored chain.

## File-disjointness

Confirmed against the real task list: chain-1 →
`checks/audit/binding-provenance.ts`, `checks/test/acceptance.ts` (or
sibling), `openspec/critic/open-follow-ups.md`,
`openspec/changes/harden-binding-provenance/evidence-red-check.md`.
chain-2 → `invariants/sandbox-isolation/bridge/runner.mjs`. chain-3 →
`.claude/agents/researcher.md`,
`openspec/schemas/whim-harness/schema.yaml`,
`.claude/commands/opsx/apply.md`, `.codex/agents/*.toml`,
`docs/capabilities.md`. No path appears in
two chains' file lists.
