# V1 Sprint Handoff — updated 2026-07-31 (Class-2 application + archive run)

Branch `worktree-v1-closure` = `v1-sprint` + **5 commits**, pushed. `v1-sprint` itself is unmoved
(the automation could not touch the primary checkout); `main` untouched. The five commits are
open as a **draft PR into `v1-sprint`**, not into `main`.

**`scripts/gate-full.sh`: 216 PASS, 1 FAIL — `metro-guard`, and only because it cannot run in a
worktree.** See "The one red check" below; it is proven unaffected, not waved through.

| Suite | Previous | Now | Where it runs |
|---|---|---|---|
| `npm run server:test` | 465 | **465** | `gate.sh` |
| `npm run evals:test` | 254 | **263** | `gate.sh` (new) |
| `npm run synthrun:test` | 82 | **80 + 1 quarantined** | `gate-full.sh` (new) |
| `npm run server:e2e` | 31 | **31** | `gate-full.sh` (new) |

All four are now real `npm run` scripts, and all four run inside a gate. That was the point of
this run.

---

## What this run completed

**All three `pending-class2.md` records applied** (harness hooks are disabled on this branch,
f0d56d1, so they were applicable in-session rather than via the Codex one-shot patch path):
`package.json` (+`synthrun:test`, `evals:test`, `evals`, `server:e2e`), `tsconfig.json`
(`exclude` += `evals/test`), `knip.json` (`evals/**`), `scripts/gate.sh` (+`corpus-eval`),
`scripts/gate-full.sh` (+`generation-e2e`, +`synthetic-run`).

**One deliberate deviation from a record** — `synthetic-run` went into `gate-full.sh`, not
`gate.sh` as its record instructed. `synthrun` calls `chromium.launch()`, and `gate.sh`'s own
header states "NO Metro, NO headless Chromium — those live in gate-full.sh". Applying that record
verbatim violated the documented gate split. This matches how #56's own browser-backed suite was
wired. The record's line was wrong; the application is not.

**`synthetic-run-harness` task 5.3 ticked and the change archived.** Its only blocker was the
Class-2 `npm run` entry.

**`eval-harness` archived.** Both changes' delta specs promoted into `openspec/specs/`
(`corpus-eval`, `synthetic-run`) with real Purpose sections, `docs/capabilities.md` repointed,
folders moved to `openspec/changes/archive/2026-07-31-*`. `openspec validate --all --strict`
32/32.

**Decision #57 authored** (eval-harness) — the gap the previous handoff flagged. #55 and #56
amended: both still described their Class-2 wiring as awaiting a human.

