# Verifying the DELETE verdicts, 2026-09-21

The worst mistake this audit could cause is deleting a test that was the only guard of something
real. So after the five slice reports came in, the DELETE verdicts were checked again, by hand,
mostly against the code and, where reading couldn't settle it, by mutation: break the property in
the product code, run the suite, see which tests notice, then revert.

**Read this before deleting anything.** Of the ~27 high-risk DELETE verdicts checked, **8 were
wrong** and 2 are only safe after another change lands. Every one of them is now marked inline in
its slice report.

## How the DELETEs were triaged

The slice reports hold 189 DELETE findings. They fall into three risk classes:

| Class | ~Count | Can a wrong verdict lose coverage? | How it was checked |
|---|---:|---|---|
| Safe by construction: constant = its literal, copy/style pins, tests of test doubles, tests of Node/SQLite/zod/sha256, greps that lock already-removed code | ~120 | Only if the label is wrong | Sampled |
| DUPLICATE: "a stronger test elsewhere covers this" | ~50 | Yes, if the cited test doesn't really cover it | Every one touching a standing invariant (device gate, money, cancellation, consent, containment, harness policy) |
| Judgment: "low value", or a grep judged too weak to keep | ~15 | Yes, if the guard catches something no behavioral test does | All deploy-config ones, plus the tooling ones that lean on typechecking |

## Mutation runs

Each run edited one product file, ran the suite, and restored the file with `git checkout`,
rebuilding afterwards where the runtime is generated. The tree was verified clean after each.

| # | Mutation | Suite | Result | What it proved |
|---|---|---|---|---|
| 1 | `src/runtime/web/syscall.js:78`: `ev.source` guard removed | `bridge:invariants` | "forged sysret is inert" FAILED (`ATTACKER`); `INV-CUEGATE`'s `forged-sysret-inert` stayed green | The auditor's "vacuous" claim was wrong (now KEEP-FIX). `INV-CUEGATE`'s sub-assertion does not discriminate the guard |
| 2 | `server/src/usage/resolve.ts:257`: reconciliation credits twice | `server:test` | 13 failures, including `server-core` block 2 (to delete) **and** `routes-generate` "cancelled cost" (its claimed cover) | Deleting `server-core.suite.ts:636-682` is safe |
| 3 | `server/src/routes/generate.ts:362`: SSE `cancel()` no longer aborts | `server:test` | 16 failures in `routes-generate` teardown (slot not freed, ledger unsettled, device stuck at 429). The to-be-deleted `testSseCancelAbortsPipeline` **passed all 5 checks** | Deleting `server-core.suite.ts:450-534` is safe; that test never guarded the property it's named for |
| 4 | `src/host/launcher/probe-gate.ts`: probe before consent | `launcher:test` | 7 failures: 2 in `probe-gate.suite` (to delete) and 5 rendered ("entering and declining consent send no requests", "only a current grant starts the failed health probe", "revoking consent cancels retries", …) | Deleting `probe-gate.suite.ts` is safe |

To re-run one, use the same pattern (the sysret example):

```sh
cd /Users/davrondjabborov/Work/other/Whim
sed -i '' 's|    if (ev.source !== globalThis.parent) return;|    // MUTANT|' src/runtime/web/syscall.js
npm run build && npm run bridge:invariants 2>&1 | tail -30
git checkout -- src/runtime/web/syscall.js && npm run build   # always restore
```

In auto mode, a mutation that disables a security guard needs an explicit human permission.

## Confirmed by reading

| DELETE | Why it's safe |
|---|---|
| Device-header duplicates: `server-core.suite.ts:95-138`, `metering.suite.ts:213-220`, `logging.suite.ts:197-199`, `routes-unary.suite.ts:1061-1068` | `wire-v2.suite.ts` §2 sends a headerless request to every mounted `/v1` route. §2b sends a refused ID through every route and checks that the verifier's own status and body come back unchanged. `admission.suite.ts:333-359` checks that the verifier rejects every malformed shape. Together they cover everything the copies checked |
| `routes-unary.suite.ts:729-744` (classifier metering) | L842-858 runs the same scenario for both clarify and rewrite and checks usage and cost with `assertResolvedOnce` |
| `metering.suite.ts:222-266` (cancellation) | `routes-generate.suite.ts:1045-1058` asserts the same zero credit, plus no stats fetch |
| `contract.suite.ts:276-284` | Runs on a hand-written array |
| `e2e.ts:804-922` + `reconcile.ts` | The test is `reconcile.ts`'s only importer |
| `consent-screen-actions.suite.ts` | `ConsentScreen.tsx` never reads `grants`; `screen-controls.suite.tsx:60-71` covers the behavior |
| `resolve-options.suite.ts` | Tests `memo ?? live`. The regression its header names lives at the call site, which it can't reach |
| `storage-engine` §A isolation (L100-112) | Only proves two SQLite files are separate. The real invariant, a fork getting its own appId, is at `store-access.suite.ts:158-159` |
| `bridge` §D SyscallFrame keys (L253-257) | Checks the output of the test's own `frame()` helper (L101) |
| `invariants/.../bridge/runner.mjs:200-213` (stale generation) | Same dispatcher and property as `bridge/test/acceptance.ts:202-207` |
| `synthrun/test/isolation.ts:636-648` | A subset of L585-596 (the bare browser reaches the HTTP, WS and UDP canaries). Move its spec-scenario citation to L585 when deleting |
| `checks/test/acceptance.ts:500-504, 511-514` | Same cases in `hostile/corpus.ts:46-56, 85-95` |
| `.claude/hooks/test/unroll.test.sh:125-136` | Same hook and same commands as `bash-policy.test.sh:49, 60, 61`. The negative control is weaker than L127 |
| `checks/test/acceptance.ts:1137-1144` | Truly vacuous: nothing is collected, so the pass loops over nothing |
| `deploy-config.suite.ts:1224-1247` (sleep-5 mutant) | A red-check in the gate. It costs a real 5 s per run |

