## 1. Workstream A — binding-provenance detector

- [x] 1.1 Create the audit at `checks/test/repo/binding-provenance.ts` (not under `checks/passes/`, and never registered in `checks/index.ts`'s `PASSES`, design.md D1). It walks every source file (`.ts`/`.tsx`/`.mts`/`.cts`/`.mjs`/`.js`/`.cjs`) in the repo, skipping `node_modules`, dot-dirs and the top-level `android/`, `ios/`, `openspec/`, `docs/`, and parses each with `ts.createSourceFile` (ScriptKind by extension, never `checks/internal/parse.ts`). AST rules, applied to every file rather than only those importing `playwright` (a helper handed a `page` need not import it): any `exposeFunction` reference is banned; every `exposeBinding` must be a direct call with an inline block-bodied callback whose first statement is `if (<src>.frame !== <page>.mainFrame())` (`<page>` an identifier or `<src>.page`, either operand order, destructured `{ frame }` accepted) ending in `return`/`return null` and reading none of the payload parameters. Evidence: commit `eb980ac8`.
- [x] 1.2 Wired through `checks/test/repo/binding-provenance.suite.ts`, run from `checks/test/acceptance.ts` like the other repo suites; no edit to `checks/index.ts`, `checks/test/run.mjs` or `scripts/gate.sh` (`external: ['typescript']` inherited). The live test asserts zero violations and that the scan reached a guarded site in `invariants/*.mjs` and in a `.ts` file.
- [x] 1.3 Inline fixtures in the same suite: unguarded `exposeFunction` (flagged `expose-function`), guard after `JSON.parse` (flagged `guard-not-first`), a refusal branch that dispatches the payload (flagged), a non-inline callback (flagged `binding-not-inline`), plus page-level and context-level guarded controls that pass. Weakening the audit to accept the guard anywhere in the body turns the suite red on `fixture/late-guard.ts` (`evidence-red-check.md`).
- [x] 1.4 Pinned pre-fix red-check: against `git archive 754e2f77` the audit exits 1 with exactly one violation, `invariants/sandbox-isolation/bridge/runner.mjs:72 expose-function`, and recognises the two guarded synthrun sites (`evidence-red-check.md`).
- [x] 1.5 `npm run checks:test` on the live tree: `PASS 309 · FAIL 0`, guarded sites `runner.mjs:118`, `synthrun/capability.ts:145`, `synthrun/observe.ts:500`. Moving the live runner guard after a `JSON.parse` turns it red (`runner.mjs:118 guard-not-first`).

## 2. Workstream B — runner.mjs guard + refusal counter

- [x] 2.1 `invariants/sandbox-isolation/bridge/runner.mjs` already used `page.exposeBinding` with a first-statement `source.frame !== page.mainFrame()` guard returning `null` and a per-`scenario()` `foreignCalls` counter (landed before this run). Added scenario 10 (commit `1be65ac6`): from `appFrame(page)`, after the non-vacuity triad (subordinate realm, `__whimSyscall` installed, `whimHostDispatch` reachable), a live-generation `storage.kv.set` frame gets `sysret === null`, `foreignCalls === 1`, and `engine.kv.get('pwned-by-frame') === undefined`; a main-frame positive control on the same wiring writes `host-write`.
- [x] 2.2 Red-checks (decision #28), each reverted and not committed: guard neutered to `if (false)` → FAIL with a real sysret, `engine-write-absent=false`, `refusals=0`; guard moved after `await host.dispatch(raw)` → FAIL with `sysret=null`, `refusals=1` but `engine-write-absent=false`, so only the engine read-back catches it. Restored → PASS.
- [x] 2.3 `npm run build && npm run bridge:invariants`: all 14 checks held (the 13 pre-existing scenarios unchanged, plus scenario 10).

## 3. Workstream C — research-discipline process amendments

- [x] 3.1 `.claude/agents/researcher.md`: an in-repo occurrence of the pattern being hardened is a suspect, not an exemplar, and is never cited as precedent without its verdict (commit `837f234d`).
- [x] 3.2 `openspec/schemas/whim-harness/schema.yaml` research instruction requires a pattern census for security/hardening changes and rejects exemplar citations without a census row; the research template gained a `## Pattern census` section.
- [x] 3.3 `.claude/commands/opsx/apply.md` step 13 and the schema file every out-of-scope UNSAFE row to `openspec/critic/open-follow-ups.md` before closure. The ledger had been deleted on 2026-09-22 and `openspec/critic/` is gitignored, so it was recreated and force-added (as `sonar-ledger.md` is).
- [x] 3.4 `node scripts/sync-codex.mjs --write` regenerated `.codex/agents/researcher.toml`; `--check` reports in sync.
- [x] 3.5 `docs/capabilities.md` row for `hardening-research-discipline`.

## 4. Dogfooding and closure

- [x] 4.1 `openspec/critic/open-follow-ups.md` §1: the detector lives in `checks/`, which the gate's `CONFIG_SET` tripwire does not cover, so an edit weakening it gates green (verification integrity / detector weakening).
- [x] 4.2 `scripts/gate.sh` green in the change worktree; `openspec validate harden-binding-provenance --strict` and `openspec validate --all --strict` pass. `gate-full.sh` runs at the staging-branch merge.
- [x] 4.3 Desktop Chromium `bridge:invariants` green (2.3). No runtime or product code changed; the syscall authority rule (`ev.source === window.parent`, decision #41) is untouched, so no on-device run is needed.
