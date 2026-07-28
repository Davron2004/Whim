# Tasks: harden-closure-lane

Every file touched here is **Class-2 protected** (`.claude/commands/opsx/apply.md`,
`.claude/hooks/bash-policy.sh`, `docs/harness.md`, `scripts/fixloop.sh`, `scripts/gate.sh`). No
implementer subagent can edit them — every task is main-thread and human-ratified through the
permission dialog. See `chains.md`.

**Prerequisite:** `automate-closure` task 7.2 must be ticked and that change archived, or at least
not concurrently edited — it owns `apply.md`, which chains 1 and 3 both modify.

## 0. Resolve the open question (blocks chain-3 only)

- [x] 0.1 Put design D2 to the owner: is the documented `git fetch` / `git pull --ff-only` relaxation for the main thread (a) a doc overstatement of something never implemented, or (b) a hook regression that lost a relaxation it should have? Record the answer and its rationale in `design.md` before touching either file. Default if there is no recollection: treat the docs as wrong, because correcting a doc is reversible and re-broadening a deny is not
  - **RESOLVED: neither — the premise is void.** Re-measurement before dispatch showed the relaxation is implemented (`bash-policy.sh:164-179`, landed `511f024b` 2026-07-26 12:59 in `automate-closure`, live on this run's base) and the docs describe it accurately. `research.md` §F2 measured a hook that was fixed *mid-run*, during the very session it was observing. What actually denied those commands is the **compound** exclusion at `bash-policy.sh:170`. Evidence and probe table in `progress.md`; `design.md` D2 updated

## 1. The closure poll asserts a positive verdict

- [x] 1.1 Extend `scripts/test/fixloop-preflight.test.sh` with the poll-predicate case: given tool output reporting that no checks exist for the branch and exit 0, the predicate SHALL classify it as **pending**, not settled — assert on the classification, not on a timing outcome (design D1)
- [x] 1.2 Add the settled case and the negative control: explicit pass/fail verdicts for every required check classify as settled; a mix of pass and pending classifies as pending
- [x] 1.3 Confirm the suite is RED against the current predicate before changing it, and record the observed output in `progress.md`
- [x] 1.4 Rewrite `apply.md` step 12c so the poll continues while any check is pending **or** the tool reports no checks, and concludes only on an explicit verdict from every required check; keep the bounded timeout and the park-on-timeout behaviour
- [x] 1.5 Turn the suite GREEN; re-confirm the negative control still passes

## 2. `fixloop.sh park` accepts a staging branch

- [x] 2.1 Extend the suite with the park case: parking a staging branch renames it under `wip/*` and writes a reason note; parking an unrecognised branch kind still refuses (the negative control that keeps 2.2 from becoming "accept anything")
- [x] 2.2 Widen `scripts/fixloop.sh`'s park case arm to accept `integration/*`, deriving `wip/<id>` the same way (design D5)
- [x] 2.3 Make a staging park's note record that resuming closure may require reconciling with the base branch first, since the base can advance past a parked run and the ancestry check would then fail — this is the fact that makes a parked staging run resumable, learned by hitting it
- [x] 2.4 Verify against the real case: the note `park` now generates carries the same information the hand-rolled `.claude/fixloop/wip-linked-apps-data-model.md` had to record

## 3. Document what the policy actually enforces, and correct the false capability claim

**Re-scoped 2026-07-27** after task 0.1 voided D2's premise. The original 3.1–3.4 assumed a
docs-vs-hook contradiction that does not exist; acting on either branch would have either enshrined
a documentation error or re-broadened a security deny for no cause. `bash-policy.sh` is **not**
edited by this chain. What replaces them is the residual that is real (the compound exclusion), the
friction that was always real (F2b), and the new finding F5. See `progress.md` for the evidence.

- [x] 3.1 State in `docs/harness.md` §4's bash-policy row that the two relaxed forms are relaxed **only as bare, non-compound commands** — `bash-policy.sh:170` drops any command containing `&`, `;`, `|`, backticks, `$(`, `>`, `<` or a newline back to the tier-1 deny, and the denial message names the network rule rather than the compounding, which is a misleading diagnosis
- [x] 3.2 Fix `apply.md` step 12g, which currently writes the two relaxed forms joined ("`git fetch origin` + `git pull --ff-only origin main`"): instruct them as two separate bare commands and say why. This is the exact trap that produced `research.md` §F2's wrong conclusion
- [x] 3.3 Correct the false capability claim in `apply.md` step 12: "the sandbox carve-outs give them egress + the credential path" is measured **false**. Every closure `gh` call (12b, 12c, 12f, 12g) fails under the sandbox with `tls: failed to verify certificate: x509: OSStatus -26276` and needs an explicit unsandboxed override. Record the mechanism — `OSStatus -26276` is `errSecInternalComponent`, a macOS Keychain error; `gh` verifies TLS through the system trust store via the Security framework, which the sandbox denies — so it is a **trust-store access failure presenting as an egress block**, not an egress block (design D7)
- [x] 3.4 Leave `apply.md` step 12f's local `git merge-base --is-ancestor main integration/<id>` in place (design D3 **reversed on measurement**): it returns rc=0 under the sandbox on the main thread, whereas the `gh` replacement D3 proposed cannot run there at all. Note in `docs/harness.md` that the local check is deliberate and sandbox-runnable, so it is not "simplified" into a `gh` call later
- [x] 3.5 Document the content-vs-command matcher friction (F2b) beside the policy description in `docs/harness.md`, with the sanctioned workaround — supply the text through a file (`Write` + `--body-file`, or the Edit tool) rather than rewording prose until the guard stops firing (design D4). Reproduced twice in this run: a compound probe, and a `grep` denied for its **search pattern**
- [x] 3.6 Rewrite the spec delta `specs/staging-integration-lane/spec.md` scenario "Confirming the branch merges cleanly before the ready flip", which currently mandates the provider's mergeability report. D3 is reversed: the requirement is that the check be **runnable by the caller in the environment the step names**, which the local ancestry check is and the provider query is not. Also retire the scenario "A documented relaxation is not enforced" as an instance — keep the general requirement, drop the implication that this change found such a discrepancy, since it did not

## 4. Record what was learned but cannot be fixed

- [ ] 4.1 State in `apply.md` step 12g that a sandboxed branch deletion leaves a stale `[branch "…"]` section in `.git/config` while exiting 0, that this is expected and cosmetic, and that it cannot be cleaned in-session because `git config` is denied to every caller (design D6)
- [ ] 4.2 Record in `docs/harness.md` that closure step 12d (the Sonar-findings → nested `/fix-loop` → re-push loop) was **not** exercised by the first supervised run, since SonarCloud was green on every push — so "supervised closure passed" must not be read as "every step is validated"
- [ ] 4.3 Append a decision entry to `docs/decisions.md`: the absent-result-is-not-success rule extends to runbooks, the documented-vs-enforced reconciliation, D2's resolution (premise void — a finding can age out before it is implemented, so re-measure at dispatch), and D7's mechanism
- [ ] 4.4 Update `CLAUDE.md`'s sandbox paragraph, which records the blocked-`gh` behaviour as "filesystem-independent and remains **unexplained**". It is now explained and measured in both directions (sandboxed: `OSStatus -26276`; unsandboxed: exit 0) — it is a Keychain/trust-store access failure, hence filesystem-*dependent*, and hence never something `excludedCommands` could have fixed. `AGENTS.md` is a symlink to this file, so both update together

## 5. Verification

- [ ] 5.1 `scripts/gate.sh` green on the change tip
- [ ] 5.2 `scripts/gate-full.sh` green on the change tip, from the primary tree, unsandboxed, with `FIXLOOP_INTEGRATION_BRANCH` set
- [ ] 5.3 Exercise the rewritten poll on a real closure and confirm it reports pending — not green — when polled immediately after a push, which is the condition that produced F1
- [ ] 5.4 Sweep the runbooks for any other predicate that reads an absence as success (design Open Questions); file what is found rather than fixing it inline
