# Sonar findings — PR #137 (Davron2004_Whim)

- source: SonarCloud Web API (api/issues/search) for pull request #137
- gate: ERROR
- issues: 18

<!-- Mechanical lane: each finding is one open SonarCloud issue. Red check per finding: the
     PR SonarCloud quality gate; the fix must clear its cited rule at the cited location. -->

## S1 — deploy/cloudrun/deploy.sh:30 — shelldre:S7688 (MAJOR)
Use '[[' instead of '[' for conditional tests. The '[[' construct is safer and more feature-rich.

## S2 — deploy/cloudrun/deploy.sh:33 — shelldre:S7688 (MAJOR)
Use '[[' instead of '[' for conditional tests. The '[[' construct is safer and more feature-rich.

## S3 — deploy/cloudrun/deploy.sh:44 — shelldre:S7688 (MAJOR)
Use '[[' instead of '[' for conditional tests. The '[[' construct is safer and more feature-rich.

## S4 — deploy/cloudrun/deploy.sh:45 — shelldre:S7688 (MAJOR)
Use '[[' instead of '[' for conditional tests. The '[[' construct is safer and more feature-rich.

## S5 — deploy/cloudrun/deploy.sh:57 — shelldre:S7688 (MAJOR)
Use '[[' instead of '[' for conditional tests. The '[[' construct is safer and more feature-rich.

## S6 — deploy/cloudrun/deploy.sh:63 — shelldre:S7688 (MAJOR)
Use '[[' instead of '[' for conditional tests. The '[[' construct is safer and more feature-rich.

## S7 — deploy/cloudrun/deploy.sh:64 — shelldre:S7688 (MAJOR)
Use '[[' instead of '[' for conditional tests. The '[[' construct is safer and more feature-rich.

## S8 — deploy/cloudrun/deploy.sh:66 — shelldre:S7688 (MAJOR)
Use '[[' instead of '[' for conditional tests. The '[[' construct is safer and more feature-rich.

## S9 — deploy/cloudrun/deploy.sh:81 — shelldre:S7688 (MAJOR)
Use '[[' instead of '[' for conditional tests. The '[[' construct is safer and more feature-rich.

## S10 — deploy/cloudrun/deploy.sh:112 — shelldre:S7688 (MAJOR)
Use '[[' instead of '[' for conditional tests. The '[[' construct is safer and more feature-rich.

## S11 — deploy/cloudrun/deploy.sh:113 — shelldre:S7688 (MAJOR)
Use '[[' instead of '[' for conditional tests. The '[[' construct is safer and more feature-rich.

## S12 — deploy/cloudrun/deploy.sh:127 — shelldre:S7688 (MAJOR)
Use '[[' instead of '[' for conditional tests. The '[[' construct is safer and more feature-rich.

## S13 — deploy/cloudrun/deploy.sh:128 — shelldre:S7688 (MAJOR)
Use '[[' instead of '[' for conditional tests. The '[[' construct is safer and more feature-rich.

## S14 — deploy/cloudrun/site.Dockerfile:4 — docker:S6471 (MINOR)
The "caddy" image runs with "root" as the default user. Make sure it is safe here.

## S15 — deploy/cloudrun/site.Dockerfile:4 — docker:S8431 (MAJOR)
Use either the version tag or the digest for the image instead of both.

## S16 — server/src/loadtest/server.ts:89 — typescript:S7503 (MINOR)
Async method 'fetchStats' has no 'await' expression.

## S17 — server/src/loadtest/server.ts:97 — typescript:S7503 (MINOR)
Async method 'lookupKey' has no 'await' expression.

## S18 — server/src/loadtest/server.ts:116 — typescript:S7503 (MINOR)
Async arrow function has no 'await' expression.
