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
- **cleanup** — chain-1 worktree removed, `chain/ghost-tiles-1` deleted (unsandboxed), owner file cleared.
- **dispatched** — chain-2 (flow-shell-wiring, tasks 2.1–2.5), BASE `82034eb`,
  worktree `.claude/worktrees/ghost-tiles-2`, branch `chain/ghost-tiles-2`. Dispatched at the
  frontier tier: this chain rewires the live generation state machine and its correctness property
  (crash-inside-delivery degrades to an interrupted ghost, never a lost app) is an ordering
  invariant that tests can only catch if the ordering is written correctly in the first place.
- **ADJUDICATION issued with the chain-2 brief (spec ↔ design tension, resolved by the dispatcher
  rather than left to the agent):** the prompt-flow spec requires id allocation "for new-install
  attempts as well as edit/rebuild attempts", while design decision 3 scopes `freshAppId()` to new
  installs only and leaves edit/fork id semantics untouched. Resolution given: "allocate the
  launcher id for the attempt" means *determine and record the id this attempt will write to*, not
  *mint a fresh one*. New install → mint up front and have `deliverResult` consume it. Edit/rebuild
  → the attempt's id IS the existing app's id; no fresh mint, `editingAppId` set. Left unresolved,
  the plausible wrong reading (minting a fresh id for a rebuild) would silently fork the app
  instead of updating it — a data-shaped bug that no listed test would necessarily catch.
- **PARTITION NOTE (deliberate, safe):** chain-2 is permitted a narrow additive edit to
  `HomeScreen.tsx` — prop declarations + threading only, no composition or rendering — because the
  handlers it defines must reach the grid through a call site that lives in its own file
  (`LauncherRoot.tsx`). chains.md's no-overlap rule protects *concurrent* chains; this DAG is
  strictly serial, and chain-3 branches from a tip that already contains chain-2's merge, so the
  overlap cannot race. Chain-3 retains all rendering/composition ownership of that file.
- **report** — chain-2 STATUS complete, claims GATE `FAST GATE PASSED` exit 0 and
  `launcher:test` → 5741 checks passed, 0 failed. Both mandatory red-checks executed with real
  failure text: deleting the pending record BEFORE `deliverResult` produced
  `got null, want "building"` plus a null-deref in the crash-degradation test; minting a fresh id
  in `deliverResult` produced a four-assertion failure showing the delivered app, the version-store
  write, the host record, and the retry path all disagreeing with the ghost's id.
- **VERIFICATION IN FLIGHT (claim vs evidence conflict)** — the IDE reports
  `test/build-lifecycle.suite.ts:70:57 Property 'capabilities' is missing in type '{}' but required
  in type 'AppManifest' [2741]`, in a file chain-2 authored. A real type error and a passing
  typecheck cannot both hold unless the gate's typecheck excludes that path. Dispatched an
  independent verifier (NOT the author) to establish which: a genuine gate pass with a typecheck
  coverage hole, an IDE artifact tsc does not reproduce, or a false claim. Merge is HELD until it
  reports — an exit code beats prose, but only once someone other than the author has read it.
- **extraction (sanctioned)** — `src/host/launcher/build-lifecycle.ts`, RN-free and Node-suite
  importable. `freshAppId`, `mapWireRecord`, `deliverResult` moved verbatim out of
  `LauncherRoot.tsx` (`deliverResult` now takes a `DeliverSpec` carrying the up-front `appId`),
  plus new `startPendingBuild`/`deliverAndSettle`/`failPendingBuild`/`dropPendingBuild`/
  `pendingFailure`/`hydratedDiagnostics`/`retryBuildScreen`. This was the point of pre-authorizing
  the extraction: `LauncherRoot.tsx` imports `react-native`, so without it BOTH mandatory
  red-checks would have been unrunnable and the ordering invariant would have shipped unproven.
