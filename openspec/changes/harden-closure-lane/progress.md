# Progress ledger: harden-closure-lane

Schema `whim-harness`. **Every chain is HUMAN-BOOTSTRAP** — all five files this change touches
(`scripts/gate.sh`, `scripts/fixloop.sh`, `.claude/hooks/bash-policy.sh`,
`.claude/commands/opsx/apply.md`, `docs/harness.md`) are Class-2 protected, so nothing is
dispatchable to an implementer. Per the operator's decision (2026-07-27) this run is an **attended
main-thread session**: chains run serially, each Class-2 edit ratified through the permission
dialog. The dispatcher's parallel-worktree machinery does not apply (chains.md "Parallelism note").
Same posture the predecessor `harden-gate-preconditions` ran under.

## Run start

- 2026-07-27 preconditions — `scripts/gate.sh`, `scripts/gate-full.sh`, `scripts/fixloop.sh` present
  and committed clean; primary tree clean; `git branch --list 'integration/*'` empty (no other
  active run).
- 2026-07-27 run-start — **MAIN_TIP = 3b3c7fcadc0c404c8db0187e043e3eff9df340c0**, recorded as
  `origin/main`, **not** local `main`. Local `main` was stale at `e08e06d`: the predecessor run's PR
  was squash-merged remotely, so `origin/main` carries the merged result under a new SHA. Verified
  before substituting: `git diff --stat HEAD origin/main` was **empty** (trees byte-identical) and
  `git ls-tree origin/main openspec/changes/` **contains** `harden-closure-lane`, so the staging
  branch carries the artifacts it implements and no content is lost. Staging branch
  `integration/harden-closure-lane` cut from MAIN_TIP.
  `FIXLOOP_INTEGRATION_BRANCH=integration/harden-closure-lane` for every `fixloop.sh` invocation
  this run.
- 2026-07-27 note — local `main` remains stale at `e08e06d` for the duration of this run;
  fast-forwarding it is teardown's job (step 12g), not run-start's.

## Pre-dispatch re-measurement — F2 was STALE, and a new finding (F5) surfaced

Before cutting the staging branch the dispatcher re-measured every finding this change is built on,
because `research.md` recorded measurements taken during a run in which another change
(`automate-closure`) was concurrently editing the same file. That re-measurement **invalidated F2**
and **surfaced F5**. Evidence, all taken 2026-07-27 on the attended host:

### F2 — FALSE as stated. The relaxation exists and the docs are accurate.

- `.claude/hooks/bash-policy.sh:164-179` implements a main-thread-only tier-1 relaxation for
  **exactly** the two forms the docs claim: `git fetch origin` and `git pull --ff-only origin main`.
- `git blame` dates that block to **511f024b, 2026-07-26 12:59:06 -0400**,
  `feat(automate-closure): remote-write policy for the staging integration lane, plus ruleset probe`.
  `git branch --contains 511f024b` lists `origin/main` — it is live on the base this run cuts from.
- Bare `git fetch origin` from the main thread: **ALLOWED** (ran; no policy denial).
- `git merge-base --is-ancestor main chore/archive-harden-gate-preconditions`: **rc=0**. It is not
  in the tier-1 deny list at any position, so F2's claim that "the fail-closed substring matcher
  denies any history op naming `main`" is false for this form.
- `docs/harness.md:110` and `.claude/commands/opsx/apply.md:49` describe the relaxation correctly.

**Conclusion:** `research.md` §F2 measured a hook that `automate-closure` fixed **mid-run**, at 12:59
on 2026-07-26 — during the very closure session §F2 was observing. The finding aged out in under a
day. Neither branch of design D2 ("docs wrong" / "hook regressed") is the correct fix; the premise
is void. Recorded as the resolution of D2 rather than as a choice between its two options.

### F2-residual — REAL, and it is what actually bit the research run.

`.claude/hooks/bash-policy.sh:170` excludes **compound** commands from the relaxation
(`*'&'*|*';'*|*'|'*|...` fall through to the tier-1 denies). The dispatcher reproduced this twice
in this session:

- `git fetch origin 2>&1 | tail -3; echo ...` → `git network/shared-ref/history op is
  human-approved only (class-B deviation)` — denied for being compound, not for being a fetch.
