# Sonar findings — PR #6 (Davron2004_Whim)

- source: SonarCloud Web API (api/issues/search) for pull request #6
- gate: ERROR
- issues: 44

<!-- Mechanical lane: each finding is one open SonarCloud issue. Red check per finding: the
     PR SonarCloud quality gate; the fix must clear its cited rule at the cited location. -->

## S1 — scripts/sonar-pr-issues.mjs:150 — javascript:S6582 (MINOR)
Prefer using an optional chain expression instead, as it's more concise and easier to read.

## S2 — scripts/sonar-pr-issues.mjs:72 — javascript:S6582 (MINOR)
Prefer using an optional chain expression instead, as it's more concise and easier to read.

## S3 — scripts/sonar-pr-issues.mjs:83 — javascript:S6582 (MINOR)
Prefer using an optional chain expression instead, as it's more concise and easier to read.

## S4 — scripts/sonar-pr-issues.mjs:188 — javascript:S7785 (MAJOR)
Prefer top-level await over an async function `main` call.

## S5 — .claude/hooks/bash-policy.sh:172 — shelldre:S131 (CRITICAL)
Add a default case (*) to handle unexpected values.

## S6 — .claude/hooks/bash-policy.sh:381 — shelldre:S131 (CRITICAL)
Add a default case (*) to handle unexpected values.

## S7 — .claude/hooks/bash-policy.sh:383 — shelldre:S131 (CRITICAL)
Add a default case (*) to handle unexpected values.

## S8 — .claude/hooks/bash-policy.sh:388 — shelldre:S131 (CRITICAL)
Add a default case (*) to handle unexpected values.

## S9 — scripts/ruleset-probe.mjs:44 — javascript:S7776 (MINOR)
`ruleTypes` should be a `Set`, and use `ruleTypes.has()` to check existence or non-existence.

## S10 — scripts/ruleset-probe.mjs:55 — javascript:S6582 (MINOR)
Prefer using an optional chain expression instead, as it's more concise and easier to read.

## S11 — .claude/hooks/bash-policy.sh:288 — shelldre:S131 (CRITICAL)
Add a default case (*) to handle unexpected values.

## S12 — .claude/hooks/test/unroll.test.sh:18 — shelldre:S7679 (MAJOR)
Assign this positional parameter to a local variable.

## S13 — .claude/hooks/test/unroll.test.sh:18 — shelldre:S7679 (MAJOR)
Assign this positional parameter to a local variable.

## S14 — .claude/hooks/test/unroll.test.sh:21 — shelldre:S7679 (MAJOR)
Assign this positional parameter to a local variable.

## S15 — .claude/hooks/test/unroll.test.sh:24 — shelldre:S7679 (MAJOR)
Assign this positional parameter to a local variable.

## S16 — .claude/hooks/test/unroll.test.sh:25 — shelldre:S7679 (MAJOR)
Assign this positional parameter to a local variable.

## S17 — .claude/hooks/test/unroll.test.sh:25 — shelldre:S7679 (MAJOR)
Assign this positional parameter to a local variable.

## S18 — .claude/hooks/test/unroll.test.sh:25 — shelldre:S7679 (MAJOR)
Assign this positional parameter to a local variable.

## S19 — .claude/hooks/test/unroll.test.sh:25 — shelldre:S7679 (MAJOR)
Assign this positional parameter to a local variable.

## S20 — .claude/hooks/test/unroll.test.sh:26 — shelldre:S7679 (MAJOR)
Assign this positional parameter to a local variable.

## S21 — .claude/hooks/test/unroll.test.sh:29 — shelldre:S7679 (MAJOR)
Assign this positional parameter to a local variable.

## S22 — .claude/hooks/test/unroll.test.sh:30 — shelldre:S7679 (MAJOR)
Assign this positional parameter to a local variable.

## S23 — .claude/hooks/test/unroll.test.sh:30 — shelldre:S7679 (MAJOR)
Assign this positional parameter to a local variable.

## S24 — .claude/hooks/test/unroll.test.sh:30 — shelldre:S7679 (MAJOR)
Assign this positional parameter to a local variable.

## S25 — .claude/hooks/test/unroll.test.sh:30 — shelldre:S7679 (MAJOR)
Assign this positional parameter to a local variable.

## S26 — .claude/hooks/test/unroll.test.sh:31 — shelldre:S7679 (MAJOR)
Assign this positional parameter to a local variable.

## S27 — .claude/hooks/test/unroll.test.sh:34 — shelldre:S7679 (MAJOR)
Assign this positional parameter to a local variable.

## S28 — .claude/hooks/test/unroll.test.sh:35 — shelldre:S7679 (MAJOR)
Assign this positional parameter to a local variable.

## S29 — .claude/hooks/test/unroll.test.sh:35 — shelldre:S7679 (MAJOR)
Assign this positional parameter to a local variable.

## S30 — .claude/hooks/test/unroll.test.sh:35 — shelldre:S7679 (MAJOR)
Assign this positional parameter to a local variable.

## S31 — .claude/hooks/test/unroll.test.sh:35 — shelldre:S7679 (MAJOR)
Assign this positional parameter to a local variable.

## S32 — .claude/hooks/test/unroll.test.sh:36 — shelldre:S7679 (MAJOR)
Assign this positional parameter to a local variable.

## S33 — .claude/hooks/test/unroll.test.sh:78 — shelldre:S7679 (MAJOR)
Assign this positional parameter to a local variable.

## S34 — .claude/hooks/test/unroll.test.sh:78 — shelldre:S7679 (MAJOR)
Assign this positional parameter to a local variable.

## S35 — .claude/hooks/test/unroll.test.sh:78 — shelldre:S7679 (MAJOR)
Assign this positional parameter to a local variable.

## S36 — .claude/hooks/test/unroll.test.sh:81 — shelldre:S7679 (MAJOR)
Assign this positional parameter to a local variable.

## S37 — .claude/hooks/test/unroll.test.sh:81 — shelldre:S7679 (MAJOR)
Assign this positional parameter to a local variable.

## S38 — .claude/hooks/test/unroll.test.sh:81 — shelldre:S7679 (MAJOR)
Assign this positional parameter to a local variable.

## S39 — .claude/hooks/test/unroll.test.sh:83 — shelldre:S7679 (MAJOR)
Assign this positional parameter to a local variable.

## S40 — .claude/hooks/test/unroll.test.sh:83 — shelldre:S7679 (MAJOR)
Assign this positional parameter to a local variable.

## S41 — .claude/hooks/test/unroll.test.sh:83 — shelldre:S7679 (MAJOR)
Assign this positional parameter to a local variable.

## S42 — .claude/hooks/test/unroll.test.sh:84 — shelldre:S7679 (MAJOR)
Assign this positional parameter to a local variable.

## S43 — .claude/hooks/test/unroll.test.sh:84 — shelldre:S1192 (MINOR)
Define a constant instead of using the literal 'PASS: %s\n' 4 times.

## S44 — .claude/hooks/test/unroll.test.sh:94 — shell:S5332 (MINOR)
Make sure that using clear-text protocols is safe here.