## Overturned verdicts

| Where | Was | Now | Why the DELETE was wrong |
|---|---|---|---|
| `deploy-config.suite.ts` `keySettingProblems` (L626-628, L1681-1682) | DELETE | **KEEP** | It bans `versions add`/`--data-file` (storing the key in Secret Manager over stdin, which never exposes the key in any argument or log) and `addresses create` (reserving a static IP, not key-related at all). The cited behavioral tests only look for the key text. The extra `red:` line can merge into one negative control |
| `deploy-config.suite.ts` `retentionProblems` (L622-624, L1680) | DELETE | **KEEP** | The server reads `WHIM_REPORT_RETENTION_DAYS`/`WHIM_LEDGER_RETENTION_DAYS` from the environment (`server/src/config.ts:153-154`), and the privacy policy promises 90 days. `isForbiddenProfileKey` covers profile files only; this lint covers compose, env and scripts |
| `deploy-config.suite.ts` `associationWriteProblems` (L608-620, L1678-1679) | DELETE | **KEEP** | Association files must come only from release tooling, because the signing fingerprints have to match. `web-site.suite.ts` tests `buildSite`, not the deploy scripts, and nothing else stops a script writing into `.well-known` |
| `deploy-config.suite.ts` `hostnameProblems` (L591-602, L1673-1675) | DELETE | **KEEP-FIX** | "The hostname lives only in `deploy/defaults.env`" is a real single-source rule, and it stops the Caddyfile or `server/src` from hardcoding it. Drop the stale `sslip.io` part; ideally read the domain from `defaults.env` instead of the literal |
| `src/host/version-store/test/acceptance.ts:93-102` (§2.3) | DELETE (vacuous) | **REWRITE** | Not vacuous: `engine.ts:120` explicitly refuses `dataStore`/`data`/`database`/`db`, and without that check nothing throws and the test fails. It's weak because any error passes. Assert the specific error |
| `checks/test/acceptance.ts:173-188` (engine verb-time kinds) | DELETE | **REWRITE** | The "fails to typecheck" safety is imaginary (`tsconfig.json` excludes `checks/test`), but the runtime loop still fails if `DIAGNOSTIC_KINDS` drops an engine storage kind, and L125 (also marked DELETE) was the only other guard. Derive the list from the engine, or get `checks/test` typechecked |
| `server/test/stages.suite.ts:130-166` (`testRecordAssembly`) | DELETE (tautology) | **KEEP, trimmed** | The "prosy" case checks that a model-claimed name and capabilities in a comment are never used, and that the record takes the extracted manifest. That's the CLAUDE.md bridge rule "manifests are extracted at build time, no second source of truth". Trim the six-field restatement, keep L150-157 |
| `invariants/sandbox-isolation/bridge/runner.mjs:179-198` (forged sysret, owner-only) | REWRITE (vacuous) | **KEEP-FIX** | Mutation run 1. It works, but only while the fixture has made fewer than ~7 syscalls. Forge across a wide id range |

## Conditional deletes

These are safe only after something else lands. They're marked inline in `launcher.md`.

- `launcher/test/prompt-flow-wiring.suite.ts:857-874`: the grep that every request's `clientOptions`
  comes from `consentedClientOptions(consentStatus(kv), …)`. It's the only guard that **all** network
  traffic is consent-gated at the root. The rendered tests from mutation run 4 cover the health probe,
  not generate/clarify/rewrite. Delete only after the rendered consent rewrite lands.
- `launcher/test/prompt-flow-wiring.suite.ts:498-512` (delivery routing): delete only after the
  `shareData` property is moved into a behavioral test (`launcher.md` says the same).

## Gaps the check revealed

These deletions are fine, but the property they claim to test isn't tested anywhere:

- `checks/test/acceptance.ts:585-590`: "the static `undeclared_capability` kind matches the bridge's
  denial kind" has hardcoded literals on both sides. Compare against the bridge's own constant.
- `INV-CUEGATE`'s `forged-sysret-inert` sub-assertion doesn't discriminate the guard (mutation run 1).
  Rename it, or drop it.

## How far to trust what wasn't checked

How often the auditors were right depended on the kind of claim:

- **DUPLICATE claims held every time they were checked** (about 12, including the two mutation runs).
- **"This guard is worthless" judgments on greps of current policy failed 4 of 4.** The auditor
  checked that a behavioral test existed nearby, not that it runs on the same files or the same
  path.
- **TAUTOLOGY/VACUOUS labels failed 2 of about 6.** Both times the test was *weak* (any error
  passes, trivial mapping), not *impossible to fail*.

About 150 DELETEs were not individually re-checked. Most are in the safe-by-construction class.
Before deleting from the remainder, apply the two questions that caught every error here:

1. **Does the cited cover run on the same files and the same code path?** A test "nearby" is not a
   cover.
2. **Is it truly impossible to fail, or just weak?** Weak means REWRITE.

The remaining DELETEs most worth that check: the other deploy-config items (`valuesTests`
example-file pins, profile pins, runbook `requiredGuidance`), the launcher SOURCE-GREP deletes of
*current* code (e.g. `prompt-flow-wiring.suite.ts:800-812`), `machine.suite.ts`'s timer and deadline
deletes, `metering.suite.ts:197-211` ("credit before terminal": vacuous as written, so check that
credit-before-terminal ordering is tested somewhere), and the tooling "low value" ones
(`android-project.suite.ts:180-191`, `hermes-entry.suite.ts:73-80`).