- A `grep` whose **search pattern** contained the protected vocabulary → denied on content.

`.claude/commands/opsx/apply.md:56` writes step 12g's two commands joined ("`git fetch origin` +
`git pull --ff-only origin main`"). An operator who issues them as one compound gets a denial whose
message points at the network rule rather than at the compounding — which is precisely the wrong
diagnosis, and is how §F2 reached its conclusion. The relaxed forms must be issued **bare**, and
nothing says so.

### F1, F3 — REAL, confirmed unchanged.

- **F1**: `.claude/commands/opsx/apply.md:52` (step 12c) says only "Quality gate GREEN → (e)". It
  never defines GREEN, so "no check is pending" is the natural reading and `no checks reported`
  satisfies it. Underspecified runbook with no testable predicate. chain-1 proceeds as planned.
- **F3**: `scripts/fixloop.sh:320` — `case "$branch" in fix/*|chain/*) : ;; *) die ...`. `park`
  still refuses `integration/*`. chain-2 proceeds as planned.

### F5 (NEW) — `gh` is unusable under the sandbox, and step 12's carve-out claim is false.

Surfaced by a subagent probe the operator requested (cheapest model, read-only, single bare commands,
explicitly instructed not to work around denials). Results:

| probe | main thread | subagent |
| --- | --- | --- |
| `git fetch origin` (bare) | **ALLOWED** | **DENIED** — `git network/shared-ref/history op is human-approved only` |
| `git merge-base --is-ancestor main <branch>` | **rc=0** | **DENIED** — `subagent git is permitted only inside its own .claude/worktrees/<id>` |
| `gh pr list --limit 1` | **ERROR** — `tls: failed to verify certificate: x509: OSStatus -26276` | **ERROR** — byte-identical message |
| `git status --porcelain` | allowed | allowed (probe not blanket-denied) |
| `git fetch origin 2>&1 \| tail -3` (compound control) | denied | denied |
| `printenv AGENT_ID` | — | **unset** (exit 1, no output) |

Two things follow.

1. **The `AGENT_ID` guard works as written.** The relaxation is main-thread-only by construction,
   and `AGENT_ID` is *not* exported into the subagent's command environment — the hook learns agent
   identity from its own hook payload, so a subagent cannot spoof it by unsetting a variable. The
   two subagent denials also carry *different* messages (tier-1 network vs scoped-worktree), so the
   subagent path is denied twice over for `merge-base`.

