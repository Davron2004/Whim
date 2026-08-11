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
- **cleanup** — chain-3 worktree removed, branch deleted (unsandboxed), owner file cleared.

## Step 10 — full gate

- **gate-full PASS** on the merged tip `420e21d`: `FULL GATE PASSED`. Includes knip, `guard:metro`,
  the three Chromium invariant suites, and `openspec validate` (43 items, 43 passed, 0 failed —
  the three unrelated untracked change folders still validate, as the baseline check predicted).
- **Fresh-clone risk ruled out.** IDE diagnostics repeatedly reported `Cannot find module` for
  modules that demonstrably exist; established as stale-LSP noise (an independent verifier had
  already shown `tsc --noEmit` exit 0 while the IDE showed errors). One of them was worth a real
  check rather than dismissal, because the gate structurally CANNOT catch it: a module that exists
  in the working tree but is untracked/gitignored would typecheck locally and break on a fresh
  clone or in CI. Checked `src/host/launcher/home-grid.ts` — exists, TRACKED, dated Aug 5, i.e.
  pre-existing layout constants, not something this change created. `git status --ignored` over
  `src/host/launcher/` shows only `test/.deliver-pages/`. No untracked-module hazard.

## Step 11 — colour-gap recon (blast radius established BEFORE speccing the fix)

- **Verdict: NO surface bypasses the single resolver.** Every production render of a delivered
  app's colour goes through `tiles.ts:41-47` `tileColor(name, manifest)`:
  grid `HomeScreen.tsx:162`, celebration `DoneStep.tsx:32`, History header `HistoryScreen.tsx:115`,
  and History's prose mention `HistoryScreen.tsx:328` (which pre-resolves `.color` from that same
  `appHue`, so `lex.ts:87`'s `appColor(app.name)` fallback is never reached for a real installed app).
  Therefore injecting `appColor(appId)` into `manifest.tileColor` at delivery makes ALL surfaces
  agree on the id-hash; it cannot desync them. The fix is safe as proposed.
- **Fix coordinates.** Delivery site `mapWireRecord`, `src/host/launcher/build-lifecycle.ts:56-64`.
  Existing seam `liftManifestTileColor`, `src/host/launcher/manifest-tile-color.ts:21-24`, which
  yields `{}` when the wire declared no colour — that is the branch to fill.
- **Load-bearing constraint for the fix.** `tileColor()` only honours a declared colour if it
  matches `HEX_COLOR_RE` (`^#[0-9a-f]{6}$/i`) AND is not in `RESERVED_TILE_HUES` (`tiles.ts:43`).
  An injected value failing either test is SILENTLY rejected and falls back to `appColor(name)` —
  i.e. the fix would appear to work and change nothing. The ghost tile already depends on this
  path surviving the gate (`HomeScreen.tsx:270-276` passes a synthetic
  `{ tileColor: ghostTileColorFor(rec.id) }`), so palette values evidently pass today, but the fix
  MUST carry a test asserting the injected value survives the gate rather than assuming it.
- **~~Forward-only by construction.~~ CORRECTION — this claim was WRONG, caught by the reviewer.**
  I recorded that the fix "leaves every existing installed app's colour untouched (their names
  still hash as before)". That holds only until the app's next REBUILD. `mapWireRecord` is called
  from TWO sites in `deliverResult`: `:126` with `spec.appId` (new install) and `:130` with
  `editing.record.appId` (both edit branches). Injecting inside `mapWireRecord` fires on both, so
  the first rebuild of any existing app would stamp `appColor(appId)` over what had been
  `appColor(name)` — a visible hue jump on an app the user already owns. Worse for a fork: a fork
  copies the parent's `record` wholesale, so `editing.record.appId` is the PARENT's id, giving a
  third distinct hue. Shipping that shape would have traded one instance of the exact
  hue-instability class this requirement exists to eliminate for a broader one.
  **Corrected shape: inject ONLY on the new-install branch**, where the id is provably the ghost's.
  Edit branches stay untouched — they have no ghost to remain stable with, and their colours must
  not move.
