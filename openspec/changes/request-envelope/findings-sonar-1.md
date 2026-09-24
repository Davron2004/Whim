# Sonar findings — PR #80 (Davron2004_Whim)

- source: SonarCloud Web API (api/issues/search) for pull request #80
- gate: OK
- issues: 4

<!-- Mechanical lane: each finding is one open SonarCloud issue. Red check per finding: the
     PR SonarCloud quality gate; the fix must clear its cited rule at the cited location. -->

## S1 — deploy/smoke.sh:150 — shelldre:S7688 (MAJOR)
Use '[[' instead of '[' for conditional tests. The '[[' construct is safer and more feature-rich.

## S2 — src/host/launcher/update-gate.ts:14 — typescript:S6551 (MINOR)
'err' will use Object's default stringification format ('[object Object]') when stringified.

## S3 — src/host/launcher/app-info.ts:58 — typescript:S7786 (MINOR)
`new Error()` is too unspecific for a type check. Use `new TypeError()` instead.

## S4 — server/src/routes/rewrite.ts:102 — typescript:S107 (MAJOR)
Async function 'rewriteWithRetry' has too many parameters (8). Maximum allowed is 7.