2. **`gh` fails for the same reason in both roles, and the sandbox is the cause.** The identical
   failure re-run with the sandbox disabled **succeeded** (exit 0). `OSStatus -26276` is
   `errSecInternalComponent` — a macOS **Keychain** error. `gh` verifies TLS through the system
   trust store via the Security framework, which requires Keychain access the sandbox denies. The
   dispatcher's own `git fetch origin` hit the same wall from the other side: `failed to store:
   100001`, the `osxkeychain` credential helper.

   This **resolves an open question CLAUDE.md currently records as unexplained** — "egress stayed
   blocked for `gh` too, which is filesystem-independent and remains **unexplained**". It is not
   filesystem-independent. It presents as an egress block but is a **trust-store access failure**,
   which is also why `sandbox.excludedCommands` (already measured inert) was never going to help.

   And it makes `.claude/commands/opsx/apply.md:49` false as written: "the sandbox carve-outs give
   them egress + the credential path". Measured: they do not. Every `gh` call in closure (12b, 12c,
   12f, 12g) needs an explicit unsandboxed override. Same defect class this change exists to fix —
   a runbook asserting an environmental capability nobody re-measured.

## Operator decisions (2026-07-27)

- **Run mode**: attended main-thread, serial. (Runbook step 2 would skip all-Class-2 chains; the
  operator elected the predecessor's precedent instead.)
- **D2**: resolved as *void premise* — see above. No `bash-policy.sh` edit; the deny is not
  re-broadened.
- **D3**: **REVERSED on measurement.** Step 12f keeps the local
  `git merge-base --is-ancestor main integration/<id>`. D3 proposed replacing it with
  `gh pr view --json mergeable,mergeStateStatus`; F5 shows the local check is the only one of the
  two that runs **under the sandbox** with no override, and D3's original justification ("the
  ancestor check is unrunnable") is false. The stale-local-ref concern is covered by the bare
  `git fetch origin` closure already permits main-thread.
- **F5 placement**: folded into re-scoped chain-3, which already edits both `docs/harness.md` and
  `apply.md` step 12. chain-4 updates CLAUDE.md's open-question paragraph to say it is resolved.

## Chain dispositions

### chain-0: resolve-open-question (task 0.1) — main-thread, HUMAN-BOOTSTRAP

- 2026-07-27 started — no worktree, no implementer: not a code change.
- 2026-07-27 D2 resolved as **void premise** (evidence above); D3 **reversed on measurement**; D7
  (F5) and D8 added to `design.md`. `tasks.md` §3 rewritten, task 3.6 added (the spec delta still
  mandated D3's `gh` query), task 4.4 added (CLAUDE.md's open question). `chains.md` chain-3 and
  chain-4 entries re-scoped; `.claude/hooks/bash-policy.sh` and its test suite removed from this
  change's edit set entirely.
- 2026-07-27 **merged** at `547685d` — direct commit on the staging branch (attended main-thread;
  no chain branch, so no integrity run and no merge step). Class-2 files: none touched.
- 2026-07-27 note — the commit message was supplied with `git commit -F <file>`, not `-m`. The
  message text names the relaxed forms verbatim, and `-m` would have been denied by the
  content-matching rule (F2b). This is the workaround task 3.5 exists to document, used in anger.

### chain-1: poll-predicate (tasks 1.1–1.5) — main-thread, HUMAN-BOOTSTRAP

- 2026-07-27 started — no worktree, no implementer: Class-2 (`scripts/fixloop.sh`,
  `.claude/commands/opsx/apply.md`), attended main-thread.
- 2026-07-27 **design decision (Class-A deviation from D1's letter, not its intent)** — D1 says
  "invert the predicate", but step 12c had no predicate to invert: it is prose, and a markdown step
  has no exit code. Implemented D1's *stated remedy* instead ("test the predicate, not the prose")
  by extracting the stop condition into a new `scripts/fixloop.sh checkverdict <tool-rc>
  <output-file>` subcommand. Exit contract: **0** settled-pass, **8** pending, **9** settled-fail,
  **2** usage error. `<tool-rc>` is reported but deliberately NOT trusted alone — `gh pr checks`
  exits 0 both when everything passed and when nothing exists, which is the entire defect.
- 2026-07-27 **RED CHECK (task 1.3) — 38 passed / 7 FAILED**, and the shape of the failures is the
  point. The red check was NOT run against a missing subcommand (all 11 assertions would have
  failed with `unknown subcommand`, proving only that the code was unwritten). Instead the **naive
  predicate the runbook's prose actually describes** was implemented first — "settle unless
  something says pending" — and the suite run against it. Observed, verbatim:

  ```text
  FAIL: no-checks-reported classifies as PENDING (expected exit 8, got 0)
        SETTLED PASS
  FAIL: empty check output classifies as PENDING (expected exit 8, got 0)
        SETTLED PASS
  FAIL: an unrecognised state classifies as PENDING (expected exit 8, got 0)
        SETTLED PASS
  ```

  `SETTLED PASS` for the input `no checks reported on the 'integration/run' branch` **is F1**,
  reproduced as an exit code. Meanwhile all four correct-behaviour cases (all-pass, skipping,
  partial-pending, failing) PASSED against the naive predicate — so the suite discriminates the
  defect rather than merely detecting absent code. The naive implementation was never committed.
- 2026-07-27 **GREEN (task 1.5) — 45 passed, 0 failed.** The positive case (`every check passing
  classifies as SETTLED PASS`) is the group's negative control: without it a predicate that
  returned 8 unconditionally would satisfy every other assertion in the group.
- 2026-07-27 fail-safe added beyond the task list — an **unrecognised** state token classifies as
  PENDING and is named in the output. A future `gh` verdict string therefore cannot silently become
  a green; it becomes a loud pending. Same absent-is-not-success rule applied to a value that
  cannot be interpreted rather than one that is missing.
- 2026-07-27 ordering note — a definite failure outranks an uninterpretable state (`failing` is
  checked before `unknown`), because a failure is already actionable and neither order can produce
  a false green.