- **deviations (all Class A)** —
  - Launch-time demotion wired into `LauncherShell`'s mount effect before `setReady(true)`. This
    is the call site chain-1 was deliberately forbidden from touching; it lands here as designed.
  - `FailureScreen` gained `retryable?: boolean`, relabelling the primary action to the existing
    `COPY.screenErrorRetry`. No new copy string — `copy.ts` is chain-3's file and stayed untouched.
  - New shell-local `INTERRUPTED_REASON`: an `interrupted` record carries no failure payload, and
    reusing `GENERIC_STREAM_ERROR` would assert a failure that never occurred. Correct distinction.
    CARRIED TO CHAIN-3: consider relocating it into `copy.ts` beside the ghost-state captions.
  - `onBuildIt` now delegates to `runAttempt(building, reuseId?)`, collapsing the shell to a single
    `generateApp` call site entered by both `Build it` and Retry. Four static assertions in
    `prompt-flow-wiring.suite.ts` were retargeted and one STRENGTHENED to "exactly one generateApp
    call site exists in the shell". Retargeting pre-existing assertions is the one move here that
    could hide a weakening — flagged for the step-11 reviewer to confirm none lost force.
  - `liveRef` holds `{id, screen}` so a `building` ghost tap reattaches to current progress rather
    than a stale snapshot. Explicitly not an event bus: written by the same stream loop that
    already calls `setScreen`, so it adds no second subscriber. Respects the design non-goal.
  - Retry re-runs the record's VERBATIM stored prompt. The agent noted the record has no rewritten
    text and declined to widen chain-1's contract to add one — it reported instead of self-serving,
    which is the behavior the brief asked for.
- **PRE-EXISTING DEFECT SURFACED (not fixed, deliberately out of scope)** — cancelling *during*
  delivery still lets the in-flight `deliverAndSettle` complete and install, so an app can be
  installed from a cancelled generation. That contradicts the standing prompt-flow requirement
  "No app SHALL be installed or updated from a cancelled generation". Assessed as genuinely
  pre-existing and NOT worsened here: the race predates the pending record, and the post-install
  `pending.delete` degrades to a documented silent no-op on an already-deleted id, so this change
  adds no new failure mode. Left alone to keep the diff honest. Recorded for the owner as a
  candidate follow-up change; step-11 reviewer to confirm the pre-existing characterization.
- **verification result — VERDICT (i): the implementer's claim is ACCURATE.** Independent verifier
  (not the author) confirmed `./scripts/gate.sh` exit 0 and `launcher:test` exit 0 / 5741 checks in
  the chain-2 worktree, and `npx tsc --noEmit` exit 0 with ZERO errors. The IDE's type error is
  real in isolation but invisible to the gate.
