# Harness feedback

Evidence for changing the coding harness (`docs/harness.md`), collected run by run from the agents that live inside it. This README is the whole record: the run log, which themes keep coming back, what actually caught mistakes, and the proposals ranked by evidence. The per-agent files of the first five runs were folded in here and removed on 2026-10-09 (in git history at `8c6cb385`).

## Protocol

Every dispatch prompt (implementer, fix-worker, reviewer, verifier) ends by asking for a `HARNESS FEEDBACK` section in the agent's own final report, in the template below. The orchestrator keeps those sections in its scratchpad, never in the repo. Never collect feedback by resuming a finished agent: a resume reloads the agent's whole transcript after its prompt cache has expired (subagent cache lives about 5 minutes). On 2026-09-24, eight debrief resumes re-read over a million tokens and hit the session limit. At the end of the run the orchestrator appends at most 15 lines to this README and commits them with the run's ledger: one row in the run log (verdict counts across all agents), new or reinforced themes, new catches, and any change to the proposals. No per-run folder.

Template, one entry per time the harness blocked, slowed, redirected or forced a workaround, including workarounds never reported:

```
- **What:** one line
- **Mechanism:** which harness part (gate check, hook, worktree setup, runbook rule, chain block, contract, tooling)
- **Verdict:** CAUGHT-REAL-MISTAKE | DRAWBACK | ENV | NEUTRAL
- **Cost:** rough minutes or tool calls
- **Evidence:** error text or file:line
```

Then "What helped" and "What the harness should change" (1–3 proposals).

Verdicts:
- **CAUGHT-REAL-MISTAKE:** stopped a genuine error by the agent or the plan.
- **DRAWBACK:** a cost with no catch.
- **ENV:** the machine or tooling, not the harness.
- **NEUTRAL:** neither.

## Run log

| Run | Agents | Entries | Caught | Drawback | Env | Neutral |
|---|---|---|---|---|---|---|
| 2026-09-23 request-envelope | 8 implementers, reviewer, 2 verifiers, orchestrator | 86 | 9 | 40 | 18 | 19 |
| 2026-09-24 developer-observability (counted 2026-10-09 from verdict tags) | 19 files: implementers, fix-workers, reviewer, orchestrator | 86 | 14 | 37 | 13 | 22 |
| 2026-09-24 legal-surface-v2 (session 2 only; session 1 lost all but chain-1) | 8 implementers/fix-workers, reviewer, git-cleaner, 2 Sonar workers, orchestrator | ~68 | 11 | 31 | 10 | 16 |
| 2026-09-25 beta-1 (resumed closure 2026-09-29; counted 2026-10-09 from verdict tags) | 9 chains, 17 fixes, 3 reviews, 5 device passes, limit investigation, orchestrator | 118 | 28 | 50 | 13 | 27 |
| 2026-10-07 health-probe-path (on integration/beta-1) | 3 implementers, fix-1, reviewer, orchestrator | 11 tagged (chain-3, fix-1 untagged) | 2 | 4 | 0 | 5 |

## Recurring themes

"Raised by" counts agents per run. A theme that recurs across runs is where to spend.

