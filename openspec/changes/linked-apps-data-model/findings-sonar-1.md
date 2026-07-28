# Sonar findings — PR #13 (Davron2004_Whim)

- source: SonarCloud Web API (api/issues/search) for pull request #13
- gate: ERROR
- issues: 0

<!-- Mechanical lane: each finding is one open SonarCloud issue. Red check per finding: the
     PR SonarCloud quality gate; the fix must clear its cited rule at the cited location. -->

## Why this file has a finding when `issues: 0`

`scripts/sonar-pr-issues.mjs` exited **10** (red with findings) while reporting **zero** issues.
That combination is real, not a bug in the ingestion, and the runbook's exit-code contract has no
cell for it. The gate is red on a **condition**, and a condition is a *measure*, not an *issue*, so
`api/issues/search` — the only endpoint the script reads — structurally cannot surface it.

Verified via `api/qualitygates/project_status` for PR #13: four of five conditions OK
(`new_reliability_rating` 1, `new_security_rating` 1, `new_maintainability_rating` 1,
`new_security_hotspots_reviewed` 100.0), and **one ERROR**:

    new_duplicated_lines_density   GT   threshold 3   actual 5.714285714285714

New-code measures confirm there is genuinely nothing else to fix: `new_bugs` 0, `new_code_smells` 0,
`new_violations` 0, `new_vulnerabilities` 0, `new_uncovered_lines` 0, over `new_lines` 455.

Per decision #51's absent-result rule, the empty issue list is NOT evidence that there is nothing to
fix. Taken naively, step 12d would have handed `/fix-loop` an empty findings file, dispatched
nothing, re-pushed an identical tree, and polled a gate that stayed red forever. The finding below
is therefore authored by hand from the gate-condition and duplication APIs, with its provenance
recorded above.

## D1 — src/host/launcher/test/shared-storage.suite.ts:83 — new_duplicated_lines_density (BLOCKER — sole gate failure)

`api/duplications/show` reports one duplicated pair inside this file:

    src/host/launcher/test/shared-storage.suite.ts:83-95  <=>  :114-126   (13 lines each)

26 duplicated lines over 455 new lines = 5.714%, which matches the failing condition's actual value
to the digit — this pair is the entire gate failure. Density on this file alone is 17.3%.

The duplicated span is the per-test scaffolding written out longhand in consecutive tests: the
`fs.rmSync(dir, …)` teardown pair, then `const dir = tmpDir()` / `fileEngineFactory(dir)` /
founder `launchApp` + `if (!founder.ok) throw` / `records.append('Notes', …)` / `close()`.

**Fix direction (the planner decides the shape):** extract the repeated scaffolding into local
helpers in this suite — a setup/teardown wrapper around `tmpDir()` + `fileEngineFactory` + cleanup,
and a "seed the founder with one record" helper. Do not weaken any assertion, do not merge distinct
test cases, and do not touch production code: every `h.eq`/`h.ok` in the file must survive verbatim
in meaning, and all four §-sections must remain separately named tests.

**Test classification: STRUCTURAL, NO BEHAVIORAL DELTA.** A dedupe of test scaffolding cannot change
behavior, so per the fix-loop runbook step 1 this fix gets **no new test** — the assurance is the
existing suite staying green (`npm run launcher:test`, 1318 checks) plus reviewer inspection. Do NOT
fabricate a source-grep test for it; that is bloatware under the repo's test-classification rule.

**Red check:** the PR's SonarCloud quality gate. `new_duplicated_lines_density` must fall to `<= 3`
(removing the 13-line repeat takes the numerator to 0 for this pair). There is no revert-RED to run,
per the structural classification.

## Not a finding — recorded so the next round does not re-litigate it

`api/duplications/show` also reports `src/host/launcher/HomeScreen.tsx:158-171` duplicating
`src/host/launcher/HistoryScreen.tsx:294-307` (14 lines). This is **out of scope and not fixed
here**: `new_duplicated_lines_density` for `HomeScreen.tsx` is `0.0`, i.e. the duplicated span is
pre-existing code that this PR did not introduce, and it contributes nothing to the failing
condition (the arithmetic above already closes at 26/455 without it). Fixing it would mean touching
production code outside the change's seam during a closure round.
