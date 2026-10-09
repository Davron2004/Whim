# Sonar findings — PR #56 (Davron2004_Whim)

- source: SonarCloud Web API (api/issues/search) for pull request #56
- gate: OK
- issues: 8

<!-- Mechanical lane: each finding is one open SonarCloud issue. Red check per finding: the
     PR SonarCloud quality gate; the fix must clear its cited rule at the cited location. -->

## S1 — deploy/deploy.sh:68 — shelldre:S7688 (MAJOR)
Use '[[' instead of '[' for conditional tests. The '[[' construct is safer and more feature-rich.

## S2 — deploy/deploy.sh:71 — shelldre:S7688 (MAJOR)
Use '[[' instead of '[' for conditional tests. The '[[' construct is safer and more feature-rich.

## S3 — deploy/deploy.sh:76 — shelldre:S7688 (MAJOR)
Use '[[' instead of '[' for conditional tests. The '[[' construct is safer and more feature-rich.

## S4 — deploy/deploy.sh:175 — shelldre:S7688 (MAJOR)
Use '[[' instead of '[' for conditional tests. The '[[' construct is safer and more feature-rich.

## S5 — server/src/openrouter.ts:454 — typescript:S6606 (MINOR)
Prefer using nullish coalescing operator (`??=`) instead of an assignment expression, as it is simpler to read.

## S6 — server/src/openrouter.ts:458 — typescript:S6606 (MINOR)
Prefer using nullish coalescing operator (`??=`) instead of an assignment expression, as it is simpler to read.

## S7 — server/src/flowbench/drive.ts:54 — typescript:S6582 (MINOR)
Prefer using an optional chain expression instead, as it's more concise and easier to read.

## S8 — server/src/flowbench/drive.ts:382 — typescript:S7765 (MINOR)
Use `.includes()` instead of `.some()` when checking value existence.