**Roadmap rot fixed.** Three entries claimed `Status: unproposed` for changes that are built and
archived: #3 `sdk-design-system` (decision #45), #10 `synthetic-run-harness` (#55), #11
`generation-loop` (#56).

---

## Three defects found by actually running the newly-gated suites

Each was invisible before, for a different structural reason. This is the run's real content.

### 1. Wiring knip to `evals/` surfaced three findings (2 real, 1 structural false positive)

Until the Class-2 edits landed, knip had never looked at `evals/` — a silent gap, not a false
negative.

- `evals/judge/index.ts` was **dead** and is deleted. The run's own `progress.md` FINDING 5 kept
  it on the prediction that it "will gain a consumer when Tier C is wired into the CLI". That
  prediction was **already falsified**: Tier C *is* wired (the CLI facade imports `evaluateTierC`)
  and `tiers/tier-c.ts` imports `../judge/judge` directly, not the barrel.
- `RUBRIC_CRITERION_IDS` shipped, was declared in `handoff/judge.md`, and never gained a caller.
  Deleted.
- `redactSourcingError` was a **false positive** and stays. It is imported and called by
  `evals/cli.mjs` — but only from inside the `FACADE_SOURCE` template literal, which no static
  analyzer can follow. **Standing consequence, recorded so nobody "cleans it up": any export
  consumed only through the facade string reads as dead to knip.**

Resolved with a direct unit test rather than a knip suppression, which closed a real gap — the
subprocess cases only ever drove the `kind`-present branch, so the `kind`-absent branch (a
harness-internal defect, whose message carries no candidate text and must survive even under
`holdout`) had **no coverage at all**. Red-checked both directions.

### 2. Archiving broke the tri-state gate-configuration check (regression, fixed)

The check `readFileSync`'d `openspec/changes/eval-harness/pending-class2.md` **unconditionally**,
so moving the change under `archive/` crashed the whole suite. It was built to survive
"unapplied → applied" and nobody taught it about "live → archived". Now the record is consulted
only when `gate.sh` has no entry (in the applied state the gate line is its own evidence), the
lookup also searches the archive, and an unreadable record degrades to "not recorded" — which
**fails with its message instead of throwing**. Red-checked across all three states.

### 3. The `synthrun` `mount_timeout` test is unsound, not flaky (quarantined)

Decision #55 recorded an intermittent race and deferred a structural fix. Under the gate it turns
out to be sharper and worse:

`FIXTURE_MOUNT_HANG`'s hang is **bounded** at `HANG_MS = 1200`, and it blocks the outer page's own
`load` event, so `page.goto` does not resolve until the hang is over. The observation window opens
at hang-end and the candidate posts its double-rAF `paint` ~2 frames later — **inside** the 800ms
budget. So the fixture *does* paint, and `paintAtMs === null` held only when the relay override was
installed too late to receive it. **The test passed because a message was lost, and it fails
precisely when the harness behaves better** — hence red under gate load, green standalone. Widening
the budget never helped and cannot: the window always opens at hang-end regardless of `HANG_MS`.

A sound version needs the trusted-vantage relay opened *before* navigation (`waitUntil: 'commit'`
+ early relay install) so an unbounded, never-painting fixture becomes usable. That is a change to
production `observe.ts`'s attach ordering — #55's deferred structural fix — on the very seam the
gate-never-faked property rests on. **Not landed unreviewed.**

Parked with a first-class **loud quarantine**: it prints every run, is counted, and the summary
always names the total, so it cannot quietly become permanent the way a commented-out test does.
It can neither pass nor fail, so it never touches the exit code, and it names the fixture it needs
so a tidy-up pass cannot delete `FIXTURE_MOUNT_HANG` as dead code. `awaitMount`'s timeout path
stays covered deterministically by the stub red-checks; only the real-browser variant is parked.

---

## The one red check

`metro-guard` fails **in the worktree only**. Cause is not path depth as such:
`server/guard-metro.mjs` resolves the RN binary from `repoRoot/node_modules/.bin/react-native`,
and a worktree has no populated `node_modules`. Mirroring all 604 top-level packages in as
symlinks does not help either — Metro refuses to resolve through symlinks out of its project root.

It is proven unaffected rather than assumed:

1. `guard:metro` **passes in the main tree at `4558a0a`** (measured: 1,961,853 bytes).
2. Every Metro input is **byte-identical** between `4558a0a` and this tip — `git diff --name-only`
   touches no `index.js`, `App.tsx`, `src/**`, `metro.config.js`, `babel.config.js`, or
   `package-lock.json`. The only `package.json` hunk is four added `scripts` lines; no
   `dependencies`/`workspaces` change. `evals/` is not reachable from the RN graph.

**Re-run `./scripts/gate-full.sh` from the primary checkout after merging** to convert this
argument into a measurement.

---

## Remaining work — all attended

1. **Merge this PR into `v1-sprint`**, then re-run `gate-full.sh` from the primary checkout
   (closes the `metro-guard` item above).
2. **Attended on-device acceptances** (these flip status tags; they do not block gates):
   - generation-loop **7.6** — real device on the LAN, real key: generate an app end to end and
     install it; kill it mid-generation and confirm the server observes the abort and the
     reconciled usage lands in `/v1/usage`. Closes cancellation carryover (a), flips #56's
     `PENDING`. **This is the last thing blocking `generation-loop` from being archivable.**
   - prompt-flow-ux **7.2**, snapshot-lineage-identity **5.2** (outstanding from earlier runs).
3. **Sprint closure**: push `v1-sprint`, draft PR into `main`, SonarCloud loop, `/git-cleanup`
   targeted at `v1-sprint`, single ratified merge.
4. **Re-enable harness hooks + OS sandbox** (disabled by f0d56d1; restore steps in the scratchpad
   `harness-toggle.md`). Do this before normal operation — the Class-2 protections are off.

### Open, deliberately not decided

- **The `synthrun` structural fix** (#55 / defect 3 above). Now scoped precisely: open the relay
  before navigation. Until then `synthetic-run` gates once per change, not once per attempt.
- **Reconciliation's shared retry budget favors early generation ids** — `resolveAll` walks ids
  sequentially under one `totalBudgetMs` (5000ms default), so a long run's later, more expensive
  repair rounds are structurally less likely to reconcile. A billing-fairness policy call.
- **If `usageStore.credit()` itself throws**, `creditOwned` is already set, so reconciliation will
  not retry that credit. Trades a theoretical under-credit for closing a real over-charge.
- **`EvalRunReport.evalSet.location`** is recorded unconditionally (a path, not content).
- **A corrupted report file** can surface a `JSON.parse` `SyntaxError` quoting invalid JSON.
- **`evals/cli.mjs` in `knip.json`'s entry list** is flagged redundant (the `evals` npm script
  auto-registers it). Kept explicit deliberately — it survives someone deleting the script.

---

## Hard-won environment facts

Still true from previous runs:

- **Worktree `@whim/*` walk-up gap**: a fresh worktree needs
  `mkdir -p <wt>/node_modules/@whim && ln -s ../../contract … && ln -s ../../server …`, plus
  `npm run build` (populates gitignored `src/runtime/generated/*`), or its gate validates stale
  code.
- `evals/` (root RN tsconfig) can never statically import `server/src/*`. Pattern: esbuild
  subprocess + dynamic import.
- zod can never enter the Metro graph.
- `sonarjs/no-empty-test-file` ignores `eslint-disable`; use a configuration comment.
- Harness hooks + OS sandbox are DISABLED on this branch (f0d56d1). **Re-enable.**

New from this run:

- **The gate's tamper tripwire refuses to run while Class-2 edits are uncommitted.**
  `gate-full.sh` compares verification config against HEAD, so an applied-but-uncommitted record
  reads as tampering. Ratification means **committing** the Class-2 change so it becomes the
  baseline. This is by design and is why the suites cannot silently start or stop running.
- **Never run two Chromium suites concurrently.** Running `evals:test` alongside `server:e2e`
  made the latter fail an 8s mount budget; alone it is 31/31. `gate-full.sh` runs them serially,
  so the gate is not exposed — but ad-hoc parallel verification is.
- **`npm run evals -- <subcommand>`** needs the `--`, or npm swallows the arguments.
- **`evals/test` is now excluded from `tsc`**, so type errors there are caught by neither the
  typecheck nor the esbuild-based runner (which strips types without checking). The editor LSP is
  the only thing that sees them. This is the documented Node-suite tradeoff, now with one more
  directory inside it.

## Method notes

- **Verify by count, not by color.** `gate.sh` staying green could not distinguish "suites
  registered and passing" from "suites still silently not running".
- **A red-check proves a test is *sensitive*; it says nothing about whether it is *sound*.** The
  `mount_timeout` test was non-vacuous, red-checkable, and asserting an outcome that only occurred
  on message loss. Sensitivity and soundness are different properties, and this run found the
  second one failing while the first held.
- **Prose that asserts a guarantee the code does not provide** keeps being the shape of these
  defects — "the ONLY module", "can never double-count", "will gain a consumer when…". All were
  true when written and quietly stopped being true. The FINDING-5 prediction is the newest member.