| # | Theme | Raised by (run 1) | Verdict mix | Status |
|---|---|---|---|---|
| T1 | **Plans hand decisions and contradictions to implementers.** Examples: task vs spec vs rules (chain-5: "Not now goes home" vs "keep the prompt"); spec clause vs scope rule (chain-1: "every log line"); precedent depends on a frozen file (chain-3: WhimTone needs `package.json`); tasks that don't match the code (chain-4); a chain written against a log line that doesn't exist (chain-1b); a missing cross-chain contract (orchestrator) | 6 | DRAWBACK; largest single cost (~15 min of deliberation each) | open |
| T2 | **The "cd first, one command at a time" rule is unworkable and unenforced.** Bash cwd resets every call; everyone chained `cd <wt> && …`; an `npx eslint` from the primary tree silently linted nothing (chain-3) | 7 | DRAWBACK / NEUTRAL | open |
| T3 | **Test directories aren't typechecked** (`src/host/*/test`, `checks/test`, `evals/test` excluded). Stale fixtures fail only at runtime or never; the reviewer found 13 errors past 7 green regates; the fix chain's own new tests were never typechecked either | 5 | DRAWBACK | #79 |
| T4 | **Worktree provisioning is manual and leaky.** `@whim/*` resolves to the primary tree without hand-made symlinks; Gradle needs `../node_modules`; Metro can't bundle from `.claude/worktrees/`, so device tasks can't finish in-chain; codegen writes into the primary `node_modules` | 3 | DRAWBACK / ENV | open |
| T5 | **Hand-written recipes in prompts were wrong:** `assembleRelease` needs upload keys; `simctl --console-pty` hides RN logs; macOS has no `timeout` | 3 | DRAWBACK / ENV | open |
| T6 | **Red-checks have no tooling and leave no evidence.** Implementers hand-roll working-tree backups; the ledger records counts, not variants and failing test names, so the reviewer can't verify them; an inverse `sed` that fails to match silently leaves a mutation in the tree | 5 | NEUTRAL / DRAWBACK; once CAUGHT (chain-1b's own test) | open |
| T7 | **One shared main tree and scratchpad.** Reviewer, verifier, gate-full, merges and the ledger compete; the reviewer ran `rm -rf` in a shared scratchpad | 2 | DRAWBACK (risk) | #74 (related) |
| T8 | **Integrity and ticking are ceremony.** No per-chain file scopes, so integrity can't see scope creep or test weakening (a `=== 1` → `> 0` got through); tasks are ticked at merge, not on acceptance (5.3) | 2 | NEUTRAL / DRAWBACK | open |
| T9 | **Lint rules at a hard edge.** Cognitive complexity 15 in `renderScreenContent` (every new screen needs a shuffle); a comparator demanded on a two-element sort | 2 | DRAWBACK | open |
| T10 | **Test-harness limits.** No single-suite mode in the server or launcher runners (~2900 / ~10k checks per iteration; chain-7a built a scratch runner); `native-host` `Platform.select` always picks iOS; launcher output prints log lines under the wrong test | 4 | DRAWBACK | open |
| T11 | **Conflicting instructions.** An injected co-author reminder vs CLAUDE.md and the chain block (one agent committed it, then amended it out); a stale git-status snapshot in a subagent's context | 4 | DRAWBACK | open |
| T13 | **Strict file ownership orphans cross-cutting follow-ups.** A fix makes a handoff line stale but `openspec/` is out of scope; a real-producer fixture needs a builder in another chain's files; an allowlist lives in `server/` while the chain owns `src/` | 3 | DRAWBACK | open |
| T12 | Shell quirks: zsh `nomatch` on `--include=*.ts`; tool output size limits | 7 | ENV | put in env facts |