## Step 11 — reviewer verdict: SHIP-WITH-FIXES

- Report honesty checked against the diff: every claim in this ledger verified, no discrepancy.
  No Class-1 config touched anywhere in `2bbef1e..HEAD`; no rule downgraded, no dependency added,
  no gate script altered. The only weakening in the whole change was at the test-assertion layer
  (findings F1/F2 below), never at the config layer.
- Confirmations: store-first ordering CORRECTLY PRESERVED (`build-lifecycle.ts:145-149`, with the
  strongest test in the change — it observes the record's state from INSIDE `access.install` via an
  injected callback, then throws from install and rebuilds a fresh store over the same backing Map
  to reproduce a real restart); single-writer discipline HELD (no render surface imports the store);
  launch-time demotion HELD by construction (first synchronous statement of the mount effect, grid
  gated on `ready`); cancel-during-delivery defect CONFIRMED pre-existing and NOT worsened, byte-for-
  byte identical user-visible outcome to the pre-change code.

## Step 11b — fix chain (chain-4), 8 findings

- **dispatched** BASE `e33605b`, worktree `.claude/worktrees/ghost-tiles-4`, branch
  `chain/ghost-tiles-4`. Frontier tier: F5 is where a wrong call reintroduces the exact bug.
- **F1** restored assertion force in `tile-colour.suite.ts` — the narrowed version could not detect
  a fixed status hue used as the done tile's `backgroundColor`. Now: positive pin that
  `const bg = tileColor(name, manifest)` is the one fill source, positive pin that
  `{ backgroundColor: bg }` sits AFTER `styles.tileDone` in the style array (RN is last-wins), and a
  whole-component negative exempting only the two ghost alert-accent style blocks and the imports.
- **F2** re-pinned the wiring link `onCancelGeneration` → `abortLiveAttempt()`.
- **F3** four new tests covering the previously-uncovered shell half: demotion call site AND its
  ordering, ghost-tap reattach via `liveRef` with no new request, failure hydration + Retry/Dismiss,
  concurrent-attempt guards. All regions anchored on code, never on banner comments.
- **F4** corrected the FALSE invariant shipped in `handoff/ghost-handlers.md` — it now states the
  guarantee holds on exactly one path (a new install whose wire declares no `tileColor`).
- **F5 CLOSED — the Class-B deviation is resolved.** `mapWireRecord` gained an OPTIONAL third
  param applied only when no colour was declared; it is passed ONLY at the `!editing` call site as
  `ghostTileColorFor(spec.appId)`. Both edit branches pass no third argument, so the fork case
  (parent's id) is structurally untouched rather than untouched by convention. Five behavioural
  tests, including the two that matter: a rebuild of an owned app does NOT move its hue, and a
  behind-tip rebuild driving the real `isAtTip → fork → update` path also does not.
- **F6** guarded the concurrent-attempt ref clobber. The agent found the defect BROADER than
  reported — `settleFailed` and the catch path also cleared another attempt's ref — and guarded
  those too; leaving them would have made the fix ineffective on the failure path.
- **F7** stale doc reference, **F8** overclaiming test label — both corrected.
- **red-checks (both mandatory, both real)**: removing the F5 injection produced
  `got "#0284c7", want "#475569"` — literally the name-hash-vs-id-hash flip; deleting the
  `demoteBuildingToInterrupted()` call produced two failures, closing the exact regression the
  reviewer proved was previously undetectable. Both restored byte-identical.
- **uncovered edge, REPORTED not improvised** — a wire manifest declaring a string-but-invalid
  `tileColor` (bad hex or reserved hue) is lifted verbatim, wins over the injection, and then
  `tileColor()` silently falls back to `appColor(name)`, so the hue still flips for that record.
  Not fixed: the alternative is duplicating the server's validation into `manifest-tile-color.ts`,
  which that module's doc comment explicitly refuses. Unreachable in production (the generation
  server drops invalid declarations before the device sees them). Routed to the re-review.