- **GATE COVERAGE HOLE (pre-existing, structural, worth the owner's attention).** `scripts/gate.sh:55`
  runs `npm run -s typecheck` → `tsc --noEmit` against the ROOT `tsconfig.json`, whose `exclude`
  contains `"src/host/launcher/test"` with a comment stating the omission is deliberate (the Node
  acceptance suites use `process` and run via esbuild; the launcher MODULES stay typechecked).
  Consequence: **no launcher test file is typechecked by anything, ever.** The suites are validated
  by running them, so behavioral regressions are caught — but a fixture can be annotated with a type
  it does not satisfy and nothing will say so. This is not a chain-2 defect and not new; it is a
  standing property of the gate that this run happened to expose. `tsconfig.json` is Class-2
  protected, so narrowing the exclusion is a human-ratified decision, not an agent's. Recorded, not
  acted on.
- **revision 1 → chain-2** (SendMessage, 1 of the 2 permitted): the fixture at
  `test/build-lifecycle.suite.ts:70` declares `manifest: {}` against `AppManifest`, which requires
  `capabilities`. Harmless today, but it would hand `undefined` to any future assertion reading
  `manifest.capabilities`. Asked for the honest literal, a sweep of this chain's own new/modified
  test files for the same class of defect, and — because a green gate CANNOT evidence a fix in an
  unchecked directory — verification by a means other than the gate. Explicitly forbade editing
  `tsconfig.json` and forbade fixing fixtures in files this chain did not already touch.
- **revision 1 result** — fixed to `manifest: { capabilities: [] }`, correct per `AppManifest` at
  `src/host/bridge/contract.ts:250-261` (`capabilities` required, `tileColor` optional). The sweep
  found exactly one instance and, importantly, correctly did NOT over-fix: `WireAppRecord`'s
  `manifest: {}` / `schema: {}` are honest, because those fields are
  `z.record(z.string(), z.unknown())` in `contract/src/index.ts:57-58`. The three
  `as unknown as StoreAccess` partial stubs were left alone with reasoning — a double cast is an
  explicit "partial stub" claim rather than a literal failing its annotation, and it is the idiom
  `prompt-flow-wiring.suite.ts` already uses.
  Verified WITHOUT the gate, as required: a throwaway tsconfig (scratchpad only, never in the repo)
  extending the project config with `exclude: []` reproduced
  `build-lifecycle.suite.ts(70,57): error TS2741` before the fix and zero errors in that file after.
- **WHY the test directory is excluded — refines the coverage-hole note above.** Running tsc over
  the whole suite directory leaves only ambient-environment errors (`console`, `process`,
  `node:fs`, `fetch`, `Response`) on pre-existing lines. So the exclusion is not laziness: these
  files legitimately do not typecheck under the RN app's `lib`/types. Narrowing it is therefore not
  a one-line tsconfig edit — it would need a SEPARATE tsconfig for the Node suites carrying Node
  lib types. Still Class-2, still the owner's call, but the real cost is now recorded so nobody
  re-derives it as "just delete the exclude entry".
- **integrity** — `fixloop.sh integrity chain/ghost-tiles-2` exit 0, BASE `82034eb`. Eight changed
  files, all inside the declared boundary (including the pre-authorized narrow `HomeScreen.tsx`
  prop-threading edit); no protected paths.
- **DISPATCHER PROCESS ERROR (caught, no damage) —** the first `git merge` of chain-2 reported
  "Already up to date" and appeared to leave the staging tip on the chain branch. Cause: the Bash
  tool's working directory PERSISTS between calls, and an earlier `cd` into
  `.claude/worktrees/ghost-tiles-2` (to symlink `node_modules` and build) was still in effect — so
  the merge ran INSIDE the worktree, on `chain/ghost-tiles-2`, merging that branch into itself.
  A harmless no-op; `git worktree list` confirmed the primary tree still at `82034eb` on the
  staging branch, untouched. Re-run with an explicit `git -C <primary>` and it merged correctly.
  Same drift means the earlier "primary tree typecheck" actually executed in the worktree — the
  verdict stood because the worktree was byte-identical to the primary tree at that moment, but the
  label was wrong. STANDING RULE for the rest of this run: every git/gate command that must act on
  the primary tree uses an explicit absolute `cd` or `git -C`, never an inherited CWD.
- **merged** — `6230d66`, 8 files, +888/−120. `LauncherRoot.tsx` −120/+352 reflects the delivery
  logic moving out to `build-lifecycle.ts`, not net new shell complexity.
- **regate-pass** — `./scripts/gate.sh` on the merged tip: `FAST GATE PASSED`. Tasks 1.1–2.5 ticked
  (9 of 14).
- **dispatched** — chain-3 (ui-grid-tiles, tasks 3.1–3.5), BASE `565cfac`,
  worktree `.claude/worktrees/ghost-tiles-3`, branch `chain/ghost-tiles-3`.
- **report** — chain-3 STATUS complete, GATE `FAST GATE PASSED` exit 0, suite 5940 passed / 0 failed.
  Both mandatory red-checks real: removing the `ghostIds.has(app.id)` guard produced
  `got 2, want 1`; making `editingAppId` records also emit a ghost produced four failures including
  `no ghost for the rebuild attempt (got ["rebuild-1"], want [])`. Fixture honesty verified the way
  the brief demanded — a scratchpad tsconfig with `exclude: []` and `types: ["node"]` over the new
  suite, zero errors — because the gate provably cannot evidence it.
- **composition module** — `src/host/launcher/grid-composition.ts`, RN-free, exporting
  `composeGrid(pending, apps): GridTile[]` over a `GhostTile | InstalledTile` union. Rebuild
  records never become their own tile; they attach to `InstalledTile.rebuild`.
- **integrity** — exit 0, BASE `565cfac`, 8 files, all in boundary.
- **merged** — `8ab5dc5`, 8 files, +595/−36. **regate-pass** — `FAST GATE PASSED`. Tasks 14/14.
- **DEVIATION [CLASS B] — an ADDED spec requirement is NOT satisfied. Adjudication below.**
  `specs/app-launcher/spec.md` requires: "Ghost tile color is a deterministic hash of the launcher
  id, **stable across transmute**", with the scenario "a ghost tile with launcher id X ... delivered
  as an installed app with id X → the tile color at that position is unchanged".
  It is not. The ghost renders `ghostTileColorFor(rec.id)` = `appColor(id)`. The delivered tile,
  when its manifest declares no `tileColor`, falls back to `appColor(app.name)`. Same function,
  same palette, DIFFERENT hash input — so the hue changes at the moment the build completes.
  This corrects an earlier claim in this very ledger: sharing `appColor` was recorded (at chain-1
  merge) as making the guarantee "structural instead of coincidental". It does not. It guarantees
  the same PALETTE, not the same COLOR. Chain-3 found it by tracing the delivered tile's fallback
  rather than trusting the upstream contract's assertion, and correctly REPORTED instead of
  reaching into `build-lifecycle.ts` (outside its boundary) to fix it.
  Candidate fix: at delivery, when the wire manifest declares no `tileColor`, inject
  `appColor(appId)` as the record's `tileColor` in `mapWireRecord`. Additive; leaves every existing
  installed app's colour untouched (their names still hash as before). Blast radius under recon
  before any fix chain is specced — the open question is whether History / whim-prose derive colour
  via `appColor(name)` DIRECTLY, bypassing `tileColor(name, manifest)`, in which case the fix would
  desync those surfaces from the grid and must cover them too.
- **deviations [Class A] — chain-3**
  - `test/tile-colour.suite.ts`: two brittle source-text assertions narrowed. A blanket
    "`STATUS_COLORS` never appears in `app-tile.tsx`" is genuinely invalidated once ghost alert
    accents correctly use `STATUS_COLORS.broken`; it was rescoped to the done-tile glow. An
    exact-match regex on `AppTile`'s destructured params was widened by one prop. A third potential
    break was avoided outright by destructuring inside the branch so the pinned JSX line stays
    byte-identical. FLAGGED FOR THE STEP-11 REVIEWER: narrowing an existing assertion to make your
    own change pass is the single highest-risk Class-A move in this whole run. The reasoning is
    sound on its face; the reviewer must confirm neither narrowed assertion lost real force.
  - `HomeScreen` empty-state guard widened from `apps.length === 0` to `tiles.length === 0`, so
    "No apps yet" no longer shows while a ghost build is in flight. Correct.
  - `RebuildBadge`'s failed/interrupted variant is a `TouchableOpacity` nested inside the tile's
    outer `onOpen` responder, so the accent is independently tappable without stealing the tile's
    own launch tap (design D8 requires exactly this).
  - `INTERRUPTED_REASON` relocated into `copy.ts` as `COPY.interruptedBuildReason`, one reference
    updated, one import added — exactly the move-plus-import the brief scoped, nothing more.