Run 2 (legal-surface-v2) reinforced T2 (all agents), T3 (#79), T4 (native builds only in the main tree; 9b), T6, T10, T11 (co-author reminder, 5 agents) and T13, and added:
- **T14 Cross-change interactions nobody tests.** lsv2's log-age cap truncates a file devobs's Ops Agent tails; found only when a human-style re-apply read both diffs.
- **T15 Environment drift inside the gate.** Node/ICU version changes a static scan's verdict (#87); a full `node_modules` symlink changes `prod-build.suite` (9b).
- **T16 Deferred work falls through.** A paragraph deferred by chain-7 "until age signals ship" was never assigned to chain-9 (reviewer H1).

Beta-1 reinforced T1, T4, T7 and T10, and added:
- **T17 Shared processes need ownership too.** Concurrent server suites interrupted a full gate; dedicated device leases did not prevent a Maestro host-log collision with another project. Gate and device orchestration must account for resources outside source paths.
- **T18 Acceptance follows the shipping artifact.** Native keyboard and sheet regressions escaped earlier receipts. A source fix after device acceptance requires a rebuilt candidate and receipts naming that candidate.
- **T19 An absent analysis is not a green gate.** The Sonar probe can exit 0 with GATE:NONE. Closure must also check the current head's settled GitHub result and explicit GATE:OK.

## What caught real mistakes (keep these)

| Mechanism | Catch | Run |
|---|---|---|
| Per-chain self-gate (typecheck) | A plan error: a closed enum split from its exhaustive consumer (`REFUSAL_RULES`), caught on the first gate run | 1 |
| Lint (`no-shadow`, `sonarjs/no-unused-collection`, logging discipline) | Shadowed logger, leftover collection, silently swallowed error | 1 |
| Cross-workspace tripwire (`web-site.suite` consent-key parity) | A `consent*` copy key that privacy.html would have had to quote | 1 |
| Red-check against a weaker variant | A drain-order bug hiding 2 of 3 log lines in chain-1b's own new test | 1 |
| Self-gate suite run | A wrong expected order of model calls in chain-7a's own new rewrite test | 1 |
| Implementer honesty rule | chain-1 reported its unmet spec clause instead of papering over it, which became chain-1b | 1 |
| Final reviewer | Rollback-to-old-image smoke failure (would have hit the next deploy), weakened test, duplicate log key, 13 hidden type errors, a ticked-but-unmet task | 1 |
| Handoff contracts | No NEUTRAL entry reported a question back to a producer chain; every later chain started from the contract alone | 1 |

## Proposals, ranked by evidence

1. **Plan-quality gate before dispatch (T1).**
   - Resolve every spec/task tension in the chain block instead of delegating it.
   - Mark cross-cutting clauses in scope or deferred.
   - Put a closed-union change and all its exhaustive consumers in one chain.
   - Lint that every `reads` handoff has a producer.
   - Grep-verify claims handed to later chains.
   - Check that "follow X exactly" doesn't depend on a frozen file.
2. **`scripts/worktree.sh create|run|remove` (T2, T4).**
   - `create`: add the worktree, mirror `node_modules` with `@whim/*` pointed at the worktree, build, write the owner file.
   - `run <cmd>`: run one command with cwd in the worktree, replacing the one-command rule.
   - Default device tasks to a post-merge main-tree verifier.
3. **Typecheck test directories in `gate.sh` (T3, #79).**
4. **Red-check helper and evidence (T6).** Snapshot the working tree (not HEAD), mutate, run, restore. Reports list each variant and the test that failed by name, and the ledger keeps them.
5. **Recipes live in scripts or docs, not prompts (T5).** Examples: `android:offline-apk`, `ios:sim-log <marker>`, and a no-`timeout` note in the environment facts.
6. **Integrity with real scopes, or retire it (T8).** Derive per-chain file scopes from chains.md, flag assertion-count drops in touched tests, and tick tasks only on acceptance evidence.
7. **Reviewer isolation (T7).** Give the reviewer a read-only worktree of the tip and a per-agent scratch subdirectory.
8. **Ownership escape hatch (T13).** A chain block lists the handoff lines its fixes make stale and who updates them (default: the dispatcher at merge), and names any producer extraction in another chain's files.
9. **Small fixes (T9–T11).**
   - Put "no Co-Authored-By" in the commit step.
   - `native-host` honours `Platform.OS`.
   - Add a single-suite mode to the server, launcher and checks runners (`-- <suite>` / `--only <pattern>`).
   - Refactor `renderScreenContent` to a kind→renderer map.
   - Make log-capture reject duplicate JSON keys.
   - Add a rollback-compat smoke case.
- **2026-10-08/09 — overnight PO orchestration (beta-1 closure, server-ops-hardening, waitlist-hardening, design-system-v1 1–13/23, copy-app-data 1).** ~45 subagents, 6 in parallel at peak, worktree-per-chain.
  - CAUGHT-REAL-MISTAKE: full gate after merges caught the synthrun false `unreachable_screen` (SDK push transition) that two fast-gated merges let through; a reviewer caught a smoke that only guarded billing mode, not instance counts; class-B stops (waitlist HMAC key path) prevented a silently-unkeyed fingerprint.
  - DRAWBACK: fast gate skips knip/Chromium/openspec — orphaned exports and SDK runtime regressions surface late. Run gate-full after every merge touching src/sdk, src/runtime, synthrun or build.
  - DRAWBACK: resuming a ~940k-token designer died ("prompt too long"); fresh agent per phase reading committed docs worked.
  - DRAWBACK: editor diagnostics from deleted worktrees are pure noise; ignore them, the gate decides.
  - ENV: fixed Firestore emulator ports collided across parallel gates — fixed (per-run ports).
  - HELPED: path-partitioned history rewrite (499 → 32 commits, 0 evidence blobs) with a tree-identity gate; independent reviewer per change; live smoke on first real deploy caught a `gcloud` track bug fakes couldn't.
  - Proposals: run knip at each serial merge; implementer briefs must say whether `.claude/**`/package.json are still "protected" (stale CLAUDE.md made agents over-defer); a removal ratchet for verification code (#159).
- **2026-10-19/20 — design-system-v1 16j–20 + fix chain 16n (one top-level session, ~120 subagents, ≤3 in parallel).**
  - CAUGHT-REAL-MISTAKE: reviewers and device verifiers found every serious bug; the fast gate found none (same-id record clobbering ×4, iOS blank Home via native-stack pop/unmount, Android WebView text ~4×, manifest not following the version → storage denial + a capability over-grant, the floor disabling missing_default, O(n²) unvalidated server input).
  - HELPED: splitting big chains into small sequential pieces with token budgets + WIP-commit hand-over + a status file (834k-token single agent → 100–400k pieces); reproduce-first briefs refuted 4 wrong suspects; git-only reviews run beside a working implementer; device verifiers with their own varied stubs.
  - DRAWBACK: agents ran gate.sh in the primary tree 3× (shell cwd resets between Bash calls) — tripwire candidate: gate.sh refuses when run from the primary tree while a chain worktree is the caller's, or briefs give the absolute path (done).
  - DRAWBACK: removal-ratchet --base <staging> reports false removals once another chain merged (#197, runbooks fixed to merge-base).
  - DRAWBACK: `git stash` used once by an implementer (shared stack across worktrees); briefs now forbid it.
  - DRAWBACK: one device verifier spent ~4 real production generations (fresh install defaults to prod); briefs now set the own server first.
  - ENV: XCUITest's doubleTap reaches RN as one press — race bugs needing two fast taps can't be proven on the iOS simulator.
  - Proposals: gate.sh guard against the primary tree as cwd from an agent; ratchet resolves a non-ancestor base to the merge-base itself; a shared device-verifier stub with storage/cue/storage-less variants in the repo (not scratch).
- **2026-10-20/22 — design-system-v1 21 (21a–21m), fix chain 16o, 22 (22a–22h3), closure spec debt (one top-level session, ~75 subagents, ≤3 in parallel).**
  - CAUGHT-REAL-MISTAKE: device passes found what 19k Node checks didn't (composer tap crash on a never-attached ref, Android sheet drag dead on EVERY sheet, a 0.8 s post-close dead tap, plate/tile one-frame offsets); first-paint measurement caught a 2-frame regression from a size-animated container (71→102 ms, fixed to 71).
  - CAUGHT-REAL-MISTAKE: whole-chain reviews split by subsystem (two in parallel) found cross-piece bugs piece reviews missed (late Reload reopening a left app, Home taking taps under the app shape).
  - DRAWBACK: a failed `deepStrictEqual` util.inspect-ed a ReactTestInstance → ~11 GB, twice, Mac out of memory; `--max-old-space-size` did nothing (off-heap). Now: harness `eq` = isDeepStrictEqual + bounded message, and an RSS watchdog (capped-run.sh) for every node/npm run and the gate.
  - DRAWBACK: the Reanimated double was more lenient than 4.6 (fixed-limit spring end, no wrapped callbacks, no cancel on unmount) → timing bugs invisible; now matches the library to the ms. Rule: a double must never be more forgiving than the platform.
  - DRAWBACK: implementers added `Co-Authored-By: Claude` (harness default) to 30 commits against the owner's rule; stripped pre-merge; briefs now forbid it.
  - DRAWBACK: device-heavy pieces overran budgets (300–546k vs 250–300k); splitting code and device halves kept them in budget.
  - ENV: swiftshader emulator runs Reanimated far below real time — never judge sub-second timing on it; use `-gpu host` or the iOS sim with on-device tap scheduling. Reanimated ignores animator_duration_scale and the sim's slow mode (0.25× via ffmpeg).
  - ENV: an API weekly rate limit cut an agent mid-run; resuming it via SendMessage (work saved, status file current) lost nothing.
  - Proposals: commit capped-run.sh to scripts/ and make gate.sh self-cap; a gate check that no commit on a chain branch carries agent attribution; a repo-owned device-verifier stub with stall/slow/limit markers (#222 found the stub's own limits masquerading as bugs).
- **2026-10-30 — design-system-v1 closure shift 1: 21.9 bootstrap land + 21e (nested integration orchestrator under a PO session; build → gate → fix split; 8 subagents, ≤2 in parallel).**
  - CAUGHT-REAL-MISTAKE: the Opus reviewer found that a `Check-removal`-authorised drop (fallback-vs-appColor) was the only pin on `fallbackTint`'s djb2 algorithm; fixed with known answers. The ratchet accepts any trailer, so reviewers should ask "what live invariant did the removed assertion also pin?"
  - CAUGHT-REAL-MISTAKE: research-21.9's "full removal" contradicted four live delta specs (legacy hex → nearest tint, passthrough); caught at brief time by grepping the change's specs, ruled spec-conformant, and full removal sent to the owner.
  - HELPED: keep/remove ruling with spec line numbers in the builder brief (builder and reviewer both said conformance became mechanical); orchestrator grep census narrowed 21.4 to its 4 live items; Sonnet fixer on precise findings (~44k tokens, clean re-review).
  - DRAWBACK: grandchild notifications reached the PO, not the nested orchestrator (first runner); worked around with background `until` watchers on verdict files at known paths.
  - DRAWBACK: `fixloop.sh integrity` classes `build/` as Class 2, so an owner-ratified build.mjs commit can only exit 3 (never 6); the brief assumed 6. Proposal: integrity accepts a ratification token/allowlist for a named SHA.
  - DRAWBACK: the reviewer agent has no write tool, but briefs asked it to write a findings file; the orchestrator saved it. Fix either side.
  - DRAWBACK: foreground Bash auto-backgrounds at 180 s, which lost a builder's server:test exit code; briefs should say to run long suites with run_in_background and a log.
  - DRAWBACK (cosmetic): the ratchet prints the first `Check-removal` trailer's text against every authorised file; and `grep -c FAIL` on gate logs counts harmless lines — a gate summary line with the real fail count would help.
  - ENV: zsh reads `$r:path` as a modifier (write `"${r}":path`); macOS `sed -i` needs `''`.
- **2026-10-30 — beta-2 closure shift 2 + 2b: Podfile.lock, tileColor removal, #227 haptics, fix-beta-2-batch F177/F204/F193 (nested orchestrator under a PO; shift 2 stopped at ~264k and replaced by a fresh 2b orchestrator working from the ledgers).**
  - CAUGHT-REAL-MISTAKE: the #227 Opus review found 2 HIGH a Sonnet builder missed (WhimSheet Send is not "Make the change" → double buzz; FailurePage replayed `failure` on a tapped reopen, forbidden by §5); fixed via a live-transition token. Spec-reading pieces go to Opus builders.
  - CAUGHT-REAL-MISTAKE: F177 VERIFY rejected two scheduling races left in a "deterministic" redesign (timestamp after COMMIT, waiting on `'exit'` not `'close'`); F193 VERIFY rejected a contrast test that read a token constant instead of the rendered surface.
  - HELPED: handover by ledger alone worked: the fresh orchestrator resumed from dispositions.md + progress.md + the PO's relayed runner verdicts with no context from the old one.
  - HELPED: the last regate doubled as the shift's gate-full (gate-full ⊇ gate.sh, no merge after it), saving a ~20 min run.
  - DRAWBACK: `fixloop.sh integrity` without `FIXLOOP_INTEGRATION_BRANCH` bases on `main` → false Class-2 tamper (exit 3); every runner brief must set it. It also classes `build/` as Class 2, so an owner-ratified build.mjs commit can only exit 3.
  - DRAWBACK: a device runner wrote "VERDICT: PASS" while skipping plan E2E steps (Android, BEFORE shot); verdicts should read "PASS (partial: …)".
  - DRAWBACK: a fix pass after a REJECT was queued for merge without a re-VERIFY on record (2b caught it in the ledger); the runbook's "re-run from step 3" needs a ledger line the merge step checks.
  - DRAWBACK: Agent calls from a nested orchestrator always run async, so "run short children in the foreground" is not available; in 2b completion notices did reach the orchestrator, verdict-file `until` watchers stayed as backup.
  - DRAWBACK: gate logs have no step-summary block; runners filter ~480 `^PASS:` lines to list steps.
  - ENV: the PO brief misattributed emulators 5640/5650 (UI2_*, another project) to Whim; device lists in briefs must name owners.
- **2026-10-30 — beta-2 closure shift 3: beta-2-spec-fixes chains 1–7 + LOW batch, #181 options 3 and 1, #231, ds-v1 27-228 (nested integration orchestrator under a PO; ~45 subagents, up to 6 at once).**
  - CAUGHT-REAL-MISTAKE: Opus reviews found the stall line was a constant "40 s" against its own spec scenario (now counts up), a needs-update landing that discarded a typed Describe draft, ruling 27's "not wired" reading resting on a fixer's unratified §5 qualifier (ruling 31), and a See why row whose status went into accessibilityHint.
  - CAUGHT-REAL-MISTAKE: the device runner found `android:release` launching `com.whim/...` (namespace ≠ applicationId) and opening a Metro window; unit tests with a fake adb/react-native couldn't see either. Fixed in #231 (`--appId`, `--no-packager`), device-proven.
  - CAUGHT-REAL-MISTAKE: the #181 builder flagged that "would prompt" = "not on the allow list" would deny capped-run/node/echo for every auto-mode subagent → PO narrowed to default/acceptEdits/plan (ruling 33) before merge.
  - HELPED: notifications from nested children DID reach this orchestrator; background wait loops on committed handoff files (`git cat-file -e branch:path`) gave a deterministic second signal.
  - HELPED: a LOW batch (5 review LOWs from 3 merged chains, one Sonnet fixer, one integrity runner) instead of a fix pass per chain.
  - DRAWBACK: running 4–5 gates at once capped three of them at 1500 s and produced flakes (#232, #238); ≤2 concurrent gates and `--secs 3000` fixed it. Runner monitors that only waited for the verdict line stalled ~20 min on a CAP (no verdict line); briefs now say stop on CAPPED/EXIT too.
  - DRAWBACK: I dispatched runners onto worktrees while fixers were editing them (void verdicts, one torn-read syntax error); never gate a worktree under edit.
  - DRAWBACK: builders' `tsc --noEmit -p .` missed a test-file type error the gate's `npm run -s typecheck` caught; briefs now name the gate's command.
  - DRAWBACK: no single-suite filter for launcher/server/synthrun suites: every red-check costs a full 8–10 min run (raised by 8 agents). Proposal: `--only <suite>` in each run.mjs.
  - DRAWBACK: `fixloop.sh integrity` takes an allowlist FILE; inline globs give a false exit 4.
  - DRAWBACK: a reviewer probed a partial copy of `.claude/hooks` (no `unroll-command.mjs`) and reported a false MEDIUM; probe briefs must copy the whole directory.
  - ENV: Bash blocks foreground `sleep`/lacks `timeout`; `nohup … &` inside run_in_background returns at once; Ghostty prompts on every `react-native run-*` without `--no-packager` (ruling 32).
- **2026-10-30 — beta-2 closure shift 4: shell fixes #234–#241, harness `--only`/#230/#238, LOW batch, copy-app-data 3a/3b, chain-24 devices a1/a2/i1 (nested integration orchestrator; ~45 subagents, ≤4 builders at once).**
  - BENEFIT: `--only <suite>` cut red-checks from 8–10 min to seconds–minutes (LOW batch, 3a, 3b1, 3b2 all used it). Its first cut let a filtered run pass with 0 tests; the Opus review caught it (HIGH) before merge.
  - BENEFIT: an Opus reviewer on every piece caught real defects the builders' own red-checks missed: queued change reading "No progress" (239-240), brisk drag arming ~10 pt in (234-235), the vacuous `--only` pass, an unheld copy target (3b1).
  - BENEFIT: naming the plausible WEAKER variant in the runner's red-check (no queue guard, ARM_FLOOR=0, hold-after-open) made red-checks discriminating.
  - DRAWBACK: orphan `yes` spinners from shift 3 held load at 300–700 for hours; i1 lost ~1.5 h to simctl hangs. Owner rule now: never flood the machine; throttle the test (`taskpolicy -b`, `UV_THREADPOOL_SIZE=1`, Docker `--cpus`). Device briefs need an `uptime` preflight.
  - DRAWBACK: a runner that used `&` inside a `run_in_background` call never woke (stalled after its gate passed). Briefs now say: ONE background call, no `&`, no Monitor, no `pgrep -f` loops (those self-match).
  - DRAWBACK: log-grep monitors fire on any "exit" in suite output and flood the orchestrator with notifications; wait on the process/notice instead.
  - DRAWBACK: device runners on swiftshader burn ~200k tokens for a partial pass; scope per runner must be ~1 task, and runners need shipped screenshot/UI-dump helpers (no PIL/ImageMagick here).
  - DRAWBACK: `bundle exec pod install` is broken (vendored gems lack native extensions); Homebrew pod 1.17.0 works. docs/release/mobile.md is stale on this.
  - DRAWBACK: the orchestrator edited the ledger in the primary tree during a regate (dirty tree after); ledger edits wait until primary-tree gates finish.
  - DRAWBACK: builders used `sed -i` for red-check mutations that silently didn't apply, and `git checkout <file>` that reverted a real fix in the same file; mutations go through Edit and are confirmed with `git diff`.
  - DRAWBACK: two builders ran pattern kills (`pkill`, `pkill -P <own pid>`) against the rules.
- **2026-10-30 — beta-2 closure shift 4b: chain-24 devices (a3r, a4, i2, i3) + triage + 2 fix pieces, copy-app-data 3b1r/3b2 (ruling 41 version verb), separate-shared-data chain-1 (nested integration orchestrator; ~45 subagents)**
  - BENEFIT: the shared device kit (`~/.cache/whim-run/device-kit/`, from a3's helpers) made Android passes cheap; runners extended its README (API 29 night mode, recordVideo `kill -INT`, region.swift, queued-make headers).
  - BENEFIT: a cross-branch read in the reviewer brief caught a merge-time break twice (3b2 fixtures under 3b1r; Timer record without a repo) before any merge; merging the dependency first and letting the dependent fixer merge staging in was the clean fix.
  - BENEFIT: the "stop and report if no cheap answer" clause turned a would-be workaround into PO ruling 41 (narrow version verb, closes #212).
  - DRAWBACK: "restate whole" and "≤500 chars" conflict for long live requirements; a squeezed MODIFIED delta lost normative text (REJECT). Rule: word-for-word restatement wins; the cap is waived there.
  - DRAWBACK: MODIFIED deltas must keep live scenario names on 1.14.1, and 1.14.1 `--strict` fails on pre-existing long-text warnings; briefs should say "1.14.1 without --strict".
  - DRAWBACK: runners I voided mid-gate could not be TaskStopped by me (ownership); a SendMessage "stop" worked but cost a wake-up each.
  - DRAWBACK: `launcher:test --only <suite>` still runs every launcher check in some suites (s4b-kb runner); the full launcher suite needs `--mb 4096` (2048 CAPPED).
  - DRAWBACK: WHIM_STUB_DELAY_MS doesn't delay clarify/rewrite, and keyboard FAILs came without logcat ImeTracker output, so F1's cause stayed inferred.
  - DRAWBACK: load 100–350 from the owner's other projects for most of the shift; an iOS Release build hit its 40-min cap (rebuild arm64-only).
- **2026-10-31 — beta-2 closure shift 4c: s4b-shell, s4c-kb, s4c-bar merged; rechecks r4a/r4b/r4i/i4b/r4c; c5i; chain-24 + copy-app-data closed (nested orchestrator, then a top-level takeover)**
  - DRAWBACK: 9-hour stall. The nested orchestrator ended its turn "waiting for the runner"; the runner's notice went to the PO, and the PO held it waiting for the reviewer's notice, which had gone to the orchestrator. Nobody could wake. Fix: a nested orchestrator never ends a turn waiting on a background child; it runs short children in the foreground or reads verdict files; the PO forwards every child notice at once, never batches.
  - BENEFIT: everything needed to resume was on disk (committed handoff/ verdicts, ledger, branch tips); a fresh top-level session took over from files alone without waking the 360k-token session. Only the ledger line and the next brief lived in uncommitted/tmp state: commit the ledger and keep briefs out of /private/tmp.
  - BENEFIT: a top-level orchestrator gets child notices directly; the remaining queue (fix → re-review + runner → fix 2 → merge → device + gate-full in parallel) ran with no stall.
  - BENEFIT: the re-review caught a non-discriminating static guard (`&&` gate passed); a 1-min Sonnet pass fixed it with a 5th mutation case.
  - DRAWBACK: the removal ratchet's "fallback base" alarmed two agents; it is the documented merge-base-with-main (wider = stricter). Runner briefs now also run `removal-ratchet.mjs --base <chain BASE>`.
  - DRAWBACK: device brief said "LightBarController lines" without the command (`dumpsys activity service com.android.systemui/.SystemUIService`) and didn't say ARTEFACTS needed a fresh build.
- **2026-10-31 — fix-beta-2-sonar-r1: Sonar round 1 of beta-2 (331 findings, 17 lanes; nested fix-loop orchestrator)**
  - BENEFIT: lane-batched workers (one per file/area) + one shared rule guide in plan.md + a growing "lessons" list in the worker brief cut repeat mistakes after wave 1 (void banned by eslint, findLast not in TS lib, mini-app runtime floor, narrow before String()).
  - BENEFIT: child notifications DID reach the nested orchestrator; file-polling (wait.sh on committed handoffs/verdict files) kept it robust anyway. Pointing children at brief files instead of inline prompts kept the orchestrator's context small.
  - BENEFIT: the Opus reviewer caught real defects every first pass missed: `.at()` in a sandbox fixture (runtime floor), Promise.all over isomorphic-git reads (N packs in memory), two divergent S2699 helper designs (one dropped the pass count), and Accepts that were really "missing test double / allowlist".
  - DRAWBACK: `.txt` allowlists/evidence under openspec/changes/ trip the gate's tracked-weight check; keep fixloop allowlists untracked (or give them a non-.txt name). Cost: every wave-1 branch gate failed on it.
  - DRAWBACK: gate.sh takes ~25 min under load (load avg 30-48); with a 2-gate cap, per-lane branch gate + per-merge regate would take ~13 h for 16 lanes. Batched merges (deterministic checks + red-check per lane, one regate per batch, a stacked candidate branch gated in parallel) finished in ~1 h.
  - DRAWBACK: workers default to `capped-run` 180 s for typecheck/server/launcher suites and get killed (exit 137); briefs must say run_in_background + `--secs 600`. Bash tool moves any foreground call past 180 s to the background, so wait loops must return within ~150 s.
  - DRAWBACK: fix-worker.md is stale vs the disabled protected-file system ("scripts/** is Class 2", "run gate.sh"); every brief had to override it.
  - DRAWBACK: revisions appended "## Revision N" instead of rewriting status lines, so handoffs contradicted themselves; briefs now say rewrite in place.
- **2026-10-31 — generation-reliability (#58, #57, #66): 4 chains + 1 whole-change fix chain on `integration/beta-2-fixes` (nested fix orchestrator; ~30 subagents)**
  - KEEP: root-cause first. An Opus investigator reproduced #58 with real Chromium and a scripted model, and it found that the #57 resend and the #58 log were already on main. That shrank the scope before planning.
  - KEEP: build → runner → Opus review → fixer → re-review per chain. All 4 chains and the whole-change review were REJECTED once, each for real defects: level-1 clarify bypassed the compat gate; the breaker could stick open on a 402 probe; an engineer-only outage never opened the breaker.
  - DRAWBACK: brief-rules.md hardcodes `integration/beta-2`, so every runner brief had to override `FIXLOOP_INTEGRATION_BRANCH`.
  - DRAWBACK: `fixloop.sh redcheck` splits the test command on `--`, so it needs a wrapper script. It also reports a tsc build failure as RED, so for server suites builders must show type-satisfying mutation reds.
  - DRAWBACK: `--only config` also selects the 8-minute deploy-config suite (`--only runConfigTests` selects only the config suite). A protocol-level bump also needs `deploy/lib.sh` `WHIM_SMOKE_PROTOCOL_LEVEL`, and that file wasn't in the chain scope.
  - DRAWBACK: subagents always run in the background, so the orchestrator waited by polling transcript tails with a <170 s loop script. Runners that end a turn "waiting on a monitor" look finished to that loop, so also poll their findings file.