- **integrity** exit 0, BASE `e33605b`, 8 files in boundary. **merged** `8415a59` (+249/−20).
- **gate-full PASS** on the merged tip: `FULL GATE PASSED`, `openspec validate` 43/43.

## Step 11c — re-review of the fix chain, and chain-5

The fix chain was RE-REVIEWED rather than accepted on its report, for a specific reason: the finding
it was closing (F1) was "an agent narrowed a test constraint on its own code", and the remedy was
"an agent restores a constraint on its own code" — the same trust structure. A green gate and a
confident report cannot settle that; only an independent read can. The re-review confirmed F1's
force genuinely restored and no assertion weakened anywhere in the range — and then found a real
defect the fix chain had introduced.

- **NEW DEFECT (found by the re-review, fixed in chain-5): the injected hue was destroyed by the
  first rebuild.** `store-access.ts:149` writes `{ ...entry, record: spec.record }` — it replaces
  the host `AppRecord` WHOLESALE from the wire. The edit branch built `spec.record` from the wire
  alone, and a typical wire declares no `tileColor`, so the colour injected at install was DROPPED
  on the first rebuild and the tile flipped back to `appColor(name)`. Every app installed after
  this change would have changed colour the first time it was edited. **"Don't stamp" and
  "preserve" are different fixes** — my chain-4 spec achieved only the first.
  Why the tests missed it: the rebuild test used a fixture with NO `tileColor`, the one shape that
  structurally cannot expose the loss. The uncovered case was the install-THEN-rebuild sequence,
  which no single chain's diff touched at both ends.
- **chain-5 (BASE `4db053b`, merged `86c7c23`, +113/−18)** — five items:
  - **N1** edit branches now pass `editing.record.manifest.tileColor` (preserve, not stamp), plus
    the install-then-rebuild test whose absence hid this. Red-check reverted the argument and
    produced the real hues: `got "#0284c7" (appColor('Tip Splitter')), want "#475569"
    (ghostTileColorFor('app-ghost-1'))`. Restored, SHA-256 verified byte-identical.
    Side benefit: a regenerated manifest that forgets to re-declare an author-declared colour no
    longer silently loses it.
  - **N2** amended the change's own DELTA spec (`specs/app-launcher/spec.md`) — NOT anything under
    `openspec/specs/`. The requirement forbade the hue changing across transmute *unconditionally*,
    but a wire-declared colour legitimately wins (`sdk-design-system`: an app states its own
    identity). Shipping a requirement the code knowingly violates is worse than scoping the
    requirement to the real guarantee, so it now reads "when the delivered app's manifest declares
    no tile color of its own", with a second scenario for the declared-colour case and a third for
    rebuild stability. First line still leads with SHALL; `openspec validate --strict` green.
  - **N3** corrected a comment claiming the "no live run to reattach" branch is "unreachable by
    construction" — two overlapping attempts reach it. The agent also corrected the identical
    falsehood in `handoff/ghost-handlers.md:31` (Class A, declared): leaving the contract asserting
    the opposite of the code it documents would re-seed the same wrong belief.
  - **N4** closed a residual hole in F1's own fix — `tileGhostAlert` is exempted from the
    `STATUS_COLORS` scan AND applied after `{ backgroundColor: bg }`, so a `backgroundColor` added
    there would repaint the ghost fill and pass. Now asserted absent, and proved to bite.
  - **N5** re-anchored `cancelFn`'s region end on code instead of a decorative banner comment,
    which would have silently widened the slice to the rest of the file if reworded — quietly
    disarming the F2 fix.
- **integrity** exit 0, 7 files in boundary. **gate-full PASS** on the merged tip.
- **MEMORY SAVED** (durable, cost three rounds): `StoreAccess.update` is wholesale — any
  host-injected `AppRecord` field must be passed back explicitly on the edit path, and the test
  must exercise install-then-rebuild rather than a bare-fixture rebuild.

