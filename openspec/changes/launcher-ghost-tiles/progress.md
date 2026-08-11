# Progress ledger — launcher-ghost-tiles

Append-only. Every disposition recorded as it happens.

## Run start

- **run-start** (2026-08-10): staging branch `integration/launcher-ghost-tiles`, BASE `a7bbc9e`.
- **BASE DEVIATION (owner-ratified):** the staging branch was cut from **`redesign`**, not `main`.
  `main` (795c8bd) is 30 commits behind `redesign` and is a strict ancestor of it; the entire
  obs-v1 change merged into `redesign` via PR #23, never into `main`. Every planning artifact for
  this change — notably `research.md`'s `file:line` pointers (`LauncherRoot.tsx:500-588`,
  `HomeScreen.tsx:60,98-120`) — resolves only against `redesign`; the `src/host/launcher/` diff
  between the two branches is 64 files, +8850/−1103, including files absent from `main` entirely
  (`xhr-transport.ts`, `transport-shared.ts`, `webview-error.ts`). Cutting from `main` would have
  handed implementers coordinates pointing at different code. Owner chose `redesign` as this run's
  base; the closure PR therefore targets `redesign`, not `main`.
- **Precondition clearing (owner-ratified, all three):**
  - Uncommitted trailing-slash fix in `server-address.ts` + 3 tests in
    `prompt-flow-wiring.suite.ts` committed standalone onto `redesign` as `a7bbc9e`
    (`fix(launcher): strip trailing slashes from the persisted server address`) — unrelated to this
    change, kept out of its diff.
  - Stale `integration/obs-v1` deleted local (`git branch -D`, unsandboxed to avoid stranding a
    dead `.git/config` section) and remote. Verified fully absorbed: the two-dot tree diff
    `redesign → integration/obs-v1` was pure deletions plus 0-line renames into
    `openspec/changes/archive/2026-08-10-obs-v1/`, i.e. `redesign` is strictly ahead. The 31-commit
    `redesign..obs-v1` count was an artifact of `/git-cleanup` rewriting SHAs before PR #23 merged.
  - Three unrelated untracked change folders (`flow-wait-hygiene`, `generation-observability`,
    `server-connectivity`) are the owner's parallel planning work; left untracked and out of this run.

## Chain DAG

Strictly serial — chain-1 → chain-2 → chain-3, each declaring `after:` its predecessor. No two
chains are dependency-free, so no wave runs in parallel this change.

| chain | tasks | writes-contract | after |
|-------|-------|-----------------|-------|
| chain-1 persistence-pending-store | 1.1–1.4 | `handoff/pending-store.md` | — |
| chain-2 flow-shell-wiring | 2.1–2.5 | `handoff/ghost-handlers.md` | chain-1 |
| chain-3 ui-grid-tiles | 3.1–3.5 | none | chain-2 |

No chain touches Class-2 config (gate scripts, `.claude/**`, `invariants/`, `build/`); none is
HUMAN-BOOTSTRAP.

## Dispositions

- **baseline-green** — `./scripts/gate.sh` exit 0 and `npx openspec validate --changes` exit 0 on
  the staging tip `2bbef1e`, before any chain was dispatched. All 14 changes validate, including the
  three unrelated untracked folders — so they cannot sabotage `gate-full.sh`'s `openspec validate`
  step at step 10. Any red gate from here on is attributable to chain work, not to the base.
- **dispatched** — chain-1 (persistence-pending-store, tasks 1.1–1.4), BASE `2bbef1e`,
  worktree `.claude/worktrees/ghost-tiles-1`, branch `chain/ghost-tiles-1`. Boundary: new
  `pending-builds.ts`, additive-only `prompt-flow.ts` helpers, launcher test suite, contract
  `handoff/pending-store.md`. Explicit non-goal: chain-1 does NOT wire
  `demoteBuildingToInterrupted()` into the launch path — chain-2 owns that call site.
- **report** — chain-1 STATUS complete, GATE `FAST GATE PASSED` (exit 0), preceded by
  `launcher:test` → 5688 checks passed, 0 failed. Red-check performed on two behaviors: emptying
  `demoteBuildingToInterrupted` failed the demotion test with the right message; salting
  `ghostTileColorFor`'s hash failed both determinism tests. Notable rigor: the agent's first
  red-check salt was `Date.now()`, which did NOT perturb the hash within a single test run — it
  caught its own false-negative and re-ran with `Math.random()`. Restored byte-identical, green again.
- **deviations (both Class A, both accepted)** —
  - A1: `list()` achieves newest-first by unshifting onto `pending:order` at `create`, rather than
    mirroring `AppIndex`'s append-then-reverse-at-read idiom. Deliberate and documented: `AppIndex`
    is oldest-first (installed apps), `PendingBuildStore` is newest-first (ghosts), per design D1.
  - A2: `ghostTileColorFor(id)` is a thin wrapper over the existing `appColor` from
    `src/sdk/theme` (defined at `src/sdk/design-tokens.ts:297`), called with the launcher id.
    ADJUDICATED with a targeted recon rather than assumed: value imports from `src/sdk` into
    `src/host/launcher` are an established pattern (`tiles.ts:10` already imports this exact
    function; 20+ launcher files import executable design tokens), and `design-tokens.ts` has zero
    imports — pure data, pure functions, no RN. Sharing the function (rather than writing an
    equivalent hash) is what makes design decision 6's "hue must not change on transmute"
    structural instead of coincidental.
- **integrity** — `fixloop.sh integrity chain/ghost-tiles-1` exit 0, BASE correctly resolved to
  `2bbef1e`. NOTE for every later invocation: `FIXLOOP_INTEGRATION_BRANCH` MUST be exported.
  `scripts/fixloop.sh:46` defaults `INTEGRATION_BRANCH` to `main`, and BASE is
  `git merge-base <branch> $INTEGRATION_BRANCH` — unset, it would have baselined against `main`'s
  tip and reported all 30 `redesign` commits as this chain's scope violation.
  Five changed files, exactly matching the declared boundary; no protected paths.
- **merged** — `4e730ef` chain(launcher-ghost-tiles): 1. Contract `handoff/pending-store.md`
  landed at 89 lines (cap 120): types verbatim, six store signatures, two helper signatures,
  seven caller invariants, error surface. A real interface, not a diary.
- **regate-pass** — `./scripts/gate.sh` on the merged tip: `FAST GATE PASSED`.
- **review focus carried to step 11**: tasks.md 1.2 placed both pure helpers in `prompt-flow.ts`,
  but `ghostTileColorFor` is tile-colour vocabulary and `tiles.ts` is where `appColor` is already
  consumed. The implementer followed the task text exactly; flagging as a possible altitude nit
  for the reviewer, not a defect.

