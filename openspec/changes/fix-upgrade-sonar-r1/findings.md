# Sonar findings — PR #297 (Davron2004_Whim)

- source: SonarCloud Web API (api/issues/search) for pull request #297
- gate: OK
- issues: 6

<!-- Mechanical lane: each finding is one open SonarCloud issue. Red check per finding: the
     PR SonarCloud quality gate; the fix must clear its cited rule at the cited location. -->

## S1 — deploy/Dockerfile:44 — docker:S7031 (MINOR)
Merge this RUN instruction with the consecutive ones.

## S2 — scripts/release/lib/storage-dump.ts:123 — typescript:S6551 (MINOR)
'row.sql' may use Object's default stringification format ('[object Object]') when stringified.

## S3 — deploy/Dockerfile:25 — docker:S8431 (MAJOR)
Use either the version tag or the digest for the image instead of both.

## S4 — deploy/Dockerfile:42 — docker:S8431 (MAJOR)
Use either the version tag or the digest for the image instead of both.

## S5 — scripts/deps-audit.mjs:61 — javascript:S9382 (MINOR)
Unexpected `await` inside a loop.

## S6 — scripts/lib/dependency-pins.mjs:21 — javascript:S7776 (MINOR)
`ENTRY_FIELDS` should be a `Set`, and use `ENTRY_FIELDS.has()` to check existence or non-existence.