## Step 11d — exhaustive state-space audit, and chain-6

The colour behaviour had required three rounds of fixes, each shipping genuine red-checked tests
and each still missing the next defect — always because the tests were written from the diff and
covered only the cells that round had touched. So the final check was NOT another open-ended
review: it enumerated the full matrix {new install, rebuild-at-tip, rebuild-behind-tip/fork, ghost
render} × {wire declares a colour, wire silent} × {prior record has a colour, has none}, and every
cell had to be **tested or reasoned** — "probably fine" disallowed.

- **RESULT: no cell renders a wrong colour.** Every reachable combination resolves the intended
  hue. Also confirmed: chain-5 did NOT buy its green by relaxing chain-4's constraints — chain-4's
  `tileColor === undefined` assertions survive untouched and still hold. Suite 5995 → 6001 checks.
- Remaining items were durability and spec honesty, not defects. **chain-6** (BASE `066ab4e`,
  merged `06db7df`, +82/−2) closed four:
  - **G1** pinned a load-bearing, undocumented dependency: the colour guarantee for PRE-change apps
    holds only because `StoreAccess.update` does not refresh `entry.name` from the new record
    (`store-access.ts:149`). `mapWireRecord` sets `record.name = wire.name`, so after a renaming
    rebuild `app.name` ≠ `app.record.name` and the tile keeps hashing the ORIGINAL name. A future
    "fix" adopting `spec.record.name` — entirely reasonable-looking — would move every pre-change
    app's hue on rename. Now asserted in `store-access.suite.ts` with a failure message explaining
    why, and cross-referenced by comments at both ends. Red-check made exactly that "reasonable"
    edit and the assertion failed (`got "wc-v2", want "WC"`); restore checksum-verified.
  - **G2** tested the fork-inherits-injected-hue cell — correct already, but covered only by a
    fixture with no `tileColor`, i.e. structurally the same blind spot that hid the round-3 defect.
  - **G3** removed the requirement's third overclaim: "nor when that app is later rebuilt" now
    scoped to a rebuild whose own manifest also declares nothing, matching what the code and
    `build-lifecycle.suite.ts:263` actually do. Heading made honest too.
  - **G4** added a `## MODIFIED Requirements` entry so the archived live spec stops asserting that
    `manifest.tileColor` means "the app declared it" when the launcher may now inject it.
- **gate-full PASS** on the merged tip.

## Dispatcher correction to G4 (one-line, made inline — a heading rename, not chain work)

G4 shipped the MODIFIED block under a NEW heading, which would have modified nothing:
`openspec/specs/app-launcher/spec.md` has **no tile-colour requirement at all** — it exists only in
the concurrent, unarchived `shell-redesign-v2` delta (`specs/app-launcher/spec.md:47`). OpenSpec
matches requirements by heading, so a non-matching heading yields an orphan or a duplicate
contradictory requirement rather than a modification. `openspec validate --strict` passed
throughout because it validates the delta's own schema, never cross-change or live-spec coherence.
Owner chose: rename to match `shell-redesign-v2`'s heading verbatim and record the ordering
constraint. Both done; headings now byte-identical, validate green.

**→ `launcher-ghost-tiles` MUST be archived AFTER `shell-redesign-v2`.** Recorded prominently in
`proposal.md` under "ARCHIVE ORDER CONSTRAINT", because that is the file `/opsx:archive` reads.

- **Two gaps the recon flagged as unexamined**, both routed to the reviewer: (a) whether a FORK
  propagates `manifest.tileColor` via `store-access.ts` (a fork would inherit the parent's injected
  hue — plausibly fine, since that already happens for genuinely declared colours, but unverified);
  (b) `whim-prose/lex.ts:87`'s `appColor(app.name)` fallback remains reachable in principle by a
  future caller constructing a `ProseApp` without `.color`. No production caller does so today —
  latent, not a live disagreement, and explicitly NOT patched by this fix.

